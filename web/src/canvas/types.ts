// Shapes only, no logic and no I/O. The thirteen record families of
// `feature-canvas/CANVAS-TECHNICAL-REQUIREMENTS.md` §10.1, as they are actually stored: a light
// index row, a heavy per-canvas document holding the content collections, and separate hot rows
// for drafts and device-local view state.
//
// Two rules run through all of it and are the reason the Canvas feature exists at all:
//   - Layout is separate from content. Moving, resizing, collapsing or hiding a card writes to
//     `layouts` and can never change what a model saw (FR-06, AC-06).
//   - Provenance outlives its source. A branch points at an immutable revision with a semantic
//     anchor, so editing the original later leaves the old answer interpretable and marks the
//     source changed rather than silently relinking it (AC-05).

/** Schema version of the *payload* shapes, independent of the Dexie db version. */
export const CANVAS_SCHEMA_VERSION = 1;

export type Iso = number;

// ---------- typed message parts ----------

/**
 * A message is an ordered list of typed parts, never rendered HTML. The envelope is deliberately
 * open so a future audio or transcript part can be added without changing a message.
 * `state` is per-part: one part can fail while its siblings succeed (AC-10).
 */
export type PartState = 'ready' | 'pending' | 'failed';

export interface PartBase {
  id: string;
  state: PartState;
  /** Present when `state` is 'failed'; surfaced in the card, never swallowed. */
  error?: string;
}
export interface TextPart extends PartBase { kind: 'text'; text: string }
export interface CodePart extends PartBase { kind: 'code'; text: string; language: string }
export interface ReportPart extends PartBase { kind: 'report'; text: string; title?: string }
export interface HtmlPart extends PartBase { kind: 'html'; html: string; title?: string }
export interface ToolResultPart extends PartBase { kind: 'tool_result'; toolCallId: string; title: string; markdown: string }
/** C5. The shape is fixed now so a media part can be stored without a schema change. */
export interface MediaPart extends PartBase { kind: 'image' | 'video'; assetId: string; mime: string; width?: number; height?: number; durationMs?: number }
/** An uploaded input, as opposed to a generated one. */
export interface AttachmentPart extends PartBase { kind: 'attachment'; assetId: string; name: string; mime: string; bytes: number }

export type CanvasPart =
  | TextPart | CodePart | ReportPart | HtmlPart | ToolResultPart | MediaPart | AttachmentPart;

export const isTextual = (p: CanvasPart): p is TextPart | CodePart | ReportPart =>
  p.kind === 'text' || p.kind === 'code' || p.kind === 'report';

// ---------- author / producer ----------

/**
 * Who produced a message. The `agent` case is reserved so a future Agents interface can write into
 * the same messages without changing their structure (§8.2) — nothing produces one in this release.
 */
export type Author =
  | { kind: 'human' }
  | { kind: 'model'; provider: string; model: string }
  | { kind: 'agent'; agentId: string };

// ---------- anchors ----------

/**
 * Where a selection came from. Identity is semantic (which message, which part) plus the exact
 * quote and offsets, pinned to the revision the source had when it was frozen. The offsets alone
 * would silently relink after an edit; the quote alone could match in the wrong place.
 */
export interface TextAnchor {
  kind: 'text';
  messageId: string;
  partId: string;
  quote: string;
  start: number;
  end: number;
}
/** C5. A region or timestamp within a media part. */
export interface MediaAnchor {
  kind: 'media';
  messageId: string;
  partId: string;
  timestampMs?: number;
  rect?: { x: number; y: number; w: number; h: number };
}
/** The whole of a source, with no selection inside it. */
export interface WholeAnchor { kind: 'whole'; messageId?: string }

export type Anchor = TextAnchor | MediaAnchor | WholeAnchor;

export type AnchorStatus = 'ok' | 'changed' | 'missing';

// ---------- records ----------

export type ThreadKind = 'root' | 'branch' | 'synthesis';

export interface CanvasThread {
  id: string;
  title: string;
  kind: ThreadKind;
  createdAt: Iso;
  updatedAt: Iso;
  rev: number;
}

export interface CanvasMessage {
  id: string;
  threadId: string;
  /** Order within the thread. Dense and contiguous; the repo maintains it. */
  seq: number;
  author: Author;
  parts: CanvasPart[];
  createdAt: Iso;
  updatedAt: Iso;
  rev: number;
  /** The run that produced this message, when a model did. */
  producedByRunId?: string;
  /**
   * The output family this message has been saved as, once it has been. Without it every save
   * would mint a new family, and "save this reply again" would make a second artifact rather than
   * a second version — which is exactly what happened before this field existed.
   */
  outputFamilyId?: string;
  /** Provisional until its run reaches a terminal status: a stream in flight is not an answer. */
  provisional?: boolean;
}

/** The source type a snapshot was frozen from. `chat` and `note` are imported, one-way, in v1. */
export type SourceKind = 'message' | 'chat' | 'note' | 'artifact' | 'file' | 'rule';

/**
 * A frozen excerpt. `content` is a copy on purpose: it is the evidence of what the model was
 * given, and it must survive the original being edited or deleted.
 */
export interface SourceSnapshot {
  id: string;
  kind: SourceKind;
  /** Id in the source's own world — a Canvas message id, a chat thread id, a note id. */
  sourceId: string;
  /** The source's revision at the moment of freezing. */
  sourceRev: number;
  anchor: Anchor;
  content: string;
  /** Of `content`, so a resolver can tell "changed" from "missing" without the original. */
  hash: string;
  label: string;
  createdAt: Iso;
}

/** Exactly what a run was given, and what was dropped. Disclosure, not bookkeeping. */
export interface ContextManifest {
  id: string;
  runId: string;
  snapshotIds: string[];
  /** Inherited project rules/files, by id, resolved through the existing project services (C4). */
  inherited: string[];
  budgetTokens?: number;
  /** Set when something was dropped to fit; the UI must say so. */
  truncated?: { droppedSnapshotIds: string[]; reason: string };
  createdAt: Iso;
}

/** Reference edges may be cyclic. Execution-dependency edges are a separate, later concern. */
export type RelationKind = 'branch' | 'reference' | 'synthesis';

export interface Relation {
  id: string;
  kind: RelationKind;
  /** Thread the edge leaves. For a synthesis there is one relation per source. */
  fromThreadId: string;
  toThreadId: string;
  /** The frozen evidence for this edge, when there is any. */
  snapshotId?: string;
  createdAt: Iso;
}

/** World-space geometry. Never content; see the header. */
export interface LayoutEntry {
  entityId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  collapsed?: boolean;
  hidden?: boolean;
}
/** Keyed by layout id so a canvas can later carry more than one arrangement. */
export interface Layout {
  id: string;
  entries: Record<string, LayoutEntry>;
}

export type RunStatus = 'accepted' | 'streaming' | 'completed' | 'failed' | 'cancelled' | 'interrupted' | 'unknown';

export const TERMINAL_RUN_STATUSES: readonly RunStatus[] =
  ['completed', 'failed', 'cancelled', 'interrupted', 'unknown'];

export const isTerminal = (s: RunStatus): boolean => TERMINAL_RUN_STATUSES.includes(s);

export interface RunUsage { inputTokens: number; outputTokens: number; cacheHitTokens?: number; costUsd?: number }

/**
 * One attempt at one submission. `submissionId` is what makes a double-click or a refresh
 * idempotent: the same submission can have several attempts, but only one accepted result
 * (FR-01, AC-10).
 */
export interface CanvasRun {
  id: string;
  submissionId: string;
  attempt: number;
  threadId: string;
  provider: string;
  model: string;
  status: RunStatus;
  usage?: RunUsage;
  outputVersionId?: string;
  error?: string;
  startedAt: Iso;
  endedAt?: Iso;
}

/**
 * An output family is a stable identity ("this report"); a version is immutable. Saving to project
 * Artifacts pins one version, and later Canvas edits never rewrite what was saved.
 */
export interface OutputVersion {
  id: string;
  familyId: string;
  version: number;
  parts: CanvasPart[];
  producedByRunId?: string;
  createdAt: Iso;
}

/** C5. Declared so media can land without a schema change; nothing writes one in v1. */
export interface CanvasAsset {
  id: string;
  mime: string;
  bytes: number;
  hash: string;
  /** Where the bytes actually are. Never an object URL: those are not an identity. */
  location: { kind: 'file'; path: string } | { kind: 'inline'; data: string };
  width?: number;
  height?: number;
  durationMs?: number;
  state: PartState;
  createdAt: Iso;
}

/**
 * A cross-database write in progress. Saving a Canvas output into project Artifacts cannot be one
 * Dexie transaction, so intent is recorded first and completion second; a retry finds the pending
 * record and cannot create a second artifact (§4.3).
 */
export interface CanvasOperation {
  id: string;
  kind: 'save-artifact';
  canvasId: string;
  status: 'pending' | 'done' | 'failed';
  /** Deterministic, so the same logical save always produces the same id. */
  dedupeKey: string;
  payload: Record<string, string>;
  result?: string;
  error?: string;
  createdAt: Iso;
  updatedAt: Iso;
}

/** What the composer is holding for one target. Scoped so switching canvases leaks nothing (FR-05). */
export interface Draft {
  /** `thread:<id>` for a continue, `new` for a fresh root, `synthesis` for a multi-source ask. */
  target: string;
  text: string;
  snapshotIds: string[];
  attachmentAssetIds: string[];
  model?: string;
  outputPreference?: 'auto' | 'text' | 'report' | 'code' | 'html' | 'image' | 'video';
  updatedAt: Iso;
}

export interface CanvasViewState {
  viewport: { x: number; y: number; zoom: number };
  readingMessageId?: string;
  updatedAt: Iso;
}

// ---------- the rows ----------

/** The index entry: metadata only, so listing canvases never loads a document. */
export interface CanvasSummary {
  id: string;
  /** null is the Unassigned recovery listing: a deleted project leaves its canvases reachable. */
  projectId: string | null;
  title: string;
  counts: { threads: number; messages: number; outputs: number };
  createdAt: Iso;
  updatedAt: Iso;
  rev: number;
}

/** The heavy row. One canvas's whole content. */
export interface CanvasDoc {
  schemaVersion: number;
  summary: CanvasSummary;
  threads: CanvasThread[];
  messages: CanvasMessage[];
  snapshots: SourceSnapshot[];
  manifests: ContextManifest[];
  relations: Relation[];
  layouts: Layout[];
  runs: CanvasRun[];
  outputs: OutputVersion[];
  /** C5. Always empty in v1. */
  assets: CanvasAsset[];
}

export const DEFAULT_LAYOUT_ID = 'canvas';

export function emptyDoc(summary: CanvasSummary): CanvasDoc {
  return {
    schemaVersion: CANVAS_SCHEMA_VERSION,
    summary,
    threads: [], messages: [], snapshots: [], manifests: [],
    relations: [], layouts: [{ id: DEFAULT_LAYOUT_ID, entries: {} }],
    runs: [], outputs: [], assets: [],
  };
}
