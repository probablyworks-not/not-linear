export function initAnnotations(options: { getThreadId(): string; isChat(): boolean }): {
  refresh(): void;
  remove(threadId: string, branchIds?: ReadonlySet<string>): void;
};
