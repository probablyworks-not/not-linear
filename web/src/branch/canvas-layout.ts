import type { BranchRow } from '../chat/branch-model';

// Where each node of the spatial branch canvas sits (app.js:2823 bcLayout). A tree laid out
// left to right: the main thread is the root, each branch hangs off its parent (or the root
// if its parent is unknown), leaves take consecutive rows and a parent sits level with the
// middle of its children. Pure, so the shape of the picture is testable.

export const CANVAS_NODE_W = 230;
export const CANVAS_NODE_H = 92;
export const CANVAS_GAP_X = 130;
export const CANVAS_GAP_Y = 26;

export interface Position { x: number; y: number; depth: number }

export interface CanvasLayout {
  byId: Record<string, BranchRow>;
  /** parent id (or 'doc') → child ids, in the order the branches appear. */
  childrenOf: Record<string, string[]>;
  positions: Record<string, Position>;
  /** Size the plane needs to hold every node. */
  width: number;
  height: number;
}

export function canvasLayout(rows: readonly BranchRow[]): CanvasLayout {
  const byId = Object.fromEntries(rows.map(r => [r.id, r]));
  const childrenOf: Record<string, string[]> = {};
  for (const r of rows) {
    const key = r.parentBid && byId[r.parentBid] ? r.parentBid : 'doc';
    (childrenOf[key] ??= []).push(r.id);
  }
  for (const kids of Object.values(childrenOf)) kids.sort((a, b) => (byId[a]!.order ?? 0) - (byId[b]!.order ?? 0));

  const positions: Record<string, Position> = {};
  let leafY = 0;
  const seen = new Set<string>();
  const place = (key: string, depth: number): number => {
    const kids = (childrenOf[key] ?? []).filter(k => !seen.has(k));
    kids.forEach(k => seen.add(k)); // a parent cycle in saved data must not recurse forever
    if (!kids.length) {
      const y = leafY;
      leafY += CANVAS_NODE_H + CANVAS_GAP_Y;
      if (key !== 'doc') positions[key] = { x: depth * (CANVAS_NODE_W + CANVAS_GAP_X), y, depth };
      return y;
    }
    const ys = kids.map(kid => place(kid, depth + 1));
    const y = (Math.min(...ys) + Math.max(...ys)) / 2;
    if (key !== 'doc') positions[key] = { x: depth * (CANVAS_NODE_W + CANVAS_GAP_X), y, depth };
    return y;
  };
  positions.doc = { x: 0, y: place('doc', 0), depth: 0 };

  const all = Object.values(positions);
  const maxDepth = Math.max(0, ...all.map(p => p.depth));
  const maxY = Math.max(0, ...all.map(p => p.y));
  return {
    byId, childrenOf, positions,
    width: (maxDepth + 1) * (CANVAS_NODE_W + CANVAS_GAP_X) + 40,
    height: maxY + CANVAS_NODE_H + 80,
  };
}

/** The curve from a parent's right edge to a child's left (app.js:2866). */
export function edgePath(from: Position, to: Position): string {
  const x1 = from.x + CANVAS_NODE_W;
  const y1 = from.y + CANVAS_NODE_H / 2;
  const x2 = to.x;
  const y2 = to.y + CANVAS_NODE_H / 2;
  const mx = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2 - 8} ${y2}`;
}
