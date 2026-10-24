import Dexie, { type Table } from 'dexie';

// The skills database. Per ADR-007's precedent (notes) this is its OWN db, never the chat
// `notlinear` db: the chat schema is frozen and shared with the legacy app. Keyed rows, like kv.
export const SKILLS_DB_NAME = 'notlinear-skills';
export const SKILLS_DB_VERSION = 1;

export interface SkillsKvRow { key: string; value: unknown }

/** Row keys. Overrides and custom skills are one row each so a write is a single put. */
export const SKILLS_OVERRIDES_KEY = 'overrides';
export const SKILLS_CUSTOM_KEY = 'custom';
export const SKILLS_META_KEY = 'meta';

class SkillsDatabase extends Dexie {
  kv!: Table<SkillsKvRow, string>;

  constructor(name: string = SKILLS_DB_NAME) {
    super(name);
    this.version(SKILLS_DB_VERSION).stores({ kv: 'key' });
  }
}

export function openSkillsDb(name: string = SKILLS_DB_NAME): SkillsDatabase {
  return new SkillsDatabase(name);
}

export async function readSkillsKey<T>(db: SkillsDatabase, key: string): Promise<T | null> {
  const row = await db.kv.get(key);
  return row ? (row.value as T) : null;
}

export async function writeSkillsKey(db: SkillsDatabase, key: string, value: unknown): Promise<void> {
  await db.kv.put({ key, value });
}
