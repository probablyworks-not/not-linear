import { useChatStore } from './chat-store';
import { createDebouncedWriter } from '../lib/debounced-writer';
import { readApiKeys } from '../lib/api-keys';
import { friendlyError } from '../lib/markdown';
import { claudeProvider } from '../providers/claude';
import { deepseekProvider } from '../providers/deepseek';
import type { TurnSnapshot } from '../db/turn-ops';
import { planModel } from './models';
import { runTurn, type RunTurnDeps } from './run-turn';
import { availableTools } from '../providers/tool-specs';
import { executeTool } from '../tools/tool-runners';
import { toolEnv } from '../tools/env';
import { aiTurnHTML, userTurnHTML, type AiTurnContent } from './stream-html';
import { useAppStore } from '../state/app-store';
import type { ChatMessage, ProviderId } from '../providers/types';
import type { Attachment } from '../attachments/read-files';
import { userBubbleInnerHTML, userContentFor } from './user-content';
import { sourcesLabel } from './project-context';
import type { TurnUsage } from './usage';

// One reply, start to finish, saved as it goes. The main thread and every branch panel run
// this same flow; they differ only in WHERE a turn is written and which model and system
// prompt apply, which is what a TurnHost supplies. A turn is saved three ways (CLAUDE.md
// "debounce, don't blast"): the first write, and the final one, are immediate; text arriving
// in between coalesces to one write per 350ms per host, as legacy's
// scheduleSaveMainTurnProgress does.

const SAVE_DEBOUNCE_MS = 350;
const saveWriter = createDebouncedWriter<string>(SAVE_DEBOUNCE_MS);

const defaultDeps = (): RunTurnDeps => ({
  providers: { claude: claudeProvider, deepseek: deepseekProvider },
  canFallBackToDeepSeek: !!readApiKeys().deepseek,
});

/** Swapped by tests; production always uses the real providers. */
let depsFactory: () => RunTurnDeps = defaultDeps;
export function setRunTurnDepsForTests(factory: (() => RunTurnDeps) | null): void {
  depsFactory = factory ?? defaultDeps;
}

export interface Turn {
  turnId: string;
  /** What is sent to the model and saved in the message list. */
  userText: string;
  /** What the user's bubble shows, when it differs from `userText` (the popover's Ask). */
  bubbleHTML?: string;
  history: ChatMessage[];
  /**
   * The exact messages to send, when they are not simply `history` plus the question: a branch
   * sends the whole ancestor chain, while `history` stays the branch's OWN messages (what it saves).
   */
  messagesFor?: (provider: ProviderId) => ChatMessage[];
  /** Files attached to this message: shown as chips in the bubble, and given to the model. */
  files?: readonly Attachment[];
  titleSeed?: string;
  /** What the user's bubble says when that is not what is sent ("Continue"). */
  displayText?: string;
  /** How many times this reply has already been continued. */
  continueCount?: number;
  /** Relevant files from a project's linked folder, appended to the system prompt. */
  extraContext?: string;
  /** Their names and how they were chosen, shown under the reply. */
  sources?: { names: string[]; mode: string };
  /** No "Try again" for a failure (the popover's Ask has none in legacy). */
  noRetry?: boolean;
}

export interface TurnHost {
  /** Key into the chat store's `live` and `failed` maps. */
  key: string;
  /** The model preference that applies (a branch has its own). */
  modelPref(): string | undefined;
  systemPrompt(extraContext?: string): string;
  /** Writes one snapshot of the turn into wherever this host keeps its conversation. */
  write(snap: TurnSnapshot): Promise<void>;
  register(controller: AbortController): void;
  clear(): void;
}

export function snapshotOf(turn: Turn, content: AiTurnContent | null, assistantText: string | null, usage?: TurnUsage): TurnSnapshot {
  return {
    turnId: turn.turnId,
    userHTML: userTurnHTML(turn.turnId, turn.displayText ?? turn.userText, turn.bubbleHTML ?? (turn.files?.length ? userBubbleInnerHTML(turn.displayText ?? turn.userText, turn.files) : undefined)),
    aiHTML: content ? aiTurnHTML(turn.turnId, content) : null,
    history: turn.history,
    userText: turn.userText,
    assistantText,
    titleSeed: turn.titleSeed,
    usage,
  };
}

export async function runAndPersist(host: TurnHost, turn: Turn): Promise<void> {
  const key = host.key;
  const app = useAppStore.getState();
  const controller = new AbortController();
  host.register(controller);
  const chat = useChatStore.getState();
  chat.setFailed(key, undefined);
  chat.setContinue(key, undefined);
  chat.setLive(key, { turnId: turn.turnId, userText: turn.displayText ?? turn.userText, bubbleHTML: turn.bubbleHTML ?? (turn.files?.length ? userBubbleInnerHTML(turn.displayText ?? turn.userText, turn.files) : undefined), text: '', thinking: '', status: null });

  let text = '';
  let thinking = '';
  // Immediate: the user's bubble must survive a reload even if the reply never arrives.
  await host.write(snapshotOf(turn, { text: '', thinking: '' }, ''));

  const finish = async (content: AiTurnContent | null, assistantText: string | null, usage?: TurnUsage): Promise<void> => {
    saveWriter.cancel(key);
    await host.write(snapshotOf(turn, content, assistantText, usage));
    host.clear();
    useChatStore.getState().setLive(key, undefined);
  };
  const fail = async (message: string, config: boolean, aborted: boolean): Promise<void> => {
    if (text.trim()) {
      // Cut short with something to show: offer to carry on from where it stopped (legacy's showPartialStop).
      useChatStore.getState().setContinue(key, { turnId: turn.turnId, count: turn.continueCount ?? 0 });
      await finish({ text, thinking, stopNote: aborted ? 'Response stopped before completion.' : message }, text);
    } else if (aborted) {
      await finish(null, null);
    } else {
      if (!turn.noRetry) useChatStore.getState().setFailed(key, { turnId: turn.turnId, config, turn });
      await finish({ text: '', thinking, error: friendlyError(message) }, null);
    }
  };

  const plan = planModel(host.modelPref(), !!app.prefs.thinking);
  if (!plan.supported) {
    await fail(plan.reason, true, false);
    return;
  }

  const messagesFor = turn.messagesFor ?? ((p: ProviderId): ChatMessage[] => [...turn.history, { role: 'user', content: userContentFor(p, turn.userText, turn.files) }]);
  try {
    const env = toolEnv();
    const tools = availableTools({ apiKeys: env.apiKeys, searxngUrl: env.searxngUrl });
    const input = { messagesFor, systemPrompt: host.systemPrompt(turn.extraContext), plan, signal: controller.signal, tools, toolRunner: executeTool as never };
    for await (const { ev, plan: used } of runTurn(input, depsFactory())) {
      if (ev.t === 'delta') {
        text += ev.text;
        useChatStore.getState().patchLive(key, { text, status: null });
        saveWriter.schedule(key, () => host.write(snapshotOf(turn, { text, thinking }, text)));
      } else if (ev.t === 'thinking') {
        thinking += ev.text;
        useChatStore.getState().patchLive(key, { thinking });
      } else if (ev.t === 'status') {
        // An empty label clears the status line (legacy's onStatus(null)).
        useChatStore.getState().patchLive(key, { status: ev.label || null });
      } else if (ev.t === 'done') {
        const usage: TurnUsage | undefined = ev.usage && {
          inputTokens: ev.usage.inputTokens, outputTokens: ev.usage.outputTokens,
          cacheHitTokens: ev.usage.cacheHitTokens, provider: used.usageProvider, model: used.modelId,
        };
        const meta = ev.usage ? { usage: ev.usage, provider: used.usageProvider, model: used.modelId, thinking: used.thinking } : undefined;
        if (ev.usage?.stopReason === 'max_tokens') useChatStore.getState().setContinue(key, { turnId: turn.turnId, count: turn.continueCount ?? 0 });
        const sources = turn.sources?.names.length ? { names: turn.sources.names, ...sourcesLabel(turn.sources.mode) } : undefined;
        await finish({ text: ev.text, thinking, meta, sources }, ev.text, usage);
        return;
      } else if (ev.t === 'error') {
        await fail(ev.message, ev.kind === 'config', ev.kind === 'aborted');
        return;
      }
    }
    // A provider that ends without done or error is a bug in the provider; say so rather than hang.
    await fail('The response ended unexpectedly. You can retry to get a fresh answer.', false, false);
  } catch (e) {
    await fail(e instanceof Error ? e.message : String(e), false, false);
  }
}
