import type { ChatMessage } from '../providers/types';
import type { PersistedBranchRecent, PersistedBranchSnapshot, PersistedThread } from '../db/types';
import { cleanThreadTitle } from '../db/thread-ops';

// The branch tree as data. Everything here is pure: rows for the sidebar and the
// delete confirmation, the descendant closure, and buildBranchContext (the whole
// product, per CLAUDE.md). Ported from app.js; each function names its source.

export interface BranchRow {
  id: string;
  anchorBid: string;
  quote: string;
  parentBid: string | null;
  depth: number;
  order: number;
  open: boolean;
  touchedAt: number;
  mainTurnId: string | null;
  mainTurnPrompt: string;
}

/** What an open panel contributes to the rows (app.js:5777). */
export interface OpenBranchSeed {
  id: string;
  anchorBid?: string;
  quote?: string;
  parentBid?: string | null;
  depth?: number;
  touchedAt?: number;
  createdAt?: number;
}

const normalize = (s: unknown): string => cleanThreadTitle(s, '');

export function numericBranchDepth(value: unknown): number | null {
  const depth = Number(value);
  return Number.isFinite(depth) && depth > 0 ? depth : null;
}

/** app.js:3194 resolveBranchDepth, given the parent's depth if the parent is known. */
export function depthBelow(parentDepth: number | null | undefined, hasParent: boolean, fallback: number | null = null): number {
  if (parentDepth != null) return (numericBranchDepth(parentDepth) || 1) + 1;
  return (hasParent ? numericBranchDepth(fallback) : 1) || 1;
}

/** app.js:5707 anchorsFromBranchHTML: one row per `data-bid`, quote = its spans' text joined. */
function anchorsFromHTML(html: string): Array<Pick<BranchRow, 'id' | 'anchorBid' | 'quote' | 'order'>> {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const byId = new Map<string, { id: string; parts: string[]; order: number }>();
  tpl.content.querySelectorAll<HTMLElement>('.branched[data-bid]').forEach((el, index) => {
    const bid = el.dataset.bid;
    if (!bid) return;
    const row = byId.get(bid) ?? { id: bid, parts: [], order: index };
    row.parts.push(normalize(el.textContent));
    byId.set(bid, row);
  });
  return [...byId.values()].map(r => ({ id: r.id, anchorBid: r.id, quote: r.parts.filter(Boolean).join(' '), order: r.order }));
}

type Seed = Partial<Omit<BranchRow, 'touchedAt'>> & { id: string; touchedAt?: number; updatedAt?: number; createdAt?: number };

/** app.js:5736 mergeBranchRow. */
function mergeRow(rows: Map<string, BranchRow>, row: Seed, fallbackOrder: number): void {
  if (!row.id) return;
  const existing = rows.get(row.id);
  rows.set(row.id, {
    id: row.id,
    anchorBid: row.anchorBid || existing?.anchorBid || row.id,
    quote: row.quote || existing?.quote || 'Untitled branch',
    parentBid: row.parentBid || existing?.parentBid || null,
    depth: row.depth || existing?.depth || 1,
    order: existing?.order ?? row.order ?? fallbackOrder,
    open: !!(existing?.open || row.open),
    touchedAt: Math.max(existing?.touchedAt || 0, row.touchedAt || row.updatedAt || row.createdAt || 0),
    mainTurnId: row.mainTurnId || existing?.mainTurnId || null,
    mainTurnPrompt: row.mainTurnPrompt || existing?.mainTurnPrompt || '',
  });
}

/**
 * app.js:5757 branchRowsForThread. The union of what the page shows (anchors in the
 * document and stream), what was remembered (recents), what was saved (snapshots) and
 * what is open now, with depths resolved through parents.
 */
export function branchRowsForThread(thread: PersistedThread | undefined, open: readonly OpenBranchSeed[] = []): BranchRow[] {
  const rows = new Map<string, BranchRow>();
  const openIds = new Set(open.map(o => o.id));
  const savedDoc = thread?.kind === 'doc' && typeof thread.docContent === 'string' ? thread.docContent : '';
  const stream = typeof thread?.stream === 'string' ? thread.stream : '';
  for (const a of anchorsFromHTML(`${savedDoc}\n${stream}`)) {
    mergeRow(rows, { ...a, parentBid: null, depth: 1, open: openIds.has(a.id) }, a.order);
  }
  Object.values(thread?.branchRecents ?? {}).forEach((r: PersistedBranchRecent, i) => {
    mergeRow(rows, { ...r, touchedAt: r.touchedAt || r.createdAt || 1 }, 2000 + i);
  });
  Object.values(thread?.branchSnapshots ?? {}).forEach((s: PersistedBranchSnapshot, i) => {
    mergeRow(rows, { ...s, touchedAt: s.touchedAt || s.createdAt || 1 }, 3000 + i);
  });
  open.forEach((o, i) => {
    mergeRow(rows, {
      id: o.id, anchorBid: o.anchorBid || o.id, quote: o.quote || 'Untitled branch', parentBid: o.parentBid || null,
      depth: o.depth || 1, order: 1000 + i, open: true, touchedAt: o.touchedAt || o.createdAt || 0,
    }, 1000 + i);
  });

  const list = [...rows.values()];
  const byId = new Map(list.map(r => [r.id, r]));
  const done = new Set<string>();
  const resolving = new Set<string>();
  const resolveDepth = (row: BranchRow): number => {
    if (done.has(row.id)) return row.depth;
    if (resolving.has(row.id)) return numericBranchDepth(row.depth) || 1;
    resolving.add(row.id);
    const parent = row.parentBid ? byId.get(row.parentBid) : undefined;
    row.depth = parent ? resolveDepth(parent) + 1 : (row.parentBid ? (numericBranchDepth(row.depth) || 1) : 1);
    done.add(row.id);
    resolving.delete(row.id);
    return row.depth;
  };
  list.forEach(resolveDepth);
  return list.sort((a, b) => a.order - b.order || a.depth - b.depth);
}

export interface RecentBranch { tid: string; threadTitle: string; row: BranchRow; isOpen: boolean; touchedAt: number }

/** app.js:5810 recentBranchRows: the newest `limit` branches across the given threads. */
export function recentBranchRows(
  threads: ReadonlyArray<{ tid: string; title: string; thread: PersistedThread | undefined }>,
  openByThread: Readonly<Record<string, readonly OpenBranchSeed[]>>,
  limit = 8,
): RecentBranch[] {
  const out: RecentBranch[] = [];
  const seen = new Set<string>();
  for (const { tid, title, thread } of threads) {
    if (!thread) continue;
    const open = openByThread[tid] ?? [];
    for (const row of branchRowsForThread(thread, open)) {
      const key = `${tid}:${row.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const live = open.find(o => o.id === row.id);
      const isOpen = !!live;
      const touchedAt = isOpen ? (live!.touchedAt || row.touchedAt || 0) : (row.touchedAt || 0);
      if (!isOpen && !touchedAt) continue;
      out.push({ tid, threadTitle: title, row: { ...row, touchedAt }, isOpen, touchedAt });
    }
  }
  return out.sort((a, b) => (b.touchedAt || 0) - (a.touchedAt || 0) || Number(b.isOpen) - Number(a.isOpen)).slice(0, limit);
}

/** app.js:3868 branchDeleteTargets: a branch and everything beneath it. */
export function branchDeleteTargets(rows: readonly BranchRow[], rootId: string): Set<string> {
  const ids = new Set([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of rows) {
      if (!ids.has(row.id) && row.parentBid && ids.has(row.parentBid)) { ids.add(row.id); changed = true; }
    }
  }
  return ids;
}

export interface ChainNode { id: string; quote: string; parentBid: string | null; messages: ChatMessage[] }

/** Root-first ancestor chain ending at `id`. Cycle-safe. Missing ancestors end the chain. */
export function branchChain(id: string, lookup: (id: string) => ChainNode | undefined): ChainNode[] {
  const chain: ChainNode[] = [];
  const seen = new Set<string>();
  let cursor = lookup(id);
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    chain.unshift(cursor);
    cursor = cursor.parentBid ? lookup(cursor.parentBid) : undefined;
  }
  return chain;
}

/**
 * app.js:354 buildBranchContext. THE CORE MECHANIC OF THE PRODUCT: a branch is not an
 * isolated chat, it is a side conversation that still has everything above it. The main
 * thread's history first, then each ancestor's quote and messages, then the current
 * branch (merging its quote into the first message so two user turns never touch).
 *
 * Control flow is legacy's, unchanged. The one difference is the input: legacy walks
 * only ancestors that are OPEN as panels, so closing a parent and then asking in its
 * child silently drops the parent from the model's context. `chain` here comes from what
 * is saved, so it does not. See ADR-051.
 */
export function buildBranchContext(
  mainMessages: readonly ChatMessage[],
  chain: readonly ChainNode[],
  newUserMsg: string,
  buildUserContent: (text: string) => ChatMessage['content'] = text => text,
): ChatMessage[] {
  const messages: ChatMessage[] = [];
  if (mainMessages.length) messages.push(...mainMessages);
  for (let i = 0; i < chain.length - 1; i++) {
    const b = chain[i]!;
    messages.push({ role: 'user', content: `Exploring this passage: "${b.quote}"` });
    if (b.messages.length) messages.push(...b.messages);
  }
  const cur = chain[chain.length - 1];
  if (!cur) return messages;
  if (cur.messages.length === 0) {
    messages.push({ role: 'user', content: buildUserContent(`I've highlighted this passage to explore: "${cur.quote}"\n\n${newUserMsg}`) });
  } else {
    messages.push({ role: 'user', content: `Exploring: "${cur.quote}"` });
    messages.push(...cur.messages);
    messages.push({ role: 'user', content: buildUserContent(newUserMsg) });
  }
  return messages;
}
