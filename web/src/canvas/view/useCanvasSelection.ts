import { useCallback, useEffect, useState } from 'react';
import { htmlSelectionBus } from './html-selection-bus';

// Reading a text selection that lands inside a canvas card, and saying exactly where it came from.
// The offsets are taken against the *part's* text, not the rendered DOM, because the part text is
// what gets frozen and what an anchor resolves against later.

export interface CanvasSelection {
  messageId: string;
  partId: string;
  quote: string;
  /** Offset within the part's text. -1 when the quote could not be located. */
  start: number;
  /** Only `left`/`top`/`width`/`height` are ever read (positioning the popover) — a real DOMRect
   * from the main document, or a plain object translated from an html part's sandboxed iframe
   * (`html-selection-bus.ts`), both satisfy this. */
  rect: { left: number; top: number; width: number; height: number };
  /** Whether this selection lives inside the ReactFlow pane right now. Reading View and the
   * Output Detail overlay render the exact same `PartView` content, but as plain scrolling panels
   * outside canvas/flow coordinate space — `rf.screenToFlowPosition` on a selection made there
   * doesn't correspond to anywhere real on the canvas, so callers that place a new card relative
   * to the selection must check this first and fall back to the source card's own position when
   * it's false. */
  inCanvasPane: boolean;
}

const inReactFlowPane = (node: Node | null): boolean => {
  const el = node instanceof HTMLElement ? node : node?.parentElement ?? null;
  return !!el?.closest('.react-flow');
};

const closestAttr = (node: Node | null, attr: string): string | null => {
  let el: HTMLElement | null = node instanceof HTMLElement ? node : node?.parentElement ?? null;
  while (el) {
    const v = el.getAttribute(attr);
    if (v) return v;
    el = el.parentElement;
  }
  return null;
};

const closestEl = (node: Node | null, attr: string): HTMLElement | null => {
  let el: HTMLElement | null = node instanceof HTMLElement ? node : node?.parentElement ?? null;
  while (el) {
    if (el.getAttribute(attr)) return el;
    el = el.parentElement;
  }
  return null;
};

/** The boundary point at the very start or end of `part`'s own content, as a (node, offset) pair a
 * Range can be built from. */
const partEdge = (part: HTMLElement, edge: 'start' | 'end'): { node: Node; offset: number } => {
  const r = document.createRange();
  r.selectNodeContents(part);
  return edge === 'start' ? { node: r.startContainer, offset: r.startOffset } : { node: r.endContainer, offset: r.endOffset };
};

/** A drag that starts inside one card's part and is dragged out — into another part, another
 * card, or empty canvas — still produces a live, growing browser Selection spanning both; left
 * alone, the quote below comes out of (or is attributed to) the wrong part. Selection is scoped to
 * a single card (the pasted spec's own words), so a selection that strays past the *drag's own
 * starting* part is truncated right back to it. That's `anchorNode`/`anchorOffset` (where the drag
 * began), not `range.startContainer` — a backward drag (mouse down in the later part, dragged left
 * into an earlier one) has those reversed, and clamping to document-order "start" would clamp to
 * the wrong part entirely. */
const clampToAnchorPart = (sel: Selection): void => {
  const anchorNode = sel.anchorNode;
  const focusNode = sel.focusNode;
  if (!anchorNode || !focusNode) return;
  const anchorPart = closestEl(anchorNode, 'data-part');
  if (!anchorPart || closestEl(focusNode, 'data-part') === anchorPart) return;
  const forward = anchorNode === focusNode
    ? sel.anchorOffset <= sel.focusOffset
    : !!(anchorNode.compareDocumentPosition(focusNode) & Node.DOCUMENT_POSITION_FOLLOWING);
  const range = document.createRange();
  if (forward) {
    const end = partEdge(anchorPart, 'end');
    range.setStart(anchorNode, sel.anchorOffset);
    range.setEnd(end.node, end.offset);
  } else {
    const start = partEdge(anchorPart, 'start');
    range.setStart(start.node, start.offset);
    range.setEnd(anchorNode, sel.anchorOffset);
  }
  sel.removeAllRanges();
  sel.addRange(range);
};

export function readCanvasSelection(partTextOf: (partId: string) => string | null): CanvasSelection | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  clampToAnchorPart(sel);
  if (sel.isCollapsed || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  const quote = sel.toString().trim();
  if (!quote) return null;
  const partId = closestAttr(range.startContainer, 'data-part');
  const messageId = closestAttr(range.startContainer, 'data-message');
  if (!partId || !messageId) return null;
  // The rect is for placing the popover, not for deciding whether there is a selection: an empty
  // one is already excluded by `isCollapsed`, and a zero-size rect is a rendering question the
  // caller answers.
  const rect = range.getBoundingClientRect();
  const text = partTextOf(partId);
  return {
    messageId, partId, quote, start: text ? text.indexOf(quote) : -1, rect,
    inCanvasPane: inReactFlowPane(range.startContainer),
  };
}

/** Tracks the current selection inside the canvas, clearing it when it goes away. */
const sameSelection = (a: CanvasSelection | null, b: CanvasSelection | null): boolean =>
  a === b || (!!a && !!b && a.messageId === b.messageId && a.partId === b.partId && a.quote === b.quote && a.start === b.start
    && a.inCanvasPane === b.inCanvasPane
    && a.rect.left === b.rect.left && a.rect.top === b.rect.top && a.rect.width === b.rect.width && a.rect.height === b.rect.height);

export function useCanvasSelection(partTextOf: (partId: string) => string | null): {
  selection: CanvasSelection | null;
  clear(): void;
} {
  const [selection, setSelection] = useState<CanvasSelection | null>(null);

  // `selectionchange` fires continuously while the user drags a selection, often reporting the
  // same (messageId, partId, quote, rect) back-to-back — only commit a new object, and trigger a
  // `CanvasWorkspace` re-render, when something about it actually changed.
  const commit = (next: CanvasSelection | null): void => setSelection(prev => (sameSelection(prev, next) ? prev : next));

  // The browser's selection is an external system; this syncs with it.
  useEffect(() => {
    const onChange = (): void => commit(readCanvasSelection(partTextOf));
    document.addEventListener('selectionchange', onChange);
    return () => document.removeEventListener('selectionchange', onChange);
  }, [partTextOf]);

  // A generated-HTML part's selection never fires `selectionchange` on this document — it lives in
  // a sandboxed iframe with its own. `html-selection-bus.ts` is how PartView's bridge script tells
  // us about one; here it becomes the same `CanvasSelection` shape, offset computed the same way
  // `readCanvasSelection` does for ordinary text.
  useEffect(() => {
    return htmlSelectionBus.subscribe(() => {
      const sel = htmlSelectionBus.get();
      if (!sel) { commit(null); return; }
      const text = partTextOf(sel.partId);
      commit({
        messageId: sel.messageId, partId: sel.partId, quote: sel.quote,
        start: text ? text.indexOf(sel.quote) : -1, rect: sel.rect, inCanvasPane: sel.inCanvasPane,
      });
    });
  }, [partTextOf]);

  const clear = useCallback(() => {
    window.getSelection()?.removeAllRanges();
    setSelection(null);
  }, []);

  return { selection, clear };
}
