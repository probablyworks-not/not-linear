import Dexie, { type Table } from 'dexie';

// The designs database. Like notes (ADR-007), skills (ADR-043) and artifacts (ADR-058) it is its OWN
// db, never the chat `notlinear` db: that schema is frozen and shared with the legacy app.
//
// Two row families, unlike the other feature dbs. A design bundle is ~270KB of HTML plus base64
// screenshots, so one row holding every run would re-serialise megabytes on every debounced
// requirement edit. The index row stays small; only the run being edited is rewritten.
export const DESIGNS_DB_NAME = 'notlinear-designs';
export const DESIGNS_DB_VERSION = 1;

/** The light list of every run, in every project. Loaded when the Designs view mounts. */
export const DESIGNS_INDEX_KEY = 'designs_index_v1';

const RUN_PREFIX = 'designs_run_v1:';

/** The heavy per-run document. Adding row keys to a kv store needs no version bump. */
export const runKey = (runId: string): string => `${RUN_PREFIX}${runId}`;

export const isRunKey = (key: string): boolean => key.startsWith(RUN_PREFIX);

export interface DesignsKvRow { key: string; value: unknown }

class DesignsDatabase extends Dexie {
  kv!: Table<DesignsKvRow, string>;

  constructor(name: string = DESIGNS_DB_NAME) {
    super(name);
    this.version(DESIGNS_DB_VERSION).stores({ kv: 'key' });
  }
}

export function openDesignsDb(name: string = DESIGNS_DB_NAME): DesignsDatabase {
  return new DesignsDatabase(name);
}
