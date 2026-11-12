import { flags } from '../flags';
import type { ChatMessage, ChatProvider, ProviderEvent, ProviderId, ToolRunnerLike, ToolSpecLike } from '../providers/types';
import { subscriptionProvider } from '../providers/subscription';
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
  providers: Record<'claude' | 'deepseek', ChatProvider> & Partial<Record<'openai' | 'gemini', ChatProvider>>;
  /** Whether a DeepSeek key is stored; without one there is nothing to fall back to. */
  canFallBackToDeepSeek: boolean;
}

/** An event, tagged with the plan that produced it (the cost of a reply depends on which model answered). */
export interface TurnEvent { ev: ProviderEvent; plan: SupportedPlan }

export const FALLBACK_STATUS = 'Claude rate limited — switching to DeepSeek…';

const DEEPSEEK_FALLBACK: SupportedPlan = { supported: true, provider: 'deepseek', modelId: 'deepseek-v4-flash', thinking: false, usageProvider: 'deepseek' };

export async function* runTurn(input: RunTurnInput, deps: RunTurnDeps): AsyncGenerator<TurnEvent> {
  if (!flags.chat && !flags.canvas && !flags.notesV2 && !flags.sketch) {
    yield {ev:{t:'error',kind:'config',message:'AI workspaces are disabled.'},plan:input.plan};return;
  }
  let plan = input.plan;
  let switched = false;
  while (true) {
    const provider = plan.modelId.startsWith('sub:') ? subscriptionProvider : deps.providers[plan.provider];
    const enabled = plan.modelId.startsWith('sub:') ? (plan.modelId.includes('chatgpt') ? flags.subscriptionChatgpt : flags.subscriptionClaude) : ({claude:flags.apiAnthropic,deepseek:flags.apiDeepseek,openai:flags.apiOpenai,gemini:flags.apiGemini}[plan.provider]);
    if (!provider || !enabled) {
      yield { ev: { t: 'error', kind: 'config', message: `No ${plan.provider} provider is available.` }, plan };
      return;
    }
    let streamedText = false;
    let retryOnDeepSeek = false;
    for await (const ev of provider.stream({
      messages: input.messagesFor(plan.provider).map(message=>!flags.attachments&&Array.isArray(message.content)?{...message,content:message.content.filter(block=>!['image','document'].includes(block.type))}:message), systemPrompt: input.systemPrompt, tools: input.tools ?? [], toolRunner: input.toolRunner,
      model: plan.modelId, thinking: plan.thinking, signal: input.signal,
    })) {
      if (ev.t === 'delta' && ev.text) streamedText = true;
      // Only before any text has streamed: a half-written answer is kept, not replaced.
      if (ev.t === 'error' && ev.kind === 'rate_limit' && plan.provider === 'claude' && !plan.modelId.startsWith('sub:') && !switched && !streamedText && deps.canFallBackToDeepSeek && flags.apiDeepseek) {
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
