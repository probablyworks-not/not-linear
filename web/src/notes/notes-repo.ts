import { NOTES_KEY, NOTES_OPEN_KEY, NOTES_SELECTED_KEY, openNotesDb } from '../db/notes';
import { postJson } from '../lib/api';
import { canReparent, collectIds, newNote, withDuplicate, withNoteProject } from './notes-ops';
import type { LegacyBlock, LegacyNote } from './types';

// The only place `web/` writes Notes. Same rule as chat-repo.ts: one read-modify-write per `rw`
// transaction, touching only the fields the caller owns, because the legacy app rewrites the whole
// `nl_notes_v1` array from memory on its own saves. Nothing here writes until a backup is verified.

export const BACKUP_FLAG = 'nl_notes_v2_backed_up';

export interface BackupRecord { at: string; path: string; bytes: number }

let db: ReturnType<typeof openNotesDb> | null = null;
const notesDb = () => (db ??= openNotesDb());

export function backupRecord(): BackupRecord | null {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(BACKUP_FLAG) ?? 'null');
    if (v && typeof v === 'object' && typeof (v as BackupRecord).path === 'string') return v as BackupRecord;
  } catch { /* unreadable flag counts as no backup */ }
  return null;
}

export async function readNotes(): Promise<LegacyNote[]> {
  const row = await notesDb().kv.get(NOTES_KEY);
  return Array.isArray(row?.value) ? (row.value as LegacyNote[]) : [];
}

/** Everything in `notlinear-notes`, in the shape tools/export-data.html writes and import-data.html restores. */
export async function dumpNotesBackup(): Promise<unknown> {
  const d = notesDb();
  const rows = await d.kv.toArray();
  return {
    format: 'notlinear-backup/v1',
    createdAt: new Date().toISOString(),
    origin: location.origin,
    userAgent: navigator.userAgent,
    skippedDatabases: [],
    databases: {
      'notlinear-notes': {
        version: d.verno || 1,
        stores: { kv: { keyPath: 'key', autoIncrement: false, records: rows.map((r) => ({ key: r.key, value: r })) } },
      },
    },
    localStorage: {},
  };
}

/**
 * The server writes the file and says where; the flag is set only on a confirmed result, so a
 * failed or empty answer leaves Notes locked. (A browser download cannot be confirmed, and the
 * desktop webview drops blob downloads silently.)
 */
export async function backUpNotes(): Promise<BackupRecord> {
  const res = await postJson<{ ok?: boolean; path?: string; bytes?: number; error?: string }>(
    '/__notlinear_backup_notes', { backup: await dumpNotesBackup() },
  );
  if (!res.ok || !res.path || !res.bytes) throw new Error(res.error ?? 'The backup was not written.');
  const rec: BackupRecord = { at: new Date().toISOString(), path: res.path, bytes: res.bytes };
  localStorage.setItem(BACKUP_FLAG, JSON.stringify(rec));
  return rec;
}

function requireBackup(): void {
  if (!backupRecord()) throw new Error('Notes are locked until they have been backed up.');
}

async function mutateNote(noteId: string, change: (n: LegacyNote) => boolean, touch = true): Promise<boolean> {
  requireBackup();
  const d = notesDb();
  return d.transaction('rw', d.kv, async () => {
    const row = await d.kv.get(NOTES_KEY);
    if (!Array.isArray(row?.value)) return false;
    const notes = row.value as LegacyNote[];
    const note = notes.find((n) => n.id === noteId);
    if (!note || !change(note)) return false;
    if (touch) note.updatedAt = Date.now();
    await d.kv.put({ key: NOTES_KEY, value: notes });
    return true;
  });
}

/** Replaces one note's blocks. Writes nothing (and does not bump `updatedAt`) when they are identical. */
export function saveNoteBlocksTo(noteId: string, blocks: LegacyBlock[]): Promise<boolean> {
  const next = JSON.stringify(blocks);
  return mutateNote(noteId, (n) => {
    if (JSON.stringify(n.blocks) === next) return false;
    n.blocks = blocks;
    return true;
  });
}

export function saveNoteTitle(noteId: string, title: string): Promise<boolean> {
  return mutateNote(noteId, (n) => {
    if (n.title === title) return false;
    n.title = title;
    return true;
  });
}

// ---- page operations ---------------------------------------------------------------------------
// Structural changes (create, delete, duplicate, move, expand) do not bump `updatedAt`, as legacy:
// that is for content edits.

async function mutateNotes(change: (notes: LegacyNote[]) => LegacyNote[] | null, alsoKeys?: (notes: LegacyNote[]) => Promise<void>): Promise<boolean> {
  requireBackup();
  const d = notesDb();
  return d.transaction('rw', d.kv, async () => {
    const row = await d.kv.get(NOTES_KEY);
    const current = Array.isArray(row?.value) ? (row.value as LegacyNote[]) : [];
    const next = change(current);
    if (!next) return false;
    await d.kv.put({ key: NOTES_KEY, value: next });
    await alsoKeys?.(next);
    return true;
  });
}

async function rewriteOpenIds(d: ReturnType<typeof openNotesDb>, edit: (open: string[]) => string[]): Promise<void> {
  const row = await d.kv.get(NOTES_OPEN_KEY);
  const open = Array.isArray(row?.value) ? (row.value as unknown[]).filter((x): x is string => typeof x === 'string') : [];
  await d.kv.put({ key: NOTES_OPEN_KEY, value: edit(open) });
}

export async function readOpenIds(): Promise<string[]> {
  const row = await notesDb().kv.get(NOTES_OPEN_KEY);
  return Array.isArray(row?.value) ? (row.value as unknown[]).filter((x): x is string => typeof x === 'string') : [];
}

/** Marks a sidebar row expanded or collapsed. Only this key is written. */
export async function setExpanded(id: string, expanded: boolean): Promise<void> {
  requireBackup();
  const d = notesDb();
  await d.transaction('rw', d.kv, () => rewriteOpenIds(d, open => (expanded ? [...new Set([...open, id])] : open.filter(x => x !== id))));
}

export async function createNote(parent: string | null): Promise<LegacyNote> {
  const note = newNote(parent);
  const d = notesDb();
  await mutateNotes(
    notes => [...notes, note],
    parent ? () => rewriteOpenIds(d, open => [...new Set([...open, parent])]) : undefined,
  );
  return note;
}

export interface NoteInit { title: string; blocks: LegacyBlock[]; emoji?: string; projectId?: string | null }

/** A finished page in one write (a chat filing a document), top level, optionally inside a project. */
export async function createNoteFrom(init: NoteInit): Promise<LegacyNote> {
  const note: LegacyNote = { ...newNote(null), title: init.title, blocks: init.blocks };
  if (init.emoji) note.emoji = init.emoji;
  if (init.projectId) note.projectId = init.projectId;
  await mutateNotes(notes => [...notes, note]);
  return note;
}

/** Removes the pages and tidies the expanded and selected keys, in the one transaction (legacy deleteNoteIds). */
export async function deleteNotes(ids: string[]): Promise<boolean> {
  const gone = new Set(ids);
  const d = notesDb();
  return mutateNotes(
    notes => (notes.some(n => gone.has(n.id)) ? notes.filter(n => !gone.has(n.id)) : null),
    async remaining => {
      await rewriteOpenIds(d, open => open.filter(id => !gone.has(id) && remaining.some(n => n.id === id)));
      const sel = await d.kv.get(NOTES_SELECTED_KEY);
      if (!remaining.some(n => n.id === sel?.value)) await d.kv.put({ key: NOTES_SELECTED_KEY, value: remaining[0]?.id ?? null });
    },
  );
}

export async function duplicateNote(id: string): Promise<string | null> {
  let topId: string | null = null;
  const d = notesDb();
  let parent: string | null = null;
  const done = await mutateNotes(
    notes => {
      const out = withDuplicate(notes, id);
      if (!out) return null;
      topId = out.topId;
      const p = notes.find(n => n.id === id)?.parent;
      parent = typeof p === 'string' ? p : null;
      return out.notes;
    },
    async () => { if (parent) await rewriteOpenIds(d, open => [...new Set([...open, parent as string])]); },
  );
  return done ? topId : null;
}

export async function reparentNote(id: string, newParent: string | null): Promise<boolean> {
  const d = notesDb();
  return mutateNotes(
    notes => (canReparent(notes, id, newParent) ? notes.map(n => (n.id === id ? { ...n, parent: newParent } : n)) : null),
    newParent ? () => rewriteOpenIds(d, open => [...new Set([...open, newParent])]) : undefined,
  );
}

/** Files a page and its subpages in a project (or ungroups them with null). Subpages are lifted to the top level. */
export function setNoteProject(id: string, pid: string | null): Promise<boolean> {
  return mutateNotes(notes => withNoteProject(notes, id, pid));
}

export interface Cover { src: string; posY: number }
export interface NotePatch { emoji?: string | null; cover?: Cover | null; tags?: string[] }

/** Page header fields. `cover: null` removes the cover, as legacy's `delete n.cover`. */
export function patchNote(id: string, patch: NotePatch): Promise<boolean> {
  return mutateNote(id, n => {
    if ('emoji' in patch) n.emoji = patch.emoji ?? null;
    if ('cover' in patch) { if (patch.cover) n.cover = patch.cover; else delete n.cover; }
    if ('tags' in patch) n.tags = patch.tags ?? [];
    return true;
  });
}

export { collectIds };

// ---- Ask-AI branches (note.branches[]) --------------------------------------------------------------
// Legacy shape, ADR-028: { bid, quote, blockId, messages, createdAt, touchedAt, collapsed?, reader?,
// width?, height?, top?, userSized? }. Records are written before the anchor that points at them.

export interface BranchMessage { role: 'user' | 'assistant'; content: string }
export interface NoteBranch {
  bid: string; quote: string | null; blockId: string | null; messages: BranchMessage[]; createdAt: number; touchedAt: number;
  collapsed?: boolean; reader?: boolean; width?: number; height?: number; top?: number; userSized?: boolean;
}
export type BranchGeometry = Pick<NoteBranch, 'collapsed' | 'reader' | 'width' | 'height' | 'top' | 'userSized'>;

export const branchesOf = (note: LegacyNote): NoteBranch[] => (Array.isArray(note.branches) ? (note.branches as NoteBranch[]) : []);

function mutateBranches(noteId: string, change: (list: NoteBranch[]) => NoteBranch[] | null, touch: boolean): Promise<boolean> {
  return mutateNote(noteId, n => {
    const next = change(branchesOf(n));
    if (!next) return false;
    if (next.length) n.branches = next; else delete n.branches;
    return true;
  }, touch);
}

export function addBranch(noteId: string, branch: NoteBranch): Promise<boolean> {
  return mutateBranches(noteId, list => [...list, branch], true);
}

/** Message and geometry changes. Messages bump `updatedAt` (a real edit); geometry does not. */
export function patchBranch(noteId: string, bid: string, change: (b: NoteBranch) => void, touch = false): Promise<boolean> {
  return mutateBranches(noteId, list => {
    if (!list.some(b => b.bid === bid)) return null;
    return list.map(b => { if (b.bid !== bid) return b; const copy = { ...b, messages: [...b.messages] }; change(copy); return copy; });
  }, touch);
}

export function removeBranch(noteId: string, bid: string): Promise<boolean> {
  return mutateBranches(noteId, list => (list.some(b => b.bid === bid) ? list.filter(b => b.bid !== bid) : null), true);
}
