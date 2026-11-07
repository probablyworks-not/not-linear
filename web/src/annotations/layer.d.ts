export function initAnnotations(options: { getThreadId(): string; isChat(): boolean; getCanvasBranchId?(messageId: string): string }): {
  refresh(): void;
  remove(threadId: string, branchIds?: ReadonlySet<string>): void;
};
