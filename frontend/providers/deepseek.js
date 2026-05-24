// DeepSeek provider — callDeepSeek.
// Accepts systemPrompt and tools as parameters; does not call buildSystemPrompt/buildDeepSeekTools.

import { appState } from '../core/state.js';
import {
  loggedFetch, readResponseBody, readLoggedErrorPayload,
  summarizeMessagesForLog, beginBackendTrace, endBackendTrace,
  readStreamChunk,
  MODEL_CONNECT_TIMEOUT_MS, MODEL_STREAM_IDLE_TIMEOUT_MS, TOOL_SYNTHESIS_IDLE_TIMEOUT_MS,
  DEEPSEEK_MAX_TOOL_ROUNDS,
} from '../core/api-client.js';
import { executeTool, toolResultFallbackMarkdown, modelLabelFromId } from './tools.js';

// ---------- DeepSeek pseudo-tool parsing (internal) ----------
const DEEPSEEK_TOOL_MARKUP_HOLD_CHARS = 180;
const DEEPSEEK_TOOL_START_PATTERNS = [
  { kind:'tool_calls', re:/<\s*(?:[｜|]\s*){0,3}(?:DSML\s*(?:[｜|]\s*){0,3})?tool[_▁ ]?calls\s*(?:[｜|]\s*){0,3}>/i },
  { kind:'invoke', re:/<\s*(?:[｜|]\s*){0,3}(?:DSML\s*(?:[｜|]\s*){0,3})?invoke\b[^>]*>/i },
];
const DEEPSEEK_TOOL_END_PATTERNS = {
  tool_calls:/<\s*\/\s*(?:[｜|]\s*){0,3}(?:DSML\s*(?:[｜|]\s*){0,3})?tool[_▁ ]?calls\s*(?:[｜|]\s*){0,3}>/i,
  invoke:/<\s*\/\s*(?:[｜|]\s*){0,3}(?:DSML\s*(?:[｜|]\s*){0,3})?invoke\s*(?:[｜|]\s*){0,3}>/i,
};

function deepSeekPseudoToolStart(text){
  let best = null;
  for (const pattern of DEEPSEEK_TOOL_START_PATTERNS){
    const match = pattern.re.exec(text);
    if (match && (!best || match.index < best.index)) best = { index:match.index, kind:pattern.kind };
  }
  return best;
}

function deepSeekPseudoToolEndOffset(text, kind){
  const match = DEEPSEEK_TOOL_END_PATTERNS[kind]?.exec(text);
  return match ? match.index + match[0].length : -1;
}

function consumeDeepSeekVisibleContent(buffer, force = false){
  let rest = buffer || '';
  let visible = '';
  let suppressed = false;
  while (rest){
    const start = deepSeekPseudoToolStart(rest);
    if (!start){
      if (force){
        visible += rest;
        rest = '';
      } else {
        const emitLen = Math.max(0, rest.length - DEEPSEEK_TOOL_MARKUP_HOLD_CHARS);
        visible += rest.slice(0, emitLen);
        rest = rest.slice(emitLen);
      }
      break;
    }
    visible += rest.slice(0, start.index);
    const toolMarkup = rest.slice(start.index);
    const endOffset = deepSeekPseudoToolEndOffset(toolMarkup, start.kind);
    suppressed = true;
    if (endOffset >= 0){
      rest = toolMarkup.slice(endOffset);
    } else {
      rest = force ? '' : toolMarkup;
      break;
    }
  }
  return { visible, rest, suppressed };
}

function deepSeekSynthesisOnlyMessages(messages){
  return [...messages, {
    role:'user',
    content:'Use the retrieved tool results already in this conversation to write the final answer now. Do not call tools. Do not output XML, DSML, tool-call markup, or code blocks for tool calls. Do not say you are going to look anything up.',
  }];
}

// ---------- callDeepSeek ----------
export async function callDeepSeek({ messages, systemPrompt, tools, onDelta, onThinking, onDone, onError, onStatus, onAbort, onController, model = 'deepseek-chat' }){
  const controller = new AbortController();
  appState._activeController = controller;
  if (onController) onController(controller);
  const signal = controller.signal;
  let abortReported = false;
  const reportAbort = () => {
    if (abortReported) return;
    abortReported = true;
    if (completeWithToolFallback('aborted_after_tool_results')) return;
    finishLlm('abort', { requestCount, outputChars:fullText.length, abortReason:safeAbortReason(signal) });
    if (onStatus) onStatus(null);
    if (onAbort) onAbort();
  };

  let currentMessages = [{ role:'system', content: systemPrompt }, ...messages];
  let totalIn = 0, totalCacheHit = 0, totalOut = 0, fullText = '';
  let requestCount = 0;
  let toolRoundCount = 0;
  let lastToolResults = [];
  const llmTrace = beginBackendTrace('llm', {
    provider:'deepseek',
    model,
    messages: summarizeMessagesForLog(messages),
    tools: tools.map(t => t.function?.name).filter(Boolean),
    maxToolRounds: DEEPSEEK_MAX_TOOL_ROUNDS,
  });
  const finishLlm = (phase, meta = {}) => endBackendTrace(llmTrace, phase, {
    provider:'deepseek',
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
  function completeWithToolFallback(reason){
    if (!lastToolResults?.length || requestCount <= 1 || fullText.trim().length >= 500) return false;
    const fallback = toolResultFallbackMarkdown(lastToolResults);
    if (!fallback) return false;
    const addition = (fullText.trim() ? '\n\n' : '') + fallback;
    fullText += addition;
    if (onStatus) onStatus(null);
    onDelta(addition);
    finishLlm('end', {
      inputTokens: totalIn,
      cacheHitTokens: totalCacheHit,
      outputTokens: totalOut,
      requestCount,
      toolRoundCount,
      finishReason:reason,
      abortReason:safeAbortReason(signal),
      outputChars:fullText.length,
    });
    onDone(fullText, {
      inputTokens: totalIn,
      cacheHitTokens: totalCacheHit,
      outputTokens: totalOut,
      provider:'deepseek',
      model,
      modelLabel:modelLabelFromId(model),
      requestCount,
      toolRoundCount,
      finishReason:reason,
      abortReason:safeAbortReason(signal),
      context:{ provider:'deepseek', model, system:systemPrompt, messages:currentMessages, tools:tools.map(t => t.function?.name).filter(Boolean) },
    });
    return true;
  }

  const key = appState.apiKeys.deepseek;
  if (!key){ failLlm('No DeepSeek API key — add it in Settings (⚙).', { config:true }); return; }

  while (true){
    if (requestCount >= 10){ failLlm('Reached the 10-turn tool use limit — try a more specific question.', { outputChars:fullText.length }); return; }
    let res;
    try {
      requestCount += 1;
      const canUseTools = tools.length && model !== 'deepseek-reasoner' && toolRoundCount < DEEPSEEK_MAX_TOOL_ROUNDS;
      if (!canUseTools && tools.length && lastToolResults.length && onStatus) onStatus('Synthesizing answer from retrieved sources…');
      const requestMessages = canUseTools ? currentMessages : deepSeekSynthesisOnlyMessages(currentMessages);
      const requestBody = canUseTools
        ? { model, max_tokens:8192, stream:true, messages: requestMessages, tools, tool_choice:'auto' }
        : { model, max_tokens:8192, stream:true, messages: requestMessages };
      res = await loggedFetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type':'application/json', 'Authorization':`Bearer ${key}` },
        body: JSON.stringify(requestBody),
        signal,
      }, { provider:'deepseek', label:`chat:${model}`, timeoutMs:MODEL_CONNECT_TIMEOUT_MS });
    } catch(e){ if (e.name === 'AbortError'){ reportAbort(); return; } failLlm(e.message || 'Network error — check your connection.', { outputChars:fullText.length }); return; }

    if (!res.ok){
      const err = await readLoggedErrorPayload(res, { provider:'deepseek', label:`chat:${model}` });
      const msg = err.error?.message || '';
      if (res.status === 401){ failLlm('Invalid DeepSeek API key.', { status:res.status, config:true }); return; }
      if (res.status === 429){ failLlm('DeepSeek rate limit hit — wait a moment, switch models, or reduce concurrent chats.', { status:res.status }); return; }
      if (res.status === 402){ failLlm('DeepSeek out of credits — top up at platform.deepseek.com.', { status:res.status, config:true }); return; }
      failLlm(msg || `DeepSeek error ${res.status}`, { status:res.status }); return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    const tcBuf = {};
    let finishReason = null;
    let usageFinal = null;
    let emittedTextThisRequest = false;
    let filteredContentBuffer = '';
    let suppressedPseudoToolContent = false;
    const emitVisibleContent = (chunk = '', force = false) => {
      const consumed = consumeDeepSeekVisibleContent(filteredContentBuffer + chunk, force);
      filteredContentBuffer = consumed.rest;
      suppressedPseudoToolContent = suppressedPseudoToolContent || consumed.suppressed;
      if (!consumed.visible) return;
      if (!emittedTextThisRequest){
        emittedTextThisRequest = true;
        if (requestCount > 1 && fullText.trim() && !/\n\s*\n$/.test(fullText)){
          fullText += '\n\n';
          onDelta('\n\n');
        }
      }
      fullText += consumed.visible;
      onDelta(consumed.visible);
    };
    const waitingOnToolSynthesis = requestCount > 1 && lastToolResults.length > 0;
    const streamIdleTimeout = waitingOnToolSynthesis ? TOOL_SYNTHESIS_IDLE_TIMEOUT_MS : MODEL_STREAM_IDLE_TIMEOUT_MS;

    try {
      while (true){
        if (signal?.aborted){ reader.cancel().catch(()=>{}); reportAbort(); return; }
        const { done, value } = await readStreamChunk(reader, signal, streamIdleTimeout, waitingOnToolSynthesis ? 'DeepSeek synthesis' : 'DeepSeek stream');
        if (done) break;
        buf += decoder.decode(value, { stream:true });
        const lines = buf.split('\n'); buf = lines.pop();
        for (const line of lines){
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6); if (raw === '[DONE]') continue;
          try {
            const evt = JSON.parse(raw);
            if (evt.usage){ usageFinal = evt.usage; }
            const choice = evt.choices?.[0]; if (!choice) continue;
            finishReason = choice.finish_reason || finishReason;
            const delta = choice.delta;
            if (delta.reasoning_content){ if (onThinking) onThinking(delta.reasoning_content); }
            if (delta.content){
              emitVisibleContent(delta.content);
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
      emitVisibleContent('', true);
    } catch(e){
      if (e.name === 'AbortError' || signal.aborted){ reportAbort(); return; }
      if (waitingOnToolSynthesis && !emittedTextThisRequest){
        const fallback = toolResultFallbackMarkdown(lastToolResults);
        if (fallback){
          if (onStatus) onStatus(null);
          onDelta(fallback);
          finishLlm('end', {
            inputTokens: totalIn,
            cacheHitTokens: totalCacheHit,
            outputTokens: totalOut,
            requestCount,
            toolRoundCount,
            finishReason:'tool_synthesis_timeout',
            outputChars:fallback.length,
          });
          onDone(fallback, {
            inputTokens: totalIn,
            cacheHitTokens: totalCacheHit,
            outputTokens: totalOut,
            provider:'deepseek',
            model,
            modelLabel:modelLabelFromId(model),
            requestCount,
            toolRoundCount,
            finishReason:'tool_synthesis_timeout',
            context:{ provider:'deepseek', model, system:systemPrompt, messages:currentMessages, tools:tools.map(t => t.function?.name).filter(Boolean) },
          });
          return;
        }
      }
      failLlm(e.message || 'Stream interrupted — partial response preserved.', { outputChars:fullText.length }); return;
    }

    if (usageFinal){
      totalIn += usageFinal.prompt_tokens || 0;
      totalCacheHit += usageFinal.prompt_cache_hit_tokens || 0;
      totalOut += usageFinal.completion_tokens || 0;
    }

    if (finishReason !== 'tool_calls'){
      if (suppressedPseudoToolContent && lastToolResults.length && fullText.trim().length < 500){
        const fallback = toolResultFallbackMarkdown(lastToolResults);
        if (fallback){
          const addition = (fullText.trim() ? '\n\n' : '') + fallback;
          fullText += addition;
          onDelta(addition);
          finishReason = 'pseudo_tool_call_filtered';
        }
      }
      if (onStatus) onStatus(null);
      finishLlm('end', {
        inputTokens: totalIn,
        cacheHitTokens: totalCacheHit,
        outputTokens: totalOut,
        requestCount,
        toolRoundCount,
        finishReason,
        pseudoToolCallFiltered: suppressedPseudoToolContent || undefined,
        outputChars:fullText.length,
      });
      onDone(fullText, {
        inputTokens: totalIn,
        cacheHitTokens: totalCacheHit,
        outputTokens: totalOut,
        provider:'deepseek',
        model,
        modelLabel:modelLabelFromId(model),
        requestCount,
        toolRoundCount,
        finishReason,
        pseudoToolCallFiltered: suppressedPseudoToolContent || undefined,
        context:{ provider:'deepseek', model, system:systemPrompt, messages:currentMessages, tools:tools.map(t => t.function?.name).filter(Boolean) },
      });
      return;
    }

    const toolCalls = Object.values(tcBuf).map(tc => ({
      id: tc.id, type:'function', function:{ name: tc.name, arguments: tc.argsJson }
    }));
    if (!toolCalls.length){
      failLlm('DeepSeek requested a tool call but did not send a usable tool request.', { requestCount, toolRoundCount, outputChars:fullText.length });
      return;
    }
    currentMessages = [...currentMessages, { role:'assistant', content: fullText || null, tool_calls: toolCalls }];

    const toolResultRecords = [];
    for (const tc of toolCalls){
      if (signal?.aborted){ reportAbort(); return; }
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
      toolResultRecords.push({ name, input, content: result });
      currentMessages = [...currentMessages, { role:'tool', tool_call_id: tc.id, content: result }];
    }
    toolRoundCount += 1;
    lastToolResults = toolResultRecords;
    if (onStatus) onStatus(toolRoundCount >= DEEPSEEK_MAX_TOOL_ROUNDS ? 'Synthesizing answer from retrieved sources…' : 'Synthesizing tool results…');
  }
}
