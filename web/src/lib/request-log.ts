// The request log: an in-memory ring buffer of recent backend requests and
// traces, ported from core/api-client.js (lines 29-336) with its behaviour intact.
//
// AGENTS.md hard rule: API keys are never logged. That is enforced HERE, at the
// moment an entry is built, by redactHeaders(); nothing downstream (the viewer,
// the copy button, the logs.md sync) has to remember to scrub. Request bodies
// are summarised so prompt content does not land in the log either.
//
// Only the logging half of api-client lives here. The streaming/timeout readers
// (readStreamChunk, readResponseBody) arrive with the chat core in P5a.

export const REQUEST_LOG_LIMIT = 300;
export const RUNTIME_LOG_SYNC_ENDPOINT = '/__notlinear_runtime_logs';
export const RUNTIME_LOG_SYNC_DEBOUNCE_MS = 1200;

export type LogEntry = { timestamp: string } & Record<string, unknown>;

declare global {
  interface Window { notlinearRequestLog?: LogEntry[] }
}

/**
 * Stashed on `window` under the legacy name so it survives module re-evaluation
 * and can be inspected from the console while debugging.
 */
export const requestLog: LogEntry[] = (window.notlinearRequestLog = window.notlinearRequestLog || []);
let requestSeq = requestLog.length;
let traceSeq = requestLog.length;

/** Fired on every logged event so the viewer and the file sync can react without importing each other. */
export const LOG_EVENT = 'notlinear:log';

// ---------- redaction ----------

/** Any header whose NAME looks like a credential has its value replaced. Case-insensitive. */
export function redactHeaders(headers: Record<string, string> = {}): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([k, v]) =>
    /authorization|api[-_]?key|x-api-key/i.test(k) ? [k, '[redacted]'] : [k, v]));
}

/**
 * Shrinks a request body for logging: known-large JSON fields collapse to a
 * size placeholder, anything unparseable is truncated to 500 characters.
 */
export function summarizeBody(body: unknown): unknown {
  if (!body || typeof body !== 'string') return null;
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    if (parsed.messages) parsed.messages = `[${(parsed.messages as unknown[]).length} messages]`;
    if (parsed.system) parsed.system = `[${String(parsed.system).length} chars]`;
    if (parsed.tools) parsed.tools = `[${(parsed.tools as unknown[]).length} tools]`;
    return parsed;
  } catch {
    return body.length > 500 ? body.slice(0, 500) + '…' : body;
  }
}

/** Stringify for logging, truncate, and re-parse so structured data stays structured when it can. */
export function safeJsonForLog(value: unknown, maxChars = 700): unknown {
  if (value == null) return value;
  let out: string;
  try {
    out = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    out = String(value);
  }
  if (out.length > maxChars) out = out.slice(0, maxChars - 1).trim() + '…';
  try {
    return JSON.parse(out);
  } catch {
    return out;
  }
}

/** Per-message role and a size hint, never the content. */
export function summarizeMessagesForLog(messages: Array<{ role?: string; content?: unknown }> | null = []): Array<Record<string, unknown>> {
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

// ---------- logging ----------

export function logBackendEvent(entry: Record<string, unknown>): void {
  requestLog.push({ timestamp: new Date().toISOString(), ...entry });
  if (requestLog.length > REQUEST_LOG_LIMIT) requestLog.splice(0, requestLog.length - REQUEST_LOG_LIMIT);
  window.dispatchEvent(new CustomEvent(LOG_EVENT));
  const level = entry.error || (typeof entry.status === 'number' && entry.status >= 400) ? 'warn' : 'log';
  console[level]('[notlinear backend]', entry);
}

export interface Trace { id: string; kind: string; startedAtMs: number; startedAt: string; done: boolean }

/** Logs the start of a multi-step operation and returns a handle for endBackendTrace. */
export function beginBackendTrace(kind: string, meta: Record<string, unknown> = {}): Trace {
  const id = `${kind}-${++traceSeq}`;
  const trace: Trace = { id, kind, startedAtMs: performance.now(), startedAt: new Date().toISOString(), done: false };
  logBackendEvent({ id, kind, phase: 'start', startedAt: trace.startedAt, ...meta });
  return trace;
}

/** Idempotent: safe to call from a `finally`, and a no-op for a falsy or already-ended trace. */
export function endBackendTrace(trace: Trace | null | undefined, phase = 'end', meta: Record<string, unknown> = {}): void {
  if (!trace || trace.done) return;
  trace.done = true;
  logBackendEvent({
    id: trace.id, kind: trace.kind, phase, startedAt: trace.startedAt, endedAt: new Date().toISOString(),
    durationMs: Math.round(performance.now() - trace.startedAtMs), ...meta,
  });
}

// ---------- timeouts and fetch ----------

export class RequestTimeoutError extends Error {
  readonly isTimeout = true;
  constructor(message: string) {
    super(message);
    this.name = 'RequestTimeoutError';
  }
}

/** Aborts on the parent signal OR after `timeoutMs`, whichever comes first. Call `cleanup()` when done. */
export function signalWithTimeout(parentSignal: AbortSignal | null | undefined, timeoutMs: number, label?: string) {
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | 0 = 0;
  const cleanup = (): void => {
    if (timer) clearTimeout(timer);
    parentSignal?.removeEventListener?.('abort', onParentAbort);
  };
  const onParentAbort = (): void => {
    cleanup();
    controller.abort(parentSignal!.reason);
  };
  if (parentSignal?.aborted) {
    controller.abort(parentSignal.reason);
  } else {
    parentSignal?.addEventListener?.('abort', onParentAbort, { once: true });
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        cleanup();
        controller.abort(new RequestTimeoutError(`${label || 'Request'} timed out.`));
      }, timeoutMs);
    }
  }
  return { signal: controller.signal, cleanup, timedOut: () => timedOut };
}

export const LOCAL_HEADER_NAME = 'X-Notlinear-Local';
export const isLocalEndpoint = (url: unknown): boolean => typeof url === 'string' && url.startsWith('/__notlinear_');

export interface LoggedFetchMeta { provider?: string | null; label?: string | null; timeoutMs?: number }

/**
 * The drop-in `fetch` that logs a start, an end or an error event for each
 * request, with credential headers redacted and the body summarised. Adds
 * X-Notlinear-Local to this server's own endpoints and ONLY to those: sending a
 * custom header to a provider API would force a preflight.
 */
export async function loggedFetch(url: string, options: RequestInit = {}, meta: LoggedFetchMeta = {}): Promise<Response & { _notlinearRequestId?: number }> {
  if (isLocalEndpoint(url)) options = { ...options, headers: { ...((options.headers as Record<string, string>) || {}), [LOCAL_HEADER_NAME]: '1' } };
  const id = ++requestSeq;
  const startedAt = performance.now();
  const startedAtIso = new Date().toISOString();
  const method = options.method || 'GET';
  const timeout = signalWithTimeout(options.signal, meta.timeoutMs || 0, meta.label || url);
  const common = { method, url, provider: meta.provider || null, label: meta.label || null, timeoutMs: meta.timeoutMs || 0 };
  logBackendEvent({
    id, kind: 'http', phase: 'start', startedAt: startedAtIso, ...common,
    headers: redactHeaders((options.headers as Record<string, string>) || {}),
    body: summarizeBody(options.body),
  });
  try {
    const res = await fetch(url, { ...options, signal: timeout.signal }) as Response & { _notlinearRequestId?: number };
    logBackendEvent({
      id, kind: 'http', phase: 'end', startedAt: startedAtIso, endedAt: new Date().toISOString(),
      durationMs: Math.round(performance.now() - startedAt), ...common,
      status: res.status, ok: res.ok, statusText: res.statusText,
    });
    res._notlinearRequestId = id;
    return res;
  } catch (e) {
    const error = timeout.timedOut()
      ? new RequestTimeoutError(`${meta.label || 'Request'} timed out after ${Math.round((meta.timeoutMs || 0) / 1000)}s.`)
      : e as Error;
    logBackendEvent({
      id, kind: 'http', phase: 'error', startedAt: startedAtIso, endedAt: new Date().toISOString(),
      durationMs: Math.round(performance.now() - startedAt), ...common,
      error: error.message || String(error),
    });
    throw error;
  } finally {
    timeout.cleanup();
  }
}

/** Test seam: empty the buffer in place (it is shared by reference). */
export function clearRequestLog(): void {
  requestLog.splice(0, requestLog.length);
}
