// Shared tool infrastructure — tool runners, executeTool, and model label helper.
// Imported by all provider modules. No DOM dependencies.

import { appState } from '../core/state.js';
import {
  loggedFetch, readResponseBody, readLoggedErrorPayload,
  safeJsonForLog, beginBackendTrace, endBackendTrace,
  SEARCH_TIMEOUT_MS, PAGE_READ_TIMEOUT_MS, SCRAPE_TIMEOUT_MS,
} from '../core/api-client.js';

// ---------- ToolFatalError ----------
export class ToolFatalError extends Error {
  constructor(message){
    super(message);
    this.name = 'ToolFatalError';
    this.isToolFatal = true;
  }
}

// ---------- tool runners ----------
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

export async function runFetchUrl(url, signal){
  const res = await loggedFetch(`https://r.jina.ai/${url}`, { signal, headers:{ 'Accept':'text/plain' } }, { provider:'jina', label:'fetch_url', timeoutMs:PAGE_READ_TIMEOUT_MS });
  const text = await readResponseBody(res, { kind:'text', signal, provider:'jina', label:'fetch_url', timeoutMs:PAGE_READ_TIMEOUT_MS });
  return text.length > 4000 ? text.slice(0, 4000) + '\n\n[content truncated]' : text;
}

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

export async function runSerperSearch(query, signal){
  const key = appState.apiKeys.serper;
  if (!key) throw new ToolFatalError('Serper API key not set. Add it in Settings, or configure SearXNG for web search.');
  let res;
  try {
    res = await loggedFetch('https://google.serper.dev/search', {
      method: 'POST',
      signal,
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

export async function runFirecrawlScrape(url, signal){
  const key = appState.apiKeys.firecrawl;
  if (!key) throw new ToolFatalError('Firecrawl API key not set. Add it in Settings, or retry without Firecrawl scraping.');
  let res;
  try {
    res = await loggedFetch('https://api.firecrawl.dev/v1/scrape', {
      method: 'POST',
      signal,
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
  const md = data.data?.markdown || data.markdown || '';
  if (!md) return `Firecrawl returned no content for: ${url}`;
  return md.length > 6000 ? md.slice(0, 6000) + '\n\n[content truncated]' : md;
}

// ---------- executeTool ----------
export async function executeTool(name, input, signal){
  const trace = beginBackendTrace('tool', {
    tool: name,
    input: safeJsonForLog(input),
  });
  try {
    let result;
    if (name === 'wikipedia_search') result = await runWikipediaSearch(input.query, signal);
    else if (name === 'fetch_url') result = await runFetchUrl(input.url, signal);
    else if (name === 'web_search') result = await runWebSearch(input.query, signal);
    else if (name === 'serper_search') result = await runSerperSearch(input.query, signal);
    else if (name === 'firecrawl_scrape') result = await runFirecrawlScrape(input.url, signal);
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

export function toolResultTitle(name, input = {}){
  if (name === 'wikipedia_search') return `Wikipedia: ${input.query || 'search'}`;
  if (name === 'serper_search') return `Google search: ${input.query || 'search'}`;
  if (name === 'web_search') return `Web search: ${input.query || 'search'}`;
  if (name === 'firecrawl_scrape') return `Scrape: ${input.url || 'URL'}`;
  if (name === 'fetch_url') return `Page read: ${input.url || 'URL'}`;
  return name || 'Tool result';
}

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
