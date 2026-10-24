import { checksum, hashText, newId } from '../ids';
import { messageText } from '../anchors';
import {
  DEFAULT_LAYOUT_ID, type Anchor, type Author, type CanvasDoc, type CanvasMessage, type CanvasPart,
  type CanvasRun, type CanvasThread, type Layout, type OutputVersion, type Relation,
  type RunStatus, type RunUsage, type SourceKind, type SourceSnapshot, type TextAnchor,
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

/**
 * New cards go beside their source with vertical jitter and **nothing else moves** (FR-06). The
 * jitter is derived from the id, not Math.random, so the same branch lands in the same place on
 * re-import and a test can assert it.
 */
export function placeBeside(doc: CanvasDoc, entityId: string, sourceEntityId: string | null, layoutId = DEFAULT_LAYOUT_ID): void {
  const layout = layoutOf(doc, layoutId);
  const src = sourceEntityId ? layout.entries[sourceEntityId] : undefined;
  const jitter = ((hashText(entityId).charCodeAt(0) % 9) - 4) * 10;
  layout.entries[entityId] = src
    ? { entityId, x: src.x + src.w + GAP_X, y: src.y + jitter, w: NODE_W, h: NODE_H }
    : { entityId, x: 0, y: 0, w: NODE_W, h: NODE_H };
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
  /** The card this one was spawned from, for placement only. */
  besideEntityId?: string | null;
}

function createThread(doc: CanvasDoc, input: CreateThreadInput, ctx: Ctx): { thread: CanvasThread; message: CanvasMessage } {
  const thread: CanvasThread = {
    id: newId('th'), title: input.title, kind: input.kind,
    createdAt: ctx.now, updatedAt: ctx.now, rev: 1,
  };
  doc.threads.push(thread);
  const message = addMessage(doc, { threadId: thread.id, author: { kind: 'human' }, parts: [textPart(input.prompt)] }, ctx);
  placeBeside(doc, thread.id, input.besideEntityId ?? null);
  return { thread, message };
}

/** The first send. One root thread, one message (FR-01). */
export function createRootThread(doc: CanvasDoc, prompt: string, ctx: Ctx, title = 'Untitled'): { thread: CanvasThread; message: CanvasMessage } {
  return createThread(doc, { title, kind: 'root', prompt, besideEntityId: null }, ctx);
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
  };
  doc.snapshots.push(snapshot);
  return snapshot;
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

export interface BranchInput {
  snapshotId: string;
  prompt: string;
  title?: string;
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

export { messageText };
