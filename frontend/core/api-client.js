// Network / logging infrastructure.
// No DOM dependencies except the console. Decouples from UI rendering by
// dispatching 'notlinear:log' on window; app.js listens to schedule rendering.

// ---------- timeout constants ----------
export const REQUEST_LOG_LIMIT = 300;
export const RUNTIME_LOG_SYNC_ENDPOINT = '/__notlinear_runtime_logs';
export const RUNTIME_LOG_SYNC_DEBOUNCE_MS = 1200;
export const TOOL_TIMEOUT_MS = 20000;
export const SEARCH_TIMEOUT_MS = 12000;
export const PAGE_READ_TIMEOUT_MS = 16000;
export const SCRAPE_TIMEOUT_MS = 24000;
export const MODEL_CONNECT_TIMEOUT_MS = 70000;
export const MODEL_STREAM_IDLE_TIMEOUT_MS = 120000;
export const TOOL_SYNTHESIS_IDLE_TIMEOUT_MS = 30000;
export const DEEPSEEK_MAX_TOOL_ROUNDS = 2;

// ---------- request log ----------
export const requestLog = window.notlinearRequestLog = window.notlinearRequestLog || [];
let requestSeq = requestLog.length;
let traceSeq = requestLog.length;

// ---------- helpers ----------
function redactHeaders(headers = {}){
  return Object.fromEntries(Object.entries(headers).map(([k,v]) =>
    /authorization|api[-_]?key|x-api-key/i.test(k) ? [k, '[redacted]'] : [k, v]
  ));
}
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
export class RequestTimeoutError extends Error {
  constructor(message){
    super(message);
    this.name = 'RequestTimeoutError';
    this.isTimeout = true;
  }
}

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
function logBackendEvent(entry){
  requestLog.push({ timestamp: new Date().toISOString(), ...entry });
  if (requestLog.length > REQUEST_LOG_LIMIT) requestLog.splice(0, requestLog.length - REQUEST_LOG_LIMIT);
  // Notify app.js to schedule UI rendering + file sync without creating a direct dependency.
  window.dispatchEvent(new CustomEvent('notlinear:log'));
  const level = entry.error || entry.status >= 400 ? 'warn' : 'log';
  console[level]('[notlinear backend]', entry);
}

export function beginBackendTrace(kind, meta = {}){
  const id = `${kind}-${++traceSeq}`;
  const trace = { id, kind, startedAtMs: performance.now(), startedAt: new Date().toISOString(), done:false };
  logBackendEvent({ id, kind, phase:'start', startedAt:trace.startedAt, ...meta });
  return trace;
}

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
export async function loggedFetch(url, options = {}, meta = {}){
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
