import { unwrapMarksInHTML } from '../chat/anchor';
import { refreshMarksV2 } from '../chat/marks-v2';
import { replaceMessage, type MessageRef } from '../chat/stream-html';
import { cleanThreadTitle } from './thread-ops';
import type { ChatMessage } from '../providers/types';
import type { PersistedBranchRecent, PersistedBranchSnapshot, PersistedHighlight, PersistedThread } from './types';

// Every change to a thread's branches and highlights, as a pure mutation of the thread
// object. Ported from app.js (the name of each source is on the function) so that what
// React writes is what legacy would have written, field for field. Nothing here opens a
// database; db/chat-repo does that, once per write.
//
// Anything that can change a mark ends by calling refreshMarksV2, so `highlightsV2` never
// outlives the spans it indexes.

const text = (s: unknown): string => cleanThreadTitle(s, '');

/** The identity of a branch: what its panel, its recents row and its snapshot all share. */
export interface BranchSpec {
  id: string;
  parentBid: string | null;
  anchorBid: string;
  quote: string;
  depth: number;
  createdAt: number;
  touchedAt: number;
  mainTurnId: string | null;
  mainTurnPrompt: string;
  modelPref: string | null;
}

/** The parts of a branch that change as it is used. */
export interface BranchContent {
  bodyHTML: string;
  messages: ChatMessage[];
  tokenIn: number;
  tokenCacheHit: number;
  tokenOut: number;
  cost: number;
  provider?: string;
  model?: string;
}

/** app.js:2218 ensureThreadBranchState. */
export function ensureBranchState(thread: PersistedThread): void {
  if (!Array.isArray(thread.highlights)) thread.highlights = [];
  if (!thread.branchSnapshots || typeof thread.branchSnapshots !== 'object') thread.branchSnapshots = {};
  if (!thread.branchRecents || typeof thread.branchRecents !== 'object' || Array.isArray(thread.branchRecents)) thread.branchRecents = {};
}

/** app.js:3181 rememberBranchRecent. Returns the row it wrote. */
export function rememberRecentIn(thread: PersistedThread, spec: BranchSpec, now: number): PersistedBranchRecent {
  ensureBranchState(thread);
  const previous = thread.branchRecents![spec.id];
  const row: PersistedBranchRecent = {
    id: spec.id,
    quote: spec.quote || previous?.quote || 'Untitled branch',
    parentBid: spec.parentBid || previous?.parentBid || null,
    anchorBid: spec.anchorBid || previous?.anchorBid || spec.id,
    depth: spec.depth || previous?.depth || 1,
    createdAt: previous?.createdAt || spec.createdAt || now,
    touchedAt: now,
    mainTurnId: spec.mainTurnId || previous?.mainTurnId || null,
    mainTurnPrompt: spec.mainTurnPrompt || previous?.mainTurnPrompt || '',
  };
  thread.branchRecents![spec.id] = row;
  return row;
}

/** app.js:2271 and :2278: does this much content deserve a snapshot? */
export function hasPersistableContent(messages: readonly { content?: unknown }[], bodyHTML: string): boolean {
  if (messages.some(m => text(m?.content))) return true;
  const holder = document.createElement('div');
  holder.innerHTML = bodyHTML || '';
  return !!text(holder.textContent);
}

export function branchHasHighlights(thread: PersistedThread, id: string): boolean {
  return (thread.highlights ?? []).some(h => h.source === 'branch' && h.branchId === id);
}

/**
 * app.js:2286 captureBranchSnapshot. Writes (or refreshes) the branch's snapshot, and its
 * recents row. A branch with nothing in it and nothing highlighted is NOT snapshotted
 * unless `force`, and a snapshot that has content is never overwritten by an empty one:
 * that second guard is bug #009's fix. Returns whether a snapshot was written.
 */
export function captureSnapshotIn(
  thread: PersistedThread, spec: BranchSpec, content: BranchContent, opts: { force?: boolean; now: number },
): boolean {
  ensureBranchState(thread);
  const recent = rememberRecentIn(thread, spec, opts.now);
  const previous = thread.branchSnapshots![spec.id];
  const hasContent = hasPersistableContent(content.messages, content.bodyHTML);
  const highlighted = branchHasHighlights(thread, spec.id);
  if (!opts.force && !previous && !highlighted && !hasContent) return false;
  if (previous && hasPersistableContent(previous.messages ?? [], previous.bodyHTML ?? '') && !hasContent && !highlighted) return false;
  const snap: PersistedBranchSnapshot = {
    id: spec.id,
    parentBid: spec.parentBid || null,
    anchorBid: spec.anchorBid || spec.id,
    quote: spec.quote || '',
    depth: spec.depth || 1,
    createdAt: previous?.createdAt || recent.createdAt || opts.now,
    touchedAt: recent.touchedAt || opts.now,
    mainTurnId: spec.mainTurnId || previous?.mainTurnId || null,
    mainTurnPrompt: spec.mainTurnPrompt || previous?.mainTurnPrompt || '',
    bodyHTML: content.bodyHTML,
    messages: content.messages.map(m => ({ ...m })),
    tokenIn: content.tokenIn || 0,
    tokenCacheHit: content.tokenCacheHit || 0,
    tokenOut: content.tokenOut || 0,
    cost: content.cost || 0,
    provider: content.provider,
    model: content.model,
    modelPref: spec.modelPref || null,
  };
  thread.branchSnapshots![spec.id] = snap;
  refreshMarksV2(thread);
  return true;
}

/** Where a mark was just wrapped: the main stream, or a branch panel's body. */
export type MarkTarget =
  | { scope: 'stream'; message: MessageRef }
  | { scope: 'branch'; branchId: string; message: MessageRef };

/**
 * Saves a message whose DOM has just had a mark wrapped into it. `messageInnerHTML` is that
 * one message's content, so the rest of the stream or panel (and any reply still arriving) is
 * untouched. Returns false if the message is gone.
 */
export function commitMarkedMessage(thread: PersistedThread, target: MarkTarget, messageInnerHTML: string): boolean {
  if (target.scope === 'stream') {
    const next = replaceMessage(typeof thread.stream === 'string' ? thread.stream : '', target.message, messageInnerHTML);
    if (next === null) return false;
    thread.stream = next;
  } else {
    const snap = thread.branchSnapshots?.[target.branchId];
    if (!snap) return false;
    const next = replaceMessage(snap.bodyHTML || '', target.message, messageInnerHTML);
    if (next === null) return false;
    snap.bodyHTML = next;
  }
  refreshMarksV2(thread);
  return true;
}

/** app.js:2342 saveHighlightSelection's bookkeeping: add the record, keeping `highlights` an array. */
export function addHighlightIn(thread: PersistedThread, item: PersistedHighlight): void {
  ensureBranchState(thread);
  thread.highlights!.push(item);
  refreshMarksV2(thread);
}

/** app.js:2627 removeHighlightMarkupFromState. */
function unwrapHighlightsEverywhere(thread: PersistedThread, ids: ReadonlySet<string>): void {
  if (typeof thread.docContent === 'string') thread.docContent = unwrapMarksInHTML(thread.docContent, 'highlight', ids);
  if (typeof thread.stream === 'string') thread.stream = unwrapMarksInHTML(thread.stream, 'highlight', ids);
  for (const snap of Object.values(thread.branchSnapshots ?? {})) snap.bodyHTML = unwrapMarksInHTML(snap.bodyHTML, 'highlight', ids);
}

/**
 * app.js:2635 removeHighlight. Returns the removed record. A branch whose last reason to
 * be snapshotted was this highlight loses its snapshot too (unless it is still in recents).
 */
export function removeHighlightIn(thread: PersistedThread, id: string): PersistedHighlight | null {
  ensureBranchState(thread);
  const h = thread.highlights!.find(item => item.id === id);
  if (!h) return null;
  thread.highlights = thread.highlights!.filter(item => item.id !== id);
  unwrapHighlightsEverywhere(thread, new Set([id]));
  if (h.source === 'branch' && h.branchId && !thread.branchRecents![h.branchId]
    && !thread.highlights.some(item => item.source === 'branch' && item.branchId === h.branchId)) {
    delete thread.branchSnapshots![h.branchId];
  }
  refreshMarksV2(thread);
  return h;
}

/**
 * app.js:3898 removeBranchRecords. Permanent: the branches in `ids`, their highlights, the
 * anchors that opened them, their snapshots and their recents rows.
 */
export function removeBranchRecordsIn(thread: PersistedThread, ids: ReadonlySet<string>): void {
  ensureBranchState(thread);
  const gone = new Set(thread.highlights!.filter(h => h.source === 'branch' && h.branchId && ids.has(h.branchId)).map(h => h.id));
  unwrapHighlightsEverywhere(thread, gone);
  thread.highlights = thread.highlights!.filter(h => !(h.source === 'branch' && h.branchId && ids.has(h.branchId)));
  if (typeof thread.docContent === 'string') thread.docContent = unwrapMarksInHTML(thread.docContent, 'branch', ids);
  if (typeof thread.stream === 'string') thread.stream = unwrapMarksInHTML(thread.stream, 'branch', ids);
  for (const snap of Object.values(thread.branchSnapshots!)) snap.bodyHTML = unwrapMarksInHTML(snap.bodyHTML, 'branch', ids);
  for (const id of ids) {
    delete thread.branchSnapshots![id];
    delete thread.branchRecents![id];
  }
  refreshMarksV2(thread);
}
