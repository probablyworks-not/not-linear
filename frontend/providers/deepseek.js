// DeepSeek provider — callDeepSeek.
// Accepts systemPrompt and tools as parameters; does not call buildSystemPrompt/buildDeepSeekTools.
//
// Wraps DeepSeek's OpenAI-compatible chat/completions endpoint (https://api.deepseek.com/v1/
// chat/completions), called directly from the browser — no backend proxy. Uses OpenAI-style
// message/tool-call shapes (role:'tool', tool_calls[], function.arguments as a JSON string),
// which is why the request/response handling here looks structurally like openai.js rather
// than claude.js's Anthropic-native event shapes.
//
// Invoked from frontend/app.js: (1) directly when the user has selected a DeepSeek model, and
// (2) as an automatic fallback target when Claude hits a rate limit — see BUGS.md bug #023
// ("Claude→DeepSeek auto-fallback on rate limit"). app.js's onError handler matches
// /claude.*rate limit/i against errors surfaced from callClaude (claude.js), and if a DeepSeek
// key is present and this turn hasn't already auto-switched once, it swaps the active adapter to
// callDeepSeek and retries with the same rebuilt message list. That fallback wiring lives in
// app.js, not here — this file only needs to behave like a normal provider call.
//
// Also note per BUGS.md #044: DeepSeek retired the separate `deepseek-chat`/`deepseek-reasoner`
// model names in favor of a single `deepseek-v4-flash` model with reasoning toggled via the
// `thinking` request parameter (see the `thinking` param below) rather than a different model id.
//
// Streaming: reads DeepSeek's SSE stream and calls onDelta() per content chunk so responses
// render token-by-token, matching the Claude provider's UX. DeepSeek has an added wrinkle some
// other providers don't: it can emit non-standard "pseudo tool call" XML/DSML markup inline in
// the text content instead of (or alongside) proper `tool_calls` deltas — see the pseudo-tool
// parsing helpers directly below, which filter that markup out of what onDelta() ever sees.
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
  { kind:'tool_calls', re:/<\s*(?:[｜|]\s*){0,3}(?:DSML\s*(?:[｜|]\s*){0,3})?(?:(?:tool|function)[_▁ ]?)?calls\s*(?:[｜|]\s*){0,3}>/i },
  { kind:'invoke', re:/<\s*(?:[｜|]\s*){0,3}(?:DSML\s*(?:[｜|]\s*){0,3})?invoke\b[^>]*>/i },
];
const DEEPSEEK_TOOL_END_PATTERNS = {
  tool_calls:/<\s*\/\s*(?:[｜|]\s*){0,3}(?:DSML\s*(?:[｜|]\s*){0,3})?(?:(?:tool|function)[_▁ ]?)?calls\s*(?:[｜|]\s*){0,3}>/i,
  invoke:/<\s*\/\s*(?:[｜|]\s*){0,3}(?:DSML\s*(?:[｜|]\s*){0,3})?invoke\s*(?:[｜|]\s*){0,3}>/i,
};

// Scans visible text for the earliest occurrence of a DeepSeek pseudo-tool-call marker (either
// full-width/half-width pipe variants of "tool_calls" or "invoke" tags — DeepSeek sometimes emits
// these as literal text in the content stream instead of a proper tool_calls delta, per BUGS.md
// #018). Returns the earliest match's index and which tag kind it is, or null if none found.
function deepSeekPseudoToolStart(text){
  let best = null;
  for (const pattern of DEEPSEEK_TOOL_START_PATTERNS){
    const match = pattern.re.exec(text);
    if (match && (!best || match.index < best.index)) best = { index:match.index, kind:pattern.kind };
  }
  return best;
}

// Finds the end offset of the matching closing tag for a given pseudo-tool markup `kind`,
// returning -1 if the closing tag hasn't streamed in yet (markup can span multiple chunks).
function deepSeekPseudoToolEndOffset(text, kind){
  const match = DEEPSEEK_TOOL_END_PATTERNS[kind]?.exec(text);
  return match ? match.index + match[0].length : -1;
}

// Filters DeepSeek pseudo-tool-call markup (see BUGS.md #018) out of streamed text before it
// ever reaches onDelta(), so raw XML/DSML tags never leak into what the user sees.
//
// Because the stream arrives in arbitrary-sized chunks, a tag can be split across chunk
// boundaries — so text is held back rather than emitted immediately: when not `force`d, only
// emit up to `rest.length - DEEPSEEK_TOOL_MARKUP_HOLD_CHARS` characters, keeping a small tail
// buffered in case what looks like plain text is actually the start of a tag that hasn't fully
// arrived yet. `force` (used once the stream ends) flushes everything, including a truncated/
// unterminated tag, since there's no more data coming to complete it.
// Returns { visible, rest, suppressed } — `visible` is safe-to-render text, `rest` is what must
// be held for the next call, and `suppressed` flags that markup was actually filtered out (used
// by the caller to decide whether a tool-result fallback message is needed).
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

// Appends a synthetic user instruction telling DeepSeek to answer from tool results already in
// history and stop calling tools — used once DEEPSEEK_MAX_TOOL_ROUNDS is reached (see BUGS.md
// #015, where DeepSeek kept re-searching instead of synthesizing a final answer) by sending this
// message on a request where `tools` is omitted entirely, so DeepSeek has no tool to call anyway.
function deepSeekSynthesisOnlyMessages(messages){
  return [...messages, {
    role:'user',
    content:'Use the retrieved tool results already in this conversation to write the final answer now. Do not call tools. Do not output XML, DSML, tool-call markup, or code blocks for tool calls. Do not say you are going to look anything up.',
  }];
}

// ---------- callDeepSeek ----------
// Sends a chat turn to DeepSeek and streams the reply back through the onDelta/onThinking/onDone/
// onError callbacks, executing model-requested tool calls (see ./tools.js) in a loop until
// DeepSeek stops requesting tools, a bounded number of tool rounds is used up (see
// DEEPSEEK_MAX_TOOL_ROUNDS / BUGS.md #015), or the hard 10-request turn limit is hit.
//
// Params: `messages` is the ancestor-chain history for this branch (systemPrompt/tools are
// pre-built by the caller, same contract as callClaude); `model`/`thinking` select DeepSeek's
// single current model id and whether reasoning mode is enabled (see BUGS.md #044 — DeepSeek
// retired separate chat/reasoner model names in favor of one model + this `thinking` flag). The
// `on*` callbacks mirror callClaude's contract so app.js can treat every provider uniformly,
// including as the fallback destination when Claude rate-limits (bug #023 — see claude.js).
// Returns: nothing (Promise<void>); results are delivered via callbacks across potentially
// several HTTP requests (initial turn, tool rounds, and a final synthesis-only request).
//
// Streaming behavior: forwards filtered `delta.content` text to onDelta() as it arrives (see
// emitVisibleContent below) so responses render token-by-token; unlike claude.js, DeepSeek's
// stream can also emit reasoning text (`reasoning_content`, routed to onThinking) and pseudo-tool
// XML/DSML markup inline in `content` that must be filtered before the user ever sees it — see
// the pseudo-tool helpers above.
export async function callDeepSeek({ messages, systemPrompt, tools, onDelta, onThinking, onDone, onError, onStatus, onAbort, onController, model = 'deepseek-v4-flash', thinking = false }){
  const controller = new AbortController();
  appState._activeController = controller;
  if (onController) onController(controller);
  const signal = controller.signal;
  let abortReported = false;
  const reportAbort = () => {
    if (abortReported) return;
    abortReported = true;
    // BUGS.md #017: before treating this as a plain abort, try the tool-result salvage path —
    // an abort right after tool results came back (e.g. closing a branch panel mid-synthesis)
    // would otherwise discard those results instead of showing them.
    if (completeWithToolFallback('aborted_after_tool_results')) return;
    finishLlm('abort', { requestCount, outputChars:fullText.length, abortReason:safeAbortReason(signal) });
    if (onStatus) onStatus(null);
    if (onAbort) onAbort();
  };

  let currentMessages = [{ role:'system', content: thinking ? `${systemPrompt}\n\nNo tools or web access are available in this mode. Never output tool-call markup (XML, DSML). If the user links pages you cannot open, say so briefly and answer from what you know.` : systemPrompt }, ...messages];
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
  // Salvage path for BUGS.md #017/#018: if DeepSeek stalls or aborts after tool results were
  // already retrieved but before it produced a usable synthesis, render the raw tool results as
  // a fallback answer instead of losing them / spinning forever. Bug #018 was specifically that
  // this helper was copy-pasted into callClaude's scope by mistake (where its referenced
  // variables didn't exist) instead of living here in callDeepSeek where they do — kept here.
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
      modelLabel:modelLabelFromId(model, thinking),
      requestCount,
      toolRoundCount,
      finishReason:reason,
      abortReason:safeAbortReason(signal),
      context:{ provider:'deepseek', model, system:systemPrompt, messages:currentMessages, tools:tools.map(t => t.function?.name).filter(Boolean) },
    });
    return true;
  }

  // Read the user's stored DeepSeek API key from app state (Settings). Never console.log `key`
  // or the constructed Authorization header below — API keys must never be logged, per project
  // rule, whether entered directly or picked up via the bug #023 Claude→DeepSeek auto-fallback.
  const key = appState.apiKeys.deepseek;
  if (!key){ failLlm('No DeepSeek API key — add it in Settings (⚙).', { config:true }); return; }

  while (true){
    // Same hard per-turn request ceiling as callClaude — belt-and-suspenders alongside the
    // DEEPSEEK_MAX_TOOL_ROUNDS check below, which is the more specific fix for BUGS.md #015.
    if (requestCount >= 10){ failLlm('Reached the 10-turn tool use limit — try a more specific question.', { outputChars:fullText.length }); return; }
    let res;
    try {
      requestCount += 1;
      // Tools are only offered while under the bounded round limit (BUGS.md #015 fix) — thinking
      // mode also disables tools outright, since DeepSeek's reasoning mode isn't paired with tool
      // use here. Once the round budget is spent, drop `tools` entirely and switch to
      // deepSeekSynthesisOnlyMessages() so DeepSeek is forced to answer from what's already been
      // retrieved instead of continuing to search.
      const canUseTools = tools.length && !thinking && toolRoundCount < DEEPSEEK_MAX_TOOL_ROUNDS;
      if (!canUseTools && tools.length && lastToolResults.length && onStatus) onStatus('Synthesizing answer from retrieved sources…');
      const requestMessages = canUseTools ? currentMessages : deepSeekSynthesisOnlyMessages(currentMessages);
      // Per BUGS.md #044, DeepSeek retired separate chat/reasoner model names — reasoning depth is
      // now toggled via this `thinking` request parameter on the single `deepseek-v4-flash` model
      // rather than by choosing a different model id.
      const thinkingParams = thinking
        ? { thinking: { type:'enabled' }, reasoning_effort:'high' }
        : { thinking: { type:'disabled' } };
      const requestBody = canUseTools
        ? { model, max_tokens:8192, stream:true, messages: requestMessages, tools, tool_choice:'auto', ...thinkingParams }
        : { model, max_tokens:8192, stream:true, messages: requestMessages, ...thinkingParams };
      res = await loggedFetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        // Auth header construction — Bearer token carries the raw DeepSeek key. Never log this
        // headers object or the `key` variable (see note above).
        headers: { 'content-type':'application/json', 'Authorization':`Bearer ${key}` },
        body: JSON.stringify(requestBody),
        signal,
      }, { provider:'deepseek', label:`chat:${model}`, timeoutMs:MODEL_CONNECT_TIMEOUT_MS });
    } catch(e){ if (e.name === 'AbortError'){ reportAbort(); return; } failLlm(e.message || 'Network error — check your connection.', { outputChars:fullText.length }); return; }

    if (!res.ok){
      // Errors are always surfaced through onError (via failLlm), never swallowed, per project
      // rule — this is also the terminal case if DeepSeek itself rate-limits (as opposed to
      // Claude rate-limiting into DeepSeek, which is handled entirely in claude.js/app.js).
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
    // Routes every raw content chunk through consumeDeepSeekVisibleContent (pseudo-tool markup
    // filter) before it reaches onDelta() — this is the actual streaming emission point for
    // DeepSeek's answer text, analogous to the text_delta handling in claude.js, but with the
    // extra filtering step DeepSeek needs and Claude doesn't.
    const emitVisibleContent = (chunk = '', force = false) => {
      const consumed = consumeDeepSeekVisibleContent(filteredContentBuffer + chunk, force);
      filteredContentBuffer = consumed.rest;
      suppressedPseudoToolContent = suppressedPseudoToolContent || consumed.suppressed;
      if (!consumed.visible) return;
      if (!emittedTextThisRequest){
        emittedTextThisRequest = true;
        // Insert a paragraph break before this request's first visible text when continuing
        // after a prior tool round, so the synthesis answer doesn't run into earlier text.
        if (requestCount > 1 && fullText.trim() && !/\n\s*\n$/.test(fullText)){
          fullText += '\n\n';
          onDelta('\n\n');
        }
      }
      fullText += consumed.visible;
      onDelta(consumed.visible);
    };
    // Per BUGS.md #012: once tool results are in hand and we're waiting on DeepSeek's follow-up
    // synthesis call, use a shorter idle timeout (TOOL_SYNTHESIS_IDLE_TIMEOUT_MS) than the normal
    // model stream timeout, so a stalled synthesis surfaces the retrieved results as a fallback
    // (see completeWithToolFallback / the catch block below) instead of leaving the UI spinning.
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
            // OpenAI-compatible SSE event shape: usage totals arrive on some chunks, and the
            // per-turn content lives at choices[0].delta — tool call arguments stream
            // incrementally (tc.function.arguments) and must be concatenated per tc.index before
            // parsing, same JSON-fragment-accumulation pattern as claude.js's input_json_delta.
            const evt = JSON.parse(raw);
            if (evt.usage){ usageFinal = evt.usage; }
            const choice = evt.choices?.[0]; if (!choice) continue;
            finishReason = choice.finish_reason || finishReason;
            const delta = choice.delta;
            // Reasoning-mode output streams separately from the answer text — forward to
            // onThinking(), not onDelta(), mirroring callClaude's thinking_delta handling.
            if (delta.reasoning_content){ if (onThinking) onThinking(delta.reasoning_content); }
            if (delta.content){
              // Core streaming path for DeepSeek's answer text, filtered for pseudo-tool markup.
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
      // Flush any text still held back by the pseudo-tool-markup buffer now that the stream has
      // ended — `force:true` means an unterminated tag at this point is just emitted as text.
      emitVisibleContent('', true);
    } catch(e){
      if (e.name === 'AbortError' || signal.aborted){ reportAbort(); return; }
      // BUGS.md #012 fallback: the post-tool synthesis stream stalled/errored before producing
      // any visible text — rather than surface a bare error and discard the search work, render
      // the retrieved tool results directly as the answer.
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
            modelLabel:modelLabelFromId(model, thinking),
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
      // If pseudo-tool markup was filtered out of the response (see consumeDeepSeekVisibleContent)
      // and what's left is too short to be a real answer, DeepSeek likely intended a real tool
      // call that got mangled into text instead of a proper tool_calls delta — fall back to
      // showing the retrieved tool results directly rather than a near-empty response.
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
        modelLabel:modelLabelFromId(model, thinking),
        requestCount,
        toolRoundCount,
        finishReason,
        pseudoToolCallFiltered: suppressedPseudoToolContent || undefined,
        context:{ provider:'deepseek', model, system:systemPrompt, messages:currentMessages, tools:tools.map(t => t.function?.name).filter(Boolean) },
      });
      return;
    }

    // tcBuf accumulated fragmented tool_calls deltas by index during the stream loop above;
    // finalize them into the OpenAI-style tool_calls array now that the stream has ended.
    const toolCalls = Object.values(tcBuf).map(tc => ({
      id: tc.id, type:'function', function:{ name: tc.name, arguments: tc.argsJson }
    }));
    if (!toolCalls.length){
      failLlm('DeepSeek requested a tool call but did not send a usable tool request.', { requestCount, toolRoundCount, outputChars:fullText.length });
      return;
    }
    currentMessages = [...currentMessages, { role:'assistant', content: fullText || null, tool_calls: toolCalls }];

    // Unlike callClaude, DeepSeek tool calls are executed sequentially here (not in parallel via
    // Promise.allSettled) — each iteration appends its own role:'tool' message immediately.
    const toolResultRecords = [];
    for (const tc of toolCalls){
      if (signal?.aborted){ reportAbort(); return; }
      let input = {};
      // Tool call arguments are a JSON string built up from streamed fragments — parse
      // defensively; a malformed/truncated payload degrades to an empty input object instead of
      // throwing (same pattern as claude.js's tool_use input parsing).
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
    // Remembered so a stalled/aborted synthesis afterward (completeWithToolFallback, or the
    // stream-error handler above) still has the retrieved results to fall back to.
    lastToolResults = toolResultRecords;
    if (onStatus) onStatus(toolRoundCount >= DEEPSEEK_MAX_TOOL_ROUNDS ? 'Synthesizing answer from retrieved sources…' : 'Synthesizing tool results…');
  }
}
