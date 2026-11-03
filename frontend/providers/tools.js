// Shared tool infrastructure — tool runners, executeTool, and model label helper.
// Imported by all provider modules (claude.js, deepseek.js, openai.js). No DOM dependencies.
//
// This is the model-facing "tools" implementation referenced in AGENTS.md and the
// skills/tool-runners/SKILL.md area: each `run*` function below hits one external service
// (Wikipedia, a configurable SearXNG instance, Serper, Firecrawl, or Jina's reader proxy for
// generic URL fetches) and returns a plain string/markdown blob that gets wrapped in a
// `tool_result` (Claude) or `role:'tool'` (DeepSeek/OpenAI-compatible) message and fed back to
// the model. executeTool() is the single dispatch point every provider calls with the tool name
// + parsed input the model requested; it standardizes error handling (ToolFatalError aborts the
// whole turn with a user-facing message; any other failure is swallowed into a
// "Tool error (...)" string result so the model can see and react to the failure itself).
//
// Provider call sites (claude.js/deepseek.js/openai.js) parse the model's raw tool-call JSON
// arguments themselves before calling executeTool — this file only executes already-parsed
// { query } / { url } style input objects.
import { appState } from '../core/state.js';
import {
  loggedFetch, readResponseBody, readLoggedErrorPayload,
  safeJsonForLog, beginBackendTrace, endBackendTrace,
  SEARCH_TIMEOUT_MS, PAGE_READ_TIMEOUT_MS, SCRAPE_TIMEOUT_MS,
} from '../core/api-client.js';

// ---------- ToolFatalError ----------
// Marks a tool failure as unrecoverable for the current turn (e.g. missing/rejected API key,
// unreachable configured endpoint) — as opposed to an ordinary tool error, which is turned into a
// string result and fed back to the model so it can react. Callers (executeTool below, and each
// provider's tool-execution loop) check `e.isToolFatal` to decide whether to abort the whole turn
// via onError instead of continuing.
export class ToolFatalError extends Error {
  constructor(message){
    super(message);
    this.name = 'ToolFatalError';
    this.isToolFatal = true;
  }
}

// ---------- tool runners ----------
// Each runner below implements one model-callable tool: it hits one external service and returns
// a plain string (markdown-ish, meant to be read by the model as a tool_result/role:'tool'
// message) — never a raw object. None of these are called directly by providers; they're all
// reached through executeTool()'s name dispatch.

// Tool: wikipedia_search — hits Wikipedia's public search API to find the best-matching article
// title, then fetches that article's summary from Wikipedia's REST summary endpoint.
// Returns a markdown string: the article title + extract, a source link, and (if there were
// other matches) a "Related articles" list — or a plain "No Wikipedia results found" string.
export async function runWikipediaSearch(query, signal){
  const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*&srlimit=3`;
  const searchRes = await loggedFetch(searchUrl, { signal }, { provider:'wikipedia', label:'search', timeoutMs:SEARCH_TIMEOUT_MS });
  const searchData = await readResponseBody(searchRes, { kind:'json', signal, provider:'wikipedia', label:'search', timeoutMs:SEARCH_TIMEOUT_MS });
  const results = searchData.query?.search || [];
  if (!results.length) return 'No Wikipedia results found for: ' + query;
  const title = results[0].title;
  const summaryRes = await loggedFetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, { signal }, { provider:'wikipedia', label:'summary', timeoutMs:SEARCH_TIMEOUT_MS });
  const summary = await readResponseBody(summaryRes, { kind:'json', signal, provider:'wikipedia', label:'summary', timeoutMs:SEARCH_TIMEOUT_MS });
  let out = `**${summary.title}**\n${summary.extract || 'No summary available.'}`;
  if (summary.content_urls?.desktop?.page) out += `\nSource: ${summary.content_urls.desktop.page}`;
  if (results.length > 1) out += `\n\nRelated articles: ${results.slice(1).map(r => r.title).join(', ')}`;
  return out;
}

// Shared cache of full, un-windowed page text keyed by URL, used by fetch_url and
// firecrawl_scrape so that paging through a long page (offset/query, see windowText below) or
// re-reading the same URL later in the conversation reuses one network fetch instead of hitting
// Jina/Firecrawl again per page. Scoped to this module's lifetime (i.e. the page session), same
// as the cache this replaces in claude.js. Keyed by `${tool}:${url}` since fetch_url and
// firecrawl_scrape hit different services and can return different content for the same URL.
const _rawTextCache = new Map();

async function fetchRawTextCached(cacheKey, fetcher){
  const cached = _rawTextCache.get(cacheKey);
  if (cached) return cached;
  const text = await fetcher();
  _rawTextCache.set(cacheKey, text);
  return text;
}

// Slices a full text blob into a bounded window for the model, instead of always returning just
// the head of the document — this is what lets a long page be read in full across multiple tool
// calls rather than silently losing everything past the cap. If `query` is given, the window is
// centered on the first case-insensitive match (so the model can jump straight to the relevant
// part instead of paging from the top); otherwise it starts at `offset` (default 0). Always notes
// the range shown and the total length so the model knows how to continue reading.
function windowText(text, { query, offset } = {}, maxChars){
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

// Tool: fetch_url — reads an arbitrary web page's content by proxying it through Jina AI's
// "reader" service (r.jina.ai), which converts the page to clean plain text. This is the tool
// used to actually read a URL the model was given or found via search (as opposed to the search
// tools below, which only return snippets/links).
// Returns a windowed slice of the page text (see windowText above) — up to 4000 chars starting at
// `offset` or centered on `query` if given, with a note on how to read further if the page is
// longer than that.
export async function runFetchUrl(url, signal, { query, offset } = {}){
  const text = await fetchRawTextCached(`fetch_url:${url}`, async () => {
    const res = await loggedFetch(`https://r.jina.ai/${url}`, { signal, headers:{ 'Accept':'text/plain' } }, { provider:'jina', label:'fetch_url', timeoutMs:PAGE_READ_TIMEOUT_MS });
    return readResponseBody(res, { kind:'text', signal, provider:'jina', label:'fetch_url', timeoutMs:PAGE_READ_TIMEOUT_MS });
  });
  return windowText(text, { query, offset }, 4000);
}

// Tool: web_search — general web search via a user-configured, self-hosted SearXNG instance
// (URL set in Settings). This is the no-API-key search option; see runSerperSearch below for the
// hosted/paid alternative. Throws ToolFatalError (aborting the turn) if no SearXNG URL is
// configured, if the instance is unreachable, or if it returns a non-OK response — since none of
// those are something retrying the tool call itself can fix.
// Returns up to 5 results as a numbered markdown list (title, url, snippet), or a plain
// "No web results found" string.
export async function runWebSearch(query, signal){
  const base = appState.prefs.searxngUrl?.replace(/\/$/, '');
  if (!base) throw new ToolFatalError('Web search is not configured. Add a SearXNG URL in Settings, or add a Serper key.');
  const url = `${base}/search?q=${encodeURIComponent(query)}&format=json&categories=general`;
  let res;
  try {
    res = await loggedFetch(url, { signal }, { provider:'searxng', label:'web_search', timeoutMs:SEARCH_TIMEOUT_MS });
  } catch(e){
    if (e.name === 'AbortError') throw e;
    throw new ToolFatalError('Could not reach SearXNG. Check the URL in Settings and make sure CORS is enabled.');
  }
  if (!res.ok){
    await readLoggedErrorPayload(res, { provider:'searxng', label:'web_search', timeoutMs:SEARCH_TIMEOUT_MS });
    throw new ToolFatalError(`SearXNG returned ${res.status}. Check the URL in Settings.`);
  }
  const data = await readResponseBody(res, { kind:'json', signal, provider:'searxng', label:'web_search', timeoutMs:SEARCH_TIMEOUT_MS });
  const results = (data.results || []).slice(0, 5);
  if (!results.length) return `No web results found for: ${query}`;
  return results.map((r, i) =>
    `${i+1}. **${r.title}**\n${r.url}\n${r.content || ''}`.trim()
  ).join('\n\n');
}

// Tool: serper_search — general web/Google search via the Serper.dev API (a hosted Google
// Search results API), used when the user has a Serper key configured. This is the hosted/paid
// alternative to runWebSearch's self-hosted SearXNG path. Throws ToolFatalError (aborting the
// turn) when the key is missing, rejected (401/403), rate-limited (429), unreachable, or the
// request otherwise fails — none of which the model can work around by retrying.
// Returns up to 6 organic results as a numbered markdown list (title, link, snippet), with an
// optional "**Answer:**" line prepended if Serper returned a direct answer box, or a plain
// "No results found" string.
export async function runSerperSearch(query, signal){
  const key = appState.apiKeys.serper;
  if (!key) throw new ToolFatalError('Serper API key not set. Add it in Settings, or configure SearXNG for web search.');
  let res;
  try {
    res = await loggedFetch('https://google.serper.dev/search', {
      method: 'POST',
      signal,
      // Auth header construction — X-API-KEY carries the raw Serper key. Never log this headers
      // object or the `key` variable.
      headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, num: 6 }),
    }, { provider:'serper', label:'search', timeoutMs:SEARCH_TIMEOUT_MS });
  } catch(e){
    if (e.name === 'AbortError') throw e;
    throw new ToolFatalError('Could not reach Serper search. Check your connection, or use a SearXNG URL in Settings.');
  }
  if (!res.ok){
    await readLoggedErrorPayload(res, { provider:'serper', label:'search', timeoutMs:SEARCH_TIMEOUT_MS });
    if (res.status === 401 || res.status === 403) throw new ToolFatalError('Serper search key was rejected. Check the Serper key in Settings.');
    if (res.status === 429) throw new ToolFatalError('Serper search is rate limited. Wait a moment and try again.');
    throw new ToolFatalError(`Serper search failed with HTTP ${res.status}.`);
  }
  const data = await readResponseBody(res, { kind:'json', signal, provider:'serper', label:'search', timeoutMs:SEARCH_TIMEOUT_MS });
  const organic = (data.organic || []).slice(0, 6);
  if (!organic.length) return `No results found for: ${query}`;
  let out = '';
  if (data.answerBox?.answer) out += `**Answer:** ${data.answerBox.answer}\n\n`;
  out += organic.map((r, i) =>
    `${i+1}. **${r.title}**\n${r.link}\n${r.snippet || ''}`.trim()
  ).join('\n\n');
  return out;
}

// Tool: tavily_search — general web search via the Tavily API, purpose-built for LLM/agent
// consumption: Tavily does its own fetch+clean+extract per result server-side, so what comes back
// is denser (less nav/ad boilerplate) than a raw SERP snippet, and it can return a synthesized
// "answer" for straightforward factual queries. Used by the smart_search router (see below) for
// the "research/explain/compare" query bucket. Throws ToolFatalError on a missing/rejected key,
// rate limit, or unreachable service — none of which the model can fix by retrying.
// Returns an optional "**Answer:**" line (Tavily's synthesized answer, when include_answer finds
// one) followed by up to 6 results as a numbered markdown list (title, url, content), or a plain
// "No results found" string.
export async function runTavilySearch(query, signal){
  const key = appState.apiKeys.tavily;
  if (!key) throw new ToolFatalError('Tavily API key not set. Add it in Settings.');
  let res;
  try {
    res = await loggedFetch('https://api.tavily.com/search', {
      method: 'POST',
      signal,
      // Auth header construction — Bearer token carries the raw Tavily key. Never log this
      // headers object or the `key` variable.
      headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, max_results: 6, include_answer: true }),
    }, { provider:'tavily', label:'search', timeoutMs:SEARCH_TIMEOUT_MS });
  } catch(e){
    if (e.name === 'AbortError') throw e;
    throw new ToolFatalError('Could not reach Tavily search. Check your connection or the Tavily key in Settings.');
  }
  if (!res.ok){
    await readLoggedErrorPayload(res, { provider:'tavily', label:'search', timeoutMs:SEARCH_TIMEOUT_MS });
    if (res.status === 401 || res.status === 403) throw new ToolFatalError('Tavily search key was rejected. Check the Tavily key in Settings.');
    if (res.status === 429) throw new ToolFatalError('Tavily search is rate limited or out of credits. Wait a moment and try again.');
    throw new ToolFatalError(`Tavily search failed with HTTP ${res.status}.`);
  }
  const data = await readResponseBody(res, { kind:'json', signal, provider:'tavily', label:'search', timeoutMs:SEARCH_TIMEOUT_MS });
  const results = (data.results || []).slice(0, 6);
  if (!results.length && !data.answer) return `No results found for: ${query}`;
  let out = '';
  if (data.answer) out += `**Answer:** ${data.answer}\n\n`;
  out += results.map((r, i) =>
    `${i+1}. **${r.title}**\n${r.url}\n${(r.content || '').slice(0, 500)}`.trim()
  ).join('\n\n');
  return out;
}

// Tool: exa_search — semantic/neural web search via the Exa API. Unlike Serper/Tavily (keyword
// and SERP-based), Exa embeds the query and indexed page content into the same vector space and
// ranks by meaning rather than keyword overlap — so it's the right tool for conceptual, "find me
// things like X" queries where the right page may share no vocabulary with the query. Used by the
// smart_search router for the "semantic/conceptual" query bucket. `useAutoprompt` lets Exa rewrite
// the query for its own index when helpful. Throws ToolFatalError on a missing/rejected key, rate
// limit, or unreachable service.
// Returns up to 6 results as a numbered markdown list (title, url, highlighted excerpt if Exa
// returned one, else a text snippet), or a plain "No results found" string.
export async function runExaSearch(query, signal){
  const key = appState.apiKeys.exa;
  if (!key) throw new ToolFatalError('Exa API key not set. Add it in Settings.');
  let res;
  try {
    res = await loggedFetch('https://api.exa.ai/search', {
      method: 'POST',
      signal,
      // Auth header construction — x-api-key carries the raw Exa key. Never log this headers
      // object or the `key` variable.
      headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, numResults: 6, useAutoprompt: true, contents: { text: { maxCharacters: 500 }, highlights: true } }),
    }, { provider:'exa', label:'search', timeoutMs:SEARCH_TIMEOUT_MS });
  } catch(e){
    if (e.name === 'AbortError') throw e;
    throw new ToolFatalError('Could not reach Exa search. Check your connection or the Exa key in Settings.');
  }
  if (!res.ok){
    await readLoggedErrorPayload(res, { provider:'exa', label:'search', timeoutMs:SEARCH_TIMEOUT_MS });
    if (res.status === 401 || res.status === 403) throw new ToolFatalError('Exa search key was rejected. Check the Exa key in Settings.');
    if (res.status === 429) throw new ToolFatalError('Exa search is rate limited or out of credits. Wait a moment and try again.');
    throw new ToolFatalError(`Exa search failed with HTTP ${res.status}.`);
  }
  const data = await readResponseBody(res, { kind:'json', signal, provider:'exa', label:'search', timeoutMs:SEARCH_TIMEOUT_MS });
  const results = (data.results || []).slice(0, 6);
  if (!results.length) return `No results found for: ${query}`;
  return results.map((r, i) => {
    const snippet = (r.highlights && r.highlights[0]) || (r.text || '').slice(0, 500);
    return `${i+1}. **${r.title || r.url}**\n${r.url}\n${snippet}`.trim();
  }).join('\n\n');
}

// ---------- smart_search router ----------
// Single model-facing search tool that replaces exposing serper_search/tavily_search/exa_search
// separately (see buildTools/buildDeepSeekTools in app.js). Instead of letting the model pick a
// search provider — which costs nothing in latency per se, but adds decision noise and makes
// provider choice non-deterministic/unmeasurable — classifyQuery() below is a cheap, deterministic
// (no LLM call, no network call) rule-based classifier that picks a provider synchronously, then
// runSmartSearch runs exactly one provider call (keeping latency/cost equal to a single search
// call) with one fallback-to-Serper retry if the chosen provider comes back empty or its key is
// missing. This is the "alpha" case-by-case breakdown from the product discussion:
//   - freshness-sensitive (news/prices/"latest"/a year/"current") -> Serper (Google's index +
//     ranking is freshest, and these queries are usually keyword-matchable anyway)
//   - a URL is present in the query ("pages similar to this") -> Exa (its only have no analog
//     elsewhere: finding pages similar to a given one)
//   - semantic/conceptual (long, descriptive, low keyword-specificity, "similar to"/"like"/
///    "approaches that") -> Exa (neural/embedding search beats keyword matching here)
//   - research/explain/compare/define, not time-sensitive -> Tavily (built for LLM consumption:
//     pre-cleaned content + answer synthesis, so less of the agent's own synthesis work)
//   - anything else -> Serper (broadest raw coverage, cheapest default)
// Exported separately from runSmartSearch so app.js/tests can inspect routing decisions without
// re-running the network call.
const FRESHNESS_RE = /\b(latest|today|current(ly)?|right now|this (week|month|year)|breaking|news|price|stock|score|live|202[4-9]|release(d)?)\b/i;
const URL_RE = /https?:\/\/\S+/i;
const RESEARCH_RE = /^(what|how|why|who|when|where|which|explain|compare|define|is|are|does|do|can)\b/i;
const SIMILARITY_RE = /\b(similar to|like |alternatives? to|comparable to|approaches? (that|to)|companies? (that|like)|papers? (that|on)|tools? (that|like))\b/i;

export function classifyQuery(query){
  const q = String(query || '').trim();
  const wordCount = q.split(/\s+/).filter(Boolean).length;

  if (URL_RE.test(q)) return { provider:'exa', bucket:'url-similarity' };
  if (FRESHNESS_RE.test(q)) return { provider:'serper', bucket:'freshness' };
  if (SIMILARITY_RE.test(q) || (wordCount >= 13 && !RESEARCH_RE.test(q))) {
    return { provider:'exa', bucket:'semantic' };
  }
  if (RESEARCH_RE.test(q)) return { provider:'tavily', bucket:'research' };
  return { provider:'serper', bucket:'default' };
}

// Ordered fallback chain per provider, tried in order until one has a configured key — so e.g. a
// query routed to Exa with no Exa key set still searches instead of failing outright, as long as
// *some* search provider is configured.
const FALLBACK_ORDER = {
  serper: ['serper', 'tavily', 'exa'],
  tavily: ['tavily', 'serper', 'exa'],
  exa:    ['exa', 'serper', 'tavily'],
};
const RUNNERS = { serper: null, tavily: null, exa: null }; // filled in below, after the runners are defined (avoids forward-reference issues with const)

export async function runSmartSearch(query, signal){
  RUNNERS.serper = runSerperSearch;
  RUNNERS.tavily = runTavilySearch;
  RUNNERS.exa = runExaSearch;

  const { provider, bucket } = classifyQuery(query);
  const chain = (FALLBACK_ORDER[provider] || ['serper', 'tavily', 'exa']).filter(p => appState.apiKeys[p]);
  if (!chain.length) {
    throw new ToolFatalError('No search provider configured. Add a Serper, Tavily, or Exa API key in Settings.');
  }

  let lastErr;
  for (let i = 0; i < chain.length; i++){
    const p = chain[i];
    try {
      const result = await RUNNERS[p](query, signal);
      const usedFallback = p !== provider;
      const tag = usedFallback ? ` *(routed to ${p}, ${provider} unavailable)*` : '';
      // Empty-looking result from the chosen provider — try the next one in the chain instead of
      // returning "No results found" when another configured provider might do better.
      if (/^no results found for:/i.test(result) && i < chain.length - 1) { lastErr = result; continue; }
      return bucket && p === provider ? result : result + tag;
    } catch(e){
      if (e.name === 'AbortError') throw e;
      lastErr = e;
      if (i < chain.length - 1) continue;
      throw e;
    }
  }
  return lastErr || `No results found for: ${query}`;
}

// Tool: firecrawl_scrape — scrapes a URL via the Firecrawl API, which renders JS-heavy pages
// (unlike Jina's simpler reader used by fetch_url) and returns clean markdown. Prefer this when
// fetch_url's plain-text extraction isn't sufficient for a JS-rendered page. Throws
// ToolFatalError (aborting the turn) on a missing/rejected key, rate limit, or unreachable
// service.
// Returns a windowed slice of the scraped markdown (see windowText above) — up to 6000 chars
// starting at `offset` or centered on `query` if given, with a note on how to read further if the
// page is longer than that — or a "Firecrawl returned no content" string.
export async function runFirecrawlScrape(url, signal, { query, offset } = {}){
  const key = appState.apiKeys.firecrawl;
  if (!key) throw new ToolFatalError('Firecrawl API key not set. Add it in Settings, or retry without Firecrawl scraping.');
  const md = await fetchRawTextCached(`firecrawl_scrape:${url}`, async () => {
    let res;
    try {
      res = await loggedFetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        signal,
        // Auth header construction — Bearer token carries the raw Firecrawl key. Never log this
        // headers object or the `key` variable.
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, formats: ['markdown'] }),
      }, { provider:'firecrawl', label:'scrape', timeoutMs:SCRAPE_TIMEOUT_MS });
    } catch(e){
      if (e.name === 'AbortError') throw e;
      throw new ToolFatalError('Could not reach Firecrawl. Check your connection and Firecrawl key in Settings.');
    }
    if (!res.ok){
      await readLoggedErrorPayload(res, { provider:'firecrawl', label:'scrape', timeoutMs:SCRAPE_TIMEOUT_MS });
      if (res.status === 401 || res.status === 403) throw new ToolFatalError('Firecrawl key was rejected. Check it in Settings.');
      if (res.status === 429) throw new ToolFatalError('Firecrawl is rate limited. Wait a moment and try again.');
      throw new ToolFatalError(`Firecrawl failed with HTTP ${res.status}.`);
    }
    const data = await readResponseBody(res, { kind:'json', signal, provider:'firecrawl', label:'scrape', timeoutMs:SCRAPE_TIMEOUT_MS });
    return data.data?.markdown || data.markdown || '';
  });
  if (!md) return `Firecrawl returned no content for: ${url}`;
  return windowText(md, { query, offset }, 6000);
}

// ---------- executeTool ----------
// Single dispatch point every provider (claude.js/deepseek.js/openai.js) calls to run a
// model-requested tool by name, with already-JSON-parsed `input` (each provider parses the raw
// tool-call arguments string itself before calling in here). Wraps the call in a backend trace
// (beginBackendTrace/endBackendTrace) for logging/debugging, and standardizes error handling:
// a ToolFatalError re-throws so the caller aborts the whole turn via onError; any other error is
// caught and converted into a "Tool error (...)" string result instead, so the model sees the
// failure as a normal tool_result and can decide how to proceed (e.g. try a different tool).
// Returns a Promise<string> — always plain text/markdown, never a raw object, since it becomes
// tool_result/role:'tool' message content.
export async function executeTool(name, input, signal){
  const trace = beginBackendTrace('tool', {
    tool: name,
    input: safeJsonForLog(input),
  });
  try {
    let result;
    if (name === 'wikipedia_search') result = await runWikipediaSearch(input.query, signal);
    else if (name === 'fetch_url') result = await runFetchUrl(input.url, signal, { query:input.query, offset:input.offset });
    else if (name === 'web_search') result = await runWebSearch(input.query, signal);
    else if (name === 'serper_search') result = await runSerperSearch(input.query, signal);
    else if (name === 'firecrawl_scrape') result = await runFirecrawlScrape(input.url, signal, { query:input.query, offset:input.offset });
    else result = 'Unknown tool: ' + name;
    endBackendTrace(trace, 'end', {
      tool: name,
      outputChars: String(result || '').length,
      outputPreview: safeJsonForLog(result, 500),
    });
    return result;
  } catch(e){
    const result = `Tool error (${name}): ${e.message}`;
    endBackendTrace(trace, e.name === 'AbortError' ? 'abort' : 'error', {
      tool: name,
      error: e.message || String(e),
      fatal: !!e.isToolFatal,
    });
    if (e.name === 'AbortError') throw e;
    if (e.isToolFatal) throw e;
    return result;
  }
}

// Produces a short human-readable label for one tool call/result (e.g. for UI display of what a
// tool round looked up) — used both directly and inside toolResultFallbackMarkdown below.
export function toolResultTitle(name, input = {}){
  if (name === 'wikipedia_search') return `Wikipedia: ${input.query || 'search'}`;
  if (name === 'serper_search') return `Google search: ${input.query || 'search'}`;
  if (name === 'web_search') return `Web search: ${input.query || 'search'}`;
  if (name === 'firecrawl_scrape') return `Scrape: ${input.url || 'URL'}`;
  if (name === 'fetch_url') return `Page read: ${input.url || 'URL'}`;
  return name || 'Tool result';
}

// Renders a list of already-retrieved tool results as a standalone markdown answer, used when a
// provider's model stalls or aborts before turning search/scrape results into a real synthesized
// response (see BUGS.md #012/#017/#018, and the completeWithToolFallback path in deepseek.js) —
// this lets the app show the user what was actually found instead of losing the work or spinning
// forever. Truncates each result's content to 5000 chars. Returns '' if there are no results to
// show.
export function toolResultFallbackMarkdown(results){
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

// ---------- model label ----------
// Maps a raw provider model id (as sent on the wire) to the human-readable label shown in the UI
// chip/status line. `thinking` distinguishes DeepSeek's two display labels for its single model
// id (see BUGS.md #044 — DeepSeek collapsed separate chat/reasoner models into one id gated by a
// request-level `thinking` flag, so the id alone no longer tells you which mode was used).
export function modelLabelFromId(id, thinking){
  const model = String(id || '');
  if (model.includes('haiku')) return 'Claude Haiku 4.5';
  if (model === 'claude-opus-4-8') return 'Claude Opus 4.8';
  if (model === 'claude-opus-4-5') return 'Claude Opus 4.5';
  if (model.includes('opus')) return 'Claude Opus 5';
  if (model === 'claude-sonnet-4-6') return 'Claude Sonnet 4.6';
  if (model === 'claude-sonnet-4-5') return 'Claude Sonnet 4.5';
  if (model.includes('sonnet')) return 'Claude Sonnet 5';
  if (model === 'deepseek-v4-flash') return thinking ? 'DeepSeek Flash (Thinking)' : 'DeepSeek Flash';
  if (model === 'deepseek-v4-pro') return 'DeepSeek Pro';
  if (model === 'gpt-5.6-luna') return 'GPT-5.6 Luna';
  if (model === 'gpt-5.6-terra') return 'GPT-5.6 Terra';
  if (model === 'gpt-5.6-sol') return 'GPT-5.6 Sol';
  if (model === 'gpt-5-2025-08-07') return 'GPT-5';
  if (model.includes('gemini-2.0-flash')) return 'Gemini 2.0 Flash';
  if (model.includes('gemini-2.5-pro')) return 'Gemini 2.5 Pro';
  return model;
}

// ---------- shared model / mode mapping ----------
// Single source for pref-value -> provider / wire model id / mode system-prompt text, used by
// chat (app.js) and Notes branches (views/notes.js) so the two never drift (cf. BUGS.md #044-#046).
export function providerForModelPref(value){
  if (value === 'deepseek' || value === 'deepseek-r1') return 'deepseek';
  if (value === 'gpt-4o' || value === 'gpt-4o-mini' || value === 'gpt-5') return 'openai';
  if (value === 'gemini-flash' || value === 'gemini-pro') return 'gemini';
  return 'anthropic';
}

export function modelIdForModelPref(value){
  if (value === 'opus') return 'claude-opus-5';
  if (value === 'opus-4-8') return 'claude-opus-4-8';
  if (value === 'opus-4-5') return 'claude-opus-4-5';
  if (value === 'sonnet-4-6') return 'claude-sonnet-4-6';
  if (value === 'sonnet-4-5') return 'claude-sonnet-4-5';
  if (value === 'haiku') return 'claude-haiku-4-5-20251001';
  if (value === 'deepseek') return 'deepseek-v4-flash';
  if (value === 'deepseek-r1') return 'deepseek-v4-flash';
  if (value === 'gpt-4o') return 'gpt-5.6-terra';
  if (value === 'gpt-4o-mini') return 'gpt-5.6-luna';
  if (value === 'gpt-5') return 'gpt-5-2025-08-07';
  if (value === 'gemini-flash') return 'gemini-2.0-flash';
  if (value === 'gemini-pro') return 'gemini-2.5-pro-preview-05-06';
  return 'claude-sonnet-5';
}

// Conversation-mode prompt lines now live in core/modes.js (user-editable);
// re-exported here so existing importers keep working.
export { modeSystemPromptParts } from '../core/modes.js';
