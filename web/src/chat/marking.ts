import { useAppStore } from '../state/app-store';
import { useBranchStore } from '../branch/branch-store';
import { openBranch, specOf, contentOf, titleFromQuote } from '../branch/actions';
import { addHighlightIn, captureSnapshotIn, commitMarkedMessage, removeHighlightIn, type MarkTarget } from '../db/branch-ops';
import { makeBranchId, makeHighlightId, wrapRangeTextSegments } from './anchor';
import { messageRefOf, type SelectionInfo } from './selection';
import { toast } from '../ui/toast';
import type { PersistedHighlight, PersistedState } from '../db/types';

// Turning a selection into a highlight or a branch anchor. The mark is wrapped into the live
// DOM first (the same wrapRangeTextSegments legacy uses), then every message it landed in is
// saved. Saving is per message, never the whole stream: a reply still arriving, and anything
// else already saved, is not touched.

const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();

function targetFor(sel: SelectionInfo, msg: HTMLElement): MarkTarget {
  const message = messageRefOf(msg);
  return sel.scope === 'branch' ? { scope: 'branch', branchId: sel.branchId!, message } : { scope: 'stream', message };
}

/** Wraps `kind`'s span around the selection, then saves each touched message. Throws if nothing could be wrapped. */
async function wrapAndSave(
  threadId: string, sel: SelectionInfo, kind: 'highlight' | 'branch', id: string,
  after?: (state: PersistedState) => void,
): Promise<void> {
  wrapRangeTextSegments(sel.range, kind === 'highlight'
    ? { className: 'highlighted', datasetKey: 'hid', id }
    : { className: 'branched', datasetKey: 'bid', id });
  // The DOM is now the truth; read each message back out of it (content only: the element keeps its saved attributes).
  const saves = sel.messages.map(msg => ({ target: targetFor(sel, msg), html: msg.innerHTML }));
  await useAppStore.getState().updateThreads(state => {
    const thread = state.threads[threadId];
    if (!thread) return;
    for (const { target, html } of saves) commitMarkedMessage(thread, target, html);
    after?.(state);
  });
}

export async function saveHighlight(threadId: string, threadTitle: string, sel: SelectionInfo): Promise<boolean> {
  const id = makeHighlightId();
  const branch = sel.scope === 'branch' ? useBranchStore.getState().open[sel.branchId ?? ''] : undefined;
  const info: Pick<PersistedHighlight, 'source' | 'branchId' | 'branchQuote' | 'parentBranchId' | 'anchorBid' | 'depth'> = branch
    ? { source: 'branch', branchId: branch.id, branchQuote: branch.quote || '', parentBranchId: branch.parentBid || null, anchorBid: branch.anchorBid || branch.id, depth: branch.depth || 1 }
    : { source: 'main-chat' };
  const record: PersistedHighlight = { id, threadId, threadTitle, text: squash(sel.text), createdAt: Date.now(), ...info };
  try {
    await wrapAndSave(threadId, sel, 'highlight', id, state => {
      const thread = state.threads[threadId]!;
      addHighlightIn(thread, record);
      // A highlight inside a branch is mirrored into that branch's snapshot so it survives the panel closing.
      if (branch) captureSnapshotIn(thread, specOf(branch), contentOf(thread, branch.id), { force: true, now: Date.now() });
    });
  } catch {
    toast('Could not highlight that selection');
    return false;
  }
  window.getSelection()?.removeAllRanges();
  toast('Highlight saved');
  return true;
}

/** The turn a top-level branch came from, and what was asked in it (app.js:3037). */
function mainTurnOf(sel: SelectionInfo): { mainTurnId: string | null; mainTurnPrompt: string } {
  const first = sel.messages[0];
  const id = first?.dataset.turnId;
  if (!first || !id || id.startsWith('legacy-')) return { mainTurnId: null, mainTurnPrompt: '' };
  const root = first.closest('[data-chat-stream]');
  const user = [...(root?.querySelectorAll<HTMLElement>('.msg.user') ?? [])].find(el => el.dataset.turnId === id);
  return { mainTurnId: id, mainTurnPrompt: user?.querySelector('.bub')?.textContent?.trim() || '' };
}

/** ⌘B / the popover's Branch: anchor the selection, then open its panel. */
export async function branchFromSelection(threadId: string, sel: SelectionInfo): Promise<void> {
  const parentBranchId = sel.scope === 'branch' ? sel.branchId ?? null : null;
  const turn = parentBranchId ? { mainTurnId: null, mainTurnPrompt: '' } : mainTurnOf(sel);
  const anchorBid = makeBranchId();
  try {
    await wrapAndSave(threadId, sel, 'branch', anchorBid);
  } catch {
    // Legacy carries on without an anchor rather than refusing: the branch still opens.
  }
  window.getSelection()?.removeAllRanges();
  openBranch({ threadId, quote: sel.text, parentBranchId, fresh: true, bid: anchorBid, anchorBid, ...turn });
}

/** Removes a highlight: its span, its record, and a branch snapshot it alone kept alive. */
export async function removeHighlight(threadId: string, id: string): Promise<void> {
  const removed = await useAppStore.getState().updateThreads(state => {
    const thread = state.threads[threadId];
    return thread ? removeHighlightIn(thread, id) : null;
  });
  if (removed) toast('Highlight removed');
}

export { titleFromQuote };
