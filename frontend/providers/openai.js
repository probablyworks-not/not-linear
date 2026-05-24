// OpenAI-compatible provider — callOpenAICompatible, callOpenAI, callGemini.
// Accepts systemPrompt and tools as parameters; does not call buildSystemPrompt/buildDeepSeekTools.

import { appState } from '../core/state.js';
import {
  loggedFetch, readResponseBody, readLoggedErrorPayload,
  summarizeMessagesForLog, beginBackendTrace, endBackendTrace,
  readStreamChunk,
  MODEL_CONNECT_TIMEOUT_MS, MODEL_STREAM_IDLE_TIMEOUT_MS,
} from '../core/api-client.js';
import { executeTool, modelLabelFromId } from './tools.js';

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

  if (!apiKey){ failLlm(`No ${providerLabel} API key — add it in Settings (⚙).`, { config:true }); return; }

  while (true){
    if (signal.aborted){ reportAbort(); return; }
    if (requestCount >= 10){ failLlm('Reached the 10-turn tool use limit — try a more specific question.', { outputChars:fullText.length }); return; }
    let res;
    try {
      requestCount += 1;
      res = await loggedFetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type':'application/json', 'Authorization':`Bearer ${apiKey}` },
        body: JSON.stringify({ model, max_tokens:8192, stream:true, messages: currentMessages, tools, tool_choice:'auto' }),
        signal,
      }, { provider:providerLabel, label:`chat:${model}`, timeoutMs:MODEL_CONNECT_TIMEOUT_MS });
    } catch(e){
      if (e.name === 'AbortError'){ reportAbort(); return; }
      failLlm(e.message || 'Network error — check your connection.', { outputChars:fullText.length }); return;
    }

    if (!res.ok){
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
        const { done, value } = await readStreamChunk(reader, signal, MODEL_STREAM_IDLE_TIMEOUT_MS, `${providerLabel} stream`);
        if (done) break;
        buf += decoder.decode(value, { stream:true });
        const lines = buf.split('\n'); buf = lines.pop();
        for (const line of lines){
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6); if (raw === '[DONE]') continue;
          try {
            const evt = JSON.parse(raw);
            if (evt.usage) usageFinal = evt.usage;
            const choice = evt.choices?.[0]; if (!choice) continue;
            finishReason = choice.finish_reason || finishReason;
            const delta = choice.delta;
            if (delta.content){
              if (!emittedTextThisRequest){
                emittedTextThisRequest = true;
                if (requestCount > 1 && fullText.trim() && !/\n\s*\n$/.test(fullText)){
                  fullText += '\n\n'; onDelta('\n\n');
                }
              }
              fullText += delta.content; onDelta(delta.content);
            }
            if (delta.tool_calls){
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

    const toolCalls = Object.values(tcBuf).map(tc => ({ id:tc.id, type:'function', function:{ name:tc.name, arguments:tc.argsJson } }));
    if (!toolCalls.length){ failLlm(`${providerLabel} requested a tool call but did not send a usable tool request.`, { requestCount, outputChars:fullText.length }); return; }
    currentMessages = [...currentMessages, { role:'assistant', content: fullText || null, tool_calls: toolCalls }];

    for (const tc of toolCalls){
      if (signal.aborted){ reportAbort(); return; }
      let input = {};
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

export function callOpenAI(params){
  return callOpenAICompatible({ ...params, baseUrl:'https://api.openai.com/v1', apiKey:appState.apiKeys.openai, providerLabel:'openai' });
}

export function callGemini(params){
  return callOpenAICompatible({ ...params, baseUrl:'https://generativelanguage.googleapis.com/v1beta/openai', apiKey:appState.apiKeys.gemini, providerLabel:'gemini' });
}
