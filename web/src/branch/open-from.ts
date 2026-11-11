import { useAppStore } from '../state/app-store';
import { useUiStore } from '../state/ui-store';
import { selectThread } from '../state/actions';
import { toast } from '../ui/toast';
import { useBranchStore } from './branch-store';
import { openBranch, patchFromSnapshot, toggleCollapse, touchRecent, titleFromQuote } from './actions';
import { openWhenMounted } from './pending';
import { branchRowsForThread, depthBelow, type BranchRow } from '../chat/branch-model';
import type { PersistedHighlight } from '../db/types';

// The ways a branch gets reopened from something that remembers it: an anchor in the text
// (app.js:4172), a row in the sidebar or context list (:5863), a saved highlight (:2523).
// All of them funnel into openBranch, which is idempotent for a panel that is already open.

const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();
const esc = (id: string): string => (typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(id) : id.replace(/["\\]/g, '\\$&'));

export function anchorElements(id: string, root: ParentNode = document): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(`.branched[data-bid="${esc(id)}"]`)];
}

/** What the anchor's words say (app.js:2599), across all the spans one multi-node selection became. */
export function anchorText(id: string, root: ParentNode = document): string {
  return anchorElements(id, root).map(el => squash(el.textContent ?? '')).filter(Boolean).join(' ');
}

function flash(id: string): void {
  useBranchStore.getState().flashPanel(id);
}

function expandAndFocus(id: string): void {
  const store = useBranchStore.getState();
  if (store.open[id]?.collapsed) toggleCollapse(id);
  store.setActive(id);
  flash(id);
}

/** Click on a `.branched` span in the stream or inside a panel. */
export function openBranchFromAnchor(threadId: string, anchor: HTMLElement, sourceBranchId: string | null): void {
  const id = anchor.dataset.bid;
  if (!id) return;
  const snap = useAppStore.getState().threadState[threadId]?.branchSnapshots?.[id];
  const parentBranchId = snap?.parentBid || sourceBranchId || null;
  const store = useBranchStore.getState();
  const existing = store.open[id];
  if (existing) {
    const parentBid = parentBranchId || existing.parentBid || null;
    const parent = parentBid ? store.open[parentBid] : undefined;
    store.patch(id, { parentBid, depth: depthBelow(parent?.depth, !!parentBid, snap?.depth || existing.depth) });
    if (snap) store.patch(id, patchFromSnapshot(useBranchStore.getState().open[id]!, snap, parent?.depth));
    expandAndFocus(id);
    return;
  }
  openBranch({
    threadId, quote: snap?.quote || anchorText(id) || squash(anchor.textContent ?? ''), parentBranchId,
    fresh: !snap, bid: id, anchorBid: snap?.anchorBid || id, depth: snap?.depth || null,
  });
  if (snap) patchOpenFromSnapshot(id, snap);
  flash(id);
}

function patchOpenFromSnapshot(id: string, snap: NonNullable<ReturnType<typeof snapshotOf>>): void {
  const store = useBranchStore.getState();
  const b = store.open[id];
  if (!b) return;
  const parent = b.parentBid ? store.open[b.parentBid] : undefined;
  store.patch(id, patchFromSnapshot(b, snap, parent?.depth));
}
function snapshotOf(threadId: string, id: string) {
  return useAppStore.getState().threadState[threadId]?.branchSnapshots?.[id];
}

/** A row in "Recent branches" (or the context list): open it, in whichever thread it belongs to. */
export function openBranchRow(tid: string, row: BranchRow): void {
  const app = useAppStore.getState();
  if (tid !== useUiStore.getState().activeTabId || app.currentThreadId !== tid) {
    openWhenMounted(tid, () => openBranchRow(tid, row));
    void selectThread(tid);
    return;
  }
  const snap = snapshotOf(tid, row.id);
  const store = useBranchStore.getState();
  const existing = store.open[row.id];
  if (existing) {
    const parentBid = row.parentBid || snap?.parentBid || existing.parentBid || null;
    const parent = parentBid ? store.open[parentBid] : undefined;
    store.patch(row.id, { parentBid, depth: depthBelow(parent?.depth, !!parentBid, row.depth || snap?.depth || existing.depth) });
    if (snap) patchOpenFromSnapshot(row.id, snap);
    expandAndFocus(row.id);
    void touchRecent(row.id);
  } else {
    const anchor = anchorElements(row.anchorBid || row.id)[0] ?? anchorElements(row.id)[0];
    openBranch({
      threadId: tid, quote: row.quote || snap?.quote || squash(anchor?.textContent ?? '') || 'Untitled branch',
      parentBranchId: row.parentBid || snap?.parentBid || null, bid: row.id,
      anchorBid: row.anchorBid || snap?.anchorBid || row.id, depth: row.depth || snap?.depth || null,
    });
    if (snap) patchOpenFromSnapshot(row.id, snap);
    flash(row.id);
  }
  anchorElements(row.anchorBid || row.id)[0]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

// ---------- highlights ----------

export function findHighlight(id: string): PersistedHighlight | null {
  for (const t of Object.values(useAppStore.getState().threadState)) {
    const found = t?.highlights?.find(h => h.id === id);
    if (found) return found;
  }
  return null;
}

function flashMark(el: HTMLElement): void {
  el.classList.add('focused-highlight');
  setTimeout(() => el.classList.remove('focused-highlight'), 900);
}

function openBranchForHighlight(h: PersistedHighlight): string | null {
  const snap = snapshotOf(h.threadId, h.branchId ?? '');
  const existed = !!useBranchStore.getState().open[h.branchId ?? ''];
  const id = openBranch({
    threadId: h.threadId,
    quote: snap?.quote || h.branchQuote || h.text || 'Untitled branch',
    parentBranchId: snap?.parentBid || h.parentBranchId || null,
    bid: h.branchId, anchorBid: snap?.anchorBid || h.anchorBid || h.branchId, collapsed: false,
    depth: snap?.depth || h.depth || null,
  });
  const store = useBranchStore.getState();
  store.patch(id, { threadId: h.threadId, collapsed: false });
  if (!existed && snap) patchOpenFromSnapshot(id, snap);
  store.setActive(id);
  return id;
}

function focusHighlightSource(h: PersistedHighlight): void {
  if (h.source === 'branch') {
    const id = openBranchForHighlight(h);
    setTimeout(() => {
      const panel = id ? document.querySelector<HTMLElement>(`.branch[data-bid="${esc(id)}"]`) : null;
      const target = panel?.querySelector<HTMLElement>(`.highlighted[data-hid="${esc(h.id)}"]`);
      if (target) { target.scrollIntoView({ block: 'center', behavior: 'smooth' }); flashMark(target); }
      else if (id) { flash(id); toast('Opened source branch'); }
    }, 120);
    return;
  }
  const target = document.querySelector<HTMLElement>(`[data-chat-stream] .highlighted[data-hid="${esc(h.id)}"]`);
  if (target) { target.scrollIntoView({ block: 'center', behavior: 'smooth' }); flashMark(target); }
  else toast('Source text is no longer on this page');
}

export function goToHighlight(id: string): void {
  const h = findHighlight(id);
  if (!h) return;
  useUiStore.getState().setHighlightsOpen(false);
  if (h.threadId !== useAppStore.getState().currentThreadId) {
    openWhenMounted(h.threadId, () => requestAnimationFrame(() => focusHighlightSource(h)));
    void selectThread(h.threadId);
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(() => focusHighlightSource(h)));
}

export { titleFromQuote };

/** The "back to parent" arrow: reopen this branch's parent (app.js:2488). */
export function openParentBranch(threadId: string, id: string): void {
  const store = useBranchStore.getState();
  const b = store.open[id];
  if (!b?.parentBid) return;
  const thread = useAppStore.getState().threadState[threadId];
  const rows = branchRowsForThread(thread, Object.values(store.open).filter(o => o.threadId === threadId));
  const row = rows.find(r => r.id === b.parentBid);
  if (!row) { toast('Parent branch is no longer available'); return; }
  openBranchRow(threadId, row);
}
