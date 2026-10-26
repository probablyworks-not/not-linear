import type { HighlightTone } from '../types';
import type { TextHighlight } from '../anchors';
import { TONE_BG } from './ThreadNode';

// Marks a frozen quote back where it came from, inside an already-rendered reply. A snapshot
// stores the exact quote text (`TextAnchor.quote`), not a DOM range — markdown rendering can
// reshape the DOM (paragraphs, lists, inline code), so this walks the rendered text nodes rather
// than assuming the quote sits in one node. A quote that can't be found verbatim (the reply was
// edited since, or it crosses something `renderMarkdown` turned into a non-text node) is skipped
// silently — same posture as `resolveAnchor`'s `changed`/`missing` status: a cosmetic miss, not
// an error worth surfacing.

export type { TextHighlight };

/** One match: which text node to split, and the offset range within its string to wrap. */
interface Match { node: Text; start: number; end: number }

function findMatch(root: HTMLElement, quote: string): Match | null {
  if (!quote) return null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let full = '';
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    nodes.push(n as Text);
    full += (n as Text).data;
  }
  const at = full.indexOf(quote);
  if (at < 0) return null;
  // Find which single text node holds [at, at + quote.length) — if the quote crosses a node
  // boundary (e.g. split by an inline <code> or <em> the markdown renderer introduced), this
  // whole-match-in-one-node approach can't wrap it; that case is dropped rather than approximated.
  let pos = 0;
  for (const node of nodes) {
    const nodeStart = pos;
    const nodeEnd = pos + node.data.length;
    if (at >= nodeStart && at + quote.length <= nodeEnd) {
      return { node, start: at - nodeStart, end: at - nodeStart + quote.length };
    }
    pos = nodeEnd;
  }
  return null;
}

function wrap(match: Match, tone: HighlightTone, id: string): void {
  const { node, start, end } = match;
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  const mark = document.createElement('mark');
  mark.className = `${TONE_BG[tone]} rounded-[2px] text-inherit`;
  mark.dataset.snapshotId = id;
  range.surroundContents(mark);
}

/** The inverse of `wrap`: dissolves the `<mark>` back into plain text in place, then merges it
 * with any now-adjacent text nodes so a later `findMatch` walk sees one contiguous run again. */
function unwrap(mark: HTMLElement): void {
  const parent = mark.parentNode;
  if (!parent) return;
  while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
  parent.removeChild(mark);
  parent.normalize();
}

/** Reconciles the DOM's highlight marks against the current `highlights` list: unwraps any
 * `<mark data-snapshot-id>` whose id is no longer in the list (its snapshot was deleted — e.g. a
 * cancelled "ask about this" pick — see `CanvasWorkspace.tsx`'s `setPicked`), then applies every
 * highlight it can still find; silently skips the rest. Idempotent: a quote whose match already
 * sits inside a `<mark data-snapshot-id>` is skipped on the add side, so a spurious extra effect
 * run (e.g. from an upstream prop that changed identity but not content) can't nest marks deeper
 * instead of being a true no-op. */
export function applyHighlights(root: HTMLElement, highlights: readonly TextHighlight[]): void {
  const keep = new Set(highlights.map(h => h.id));
  root.querySelectorAll<HTMLElement>('mark[data-snapshot-id]').forEach(mark => {
    const id = mark.dataset.snapshotId;
    if (id !== undefined && !keep.has(id)) unwrap(mark);
  });
  for (const h of highlights) {
    const match = findMatch(root, h.quote);
    if (!match) continue;
    if (match.node.parentElement?.closest('mark[data-snapshot-id]')) continue;
    wrap(match, h.tone, h.id);
  }
}
