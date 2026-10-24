import Dexie, { type Table } from 'dexie';

// The artifacts database. Like notes (ADR-007) and skills it is its OWN db, never the chat `notlinear`
// db: that schema is frozen and shared with the legacy app. One kv row holds every project's artifacts.
export const ARTIFACTS_DB_NAME = 'notlinear-artifacts';
export const ARTIFACTS_DB_VERSION = 1;
export const ARTIFACTS_KEY = 'artifacts_v1';

export interface ArtifactsKvRow { key: string; value: unknown }

class ArtifactsDatabase extends Dexie {
  kv!: Table<ArtifactsKvRow, string>;

  constructor(name: string = ARTIFACTS_DB_NAME) {
    super(name);
    this.version(ARTIFACTS_DB_VERSION).stores({ kv: 'key' });
  }
}

export function openArtifactsDb(name: string = ARTIFACTS_DB_NAME): ArtifactsDatabase {
  return new ArtifactsDatabase(name);
}
