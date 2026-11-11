// The persisted chat/threads/projects shape.
//
// This is NOT a new design. It is a transcription of what
// frontend/core/store.js persistAll() writes and loadPersistedState() reads,
// into the single `kv['state']` row of the `notlinear` Dexie database. Per
// AGENTS.md the schema is sacred, so these types exist to make drift a
// compile error and a failing test, not to improve the shape.
//
// Fields are optional where older saved states predate them (the codebase
// calls these "additive [SCHEMA] fields"): a real database written months ago
// will not have `updatedAt`, `modeOverrides` or `customModes`.

/** One project. See loadPersistedState's project normalisation. */
export interface PersistedProject {
  id: string;
  name: string;
  rules: string;
  files: unknown[];
  path: string;
  /**
   * Added for TASK-RD07's "Last updated" sort. Absent on a project legacy has just
   * created (it is stamped when the panel first opens), and 0 once loaded from a
   * save that predates it.
   */
  updatedAt?: number;
}

/** User preferences. persistAll writes exactly these keys — no more. */
export interface PersistedPrefs {
  name?: string;
  tone?: string;
  context?: string;
  model?: string;
  mode?: string;
  folderName?: string;
  searxngUrl?: string;
  /** Persisted, but loadPersistedState always forces it false on load. */
  thinking?: boolean;
  theme?: string;
  rankingLlm?: string;
  customModes?: unknown[];
  modeOverrides?: Record<string, unknown>;
}

/**
 * Per-thread state. Deliberately loose: `stream` is a blob of rendered chat
 * HTML (app.js writes `stream: stream.innerHTML`), with highlight and branch
 * anchors living inside it as <span class="highlighted" data-hid> and
 * .branched[data-bid] elements. Nothing here may be narrowed without checking
 * app.js, and nothing may be dropped on a write — see the oracle test.
 */
export interface PersistedThread {
  /** Rendered HTML, not data. The whole reason P5 must dual-write. */
  stream?: string;
  title?: string;

  /**
   * Branch persistence. NOTE: there is no `branches` array — an earlier draft
   * of this type invented one, and a key-path golden built from a real
   * database showed it appears zero times in practice (`branchSnapshots`
   * appears 22 times in app.js, `.branches` once). Branches persist as two
   * id-keyed maps instead.
   */
  branchSnapshots?: Record<string, PersistedBranchSnapshot>;
  branchRecents?: Record<string, PersistedBranchRecent>;

  highlights?: PersistedHighlight[];
  /**
   * Structured anchors (ADR-038 / ADR-051): where each highlight and branch anchor sits, as
   * offsets into a message's text. Additive; legacy never reads it and, because it saves whole
   * thread objects, never drops it. The saved HTML spans stay the record legacy reads, so this
   * is re-derived from them on every React write that touches marks.
   */
  highlightsV2?: MarkRecord[];

  /** Transcript and breadcrumb state. */
  mainMessages?: unknown[];
  mainHistory?: unknown[];
  docContent?: string;
  h1?: string;
  eyebrow?: string;
  meta?: string;
  promotedCrumbTitle?: string;

  /** Per-thread model and ranking choices (ADR-045, ADR-012). */
  model?: string;
  provider?: string;
  rankingMode?: string;

  /** Usage accounting, shown in the thread header. */
  cost?: number;
  tokenIn?: number;
  tokenOut?: number;
  tokenCacheHit?: number;

  emoji?: string;
  kind?: string;
  projectId?: string;
  unread?: boolean;

  /** Threads carry fields this layer has no business narrowing. */
  [key: string]: unknown;
}

/** What a branch panel persists (app.js captureBranchSnapshot). */
export interface PersistedBranchSnapshot {
  id: string;
  parentBid: string | null;
  anchorBid: string;
  quote: string;
  depth: number;
  createdAt: number;
  touchedAt: number;
  mainTurnId: string | null;
  mainTurnPrompt: string;
  /** The panel body as rendered HTML: another dual-written blob. */
  bodyHTML: string;
  messages: Array<{ role: string; content: string | unknown[]; [k: string]: unknown }>;
  tokenIn: number;
  tokenCacheHit: number;
  tokenOut: number;
  cost: number;
  provider?: string;
  model?: string;
  modelPref: string | null;
}

/** The sidebar's "Recent branches" row (app.js rememberBranchRecent). */
export interface PersistedBranchRecent {
  id: string;
  quote: string;
  parentBid: string | null;
  anchorBid: string;
  depth: number;
  createdAt: number;
  touchedAt: number;
  mainTurnId: string | null;
  mainTurnPrompt: string;
}

/** An entry in a thread's `highlights` list (app.js saveHighlightSelection). */
export interface PersistedHighlight {
  id: string;
  threadId: string;
  threadTitle: string;
  text: string;
  createdAt: number;
  source: 'doc' | 'main-chat' | 'branch';
  branchId?: string;
  branchQuote?: string;
  parentBranchId?: string | null;
  anchorBid?: string;
  depth?: number;
}

/** One entry of `highlightsV2`: a mark, located. */
export interface MarkRecord {
  id: string;
  kind: 'highlight' | 'branch';
  scope: 'stream' | 'doc' | 'branch';
  /** Set when scope is 'branch': the panel the text is in. */
  branchId?: string;
  /** The message's `data-turn-id`, or `legacy-<n>` for one saved before turn ids existed. */
  turnId: string;
  /** Which element's text the offsets index. */
  part: 'ai' | 'user' | 'doc';
  runs: Array<{ start: number; end: number; text: string }>;
}

/** A sidebar button for a non-static thread, recreated on load. */
export interface PersistedDynamicThread {
  id: string;
  title: string;
}

/** The value of the single `kv['state']` row. */
export interface PersistedState {
  threads: Record<string, PersistedThread>;
  current: string;
  dynamic: PersistedDynamicThread[];
  deletedThreads: string[];
  chatCount: number;
  projects: Record<string, PersistedProject>;
  projectCount: number;
  prefs: PersistedPrefs;
}

/** A row in either database's `kv` store. */
export interface KvRow<T = unknown> {
  key: string;
  value: T;
}
