import { legacyFns, APP_JS } from '../helpers/legacy-source';
import { fileBody, LONG_FILE_CHARS, buildProjectFolderContext, clearProjectContextCaches, extractKeywords, sourcesLabel, type FolderEnv } from '../../src/chat/project-context';
import { aiTurnHTML } from '../../src/chat/stream-html';

// A project's linked folder feeds the model relevant files. The pipeline (keywords, filtering,
// optional DeepSeek ranking, truncation, labels) is compared with the real legacy functions, with
// the folder scan and DeepSeek answered identically for both.

const stopWords = /const KEYWORD_STOP_WORDS = new Set\(\[[\s\S]*?\]\);/.exec(APP_JS)![0];
const prelude = [
  'const PROJECT_SCAN_CACHE_TTL_MS = 5 * 60 * 1000; const projectScanCache = new Map();',
  stopWords,
  'const projectKeywordCache = new Map(); const projectRankingCache = new Map();',
  'const KEYWORD_CACHE_TTL_MS = 30 * 60 * 1000; const RANKING_CACHE_TTL_MS = 10 * 60 * 1000; const RANKING_TIMEOUT_MS = 5000;',
  'const PROJECT_FOLDER_FILE_CHAR_LIMIT = 3000; const PROJECT_FOLDER_MAX_FILES = 10;',
].join('\n');

type Legacy = { buildProjectFolderContext(pid: string, q: string, mode?: string): Promise<unknown>; extractKeywords(t: string): string[] };
function makeLegacy(projects: Record<string, { path: string }>, prefs: { rankingLlm?: string }, apiKeys: Record<string, string>): Legacy {
  return legacyFns<Legacy>(
    ['fetchProjectScan', 'extractKeywords', 'generateSearchKeywords', 'rankFilesWithDeepSeek', 'buildProjectFolderContext'],
    { projects, prefs, appState: { apiKeys }, esc: (s: unknown) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]!) },
    prelude, '{ buildProjectFolderContext, extractKeywords }',
  );
}

const file = (name: string, text: string, extra: object = {}) => ({ present: true, text, relativePath: `docs/${name}`, filename: name, ...extra });
const FILES = [
  file('auth.md', 'Authentication with JWT tokens and session handling for the login flow.'),
  file('billing.md', 'Invoices, subscriptions and payment retries.'),
  file('setup.md', 'How to install dependencies and run the dev server. '.repeat(100)),
  file('notes<1>.md', 'login notes & "quotes"'),
  { present: false, text: 'ignored', relativePath: 'docs/gone.md', filename: 'gone.md' },
  { present: true, text: '', relativePath: 'docs/empty.md', filename: 'empty.md' },
];

let scanBody: unknown = { ok: true, contextFiles: FILES };
let deepseekReplies: string[] = [];
let deepseekCalls = 0;

beforeEach(() => {
  clearProjectContextCaches();
  scanBody = { ok: true, contextFiles: FILES };
  deepseekReplies = [];
  deepseekCalls = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('__notlinear_scan_project')) {
      return scanBody === 'fail' ? new Response('x', { status: 500 }) : new Response(JSON.stringify(scanBody), { status: 200 });
    }
    deepseekCalls += 1;
    const next = deepseekReplies.shift();
    if (next === undefined) return new Response('{}', { status: 500 });
    return new Response(JSON.stringify({ choices: [{ message: { content: next } }] }), { status: 200 });
  }));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'debug').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('extractKeywords', () => {
  const legacy = makeLegacy({}, {}, {});
  it.each(['How does authentication with JWT work?', 'tell me more about the login flow please', 'a an the of', '', 'x'.repeat(5), 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty twentyone'])(
    '%j', t => expect(extractKeywords(t)).toEqual(legacy.extractKeywords(t)));
});

describe('buildProjectFolderContext matches legacy', () => {
  async function both(opts: { pid: string; path?: string; query: string; mode?: string; globalMode?: string; key?: string; replies?: string[] }) {
    const env: FolderEnv = { path: opts.path ?? '/some/folder', deepseekKey: opts.key, globalMode: opts.globalMode ?? '' };
    const legacy = makeLegacy({ [opts.pid]: { path: opts.path ?? '/some/folder' } }, { rankingLlm: opts.globalMode ?? '' }, opts.key ? { deepseek: opts.key } : {});
    deepseekReplies = [...(opts.replies ?? [])];
    const mine = await buildProjectFolderContext(opts.pid, opts.query, opts.mode, env);
    deepseekReplies = [...(opts.replies ?? [])];
    const theirs = await legacy.buildProjectFolderContext(opts.pid, opts.query, opts.mode);
    return { mine, theirs };
  }

  it('no linked folder, or a scan that fails: nothing, mode none', async () => {
    const a = await both({ pid: 'a', path: '', query: 'login' });
    expect(a.mine).toEqual(a.theirs);
    expect(a.mine).toEqual({ contextBlock: '', sources: [], mode: 'none' });
    scanBody = 'fail';
    const b = await both({ pid: 'b', query: 'login' });
    expect(b.mine).toEqual(b.theirs);
    scanBody = { ok: false };
    const c = await both({ pid: 'c', query: 'login' });
    expect(c.mine).toEqual(c.theirs);
  });

  it('keywords only (the default): matching files, best first, with the label', async () => {
    const r = await both({ pid: 'k', query: 'how does the login flow with jwt work?' });
    expect(r.mine).toEqual(r.theirs);
    const m = r.mine as { contextBlock: string; sources: string[]; mode: string };
    expect(m.sources[0]).toBe('auth.md');
    expect(m.contextBlock.startsWith('Relevant project files (none from linked folder):')).toBe(true);
    expect(m.contextBlock).toContain('<project_file path="docs/auth.md">');
    expect(m.contextBlock).toContain('notes&lt;1&gt;.md'); // paths are escaped
    expect(m.contextBlock).not.toContain('gone.md');
  });

  it.each(['none', 'keywords', 'inherit'])('mode %s, and a global default, resolve the same way', async mode => {
    for (const globalMode of ['', 'none', 'keywords']) {
      const r = await both({ pid: `m-${mode}-${globalMode}`, query: 'invoices payment', mode, globalMode });
      expect(r.mine).toEqual(r.theirs);
    }
  });

  it('a long file is cut at the per-file limit and says so; at most ten files are used', async () => {
    scanBody = { ok: true, contextFiles: Array.from({ length: 14 }, (_, i) => file(`f${i}.md`, `topic ${'word '.repeat(2000)}`)) };
    const r = await both({ pid: 'long', query: 'topic word' });
    expect(r.mine).toEqual(r.theirs);
    const m = r.mine as { contextBlock: string; sources: string[] };
    expect(m.sources).toHaveLength(10);
    expect(m.contextBlock).toContain('[truncated]');
  });

  it('no keyword matches falls back to the first files', async () => {
    const r = await both({ pid: 'nomatch', query: 'zzzzqqq yyyy' });
    expect(r.mine).toEqual(r.theirs);
    expect((r.mine as { sources: string[] }).sources.length).toBeGreaterThan(0);
  });

  it('DeepSeek mode: model-chosen keywords and a model ranking decide the order and the label', async () => {
    const r = await both({
      pid: 'ds', query: 'payments', mode: 'deepseek', key: 'sk-ds-TESTONLY',
      replies: ['["invoices","subscriptions","payment"]', '[1,0]'],
    });
    expect(r.mine).toEqual(r.theirs);
    const m = r.mine as { contextBlock: string; sources: string[]; mode: string };
    expect(m.sources.length).toBeGreaterThan(0);
    expect(m.contextBlock.startsWith('Relevant project files (DeepSeek-ranked from linked folder):')).toBe(true);
    expect(m.mode).toBe('deepseek');
  });

  it.each([
    ['unparseable keywords', ['not json at all', '[0]']],
    ['empty keyword list', ['[]', '[0]']],
    ['unparseable ranking', ['["login"]', 'nope']],
    ['empty ranking', ['["login"]', '[]']],
    ['an out-of-range ranking index', ['["login"]', '[99,0]']],
    ['the model failing', []],
  ])('DeepSeek mode degrades gracefully: %s', async (_n, replies) => {
    const r = await both({ pid: `deg-${_n}`, query: 'login flow', mode: 'deepseek', key: 'sk-ds-TESTONLY', replies });
    expect(r.mine).toEqual(r.theirs);
  });

  it('DeepSeek mode without a key is just keywords', async () => {
    const r = await both({ pid: 'nokey', query: 'login flow', mode: 'deepseek' });
    expect(r.mine).toEqual(r.theirs);
    expect(deepseekCalls).toBe(0);
  });

  it('asks DeepSeek once for the same question (the answers are cached)', async () => {
    deepseekReplies = ['["login"]', '[0]', 'unused', 'unused'];
    const env: FolderEnv = { path: '/f', deepseekKey: 'k', globalMode: '' };
    await buildProjectFolderContext('cache', 'login flow', 'deepseek', env);
    const calls = deepseekCalls;
    await buildProjectFolderContext('cache', 'login flow', 'deepseek', env);
    expect(deepseekCalls).toBe(calls);
  });
});

describe('the sources bar', () => {
  it('names the files, with the label for how they were chosen, in the saved reply', () => {
    expect(sourcesLabel('deepseek')).toEqual({ label: 'Sources (DeepSeek):', icon: 'brain' });
    expect(sourcesLabel('keywords')).toEqual({ label: 'Sources (keywords):', icon: 'files' });
    expect(sourcesLabel('none')).toEqual({ label: 'Sources (keywords):', icon: 'files' });
    const html = aiTurnHTML('t', { text: 'x', thinking: '', sources: { names: ['a.md', 'b<1>.md'], ...sourcesLabel('deepseek') } });
    expect(html).toContain('<div class="msg-sources"><i class="ti ti-brain"></i><span class="msg-sources-label">Sources (DeepSeek):</span><span class="msg-source-chip">a.md</span><span class="msg-source-chip">b&lt;1&gt;.md</span></div>');
    expect(aiTurnHTML('t', { text: 'x', thinking: '', sources: { names: [], label: '', icon: 'files' } })).not.toContain('msg-sources');
  });
});

describe('long files (a departure from legacy: the passage that matches, not only the start)', () => {
  const book = (needleAt: number) => 'filler words here. '.repeat(Math.ceil(LONG_FILE_CHARS * 2 / 19)).slice(0, needleAt) + ' Chapter One begins with the dopamine story. ' + 'more filler. '.repeat(3000);
  it('files up to the limit are sent exactly as legacy sends them', () => {
    expect(fileBody('short', ['x'])).toBe('short');
    const t = 'a'.repeat(LONG_FILE_CHARS);
    expect(fileBody(t, ['a'])).toBe('a'.repeat(3000) + '\n[truncated]');
  });
  it('a long file sends its start and the stretch that mentions the keywords', () => {
    const body = fileBody(book(40_000), ['dopamine']);
    expect(body).toContain('filler words here.');
    expect(body).toContain('Chapter One begins with the dopamine story.');
    expect(body.length).toBeLessThan(4200);
    expect(body).toContain('the rest is not shown');
  });
  it('with no matching passage it sends the start and says so', () => {
    const body = fileBody(book(40_000), ['zzzqqq']);
    expect(body).toContain('no passage matched');
    expect(body.length).toBeLessThan(1200);
  });
});
