import { loggedFetch, readLoggedErrorPayload } from '../lib/api-client';
import { esc } from '../lib/markdown';
import { readApiKeys } from '../lib/api-keys';
import { useAppStore } from '../state/app-store';

// A project's linked folder as lightweight retrieval (app.js:5155-5290). For each message in a
// project chat: scan the folder (cached five minutes), pick keywords from the question, keep the
// files that match, optionally have DeepSeek rank them, and hand the top ten to the model as
// <project_file> blocks, naming them under the reply as its sources. Every step degrades to the
// one before it: no DeepSeek key, a timeout or a bad answer all fall back to plain keywords.

const SCAN_CACHE_TTL_MS = 5 * 60 * 1000;
const KEYWORD_CACHE_TTL_MS = 30 * 60 * 1000;
const RANKING_CACHE_TTL_MS = 10 * 60 * 1000;
const RANKING_TIMEOUT_MS = 5000;
export const PROJECT_FOLDER_FILE_CHAR_LIMIT = 3000;
/** Past this a file is a book or a dump, not a note: its first 3000 characters are front matter, so the part that matches the question is sent too. A departure from legacy, which only ever sends the start. */
export const LONG_FILE_CHARS = 30_000;
const EXCERPT_HEAD = 1000;
const EXCERPT_WINDOW = 2500;
const EXCERPT_STEP = 500;
export const PROJECT_FOLDER_MAX_FILES = 10;

export type RankingMode = 'inherit' | 'none' | 'keywords' | 'deepseek';

export interface ScannedFile { present?: boolean; text: string; relativePath: string; filename: string; score?: number }
interface Scan { ok?: boolean; contextFiles?: ScannedFile[]; markdownFiles?: ScannedFile[] }

export interface FolderContext {
  contextBlock: string;
  /** File names to show under the reply ("Sources (keywords):"). */
  sources: string[];
  mode: string;
}

export interface FolderEnv {
  /** The linked folder's path, or '' when the project has none. */
  path: string;
  deepseekKey?: string;
  /** The global ranking default from Settings (`prefs.rankingLlm`). */
  globalMode: string;
}

const scanCache = new Map<string, { scan: Scan; fetchedAt: number }>();
const keywordCache = new Map<string, { keywords: string[]; fetchedAt: number }>();
const rankingCache = new Map<string, { indices: number[]; fetchedAt: number }>();
/** Test seam: these caches live for the page session. */
export function clearProjectContextCaches(): void { scanCache.clear(); keywordCache.clear(); rankingCache.clear(); }

async function fetchProjectScan(pid: string, path: string): Promise<Scan | null> {
  if (!path) return null;
  const hit = scanCache.get(pid);
  if (hit && Date.now() - hit.fetchedAt < SCAN_CACHE_TTL_MS) return hit.scan;
  try {
    const res = await loggedFetch('/__notlinear_scan_project', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path }),
    }, { provider: 'notlinear', label: 'scan_project' });
    if (!res.ok) return null;
    const scan = await res.json() as Scan;
    if (!scan.ok) return null;
    scanCache.set(pid, { scan, fetchedAt: Date.now() });
    return scan;
  } catch { return null; }
}

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'are', 'was', 'were',
  'will', 'would', 'could', 'should', 'what', 'when', 'where', 'which', 'who', 'how',
  'why', 'can', 'not', 'but', 'you', 'your', 'we', 'our', 'they', 'their', 'it', 'its',
  'be', 'been', 'being', 'do', 'does', 'did', 'has', 'had', 'is', 'in', 'on', 'at', 'to',
  'of', 'a', 'an', 'as', 'by', 'or', 'so', 'if', 'then', 'than', 'also', 'any', 'all',
  'about', 'tell', 'me', 'more', 'give', 'please', 'explain', 'describe', 'show',
  'list', 'find', 'get', 'make', 'use', 'need', 'want', 'know', 'think', 'see', 'say',
]);

export function extractKeywords(text: string): string[] {
  return [...new Set(
    text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length >= 3 && !STOP_WORDS.has(w)),
  )].slice(0, 20);
}

async function deepseekJson(key: string, body: Record<string, unknown>): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RANKING_TIMEOUT_MS);
  try {
    const res = await loggedFetch('https://api.deepseek.com/v1/chat/completions', {
      signal: controller.signal, method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: 'deepseek-v4-flash', temperature: 0, stream: false, thinking: { type: 'disabled' }, ...body }),
    }, { provider: 'deepseek', label: 'chat:context-ranking' });
    if (!res.ok) { await readLoggedErrorPayload(res, { provider: 'deepseek', label: 'chat:context-ranking' }); return null; }
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content?.trim() || '[]';
  } catch { return null; } finally { clearTimeout(timer); }
}

async function generateSearchKeywords(query: string, mode: string, key: string | undefined): Promise<string[]> {
  if (!key || mode === 'none' || mode === 'keywords') return extractKeywords(query);
  const cacheKey = query.trim().toLowerCase().slice(0, 200);
  const hit = keywordCache.get(cacheKey);
  if (hit && Date.now() - hit.fetchedAt < KEYWORD_CACHE_TTL_MS) return hit.keywords;
  const text = await deepseekJson(key, {
    max_tokens: 100,
    messages: [
      { role: 'system', content: 'Extract 10–15 precise search keywords from the user query that would help find relevant documentation or code files. Include technical terms, synonyms, and related concepts. Return ONLY a JSON array of strings, e.g. ["authentication","jwt","session","token"].' },
      { role: 'user', content: query },
    ],
  });
  if (text === null) return extractKeywords(query);
  try {
    const match = text.match(/\[[\s\S]*?\]/);
    const keywords = match ? (JSON.parse(match[0]) as unknown[]).filter((k): k is string => typeof k === 'string') : [];
    if (!keywords.length) return extractKeywords(query);
    keywordCache.set(cacheKey, { keywords, fetchedAt: Date.now() });
    return keywords;
  } catch { return extractKeywords(query); }
}

async function rankFilesWithDeepSeek(candidates: ScannedFile[], query: string, pid: string, mode: string, key: string | undefined): Promise<ScannedFile[]> {
  if (!key || mode === 'none' || mode === 'keywords') return candidates;
  const cacheKey = `${pid}::${query.trim().toLowerCase().slice(0, 100)}`;
  const hit = rankingCache.get(cacheKey);
  if (hit && Date.now() - hit.fetchedAt < RANKING_CACHE_TTL_MS) return hit.indices.map(i => candidates[i]).filter((f): f is ScannedFile => !!f);
  const fileList = candidates.map((f, i) => `[${i}] ${f.filename} (${f.relativePath}): ${f.text.slice(0, 200).replace(/\n/g, ' ').trim()}`).join('\n');
  const text = await deepseekJson(key, {
    max_tokens: 150,
    messages: [
      { role: 'system', content: 'You are a file relevance ranker. Given a user query and numbered files with snippets, return a JSON array of file indices ranked by relevance (most relevant first). Return ONLY valid JSON like [2,0,4]. Include only relevant files. If none are relevant, return [].' },
      { role: 'user', content: `Query: "${query}"\n\nFiles:\n${fileList}` },
    ],
  });
  if (text === null) return candidates;
  try {
    const match = text.match(/\[[\d,\s]*\]/);
    const indices = match ? JSON.parse(match[0]) as number[] : [];
    if (!Array.isArray(indices) || !indices.length) return candidates;
    rankingCache.set(cacheKey, { indices, fetchedAt: Date.now() });
    return indices.map(i => candidates[i]).filter((f): f is ScannedFile => !!f);
  } catch { return candidates; }
}

/** The relevant files of a project's linked folder for this question, as a context block plus the names used. */
export async function buildProjectFolderContext(pid: string | undefined, query: string, rankingMode: RankingMode | string | undefined, env: FolderEnv): Promise<FolderContext> {
  if (!pid || !env.path) return { contextBlock: '', sources: [], mode: 'none' };
  const scan = await fetchProjectScan(pid, env.path);
  if (!scan) return { contextBlock: '', sources: [], mode: 'none' };
  const mode = rankingMode && rankingMode !== 'inherit' ? rankingMode : (env.globalMode || 'none');
  const allFiles = (scan.contextFiles || scan.markdownFiles || []).filter(f => f.present && f.text);
  if (!allFiles.length) return { contextBlock: '', sources: [], mode };

  const keywords = await generateSearchKeywords(query, mode, env.deepseekKey);
  let candidates = keywords.length
    ? allFiles
      .map(f => {
        const haystack = (f.relativePath + ' ' + f.text.slice(0, 500)).toLowerCase();
        return { ...f, score: keywords.reduce((n, kw) => n + (haystack.includes(kw.toLowerCase()) ? 1 : 0), 0) };
      })
      .filter(f => f.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 30)
    : allFiles.slice(0, 30);
  if (!candidates.length) candidates = allFiles.slice(0, 30);

  const top = (await rankFilesWithDeepSeek(candidates, query, pid, mode, env.deepseekKey)).slice(0, PROJECT_FOLDER_MAX_FILES);
  if (!top.length) return { contextBlock: '', sources: [], mode };

  const parts = top.map(f => {
    const body = fileBody(f.text, keywords);
    return `<project_file path="${esc(f.relativePath)}">\n${body}\n</project_file>`;
  });
  return {
    contextBlock: `Relevant project files (${mode !== 'none' ? (mode === 'deepseek' ? 'DeepSeek-ranked' : 'keyword-matched') : 'none'} from linked folder):\n\n${parts.join('\n\n')}`,
    sources: top.map(f => f.filename),
    mode,
  };
}

/** The text of one file to send: the start for ordinary files; for a long one, the start plus the stretch that mentions the question's keywords most. */
export function fileBody(text: string, keywords: readonly string[]): string {
  if (text.length <= LONG_FILE_CHARS) {
    return text.length > PROJECT_FOLDER_FILE_CHAR_LIMIT ? text.slice(0, PROJECT_FOLDER_FILE_CHAR_LIMIT).trimEnd() + '\n[truncated]' : text;
  }
  const kws = keywords.map(k => k.toLowerCase()).filter(Boolean);
  const lower = text.toLowerCase();
  let bestAt = -1;
  let bestScore = 0;
  for (let at = EXCERPT_HEAD; at + EXCERPT_WINDOW <= text.length; at += EXCERPT_STEP) {
    const win = lower.slice(at, at + EXCERPT_WINDOW);
    const score = kws.reduce((n, kw) => n + win.split(kw).length - 1, 0);
    if (score > bestScore) { bestScore = score; bestAt = at; }
  }
  const head = text.slice(0, EXCERPT_HEAD).trimEnd();
  if (bestAt < 0) return head + '\n[truncated: long document, no passage matched the question]';
  return `${head}\n[...]\n${text.slice(bestAt, bestAt + EXCERPT_WINDOW).trim()}\n[excerpt from character ${bestAt} of ${text.length}; the rest is not shown]`;
}

/** The label of the sources bar under a reply (app.js:2149). */
export function sourcesLabel(mode: string): { label: string; icon: 'brain' | 'files' } {
  return mode === 'deepseek' ? { label: 'Sources (DeepSeek):', icon: 'brain' } : { label: 'Sources (keywords):', icon: 'files' };
}

/** The linked folder of the project `threadId` belongs to, or '' when it has none. */
export function linkedFolderFor(threadId: string): string {
  const app = useAppStore.getState();
  const pid = app.threadState[threadId]?.projectId;
  return typeof pid === 'string' ? app.projects[pid]?.path ?? '' : '';
}

/** The folder context for a message in `threadId`, read from the stores (the linked path, the key and the global ranking default). */
export async function folderContextFor(threadId: string, query: string): Promise<FolderContext> {
  const app = useAppStore.getState();
  const thread = app.threadState[threadId];
  const pid = typeof thread?.projectId === 'string' ? thread.projectId : undefined;
  const path = linkedFolderFor(threadId);
  return buildProjectFolderContext(pid, query, (thread?.rankingMode as RankingMode | undefined) || 'inherit', {
    path, deepseekKey: readApiKeys().deepseek, globalMode: app.prefs.rankingLlm || 'none',
  });
}
