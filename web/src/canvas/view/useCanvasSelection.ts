import { useCallback, useEffect, useState } from 'react';

// Reading a text selection that lands inside a canvas card, and saying exactly where it came from.
// The offsets are taken against the *part's* text, not the rendered DOM, because the part text is
// what gets frozen and what an anchor resolves against later.

export interface CanvasSelection {
  messageId: string;
  partId: string;
  quote: string;
  /** Offset within the part's text. -1 when the quote could not be located. */
  start: number;
  rect: DOMRect;
}

const closestAttr = (node: Node | null, attr: string): string | null => {
  let el: HTMLElement | null = node instanceof HTMLElement ? node : node?.parentElement ?? null;
  while (el) {
    const v = el.getAttribute(attr);
    if (v) return v;
    el = el.parentElement;
  }
  return null;
};

export function readCanvasSelection(partTextOf: (partId: string) => string | null): CanvasSelection | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const quote = sel.toString().trim();
  if (!quote) return null;
  const range = sel.getRangeAt(0);
  const partId = closestAttr(range.startContainer, 'data-part');
  const messageId = closestAttr(range.startContainer, 'data-message');
  if (!partId || !messageId) return null;
  // The rect is for placing the popover, not for deciding whether there is a selection: an empty
  // one is already excluded by `isCollapsed`, and a zero-size rect is a rendering question the
  // caller answers.
  const rect = range.getBoundingClientRect();
  const text = partTextOf(partId);
  return { messageId, partId, quote, start: text ? text.indexOf(quote) : -1, rect };
}

/** Tracks the current selection inside the canvas, clearing it when it goes away. */
export function useCanvasSelection(partTextOf: (partId: string) => string | null): {
  selection: CanvasSelection | null;
  clear(): void;
} {
  const [selection, setSelection] = useState<CanvasSelection | null>(null);

  // The browser's selection is an external system; this syncs with it.
  useEffect(() => {
    const onChange = (): void => setSelection(readCanvasSelection(partTextOf));
    document.addEventListener('selectionchange', onChange);
    return () => document.removeEventListener('selectionchange', onChange);
  }, [partTextOf]);

  const clear = useCallback(() => {
    window.getSelection()?.removeAllRanges();
    setSelection(null);
  }, []);

  return { selection, clear };
}
