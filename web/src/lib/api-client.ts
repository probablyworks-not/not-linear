// The streaming and timeout half of core/api-client.js, ported verbatim in
// behaviour. The logging half (loggedFetch, traces, redaction) landed in P4 as
// request-log.ts and is re-exported here so a provider imports from one place.
//
// Hard rule (AGENTS.md): API keys are never logged. loggedFetch redacts
// credential headers when it builds a log entry; nothing in this file ever sees
// a key.

import { logBackendEvent, RequestTimeoutError, signalWithTimeout } from './request-log';

export {
  beginBackendTrace, endBackendTrace, loggedFetch, logBackendEvent, RequestTimeoutError,
  signalWithTimeout, summarizeMessagesForLog, safeJsonForLog,
} from './request-log';

export const TOOL_TIMEOUT_MS = 20000;
export const SEARCH_TIMEOUT_MS = 12000;
export const PAGE_READ_TIMEOUT_MS = 8000;
export const SCRAPE_TIMEOUT_MS = 24000;
export const MODEL_CONNECT_TIMEOUT_MS = 70000;
export const MODEL_STREAM_IDLE_TIMEOUT_MS = 120000;
export const TOOL_SYNTHESIS_IDLE_TIMEOUT_MS = 30000;
/** DeepSeek gets this many tool rounds before it is made to answer from what it has (bug #015). */
export const DEEPSEEK_MAX_TOOL_ROUNDS = 2;
/** Exploring a codebase takes many small reads (list, read, list, read…), so the folder tools get a larger budget than web research. */
export const DEEPSEEK_MAX_FOLDER_TOOL_ROUNDS = 8;

type TrackedResponse = Response & { _notlinearRequestId?: number };

/**
 * Reads one chunk, racing a timer so a stream that stops sending data surfaces
 * as an error instead of leaving the composer spinning forever.
 */
export async function readStreamChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal | null | undefined,
  timeoutMs: number,
  label?: string,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (!timeoutMs) return reader.read();
  let timer: ReturnType<typeof setTimeout> | 0 = 0;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reader.cancel().catch(() => {});
          reject(new RequestTimeoutError(`${label || 'Stream'} stopped sending data. Try again with a narrower query.`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (signal?.aborted) reader.cancel().catch(() => {});
  }
}

interface BodyOptions {
  kind?: 'text' | 'json';
  signal?: AbortSignal | null;
  timeoutMs?: number;
  provider?: string | null;
  label?: string | null;
}

/** Reads a response body with the same timeout-and-log treatment as loggedFetch. */
export async function readResponseBody(res: TrackedResponse, opts: BodyOptions = {}): Promise<unknown> {
  const { kind = 'text', signal = null, timeoutMs = TOOL_TIMEOUT_MS, provider = null, label = null } = opts;
  const timeout = signalWithTimeout(signal, timeoutMs, `${label || 'Response body'} body`);
  const startedAt = performance.now();
  const requestId = res._notlinearRequestId ?? null;
  const readLabel = `${label || 'response'}:${kind}`;
  const common = { id: requestId, kind: 'http', provider, label: readLabel, status: res.status, ok: res.ok };
  logBackendEvent({ ...common, phase: 'body_start', timeoutMs });

  let abortHandler: (() => void) | null = null;
  const abortPromise = new Promise<never>((_, reject) => {
    abortHandler = () => {
      try { void res.body?.cancel?.().catch?.(() => {}); } catch { /* already closed */ }
      reject(timeout.signal.reason ?? new RequestTimeoutError(`${readLabel} timed out.`));
    };
    if (timeout.signal.aborted) abortHandler();
    else timeout.signal.addEventListener('abort', abortHandler, { once: true });
  });
  try {
    const body = await Promise.race([kind === 'json' ? res.json() as Promise<unknown> : res.text(), abortPromise]);
    logBackendEvent({ ...common, phase: 'body_end', durationMs: Math.round(performance.now() - startedAt) });
    return body;
  } catch (e) {
    const error = timeout.timedOut()
      ? new RequestTimeoutError(`${readLabel} timed out after ${Math.round(timeoutMs / 1000)}s.`)
      : e as Error;
    logBackendEvent({ ...common, phase: 'body_error', durationMs: Math.round(performance.now() - startedAt), error: error.message || String(error) });
    throw error;
  } finally {
    if (abortHandler) timeout.signal.removeEventListener('abort', abortHandler);
    timeout.cleanup();
  }
}

export interface ProviderErrorBody { error?: { message?: string } }

/** Reads and logs an error response's body, best-effort parsed as JSON. */
export async function readLoggedErrorPayload(
  res: TrackedResponse,
  meta: { timeoutMs?: number; provider?: string | null; label?: string | null } = {},
): Promise<ProviderErrorBody> {
  const text = await readResponseBody(res, {
    kind: 'text', signal: null, timeoutMs: meta.timeoutMs || TOOL_TIMEOUT_MS,
    provider: meta.provider ?? null, label: meta.label || 'error_body',
  }).catch(() => '') as string;
  let body: unknown = text;
  try { body = text ? JSON.parse(text) : {}; } catch { /* keep the raw text */ }
  logBackendEvent({
    id: res._notlinearRequestId ?? null, kind: 'http', phase: 'response_body',
    endedAt: new Date().toISOString(), provider: meta.provider ?? null, label: meta.label ?? null,
    status: res.status, ok: res.ok, body,
  });
  return (body && typeof body === 'object' ? body : {}) as ProviderErrorBody;
}
