import { BaseEdge, getBezierPath, Position, type EdgeProps } from '@xyflow/react';
import type { FlowPoint } from './useHighlightAnchors';

export interface HighlightEdgeData extends Record<string, unknown> {
  /** Flow-space point of the `<mark>` this edge was branched from, when one could be measured. */
  anchor?: FlowPoint;
}

/** A relation edge that leaves from the exact highlighted quote in the source card, when
 * `data.anchor` resolved — otherwise it's visually identical to React Flow's default edge, using
 * the node handle positions it already computed. */
export function HighlightEdge({
  sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, data, style, markerEnd,
}: EdgeProps) {
  const anchor = (data as HighlightEdgeData | undefined)?.anchor;
  const [path] = getBezierPath({
    sourceX: anchor?.x ?? sourceX,
    sourceY: anchor?.y ?? sourceY,
    sourcePosition: anchor ? Position.Right : sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  return <BaseEdge path={path} style={style} markerEnd={markerEnd} />;
}
