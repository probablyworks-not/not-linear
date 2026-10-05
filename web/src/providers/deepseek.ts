// DeepSeek's OpenAI-compatible chat/completions endpoint, ported from
// frontend/providers/deepseek.js. One model id (`deepseek-v4-flash`); reasoning is the
// `thinking` request parameter, not a different model (bug #044).
//
// The tool loop has more guard rails than Claude's, each one a bug that happened:
//  * only two tool rounds, then the model is made to answer from what it has (#015);
//  * thinking mode offers no tools at all;
//  * it can write its tool call as markup in the visible text, which is filtered out (#018);
//  * if it stalls or is stopped AFTER tool results arrived, those results are shown as the
//    answer instead of being lost (#012, #017).

import { readApiKeys } from '../lib/api-keys';
import {
  beginBackendTrace, endBackendTrace, loggedFetch, readLoggedErrorPayload, summarizeMessagesForLog,
  MODEL_CONNECT_TIMEOUT_MS, MODEL_STREAM_IDLE_TIMEOUT_MS, TOOL_SYNTHESIS_IDLE_TIMEOUT_MS, DEEPSEEK_MAX_TOOL_ROUNDS,
} from '../lib/api-client';
import { isToolFatal, toolResultFallbackMarkdown, toolStatusLabel, type ToolResultRecord } from '../tools/tool-runners';
import { toOpenAITools, type ToolSpec } from './tool-specs';
import { consumeDeepSeekVisibleContent, synthesisOnlyMessages } from './deepseek-markup';
import { errorKindOf, messageOf, sseData } from './sse';
import type { ChatMessage, ChatProvider, ChatRequest, ErrorKind, ProviderEvent, TokenUsage } from './types';

const ENDPOINT = 'https://api.deepseek.com/v1/chat/completions';
const MAX_REQUESTS = 10;

interface WireToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }
interface WireMessage { role: string; content: string | null; tool_calls?: WireToolCall[]; tool_call_id?: string }

interface DeepSeekEvent {
  usage?: { prompt_tokens?: number; prompt_cache_hit_tokens?: number; completion_tokens?: number };
  choices?: Array<{
    finish_reason?: string | null;
    delta?: { content?: string; reasoning_content?: string; tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }> };
  }>;
}

/** DeepSeek takes text only: a message that is blocks (it should not be) keeps just its text. */
function plainText(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content;
  return content.map(b => (b.type === 'text' ? String(b.text ?? '') : '')).filter(Boolean).join('\n\n');
}

export const deepseekProvider: ChatProvider = {
  id: 'deepseek',
  caps: { thinking: true, nativeToolUse: true, maxToolRounds: DEEPSEEK_MAX_TOOL_ROUNDS },

  async *stream(req: ChatRequest): AsyncGenerator<ProviderEvent> {
    const { signal, model } = req;
    const key = readApiKeys().deepseek;
    if (!key) {
      yield { t: 'error', kind: 'config', message: 'No DeepSeek API key — add it in Settings (⚙).' };
      return;
    }
    const runner = req.toolRunner;
    const specs = (runner ? req.tools : []) as readonly ToolSpec[];
    const trace = beginBackendTrace('llm', {
      provider: 'deepseek', model, messages: summarizeMessagesForLog(req.messages), tools: specs.map(t => t.name),
      maxToolRounds: DEEPSEEK_MAX_TOOL_ROUNDS,
    });
    const fail = (kind: ErrorKind, message: string, meta: Record<string, unknown> = {}): ProviderEvent => {
      endBackendTrace(trace, kind === 'aborted' ? 'abort' : 'error', { provider: 'deepseek', model, error: message, ...meta });
      return { t: 'error', kind, message };
    };

    let current: WireMessage[] = [{ role: 'system', content: req.systemPrompt }, ...req.messages.map(m => ({ role: m.role, content: plainText(m.content) }))];
    let inputTokens = 0;
    let cacheHit = 0;
    let outputTokens = 0;
    let full = '';
    let requestCount = 0;
    let toolRounds = 0;
    let lastToolResults: ToolResultRecord[] = [];
    const usageOf = (stopReason?: string): TokenUsage => ({
      inputTokens, outputTokens, cacheHitTokens: cacheHit, stopReason, requestCount,
      context: { system: req.systemPrompt, messages: current, tools: specs.map(t => t.name) },
    });

    /** The retrieved results, shown as the answer, when the model could not turn them into one. */
    const salvage = (reason: string): ProviderEvent[] | null => {
      if (!lastToolResults.length || requestCount <= 1 || full.trim().length >= 500) return null;
      const fallback = toolResultFallbackMarkdown(lastToolResults);
      if (!fallback) return null;
      const addition = (full.trim() ? '\n\n' : '') + fallback;
      full += addition;
      endBackendTrace(trace, 'end', { provider: 'deepseek', model, inputTokens, outputTokens, requestCount, finishReason: reason, outputChars: full.length });
      return [{ t: 'status', label: '' }, { t: 'delta', text: addition }, { t: 'done', text: full, usage: usageOf(reason) }];
    };
    const aborted = (): ProviderEvent[] => salvage('aborted_after_tool_results')
      ?? [fail('aborted', 'Response stopped before completion.', { requestCount, outputChars: full.length })];

    while (true) {
      if (signal.aborted) { yield* aborted(); return; }
      if (requestCount >= MAX_REQUESTS) {
        yield fail('other', 'Reached the 10-turn tool use limit — try a more specific question.', { outputChars: full.length });
        return;
      }

      // Tools are offered only while under the round limit, and never in thinking mode. Once they
      // are spent, the model is told to answer from the results already in the conversation.
      const canUseTools = specs.length > 0 && !req.thinking && toolRounds < DEEPSEEK_MAX_TOOL_ROUNDS;
      const synthesizing = !canUseTools && toolRounds > 0;
      if (synthesizing && lastToolResults.length) yield { t: 'status', label: 'Synthesizing answer from retrieved sources…' };
      const requestMessages = synthesizing ? synthesisOnlyMessages(current) : current;

      let res: Awaited<ReturnType<typeof loggedFetch>>;
      try {
        requestCount += 1;
        res = await loggedFetch(ENDPOINT, {
          method: 'POST',
          signal,
          headers: { 'content-type': 'application/json', Authorization: `Bearer ${key}` },
          body: JSON.stringify({
            model, max_tokens: 8192, stream: true, messages: requestMessages,
            ...(canUseTools ? { tools: toOpenAITools(specs), tool_choice: 'auto' } : {}),
            ...(req.thinking ? { thinking: { type: 'enabled' }, reasoning_effort: 'high' } : { thinking: { type: 'disabled' } }),
          }),
        }, { provider: 'deepseek', label: `chat:${model}`, timeoutMs: MODEL_CONNECT_TIMEOUT_MS });
      } catch (e) {
        const kind = errorKindOf(e, signal);
        if (kind === 'aborted') { yield* aborted(); return; }
        yield fail(kind, messageOf(e, 'Network error — check your connection.'), { outputChars: full.length });
        return;
      }

      if (!res.ok) {
        const err = await readLoggedErrorPayload(res, { provider: 'deepseek', label: `chat:${model}` });
        const msg = err.error?.message || '';
        const status = res.status;
        if (status === 401) yield fail('config', 'Invalid DeepSeek API key.', { status });
        else if (status === 429) yield fail('rate_limit', 'DeepSeek rate limit hit — wait a moment, switch models, or reduce concurrent chats.', { status });
        else if (status === 402) yield fail('config', 'DeepSeek out of credits — top up at platform.deepseek.com.', { status });
        else yield fail('other', msg || `DeepSeek error ${status}`, { status });
        return;
      }

      const tcBuf: Record<number, { id: string; name: string; args: string }> = {};
      let finishReason: string | null = null;
      let usageFinal: DeepSeekEvent['usage'];
      let emittedText = false;
      let held = '';
      let suppressedPseudo = false;
      // After tool results are in hand a stalled answer must surface fast (bug #012), so the idle timeout is shorter.
      const waitingOnSynthesis = requestCount > 1 && lastToolResults.length > 0;

      /** Text through the markup filter, as events; holds a tail back in case it starts a tag. */
      const emit = (chunk: string, force = false): ProviderEvent[] => {
        const c = consumeDeepSeekVisibleContent(held + chunk, force);
        held = c.rest;
        suppressedPseudo = suppressedPseudo || c.suppressed;
        if (!c.visible) return [];
        const out: ProviderEvent[] = [];
        if (!emittedText) {
          emittedText = true;
          if (requestCount > 1 && full.trim() && !/\n\s*\n$/.test(full)) { full += '\n\n'; out.push({ t: 'delta', text: '\n\n' }); }
        }
        full += c.visible;
        out.push({ t: 'delta', text: c.visible });
        return out;
      };

      try {
        for await (const raw of sseData(res, signal, waitingOnSynthesis ? 'DeepSeek synthesis' : 'DeepSeek stream', waitingOnSynthesis ? TOOL_SYNTHESIS_IDLE_TIMEOUT_MS : MODEL_STREAM_IDLE_TIMEOUT_MS)) {
          let evt: DeepSeekEvent;
          try { evt = JSON.parse(raw) as DeepSeekEvent; } catch { continue; }
          if (evt.usage) usageFinal = evt.usage;
          const choice = evt.choices?.[0];
          if (!choice) continue;
          finishReason = choice.finish_reason || finishReason;
          const delta = choice.delta;
          if (delta?.reasoning_content) yield { t: 'thinking', text: delta.reasoning_content };
          if (delta?.content) yield* emit(delta.content);
          for (const tc of delta?.tool_calls ?? []) {
            const slot = (tcBuf[tc.index] ??= { id: '', name: '', args: '' });
            if (tc.id) slot.id += tc.id;
            if (tc.function?.name) slot.name += tc.function.name;
            if (tc.function?.arguments) slot.args += tc.function.arguments;
          }
        }
        yield* emit('', true); // the stream is over: whatever was held back is text after all
      } catch (e) {
        const kind = errorKindOf(e, signal);
        if (kind === 'aborted') { yield* aborted(); return; }
        // Stalled after the search finished, before any answer: show what was found rather than nothing.
        if (waitingOnSynthesis && !emittedText) {
          const fallback = toolResultFallbackMarkdown(lastToolResults);
          if (fallback) {
            yield { t: 'status', label: '' };
            yield { t: 'delta', text: fallback };
            endBackendTrace(trace, 'end', { provider: 'deepseek', model, inputTokens, outputTokens, requestCount, finishReason: 'tool_synthesis_timeout', outputChars: fallback.length });
            yield { t: 'done', text: fallback, usage: usageOf('tool_synthesis_timeout') };
            return;
          }
        }
        yield fail(kind, messageOf(e, 'Stream interrupted — partial response preserved.'), { outputChars: full.length });
        return;
      }

      if (usageFinal) {
        inputTokens += usageFinal.prompt_tokens || 0;
        cacheHit += usageFinal.prompt_cache_hit_tokens || 0;
        outputTokens += usageFinal.completion_tokens || 0;
      }

      if (finishReason !== 'tool_calls' || !runner) {
        // Markup was cut out and what is left is too short to be an answer: the model meant to call a
        // tool and mangled it. Show what was retrieved instead of a near-empty reply.
        if (suppressedPseudo && lastToolResults.length && full.trim().length < 500) {
          const fallback = toolResultFallbackMarkdown(lastToolResults);
          if (fallback) {
            const addition = (full.trim() ? '\n\n' : '') + fallback;
            full += addition;
            yield { t: 'delta', text: addition };
            finishReason = 'pseudo_tool_call_filtered';
          }
        }
        endBackendTrace(trace, 'end', { provider: 'deepseek', model, inputTokens, outputTokens, requestCount, toolRounds, finishReason, outputChars: full.length });
        // DeepSeek says 'length'; the Continue affordance reads Anthropic's 'max_tokens'.
        yield { t: 'done', text: full, usage: usageOf(finishReason === 'length' ? 'max_tokens' : finishReason ?? undefined) };
        return;
      }

      const toolCalls: WireToolCall[] = Object.values(tcBuf).map(tc => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.args } }));
      if (!toolCalls.length) {
        yield fail('other', 'DeepSeek requested a tool call but did not send a usable tool request.', { requestCount, toolRounds, outputChars: full.length });
        return;
      }
      current = [...current, { role: 'assistant', content: full || null, tool_calls: toolCalls }];

      // One at a time, unlike Claude's parallel run: each result is appended as it arrives.
      const records: ToolResultRecord[] = [];
      for (const tc of toolCalls) {
        if (signal.aborted) { yield* aborted(); return; }
        let input: Record<string, unknown> = {};
        try { input = JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>; } catch { /* a malformed call degrades to empty input */ }
        const name = tc.function.name;
        yield { t: 'status', label: toolStatusLabel(name, input) };
        let result: string;
        try {
          result = await runner(name, input, signal);
        } catch (e) {
          if (e instanceof Error && e.name === 'AbortError') { yield* aborted(); return; }
          if (isToolFatal(e)) {
            yield { t: 'status', label: '' };
            yield fail('other', (e as Error).message, { requestCount, tool: name, outputChars: full.length });
            return;
          }
          result = `Tool error (${name}): ${messageOf(e, 'failed')}`;
        }
        records.push({ name, input, content: result });
        current = [...current, { role: 'tool', tool_call_id: tc.id, content: result }];
      }
      toolRounds += 1;
      // Remembered so a stalled or stopped synthesis afterwards still has the results to fall back on.
      lastToolResults = records;
      yield { t: 'status', label: toolRounds >= DEEPSEEK_MAX_TOOL_ROUNDS ? 'Synthesizing answer from retrieved sources…' : 'Synthesizing tool results…' };
    }
  },
};
