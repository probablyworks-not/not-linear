// Lets a globally-mounted surface (the canvas search palette, sibling to `CanvasWorkspace` in
// `AppShell`, not a descendant of it) ask the open workspace to do something, without routing it
// through the document or a prop chain that does not exist between siblings.
//
// Direct handoff, not a subscribable store: "one canvas per tab" (DECISIONS.md) means at most one
// workspace is ever mounted, so there is never more than one registrant to pick between.

export interface CanvasHandlers {
  /** Pan/zoom the camera to frame this thread's node. */
  focusThread(threadId: string): void;
  /** Open the full-text detail view for one reply. */
  openOutputDetail(messageId: string): void;
}

let current: { canvasId: string; handlers: CanvasHandlers } | null = null;

/** Called once by the mounted `Workspace`. The returned cleanup must run on unmount. */
export function registerCanvasHandlers(canvasId: string, handlers: CanvasHandlers): () => void {
  current = { canvasId, handlers };
  return () => { if (current?.canvasId === canvasId) current = null; };
}

export function focusCanvasThread(canvasId: string, threadId: string): void {
  if (current?.canvasId === canvasId) current.handlers.focusThread(threadId);
}

export function openCanvasOutputDetail(canvasId: string, messageId: string): void {
  if (current?.canvasId === canvasId) current.handlers.openOutputDetail(messageId);
}
