import type { TextHighlight } from '../anchors';
import { TONE_BG } from './ThreadNode';
import { sourceRange, textSegments } from './selection-source';
export type { TextHighlight };

/** Several text-node fragments may share one snapshot id; inline formatting stays intact. */
export function applyHighlights(root: HTMLElement, highlights: readonly TextHighlight[], source?: string): void {
  root.querySelectorAll<HTMLElement>('mark[data-snapshot-id]').forEach(mark => {
    if (highlights.some(h => h.id === mark.dataset.snapshotId)) return;
    const parent = mark.parentNode;
    if (!parent) return;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    mark.remove(); parent.normalize();
  });
  for (const h of highlights) {
    if (!h.quote || Array.from(root.querySelectorAll<HTMLElement>('mark[data-snapshot-id]')).some(m => m.dataset.snapshotId === h.id)) continue;
    const { text: full, runs } = textSegments(root);
    let occurrence = 0;
    if (source && h.start !== undefined) {
      while (true) {
        const range = sourceRange(source, h.quote, occurrence, false, root);
        if (!range || range.start >= h.start) break;
        occurrence++;
      }
    }
    let at = -1;
    for (let i = 0; i <= occurrence; i++) { at = full.indexOf(h.quote, at < 0 ? 0 : at + h.quote.length); if (at < 0) break; }
    if (at < 0) continue;
    for (const { node, start, end } of runs) {
      const lo = Math.max(0, at - start), hi = Math.min(end - start, at + h.quote.length - start);
      if (hi > lo) {
        const range = document.createRange(); range.setStart(node, lo); range.setEnd(node, hi);
        const mark = document.createElement('mark');
        mark.className = `${TONE_BG[h.tone]} rounded-[2px] text-inherit`;
        mark.dataset.snapshotId = h.id; range.surroundContents(mark);
      }
    }
  }
}
