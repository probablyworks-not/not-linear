import {
  executeTool as legacyExecuteTool, toolResultFallbackMarkdown as legacyFallback, toolResultTitle as legacyTitle,
} from '../../../frontend/providers/tools.js';
import { appState as legacyState } from '../../../frontend/core/state.js';
import {
  clearToolCache, executeTool, isToolFatal, toolResultFallbackMarkdown, toolResultTitle, toolStatusLabel, windowText, ToolFatalError,
} from '../../src/tools/tool-runners';
import { setToolEnvForTests } from '../../src/tools/env';
import { clearRequestLog, requestLog } from '../../src/lib/request-log';

// The tool runners hit real services, so every call here is answered by a fake fetch. The
// differential half runs the SAME inputs through legacy's executeTool (cut from the real
// frontend/providers/tools.js) and demands the same text, or the same fatal error.

const SECRET = 'serper-TESTONLY-needle-123456';
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const text = (body: string, status = 200): Response => new Response(body, { status });
const LONG = Array.from({ length: 1500 }, (_, i) => `word${i}`).join(' '); // ~12k characters

type Router = (url: string, init?: RequestInit) => Response | Promise<Response>;
let router: Router = () => text('unrouted', 500);

const ROUTES: Router = (url, init) => {
  if (url.startsWith('https://en.wikipedia.org/w/api.php')) {
    return /srsearch=nothing/.test(url) ? json({ query: { search: [] } }) : json({ query: { search: [{ title: 'Tides' }, { title: 'Moon' }, { title: 'Sun' }] } });
  }
  if (url.startsWith('https://en.wikipedia.org/api/rest_v1/page/summary/')) {
    return json({ title: 'Tides', extract: 'Tides are the rise and fall of sea levels.', content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Tide' } } });
  }
  if (url.startsWith('https://r.jina.ai/')) {
    if (url.includes('down.example')) return text('nope', 500);
    return text(url.includes('long.example') ? LONG : 'A short page.');
  }
  if (url.startsWith('http://searx.local/search')) {
    return url.includes('q=empty') ? json({ results: [] }) : json({ results: Array.from({ length: 8 }, (_, i) => ({ title: `Hit ${i}`, url: `https://x/${i}`, content: `snippet ${i}` })) });
  }
  if (url.startsWith('https://google.serper.dev/search')) {
    const q = String(JSON.parse(String(init?.body)).q);
    if (q === 'unauthorized') return json({}, 401);
    if (q === 'limited') return json({}, 429);
    if (q === 'broken') return json({}, 500);
    if (q === 'empty') return json({ organic: [] });
    return json({ answerBox: { answer: 'forty-two' }, organic: Array.from({ length: 9 }, (_, i) => ({ title: `Result ${i}`, link: `https://s/${i}`, snippet: `snip ${i}` })) });
  }
  if (url.startsWith('https://api.firecrawl.dev/v1/scrape')) {
    const target = String(JSON.parse(String(init?.body)).url);
    if (target.includes('denied')) return json({}, 403);
    if (target.includes('blank')) return json({ data: { markdown: '' } });
    return json({ data: { markdown: target.includes('long') ? LONG + ' ' + LONG : '# Page\n\nBody.' } });
  }
  return text('unrouted ' + url, 500);
};

const KEYS = { serper: SECRET, firecrawl: 'fc-TESTONLY-key' };
function configure(keys: Record<string, string>, searxngUrl?: string): void {
  setToolEnvForTests(() => ({ apiKeys: keys, searxngUrl }));
  legacyState.apiKeys = { ...keys } as typeof legacyState.apiKeys;
  legacyState.prefs.searxngUrl = searxngUrl ?? '';
}

beforeEach(() => {
  clearToolCache();
  clearRequestLog();
  router = ROUTES;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => router(String(url), init)));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  configure(KEYS, 'http://searx.local');
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); setToolEnvForTests(null); });

const signal = (): AbortSignal => new AbortController().signal;
const run = (name: string, input: Record<string, unknown>) => executeTool(name, input as never, signal());

describe('each tool', () => {
  it('wikipedia_search: the top article, its source, and what else matched', async () => {
    expect(await run('wikipedia_search', { query: 'tides' })).toBe(
      '**Tides**\nTides are the rise and fall of sea levels.\nSource: https://en.wikipedia.org/wiki/Tide\n\nRelated articles: Moon, Sun',
    );
    expect(await run('wikipedia_search', { query: 'nothing' })).toBe('No Wikipedia results found for: nothing');
  });

  it('web_search (SearXNG): five results as a numbered list, or a plain miss', async () => {
    const out = await run('web_search', { query: 'tides' });
    expect(out.split('\n\n')).toHaveLength(5);
    expect(out.startsWith('1. **Hit 0**\nhttps://x/0\nsnippet 0')).toBe(true);
    expect(await run('web_search', { query: 'empty' })).toBe('No web results found for: empty');
  });

  it('serper_search: the answer box first, then six results', async () => {
    const out = await run('serper_search', { query: 'tides' });
    expect(out.startsWith('**Answer:** forty-two\n\n1. **Result 0**\nhttps://s/0\nsnip 0')).toBe(true);
    expect(out.match(/^\d\. \*\*/gm)).toHaveLength(6);
    expect(await run('serper_search', { query: 'empty' })).toBe('No results found for: empty');
  });

  it('fetch_url: a short page whole; a long one in a window that says how to read on, and jump to a term', async () => {
    expect(await run('fetch_url', { url: 'https://short.example' })).toBe('A short page.');
    const first = await run('fetch_url', { url: 'https://long.example' });
    expect(first).toMatch(/\[showing chars 0-4000 of \d+\. Call again with offset:4000 to continue, or query:"term" to jump to a match\.\]$/);
    const next = await run('fetch_url', { url: 'https://long.example', offset: 4000 });
    expect(next).toContain('[showing chars 4000-8000 of');
    const jump = await run('fetch_url', { url: 'https://long.example', query: 'WORD1000' });
    expect(jump).toContain('word1000');
    expect(jump).not.toContain('word0 ');
  });

  it('fetch_url reads a page ONCE however many windows are requested', async () => {
    await run('fetch_url', { url: 'https://long.example' });
    await run('fetch_url', { url: 'https://long.example', offset: 4000 });
    await run('fetch_url', { url: 'https://long.example', query: 'word900' });
    const jina = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(c => String(c[0]).startsWith('https://r.jina.ai/'));
    expect(jina).toHaveLength(1);
  });

  it('firecrawl_scrape: windows at 6000 characters, and says so when a page is empty', async () => {
    expect(await run('firecrawl_scrape', { url: 'https://ok.example' })).toBe('# Page\n\nBody.');
    expect(await run('firecrawl_scrape', { url: 'https://long.example/x' })).toContain('[showing chars 0-6000 of');
    expect(await run('firecrawl_scrape', { url: 'https://blank.example' })).toBe('Firecrawl returned no content for: https://blank.example');
  });

  it('an unknown tool is a result, not a crash', async () => {
    expect(await run('mystery', {})).toBe('Unknown tool: mystery');
  });
});

describe('failures', () => {
  it.each([
    ['serper_search', { query: 'unauthorized' }, 'Serper search key was rejected. Check the Serper key in Settings.'],
    ['serper_search', { query: 'limited' }, 'Serper search is rate limited. Wait a moment and try again.'],
    ['serper_search', { query: 'broken' }, 'Serper search failed with HTTP 500.'],
    ['firecrawl_scrape', { url: 'https://denied.example' }, 'Firecrawl key was rejected. Check it in Settings.'],
  ])('%s: a rejected or failing service is FATAL, with a message the user can act on', async (name, input, message) => {
    await expect(run(name, input)).rejects.toMatchObject({ message, isToolFatal: true });
  });

  it('a missing key is fatal and names where to add it', async () => {
    configure({}, undefined);
    await expect(run('serper_search', { query: 'x' })).rejects.toThrow('Serper API key not set. Add it in Settings, or configure SearXNG for web search.');
    await expect(run('firecrawl_scrape', { url: 'https://x' })).rejects.toThrow('Firecrawl API key not set.');
    await expect(run('web_search', { query: 'x' })).rejects.toThrow('Web search is not configured. Add a SearXNG URL in Settings, or add a Serper key.');
  });

  it('SearXNG unreachable or erroring is fatal', async () => {
    router = () => { throw new TypeError('Failed to fetch'); };
    await expect(run('web_search', { query: 'x' })).rejects.toThrow('Could not reach SearXNG.');
    router = () => text('x', 502);
    await expect(run('web_search', { query: 'x' })).rejects.toThrow('SearXNG returned 502. Check the URL in Settings.');
  });

  it('any OTHER failure is handed back to the model as text so it can react', async () => {
    router = () => { throw new TypeError('Failed to fetch'); };
    expect(await run('wikipedia_search', { query: 'x' })).toBe('Tool error (wikipedia_search): Failed to fetch');
    router = () => text('{not json', 200);
    expect(await run('wikipedia_search', { query: 'x' })).toMatch(/^Tool error \(wikipedia_search\): /);
  });

  it('an abort is rethrown, never turned into text', async () => {
    const ctrl = new AbortController();
    router = (_url, init) => new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    const pending = executeTool('wikipedia_search', { query: 'x' }, ctrl.signal);
    ctrl.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('isToolFatal tells them apart', () => {
    expect(isToolFatal(new ToolFatalError('x'))).toBe(true);
    expect(isToolFatal(new Error('x'))).toBe(false);
    expect(isToolFatal(null)).toBe(false);
  });
});

describe('keys', () => {
  it('are sent to the service and never written to the request log', async () => {
    await run('serper_search', { query: 'tides' });
    const fetchCall = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.find(c => String(c[0]).includes('serper'))!;
    expect((fetchCall[1] as RequestInit).headers).toMatchObject({ 'X-API-KEY': SECRET });
    expect(requestLog.length).toBeGreaterThan(0);
    expect(JSON.stringify(requestLog)).not.toContain(SECRET);
    await run('firecrawl_scrape', { url: 'https://ok.example' });
    expect(JSON.stringify(requestLog)).not.toContain('fc-TESTONLY-key');
  });
});

describe('windowText', () => {
  it('returns short text untouched, and clamps a runaway offset into the text', () => {
    expect(windowText('abc', {}, 10)).toBe('abc');
    expect(windowText('x'.repeat(50), { offset: 9999 }, 10)).toContain('[showing chars 49-50 of 50.]');
  });
});

describe('presentation', () => {
  it('titles and the stalled-model fallback read as legacy does', () => {
    const results = [{ name: 'wikipedia_search', input: { query: 'tides' }, content: 'Tides…' }, { name: 'fetch_url', input: { url: 'https://u' }, content: '' }];
    expect(toolResultFallbackMarkdown(results)).toBe(legacyFallback(results));
    expect(toolResultFallbackMarkdown([])).toBe('');
    for (const n of ['wikipedia_search', 'serper_search', 'web_search', 'firecrawl_scrape', 'fetch_url', 'other']) {
      expect(toolResultTitle(n, { query: 'q', url: 'u' })).toBe(legacyTitle(n, { query: 'q', url: 'u' }));
      expect(toolResultTitle(n)).toBe(legacyTitle(n));
    }
    expect(toolResultFallbackMarkdown([{ name: 'fetch_url', input: {}, content: 'y'.repeat(6000) }])).toContain('[results truncated]');
  });

  it('status lines name what is being done', () => {
    expect(toolStatusLabel('wikipedia_search', { query: 'tides' })).toBe('Searching Wikipedia for "tides"…');
    expect(toolStatusLabel('serper_search', { query: 'tides' })).toBe('Searching Google for "tides"…');
    expect(toolStatusLabel('web_search', { query: 'tides' })).toBe('Searching for "tides"…');
    expect(toolStatusLabel('firecrawl_scrape', { url: 'https://u' })).toBe('Scraping https://u…');
    expect(toolStatusLabel('fetch_url', { url: 'https://u' })).toBe('Reading https://u…');
  });
});

describe('differential: the same inputs through legacy executeTool', () => {
  const scenarios: Array<[string, Record<string, unknown>]> = [
    ['wikipedia_search', { query: 'tides' }], ['wikipedia_search', { query: 'nothing' }],
    ['web_search', { query: 'tides' }], ['web_search', { query: 'empty' }],
    ['serper_search', { query: 'tides' }], ['serper_search', { query: 'empty' }],
    ['fetch_url', { url: 'https://short.example' }], ['fetch_url', { url: 'https://long.example', offset: 4000 }],
    ['fetch_url', { url: 'https://long2.example', query: 'word700' }], ['fetch_url', { url: 'https://down.example' }],
    ['firecrawl_scrape', { url: 'https://ok.example' }], ['firecrawl_scrape', { url: 'https://long.example/x', offset: 6000 }],
    ['firecrawl_scrape', { url: 'https://blank.example' }], ['mystery', {}],
  ];
  it.each(scenarios)('%s %j', async (name, input) => {
    const [mine, legacy] = await Promise.all([run(name, input), legacyExecuteTool(name, input, signal())]);
    expect(mine).toBe(legacy);
  });

  const fatal: Array<[string, Record<string, unknown>]> = [
    ['serper_search', { query: 'unauthorized' }], ['serper_search', { query: 'limited' }], ['serper_search', { query: 'broken' }],
    ['firecrawl_scrape', { url: 'https://denied.example' }],
  ];
  it.each(fatal)('fatal: %s %j', async (name, input) => {
    const get = async (fn: () => Promise<unknown>): Promise<string> => { try { await fn(); return 'no error'; } catch (e) { return `${(e as Error).name}: ${(e as Error).message}`; } };
    expect(await get(() => run(name, input))).toBe(await get(() => legacyExecuteTool(name, input, signal())));
  });

  it('with nothing configured, the fatal messages match too', async () => {
    configure({}, undefined);
    const get = async (fn: () => Promise<unknown>): Promise<string> => { try { await fn(); return 'no error'; } catch (e) { return (e as Error).message; } };
    for (const [name, input] of [['serper_search', { query: 'x' }], ['firecrawl_scrape', { url: 'https://x' }], ['web_search', { query: 'x' }]] as const) {
      expect(await get(() => run(name, input))).toBe(await get(() => legacyExecuteTool(name, input, signal())));
    }
  });
});
