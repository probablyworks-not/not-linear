// The AbortController of each branch's in-flight reply. Kept apart from the store because a
// controller is not state anything renders from, and from actions.ts so closing or deleting a
// panel can stop its stream without importing the code that starts one.

const controllers = new Map<string, AbortController>();

export function registerBranchStream(id: string, controller: AbortController): void {
  controllers.set(id, controller);
}

export function clearBranchStream(id: string): void {
  controllers.delete(id);
}

export function isBranchStreaming(id: string): boolean {
  return controllers.has(id);
}

/** Stops a branch's reply, if one is running. */
export function abortBranchStream(id: string, reason = 'branch_removed'): void {
  controllers.get(id)?.abort(reason);
}
