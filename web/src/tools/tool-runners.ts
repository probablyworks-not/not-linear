import {
  loggedFetch, readResponseBody, readLoggedErrorPayload, safeJsonForLog, beginBackendTrace, endBackendTrace,
  SEARCH_TIMEOUT_MS, PAGE_READ_TIMEOUT_MS, SCRAPE_TIMEOUT_MS,
} from '../lib/api-client';
import { toolEnv } from './env';
import { runListProjectFiles, runReadProjectFile } from './folder-tools';
import type { ToolName } from '../providers/types';

// The model-facing tools, ported from providers/tools.js. Each runner hits one service and
// returns plain text (markdown-ish) for the model to read as a tool result; executeTool is the
// one dispatch point. Behaviour that matters and is kept exactly:
//
//  * a ToolFatalError aborts the whole turn with a message the user can act on (a missing or
//    rejected key, an unreachable configured endpoint). Anything else is turned into a
//    "Tool error (name): …" string and handed BACK to the model, which can react to it.
//  * long pages are returned one window at a time, with a note on how to read on (offset) or
//    jump (query); the raw text is cached per tool+URL so paging does not refetch.
//
// Keys are read from storage when a tool runs and are never logged: loggedFetch redacts them.

export class ToolFatalError extends Error {
  readonly isToolFatal = true;
  constructor(message: string) {
    super(message);
    this.name = 'ToolFatalError';
  }
}

export const isToolFatal = (e: unknown): e is ToolFatalError => !!e && typeof e === 'object' && (e as { isToolFatal?: unknown }).isToolFatal === true;
const isAbort = (e: unknown): boolean => e instanceof Error && e.name === 'AbortError';

export interface PageWindowOptions { query?: string; offset?: number }

// ---------- paging ----------

const rawTextCache = new Map<string, string>();
/** Test seam: the cache is per page session, so tests must be able to empty it. */
export function clearToolCache(): void { rawTextCache.clear(); }

async function fetchRawTextCached(cacheKey: string, fetcher: () => Promise<string>): Promise<string> {
  const cached = rawTextCache.get(cacheKey);
  if (cached) return cached;
  const text = await fetcher();
  rawTextCache.set(cacheKey, text);
  return text;
}

/**
 * Slices `text` into a bounded window. With `query`, the window is centred on its first
 * (case-insensitive) match; otherwise it starts at `offset`. Says which range was shown and the
 * total, so the model knows how to continue (app.js tools.js windowText).
 */
export function windowText(text: string, { query, offset }: PageWindowOptions, maxChars: number): string {
  let start = Number(offset) || 0;
  if (query) {
    const idx = text.toLowerCase().indexOf(String(query).toLowerCase());
    if (idx !== -1) start = Math.max(0, idx - Math.floor(maxChars / 4));
  }
  start = Math.min(start, Math.max(0, text.length - 1));
  const end = Math.min(start + maxChars, text.length);
  const slice = text.slice(start, end);
  if (text.length <= maxChars && start === 0) return text;
  const next = end < text.length ? ` Call again with offset:${end} to continue, or query:"term" to jump to a match.` : '';
  return `${slice}\n\n[showing chars ${start}-${end} of ${text.length}.${next}]`;
}

// ---------- runners ----------

interface WikiSearch { query?: { search?: Array<{ title: string }> } }
interface WikiSummary { title: string; extract?: string; content_urls?: { desktop?: { page?: string } } }

export async function runWikipediaSearch(query: string, signal: AbortSignal): Promise<string> {
  const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*&srlimit=3`;
  const searchRes = await loggedFetch(searchUrl, { signal }, { provider: 'wikipedia', label: 'search', timeoutMs: SEARCH_TIMEOUT_MS });
  const searchData = await readResponseBody(searchRes, { kind: 'json', signal, provider: 'wikipedia', label: 'search', timeoutMs: SEARCH_TIMEOUT_MS }) as WikiSearch;
  const results = searchData.query?.search || [];
  if (!results.length) return 'No Wikipedia results found for: ' + query;
  const title = results[0]!.title;
  const summaryRes = await loggedFetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, { signal }, { provider: 'wikipedia', label: 'summary', timeoutMs: SEARCH_TIMEOUT_MS });
  const summary = await readResponseBody(summaryRes, { kind: 'json', signal, provider: 'wikipedia', label: 'summary', timeoutMs: SEARCH_TIMEOUT_MS }) as WikiSummary;
  let out = `**${summary.title}**\n${summary.extract || 'No summary available.'}`;
  if (summary.content_urls?.desktop?.page) out += `\nSource: ${summary.content_urls.desktop.page}`;
  if (results.length > 1) out += `\n\nRelated articles: ${results.slice(1).map(r => r.title).join(', ')}`;
  return out;
}

export async function runFetchUrl(url: string, signal: AbortSignal, opts: PageWindowOptions = {}): Promise<string> {
  const text = await fetchRawTextCached(`fetch_url:${url}`, async () => {
    const res = await loggedFetch(`https://r.jina.ai/${url}`, { signal, headers: { Accept: 'text/plain' } }, { provider: 'jina', label: 'fetch_url', timeoutMs: PAGE_READ_TIMEOUT_MS });
    return await readResponseBody(res, { kind: 'text', signal, provider: 'jina', label: 'fetch_url', timeoutMs: PAGE_READ_TIMEOUT_MS }) as string;
  });
  return windowText(text, opts, 4000);
}

interface SearxResult { title: string; url: string; content?: string }

export async function runWebSearch(query: string, signal: AbortSignal): Promise<string> {
  const base = toolEnv().searxngUrl?.replace(/\/$/, '');
  if (!base) throw new ToolFatalError('Web search is not configured. Add a SearXNG URL in Settings, or add a Serper key.');
  const url = `${base}/search?q=${encodeURIComponent(query)}&format=json&categories=general`;
  let res: Awaited<ReturnType<typeof loggedFetch>>;
  try {
    res = await loggedFetch(url, { signal }, { provider: 'searxng', label: 'web_search', timeoutMs: SEARCH_TIMEOUT_MS });
  } catch (e) {
    if (isAbort(e)) throw e;
    throw new ToolFatalError('Could not reach SearXNG. Check the URL in Settings and make sure CORS is enabled.');
  }
  if (!res.ok) {
    await readLoggedErrorPayload(res, { provider: 'searxng', label: 'web_search', timeoutMs: SEARCH_TIMEOUT_MS });
    throw new ToolFatalError(`SearXNG returned ${res.status}. Check the URL in Settings.`);
  }
  const data = await readResponseBody(res, { kind: 'json', signal, provider: 'searxng', label: 'web_search', timeoutMs: SEARCH_TIMEOUT_MS }) as { results?: SearxResult[] };
  const results = (data.results || []).slice(0, 5);
  if (!results.length) return `No web results found for: ${query}`;
  return results.map((r, i) => `${i + 1}. **${r.title}**\n${r.url}\n${r.content || ''}`.trim()).join('\n\n');
}

interface SerperData { answerBox?: { answer?: string }; organic?: Array<{ title: string; link: string; snippet?: string }> }

export async function runSerperSearch(query: string, signal: AbortSignal): Promise<string> {
  const key = toolEnv().apiKeys.serper;
  if (!key) throw new ToolFatalError('Serper API key not set. Add it in Settings, or configure SearXNG for web search.');
  let res: Awaited<ReturnType<typeof loggedFetch>>;
  try {
    res = await loggedFetch('https://google.serper.dev/search', {
      method: 'POST', signal,
      headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, num: 6 }),
    }, { provider: 'serper', label: 'search', timeoutMs: SEARCH_TIMEOUT_MS });
  } catch (e) {
    if (isAbort(e)) throw e;
    throw new ToolFatalError('Could not reach Serper search. Check your connection, or use a SearXNG URL in Settings.');
  }
  if (!res.ok) {
    await readLoggedErrorPayload(res, { provider: 'serper', label: 'search', timeoutMs: SEARCH_TIMEOUT_MS });
    if (res.status === 401 || res.status === 403) throw new ToolFatalError('Serper search key was rejected. Check the Serper key in Settings.');
    if (res.status === 429) throw new ToolFatalError('Serper search is rate limited. Wait a moment and try again.');
    throw new ToolFatalError(`Serper search failed with HTTP ${res.status}.`);
  }
  const data = await readResponseBody(res, { kind: 'json', signal, provider: 'serper', label: 'search', timeoutMs: SEARCH_TIMEOUT_MS }) as SerperData;
  const organic = (data.organic || []).slice(0, 6);
  if (!organic.length) return `No results found for: ${query}`;
  let out = '';
  if (data.answerBox?.answer) out += `**Answer:** ${data.answerBox.answer}\n\n`;
  out += organic.map((r, i) => `${i + 1}. **${r.title}**\n${r.link}\n${r.snippet || ''}`.trim()).join('\n\n');
  return out;
}

export async function runFirecrawlScrape(url: string, signal: AbortSignal, opts: PageWindowOptions = {}): Promise<string> {
  const key = toolEnv().apiKeys.firecrawl;
  if (!key) throw new ToolFatalError('Firecrawl API key not set. Add it in Settings, or retry without Firecrawl scraping.');
  const md = await fetchRawTextCached(`firecrawl_scrape:${url}`, async () => {
    let res: Awaited<ReturnType<typeof loggedFetch>>;
    try {
      res = await loggedFetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST', signal,
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, formats: ['markdown'] }),
      }, { provider: 'firecrawl', label: 'scrape', timeoutMs: SCRAPE_TIMEOUT_MS });
    } catch (e) {
      if (isAbort(e)) throw e;
      throw new ToolFatalError('Could not reach Firecrawl. Check your connection and Firecrawl key in Settings.');
    }
    if (!res.ok) {
      await readLoggedErrorPayload(res, { provider: 'firecrawl', label: 'scrape', timeoutMs: SCRAPE_TIMEOUT_MS });
      if (res.status === 401 || res.status === 403) throw new ToolFatalError('Firecrawl key was rejected. Check it in Settings.');
      if (res.status === 429) throw new ToolFatalError('Firecrawl is rate limited. Wait a moment and try again.');
      throw new ToolFatalError(`Firecrawl failed with HTTP ${res.status}.`);
    }
    const data = await readResponseBody(res, { kind: 'json', signal, provider: 'firecrawl', label: 'scrape', timeoutMs: SCRAPE_TIMEOUT_MS }) as { data?: { markdown?: string }; markdown?: string };
    return data.data?.markdown || data.markdown || '';
  });
  if (!md) return `Firecrawl returned no content for: ${url}`;
  return windowText(md, opts, 6000);
}

// ---------- GitHub (P7 connector) ----------

const GH = 'https://api.github.com';
const REPO_RE = /^[\w.-]+\/[\w.-]+$/;
const clip = (s: string | null | undefined, n: number): string => {
  const t = (s ?? '').replace(/\r/g, '').trim();
  return t.length > n ? t.slice(0, n) + '…' : t;
};

/** One GET against the GitHub REST API with the stored token (header only, never in the URL). */
async function ghGet(path: string, signal: AbortSignal, label: string, accept = 'application/vnd.github+json'): Promise<unknown> {
  const key = toolEnv().apiKeys.github;
  if (!key) throw new ToolFatalError('GitHub token not set. Add it in Settings, or retry without GitHub tools.');
  let res: Awaited<ReturnType<typeof loggedFetch>>;
  try {
    res = await loggedFetch(GH + path, {
      method: 'GET', signal,
      headers: { Authorization: `Bearer ${key}`, Accept: accept, 'X-GitHub-Api-Version': '2022-11-28' },
    }, { provider: 'github', label, timeoutMs: SEARCH_TIMEOUT_MS });
  } catch (e) {
    if (isAbort(e)) throw e;
    throw new ToolFatalError('Could not reach GitHub. Check your connection and GitHub token in Settings.');
  }
  if (!res.ok) {
    await readLoggedErrorPayload(res, { provider: 'github', label, timeoutMs: SEARCH_TIMEOUT_MS });
    if (res.status === 401) throw new ToolFatalError('GitHub token was rejected. Check it in Settings.');
    if (res.status === 403 || res.status === 429) throw new ToolFatalError('GitHub rate limit or permission error. Wait a moment, or check the token\'s access.');
    if (res.status === 404) throw new Error('Not found on GitHub (check the repo, number or path; private repos need a token with access).');
    if (res.status === 422) throw new Error('GitHub rejected that search query. Simplify it or fix the qualifiers.');
    throw new ToolFatalError(`GitHub failed with HTTP ${res.status}.`);
  }
  return readResponseBody(res, { kind: 'json', signal, provider: 'github', label, timeoutMs: SEARCH_TIMEOUT_MS });
}

const needRepo = (repo: unknown): string => {
  const r = String(repo ?? '').trim();
  // ".." and "." match the character class but would let the path climb out of /repos/.
  if (!REPO_RE.test(r) || r.split('/').some(seg => /^\.+$/.test(seg))) throw new Error('repo must look like "owner/name".');
  return r;
};

interface GhRepo { full_name: string; description: string | null; stargazers_count: number; language: string | null; pushed_at: string; html_url: string }
interface GhIssue { number: number; title: string; state: string; html_url: string; comments: number; repository_url?: string; pull_request?: unknown; reactions?: { total_count?: number }; user?: { login?: string }; body?: string | null }
interface GhCode { name: string; path: string; html_url: string; repository: { full_name: string }; text_matches?: Array<{ fragment?: string }> }

export async function runGithubSearchRepos(query: string, signal: AbortSignal): Promise<string> {
  const d = await ghGet(`/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=8`, signal, 'search repos') as { items?: GhRepo[]; total_count?: number };
  const items = d.items ?? [];
  if (!items.length) return `No GitHub repositories found for: ${query}`;
  return items.map((r, i) => `${i + 1}. ${r.full_name} (★${r.stargazers_count}${r.language ? `, ${r.language}` : ''}, pushed ${r.pushed_at.slice(0, 10)})\n   ${clip(r.description, 200) || 'No description'}\n   ${r.html_url}`).join('\n');
}

export async function runGithubSearchIssues(query: string, signal: AbortSignal): Promise<string> {
  const d = await ghGet(`/search/issues?q=${encodeURIComponent(query)}&sort=reactions&order=desc&per_page=8`, signal, 'search issues') as { items?: GhIssue[] };
  const items = d.items ?? [];
  if (!items.length) return `No GitHub issues or pull requests found for: ${query}`;
  return items.map((x, i) => {
    const repo = x.repository_url?.replace('https://api.github.com/repos/', '') ?? '';
    return `${i + 1}. ${repo}#${x.number} [${x.pull_request ? 'PR' : 'issue'}, ${x.state}] ${clip(x.title, 160)} (${x.comments} comments, ${x.reactions?.total_count ?? 0} reactions)\n   ${x.html_url}`;
  }).join('\n');
}

export async function runGithubSearchCode(query: string, signal: AbortSignal): Promise<string> {
  const d = await ghGet(`/search/code?q=${encodeURIComponent(query)}&per_page=8`, signal, 'search code', 'application/vnd.github.text-match+json') as { items?: GhCode[] };
  const items = d.items ?? [];
  if (!items.length) return `No GitHub code found for: ${query}`;
  return items.map((c, i) => {
    const frag = clip(c.text_matches?.[0]?.fragment, 300);
    return `${i + 1}. ${c.repository.full_name}: ${c.path}\n   ${c.html_url}${frag ? `\n   ${frag.replace(/\n/g, '\n   ')}` : ''}`;
  }).join('\n');
}

export async function runGithubGetIssue(repoIn: unknown, numberIn: unknown, signal: AbortSignal, opts: PageWindowOptions = {}): Promise<string> {
  const repo = needRepo(repoIn);
  const n = Math.trunc(Number(numberIn));
  if (!Number.isFinite(n) || n < 1) throw new Error('number must be a positive issue or pull request number.');
  const text = await fetchRawTextCached(`github_get_issue:${repo}#${n}`, async () => {
    const issue = await ghGet(`/repos/${repo}/issues/${n}`, signal, 'get issue') as GhIssue;
    const comments = await ghGet(`/repos/${repo}/issues/${n}/comments?per_page=50`, signal, 'get issue comments') as GhIssue[];
    const head = `${repo}#${n} [${issue.pull_request ? 'PR' : 'issue'}, ${issue.state}] ${issue.title}\nby ${issue.user?.login ?? 'unknown'}\n\n${clip(issue.body, 4000)}`;
    const rest = comments.map(c => `---\n${c.user?.login ?? 'unknown'}:\n${clip(c.body, 2000)}`).join('\n');
    return rest ? `${head}\n\n## Comments (${comments.length})\n${rest}` : head;
  });
  return windowText(text, opts, 6000);
}

export async function runGithubGetFile(repoIn: unknown, pathIn: unknown, refIn: unknown, signal: AbortSignal, opts: PageWindowOptions = {}): Promise<string> {
  const repo = needRepo(repoIn);
  const path = String(pathIn ?? '').replace(/^\/+/, '');
  const ref = refIn ? String(refIn) : '';
  const text = await fetchRawTextCached(`github_get_file:${repo}:${ref}:${path}`, async () => {
    const encoded = path.split('/').map(encodeURIComponent).join('/');
    const d = await ghGet(`/repos/${repo}/contents/${encoded}${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`, signal, 'get file');
    if (Array.isArray(d)) return `Directory ${repo}/${path}:\n` + (d as Array<{ name: string; type: string }>).map(f => `${f.type === 'dir' ? 'dir:' : 'file:'} ${f.name}`).join('\n');
    const f = d as { content?: string; encoding?: string; type?: string; size?: number };
    if (f.type !== 'file' || f.encoding !== 'base64' || typeof f.content !== 'string') return `${repo}/${path} is a ${f.type ?? 'non-text item'} (${f.size ?? '?'} bytes) and cannot be shown as text.`;
    const bin = atob(f.content.replace(/\s/g, ''));
    return new TextDecoder().decode(Uint8Array.from(bin, ch => ch.charCodeAt(0)));
  });
  return windowText(text, opts, 6000);
}

// ---------- dispatch ----------

/** What the app (not the model) knows about this turn. */
export interface ToolRunContext { /** The chat's linked folder; the model only ever names paths inside it. */ folderRoot?: string }

export interface ToolInput { query?: string; url?: string; offset?: number; repo?: string; number?: number; path?: string; ref?: string }

/** What a provider calls. Throws only for abort and ToolFatalError; every other failure is a result string. */
export type ToolRunner = (name: ToolName | string, input: ToolInput, signal: AbortSignal, ctx?: ToolRunContext) => Promise<string>;

export const executeTool: ToolRunner = async (name, input, signal, ctx = {}) => {
  const trace = beginBackendTrace('tool', { tool: name, input: safeJsonForLog(input) });
  try {
    let result: string;
    if (name === 'wikipedia_search') result = await runWikipediaSearch(String(input.query), signal);
    else if (name === 'fetch_url') result = await runFetchUrl(String(input.url), signal, { query: input.query, offset: input.offset });
    else if (name === 'web_search') result = await runWebSearch(String(input.query), signal);
    else if (name === 'serper_search') result = await runSerperSearch(String(input.query), signal);
    else if (name === 'firecrawl_scrape') result = await runFirecrawlScrape(String(input.url), signal, { query: input.query, offset: input.offset });
    else if (name === 'github_search_repos') result = await runGithubSearchRepos(String(input.query), signal);
    else if (name === 'github_search_issues') result = await runGithubSearchIssues(String(input.query), signal);
    else if (name === 'github_search_code') result = await runGithubSearchCode(String(input.query), signal);
    else if (name === 'github_get_issue') result = await runGithubGetIssue(input.repo, input.number, signal, { query: input.query, offset: input.offset });
    else if (name === 'github_get_file') result = await runGithubGetFile(input.repo, input.path, input.ref, signal, { query: input.query, offset: input.offset });
    else if (name === 'list_project_files') result = ctx.folderRoot ? await runListProjectFiles(ctx.folderRoot, input.path, signal) : 'No project folder is linked to this chat.';
    else if (name === 'read_project_file') result = ctx.folderRoot ? await runReadProjectFile(ctx.folderRoot, input.path, { query: input.query, offset: input.offset }, signal) : 'No project folder is linked to this chat.';
    else result = 'Unknown tool: ' + name;
    endBackendTrace(trace, 'end', { tool: name, outputChars: String(result || '').length, outputPreview: safeJsonForLog(result, 500) });
    return result;
  } catch (e) {
    const err = e as Error;
    endBackendTrace(trace, isAbort(e) ? 'abort' : 'error', { tool: name, error: err.message || String(e), fatal: isToolFatal(e) });
    if (isAbort(e) || isToolFatal(e)) throw e;
    return `Tool error (${name}): ${err.message}`;
  }
};

// ---------- presentation helpers ----------

export function toolResultTitle(name: string, input: ToolInput = {}): string {
  if (name === 'wikipedia_search') return `Wikipedia: ${input.query || 'search'}`;
  if (name === 'serper_search') return `Google search: ${input.query || 'search'}`;
  if (name === 'web_search') return `Web search: ${input.query || 'search'}`;
  if (name === 'firecrawl_scrape') return `Scrape: ${input.url || 'URL'}`;
  if (name === 'fetch_url') return `Page read: ${input.url || 'URL'}`;
  if (name === 'github_search_repos') return `GitHub repos: ${input.query || 'search'}`;
  if (name === 'github_search_issues') return `GitHub issues: ${input.query || 'search'}`;
  if (name === 'github_search_code') return `GitHub code: ${input.query || 'search'}`;
  if (name === 'github_get_issue') return `GitHub issue: ${input.repo || ''}#${input.number ?? ''}`;
  if (name === 'github_get_file') return `GitHub file: ${input.repo || ''}/${input.path || ''}`;
  if (name === 'list_project_files') return `Project folder: ${input.path || '.'}`;
  if (name === 'read_project_file') return `Project file: ${input.path || ''}`;
  return name || 'Tool result';
}

export interface ToolResultRecord { name: string; input: ToolInput; content: string }

/** The answer shown when the model stalls after searching: the raw results, labelled (bugs #012, #017, #018). */
export function toolResultFallbackMarkdown(results: readonly ToolResultRecord[]): string {
  if (!results?.length) return '';
  const sections = results.map((item, i) => {
    const content = String(item.content || '').trim();
    const trimmed = content.length > 5000 ? content.slice(0, 5000) + '\n\n[results truncated]' : content;
    return `### ${i + 1}. ${toolResultTitle(item.name, item.input)}\n\n${trimmed || 'No result content returned.'}`;
  });
  return [
    'Search completed, but the model stalled while turning the results into a final answer.',
    'Here are the retrieved results:',
    ...sections,
  ].join('\n\n');
}

/** The status line shown while a tool runs (claude.js:262, deepseek.js:431). */
export function toolStatusLabel(name: string, input: ToolInput): string {
  if (name === 'wikipedia_search') return `Searching Wikipedia for "${input.query}"…`;
  if (name === 'serper_search') return `Searching Google for "${input.query}"…`;
  if (name === 'web_search') return `Searching for "${input.query}"…`;
  if (name === 'firecrawl_scrape') return `Scraping ${input.url}…`;
  if (name === 'github_search_repos') return `Searching GitHub repos for "${input.query}"…`;
  if (name === 'github_search_issues') return `Searching GitHub issues for "${input.query}"…`;
  if (name === 'github_search_code') return `Searching GitHub code for "${input.query}"…`;
  if (name === 'github_get_issue') return `Reading ${input.repo}#${input.number}…`;
  if (name === 'github_get_file') return `Reading ${input.repo}/${input.path}…`;
  if (name === 'list_project_files') return `Reading folder ${input.path || '.'}…`;
  if (name === 'read_project_file') return `Reading ${input.path}…`;
  return `Reading ${input.url}…`;
}
