// Network / logging infrastructure.
// No DOM dependencies except the console. Decouples from UI rendering by
// dispatching 'notlinear:log' on window; app.js listens to schedule rendering.
//
// Per AGENTS.md, this is the module all backend HTTP calls are meant to go
// through — it wraps `fetch` (loggedFetch), response-body reading
// (readResponseBody/readLoggedErrorPayload) and per-request abort/timeout
// handling (signalWithTimeout/readStreamChunk/RequestTimeoutError) with
// structured request logging (requestLog / beginBackendTrace/endBackendTrace)
// that app.js's console/network-log UI reads via the 'notlinear:log' event.
// It is imported by app.js and by every LLM provider module
// (frontend/providers/claude.js, deepseek.js, openai.js, tools.js) and by the
// feature views (frontend/views/notes.js)
// for their calls to backend/server.py's /__notlinear_* endpoints — this is
// what keeps API keys and long payloads out of the request log
// (see redactHeaders/summarizeBody below) in one place instead of every
// caller re-implementing that.
// NOTE: core/feedback.js is a known exception — its screenshot/recording/save
// calls to /__notlinear_feedback_* use a plain local `fetch` wrapper instead
// of going through loggedFetch here, so those requests do not appear in the
// request log. If you touch feedback.js, that's worth being aware of rather
// than assuming every backend call is captured here.

// ---------- timeout constants ----------
// Shared limits/timeouts used by app.js and the provider modules when calling
// signalWithTimeout/readStreamChunk/loggedFetch below, so every caller agrees
// on how long e.g. a tool call or a model connection is allowed to hang
// before being treated as stalled, rather than each call site picking its own number.
export const REQUEST_LOG_LIMIT = 300;
export const RUNTIME_LOG_SYNC_ENDPOINT = '/__notlinear_runtime_logs';
export const RUNTIME_LOG_SYNC_DEBOUNCE_MS = 1200;
export const TOOL_TIMEOUT_MS = 20000;
export const SEARCH_TIMEOUT_MS = 12000;
export const PAGE_READ_TIMEOUT_MS = 8000;
export const SCRAPE_TIMEOUT_MS = 24000;
export const MODEL_CONNECT_TIMEOUT_MS = 70000;
export const MODEL_STREAM_IDLE_TIMEOUT_MS = 120000;
export const TOOL_SYNTHESIS_IDLE_TIMEOUT_MS = 30000;
export const DEEPSEEK_MAX_TOOL_ROUNDS = 2;

// ---------- request log ----------
// In-memory ring buffer of recent backend requests, capped at REQUEST_LOG_LIMIT
// (see logBackendEvent below). Stashed on `window` (not just a module-local
// array) so it survives module re-evaluation and can be inspected from the
// browser console for debugging; app.js's log/console UI reads this array
// directly after each 'notlinear:log' event.
export const requestLog = window.notlinearRequestLog = window.notlinearRequestLog || [];
let requestSeq = requestLog.length;
let traceSeq = requestLog.length;

// ---------- helpers ----------
// redactHeaders: internal — return a shallow copy of `headers` with any
// authorization/API-key-looking header value replaced with '[redacted]'
// before it's written to the request log, per the project rule of never
// logging API keys.
function redactHeaders(headers = {}){
  return Object.fromEntries(Object.entries(headers).map(([k,v]) =>
    /authorization|api[-_]?key|x-api-key/i.test(k) ? [k, '[redacted]'] : [k, v]
  ));
}
// summarizeBody: internal — shrink a request body for logging: for JSON
// bodies, collapse known-large fields (messages/system/tools) to short
// placeholders like "[12 messages]" instead of dumping full prompt content
// into the log; for non-JSON/unparseable bodies, just truncate to 500 chars.
function summarizeBody(body){
  if (!body || typeof body !== 'string') return null;
  try {
    const parsed = JSON.parse(body);
    if (parsed.messages) parsed.messages = `[${parsed.messages.length} messages]`;
    if (parsed.system) parsed.system = `[${String(parsed.system).length} chars]`;
    if (parsed.tools) parsed.tools = `[${parsed.tools.length} tools]`;
    return parsed;
  } catch(_) {
    return body.length > 500 ? body.slice(0, 500) + '…' : body;
  }
}

// ---------- timeout utilities ----------
// RequestTimeoutError: a distinguishable Error subclass (isTimeout: true) so
// callers (app.js, provider modules) can tell "this request timed out" apart
// from other fetch/network failures and show different messaging — see
// markdown.js's friendlyError(), which pattern-matches on the resulting message text.
export class RequestTimeoutError extends Error {
  constructor(message){
    super(message);
    this.name = 'RequestTimeoutError';
    this.isTimeout = true;
  }
}

// signalWithTimeout: build an AbortController/signal that aborts either when
// `parentSignal` aborts (e.g. the user cancels the whole request) or when
// `timeoutMs` elapses, whichever comes first — combining "cancel this
// specific sub-step" with "the parent request was already cancelled" into one
// signal. Returns `{ signal, cleanup, timedOut }`; callers must call
// `cleanup()` when done (clears the timer / listener) to avoid leaking timers,
// and can check `timedOut()` afterward to tell a timeout apart from an
// explicit parent-signal abort. Used internally by loggedFetch/
// readResponseBody below, and directly by app.js and the provider modules for
// their own timeout-scoped operations (e.g. per-tool-call timeouts).
export function signalWithTimeout(parentSignal, timeoutMs, label){
  const controller = new AbortController();
  let timedOut = false;
  let timer = 0;
  const cleanup = () => {
    if (timer) clearTimeout(timer);
    parentSignal?.removeEventListener?.('abort', onParentAbort);
  };
  const onParentAbort = () => {
    cleanup();
    controller.abort(parentSignal.reason);
  };
  if (parentSignal?.aborted){
    controller.abort(parentSignal.reason);
  } else {
    parentSignal?.addEventListener?.('abort', onParentAbort, { once:true });
    if (timeoutMs > 0){
      timer = setTimeout(() => {
        timedOut = true;
        cleanup();
        controller.abort(new RequestTimeoutError(`${label || 'Request'} timed out.`));
      }, timeoutMs);
    }
  }
  return { signal: controller.signal, cleanup, timedOut: () => timedOut };
}

// readStreamChunk: read one chunk from a ReadableStream `reader` (e.g. a
// streaming Claude/DeepSeek/OpenAI SSE response body), but race it against a
// `timeoutMs` timer so a stream that stops sending data (server hung, network
// stall) doesn't leave the caller awaiting forever — the streaming-
// character-by-character UX this app depends on needs to notice a stalled
// stream promptly. On timeout, cancels the reader and throws
// RequestTimeoutError with a message suggesting a narrower query. Called from
// app.js and the streaming providers (frontend/providers/claude.js,
// deepseek.js, openai.js) inside their `for await`-style read loops.
export async function readStreamChunk(reader, signal, timeoutMs, label){
  if (!timeoutMs) return reader.read();
  let timer = 0;
  try {
    return await Promise.race([
      reader.read(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          reader.cancel().catch(()=>{});
          reject(new RequestTimeoutError(`${label || 'Stream'} stopped sending data. Try again with a narrower query.`));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (signal?.aborted) reader.cancel().catch(()=>{});
  }
}

// ---------- logging ----------
// logBackendEvent: internal — append one entry to requestLog (trimming to
// REQUEST_LOG_LIMIT), fire the 'notlinear:log' window event so app.js can
// schedule re-rendering its log UI and syncing to RUNTIME_LOG_SYNC_ENDPOINT
// without this module importing app.js back, and mirror the entry to
// console.warn/console.log depending on whether it represents an error/4xx+.
function logBackendEvent(entry){
  requestLog.push({ timestamp: new Date().toISOString(), ...entry });
  if (requestLog.length > REQUEST_LOG_LIMIT) requestLog.splice(0, requestLog.length - REQUEST_LOG_LIMIT);
  // Notify app.js to schedule UI rendering + file sync without creating a direct dependency.
  window.dispatchEvent(new CustomEvent('notlinear:log'));
  const level = entry.error || entry.status >= 400 ? 'warn' : 'log';
  console[level]('[notlinear backend]', entry);
}

// beginBackendTrace / endBackendTrace: a matched pair for logging a
// multi-step operation that doesn't map to a single fetch() call (e.g. a full
// tool-use round or model turn spanning several requests) as one logical
// "trace" with a start and end event sharing an id, rather than as loose
// unconnected log lines. beginBackendTrace logs the 'start' phase and returns
// a trace handle; endBackendTrace logs the matching phase (default 'end')
// with elapsed duration and is a no-op if called twice or with a falsy trace
// (idempotent — safe to call from a `finally` block). Used by app.js and the
// provider modules (frontend/providers/*.js) around tool calls / model turns.
export function beginBackendTrace(kind, meta = {}){
  const id = `${kind}-${++traceSeq}`;
  const trace = { id, kind, startedAtMs: performance.now(), startedAt: new Date().toISOString(), done:false };
  logBackendEvent({ id, kind, phase:'start', startedAt:trace.startedAt, ...meta });
  return trace;
}

// See beginBackendTrace above for the paired-trace pattern this completes.
export function endBackendTrace(trace, phase = 'end', meta = {}){
  if (!trace || trace.done) return;
  trace.done = true;
  logBackendEvent({
    id: trace.id,
    kind: trace.kind,
    phase,
    startedAt: trace.startedAt,
    endedAt: new Date().toISOString(),
    durationMs: Math.round(performance.now() - trace.startedAtMs),
    ...meta,
  });
}

// safeJsonForLog: internal-ish helper (exported for use by provider modules)
// that stringifies a value for logging, truncates it to `maxChars` if it's
// too long, then tries to parse the (possibly truncated) result back into an
// object so the log renders as structured JSON when it can, falling back to a
// truncated string when parsing fails (e.g. because truncation broke the
// JSON). Used by app.js and frontend/providers/{claude,tools}.js when logging
// tool inputs/outputs that could otherwise be arbitrarily large.
export function safeJsonForLog(value, maxChars = 700){
  if (value == null) return value;
  let out = value;
  try {
    out = typeof value === 'string' ? value : JSON.stringify(value);
  } catch(_) {
    out = String(value);
  }
  if (out.length > maxChars) out = out.slice(0, maxChars - 1).trim() + '…';
  try {
    return JSON.parse(out);
  } catch(_) {
    return out;
  }
}

// summarizeMessagesForLog: reduce a full Anthropic/OpenAI-style `messages`
// array (which can carry a lot of prompt/response text) down to per-message
// role + a size hint (e.g. "[240 chars]" or "[3 blocks]" for content-block
// arrays) for logging, instead of writing full message content into the
// request log. Used by app.js and the provider modules
// (frontend/providers/claude.js, deepseek.js, openai.js) when building
// loggedFetch's `meta`/body summaries for chat completion requests.
export function summarizeMessagesForLog(messages = []){
  return (messages || []).map((msg, i) => ({
    index: i,
    role: msg.role || null,
    content: typeof msg.content === 'string'
      ? `[${msg.content.length} chars]`
      : Array.isArray(msg.content)
        ? `[${msg.content.length} blocks]`
        : msg.content == null ? null : `[${typeof msg.content}]`,
  }));
}

// ---------- fetch ----------
// loggedFetch: the drop-in `fetch` replacement this module exists to provide.
// Wraps the given request with signalWithTimeout (meta.timeoutMs, defaulting
// to no timeout) so a hung request can be aborted, logs a 'start' event
// (with headers redacted via redactHeaders and the body summarized via
// summarizeBody) before sending, and logs an 'end' or 'error' event after —
// stamping the response with `_notlinearRequestId` so a later
// readResponseBody/readLoggedErrorPayload call on the same response can be
// correlated back to this request in the log. Called by app.js and every
// provider module (frontend/providers/claude.js, deepseek.js, openai.js,
// tools.js) and the feature views for their calls to backend/server.py's
// /__notlinear_* endpoints (feedback.js's own capture/save calls are the
// documented exception — see the file-level note at the top of this file).
// Header required by every /__notlinear_* endpoint since P2. Added here rather
// than at each call site so a new backend call cannot forget it. Deliberately
// NOT added to every request: loggedFetch is also used for api.anthropic.com
// and the other provider APIs, and sending a custom header there would trigger
// a pointless preflight (and leak that this app made the call).
export const LOCAL_HEADER_NAME = 'X-Notlinear-Local';
export const LOCAL_HEADER = { [LOCAL_HEADER_NAME]: '1' };
export const isLocalEndpoint = (url) => typeof url === 'string' && url.startsWith('/__notlinear_');

export async function loggedFetch(url, options = {}, meta = {}){
  if (isLocalEndpoint(url)) options = { ...options, headers: { ...(options.headers || {}), ...LOCAL_HEADER } };
  const id = ++requestSeq;
  const startedAt = performance.now();
  const startedAtIso = new Date().toISOString();
  const method = options.method || 'GET';
  const timeout = signalWithTimeout(options.signal, meta.timeoutMs || 0, meta.label || url);
  logBackendEvent({
    id,
    kind:'http',
    phase:'start',
    startedAt: startedAtIso,
    method,
    url,
    provider: meta.provider || null,
    label: meta.label || null,
    timeoutMs: meta.timeoutMs || 0,
    headers: redactHeaders(options.headers || {}),
    body: summarizeBody(options.body),
  });
  try {
    const res = await fetch(url, { ...options, signal: timeout.signal });
    logBackendEvent({
      id,
      kind:'http',
      phase:'end',
      startedAt: startedAtIso,
      endedAt: new Date().toISOString(),
      durationMs: Math.round(performance.now() - startedAt),
      method,
      url,
      provider: meta.provider || null,
      label: meta.label || null,
      timeoutMs: meta.timeoutMs || 0,
      status: res.status,
      ok: res.ok,
      statusText: res.statusText,
    });
    res._notlinearRequestId = id;
    return res;
  } catch(e){
    const error = timeout.timedOut()
      ? new RequestTimeoutError(`${meta.label || 'Request'} timed out after ${Math.round((meta.timeoutMs || 0) / 1000)}s.`)
      : e;
    logBackendEvent({
      id,
      kind:'http',
      phase:'error',
      startedAt: startedAtIso,
      endedAt: new Date().toISOString(),
      durationMs: Math.round(performance.now() - startedAt),
      method,
      url,
      provider: meta.provider || null,
      label: meta.label || null,
      timeoutMs: meta.timeoutMs || 0,
      error: error.message || String(error),
    });
    throw error;
  } finally {
    timeout.cleanup();
  }
}

// readResponseBody: read a fetch Response's body (as 'text' or 'json') with
// the same timeout-and-log treatment as loggedFetch — races the read against
// signalWithTimeout so a response whose body never finishes arriving doesn't
// hang forever, and logs body_start/body_end/body_error events correlated
// (via res._notlinearRequestId, set by loggedFetch) to the original request.
// Called by app.js and the provider modules after loggedFetch, for
// non-streaming responses or the final read of a streaming one.
export async function readResponseBody(res, { kind = 'text', signal = null, timeoutMs = TOOL_TIMEOUT_MS, provider = null, label = null } = {}){
  const timeout = signalWithTimeout(signal, timeoutMs, `${label || 'Response body'} body`);
  const startedAt = performance.now();
  let abortHandler = null;
  const requestId = res?._notlinearRequestId || null;
  const readLabel = `${label || 'response'}:${kind}`;
  logBackendEvent({
    id: requestId,
    kind:'http',
    phase:'body_start',
    provider,
    label: readLabel,
    timeoutMs,
    status: res?.status,
    ok: res?.ok,
  });
  const abortPromise = new Promise((_, reject) => {
    abortHandler = () => {
      try { res?.body?.cancel?.().catch?.(()=>{}); } catch(_){}
      reject(timeout.signal.reason || new RequestTimeoutError(`${readLabel} timed out.`));
    };
    if (timeout.signal.aborted) abortHandler();
    else timeout.signal.addEventListener('abort', abortHandler, { once:true });
  });
  try {
    const body = await Promise.race([
      kind === 'json' ? res.json() : res.text(),
      abortPromise,
    ]);
    logBackendEvent({
      id: requestId,
      kind:'http',
      phase:'body_end',
      provider,
      label: readLabel,
      durationMs: Math.round(performance.now() - startedAt),
      status: res?.status,
      ok: res?.ok,
    });
    return body;
  } catch(e){
    const error = timeout.timedOut()
      ? new RequestTimeoutError(`${readLabel} timed out after ${Math.round(timeoutMs / 1000)}s.`)
      : e;
    logBackendEvent({
      id: requestId,
      kind:'http',
      phase:'body_error',
      provider,
      label: readLabel,
      durationMs: Math.round(performance.now() - startedAt),
      status: res?.status,
      ok: res?.ok,
      error: error.message || String(error),
    });
    throw error;
  } finally {
    if (abortHandler) timeout.signal.removeEventListener('abort', abortHandler);
    timeout.cleanup();
  }
}

// readLoggedErrorPayload: convenience wrapper around readResponseBody for the
// error-response case — reads the body as text (swallowing a body-read
// failure into ''), best-effort JSON.parses it, logs a 'response_body' event
// with the parsed/raw body, and returns it to the caller to build a
// user-facing error message from (see markdown.js's friendlyError, which
// pattern-matches against strings derived from bodies like this). Called by
// app.js and the provider modules when a backend/provider request comes back
// with a non-ok status.
export async function readLoggedErrorPayload(res, meta = {}){
  const text = await readResponseBody(res, {
    kind:'text',
    signal:null,
    timeoutMs:meta.timeoutMs || TOOL_TIMEOUT_MS,
    provider:meta.provider || null,
    label:meta.label || 'error_body',
  }).catch(() => '');
  let body = text;
  try { body = text ? JSON.parse(text) : {}; } catch(_){}
  logBackendEvent({
    id: res._notlinearRequestId || null,
    kind:'http',
    phase:'response_body',
    endedAt: new Date().toISOString(),
    provider: meta.provider || null,
    label: meta.label || null,
    status: res.status,
    ok: res.ok,
    body,
  });
  return body;
}
