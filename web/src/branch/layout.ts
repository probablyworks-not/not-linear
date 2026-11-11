// Where branch panels sit, as pure functions of measurements. Ported from app.js
// (layoutBranches :4028, rebalance :3955, setBranchSize :3668, the resize handler :3711),
// with the DOM reads lifted out: the caller measures, this decides, the caller applies.
// That is what makes the stacking rules (bugs #002/#003/#037/#038) testable without a browser.

export const BRANCH_MIN_WIDTH = 340;
export const BRANCH_MIN_HEIGHT = 220;
/** Gap between stacked panels. */
export const BRANCH_STACK_GAP = 10;

export const clamp = (n: number, min: number, max: number): number => Math.min(Math.max(n, min), max);

export interface Rail { top: number; bottom: number }

/** app.js:4010 branchRail: the vertical band panels live in, below the topbar and above the composer. */
export function branchRail(topbarBottom: number | undefined, viewportHeight: number): Rail {
  const top = Math.max(70, (topbarBottom || 54) + 12);
  const bottom = Math.max(top + 140, viewportHeight - 92);
  return { top, bottom };
}

export interface Bounds { minTop: number; maxBottom: number; minWidth: number; maxWidth: number; minHeight: number }

/** app.js:3677 branchResizeBounds and :3667 branchMaxWidth. */
export function resizeBounds(rail: Rail, viewportWidth: number, viewportHeight: number, drawerGap = 16): Bounds {
  return {
    minTop: rail.top,
    maxBottom: viewportHeight - 24,
    minWidth: BRANCH_MIN_WIDTH,
    maxWidth: Math.max(BRANCH_MIN_WIDTH, Math.min(900, viewportWidth - drawerGap * 2)),
    minHeight: BRANCH_MIN_HEIGHT,
  };
}

export type ResizeEdge = 'top' | 'bottom' | 'left' | 'top-left' | 'bottom-left';

export interface ResizeStart { edge: ResizeEdge; startX: number; startY: number; startW: number; startH: number; startTop: number; startBottom: number }
export interface SizeChange { width?: number; height?: number; top?: number }

/** app.js:3744: what a pointer move does to a panel, before clamping. */
export function resizeDelta(start: ResizeStart, x: number, y: number, bounds: Bounds): SizeChange {
  const dx = x - start.startX;
  const dy = y - start.startY;
  const out: SizeChange = {};
  if (start.edge.includes('left')) out.width = start.startW - dx;
  if (start.edge.includes('top')) {
    const top = clamp(start.startTop + dy, bounds.minTop, start.startBottom - bounds.minHeight);
    out.top = top;
    out.height = start.startBottom - top;
  } else if (start.edge.includes('bottom')) {
    out.height = start.startH + dy;
  }
  return out;
}

export interface PanelSize { width?: number; height?: number; top?: number; collapsed: boolean }

/**
 * app.js:3668 setBranchSize: clamps a requested size into the bounds and returns the
 * panel's new geometry. `current` is what the panel has now (or was measured at).
 */
export function applySize(
  current: { width?: number; height?: number; top?: number; measuredTop: number }, change: SizeChange, bounds: Bounds,
): { width?: number; height?: number; top: number } {
  let width = current.width;
  let height = current.height;
  const savedTop = current.top ?? current.measuredTop;
  let nextTop = Number.isFinite(change.top) ? change.top! : (Number.isFinite(savedTop) ? savedTop : current.measuredTop);
  if (Number.isFinite(change.width)) width = clamp(change.width!, bounds.minWidth, bounds.maxWidth);
  if (Number.isFinite(change.height)) {
    nextTop = clamp(nextTop, bounds.minTop, bounds.maxBottom - bounds.minHeight);
    height = clamp(change.height!, bounds.minHeight, bounds.maxBottom - nextTop);
  }
  const top = Number.isFinite(change.top)
    ? clamp(nextTop, bounds.minTop, bounds.maxBottom - (height || bounds.minHeight))
    : (current.top ?? current.measuredTop);
  return { width, height, top };
}

// ---------- stacking ----------

export interface PanelState {
  id: string;
  parentBid: string | null;
  reader: boolean;
}

export interface Stacking {
  zIndex: Record<string, number>;
  behindActive: Set<string>;
  /** Reader mode is a focus state: every panel but the active one leaves it (app.js:3957). */
  clearReader: Set<string>;
}

/** Open ancestors of `id`, nearest first. */
export function openAncestors(id: string | null, byId: Readonly<Record<string, PanelState>>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let cursor = id ? byId[id]?.parentBid : null;
  while (cursor && byId[cursor] && !seen.has(cursor)) {
    seen.add(cursor);
    out.push(cursor);
    cursor = byId[cursor]!.parentBid;
  }
  return out;
}

/** app.js:3955 rebalance, the part that is not DOM: z-order, who is behind, who leaves reader. */
export function stacking(panels: readonly PanelState[], activeId: string | null): Stacking {
  const byId = Object.fromEntries(panels.map(p => [p.id, p]));
  const clearReader = new Set(panels.filter(p => p.reader && p.id !== activeId).map(p => p.id));
  const isReader = (p: PanelState): boolean => p.reader && !clearReader.has(p.id);
  const ancestors = new Set(openAncestors(activeId, byId));
  const zIndex: Record<string, number> = {};
  for (const p of panels) {
    zIndex[p.id] = p.id === activeId ? (isReader(p) ? 60 : 3) : ancestors.has(p.id) ? 2 : isReader(p) ? 60 : 1;
  }
  return { zIndex, behindActive: ancestors, clearReader };
}

// ---------- vertical placement ----------

export interface PanelMeasure {
  id: string;
  parentBid: string | null;
  reader: boolean;
  collapsed: boolean;
  /** Panel was resized or placed by hand, so its own `top` wins over its anchor. */
  userSized: boolean;
  top?: number;
  /** offsetHeight, or 0 if not yet measured. */
  height: number;
  /** The anchor span's rect (viewport coordinates), or null when it is not on the page. */
  anchor: { top: number; height: number } | null;
  /** Anchor's position down the whole page, for stable ordering when two want the same spot. */
  docY: number;
}

export interface Layout {
  tops: Record<string, number>;
  /** Anchor scrolled out of the rail: the panel fades out until it comes back. */
  sourceOut: Set<string>;
  /** Ancestors of a reader-mode panel stay stacked behind it, un-repositioned. */
  readerEclipsed: Set<string>;
  /** Panels whose `top` should be remembered, because the user placed them. */
  remember: Set<string>;
}

/**
 * app.js:4028 layoutBranches. Each panel wants to sit level with its anchor; panels are
 * sorted by that desire and pushed down so they never overlap, then the whole column is
 * shifted up if it runs past the bottom of the rail. A child snaps onto its open parent's
 * top, so a nested branch stacks exactly on the one it came from.
 */
export function layoutPanels(panels: readonly PanelMeasure[], rail: Rail, activeId: string | null): Layout {
  const layout: Layout = { tops: {}, sourceOut: new Set(), readerEclipsed: new Set(), remember: new Set() };
  if (!panels.length) return layout;
  const byId = Object.fromEntries(panels.map(p => [p.id, p]));

  const readerAncestors = new Set<string>();
  for (const p of panels) {
    if (!p.reader) continue;
    const seen = new Set<string>();
    let cursor = p.parentBid;
    while (cursor && byId[cursor] && !seen.has(cursor)) { seen.add(cursor); readerAncestors.add(cursor); cursor = byId[cursor]!.parentBid; }
  }
  readerAncestors.forEach(id => layout.readerEclipsed.add(id));

  const placements = panels
    .filter(p => !p.reader && !readerAncestors.has(p.id))
    .map((p, index) => {
      const anchorVisible = !p.anchor || (p.anchor.top + p.anchor.height >= rail.top && p.anchor.top <= rail.bottom);
      if (p.anchor && !anchorVisible) { layout.sourceOut.add(p.id); return null; }
      const height = p.height || (p.collapsed ? 46 : 360);
      const headerOffset = p.collapsed ? height / 2 : 22;
      const anchorY = p.anchor ? p.anchor.top + p.anchor.height / 2 : rail.top + index * 56;
      const maxTop = rail.bottom - height;
      const hasManualTop = p.userSized && Number.isFinite(p.top);
      const desired = hasManualTop
        ? clamp(p.top!, rail.top, Math.max(rail.top, maxTop))
        : clamp(anchorY - headerOffset, rail.top, Math.max(rail.top, maxTop));
      return { id: p.id, height, desired, top: desired, docY: p.docY };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .sort((a, b) => a.desired - b.desired || a.docY - b.docY);

  if (!placements.length) return layout;

  let cursor = rail.top;
  for (const p of placements) {
    p.top = Math.max(p.desired, cursor);
    cursor = p.top + p.height + BRANCH_STACK_GAP;
  }
  const overflow = cursor - BRANCH_STACK_GAP - rail.bottom;
  if (overflow > 0) {
    const shift = Math.min(overflow, Math.max(0, placements[0]!.top - rail.top));
    for (const p of placements) p.top -= shift;
  }
  for (const p of placements) {
    layout.tops[p.id] = Math.round(p.top);
    if (byId[p.id]!.userSized) layout.remember.add(p.id);
  }

  // Snap each open ancestor-chain child onto its parent, from the active panel upward.
  if (activeId && byId[activeId]) {
    let childId = activeId;
    let parentId = byId[childId]!.parentBid;
    const seen = new Set<string>();
    while (parentId && byId[parentId] && !seen.has(parentId)) {
      seen.add(parentId);
      const parentTop = layout.tops[parentId];
      if (parentTop !== undefined) layout.tops[childId] = parentTop;
      childId = parentId;
      parentId = byId[childId]!.parentBid;
    }
  }
  return layout;
}
