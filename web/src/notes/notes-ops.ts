import type { LegacyBlock, LegacyNote } from './types';

// Page operations over the notes array, ported from frontend/views/notes.js (newPage, duplicateSubtree,
// reparentNote, collectNoteIds, deepCopyBlocks). Pure: they take and return plain data so they can be
// tested without a database, and notes-repo applies them inside one read-modify-write.

export function uid(prefix = 'b'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

export const kidsOf = (notes: readonly LegacyNote[], parentId: string | null): LegacyNote[] =>
  notes.filter(n => (n.parent ?? null) === parentId);

export function pathOf(notes: readonly LegacyNote[], id: string): LegacyNote[] {
  const out: LegacyNote[] = [];
  let cur = notes.find(n => n.id === id);
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    out.unshift(cur);
    const parent: unknown = cur.parent;
    cur = typeof parent === 'string' ? notes.find(n => n.id === parent) : undefined;
  }
  return out;
}

/** A note and every descendant subpage, so a delete or a move takes the whole subtree. */
export function collectIds(notes: readonly LegacyNote[], id: string): string[] {
  const ids = [id];
  for (const kid of kidsOf(notes, id)) ids.push(...collectIds(notes, kid.id));
  return ids;
}

export function newNote(parent: string | null, now = Date.now()): LegacyNote {
  return {
    id: uid('n'), emoji: '📄', title: '', tags: [], parent, createdAt: now, updatedAt: now,
    blocks: [{ id: uid(), type: 'text', text: '' }],
  };
}

/** Fresh ids all the way down, since ids are branch anchors and DOM keys. */
export function deepCopyBlocks(list: readonly LegacyBlock[] | undefined): LegacyBlock[] {
  return (list ?? []).map(b => {
    const c = JSON.parse(JSON.stringify(b)) as LegacyBlock;
    c.id = uid();
    if (Array.isArray(c.children)) c.children = deepCopyBlocks(c.children as LegacyBlock[]);
    if (Array.isArray(c.cols)) c.cols = (c.cols as LegacyBlock[][]).map(col => deepCopyBlocks(col));
    return c;
  });
}

/**
 * Copies a page and its subpages under `newParent`. Like legacy, the copy takes the icon, title,
 * tags and blocks only: not the cover, and not Ask-AI branches (they are keyed to block ids that
 * no longer exist in the copy). Returns the new notes, the top copy first.
 */
export function duplicateSubtree(notes: readonly LegacyNote[], sourceId: string, newParent: string | null, now = Date.now()): LegacyNote[] {
  const src = notes.find(n => n.id === sourceId);
  if (!src) return [];
  const copy: LegacyNote = {
    id: uid('n'), emoji: src.emoji, title: src.title, tags: Array.isArray(src.tags) ? [...(src.tags as unknown[])] : [],
    parent: newParent, blocks: deepCopyBlocks(src.blocks), createdAt: now, updatedAt: now,
  };
  const out = [copy];
  for (const kid of kidsOf(notes, sourceId)) out.push(...duplicateSubtree(notes, kid.id, copy.id, now));
  return out;
}

/** The notes array after duplicating `id`, the top copy placed right after its original. */
export function withDuplicate(notes: readonly LegacyNote[], id: string): { notes: LegacyNote[]; topId: string } | null {
  const src = notes.find(n => n.id === id);
  if (!src) return null;
  const copies = duplicateSubtree(notes, id, typeof src.parent === 'string' ? src.parent : null);
  const [top, ...rest] = copies;
  if (!top) return null;
  const next = [...notes];
  next.splice(next.findIndex(n => n.id === id) + 1, 0, top);
  return { notes: [...next, ...rest], topId: top.id };
}

/** False when the move is a no-op or would put a page under itself or its own descendant. */
export function canReparent(notes: readonly LegacyNote[], id: string, newParent: string | null): boolean {
  const n = notes.find(x => x.id === id);
  if (!n || (n.parent ?? null) === newParent) return false;
  if (newParent !== null && (!notes.some(x => x.id === newParent) || collectIds(notes, id).includes(newParent))) return false;
  return true;
}
