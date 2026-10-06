import { useAppStore } from '../state/app-store';
import { useChatStore } from '../chat/chat-store';
import { useBranchStore, type OpenBranch } from './branch-store';
import { branchModelPref, contentOf, specOf } from './actions';
import { abortBranchStream, clearBranchStream, isBranchStreaming, registerBranchStream } from './controllers';
import { captureSnapshotIn, type BranchSpec } from '../db/branch-ops';
import { branchChain, buildBranchContext, type ChainNode } from '../chat/branch-model';
import { CONTINUE_PROMPT, historyFor } from '../chat/send';
import { runAndPersist, type TurnHost } from '../chat/run-and-persist';
import { buildSystemPrompt } from '../chat/system-prompt';
import { readApiKeys } from '../lib/api-keys';
import { makeTurnId, turnContext, upsertTurn } from '../chat/stream-html';
import { addUsageToBucket } from '../chat/usage';
import type { ChatMessage, ProviderId } from '../providers/types';
import type { Attachment } from '../attachments/read-files';
import { userContentFor } from '../chat/user-content';
import { folderContextFor } from '../chat/project-context';
import { branchAttachKey, filesFor, threadAttachKey, useAttachments } from '../attachments/attachments-store';
import type { PersistedThread } from '../db/types';

// A branch panel's side of the shared turn flow. Two things differ from the main thread and
// both are the product: the model is sent the WHOLE ancestor chain (buildBranchContext), and
// what is saved is only the branch's own messages and body (its snapshot).

export const branchKey = (id: string): string => `branch:${id}`;

export function stopBranch(id: string): void {
  abortBranchStream(id, 'branch_stop_button');
}

export { isBranchStreaming };

/** A saved branch as a node of the ancestor chain: from the open panel if there is one, else what is saved. */
function nodeFor(thread: PersistedThread, id: string, ownMessages: ChatMessage[] | null): ChainNode | undefined {
  const open = useBranchStore.getState().open[id];
  const snap = thread.branchSnapshots?.[id];
  const recent = thread.branchRecents?.[id];
  const quote = open?.quote ?? snap?.quote ?? recent?.quote;
  if (quote === undefined) return undefined;
  return {
    id, quote,
    parentBid: open ? open.parentBid : (snap?.parentBid ?? recent?.parentBid ?? null),
    messages: ownMessages ?? ((snap?.messages ?? []) as ChatMessage[]),
  };
}

function branchHost(threadId: string, first: OpenBranch): TurnHost {
  let latest: BranchSpec = specOf(first);
  const id = first.id;
  return {
    key: branchKey(id),
    modelPref: () => branchModelPref(useBranchStore.getState().open[id] ?? latest, useAppStore.getState().prefs.model),
    systemPrompt: extraContext => {
      const app = useAppStore.getState();
      const pid = app.threadState[threadId]?.projectId;
      return buildSystemPrompt({ prefs: app.prefs, project: typeof pid === 'string' ? app.projects[pid] : undefined, apiKeys: readApiKeys(), extraContext });
    },
    write: async snap => {
      await useAppStore.getState().updateThreads(state => {
        const t = state.threads[threadId];
        const open = useBranchStore.getState().open[id];
        // A closed branch keeps receiving its reply (legacy does too); a DELETED one must not be resurrected.
        if (!t || (!open && !t.branchRecents?.[id])) return;
        if (open) latest = specOf(open);
        const prior = contentOf(t, id);
        const bucket = { tokenIn: prior.tokenIn, tokenCacheHit: prior.tokenCacheHit, tokenOut: prior.tokenOut, cost: prior.cost, provider: prior.provider, model: prior.model };
        if (snap.usage) addUsageToBucket(bucket, snap.usage);
        captureSnapshotIn(t, latest, {
          bodyHTML: upsertTurn(prior.bodyHTML, snap.turnId, snap.userHTML, snap.aiHTML),
          messages: snap.assistantText === null
            ? snap.history
            : [...snap.history, { role: 'user', content: snap.userText }, { role: 'assistant', content: snap.assistantText }],
          ...bucket,
        }, { force: true, now: Date.now() });
      });
    },
    register: c => registerBranchStream(id, c),
    clear: () => clearBranchStream(id),
  };
}

/** The whole context for one provider: main thread, ancestors, then this branch (files shaped for that provider). */
function messagesForBranch(thread: PersistedThread, threadId: string, id: string, own: ChatMessage[], text: string, files: readonly Attachment[] = []): (p: ProviderId) => ChatMessage[] {
  const chain = branchChain(id, cid => nodeFor(thread, cid, cid === id ? own : null));
  return p => buildBranchContext(historyFor(threadId), chain, text, t => userContentFor(p, t, files));
}

export async function sendBranchMessage(threadId: string, branchId: string, rawText: string, skills?: string[]): Promise<void> {
  const b = useBranchStore.getState().open[branchId];
  const thread = useAppStore.getState().threadState[threadId];
  // A branch's message carries its own files AND its page's (app.js getBranchContextFiles); only its own are used up.
  const key = branchAttachKey(branchId);
  const files = filesFor(key, threadAttachKey(threadId));
  const typed = rawText.trim();
  if (!b || !thread || (!typed && !files.length) || isBranchStreaming(branchId)) return;
  const text = typed || 'Please summarize the attached file(s).';
  const own = contentOf(thread, branchId).messages;
  useAttachments.getState().clear(key);
  const folder = await folderContextFor(threadId, typed);
  await runAndPersist(branchHost(threadId, b), {
    turnId: makeTurnId(), userText: text, history: own, files, skills,
    extraContext: folder.contextBlock, sources: { names: folder.sources, mode: folder.mode },
    messagesFor: messagesForBranch(thread, threadId, branchId, own, text, files),
  });
}

/** "Continue" inside a panel: the same ask as in the main thread, with the branch's whole context behind it. */
export async function continueBranchTurn(threadId: string, branchId: string, count: number): Promise<void> {
  const b = useBranchStore.getState().open[branchId];
  const thread = useAppStore.getState().threadState[threadId];
  if (!b || !thread || isBranchStreaming(branchId)) return;
  const own = contentOf(thread, branchId).messages;
  await runAndPersist(branchHost(threadId, b), {
    turnId: makeTurnId(), userText: CONTINUE_PROMPT, displayText: 'Continue', history: own,
    messagesFor: messagesForBranch(thread, threadId, branchId, own, CONTINUE_PROMPT), continueCount: count + 1,
  });
}

/** "Try again" inside a panel: the same question, so its bubble is not duplicated. */
export async function retryBranchTurn(threadId: string, branchId: string): Promise<void> {
  const b = useBranchStore.getState().open[branchId];
  const failed = useChatStore.getState().failed[branchKey(branchId)];
  const thread = useAppStore.getState().threadState[threadId];
  if (!b || !failed || !thread || isBranchStreaming(branchId)) return;
  if (failed.turn) { await runAndPersist(branchHost(threadId, b), failed.turn); return; }
  const content = contentOf(thread, branchId);
  const ctx = turnContext(content.bodyHTML, failed.turnId);
  if (!ctx) return;
  await runAndPersist(branchHost(threadId, b), {
    turnId: failed.turnId, userText: ctx.userText, history: content.messages,
    messagesFor: messagesForBranch(thread, threadId, branchId, content.messages, ctx.userText),
  });
}
