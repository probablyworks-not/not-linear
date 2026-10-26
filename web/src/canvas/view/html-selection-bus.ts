// A generated-HTML part renders in a sandboxed iframe (`srcDoc`) — a separate document with its
// own `window.getSelection()`, invisible to the parent's `selectionchange` listener
// (`useCanvasSelection.ts`). The bridge script PartView.tsx injects reports a selection made
// inside that document back to the parent via `postMessage`; this is where it lands, in the same
// external-store shape as `live-text.ts`, so `useCanvasSelection` can fold it into the one
// `CanvasSelection` state the "Ask about this" popover already reads.

export interface HtmlSelection {
  messageId: string;
  partId: string;
  quote: string;
  rect: { left: number; top: number; width: number; height: number };
  /** Whether the iframe this came from sits inside the ReactFlow pane right now — false for the
   * same part rendered in Reading View or the Output Detail overlay, which are plain scrolling
   * panels outside canvas/flow coordinate space (see `CanvasSelection.inCanvasPane`). */
  inCanvasPane: boolean;
}

let current: HtmlSelection | null = null;
const listeners = new Set<() => void>();

export const htmlSelectionBus = {
  emit(sel: HtmlSelection | null): void { current = sel; listeners.forEach(fn => fn()); },
  get: () => current,
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  },
};
