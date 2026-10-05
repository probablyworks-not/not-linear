import type { ChatMessage, ChatProvider, ProviderEvent, ProviderId, ToolRunnerLike, ToolSpecLike } from '../providers/types';
import type { ModelPlan } from './models';

// One reply, start to finish, as a stream of events. DOM-free and store-free so
// a future VS Code extension can reuse it, and so the Claude→DeepSeek fallback
// (bug #023) is testable with fake providers.

export type SupportedPlan = Extract<ModelPlan, { supported: true }>;

export interface RunTurnInput {
  /**
   * The messages to send, built for the provider that will receive them: Claude gets PDFs and
   * images as native blocks, DeepSeek gets text only. Asked again if the turn falls back.
   */
  messagesFor(provider: ProviderId): ChatMessage[];
  systemPrompt: string;
  plan: SupportedPlan;
  signal: AbortSignal;
  /** The tools on offer, and how to run them. Without a runner none are offered. */
  tools?: readonly ToolSpecLike[];
  toolRunner?: ToolRunnerLike;
}

export interface RunTurnDeps {
  providers: Record<'claude' | 'deepseek', ChatProvider>;
  /** Whether a DeepSeek key is stored; without one there is nothing to fall back to. */
  canFallBackToDeepSeek: boolean;
}

/** An event, tagged with the plan that produced it (the cost of a reply depends on which model answered). */
export interface TurnEvent { ev: ProviderEvent; plan: SupportedPlan }

export const FALLBACK_STATUS = 'Claude rate limited — switching to DeepSeek…';

const DEEPSEEK_FALLBACK: SupportedPlan = { supported: true, provider: 'deepseek', modelId: 'deepseek-v4-flash', thinking: false, usageProvider: 'deepseek' };

export async function* runTurn(input: RunTurnInput, deps: RunTurnDeps): AsyncGenerator<TurnEvent> {
  let plan = input.plan;
  let switched = false;
  while (true) {
    const provider = deps.providers[plan.provider as 'claude' | 'deepseek'];
    let streamedText = false;
    let retryOnDeepSeek = false;
    for await (const ev of provider.stream({
      messages: input.messagesFor(plan.provider), systemPrompt: input.systemPrompt, tools: input.tools ?? [], toolRunner: input.toolRunner,
      model: plan.modelId, thinking: plan.thinking, signal: input.signal,
    })) {
      if (ev.t === 'delta' && ev.text) streamedText = true;
      // Only before any text has streamed: a half-written answer is kept, not replaced.
      if (ev.t === 'error' && ev.kind === 'rate_limit' && plan.provider === 'claude' && !switched && !streamedText && deps.canFallBackToDeepSeek) {
        retryOnDeepSeek = true;
        break;
      }
      yield { ev, plan };
    }
    if (!retryOnDeepSeek) return;
    switched = true;
    plan = DEEPSEEK_FALLBACK;
    yield { ev: { t: 'status', label: FALLBACK_STATUS }, plan };
  }
}

export type { ProviderId };
