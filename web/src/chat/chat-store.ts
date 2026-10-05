import { create } from 'zustand';
import type { Turn } from './run-and-persist';

// Runtime-only chat state: the reply currently streaming in each thread, and
// the last reply that failed (so "Try again" has something to retry). Nothing
// here is persisted; the persisted record is the thread's `stream` HTML, which
// db/turn-ops.ts writes. Flat, per CLAUDE.md.

export interface LiveTurn {
  turnId: string;
  userText: string;
  /** The bubble's inner HTML, when it is not just the text (the popover's Ask). */
  bubbleHTML?: string;
  text: string;
  thinking: string;
  /** "Searching…", "Claude rate limited — switching to DeepSeek…"; null when there is nothing to say. */
  status: string | null;
}

export interface FailedTurn {
  turnId: string;
  /** Config errors offer Settings; anything else offers a retry. */
  config: boolean;
  /** Exactly what to run again, so a retried "Continue" is still a Continue. */
  turn?: Turn;
}

/** A reply that was cut short this session, and how many times it has been continued. */
export interface ContinueState { turnId: string; count: number }

interface ChatStore {
  live: Record<string, LiveTurn | undefined>;
  failed: Record<string, FailedTurn | undefined>;
  cont: Record<string, ContinueState | undefined>;
  setLive(threadId: string, turn: LiveTurn | undefined): void;
  patchLive(threadId: string, patch: Partial<LiveTurn>): void;
  setFailed(threadId: string, failed: FailedTurn | undefined): void;
  setContinue(key: string, state: ContinueState | undefined): void;
}

export const useChatStore = create<ChatStore>((set) => ({
  live: {},
  failed: {},
  cont: {},
  setLive: (threadId, turn) => set(s => ({ live: { ...s.live, [threadId]: turn } })),
  patchLive: (threadId, patch) => set(s => {
    const cur = s.live[threadId];
    return cur ? { live: { ...s.live, [threadId]: { ...cur, ...patch } } } : s;
  }),
  setFailed: (threadId, failed) => set(s => ({ failed: { ...s.failed, [threadId]: failed } })),
  setContinue: (key, state) => set(s => ({ cont: { ...s.cont, [key]: state } })),
}));
