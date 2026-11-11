import Dexie, { type Table } from 'dexie';
import type { KvRow, PersistedState, PersistedProject } from './types';

// TypeScript access to the EXISTING `notlinear` database. Nothing here may
// change its shape.
//
// SCHEMA IS SACRED (AGENTS.md "do not touch"): the version and store
// declaration below must stay byte-identical to frontend/core/store.js:42.
// Changing a store name, key path, or the version number without a migration
// is the one thing this layer must never do, and schema.test.ts asserts it.
export const CHAT_DB_NAME = 'notlinear';
export const CHAT_DB_VERSION = 1;
export const STATE_KEY = 'state';

class ChatDatabase extends Dexie {
  kv!: Table<KvRow<PersistedState>, string>;

  constructor(name: string = CHAT_DB_NAME) {
    super(name);
    // Mirrors frontend/core/store.js: db.version(1).stores({ kv: 'key' })
    this.version(CHAT_DB_VERSION).stores({ kv: 'key' });
  }
}

/** Opens the chat database. A name override exists only for tests. */
export function openChatDb(name: string = CHAT_DB_NAME): ChatDatabase {
  return new ChatDatabase(name);
}

/**
 * Reads the single `state` row. Returns null when absent — notably, this does
 * NOT perform the legacy one-time localStorage (`NL_STORE`) migration that
 * loadPersistedState does. That migration is a one-way, destructive step
 * (it removes the localStorage key) and belongs to whichever app owns startup,
 * so duplicating it here would mean two apps racing to consume the same key.
 */
export async function readState(db: ChatDatabase): Promise<PersistedState | null> {
  const row = await db.kv.get(STATE_KEY);
  return row ? row.value : null;
}

/**
 * Writes the single `state` row.
 *
 * Writes the value through unchanged apart from normalisation that
 * persistAll() itself performs. Every unknown field on a thread is preserved,
 * because `stream` is rendered HTML and threads carry fields this layer has
 * no business knowing about.
 */
export async function writeState(db: ChatDatabase, state: PersistedState): Promise<void> {
  await db.kv.put({ key: STATE_KEY, value: state });
}

/**
 * Normalises a project the way loadPersistedState does, including the
 * `updatedAt` default of 0 for saves written before TASK-RD07 added it.
 * Exported so the oracle test can compare against the legacy behaviour rather
 * than restating these defaults.
 */
export function normalizeProject(sp: Partial<PersistedProject> & { id: string }): PersistedProject {
  return {
    id: sp.id,
    name: sp.name || 'Untitled project',
    rules: sp.rules || '',
    files: Array.isArray(sp.files) ? sp.files : [],
    path: sp.path || '',
    updatedAt: sp.updatedAt || 0,
  };
}

/** The exact prefs keys persistAll() writes, in its order. Used by the tests. */
export const PERSISTED_PREFS_KEYS = [
  'name', 'tone', 'context', 'model', 'mode', 'folderName',
  'searxngUrl', 'thinking', 'theme', 'rankingLlm', 'customModes', 'modeOverrides',
] as const;
