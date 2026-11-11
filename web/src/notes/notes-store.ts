import { create } from 'zustand';
import { backUpNotes, backupRecord, readNotes, readOpenIds, type BackupRecord } from './notes-repo';
import type { LegacyBlock, LegacyNote } from './types';

// Flat, like the other stores. Holds the note list for the sidebar, tabs and index; the editor owns
// its own document. `revisions` is how an outside change (the legacy app saving) reaches an open
// editor: bumping it remounts that note's editor, and only when the editor has nothing unsaved.

interface NotesState {
  notes: LegacyNote[];
  /** Sidebar rows that are expanded: the legacy `nl_notes_open_v1` key. */
  openIds: ReadonlySet<string>;
  loaded: boolean;
  backup: BackupRecord | null;
  backingUp: boolean;
  backupError: string | null;
  revisions: Record<string, number>;
}

interface NotesActions {
  load(): Promise<void>;
  runBackup(): Promise<void>;
  /** The JSON of a note's blocks as this window last read or wrote them. */
  setKnown(id: string, json: string): void;
  setDirty(id: string, dirty: boolean): void;
  applyBlocks(id: string, blocks: LegacyBlock[]): void;
  applyTitle(id: string, title: string): void;
}

const known = new Map<string, string>();
const dirty = new Set<string>();

export const useNotesStore = create<NotesState & NotesActions>((set, get) => ({
  notes: [],
  openIds: new Set<string>(),
  loaded: false,
  backup: backupRecord(),
  backingUp: false,
  backupError: null,
  revisions: {},

  async load() {
    const [notes, open] = await Promise.all([readNotes(), readOpenIds()]);
    const revisions = { ...get().revisions };
    for (const n of notes) {
      const was = known.get(n.id);
      const now = JSON.stringify(n.blocks);
      if (was !== undefined && was !== now && !dirty.has(n.id)) {
        revisions[n.id] = (revisions[n.id] ?? 0) + 1;
        known.set(n.id, now);
      }
    }
    set({ notes, openIds: new Set(open), loaded: true, revisions });
  },

  async runBackup() {
    set({ backingUp: true, backupError: null });
    try {
      set({ backup: await backUpNotes(), backingUp: false });
    } catch (err) {
      set({ backingUp: false, backupError: err instanceof Error ? err.message : String(err) });
    }
  },

  setKnown(id, json) { known.set(id, json); },
  setDirty(id, d) { if (d) dirty.add(id); else dirty.delete(id); },

  applyBlocks(id, blocks) {
    set({ notes: get().notes.map(n => (n.id === id ? { ...n, blocks, updatedAt: Date.now() } : n)) });
  },
  applyTitle(id, title) {
    set({ notes: get().notes.map(n => (n.id === id ? { ...n, title, updatedAt: Date.now() } : n)) });
  },
}));
