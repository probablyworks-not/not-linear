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
  /** Added for TASK-RD07's "Last updated" sort; 0 for saves that predate it. */
  updatedAt: number;
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
  branches?: unknown[];
  highlights?: unknown[];
  [key: string]: unknown;
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
