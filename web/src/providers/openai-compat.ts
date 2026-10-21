// A generic client for any OpenAI-style chat/completions endpoint, ported from callOpenAICompatible
// in frontend/providers/openai.js. OpenAI and Gemini both use it: Gemini is reached through Google's
// OpenAI-compatibility layer, not a native endpoint, so the two differ only in base URL, key, and
// which token-limit parameter the endpoint accepts. No thinking mode; tool calls run one at a time
// until the model stops asking or ten requests have been made.

import { readApiKeys } from '../lib/api-keys';
import {
  beginBackendTrace, endBackendTrace, loggedFetch, readLoggedErrorPayload, summarizeMessagesForLog,
  MODEL_CONNECT_TIMEOUT_MS, MODEL_STREAM_IDLE_TIMEOUT_MS,
} from '../lib/api-client';
import { isToolFatal, toolStatusLabel } from '../tools/tool-runners';
import { toOpenAITools, type ToolSpec } from './tool-specs';
import { errorKindOf, messageOf, sseData } from './sse';
import type { ChatMessage, ChatProvider, ChatRequest, ErrorKind, ProviderEvent, ProviderId, TokenUsage } from './types';

const MAX_REQUESTS = 10;

interface WireToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }
interface WireMessage { role: string; content: string | null; tool_calls?: WireToolCall[]; tool_call_id?: string }

interface CompatEvent {
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  choices?: Array<{
    finish_reason?: string | null;
    delta?: { content?: string; tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }> };
  }>;
}

export interface CompatConfig {
  id: Extract<ProviderId, 'openai' | 'gemini'>;
  /** The name in user-facing messages. */
  label: string;
  /** Where the key lives in `nl_api_keys`. */
  keyName: string;
  baseUrl: string;
  /** OpenAI's newer models reject `max_tokens`; Gemini's compatibility layer still expects it. */
  tokenParam: 'max_completion_tokens' | 'max_tokens';
  /** Ask the stream to end with a usage chunk (OpenAI only; Gemini's layer is not asked). */
  streamUsage: boolean;
}

/** These endpoints take text only: a message that is blocks keeps just its text. */
function plainText(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content;
  return content.map(b => (b.type === 'text' ? String(b.text ?? '') : '')).filter(Boolean).join('\n\n');
}

export function makeCompatProvider(cfg: CompatConfig): ChatProvider {
  return {
    id: cfg.id,
    caps: { thinking: false, nativeToolUse: true, maxToolRounds: MAX_REQUESTS },

    async *stream(req: ChatRequest): AsyncGenerator<ProviderEvent> {
      const { signal, model } = req;
      const key = readApiKeys()[cfg.keyName];
      if (!key) {
        yield { t: 'error', kind: 'config', message: `No ${cfg.label} API key — add it in Settings (⚙).` };
        return;
      }
      const runner = req.toolRunner;
      const specs = (runner ? req.tools : []) as readonly ToolSpec[];
      const trace = beginBackendTrace('llm', { provider: cfg.id, model, messages: summarizeMessagesForLog(req.messages), tools: specs.map(t => t.name) });
      const fail = (kind: ErrorKind, message: string, meta: Record<string, unknown> = {}): ProviderEvent => {
        endBackendTrace(trace, kind === 'aborted' ? 'abort' : 'error', { provider: cfg.id, model, error: message, ...meta });
        return { t: 'error', kind, message };
      };

      let current: WireMessage[] = [{ role: 'system', content: req.systemPrompt }, ...req.messages.map(m => ({ role: m.role, content: plainText(m.content) }))];
      let inputTokens = 0;
      let outputTokens = 0;
      let full = '';
      let requestCount = 0;
      const usageOf = (stopReason?: string): TokenUsage => ({
        inputTokens, outputTokens, stopReason, requestCount,
        context: { system: req.systemPrompt, messages: current, tools: specs.map(t => t.name) },
      });

      while (true) {
        if (signal.aborted) { yield fail('aborted', 'Response stopped before completion.', { requestCount, outputChars: full.length }); return; }
        if (requestCount >= MAX_REQUESTS) {
          yield fail('other', 'Reached the 10-turn tool use limit — try a more specific question.', { outputChars: full.length });
          return;
        }

        let res: Awaited<ReturnType<typeof loggedFetch>>;
        try {
          requestCount += 1;
          res = await loggedFetch(`${cfg.baseUrl}/chat/completions`, {
            method: 'POST',
            signal,
            headers: { 'content-type': 'application/json', Authorization: `Bearer ${key}` },
            body: JSON.stringify({
              model, [cfg.tokenParam]: 8192, stream: true, messages: current,
              ...(cfg.streamUsage ? { stream_options: { include_usage: true } } : {}),
              ...(specs.length ? { tools: toOpenAITools(specs), tool_choice: 'auto' } : {}),
            }),
          }, { provider: cfg.id, label: `chat:${model}`, timeoutMs: MODEL_CONNECT_TIMEOUT_MS });
        } catch (e) {
          const kind = errorKindOf(e, signal);
          yield fail(kind, kind === 'aborted' ? 'Response stopped before completion.' : messageOf(e, 'Network error — check your connection.'), { outputChars: full.length });
          return;
        }

        if (!res.ok) {
          const err = await readLoggedErrorPayload(res, { provider: cfg.id, label: `chat:${model}` });
          const msg = err.error?.message || '';
          const status = res.status;
          if (status === 401) yield fail('config', `Invalid ${cfg.label} API key — check it in Settings.`, { status });
          else if (status === 429) yield fail('rate_limit', `${cfg.label} rate limit hit — wait a moment or switch models.`, { status });
          else yield fail('other', msg || `${cfg.label} error ${status}`, { status });
          return;
        }

        const tcBuf: Record<number, { id: string; name: string; args: string }> = {};
        let finishReason: string | null = null;
        let usageFinal: CompatEvent['usage'];
        let emittedText = false;

        try {
          for await (const raw of sseData(res, signal, `${cfg.label} stream`, MODEL_STREAM_IDLE_TIMEOUT_MS)) {
            let evt: CompatEvent;
            try { evt = JSON.parse(raw) as CompatEvent; } catch { continue; }
            if (evt.usage) usageFinal = evt.usage;
            const choice = evt.choices?.[0];
            if (!choice) continue;
            finishReason = choice.finish_reason || finishReason;
            const delta = choice.delta;
            if (delta?.content) {
              // A paragraph break before the first text of a follow-up request, so it does not run into earlier text.
              if (!emittedText) {
                emittedText = true;
                if (requestCount > 1 && full.trim() && !/\n\s*\n$/.test(full)) { full += '\n\n'; yield { t: 'delta', text: '\n\n' }; }
              }
              full += delta.content;
              yield { t: 'delta', text: delta.content };
            }
            for (const tc of delta?.tool_calls ?? []) {
              const slot = (tcBuf[tc.index] ??= { id: '', name: '', args: '' });
              if (tc.id) slot.id += tc.id;
              if (tc.function?.name) slot.name += tc.function.name;
              if (tc.function?.arguments) slot.args += tc.function.arguments;
            }
          }
        } catch (e) {
          const kind = errorKindOf(e, signal);
          yield fail(kind, kind === 'aborted' ? 'Response stopped before completion.' : messageOf(e, 'Stream interrupted — partial response preserved.'), { outputChars: full.length });
          return;
        }
        if (signal.aborted) { yield fail('aborted', 'Response stopped before completion.', { requestCount, outputChars: full.length }); return; }

        if (usageFinal) {
          inputTokens += usageFinal.prompt_tokens || 0;
          outputTokens += usageFinal.completion_tokens || 0;
        }

        if (finishReason !== 'tool_calls' || !runner) {
          endBackendTrace(trace, 'end', { provider: cfg.id, model, inputTokens, outputTokens, requestCount, finishReason, outputChars: full.length });
          // The Continue affordance reads Anthropic's 'max_tokens'; these endpoints say 'length'.
          yield { t: 'done', text: full, usage: usageOf(finishReason === 'length' ? 'max_tokens' : finishReason ?? undefined) };
          return;
        }

        const toolCalls: WireToolCall[] = Object.values(tcBuf).map(tc => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.args } }));
        if (!toolCalls.length) {
          yield fail('other', `${cfg.label} requested a tool call but did not send a usable tool request.`, { requestCount, outputChars: full.length });
          return;
        }
        current = [...current, { role: 'assistant', content: full || null, tool_calls: toolCalls }];

        for (const tc of toolCalls) {
          if (signal.aborted) { yield fail('aborted', 'Response stopped before completion.', { requestCount, outputChars: full.length }); return; }
          let input: Record<string, unknown> = {};
          try { input = JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>; } catch { /* a malformed call degrades to empty input */ }
          const name = tc.function.name;
          yield { t: 'status', label: toolStatusLabel(name, input) };
          let result: string;
          try {
            result = await runner(name, input, signal);
          } catch (e) {
            if (e instanceof Error && e.name === 'AbortError') { yield fail('aborted', 'Response stopped before completion.', { requestCount, outputChars: full.length }); return; }
            if (isToolFatal(e)) {
              yield { t: 'status', label: '' };
              yield fail('other', (e as Error).message, { requestCount, tool: name, outputChars: full.length });
              return;
            }
            result = `Tool error (${name}): ${messageOf(e, 'failed')}`;
          }
          current = [...current, { role: 'tool', tool_call_id: tc.id, content: result }];
        }
        yield { t: 'status', label: 'Thinking…' };
      }
    },
  };
}
