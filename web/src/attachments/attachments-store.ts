import { create } from 'zustand';
import type { Attachment } from './read-files';

// Files waiting to be sent with the next message, per composer. Runtime only, never saved:
// legacy keeps them in memory too, and once sent they live on only as chips in the bubble.
//
// A key names a composer: `thread:<id>` is the main one, `branch:<id>` a branch panel's. A
// branch's message carries BOTH its own files and its thread's (legacy getBranchContextFiles),
// but sending from a branch clears only the branch's.

export const threadAttachKey = (threadId: string): string => `thread:${threadId}`;
export const branchAttachKey = (branchId: string): string => `branch:${branchId}`;

interface AttachmentsStore {
  files: Record<string, Attachment[] | undefined>;
  /** Set while the Context panel is being used to pick branches as context for this composer. */
  picker: { key: string } | null;
  add(key: string, files: readonly Attachment[]): void;
  remove(key: string, index: number): void;
  clear(key: string): void;
  setPicker(key: string | null): void;
}

export const useAttachments = create<AttachmentsStore>(set => ({
  files: {},
  picker: null,
  add: (key, files) => set(s => ({ files: { ...s.files, [key]: [...(s.files[key] ?? []), ...files] } })),
  remove: (key, index) => set(s => ({ files: { ...s.files, [key]: (s.files[key] ?? []).filter((_, i) => i !== index) } })),
  clear: key => set(s => ({ files: { ...s.files, [key]: [] } })),
  setPicker: key => set({ picker: key ? { key } : null }),
}));

/** What a message from this composer carries (a branch also carries its thread's). */
export function filesFor(key: string, threadKey?: string): Attachment[] {
  const all = useAttachments.getState().files;
  return [...(threadKey && threadKey !== key ? all[threadKey] ?? [] : []), ...(all[key] ?? [])];
}
