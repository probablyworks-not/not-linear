import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { htmlAnchors } from './html-anchors';
import { DEFAULT_LAYOUT_ID, type CanvasDoc } from '../types';

export interface FlowPoint { x: number; y: number }

interface FlowPositioner {
  screenToFlowPosition(pos: { x: number; y: number }): FlowPoint;
}

/** Maps each relation's snapshot id to the flow-space point of the `<mark>` it was frozen from, so
 * a branch/synthesis edge can leave from the actual highlighted text instead of the node's border.
 * Re-measures on doc changes and on any source card's body resize (`resizeTick`) — a mark that
 * can't be found (quote `changed`/`missing`, per `resolveAnchor`, or not yet painted) is simply
 * absent from the map, and the caller falls back to the default node-handle anchor, same posture
 * as `apply-highlights.ts`'s own silent skip. */
export function useHighlightAnchors(doc: CanvasDoc | null, resizeTick: number, rf: FlowPositioner, active = true): Map<string, FlowPoint> {
  const [anchors, setAnchors] = useState<Map<string, FlowPoint>>(new Map());

  // Only the set of relation->snapshot ids actually needs re-measuring — an edit that touches
  // message/thread content but not relations/snapshots shouldn't force a full-document
  // querySelector + getBoundingClientRect pass. Cheap to build (ids only) relative to the layout
  // work it lets the effect below skip.
  const snapshotIdsSig = useMemo(
    () => (doc ? [...new Set(doc.relations.map(r => r.snapshotId).filter((id): id is string => !!id))].sort().join(',') : ''),
    [doc],
  );

  const sourceLayoutSig = useMemo(() => {
    if (!doc) return '';
    const sources = new Set(doc.relations.map(r => r.fromThreadId));
    const entries = doc.layouts.find(l => l.id === DEFAULT_LAYOUT_ID)?.entries;
    return JSON.stringify([...sources].sort().map(id => [id, entries?.[id], doc.messages.filter(m => m.threadId === id).map(m => [m.id, m.rev])]));
  }, [doc]);

  // `measure` reads `doc` via a ref, not a closure dependency, so its own identity stays stable
  // across doc edits — otherwise the effect below would depend on `measure`'s identity and end up
  // re-running on every edit regardless of `snapshotIdsSig`. The sync happens in its own effect,
  // not during render, since writing a ref while rendering is unsound (and newly lint-checked);
  // declaring it first guarantees it runs before the measuring effect below within this
  // component's own effects for a given commit.
  const docRef = useRef(doc);
  useEffect(() => { docRef.current = doc; });

  const measure = useCallback(() => {
    const doc = docRef.current;
    if (!doc) { setAnchors(new Map()); return; }
    const snapshotIds = new Set(doc.relations.map(r => r.snapshotId).filter((id): id is string => !!id));
    const next = new Map<string, FlowPoint>();
    for (const id of snapshotIds) {
      const mark = document.querySelector<HTMLElement>(`.react-flow mark[data-snapshot-id="${id}"]`);
      const rect = mark?.getBoundingClientRect() ?? htmlAnchors.getRect(id);
      if (!rect) continue;
      next.set(id, rf.screenToFlowPosition({ x: rect.left + rect.width, y: rect.top + rect.height / 2 }));
    }
    setAnchors(prev => {
      if (prev.size === next.size && [...next].every(([id, p]) => {
        const was = prev.get(id);
        return was && Math.abs(was.x - p.x) < 0.1 && Math.abs(was.y - p.y) < 0.1;
      })) return prev;
      return next;
    });
  }, [rf]);

  useEffect(() => htmlAnchors.subscribe(measure), [measure]);

  // The first, cheap attempt: re-measure whenever the relation set or a card's body size changes.
  // Keyed on the relation signature (not `doc`, which gets a new identity on every edit) plus
  // `resizeTick`, so a change to unrelated thread content doesn't trigger a re-measure.
  useEffect(() => {
    if (!active) return;
    const frame = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(frame);
  }, [measure, resizeTick, snapshotIdsSig, sourceLayoutSig, active]);

  // That first attempt isn't reliable on its own: the `<mark>` being measured is created by
  // `Markdownish`'s own effect (`apply-highlights.ts`), a descendant mounted independently of this
  // hook. React doesn't guarantee a parent's effect runs after every descendant's on the same
  // commit strongly enough to depend on in practice — measured directly (a Playwright repro
  // reloading a doc that already has a branch): making this a `useLayoutEffect` lost that race
  // ~83% of the time, and even a `useEffect` here still lost it occasionally. So this doesn't
  // guess at timing at all: it watches the real DOM for the mark actually landing, the same way
  // `useEffect` is meant to sync with any other external system, and re-measures whenever it does.
  // Scoped to the relation set existing at all, so an empty canvas pays nothing.
  useEffect(() => {
    if (!snapshotIdsSig || !active) return;
    let frame = 0;
    const scheduleRemeasure = (): void => {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; measure(); });
    };
    const observer = new MutationObserver(scheduleRemeasure);
    const scene = document.querySelector('.react-flow__nodes');
    if (!scene) return;
    observer.observe(scene, { childList: true, subtree: true, attributes: true, attributeFilter: ['style'] });
    scene.addEventListener('scroll', scheduleRemeasure, true);
    document.fonts?.addEventListener('loadingdone', scheduleRemeasure);
    let live = true;
    void document.fonts?.ready.then(() => { if (live) scheduleRemeasure(); });
    return () => {
      live = false; observer.disconnect();
      scene.removeEventListener('scroll', scheduleRemeasure, true);
      document.fonts?.removeEventListener('loadingdone', scheduleRemeasure);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [measure, snapshotIdsSig, active]);

  // Panning/zooming moves everything in flow-space together, so it never changes a mark's flow
  // point — only a window resize (viewport-relative `getBoundingClientRect` reads) can move one
  // without a body-resize/doc change also firing.
  useEffect(() => {
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  return anchors;
}
