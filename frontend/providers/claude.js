// Anthropic Claude provider — callClaude.
// Accepts systemPrompt and tools as parameters; does not call buildSystemPrompt/buildTools.
//
// Wraps the Anthropic Messages API (https://api.anthropic.com/v1/messages), called directly
// from the browser with `anthropic-dangerous-direct-browser-access: true` — there is no backend
// proxy for provider calls (core/api-client.js's loggedFetch is used only for shared timeout/
// logging plumbing around fetch, not for routing through a backend-local endpoint).
// Invoked from frontend/app.js, which picks this provider (vs. deepseek.js/openai.js) based on
// the user's selected model in Settings — see the callFn selection around app.js's chat-sending
// flow (`getProviderForModel`-style switch and the isDeepSeekModel check near the main send path).
// This is also the fallback target's *source*: app.js's bug #023 auto-fallback watches for a
// Claude rate-limit error surfaced via onError here and re-issues the request through
// callDeepSeek (see deepseek.js) instead.
//
// Streaming is the core UX here: callClaude reads Anthropic's SSE stream and invokes onDelta()
// for every `text_delta` event so the UI renders token-by-token instead of waiting for the full
// response (see the content_block_delta handling below).
import { appState } from '../core/state.js';
import {
  loggedFetch, readResponseBody, readLoggedErrorPayload,
  safeJsonForLog, summarizeMessagesForLog, beginBackendTrace, endBackendTrace,
  readStreamChunk,
  MODEL_CONNECT_TIMEOUT_MS, MODEL_STREAM_IDLE_TIMEOUT_MS,
} from '../core/api-client.js';
import { executeTool, toolResultFallbackMarkdown, modelLabelFromId } from './tools.js';

// Maps the user's Settings model preference (a short internal key like 'opus'/'sonnet'/'haiku')
// to the exact Anthropic model id string sent on the wire. Kept in one place so model id changes
// (renames, retirements) only need updating here.
function modelIdForClaude(pref){
  if (pref === 'opus') return 'claude-opus-5';
  if (pref === 'opus-4-8') return 'claude-opus-4-8';
  if (pref === 'opus-4-5') return 'claude-opus-4-5';
  if (pref === 'sonnet-4-6') return 'claude-sonnet-4-6';
  if (pref === 'sonnet-4-5') return 'claude-sonnet-4-5';
  if (pref === 'haiku') return 'claude-haiku-4-5-20251001';
  return 'claude-sonnet-5';
}

// Strips the internal `attachments` field (used elsewhere in the app for UI bookkeeping) off each
// message before it's sent to Anthropic — the API only understands the standard message shape,
// so any extra app-only fields would either be rejected or silently ignored upstream.
function cleanMessages(messages){
  return messages.map(msg => {
    const { attachments, ...cleaned } = msg;
    return cleaned;
  });
}

// Sends a chat turn to Claude and streams the reply back through the onDelta/onThinking/onDone/
// onError callbacks, looping to execute model-requested tool calls (see ./tools.js) until Claude
// stops asking for tools or a hard turn limit is hit.
//
// Params: `messages` is the full ancestor-chain history for this branch (see
// src/chat/buildContext.ts pattern in CLAUDE.md — this app's equivalent lives in app.js's
// context-building helpers); `systemPrompt`/`tools` are pre-built by the caller (this function
// does not call buildSystemPrompt/buildTools itself, per the file banner above). The `on*`
// params are callbacks the caller (app.js) uses to update node/UI state as the response arrives;
// `onController` hands back the AbortController so the caller can cancel an in-flight request
// (e.g. closing a branch panel).
// Returns: nothing (Promise<void>) — all results are delivered via the callbacks, not a return
// value, since a single call may span multiple HTTP requests (initial turn + one per tool round).
//
// Streaming behavior: each HTTP request opens an Anthropic SSE stream; content_block_delta events
// of type text_delta are forwarded to onDelta() as they arrive (see the stream-reading loop
// below), which is what produces the token-by-token rendering.
export async function callClaude({ messages, systemPrompt, tools, onDelta, onThinking, onDone, onError, onStatus, onAbort, onController }){
  const controller = new AbortController();
  appState._activeController = controller;
  if (onController) onController(controller);
  const signal = controller.signal;
  let abortReported = false;
  const reportAbort = () => {
    if (abortReported) return;
    abortReported = true;
    finishLlm('abort', { requestCount, outputChars:fullText.length, abortReason:safeAbortReason(signal) });
    if (onStatus) onStatus(null);
    if (onAbort) onAbort();
  };

  const model = modelIdForClaude(appState.prefs.model);
  const supportsThinking = ['opus', 'sonnet', 'opus-4-8', 'sonnet-4-6'].includes(appState.prefs.model);
  const useThinking = appState.prefs.thinking && supportsThinking;
  const llmTrace = beginBackendTrace('llm', {
    provider:'anthropic',
    model,
    messages: summarizeMessagesForLog(messages),
    tools: tools.map(t => t.name),
    thinking: useThinking,
  });
  let currentMessages = cleanMessages(messages);
  let totalIn = 0, totalOut = 0, fullText = '';
  let requestCount = 0;
  const finishLlm = (phase, meta = {}) => endBackendTrace(llmTrace, phase, {
    provider:'anthropic',
    model,
    ...meta,
  });
  const failLlm = (msg, meta = {}) => {
    finishLlm('error', { error:msg, requestCount, ...meta });
    onError(msg);
  };
  function safeAbortReason(sig){
    const reason = sig?.reason;
    if (!reason) return undefined;
    return reason?.message || String(reason);
  }

  // Read the user's stored Anthropic API key from app state (Settings). Never console.log `key`
  // or the constructed headers object below — the project rule is that API keys must never be
  // logged anywhere, in this file or via loggedFetch's request logging.
  const key = appState.apiKeys.anthropic;
  if (!key){ failLlm('No API key — add your Anthropic key in Settings (⚙).', { config:true }); return; }

  while (true){
    if (signal.aborted){ reportAbort(); return; }
    // Hard ceiling on tool-use round trips for a single turn — prevents a runaway loop where the
    // model keeps requesting tools indefinitely (see BUGS.md #015 for the DeepSeek equivalent of
    // this failure mode, which is why this same guard exists here).
    if (requestCount >= 10){ failLlm('Reached the 10-turn tool use limit — try a more specific question.', { outputChars:fullText.length }); return; }
    let res;
    try {
      requestCount += 1;
      res = await loggedFetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal,
        headers: {
          'content-type': 'application/json',
          // Auth header construction — 'x-api-key' carries the raw Anthropic key. Never log this
          // headers object or the `key` variable (see note above).
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          // Required because this call is made directly from the browser rather than proxied
          // through a backend; Anthropic blocks browser-origin requests without this header.
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify(Object.assign(
          { model, max_tokens: useThinking ? 16000 : 8192, stream: true, system: systemPrompt, messages: currentMessages, tools },
          useThinking ? { thinking: { type:'adaptive' } } : {}
        )),
      }, { provider:'anthropic', label:`messages:${model}`, timeoutMs:MODEL_CONNECT_TIMEOUT_MS });
    } catch(e){
      if (e.name === 'AbortError'){ reportAbort(); return; }
      failLlm(e.message || 'Network error — check your connection.', { requestCount, outputChars:fullText.length }); return;
    }

    if (!res.ok){
      // Surface every failure path through onError (via failLlm) — errors are never swallowed
      // silently, per project rule; the node UI is expected to render these messages.
      const err = await readLoggedErrorPayload(res, { provider:'anthropic', label:`messages:${model}` });
      const msg = err.error?.message || '';
      if (res.status === 401){ failLlm('Invalid API key — check it in Settings.', { status:res.status, config:true }); return; }
      // This specific "rate limit" message text is the trigger app.js's bug #023 auto-fallback
      // logic matches against (via /claude.*rate limit/i) to decide whether to retry the turn on
      // DeepSeek instead — see deepseek.js's file banner for the other half of that flow.
      if (res.status === 429){ failLlm('Claude rate limit hit — wait a moment, switch models, or reduce concurrent chats.', { status:res.status }); return; }
      if (res.status === 402 || msg.toLowerCase().includes('credit')){ failLlm('Out of credits — top up at console.anthropic.com.', { status:res.status, config:true }); return; }
      if (res.status === 529){ failLlm('Claude is overloaded right now — try again in a moment.', { status:res.status }); return; }
      failLlm(msg || `Error ${res.status}`, { status:res.status }); return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    const blocks = {}; // index → {type, id?, name?, text?, inputJson?}
    let stopReason = null;
    let emittedTextThisRequest = false;

    try {
      while (true){
        if (signal.aborted){ reader.cancel().catch(()=>{}); reportAbort(); return; }
        // readStreamChunk enforces an idle timeout (MODEL_STREAM_IDLE_TIMEOUT_MS) so a stalled
        // connection surfaces as an error instead of hanging the UI forever.
        const { done, value } = await readStreamChunk(reader, signal, MODEL_STREAM_IDLE_TIMEOUT_MS, 'Claude stream');
        if (done) break;
        // Anthropic's stream is newline-delimited SSE ("data: {...}\n\n"); buffer partial lines
        // across chunk boundaries and only parse complete lines.
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n'); buf = lines.pop();
        for (const line of lines){
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6); if (raw === '[DONE]') continue;
          try {
            // Each SSE event is a discrete JSON object describing one piece of the response.
            // message_start/message_delta carry token usage + the final stop_reason;
            // content_block_start/delta/stop build up the actual content (text, tool_use,
            // thinking) block by block, keyed by `evt.index` since multiple content blocks can
            // stream concurrently within one message.
            const evt = JSON.parse(raw);
            if (evt.type === 'message_start') totalIn += evt.message?.usage?.input_tokens || 0;
            if (evt.type === 'message_delta' && evt.usage){ totalOut += evt.usage.output_tokens || 0; stopReason = evt.delta?.stop_reason; }
            if (evt.type === 'content_block_start'){
              const cb = evt.content_block;
              blocks[evt.index] = { type: cb.type };
              if (cb.type === 'tool_use'){ blocks[evt.index].id = cb.id; blocks[evt.index].name = cb.name; blocks[evt.index].inputJson = ''; }
              else { blocks[evt.index].text = ''; }
            }
            if (evt.type === 'content_block_delta'){
              const b = blocks[evt.index]; if (!b) continue;
              if (evt.delta.type === 'text_delta'){
                // This is the core streaming path: forward each text fragment to onDelta()
                // immediately so the UI renders character-by-character rather than waiting for
                // the full response.
                if (!emittedTextThisRequest){
                  emittedTextThisRequest = true;
                  // When this is a follow-up request after a tool round, insert a paragraph
                  // break before the model's next visible text so tool-triggered continuations
                  // don't run into the prior text with no separation.
                  if (requestCount > 1 && fullText.trim() && !/\n\s*\n$/.test(fullText)){
                    fullText += '\n\n';
                    onDelta('\n\n');
                  }
                }
                b.text = (b.text||'') + evt.delta.text;
                fullText += evt.delta.text;
                onDelta(evt.delta.text);
              }
              // Tool-call arguments arrive as fragmented JSON text (input_json_delta) that must
              // be concatenated and parsed only once the block is complete — see the
              // JSON.parse(b.inputJson) below, after the stream loop ends.
              else if (evt.delta.type === 'input_json_delta'){ b.inputJson = (b.inputJson||'') + evt.delta.partial_json; }
              // Extended-thinking content streams separately from the final answer text; forward
              // it to onThinking() (not onDelta()) so callers can render it distinctly.
              else if (evt.delta.type === 'thinking_delta'){ b.text = (b.text||'') + evt.delta.thinking; if (onThinking) onThinking(evt.delta.thinking); }
              // The signature authenticates a thinking block for potential replay in a later
              // request; also streamed incrementally and accumulated here.
              else if (evt.delta.type === 'signature_delta'){ b.signature = (b.signature||'') + evt.delta.signature; }
            }
            if (evt.type === 'content_block_stop'){
              const b = blocks[evt.index]; if (!b) continue;
              if (b.type === 'thinking' && !b.signature && evt.content_block?.signature){
                b.signature = evt.content_block.signature;
              }
            }
          } catch(_){}
        }
      }
    } catch(e){
      if (e.name === 'AbortError' || signal.aborted){ reportAbort(); return; }
      failLlm(e.message || 'Stream interrupted — partial response preserved.', { requestCount, outputChars:fullText.length }); return;
    }

    // Reassemble the accumulated per-block state into the content-block array shape Anthropic
    // expects when this assistant turn is echoed back as history on the next request (needed for
    // tool_use follow-ups, and to keep the branch's full context in buildMessages-style history).
    const assistantContent = Object.values(blocks).map(b => {
      if (b.type === 'thinking') return { type:'thinking', thinking: b.text || '', signature: b.signature || '' };
      if (b.type === 'text') return { type:'text', text: b.text || '' };
      if (b.type === 'tool_use'){
        let input = {};
        // The tool call's arguments were streamed as fragmented JSON text (input_json_delta
        // above) and are only valid JSON once fully concatenated — parse defensively since a
        // malformed/truncated stream should degrade to an empty input object rather than throw.
        try { input = JSON.parse(b.inputJson || '{}'); } catch(_){}
        return { type:'tool_use', id: b.id, name: b.name, input };
      }
      return null;
    }).filter(Boolean);

    if (stopReason !== 'tool_use'){
      if (onStatus) onStatus(null);
      finishLlm('end', {
        inputTokens: totalIn,
        outputTokens: totalOut,
        requestCount,
        stopReason,
        outputChars: fullText.length,
      });
      onDone(fullText, {
        inputTokens: totalIn,
        outputTokens: totalOut,
        provider:'anthropic',
        model,
        modelLabel:modelLabelFromId(model),
        requestCount,
        stopReason,
        context:{ provider:'anthropic', model, system:systemPrompt, messages:currentMessages, tools:tools.map(t => t.name) },
      });
      return;
    }

    if (signal.aborted){ reportAbort(); return; }
    currentMessages = [...currentMessages, { role:'assistant', content: assistantContent }];
    const toolUses = assistantContent.filter(b => b.type === 'tool_use');
    if (!toolUses.length) continue; // shouldn't happen if stopReason===tool_use, but guard

    if (onStatus) {
      if (toolUses.length === 1) {
        const b = toolUses[0];
        const label = b.name === 'wikipedia_search' ? `Searching Wikipedia for "${b.input.query}"…`
          : b.name === 'serper_search' ? `Searching Google for "${b.input.query}"…`
          : b.name === 'web_search' ? `Searching for "${b.input.query}"…`
          : b.name === 'firecrawl_scrape' ? `Scraping ${b.input.url}…`
          : `Reading ${b.input.url}…`;
        onStatus(label);
      } else {
        onStatus(`Running ${toolUses.length} searches in parallel…`);
      }
    }

    let fatalError = null;
    // Run every requested tool call concurrently (Claude can request several tools in one turn,
    // e.g. parallel searches) via Promise.allSettled so one tool's rejection doesn't cancel the
    // others. Non-fatal tool errors are converted into a normal tool_result string so the model
    // sees the failure and can react; a ToolFatalError (isToolFatal) — e.g. missing API key/
    // misconfiguration — instead aborts the whole turn via failLlm below.
    const settled = await Promise.allSettled(toolUses.map(async b => {
      if (signal.aborted) throw Object.assign(new Error('abort'), { name: 'AbortError' });
      try {
        const content = await executeTool(b.name, b.input, signal);
        return { type:'tool_result', tool_use_id: b.id, content };
      } catch(e) {
        if (e.name === 'AbortError') throw e;
        if (e.isToolFatal) { fatalError = e; throw e; }
        return { type:'tool_result', tool_use_id: b.id, content: `Tool error (${b.name}): ${e.message}` };
      }
    }));

    if (signal.aborted){ reportAbort(); return; }
    if (fatalError){ if (onStatus) onStatus(null); failLlm(fatalError.message, { requestCount, outputChars:fullText.length }); return; }

    const toolResults = settled
      .filter(r => r.status === 'fulfilled' && r.value)
      .map(r => r.value);

    currentMessages = [...currentMessages, { role:'user', content: toolResults }];
    if (onStatus) onStatus('Thinking…');
  }
}
