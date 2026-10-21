import { create } from 'zustand';
import type { Turn } from './run-and-persist';
import type { ClarifyAnswer, ClarifyQuestion } from './clarify';

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
  /** Names of the skills injected into this turn's system prompt (P7). Live only; not persisted. */
  skills?: string[];
  /** Questions waiting for the user's answers before the reply starts. Live only. */
  clarify?: ClarifyQuestion[];
  /** What was answered, shown as a summary above the reply. */
  clarified?: ClarifyAnswer[];
  /** Notes the model has filed during this reply; each shows as a card under the answer. */
  notes?: Array<{ id: string; title: string }>;
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

/** Which skills a reply was given and why (P7); kept in memory so the last turn's choice stays visible. */
export interface SkillUse { name: string; reason: 'picked' | 'always' | 'pinned' | 'match'; score: number }

interface ChatStore {
  skillsUsed: Record<string, SkillUse[] | undefined>;
  setSkillsUsed(key: string, used: SkillUse[]): void;
  live: Record<string, LiveTurn | undefined>;
  failed: Record<string, FailedTurn | undefined>;
  cont: Record<string, ContinueState | undefined>;
  setLive(threadId: string, turn: LiveTurn | undefined): void;
  patchLive(threadId: string, patch: Partial<LiveTurn>): void;
  setFailed(threadId: string, failed: FailedTurn | undefined): void;
  setContinue(key: string, state: ContinueState | undefined): void;
}

export const useChatStore = create<ChatStore>((set) => ({
  skillsUsed: {},
  setSkillsUsed: (key, used) => set(s => ({ skillsUsed: { ...s.skillsUsed, [key]: used } })),
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
