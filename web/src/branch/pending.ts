// "Open this once its thread is on screen." Jumping to a branch in another thread means
// switching thread first; the branch can only open after that thread's view has mounted
// (its anchors must be in the DOM for layout to find them). Legacy used a 220ms setTimeout
// for this; a one-shot callback consumed on mount does not guess.

let pending: { threadId: string; run: () => void } | null = null;

export function openWhenMounted(threadId: string, run: () => void): void {
  pending = { threadId, run };
}

/** Called by the chat view after it mounts for `threadId`. */
export function consumePending(threadId: string): void {
  if (!pending || pending.threadId !== threadId) return;
  const { run } = pending;
  pending = null;
  run();
}
