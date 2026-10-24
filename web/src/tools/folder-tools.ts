import { loggedFetch, TOOL_TIMEOUT_MS } from '../lib/api-client';

// The linked-folder tools: live reads through /__notlinear_list_dir and /__notlinear_read_file.
// The folder root is passed in by the app (from the chat's project), never by the model, which
// supplies only a path relative to it. Refusals (secrets, escapes, binary, too big) come back as
// plain text for the model rather than as thrown errors, so it can try something else.

interface Entry { name: string; type: 'dir' | 'file'; size?: number }
interface ListReply { ok?: boolean; error?: string; path?: string; entries?: Entry[]; truncated?: boolean }
interface ReadReply { ok?: boolean; error?: string; path?: string; text?: string; start?: number; end?: number; total?: number }

async function post<T>(endpoint: string, body: Record<string, unknown>, label: string, signal: AbortSignal): Promise<T> {
  const res = await loggedFetch(endpoint, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal,
  }, { provider: 'notlinear', label, timeoutMs: TOOL_TIMEOUT_MS });
  try { return await res.json() as T; } catch { return { ok: false, error: `unreadable response (${res.status})` } as T; }
}

const sizeLabel = (n: number): string => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

export async function runListProjectFiles(root: string, pathIn: unknown, signal: AbortSignal): Promise<string> {
  const sub = String(pathIn ?? '').trim();
  const r = await post<ListReply>('/__notlinear_list_dir', { path: root, sub }, 'list_dir', signal);
  if (!r.ok) return `Cannot list "${sub || '.'}": ${r.error ?? 'unknown error'}`;
  const where = r.path || '.';
  if (!r.entries?.length) return `Directory ${where} is empty.`;
  const lines = r.entries.map(e => (e.type === 'dir' ? `dir:  ${e.name}/` : `file: ${e.name}${e.size != null ? ` (${sizeLabel(e.size)})` : ''}`));
  return `Directory ${where}:\n${lines.join('\n')}${r.truncated ? '\n[listing truncated at the entry limit]' : ''}`;
}

export async function runReadProjectFile(root: string, pathIn: unknown, opts: { query?: string; offset?: number }, signal: AbortSignal): Promise<string> {
  const file = String(pathIn ?? '').trim();
  if (!file) return 'Cannot read: path is required.';
  const r = await post<ReadReply>('/__notlinear_read_file', { path: root, file, offset: opts.offset ?? 0, query: opts.query ?? '' }, 'read_file', signal);
  if (!r.ok) return `Cannot read "${file}": ${r.error ?? 'unknown error'}`;
  const { text = '', start = 0, end = 0, total = 0 } = r;
  if (start === 0 && end >= total) return text;
  const next = end < total ? ` Call again with offset:${end} to continue, or query:"term" to jump to a match.` : '';
  return `${text}\n\n[showing chars ${start}-${end} of ${total}.${next}]`;
}
