// Anthropic Claude provider — callClaude.
// Accepts systemPrompt and tools as parameters; does not call buildSystemPrompt/buildTools.

import { appState } from '../core/state.js';
import {
  loggedFetch, readResponseBody, readLoggedErrorPayload,
  safeJsonForLog, summarizeMessagesForLog, beginBackendTrace, endBackendTrace,
  readStreamChunk,
  MODEL_CONNECT_TIMEOUT_MS, MODEL_STREAM_IDLE_TIMEOUT_MS,
} from '../core/api-client.js';
import { executeTool, toolResultFallbackMarkdown, modelLabelFromId } from './tools.js';

function modelIdForClaude(pref){
  if (pref === 'opus') return 'claude-opus-5';
  if (pref === 'opus-4-8') return 'claude-opus-4-8';
  if (pref === 'opus-4-5') return 'claude-opus-4-5';
  if (pref === 'sonnet-4-6') return 'claude-sonnet-4-6';
  if (pref === 'sonnet-4-5') return 'claude-sonnet-4-5';
  if (pref === 'haiku') return 'claude-haiku-4-5-20251001';
  return 'claude-sonnet-5';
}

function cleanMessages(messages){
  return messages.map(msg => {
    const { attachments, ...cleaned } = msg;
    return cleaned;
  });
}

// Session-scoped cache for fetch_url results to avoid redundant Jina calls
const _fetchUrlCache = new Map();

// Wrapper around executeTool that caches fetch_url results by URL
async function executeToolCached(name, input, signal){
  if (name === 'fetch_url' && input.url) {
    const cached = _fetchUrlCache.get(input.url);
    if (cached) return cached;
    const result = await executeTool(name, input, signal);
    _fetchUrlCache.set(input.url, result);
    return result;
  }
  return executeTool(name, input, signal);
}

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

  const key = appState.apiKeys.anthropic;
  if (!key){ failLlm('No API key — add your Anthropic key in Settings (⚙).', { config:true }); return; }

  while (true){
    if (signal.aborted){ reportAbort(); return; }
    if (requestCount >= 10){ failLlm('Reached the 10-turn tool use limit — try a more specific question.', { outputChars:fullText.length }); return; }
    let res;
    try {
      requestCount += 1;
      res = await loggedFetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
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
      const err = await readLoggedErrorPayload(res, { provider:'anthropic', label:`messages:${model}` });
      const msg = err.error?.message || '';
      if (res.status === 401){ failLlm('Invalid API key — check it in Settings.', { status:res.status, config:true }); return; }
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
        const { done, value } = await readStreamChunk(reader, signal, MODEL_STREAM_IDLE_TIMEOUT_MS, 'Claude stream');
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n'); buf = lines.pop();
        for (const line of lines){
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6); if (raw === '[DONE]') continue;
          try {
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
                if (!emittedTextThisRequest){
                  emittedTextThisRequest = true;
                  if (requestCount > 1 && fullText.trim() && !/\n\s*\n$/.test(fullText)){
                    fullText += '\n\n';
                    onDelta('\n\n');
                  }
                }
                b.text = (b.text||'') + evt.delta.text;
                fullText += evt.delta.text;
                onDelta(evt.delta.text);
              }
              else if (evt.delta.type === 'input_json_delta'){ b.inputJson = (b.inputJson||'') + evt.delta.partial_json; }
              else if (evt.delta.type === 'thinking_delta'){ b.text = (b.text||'') + evt.delta.thinking; if (onThinking) onThinking(evt.delta.thinking); }
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

    const assistantContent = Object.values(blocks).map(b => {
      if (b.type === 'thinking') return { type:'thinking', thinking: b.text || '', signature: b.signature || '' };
      if (b.type === 'text') return { type:'text', text: b.text || '' };
      if (b.type === 'tool_use'){
        let input = {};
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
    const settled = await Promise.allSettled(toolUses.map(async b => {
      if (signal.aborted) throw Object.assign(new Error('abort'), { name: 'AbortError' });
      try {
        const content = await executeToolCached(b.name, b.input, signal);
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
