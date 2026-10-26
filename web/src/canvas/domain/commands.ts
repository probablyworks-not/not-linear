import { checksum, hashText, newId } from '../ids';
import { messageText, threadText } from '../anchors';
import {
  DEFAULT_LAYOUT_ID, HIGHLIGHT_TONES, type Anchor, type Author, type CanvasDoc, type CanvasFileRef,
  type CanvasMemoryItem, type CanvasMessage, type CanvasPart, type CanvasRun, type CanvasThread,
  type HighlightTone, type Layout, type OutputVersion, type Relation, type RunStatus, type RunUsage,
  type SourceKind, type SourceSnapshot, type TextAnchor, type WholeAnchor,
} from '../types';

// Pure commands over a canvas document. No React, no Dexie, no provider, no clock of their own —
// `now` is passed in so a test can pin it. They mutate the document in place and return the thing
// they created, the same shape `db/*-ops.ts` uses for the chat state.
//
// This file is the AC-16 boundary: a non-Canvas consumer (a future Agents interface) must be able
// to drive these without importing React Flow or anything under `canvas/view/`.

export interface Ctx { now: number }

const NODE_W = 360;
const NODE_H = 300;
const GAP_X = 80;

const layoutOf = (doc: CanvasDoc, layoutId = DEFAULT_LAYOUT_ID): Layout => {
  const found = doc.layouts.find(l => l.id === layoutId);
  if (found) return found;
  const made: Layout = { id: layoutId, entries: {} };
  doc.layouts.push(made);
  return made;
};

const GAP_Y = 24;

const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): boolean =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/**
 * Drops `self` straight down, past whichever existing entry it overlaps, until clear of all of
 * them — x (and everything else on the canvas) never moves, only `self`'s y (bug #067: an
 * unrelated "beside" placement, e.g. a root question anchored to the previous thread, can still
 * land on top of a third node it was never placed relative to).
 */
function resolveOverlap(doc: CanvasDoc, entityId: string, layoutId = DEFAULT_LAYOUT_ID): void {
  const layout = layoutOf(doc, layoutId);
  const self = layout.entries[entityId];
  if (!self) return;
  const others = Object.values(layout.entries).filter(e => e.entityId !== entityId);
  let moved = true, guard = 0;
  while (moved && guard++ < 50) {
    moved = false;
    for (const o of others) {
      if (overlaps(self, o)) {
        self.y = o.y + o.h + GAP_Y;
        moved = true;
      }
    }
  }
}

/**
 * New cards go beside their source with vertical jitter and **nothing else moves** (FR-06). The
 * jitter is derived from the id, not Math.random, so the same branch lands in the same place on
 * re-import and a test can assert it.
 *
 * `besideY`, when given, overrides the jittered `src.y` — it's the flow-space Y of whatever the
 * branch was actually taken from (e.g. the selected quote), so a branch off a tall card lands
 * level with the text it came from instead of near the card's top (bug: branch always looked like
 * it came from the top of the source regardless of where in it the quote was).
 */
export function placeBeside(doc: CanvasDoc, entityId: string, sourceEntityId: string | null, layoutId = DEFAULT_LAYOUT_ID, besideY?: number): void {
  const layout = layoutOf(doc, layoutId);
  const src = sourceEntityId ? layout.entries[sourceEntityId] : undefined;
  const jitter = ((hashText(entityId).charCodeAt(0) % 9) - 4) * 10;
  layout.entries[entityId] = src
    ? { entityId, x: src.x + src.w + GAP_X, y: besideY ?? (src.y + jitter), w: NODE_W, h: NODE_H }
    : { entityId, x: 0, y: 0, w: NODE_W, h: NODE_H };
  resolveOverlap(doc, entityId, layoutId);
}

/**
 * New *unrelated* root threads stack below everything else instead of beside the last thread —
 * `placeBeside` is reserved for an actual branch/synthesis source, since the canvas view follows
 * new cards as if they were placed relative to what they came from (bug: a plain new question was
 * panning the view to the right, as if it had branched off the previous reply).
 */
function placeBelowAll(doc: CanvasDoc, entityId: string, layoutId = DEFAULT_LAYOUT_ID): void {
  const layout = layoutOf(doc, layoutId);
  const others = Object.values(layout.entries).filter(e => e.entityId !== entityId);
  const maxBottom = others.reduce((m, o) => Math.max(m, o.y + o.h), 0);
  layout.entries[entityId] = { entityId, x: 0, y: others.length ? maxBottom + GAP_Y : 0, w: NODE_W, h: NODE_H };
}

/** Geometry only. Deliberately the one way to move a card, so content writes cannot ride along. */
export function setGeometry(
  doc: CanvasDoc,
  entityId: string,
  patch: Partial<Pick<Layout['entries'][string], 'x' | 'y' | 'w' | 'h' | 'collapsed' | 'hidden'>>,
  layoutId = DEFAULT_LAYOUT_ID,
): void {
  const layout = layoutOf(doc, layoutId);
  const cur = layout.entries[entityId] ?? { entityId, x: 0, y: 0, w: NODE_W, h: NODE_H };
  layout.entries[entityId] = { ...cur, ...patch, entityId };
}

const touch = (doc: CanvasDoc, ctx: Ctx): void => {
  doc.summary.updatedAt = ctx.now;
  doc.summary.counts = {
    threads: doc.threads.length,
    messages: doc.messages.length,
    outputs: doc.outputs.length,
  };
};

const nextSeq = (doc: CanvasDoc, threadId: string): number =>
  doc.messages.filter(m => m.threadId === threadId).reduce((n, m) => Math.max(n, m.seq + 1), 0);

export interface AddMessageInput {
  threadId: string;
  author: Author;
  parts: CanvasPart[];
  producedByRunId?: string;
  provisional?: boolean;
}

export function addMessage(doc: CanvasDoc, input: AddMessageInput, ctx: Ctx): CanvasMessage {
  const msg: CanvasMessage = {
    id: newId('ms'),
    threadId: input.threadId,
    seq: nextSeq(doc, input.threadId),
    author: input.author,
    parts: input.parts,
    createdAt: ctx.now,
    updatedAt: ctx.now,
    rev: 1,
    ...(input.producedByRunId ? { producedByRunId: input.producedByRunId } : {}),
    ...(input.provisional ? { provisional: true } : {}),
  };
  doc.messages.push(msg);
  const thread = doc.threads.find(t => t.id === input.threadId);
  if (thread) { thread.updatedAt = ctx.now; thread.rev += 1; }
  touch(doc, ctx);
  return msg;
}

/** Editing a message bumps its revision, which is what makes an old anchor resolve as `changed`. */
export function editMessagePart(doc: CanvasDoc, messageId: string, partId: string, text: string, ctx: Ctx): CanvasMessage | null {
  const msg = doc.messages.find(m => m.id === messageId);
  if (!msg) return null;
  const part = msg.parts.find(p => p.id === partId);
  if (!part) return null;
  if (part.kind === 'text' || part.kind === 'code' || part.kind === 'report') part.text = text;
  else if (part.kind === 'html') part.html = text;
  else return null;
  msg.updatedAt = ctx.now;
  msg.rev += 1;
  touch(doc, ctx);
  return msg;
}

export const textPart = (text: string): CanvasPart => ({ id: newId('pt'), kind: 'text', state: 'ready', text });

export interface CreateThreadInput {
  title: string;
  kind: CanvasThread['kind'];
  prompt: string;
  /** The card this one was spawned from, for placement only. Omit for `placement: 'below'`. */
  besideEntityId?: string | null;
  /** 'beside' (default) anchors next to `besideEntityId`; 'below' stacks under everything. */
  placement?: 'beside' | 'below';
  /** Flow-space Y to place the new card level with, overriding the jittered default. See `placeBeside`. */
  besideY?: number;
}

function createThread(doc: CanvasDoc, input: CreateThreadInput, ctx: Ctx): { thread: CanvasThread; message: CanvasMessage } {
  const thread: CanvasThread = {
    id: newId('th'), title: input.title, kind: input.kind,
    createdAt: ctx.now, updatedAt: ctx.now, rev: 1,
  };
  doc.threads.push(thread);
  const message = addMessage(doc, { threadId: thread.id, author: { kind: 'human' }, parts: [textPart(input.prompt)] }, ctx);
  if (input.placement === 'below') placeBelowAll(doc, thread.id);
  else placeBeside(doc, thread.id, input.besideEntityId ?? null, DEFAULT_LAYOUT_ID, input.besideY);
  return { thread, message };
}

/** The first send. One root thread, one message (FR-01). */
export function createRootThread(doc: CanvasDoc, prompt: string, ctx: Ctx, title = 'Untitled'): { thread: CanvasThread; message: CanvasMessage } {
  // An unrelated new question isn't a branch off the last thread, so it must not share placeBeside's
  // "beside a source" geometry — the view follows new cards as if they'd branched off whatever
  // they're placed next to, which made a plain new message pan the canvas to the right of the
  // previous reply (bug #067's fix anchored root threads to the last thread to avoid overlap; this
  // fixes the resulting false-branch look by stacking below instead, still never overlapping).
  return createThread(doc, { title, kind: 'root', prompt, placement: 'below' }, ctx);
}

/** Continue appends to the target thread; it never creates one (FR-02). */
export function continueThread(doc: CanvasDoc, threadId: string, prompt: string, ctx: Ctx): CanvasMessage | null {
  if (!doc.threads.some(t => t.id === threadId)) return null;
  return addMessage(doc, { threadId, author: { kind: 'human' }, parts: [textPart(prompt)] }, ctx);
}

export interface FreezeInput {
  kind: SourceKind;
  sourceId: string;
  sourceRev: number;
  anchor: Anchor;
  content: string;
  label: string;
  /** C6. Defaults to a round-robin tone over existing snapshots when omitted. */
  highlightTone?: HighlightTone;
}

/** Freezing is its own step because the evidence must exist before the thread that cites it. */
export function freezeSnapshot(doc: CanvasDoc, input: FreezeInput, ctx: Ctx): SourceSnapshot {
  const snapshot: SourceSnapshot = {
    id: newId('sn'),
    kind: input.kind,
    sourceId: input.sourceId,
    sourceRev: input.sourceRev,
    anchor: input.anchor,
    content: input.content,
    hash: hashText(input.content),
    label: input.label,
    createdAt: ctx.now,
    highlightTone: input.highlightTone ?? HIGHLIGHT_TONES[doc.snapshots.length % HIGHLIGHT_TONES.length],
  };
  doc.snapshots.push(snapshot);
  return snapshot;
}

/** Drops a frozen-but-never-used snapshot — picking (block, whole-card, or free-range) freezes
 * immediately, before the user has committed to sending anything, so a pick that's removed from
 * the tray (an explicit "x", Escape, a pane click, or being replaced by a fresh non-additive pick)
 * would otherwise leave a permanent, dangling highlight in the source text with nothing pointing
 * to it. Safe to call on any snapshot id: a no-op once a relation actually cites it (branched or
 * synthesized from), so an already-used source is never touched. */
export function deleteOrphanSnapshot(doc: CanvasDoc, snapshotId: string): void {
  if (doc.relations.some(r => r.snapshotId === snapshotId)) return;
  const idx = doc.snapshots.findIndex(s => s.id === snapshotId);
  if (idx >= 0) doc.snapshots.splice(idx, 1);
}

/** Freeze a selection inside a Canvas message, which is the common case for Branch. */
export function freezeSelection(doc: CanvasDoc, messageId: string, partId: string, quote: string, start: number, ctx: Ctx): SourceSnapshot | null {
  const msg = doc.messages.find(m => m.id === messageId);
  if (!msg) return null;
  const anchor: TextAnchor = { kind: 'text', messageId, partId, quote, start, end: start + quote.length };
  return freezeSnapshot(doc, {
    kind: 'message', sourceId: messageId, sourceRev: msg.rev, anchor, content: quote,
    label: quote.length > 60 ? `${quote.slice(0, 57)}…` : quote,
  }, ctx);
}

/** Freeze an entire card (every message in a thread) as one source — the "whole card" selection
 * granularity, where there's no single quote to anchor to. */
export function freezeWholeThread(doc: CanvasDoc, threadId: string, ctx: Ctx): SourceSnapshot | null {
  const thread = doc.threads.find(t => t.id === threadId);
  if (!thread) return null;
  const content = threadText(doc, threadId);
  const anchor: WholeAnchor = { kind: 'whole', threadId };
  return freezeSnapshot(doc, {
    kind: 'message', sourceId: threadId, sourceRev: thread.rev, anchor, content,
    label: thread.title,
  }, ctx);
}

export interface BranchInput {
  snapshotId: string;
  prompt: string;
  title?: string;
  /** Flow-space Y to place the new card level with — typically the selected quote's position. */
  besideY?: number;
}

/**
 * Branch creates a new thread linked to one exact snapshot (FR-02, AC-03). The source thread and
 * its descendants are not touched.
 */
export function branchFrom(doc: CanvasDoc, input: BranchInput, ctx: Ctx): { thread: CanvasThread; message: CanvasMessage; relation: Relation } | null {
  const snapshot = doc.snapshots.find(s => s.id === input.snapshotId);
  if (!snapshot) return null;
  const fromThread = doc.messages.find(m => m.id === snapshot.sourceId)?.threadId
    ?? doc.threads.find(t => t.id === snapshot.sourceId)?.id;
  const { thread, message } = createThread(doc, {
    title: input.title ?? snapshot.label,
    kind: 'branch',
    prompt: input.prompt,
    besideEntityId: fromThread ?? null,
    besideY: input.besideY,
  }, ctx);
  const relation: Relation = {
    id: newId('rl'), kind: 'branch',
    fromThreadId: fromThread ?? thread.id, toThreadId: thread.id,
    snapshotId: snapshot.id, createdAt: ctx.now,
  };
  doc.relations.push(relation);
  touch(doc, ctx);
  return { thread, message, relation };
}

export interface SynthesisInput {
  snapshotIds: string[];
  prompt: string;
  title?: string;
  /** Flow-space Y to place the new card level with — typically the last-picked quote's position. */
  besideY?: number;
}

/**
 * Synthesis creates one new thread linked to *every* selected source, with one relation each
 * (FR-03, AC-04). Originals stay intact — nothing about them is read back or rewritten.
 */
export function synthesize(doc: CanvasDoc, input: SynthesisInput, ctx: Ctx): { thread: CanvasThread; message: CanvasMessage; relations: Relation[] } | null {
  const snapshots = input.snapshotIds
    .map(id => doc.snapshots.find(s => s.id === id))
    .filter((s): s is SourceSnapshot => !!s);
  if (snapshots.length < 2) return null;

  const first = snapshots[0];
  const besides = first ? doc.messages.find(m => m.id === first.sourceId)?.threadId ?? null : null;
  const { thread, message } = createThread(doc, {
    title: input.title ?? `Synthesis of ${snapshots.length} sources`,
    kind: 'synthesis',
    prompt: input.prompt,
    besideEntityId: besides,
    besideY: input.besideY,
  }, ctx);

  const relations = snapshots.map<Relation>(s => {
    const fromThreadId = doc.messages.find(m => m.id === s.sourceId)?.threadId ?? thread.id;
    const rel: Relation = {
      id: newId('rl'), kind: 'synthesis', fromThreadId, toThreadId: thread.id,
      snapshotId: s.id, createdAt: ctx.now,
    };
    doc.relations.push(rel);
    return rel;
  });
  touch(doc, ctx);
  return { thread, message, relations };
}

// ---------- runs ----------

export interface StartRunInput {
  submissionId: string;
  threadId: string;
  provider: string;
  model: string;
}

/**
 * Accepting a submission. The same `submissionId` never produces a second accepted run: a
 * double-click, or a refresh that replays the send, finds the existing one (FR-01, AC-10).
 * A retry is an explicit new *attempt* of the same submission.
 */
export function acceptRun(doc: CanvasDoc, input: StartRunInput, ctx: Ctx): { run: CanvasRun; duplicate: boolean } {
  const prior = doc.runs.filter(r => r.submissionId === input.submissionId);
  const live = prior.find(r => r.status === 'accepted' || r.status === 'streaming');
  if (live) return { run: live, duplicate: true };
  const completed = prior.find(r => r.status === 'completed');
  if (completed) return { run: completed, duplicate: true };
  const run: CanvasRun = {
    id: newId('rn'),
    submissionId: input.submissionId,
    attempt: prior.length + 1,
    threadId: input.threadId,
    provider: input.provider,
    model: input.model,
    status: 'accepted',
    startedAt: ctx.now,
  };
  doc.runs.push(run);
  return { run, duplicate: false };
}

export function setRunStatus(doc: CanvasDoc, runId: string, status: RunStatus, ctx: Ctx, extra?: { usage?: RunUsage; error?: string; outputVersionId?: string }): CanvasRun | null {
  const run = doc.runs.find(r => r.id === runId);
  if (!run) return null;
  run.status = status;
  if (extra?.usage) run.usage = extra.usage;
  if (extra?.error) run.error = extra.error;
  if (extra?.outputVersionId) run.outputVersionId = extra.outputVersionId;
  if (status !== 'accepted' && status !== 'streaming') run.endedAt = ctx.now;
  // A terminal run's message is no longer provisional, whatever the outcome: partial text from a
  // cancelled or interrupted run is real and must survive (AC-08).
  if (status !== 'accepted' && status !== 'streaming') {
    for (const m of doc.messages) if (m.producedByRunId === runId) delete m.provisional;
  }
  touch(doc, ctx);
  return run;
}

/** A retry preserves the prior attempt and its partial output; it never edits it. */
export function retryRun(doc: CanvasDoc, runId: string, ctx: Ctx): CanvasRun | null {
  const prior = doc.runs.find(r => r.id === runId);
  if (!prior) return null;
  const run: CanvasRun = {
    id: newId('rn'),
    submissionId: prior.submissionId,
    attempt: doc.runs.filter(r => r.submissionId === prior.submissionId).length + 1,
    threadId: prior.threadId,
    provider: prior.provider,
    model: prior.model,
    status: 'accepted',
    startedAt: ctx.now,
  };
  doc.runs.push(run);
  return run;
}

// ---------- outputs ----------

/**
 * Content identity of a part list, ignoring part ids. Ids are minted per call, so comparing whole
 * parts would make every re-save look like a change and inflate the version history.
 */
const partsFingerprint = (parts: readonly CanvasPart[]): string =>
  checksum(parts.map(p => {
    const rest: Record<string, unknown> = { ...p };
    delete rest['id'];
    return rest;
  }));

/**
 * A new immutable version within a family. Identical content does not create one: re-saving an
 * unchanged report should not inflate its history.
 */
export function saveOutputVersion(doc: CanvasDoc, familyId: string | null, parts: CanvasPart[], ctx: Ctx, producedByRunId?: string): { output: OutputVersion; created: boolean } {
  const family = familyId ?? newId('ov');
  const existing = doc.outputs.filter(o => o.familyId === family).sort((a, b) => a.version - b.version);
  const last = existing[existing.length - 1];
  if (last && partsFingerprint(last.parts) === partsFingerprint(parts)) return { output: last, created: false };
  const output: OutputVersion = {
    id: newId('ov'),
    familyId: family,
    version: (last?.version ?? 0) + 1,
    parts,
    createdAt: ctx.now,
    ...(producedByRunId ? { producedByRunId } : {}),
  };
  doc.outputs.push(output);
  touch(doc, ctx);
  return { output, created: true };
}

/** Ancestor chain of a thread, oldest first. The shape C4's context resolver walks. */
export function ancestorChain(doc: CanvasDoc, threadId: string): string[] {
  const chain: string[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined = threadId;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    chain.unshift(cursor);
    const parent: Relation | undefined = doc.relations.find(r => r.toThreadId === cursor && r.kind === 'branch');
    cursor = parent?.fromThreadId;
  }
  return chain;
}

/** Deleting a card is not deleting content: this removes the thread and everything that cited it. */
export function deleteThread(doc: CanvasDoc, threadId: string, ctx: Ctx): boolean {
  if (!doc.threads.some(t => t.id === threadId)) return false;
  doc.threads = doc.threads.filter(t => t.id !== threadId);
  doc.messages = doc.messages.filter(m => m.threadId !== threadId);
  doc.relations = doc.relations.filter(r => r.fromThreadId !== threadId && r.toThreadId !== threadId);
  for (const l of doc.layouts) delete l.entries[threadId];
  touch(doc, ctx);
  return true;
}

// ---------- C10: context islands (Memory / Files) ----------
// Rules and Outputs have no commands of their own here: Rules is read-only (project-level,
// edited from the Project overview), and Outputs already has `saveOutputVersion` above.

export function addMemoryItem(doc: CanvasDoc, text: string, ctx: Ctx): CanvasMemoryItem {
  const item: CanvasMemoryItem = { id: newId('mi'), text, createdAt: ctx.now };
  (doc.memory ??= []).unshift(item);
  touch(doc, ctx);
  return item;
}

export function editMemoryItem(doc: CanvasDoc, id: string, text: string): void {
  const item = doc.memory?.find(m => m.id === id);
  if (item) item.text = text;
}

export function removeMemoryItem(doc: CanvasDoc, id: string): void {
  if (doc.memory) doc.memory = doc.memory.filter(m => m.id !== id);
}

export function addFileRef(doc: CanvasDoc, input: Omit<CanvasFileRef, 'id' | 'createdAt'>, ctx: Ctx): CanvasFileRef {
  const ref: CanvasFileRef = { id: newId('cf'), createdAt: ctx.now, ...input };
  (doc.files ??= []).unshift(ref);
  touch(doc, ctx);
  return ref;
}

export function removeFileRef(doc: CanvasDoc, id: string): void {
  if (doc.files) doc.files = doc.files.filter(f => f.id !== id);
}

export { messageText };
