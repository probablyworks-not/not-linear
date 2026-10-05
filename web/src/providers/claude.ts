// Anthropic Messages API, called straight from the browser (no proxy), ported from
// frontend/providers/claude.js. The error strings are load-bearing: friendlyError() in
// lib/markdown.ts and the rate-limit fallback both match on them, so they are kept word for word.
//
// Tools: when a request offers tools and a runner, a reply that stops with `tool_use` is not
// the end. The tools run (in parallel, so one failure cannot cancel the others), their results
// go back as a user turn, and the model continues, up to ten requests. A fatal tool failure
// (a missing or rejected key) ends the whole turn with a message the user can act on; any
// other failure goes to the model as text so it can react to it.

import { readApiKeys } from '../lib/api-keys';
import {
  beginBackendTrace, endBackendTrace, loggedFetch, readLoggedErrorPayload, summarizeMessagesForLog,
  MODEL_CONNECT_TIMEOUT_MS,
} from '../lib/api-client';
import { isToolFatal, toolStatusLabel } from '../tools/tool-runners';
import { errorKindOf, messageOf, sseData } from './sse';
import type { ChatProvider, ChatRequest, ContentBlock, ErrorKind, ProviderEvent } from './types';

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
/** A hard ceiling on tool round trips in one turn, so a model that keeps asking cannot loop forever. */
const MAX_REQUESTS = 10;

type Block =
  | { type: 'thinking'; thinking: string; signature: string }
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string };
interface WireMessage { role: string; content: string | ContentBlock[] }

interface ClaudeEvent {
  type: string;
  index?: number;
  message?: { usage?: { input_tokens?: number } };
  usage?: { output_tokens?: number };
  content_block?: { type: string; id?: string; name?: string };
  delta?: { type?: string; text?: string; thinking?: string; partial_json?: string; signature?: string; stop_reason?: string };
}

interface Acc { type: string; id?: string; name?: string; text?: string; inputJson?: string; signature?: string }

export const claudeProvider: ChatProvider = {
  id: 'claude',
  caps: { thinking: true, nativeToolUse: true, maxToolRounds: MAX_REQUESTS },

  async *stream(req: ChatRequest): AsyncGenerator<ProviderEvent> {
    const { signal, model } = req;
    const key = readApiKeys().anthropic;
    if (!key) {
      yield { t: 'error', kind: 'config', message: 'No API key — add your Anthropic key in Settings (⚙).' };
      return;
    }
    const tools = req.toolRunner ? req.tools : [];
    const trace = beginBackendTrace('llm', {
      provider: 'anthropic', model, messages: summarizeMessagesForLog(req.messages),
      tools: tools.map(t => t.name), thinking: req.thinking,
    });
    const fail = (kind: ErrorKind, message: string, meta: Record<string, unknown> = {}): ProviderEvent => {
      endBackendTrace(trace, kind === 'aborted' ? 'abort' : 'error', { provider: 'anthropic', model, error: message, ...meta });
      return { t: 'error', kind, message };
    };

    let current: WireMessage[] = req.messages.map(m => ({ role: m.role, content: m.content }));
    let inputTokens = 0;
    let outputTokens = 0;
    let full = '';
    let requestCount = 0;

    while (true) {
      if (signal.aborted) { yield fail('aborted', 'Response stopped before completion.', { requestCount, outputChars: full.length }); return; }
      if (requestCount >= MAX_REQUESTS) {
        yield fail('other', 'Reached the 10-turn tool use limit — try a more specific question.', { outputChars: full.length });
        return;
      }

      let res: Awaited<ReturnType<typeof loggedFetch>>;
      try {
        requestCount += 1;
        res = await loggedFetch(ENDPOINT, {
          method: 'POST',
          signal,
          headers: {
            'content-type': 'application/json',
            'x-api-key': key,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body: JSON.stringify({
            model,
            max_tokens: req.thinking ? 16000 : 8192,
            stream: true,
            system: req.systemPrompt,
            messages: current,
            ...(tools.length ? { tools: tools.map(t => ({ name: t.name, description: t.description, input_schema: t.jsonSchema })) } : {}),
            ...(req.thinking ? { thinking: { type: 'adaptive' } } : {}),
          }),
        }, { provider: 'anthropic', label: `messages:${model}`, timeoutMs: MODEL_CONNECT_TIMEOUT_MS });
      } catch (e) {
        yield fail(errorKindOf(e, signal), messageOf(e, 'Network error — check your connection.'), { requestCount, outputChars: full.length });
        return;
      }

      if (!res.ok) {
        const err = await readLoggedErrorPayload(res, { provider: 'anthropic', label: `messages:${model}` });
        const msg = err.error?.message || '';
        const status = res.status;
        if (status === 401) yield fail('config', 'Invalid API key — check it in Settings.', { status });
        // The text "rate limit" is what the Claude→DeepSeek fallback (bug #023) keys on.
        else if (status === 429) yield fail('rate_limit', 'Claude rate limit hit — wait a moment, switch models, or reduce concurrent chats.', { status });
        else if (status === 402 || msg.toLowerCase().includes('credit')) yield fail('config', 'Out of credits — top up at console.anthropic.com.', { status });
        else if (status === 529) yield fail('other', 'Claude is overloaded right now — try again in a moment.', { status });
        else yield fail('other', msg || `Error ${status}`, { status });
        return;
      }

      const blocks: Record<number, Acc> = {};
      let stopReason: string | undefined;
      let emittedText = false;
      try {
        for await (const raw of sseData(res, signal, 'Claude stream')) {
          let evt: ClaudeEvent;
          try { evt = JSON.parse(raw) as ClaudeEvent; } catch { continue; }
          const idx = evt.index ?? -1;
          if (evt.type === 'message_start') inputTokens += evt.message?.usage?.input_tokens || 0;
          else if (evt.type === 'message_delta' && evt.usage) {
            outputTokens += evt.usage.output_tokens || 0;
            stopReason = evt.delta?.stop_reason;
          } else if (evt.type === 'content_block_start' && evt.content_block) {
            const cb = evt.content_block;
            blocks[idx] = cb.type === 'tool_use' ? { type: cb.type, id: cb.id, name: cb.name, inputJson: '' } : { type: cb.type, text: '' };
          } else if (evt.type === 'content_block_delta') {
            const b = blocks[idx];
            if (!b || !evt.delta) continue;
            const d = evt.delta;
            if (d.type === 'text_delta' && d.text) {
              if (!emittedText) {
                emittedText = true;
                // After a tool round, break the paragraph so the continuation does not run into earlier text.
                if (requestCount > 1 && full.trim() && !/\n\s*\n$/.test(full)) {
                  full += '\n\n';
                  yield { t: 'delta', text: '\n\n' };
                }
              }
              b.text = (b.text || '') + d.text;
              full += d.text;
              yield { t: 'delta', text: d.text };
            } else if (d.type === 'input_json_delta') {
              b.inputJson = (b.inputJson || '') + (d.partial_json ?? '');
            } else if (d.type === 'thinking_delta' && d.thinking) {
              b.text = (b.text || '') + d.thinking;
              yield { t: 'thinking', text: d.thinking };
            } else if (d.type === 'signature_delta') {
              b.signature = (b.signature || '') + (d.signature ?? '');
            }
          }
        }
      } catch (e) {
        yield fail(errorKindOf(e, signal), messageOf(e, 'Stream interrupted — partial response preserved.'), { requestCount, outputChars: full.length });
        return;
      }

      // The blocks, in the shape Anthropic wants them echoed back as history (needed to continue after a tool_use).
      const assistantContent: Block[] = Object.values(blocks).flatMap((b): Block[] => {
        if (b.type === 'thinking') return [{ type: 'thinking', thinking: b.text || '', signature: b.signature || '' }];
        if (b.type === 'text') return [{ type: 'text', text: b.text || '' }];
        if (b.type === 'tool_use') {
          let input: Record<string, unknown> = {};
          // A truncated stream degrades to an empty input rather than throwing.
          try { input = JSON.parse(b.inputJson || '{}') as Record<string, unknown>; } catch { /* keep {} */ }
          return [{ type: 'tool_use', id: b.id ?? '', name: b.name ?? '', input }];
        }
        return [];
      });

      if (stopReason !== 'tool_use' || !req.toolRunner) {
        if (signal.aborted) { yield fail('aborted', 'Response stopped before completion.', { requestCount, outputChars: full.length }); return; }
        endBackendTrace(trace, 'end', { provider: 'anthropic', model, inputTokens, outputTokens, requestCount, stopReason, outputChars: full.length });
        yield {
          t: 'done', text: full,
          usage: { inputTokens, outputTokens, stopReason, requestCount, context: { system: req.systemPrompt, messages: current, tools: tools.map(t => t.name) } },
        };
        return;
      }

      if (signal.aborted) { yield fail('aborted', 'Response stopped before completion.', { requestCount, outputChars: full.length }); return; }
      const toolUses = assistantContent.filter((b): b is Extract<Block, { type: 'tool_use' }> => b.type === 'tool_use');
      if (!toolUses.length) continue; // stop_reason said tool_use but there is none: ask again
      current = [...current, { role: 'assistant', content: assistantContent }];

      yield {
        t: 'status',
        label: toolUses.length === 1 ? toolStatusLabel(toolUses[0]!.name, toolUses[0]!.input) : `Running ${toolUses.length} searches in parallel…`,
      };

      // Every call at once; allSettled so one rejection does not cancel the rest. A ToolFatalError
      // is remembered and ends the turn below; an abort propagates.
      let fatal: Error | null = null;
      const runner = req.toolRunner;
      const settled = await Promise.allSettled(toolUses.map(async (b): Promise<Block> => {
        if (signal.aborted) throw Object.assign(new Error('abort'), { name: 'AbortError' });
        try {
          return { type: 'tool_result', tool_use_id: b.id, content: await runner(b.name, b.input, signal) };
        } catch (e) {
          if (e instanceof Error && e.name === 'AbortError') throw e;
          if (isToolFatal(e)) { fatal = e as Error; throw e; }
          return { type: 'tool_result', tool_use_id: b.id, content: `Tool error (${b.name}): ${messageOf(e, 'failed')}` };
        }
      }));

      if (signal.aborted) { yield fail('aborted', 'Response stopped before completion.', { requestCount, outputChars: full.length }); return; }
      if (fatal) {
        yield { t: 'status', label: '' };
        yield fail('other', (fatal as Error).message, { requestCount, outputChars: full.length });
        return;
      }
      const results = settled.flatMap(r => (r.status === 'fulfilled' ? [r.value] : []));
      current = [...current, { role: 'user', content: results }];
      yield { t: 'status', label: 'Thinking…' };
    }
  },
};
