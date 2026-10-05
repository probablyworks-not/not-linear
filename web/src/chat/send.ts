import { useAppStore } from '../state/app-store';
import { useChatStore } from './chat-store';
import { applyTurnSnapshot } from '../db/turn-ops';
import { MAIN_THREAD_ID, STATIC_THREADS } from '../db/thread-ops';
import { buildSystemPrompt } from './system-prompt';
import { readApiKeys } from '../lib/api-keys';
import { runAndPersist, setRunTurnDepsForTests, type Turn, type TurnHost } from './run-and-persist';
import { makeTurnId, messagesFromStream, turnContext } from './stream-html';
import { threadAttachKey, useAttachments } from '../attachments/attachments-store';
import { folderContextFor } from './project-context';
import type { ChatMessage } from '../providers/types';

// The main thread's side of the shared turn flow (run-and-persist.ts): where its turns are
// written (the thread's `stream` and `mainMessages`), which model applies, and the controller
// the Stop button aborts. The branch panels' side is branch/branch-send.ts.

export { setRunTurnDepsForTests };

/** What "Continue" sends (app.js:621). */
export const CONTINUE_PROMPT = 'Continue from exactly where you stopped. Do not recap or restart; continue the previous answer from the next word or sentence.';
export type { Turn };

const controllers = new Map<string, AbortController>();

export function isStreaming(threadId: string): boolean {
  return controllers.has(threadId);
}

export function stopStreaming(threadId: string): void {
  controllers.get(threadId)?.abort();
}

/** legacy syncMessagesFromRenderedStream: the page wins when it has more turns than the list. */
export function historyFor(threadId: string): ChatMessage[] {
  const thread = useAppStore.getState().threadState[threadId];
  const saved = (Array.isArray(thread?.mainMessages) ? thread.mainMessages : []) as ChatMessage[];
  const rendered = messagesFromStream(typeof thread?.stream === 'string' ? thread.stream : '');
  return rendered.length > saved.length ? rendered : saved;
}

function mainHost(threadId: string): TurnHost {
  return {
    key: threadId,
    modelPref: () => useAppStore.getState().prefs.model,
    systemPrompt: extraContext => {
      const app = useAppStore.getState();
      const pid = app.threadState[threadId]?.projectId;
      return buildSystemPrompt({ prefs: app.prefs, project: typeof pid === 'string' ? app.projects[pid] : undefined, apiKeys: readApiKeys(), extraContext });
    },
    write: async snap => {
      const app = useAppStore.getState();
      await app.updateThreads(s => applyTurnSnapshot(s, threadId, { ...snap, markUnread: threadId !== app.currentThreadId }));
    },
    register: c => { controllers.set(threadId, c); },
    clear: () => { controllers.delete(threadId); },
  };
}

/**
 * A seed thread has no saved row until it is first opened; legacy's renderThread
 * gives it `{ kind: 'chat', title, stream: '' }` and so do we. `doc-main` is the
 * exception: its row carries the document body, which only legacy can author, so
 * until legacy has saved it there is nothing safe to continue.
 */
export async function ensureThreadRow(threadId: string): Promise<boolean> {
  const app = useAppStore.getState();
  if (app.threadState[threadId]) return true;
  if (threadId === MAIN_THREAD_ID || app.deletedThreadIds.includes(threadId)) return false;
  const title = STATIC_THREADS.find(t => t.id === threadId)?.title ?? 'Untitled chat';
  await app.updateThreads(s => { s.threads[threadId] ??= { kind: 'chat', title, stream: '' }; });
  return !!useAppStore.getState().threadState[threadId];
}

export async function sendMessage(threadId: string, rawText: string): Promise<void> {
  const key = threadAttachKey(threadId);
  const files = [...(useAttachments.getState().files[key] ?? [])];
  const typed = rawText.trim();
  if ((!typed && !files.length) || isStreaming(threadId)) return;
  if (!(await ensureThreadRow(threadId))) return;
  // Files with no question: ask for a summary; the chat is titled from what was typed, or the file names (app.js:2038).
  const userText = typed || 'Please summarize the attached file(s).';
  const titleSeed = typed || files.map(f => f.name.split('/').pop()).join(', ');
  useAttachments.getState().clear(key);
  const folder = await folderContextFor(threadId, typed);
  await runAndPersist(mainHost(threadId), {
    turnId: makeTurnId(), userText, history: historyFor(threadId), titleSeed, files,
    extraContext: folder.contextBlock, sources: { names: folder.sources, mode: folder.mode },
  });
}

/**
 * "Ask" from the selection popover (app.js:3086 askInline): a turn in the main thread whose
 * bubble reads `About: "…"` while the model is sent a fuller prompt about the passage.
 */
export async function askAbout(threadId: string, passage: string): Promise<void> {
  if (isStreaming(threadId) || !(await ensureThreadRow(threadId))) return;
  const clip = (n: number): string => (passage.length > n ? passage.slice(0, n - 1).trim() + '…' : passage);
  const esc = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]!);
  await runAndPersist(mainHost(threadId), {
    turnId: makeTurnId(),
    userText: `About this passage: "${clip(200)}"`,
    bubbleHTML: `About: <em>"${esc(clip(90))}"</em>`,
    history: historyFor(threadId),
    noRetry: true,
  });
}

/** "Continue" under a reply that was cut short: asks the model to pick up where it stopped. */
export async function continueMain(threadId: string, count: number): Promise<void> {
  if (isStreaming(threadId)) return;
  await runAndPersist(mainHost(threadId), {
    turnId: makeTurnId(), userText: CONTINUE_PROMPT, displayText: 'Continue', history: historyFor(threadId), continueCount: count + 1,
  });
}

/** "Try again": the same turn, so the user's bubble is not duplicated. */
export async function retryTurn(threadId: string): Promise<void> {
  const failed = useChatStore.getState().failed[threadId];
  if (!failed || isStreaming(threadId)) return;
  if (failed.turn) { await runAndPersist(mainHost(threadId), failed.turn); return; }
  const stream = useAppStore.getState().threadState[threadId]?.stream;
  const ctx = turnContext(typeof stream === 'string' ? stream : '', failed.turnId);
  if (!ctx) return;
  await runAndPersist(mainHost(threadId), { turnId: failed.turnId, userText: ctx.userText, history: ctx.history });
}
