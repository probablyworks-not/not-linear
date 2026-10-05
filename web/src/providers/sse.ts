import { MODEL_STREAM_IDLE_TIMEOUT_MS, readStreamChunk } from '../lib/api-client';
import { RequestTimeoutError } from '../lib/request-log';
import type { ErrorKind } from './types';

/**
 * Yields the payload of each `data: ` line of a server-sent-event body, with
 * the idle timeout every provider shares (a stalled stream becomes an error,
 * not an endless spinner). `[DONE]` is swallowed. Partial lines are buffered
 * across chunk boundaries.
 */
export async function* sseData(
  res: Response,
  signal: AbortSignal,
  label: string,
  idleMs: number = MODEL_STREAM_IDLE_TIMEOUT_MS,
): AsyncGenerator<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      if (signal.aborted) return;
      const { done, value } = await readStreamChunk(reader, signal, idleMs, label);
      if (done) return;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6);
        if (raw !== '[DONE]') yield raw;
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

/** Maps a thrown value to the kind the UI branches on. */
export function errorKindOf(e: unknown, signal: AbortSignal): ErrorKind {
  if (signal.aborted && !(signal.reason instanceof RequestTimeoutError)) return 'aborted';
  if (e instanceof RequestTimeoutError) return 'timeout';
  if (e instanceof Error && e.name === 'AbortError') return 'aborted';
  return 'other';
}

export function messageOf(e: unknown, fallback: string): string {
  return (e instanceof Error && e.message) || fallback;
}
