import { isUntitledTitle } from './thread-ops';
import { upsertTurn } from '../chat/stream-html';
import { titleFromPrompt } from '../chat/title';
import { addUsageToBucket, type TurnUsage } from '../chat/usage';
import { esc } from '../lib/markdown';
import type { ChatMessage } from '../providers/types';
import type { ClarifyAnswer } from '../chat/clarify';
import type { PersistedState } from './types';

// The one place a chat turn becomes a change to the shared `state` row. Pure,
// so the exact fields a turn touches (and, as important, the ones it does not)
// are testable without a database. Mirrors saveMainTurnProgress (app.js:664).

export interface TurnSnapshot {
  turnId: string;
  /** Pre-built markup for this turn; see chat/stream-html. `ai` null removes the assistant element. */
  userHTML: string;
  aiHTML: string | null;
  /** The model history before this turn, as it was when the turn began. */
  history: ChatMessage[];
  userText: string;
  /** null while the reply is empty or was dropped: legacy removes both entries then. */
  assistantText: string | null;
  /** Set on the first send of an untitled chat. */
  titleSeed?: string;
  /** Set once, on the write that records a finished reply. */
  usage?: TurnUsage;
  markUnread?: boolean;
  /** The user's answers to this turn's clarifying questions. Additive on the thread: the classic app keeps unknown fields. */
  clarified?: ClarifyAnswer[];
}

/** Returns false when the thread no longer exists (deleted mid-stream), so nothing is resurrected. */
export function applyTurnSnapshot(state: PersistedState, threadId: string, snap: TurnSnapshot): boolean {
  const thread = state.threads[threadId];
  if (!thread || state.deletedThreads.includes(threadId)) return false;

  thread.stream = upsertTurn(typeof thread.stream === 'string' ? thread.stream : '', snap.turnId, snap.userHTML, snap.aiHTML);
  thread.mainMessages = snap.assistantText === null
    ? [...snap.history]
    : [...snap.history, { role: 'user', content: snap.userText }, { role: 'assistant', content: snap.assistantText }];

  if (snap.titleSeed && thread.kind === 'chat' && isUntitledTitle(thread.title)) {
    const title = titleFromPrompt(snap.titleSeed);
    thread.title = title;
    thread.h1 = esc(title);
    const entry = state.dynamic.find(d => d.id === threadId);
    if (entry) entry.title = title;
  }
  if (snap.usage) addUsageToBucket(thread, snap.usage);
  if (snap.markUnread) thread.unread = true;
  if (snap.clarified?.length) {
    const saved = (thread.clarifications ?? {}) as Record<string, ClarifyAnswer[]>;
    thread.clarifications = { ...saved, [snap.turnId]: snap.clarified };
  }
  return true;
}
