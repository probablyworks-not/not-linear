import { useAppStore } from '../state/app-store';
import { useUiStore } from '../state/ui-store';
import { toast } from '../ui/toast';
import { confirmDeleteBranch } from '../ui/confirm-copy';
import { useBranchStore, openList, type OpenBranch } from './branch-store';
import {
  captureSnapshotIn, rememberRecentIn, removeBranchRecordsIn, type BranchContent, type BranchSpec,
} from '../db/branch-ops';
import { BLANK_DOC_CONTENT, resolveThreadTitle } from '../db/thread-ops';
import { branchDeleteTargets, branchRowsForThread, depthBelow, type BranchRow } from '../chat/branch-model';
import { esc } from '../lib/markdown';
import { MODELS } from '../settings/options';
import { abortBranchStream } from './controllers';
import type { PersistedBranchSnapshot, PersistedState, PersistedThread } from '../db/types';

// What happens when a panel opens, closes, or is deleted: the store change AND the write.
// Ported from app.js openBranch :3341, closeBranch :3812, the close-others pair, promoteBranch
// :4143, deleteBranch :3951. Rules worth knowing before touching any of it:
//
//  * opening an already-open branch re-focuses it and never makes a second panel (#002/#003);
//  * opening a child keeps its open ancestors (blurred, behind) and closes everything else;
//  * every close writes the branch's snapshot FIRST (#008/#009). Content is already saved as
//    it arrives, so this is the recents touch plus the guard against an empty overwrite.

const CLOSE_MS = 180;

export function titleFromQuote(q: string): string {
  const s = String(q ?? '');
  return s.length > 36 ? s.slice(0, 35).trim() + '…' : s; // app.js:104 truncate(q, 36)
}

const MODEL_IDS = new Set(MODELS.map(m => m.id));

/** app.js:964 branchModelPref: a branch keeps its own model once it has one; otherwise it follows the default. */
export function branchModelPref(b: { modelPref?: string | null } | undefined, defaultPref: string | undefined): string {
  return b?.modelPref && MODEL_IDS.has(b.modelPref) ? b.modelPref : (defaultPref || 'sonnet');
}

export function specOf(b: OpenBranch): BranchSpec {
  return {
    id: b.id, parentBid: b.parentBid, anchorBid: b.anchorBid, quote: b.quote, depth: b.depth, createdAt: b.createdAt,
    touchedAt: b.touchedAt, mainTurnId: b.mainTurnId, mainTurnPrompt: b.mainTurnPrompt, modelPref: b.modelPref,
  };
}

/** The branch's saved content, or an empty body. Content is written as it arrives, so this is current. */
export function contentOf(thread: PersistedThread, id: string): BranchContent {
  const s = thread.branchSnapshots?.[id];
  return {
    bodyHTML: s?.bodyHTML ?? '', messages: (s?.messages ?? []) as BranchContent['messages'],
    tokenIn: s?.tokenIn ?? 0, tokenCacheHit: s?.tokenCacheHit ?? 0, tokenOut: s?.tokenOut ?? 0, cost: s?.cost ?? 0,
    provider: s?.provider, model: s?.model,
  };
}

async function mutate<T>(fn: (state: PersistedState) => T): Promise<T | null> {
  return useAppStore.getState().updateThreads(fn);
}

/** Snapshots (and remembers) every branch in `ids`, in ONE write. Returns when it is saved. */
async function capture(branches: readonly OpenBranch[], force: boolean): Promise<void> {
  if (!branches.length) return;
  const now = Date.now();
  await mutate(state => {
    for (const b of branches) {
      const t = state.threads[b.threadId];
      if (t) captureSnapshotIn(t, specOf(b), contentOf(t, b.id), { force, now });
    }
  });
}

/** Re-reads what a snapshot knows about a branch into the open panel (app.js:3221 applyBranchSnapshot). */
export function patchFromSnapshot(b: OpenBranch, snap: PersistedBranchSnapshot, openParentDepth: number | undefined): Partial<OpenBranch> {
  const parentBid = snap.parentBid || b.parentBid || null;
  const inherited = parentBid && openParentDepth != null ? openParentDepth + 1 : null;
  const snapDepth = Number(snap.depth) > 0 ? Number(snap.depth) : 0;
  const curDepth = Number(b.depth) > 0 ? Number(b.depth) : 0;
  return {
    parentBid,
    anchorBid: snap.anchorBid || b.anchorBid,
    quote: snap.quote || b.quote,
    depth: inherited || (parentBid ? Math.max(curDepth, snapDepth) : 1) || 1,
    createdAt: snap.createdAt || b.createdAt,
    touchedAt: Math.max(b.touchedAt || 0, snap.touchedAt || 0),
    mainTurnId: snap.mainTurnId || b.mainTurnId || null,
    mainTurnPrompt: snap.mainTurnPrompt || b.mainTurnPrompt || '',
    modelPref: snap.modelPref && MODEL_IDS.has(snap.modelPref) ? snap.modelPref : (b.modelPref || null),
  };
}

// ---------- open ----------

export interface OpenArgs {
  threadId: string;
  quote: string;
  parentBranchId?: string | null;
  /** New from a selection, as opposed to reopened from saved state. */
  fresh?: boolean;
  bid?: string | null;
  anchorBid?: string | null;
  collapsed?: boolean;
  depth?: number | null;
  mainTurnId?: string | null;
  mainTurnPrompt?: string;
}

/** Closes every open panel but `keepId`, snapshotting each first and removing it at once. */
function closeOthers(keepId: string | null): void {
  const gone = openList().filter(b => b.id !== keepId);
  void capture(gone, true);
  for (const b of gone) useBranchStore.getState().remove(b.id);
  if (keepId && useBranchStore.getState().open[keepId]) useBranchStore.getState().setActive(keepId);
}

/** Keeps `keepAncestorId` and its open ancestors (stacked behind the new child); closes the rest. */
function closeUnrelated(keepAncestorId: string): void {
  const { open } = useBranchStore.getState();
  const keep = new Set<string>();
  let cursor: string | null = keepAncestorId;
  while (cursor && open[cursor] && !keep.has(cursor)) { keep.add(cursor); cursor = open[cursor]!.parentBid; }
  const gone = openList().filter(b => !keep.has(b.id));
  void capture(gone, true);
  for (const b of gone) useBranchStore.getState().remove(b.id);
}

/**
 * The single entry point for opening a panel: brand new, reopened from an anchor, the recents
 * list or a highlight, or already open (then it is just re-focused, in place).
 */
export function openBranch(a: OpenArgs): string {
  const store = useBranchStore.getState();
  const app = useAppStore.getState();
  const id = a.bid || a.anchorBid || ('br' + Date.now());
  const existing = store.open[id];

  if (existing) {
    const parentBid = a.parentBranchId || existing.parentBid || null;
    const parent = parentBid ? store.open[parentBid] : undefined;
    closeOthers(id);
    store.patch(id, {
      parentBid,
      anchorBid: a.anchorBid || existing.anchorBid || id,
      depth: depthBelow(parent?.depth, !!parentBid, a.depth ?? existing.depth),
    });
    store.setActive(id);
    void touchRecent(id);
    return id;
  }

  const parent = a.parentBranchId ? store.open[a.parentBranchId] : undefined;
  if (parent) closeUnrelated(a.parentBranchId!);
  else closeOthers(null);

  const now = Date.now();
  const branch: OpenBranch = {
    id,
    threadId: a.threadId,
    parentBid: a.parentBranchId || null,
    anchorBid: a.anchorBid || id,
    quote: a.quote,
    depth: depthBelow(parent?.depth, !!a.parentBranchId, a.depth ?? null),
    createdAt: now,
    touchedAt: now,
    mainTurnId: a.mainTurnId ?? null,
    mainTurnPrompt: a.mainTurnPrompt ?? '',
    modelPref: branchModelPref(parent, app.prefs.model),
    collapsed: !!a.collapsed,
    reader: false,
    userSized: false,
    entering: true,
  };
  useBranchStore.getState().put(branch);
  useBranchStore.getState().setActive(id);
  // Next frame: drop the "entering" state so the CSS transition plays.
  requestAnimationFrame(() => useBranchStore.getState().patch(id, { entering: false }));
  void touchRecent(id);
  return id;
}

/** Writes the recents row for an open branch (app.js rememberBranchRecent). */
export async function touchRecent(id: string): Promise<void> {
  const b = useBranchStore.getState().open[id];
  if (!b) return;
  const now = Date.now();
  await mutate(state => {
    const t = state.threads[b.threadId];
    if (!t) return;
    const row = rememberRecentIn(t, specOf(b), now);
    useBranchStore.getState().patch(id, { createdAt: row.createdAt, touchedAt: row.touchedAt });
  });
}

// ---------- model ----------

/** The branch's own model (ADR-045): changes this panel only, and is saved with the branch. */
export async function setBranchModelPref(id: string, value: string): Promise<void> {
  const b = useBranchStore.getState().open[id];
  if (!b || !MODEL_IDS.has(value)) return;
  useBranchStore.getState().patch(id, { modelPref: value });
  const next = useBranchStore.getState().open[id]!;
  await capture([next], true);
}

// ---------- close ----------

/** Snapshot first, then animate out (app.js:3812). */
export async function closeBranch(id: string): Promise<void> {
  const b = useBranchStore.getState().open[id];
  if (!b || b.closing) return;
  useBranchStore.getState().patch(id, { closing: true });
  const parentBid = b.parentBid;
  await capture([b], true);
  await new Promise(r => setTimeout(r, CLOSE_MS));
  const store = useBranchStore.getState();
  const wasActive = store.activeId === id;
  store.remove(id);
  if (wasActive) {
    const after = useBranchStore.getState();
    after.setActive(parentBid && after.open[parentBid] ? parentBid : null);
  }
}

export async function closeAllBranches(): Promise<void> {
  await Promise.all(openList().map(b => closeBranch(b.id)));
}

/** Leaving a thread: snapshot and drop every panel at once, no animation. */
export async function dropAllBranches(): Promise<void> {
  const all = openList();
  all.forEach(b => abortBranchStream(b.id));
  await capture(all, true);
  useBranchStore.getState().clear();
}

// ---------- collapse / reader / size ----------

/** Expanding one collapses the rest; collapsing leaves reader mode (app.js:3777). */
export function toggleCollapse(id: string): void {
  const store = useBranchStore.getState();
  const b = store.open[id];
  if (!b) return;
  if (b.collapsed) {
    for (const o of openList()) if (o.id !== id && !o.collapsed) store.patch(o.id, { collapsed: true });
  }
  const collapsed = !b.collapsed;
  store.patch(id, { collapsed, ...(collapsed && b.reader ? { reader: false } : {}) });
  store.setActive(store.activeId); // re-run stacking
}

/** `measured` is the panel's current size, used the first time reader mode opens it. */
export function toggleReader(id: string, measured?: { width: number; height: number }): void {
  const store = useBranchStore.getState();
  const b = store.open[id];
  if (!b) return;
  const next = !b.reader;
  for (const o of openList()) if (o.reader && o.id !== id) store.patch(o.id, { reader: false });
  const patch: Partial<OpenBranch> = { reader: next, collapsed: false };
  if (next && !b.height && measured) {
    patch.width = Math.max(measured.width, 620);
    patch.height = Math.max(measured.height, 480);
    patch.userSized = true;
  }
  store.patch(id, patch);
  store.setActive(id);
}

// ---------- delete ----------

export async function deleteBranch(id: string, threadId: string): Promise<boolean> {
  const state = useAppStore.getState();
  const thread = state.threadState[threadId];
  if (!thread) return false;
  const open = openList().filter(b => b.threadId === threadId);
  const rows = branchRowsForThread(thread, open);
  const ids = branchDeleteTargets(rows, id);
  const row = rows.find(r => r.id === id);
  const title = titleFromQuote(open.find(b => b.id === id)?.quote || row?.quote || thread.branchSnapshots?.[id]?.quote || thread.branchRecents?.[id]?.quote || 'Untitled branch');
  if (!(await useUiStore.getState().askConfirm(confirmDeleteBranch(title, ids.size)))) return false;
  for (const gone of ids) {
    abortBranchStream(gone);
    useBranchStore.getState().remove(gone);
  }
  await mutate(s => { const t = s.threads[threadId]; if (t) removeBranchRecordsIn(t, ids); });
  toast(ids.size > 1 ? 'Branches deleted' : 'Branch deleted');
  return true;
}

// ---------- promote ----------

export interface MainSnapshot { title: string; h1HTML: string; eyebrow: string; chatHTML: string; messages: Array<{ role: string; content: string }> }

/** What the breadcrumb shows for this thread (app.js renderThread :1347). */
export function crumbTitleOf(thread: PersistedThread | undefined, fallback: string): string {
  const base = resolveThreadTitle(thread, fallback);
  const history = Array.isArray(thread?.mainHistory) ? thread!.mainHistory : [];
  return history.length ? ((thread?.promotedCrumbTitle as string | undefined) || base) : base;
}

/** app.js:3248 captureMainState. */
export function captureMain(thread: PersistedThread, fallbackTitle: string): MainSnapshot {
  return {
    title: crumbTitleOf(thread, fallbackTitle),
    h1HTML: typeof thread.h1 === 'string' ? thread.h1 : esc(crumbTitleOf(thread, fallbackTitle)),
    eyebrow: typeof thread.eyebrow === 'string' ? thread.eyebrow : '',
    chatHTML: typeof thread.stream === 'string' ? thread.stream : '',
    messages: ((thread.mainMessages ?? []) as MainSnapshot['messages']).map(m => ({ ...m })),
  };
}

/**
 * "Make this the main thread" (app.js:4143): the thread now shows this branch's conversation,
 * and the previous main state goes onto `mainHistory` so the breadcrumb can return to it.
 * Written in ONE step, before the panel closes, so closeBranch's own save cannot race it.
 */
export async function promoteBranch(id: string, fallbackTitle: string): Promise<void> {
  const b = useBranchStore.getState().open[id];
  if (!b) return;
  const title = titleFromQuote(b.quote);
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  await mutate(state => {
    const t = state.threads[b.threadId];
    if (!t) return;
    const body = contentOf(t, id);
    const history = Array.isArray(t.mainHistory) ? [...t.mainHistory as MainSnapshot[]] : [];
    history.push(captureMain(t, fallbackTitle));
    t.mainHistory = history;
    t.h1 = `Now exploring: <span class="accent">${esc(title)}</span>`;
    t.eyebrow = 'Promoted from branch · ' + time;
    t.docContent = BLANK_DOC_CONTENT;
    t.stream = body.bodyHTML;
    t.mainMessages = body.messages.map(m => ({ ...m }));
    t.promotedCrumbTitle = title;
  });
  await closeBranch(id);
  toast('Branch promoted to main thread');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/** Breadcrumb click (app.js:3276 restoreMain): back to an earlier main state, dropping everything after it. */
export async function restoreMain(threadId: string, idx: number): Promise<void> {
  await mutate(state => {
    const t = state.threads[threadId];
    const history = (Array.isArray(t?.mainHistory) ? t!.mainHistory : []) as MainSnapshot[];
    const snap = history[idx];
    if (!t || !snap) return;
    t.h1 = snap.h1HTML;
    t.eyebrow = snap.eyebrow;
    t.stream = snap.chatHTML;
    if (snap.messages) t.mainMessages = snap.messages.map(m => ({ ...m }));
    const kept = history.slice(0, idx).map(s => ({ ...s }));
    t.mainHistory = kept;
    if (kept.length === 0) { t.title = snap.title; delete t.promotedCrumbTitle; }
    else t.promotedCrumbTitle = snap.title;
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

export type { BranchRow };
