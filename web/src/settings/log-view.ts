import type { LogEntry } from '../lib/request-log';

// How a raw request-log entry is shown in Settings -> Runtime logs. Pure, so it can be tested
// without a DOM. The entries themselves are built (and their credentials redacted) in
// lib/request-log.ts; nothing here adds data to them.

export type LogKind = 'llm' | 'tool' | 'error';
export type LogFilter = 'all' | LogKind;

/** Providers that are tools the model calls, rather than a model it talks to. */
const TOOL_PROVIDERS = new Set(['wikipedia', 'jina', 'searxng', 'serper', 'firecrawl', 'github']);

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function classify(e: LogEntry): LogKind {
  const status = num(e.status);
  if (e.kind === 'error' || e.phase === 'error' || e.phase === 'body_error' || e.error || e.ok === false || (status !== null && status >= 400)) return 'error';
  if (e.kind === 'tool' || TOOL_PROVIDERS.has(str(e.provider))) return 'tool';
  return 'llm';
}

/** `/v1/messages` from a full URL: no origin and no query string, which can carry a key. */
function path(url: string): string {
  try {
    return new URL(url, 'http://local').pathname;
  } catch {
    return url.split('?')[0] ?? '';
  }
}

export function titleOf(e: LogEntry): string {
  const what = str(e.label) || (str(e.url) ? path(str(e.url)) : '') || str(e.name);
  const outcome = num(e.status) !== null ? String(e.status) : str(e.error) || str(e.phase);
  return [str(e.provider), what, outcome].filter(Boolean).join(' · ') || 'event';
}

export function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

const compact = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

export function metaOf(e: LogEntry): string {
  const parts: string[] = [];
  const d = num(e.durationMs);
  if (d !== null) parts.push(formatDuration(d));
  const tokens = (num(e.inputTokens) ?? 0) + (num(e.outputTokens) ?? 0);
  if (tokens > 0) parts.push(`${compact(tokens)} tok`);
  return parts.join(' · ');
}

/** HH:MM:SS in the viewer's time zone. */
export function clockOf(timestamp: string): string {
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return '--:--:--';
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function countByKind(entries: readonly LogEntry[]): Record<LogFilter, number> {
  const out: Record<LogFilter, number> = { all: entries.length, llm: 0, tool: 0, error: 0 };
  for (const e of entries) out[classify(e)]++;
  return out;
}
