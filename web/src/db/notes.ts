import Dexie, { type Table } from 'dexie';
import type { KvRow } from './types';

// TypeScript access to the EXISTING `notlinear-notes` database.
//
// Per ADR-007 this is a SEPARATE database from the chat `notlinear` db, and
// must stay that way: Notes must never bump the chat schema, and the chat app
// must never write here. frontend/views/notes.js:110-111 is the original
// declaration this mirrors.
export const NOTES_DB_NAME = 'notlinear-notes';
export const NOTES_DB_VERSION = 1;

/** The three keys notes.js persists (notes.js:113-115). */
export const NOTES_KEY = 'nl_notes_v1';
export const NOTES_SELECTED_KEY = 'nl_notes_selected_v1';
export const NOTES_OPEN_KEY = 'nl_notes_open_v1';
export const NOTES_KEYS = [NOTES_KEY, NOTES_SELECTED_KEY, NOTES_OPEN_KEY] as const;

class NotesDatabase extends Dexie {
  kv!: Table<KvRow, string>;

  constructor(name: string = NOTES_DB_NAME) {
    super(name);
    this.version(NOTES_DB_VERSION).stores({ kv: 'key' });
  }
}

export function openNotesDb(name: string = NOTES_DB_NAME): NotesDatabase {
  return new NotesDatabase(name);
}

/** Reads one notes row by key, or null when absent. */
export async function readNotesKey<T = unknown>(db: NotesDatabase, key: string): Promise<T | null> {
  const row = await db.kv.get(key);
  return row ? (row.value as T) : null;
}

/** Writes one notes row. */
export async function writeNotesKey(db: NotesDatabase, key: string, value: unknown): Promise<void> {
  await db.kv.put({ key, value });
}
