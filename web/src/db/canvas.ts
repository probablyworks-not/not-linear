import Dexie, { type Table } from 'dexie';

// The Canvas database. Like notes (ADR-007), skills (ADR-043), artifacts (ADR-058) and designs
// (ADR-065) it is its OWN db, never the chat `notlinear` db: that schema is frozen and shared with
// the legacy app. ADR-066: Canvas storage is local only — there is no Postgres, no SQLite and no
// server database behind this, whatever `engineering.md` assumes. "Saved" means a confirmed write
// here.
//
// Row families, not one row. A canvas holds whole replies and frozen source text, so a single row
// per database would re-serialise every canvas on every keystroke. The index stays small and is
// the only row a list view loads; drafts and viewport change on every keystroke and every pan, so
// they are separate again and never force a rewrite of the document.
export const CANVAS_DB_NAME = 'notlinear-canvas';
export const CANVAS_DB_VERSION = 1;

/** The light list of every canvas, in every project. Loaded when the Canvas library opens. */
export const CANVAS_INDEX_KEY = 'canvas_index_v1';

/** Durable, cross-boundary operations awaiting reconciliation (e.g. a save into project Artifacts). */
export const CANVAS_OPS_KEY = 'canvas_ops_v1';

const DOC_PREFIX = 'canvas_doc_v1:';
const DRAFT_PREFIX = 'canvas_draft_v1:';
const VIEW_PREFIX = 'canvas_view_v1:';
const ASSET_PREFIX = 'canvas_assets_v1:';

/** The heavy per-canvas document. Adding row keys to a kv store needs no version bump. */
export const docKey = (canvasId: string): string => `${DOC_PREFIX}${canvasId}`;
/** Drafts: hot, small, rewritten on a debounce as the user types. */
export const draftKey = (canvasId: string): string => `${DRAFT_PREFIX}${canvasId}`;
/** Viewport and reading position. Device-local: never exported, never synced, never shared. */
export const viewKey = (canvasId: string): string => `${VIEW_PREFIX}${canvasId}`;
/** Declared in v1 and deliberately unused until C5 brings media. */
export const assetKey = (canvasId: string): string => `${ASSET_PREFIX}${canvasId}`;

export const isDocKey = (key: string): boolean => key.startsWith(DOC_PREFIX);
export const canvasIdOfDocKey = (key: string): string => key.slice(DOC_PREFIX.length);

export interface CanvasKvRow { key: string; value: unknown }

class CanvasDatabase extends Dexie {
  kv!: Table<CanvasKvRow, string>;

  constructor(name: string = CANVAS_DB_NAME) {
    super(name);
    this.version(CANVAS_DB_VERSION).stores({ kv: 'key' });
  }
}

export function openCanvasDb(name: string = CANVAS_DB_NAME): CanvasDatabase {
  return new CanvasDatabase(name);
}
