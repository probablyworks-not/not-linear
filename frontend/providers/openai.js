// OpenAI-compatible provider — callOpenAICompatible, callOpenAI, callGemini.
// Accepts systemPrompt and tools as parameters; does not call buildSystemPrompt/buildDeepSeekTools.
//
// callOpenAICompatible is a generic client for any OpenAI-style chat/completions endpoint
// (role:'system'/'user'/'assistant'/'tool' messages, function-call-shaped tool_calls, SSE
// streaming with choices[0].delta). callOpenAI and callGemini are thin wrappers that just supply
// the base URL, API key, and a provider label for logging — Gemini is reached through Google's
// OpenAI-compatibility layer (https://generativelanguage.googleapis.com/v1beta/openai), not a
// native Gemini SDK/endpoint, which is why it can share this exact same request/response code.
// All calls go directly from the browser to the provider's endpoint (core/api-client.js's
// loggedFetch only adds shared timeout/logging behavior; it does not proxy through a backend).
//
// Invoked from frontend/app.js, which selects callOpenAI/callGemini (vs. callClaude/callDeepSeek
// from the sibling provider files) based on the user's chosen model in Settings.
//
// Streaming: iterates the SSE stream and calls onDelta() per `delta.content` chunk so output
// renders token-by-token, the same UX contract every other provider in this directory follows.
import { appState } from '../core/state.js';
import {
  loggedFetch, readResponseBody, readLoggedErrorPayload,
  summarizeMessagesForLog, beginBackendTrace, endBackendTrace,
  readStreamChunk,
  MODEL_CONNECT_TIMEOUT_MS, MODEL_STREAM_IDLE_TIMEOUT_MS,
} from '../core/api-client.js';
import { executeTool, modelLabelFromId } from './tools.js';

// Generic OpenAI-compatible chat client shared by callOpenAI and callGemini. Sends a chat turn
// and streams the reply through onDelta/onThinking/onDone/onError, executing model-requested
// tool calls (see ./tools.js) in a loop until the model stops requesting tools or the 10-request
// turn limit is hit — same overall contract/shape as callClaude and callDeepSeek so app.js can
// treat every provider interchangeably.
//
// Params: `messages` is the ancestor-chain history for the branch; `systemPrompt`/`tools` are
// pre-built by the caller. `model`/`baseUrl`/`apiKey`/`providerLabel` parameterize which actual
// OpenAI-compatible backend this call targets (see callOpenAI/callGemini below) — this function
// itself has no provider-specific knowledge beyond those four values plus generic error-message
// text. Returns nothing (Promise<void>); results are delivered via callbacks.
//
// Streaming behavior: forwards `delta.content` text to onDelta() as it streams in (see the
// stream-reading loop below) for the same token-by-token rendering the other providers give.
export async function callOpenAICompatible({ messages, systemPrompt, tools, onDelta, onThinking, onDone, onError, onStatus, onAbort, onController, model, baseUrl, apiKey, providerLabel }){
  const controller = new AbortController();
  appState._activeController = controller;
  if (onController) onController(controller);
  const signal = controller.signal;
  let abortReported = false;
  const reportAbort = () => {
    if (abortReported) return;
    abortReported = true;
    finishLlm('abort', { requestCount, outputChars:fullText.length });
    if (onStatus) onStatus(null);
    if (onAbort) onAbort();
  };

  let currentMessages = [{ role:'system', content: systemPrompt }, ...messages];
  let totalIn = 0, totalOut = 0, fullText = '';
  let requestCount = 0;
  const llmTrace = beginBackendTrace('llm', {
    provider: providerLabel,
    model,
    messages: summarizeMessagesForLog(messages),
    tools: tools.map(t => t.function?.name).filter(Boolean),
  });
  const finishLlm = (phase, meta = {}) => endBackendTrace(llmTrace, phase, { provider:providerLabel, model, ...meta });
  const failLlm = (msg, meta = {}) => { finishLlm('error', { error:msg, requestCount, ...meta }); onError(msg); };

  // Read the caller-supplied key (appState.apiKeys.openai or .gemini, injected by callOpenAI/
  // callGemini below) — never console.log `apiKey` or the constructed Authorization header,
  // per the project rule that API keys must never be logged anywhere.
  if (!apiKey){ failLlm(`No ${providerLabel} API key — add it in Settings (⚙).`, { config:true }); return; }

  while (true){
    if (signal.aborted){ reportAbort(); return; }
    // Same hard per-turn tool-use ceiling used by the other providers (see claude.js/deepseek.js)
    // to prevent a runaway tool-call loop.
    if (requestCount >= 10){ failLlm('Reached the 10-turn tool use limit — try a more specific question.', { outputChars:fullText.length }); return; }
    let res;
    try {
      requestCount += 1;
      res = await loggedFetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        // Auth header construction — Bearer token carries the raw provider API key (OpenAI's or
        // Gemini's, depending on which wrapper called in). Never log this headers object or
        // `apiKey` itself.
        headers: { 'content-type':'application/json', 'Authorization':`Bearer ${apiKey}` },
        // OpenAI's newer models reject `max_tokens`; Gemini's compat layer still expects it.
        body: JSON.stringify({ model, [providerLabel === 'openai' ? 'max_completion_tokens' : 'max_tokens']:8192, stream:true, messages: currentMessages, tools, tool_choice:'auto' }),
        signal,
      }, { provider:providerLabel, label:`chat:${model}`, timeoutMs:MODEL_CONNECT_TIMEOUT_MS });
    } catch(e){
      if (e.name === 'AbortError'){ reportAbort(); return; }
      failLlm(e.message || 'Network error — check your connection.', { outputChars:fullText.length }); return;
    }

    if (!res.ok){
      // Every failure path routes through onError (via failLlm) — never swallowed silently.
      const err = await readLoggedErrorPayload(res, { provider:providerLabel, label:`chat:${model}` });
      const msg = err.error?.message || '';
      if (res.status === 401){ failLlm(`Invalid ${providerLabel} API key — check it in Settings.`, { status:res.status, config:true }); return; }
      if (res.status === 429){ failLlm(`${providerLabel} rate limit hit — wait a moment or switch models.`, { status:res.status }); return; }
      failLlm(msg || `${providerLabel} error ${res.status}`, { status:res.status }); return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    const tcBuf = {};
    let finishReason = null;
    let usageFinal = null;
    let emittedTextThisRequest = false;

    try {
      while (true){
        if (signal.aborted){ reader.cancel().catch(()=>{}); reportAbort(); return; }
        // Idle timeout guards against a stalled connection hanging the UI (same pattern as the
        // other providers).
        const { done, value } = await readStreamChunk(reader, signal, MODEL_STREAM_IDLE_TIMEOUT_MS, `${providerLabel} stream`);
        if (done) break;
        // Buffer partial lines across chunk boundaries; only parse complete "data: {...}" lines.
        buf += decoder.decode(value, { stream:true });
        const lines = buf.split('\n'); buf = lines.pop();
        for (const line of lines){
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6); if (raw === '[DONE]') continue;
          try {
            // Standard OpenAI-compatible chat/completions SSE chunk: usage totals arrive on some
            // events, and the actual content/tool-call fragments live at choices[0].delta.
            const evt = JSON.parse(raw);
            if (evt.usage) usageFinal = evt.usage;
            const choice = evt.choices?.[0]; if (!choice) continue;
            finishReason = choice.finish_reason || finishReason;
            const delta = choice.delta;
            if (delta.content){
              // Core streaming path: forward each content fragment straight to onDelta() so the
              // UI renders token-by-token rather than waiting for the full response.
              if (!emittedTextThisRequest){
                emittedTextThisRequest = true;
                // Paragraph break before this request's first text when continuing after a tool
                // round, so the follow-up answer doesn't run into prior text.
                if (requestCount > 1 && fullText.trim() && !/\n\s*\n$/.test(fullText)){
                  fullText += '\n\n'; onDelta('\n\n');
                }
              }
              fullText += delta.content; onDelta(delta.content);
            }
            if (delta.tool_calls){
              // Tool-call name/arguments stream incrementally per tc.index and must be
              // concatenated before the JSON is complete/parseable — same accumulation pattern
              // used by deepseek.js (shared OpenAI-compatible tool_calls delta shape).
              for (const tc of delta.tool_calls){
                if (!tcBuf[tc.index]) tcBuf[tc.index] = { id:'', name:'', argsJson:'' };
                if (tc.id) tcBuf[tc.index].id += tc.id;
                if (tc.function?.name) tcBuf[tc.index].name += tc.function.name;
                if (tc.function?.arguments) tcBuf[tc.index].argsJson += tc.function.arguments;
              }
            }
          } catch(_){}
        }
      }
    } catch(e){
      if (e.name === 'AbortError' || signal.aborted){ reportAbort(); return; }
      failLlm(e.message || 'Stream interrupted — partial response preserved.', { outputChars:fullText.length }); return;
    }

    if (usageFinal){
      totalIn += usageFinal.prompt_tokens || 0;
      totalOut += usageFinal.completion_tokens || 0;
    }

    if (finishReason !== 'tool_calls'){
      if (onStatus) onStatus(null);
      finishLlm('end', { inputTokens:totalIn, outputTokens:totalOut, requestCount, finishReason, outputChars:fullText.length });
      onDone(fullText, {
        inputTokens:totalIn, outputTokens:totalOut,
        provider:providerLabel, model, modelLabel:modelLabelFromId(model),
        requestCount, finishReason,
        context:{ provider:providerLabel, model, system:systemPrompt, messages:currentMessages, tools:tools.map(t => t.function?.name).filter(Boolean) },
      });
      return;
    }

    // Finalize the accumulated tool_calls fragments into the standard OpenAI-style array now
    // that the stream has ended.
    const toolCalls = Object.values(tcBuf).map(tc => ({ id:tc.id, type:'function', function:{ name:tc.name, arguments:tc.argsJson } }));
    if (!toolCalls.length){ failLlm(`${providerLabel} requested a tool call but did not send a usable tool request.`, { requestCount, outputChars:fullText.length }); return; }
    currentMessages = [...currentMessages, { role:'assistant', content: fullText || null, tool_calls: toolCalls }];

    // Tool calls run sequentially here (unlike callClaude's parallel Promise.allSettled), each
    // appending its own role:'tool' result message before moving to the next.
    for (const tc of toolCalls){
      if (signal.aborted){ reportAbort(); return; }
      let input = {};
      // Defensive JSON parse — arguments were streamed as fragmented text and may be malformed
      // if truncated; fall back to an empty input object rather than throwing.
      try { input = JSON.parse(tc.function.arguments || '{}'); } catch(_){}
      const name = tc.function.name;
      const label = name === 'wikipedia_search' ? `Searching Wikipedia for "${input.query}"…`
        : name === 'serper_search' ? `Searching Google for "${input.query}"…`
        : name === 'web_search' ? `Searching for "${input.query}"…`
        : name === 'firecrawl_scrape' ? `Scraping ${input.url}…`
        : `Reading ${input.url}…`;
      if (onStatus) onStatus(label);
      let result;
      try { result = await executeTool(name, input, signal); }
      catch(e){
        if (e.name === 'AbortError'){ reportAbort(); return; }
        if (e.isToolFatal){ if (onStatus) onStatus(null); failLlm(e.message, { requestCount, tool:name, outputChars:fullText.length }); return; }
        result = `Tool error (${name}): ${e.message}`;
      }
      currentMessages = [...currentMessages, { role:'tool', tool_call_id:tc.id, content:result }];
    }
    if (onStatus) onStatus('Thinking…');
  }
}

// Thin wrapper: calls the real OpenAI API by supplying OpenAI's base URL and the user's stored
// OpenAI key. All request/streaming logic lives in callOpenAICompatible above.
export function callOpenAI(params){
  return callOpenAICompatible({ ...params, baseUrl:'https://api.openai.com/v1', apiKey:appState.apiKeys.openai, providerLabel:'openai' });
}

// Thin wrapper: calls Gemini through Google's OpenAI-compatibility endpoint rather than a native
// Gemini SDK/API — this lets Gemini reuse the exact same OpenAI-shaped request/response handling
// as callOpenAI above, at the cost of only exposing whatever Gemini features that compatibility
// layer supports.
export function callGemini(params){
  return callOpenAICompatible({ ...params, baseUrl:'https://generativelanguage.googleapis.com/v1beta/openai', apiKey:appState.apiKeys.gemini, providerLabel:'gemini' });
}
