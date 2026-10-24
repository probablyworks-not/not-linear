// Ported from frontend/core/markdown.js, string-for-string, with one deliberate
// divergence: link text is shortened to the site name (see anchor() below). This is a hand-rolled
// renderer on purpose: ADR-038 dual-writes this HTML into `stream` for the legacy
// app to re-read, so React must emit exactly what legacy emits. Do not swap in a
// markdown library. A test renders both and compares.

import { labelIsUrl, linkDisplayText } from './link-text';

// esc: HTML-escape a string (&, <, >, ", '). The building block every other
// function in this file uses before inserting raw text into HTML, so nothing
// here is vulnerable to injecting markup via message content. Also re-used
// directly by app.js and the feature views for their own non-markdown escaping.
export function esc(s: unknown): string { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as Record<string, string>)[c]!); }

// anchor: one `<a>` for a link. The visible text is the site name rather than
// the address (see lib/link-text); the full URL stays in href and title. A link
// we named ourselves is marked `data-site`, which is what lib/name-links looks
// for when it upgrades the label to the page's own title after render.
function anchor(url: string, label: string, named = false): string {
  const mark = named ? ' data-site="1"' : '';
  return `<a href="${url}" target="_blank" rel="noopener noreferrer" title="${url}"${mark}>${label}</a>`;
}

// inlineMd: internal helper — render inline (single-line) markdown spans
// (bold/italic/bold+italic, inline code, markdown links, and auto-linked bare
// URLs) inside one already-HTML-escaped line. Called from renderTable() and
// from most of the per-line branches in renderMarkdown() below; not exported,
// since block-level structure (headings, lists, tables) is renderMarkdown's job.
export function inlineMd(raw: string): string {
  // escape HTML, then apply inline patterns
  let s = esc(raw);
  s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*([^*\n]+?)\*/g, '<em>$1</em>');
  s = s.replace(/`([^`]+?)`/g, '<code>$1</code>');
  // markdown links [label](url) — must run before bare-URL pass to avoid capturing the closing )
  // Replaced with \x02<index>\x03 placeholders (control chars unlikely to appear
  // in real text/markdown) so the bare-URL auto-linker below can't re-match
  // text already inside the just-built <a> tags; restored after that pass runs.
  const mdLinks: string[] = [];
  s = s.replace(/\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g, (_: string, label: string, url: string) => {
    const i = mdLinks.length;
    const bare = labelIsUrl(label, url);
    mdLinks.push(anchor(url, bare ? linkDisplayText(url) : label, bare));
    return `\x02${i}\x03`;
  });
  // auto-link bare URLs — shown as the article's name (or the site), address in the tooltip
  s = s.replace(/https?:\/\/[^\s<>"{}|\\^`]+/g, (url: string) => {
    const m = url.match(/^(.+?)([.,;:!?]+)$/);
    if (m) return `${anchor(m[1]!, linkDisplayText(m[1]!), true)}${m[2]}`;
    return anchor(url, linkDisplayText(url), true);
  });
  // restore markdown links
  // eslint-disable-next-line no-control-regex -- \x02/\x03 are the placeholder delimiters chosen above, verbatim from legacy
  if (mdLinks.length) s = s.replace(/\x02(\d+)\x03/g, (_: string, i: string) => mdLinks[+i]!);
  return s;
}

// splitTableRow: internal — split one `| a | b |`-style table row into an
// array of trimmed cell strings, handling a leading/trailing pipe and
// backslash-escaped pipes (`\|`) inside a cell. Used by isTableDivider,
// tableAlignClasses and renderTable below, and by hasMarkdownTable().
function splitTableRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  const cells: string[] = [];
  let cell = '';
  let escaped = false;
  for (const ch of s){
    if (ch === '|' && !escaped){
      cells.push(cell.trim().replace(/\\\|/g, '|'));
      cell = '';
    } else {
      cell += ch;
    }
    escaped = ch === '\\' && !escaped;
    if (ch !== '\\') escaped = false;
  }
  cells.push(cell.trim().replace(/\\\|/g, '|'));
  return cells;
}

// isTableDivider: internal — is `line` a GFM table header-separator row (e.g.
// `| --- | :---: | ---: |`)? At least 2 cells, each made only of dashes with
// optional leading/trailing colons for alignment. Used by renderMarkdown's
// table-detection lookahead and by hasMarkdownTable().
function isTableDivider(line: string): boolean {
  const cells = splitTableRow(line);
  return cells.length >= 2 && cells.every((cell: string) => /^:?-+:?$/.test(cell.trim()));
}

// tableAlignClasses: internal — turn a divider row (see isTableDivider) into
// a per-column array of CSS class suffixes (' md-align-center'/' md-align-right'/
// '') based on the `:` placement, for use on the <th>/<td> in renderTable.
function tableAlignClasses(dividerLine: string): string[] {
  return splitTableRow(dividerLine).map((cell: string) => {
    const t = cell.trim();
    if (t.startsWith(':') && t.endsWith(':')) return ' md-align-center';
    if (t.endsWith(':')) return ' md-align-right';
    return '';
  });
}

// normalizeTableCells: internal — pad/truncate a row's cells to exactly
// `count` columns (the header count) so a ragged row never breaks the table
// shape. A row with extra cells has its overflow rejoined with ' | ' into the
// last column (so trailing stray pipes don't silently drop data) rather than
// being truncated outright.
function normalizeTableCells(cells: string[], count: number): string[] {
  const out = cells.slice(0, count);
  if (cells.length > count && count > 0) out[count - 1] = cells.slice(count - 1).join(' | ');
  while (out.length < count) out.push('');
  return out;
}

// renderTable: internal — build the `<div class="md-table-wrap"><table>...`
// markup for one markdown table, given its header line, its divider line
// (for alignment), and its body rows. Called only from renderMarkdown()'s
// table-detection branch.
function renderTable(headers: string[], dividerLine: string, rows: string[]): string {
  const aligns = tableAlignClasses(dividerLine);
  const count = headers.length;
  const ths = normalizeTableCells(headers, count).map((cell: string, i: number) => `<th class="${aligns[i] || ''}">${inlineMd(cell)}</th>`).join('');
  const trs = rows.map((row: string) => {
    const tds = normalizeTableCells(splitTableRow(row), count).map((cell: string, i: number) => `<td class="${aligns[i] || ''}">${inlineMd(cell)}</td>`).join('');
    return `<tr>${tds}</tr>`;
  }).join('');
  return `<div class="md-table-wrap"><table><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table></div>`;
}

// normalizeMarkdownForDisplay: internal — pre-process raw model output before
// line-splitting it in renderMarkdown(). Some LLM responses stream compact
// prose where a heading, numbered item, or "Label:" field runs directly into
// the preceding sentence with no blank line (models don't always emit clean
// block separation). This inserts the missing line breaks *only* right before
// recognizable Markdown structures so we don't add spurious breaks inside
// normal prose. Also normalizes CRLF/CR to LF first so line-based regexes work
// consistently regardless of the source's line endings.

// A model asked for "an HTML file" often answers with the document itself and no fence. Without
// one every tag was escaped into prose (the reply read as a wall of `<article style="…">` lines),
// so it is fenced here, before anything else looks at the text: downstream the block is an
// ordinary ```html block and picks up the file card, Download and Save-to-artifacts for free.

/** Tags that only ever open a document or a standalone figure — enough on their own. */
const STRONG_HTML_START = /^\s*(?:<!doctype\s+html|<html\b|<head\b|<body\b|<article\b|<main\b|<svg\b)/i;
/** Tags that are a document only when the text also ends on a closing tag. */
const WEAK_HTML_START = /^\s*(?:<section\b|<div\b|<table\b|<figure\b)/i;

/** Wraps an unfenced raw HTML/SVG answer in a fence. Returns `text` unchanged when it is prose. */
export function fenceRawHtml(text: string): string {
  if (text.includes('```')) return text; // already fenced, or mixed prose and code: leave it alone
  const lines = text.split('\n');
  const start = lines.findIndex(l => STRONG_HTML_START.test(l) || WEAK_HTML_START.test(l));
  if (start < 0) return text;
  const body = lines.slice(start).join('\n').trimEnd();
  if ((body.match(/<[a-z!][^>]*>/gi) ?? []).length < 4) return text; // a stray tag in prose is not a page
  if (!STRONG_HTML_START.test(body) && !/<\/[a-z][\w-]*>$/i.test(body)) return text;
  const lang = /^\s*<svg\b/i.test(body) ? 'svg' : 'html';
  const before = lines.slice(0, start).join('\n').trimEnd();
  return `${before ? before + '\n\n' : ''}\`\`\`${lang}\n${body}\n\`\`\``;
}

/** Applies `fn` to the prose between fenced blocks, never to the code inside them. */
function outsideFences(s: string, fn: (chunk: string) => string): string {
  const out: string[] = [];
  let buf: string[] = [];
  let inFence = false;
  const flush = (): void => { if (buf.length) out.push(inFence ? buf.join('\n') : fn(buf.join('\n'))); buf = []; };
  for (const line of s.split('\n')) {
    if (line.trimEnd().startsWith('```')) { flush(); inFence = !inFence; out.push(line); continue; }
    buf.push(line);
  }
  flush();
  return out.join('\n');
}

function normalizeMarkdownForDisplay(text: unknown): string {
  const whole = fenceRawHtml(String(text || '').replace(/\r\n?/g, '\n'));
  // Some models stream compact prose around tool calls or lists. Add block breaks
  // only before clear Markdown structures that are visibly glued to prior text. Every
  // fix-up below is prose-shaped, so none of it may run on code inside a fence.
  return outsideFences(whole, prose => proseBlockBreaks(prose));
}

function proseBlockBreaks(text: string): string {
  let s = text;
  s = s.replace(/([a-z0-9][.!?])(?=[A-Z][a-z]{2,})/g, '$1\n\n');
  s = s.replace(/([^\n#])(\s*)(#{1,4}\s+)/g, '$1\n\n$3');
  s = s.replace(/([^\n#])[ \t]+(\d{1,2}\.\s+(?=[A-Z][A-Za-z0-9&/()'' -]{1,70}(?:\s|$)))/g, '$1\n\n$2');

  // Known recurring "Label:" field names seen in model output (e.g. structured
  // comparisons) that should start their own line even when glued to prior
  // text. This list is a pragmatic, hand-maintained set rather than a general
  // solution — add to it if a new recurring label shows up glued to prose.
  const fieldLabels: string[] = [
    'Model',
    'Funding',
    'Focus',
    'Services',
    'Difference from Snabbit',
    'Difference',
    'Key difference',
    '2026 status',
    'In 2026',
    'Status',
    'Snabbit’s value prop',
    "Snabbit's value prop",
    'Challenge',
    'References',
    'Source',
    'Sources'
  ];
  fieldLabels.forEach((label: string) => {
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`([^\\n\\s*_])[ \\t]*(${escapedLabel}:)`, 'g');
    s = s.replace(re, '$1\n$2');
  });

  return s;
}

// renderMarkdown: the main entry point — convert a raw markdown string into
// an HTML string. Runs normalizeMarkdownForDisplay() first, then walks the
// text line by line (not a full AST parse) recognizing fenced code blocks
// (including ```mermaid, deferred to renderMermaidIn for actual diagram
// rendering), tables (via splitTableRow/isTableDivider/renderTable), headings,
// horizontal rules, ordered/unordered lists, a "compact field label line"
// convenience format (`Label: value` rendered as a styled paragraph), and
// falls back to plain paragraphs. Called by app.js and the feature views
// (frontend/views/notes.js) to render
// assistant messages and note bodies for display. Returns '<p></p>' for
// empty input rather than an empty string, so callers always get a renderable node.
export function renderMarkdown(text: unknown): string {
  const lines = normalizeMarkdownForDisplay(text).split('\n');
  let html = '';
  let listTag: 'ul' | 'ol' | null = null; // 'ul' or 'ol'
  const labelLineRe = /^([A-Za-z0-9][A-Za-z0-9’' -]{1,36}:)\s*(.*)$/;

  const closeList = () => { if (listTag){ html += `</${listTag}>`; listTag = null; } };

  for (let i = 0; i < lines.length; i++){
    const line = lines[i]!.trimEnd();

    // fenced code blocks
    const fenceM = line.match(/^```(\w*)$/);
    if (fenceM) {
      const lang = (fenceM[1] ?? '').toLowerCase();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && lines[i]!.trimEnd() !== '```') { codeLines.push(lines[i]!); i++; }
      const isComplete = i < lines.length;
      const code = codeLines.join('\n');
      closeList();
      if (lang === 'mermaid' && isComplete) {
        html += `<div class="mermaid mermaid-block">${esc(code)}</div>`;
      } else if (lang === 'mermaid') {
        html += `<pre class="lang-mermaid"><code>${esc(code)}</code></pre>`;
      } else {
        const langClass = lang ? ` class="lang-${esc(lang)}"` : '';
        const label = lang || 'text';
        html += `<div class="code-block"><div class="code-block-head"><span class="code-block-lang">${esc(label)}</span><button type="button" class="code-copy-btn"><i class="ti ti-copy"></i><span>Copy</span></button></div><pre><code${langClass}>${esc(code)}</code></pre></div>`;
      }
      continue;
    }

    // tables
    if (line.includes('|') && lines[i + 1] && isTableDivider(lines[i + 1]!)){
      const headers = splitTableRow(line);
      const dividerLine = lines[i + 1]!;
      const rows: string[] = [];
      i += 2;
      while (i < lines.length && lines[i]!.trim() && lines[i]!.includes('|')){
        rows.push(lines[i]!.trimEnd());
        i += 1;
      }
      i -= 1;
      if (headers.length >= 2){
        closeList();
        html += renderTable(headers, dividerLine, rows);
        continue;
      }
    }

    // headings
    const hm = line.match(/^(#{1,4}) (.+)/);
    if (hm){ closeList(); const tag = 'h' + hm[1]!.length; html += `<${tag}>${inlineMd(hm[2]!)}</${tag}>`; continue; }

    // hr
    if (/^[-*_]{3,}$/.test(line.trim())){ closeList(); html += '<hr>'; continue; }

    // unordered list
    const ulm = line.match(/^[-*+] (.+)/);
    if (ulm){
      if (listTag !== 'ul'){ closeList(); html += '<ul>'; listTag = 'ul'; }
      html += `<li>${inlineMd(ulm[1]!)}</li>`; continue;
    }

    // ordered list
    const olm = line.match(/^(\d+)\. (.+)/);
    if (olm){
      if (labelLineRe.test((lines[i + 1] || '').trim())){
        closeList();
        html += `<p class="md-number-line"><strong>${inlineMd(`${olm[1]}. ${olm[2]}`)}</strong></p>`;
        continue;
      }
      if (listTag !== 'ol'){ closeList(); html += +olm[1]! === 1 ? '<ol>' : `<ol start="${+olm[1]!}">`; listTag = 'ol'; }
      html += `<li>${inlineMd(olm[2]!)}</li>`; continue;
    }

    // compact field label line
    // `Source: x` is a label line, but `See https://…` only looks like one: the
    // scheme's colon must not swallow the URL, or it never gets auto-linked.
    const labelm = /\bhttps?:$/i.test(line.match(labelLineRe)?.[1] ?? '') ? null : line.match(labelLineRe);
    if (labelm){
      closeList();
      html += `<p class="md-label-line"><strong>${inlineMd(labelm[1]!)}</strong>${labelm[2] ? ' ' + inlineMd(labelm[2]) : ''}</p>`;
      continue;
    }

    // blank line or stray list marker — close list, skip
    if (line.trim() === '' || /^[-*+]$/.test(line.trim())){ closeList(); continue; }

    // paragraph
    closeList();
    html += `<p>${inlineMd(line)}</p>`;
  }
  closeList();
  return html || '<p></p>';
}

// hasMarkdownTable: cheap check for whether `text` contains at least one
// GFM-style table (reuses the same header+divider detection as
// renderMarkdown's table branch, but without rendering anything). Used by
// app.js to decide UI behavior (e.g. whether to offer table-specific actions)
// without paying the cost of a full render.
export function hasMarkdownTable(text: unknown): boolean {
  const lines = String(text || '').split('\n');
  return lines.some((line: string, i: number) => line.includes('|') && !!lines[i + 1] && isTableDivider(lines[i + 1]!));
}

// markdownTextFromRendered: take a DOM element containing renderMarkdown()'s
// output and reconstruct a plain-text approximation, one line per top-level
// rendered block (paragraph, list item's container, etc.) rather than
// el.textContent's single run-on string. Used by app.js — e.g. for copying a
// rendered message back out as readable plain text.
export function markdownTextFromRendered(el: Element): string {
  const blocks = [...el.children];
  return (blocks.length ? blocks.map(child => child.textContent ?? '') : [el.textContent]).join('\n');
}

// renderMermaidIn / highlightCodeIn run AFTER the HTML is in the DOM. mermaid is
// large, so it loads on first use; highlight.js uses its common-language build,
// which covers what the CDN bundle legacy loads covers in practice.

let mermaidReady: Promise<typeof import('mermaid').default> | null = null;

export function renderMermaidIn(el: Element): void {
  const nodes = Array.from(el.querySelectorAll<HTMLElement>('.mermaid.mermaid-block:not([data-mermaid-rendered])'));
  if (!nodes.length) return;
  nodes.forEach(n => n.setAttribute('data-mermaid-rendered', '1'));
  mermaidReady ??= import('mermaid').then(m => {
    // mermaid wants a literal font stack, so read the app's token rather than
    // repeating it here and letting the two drift apart.
    const appFont = getComputedStyle(document.documentElement).getPropertyValue('--font').trim();
    m.default.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'loose', fontFamily: appFont || 'system-ui, sans-serif' });
    return m.default;
  });
  void mermaidReady.then(m => m.run({ nodes })).catch(() => { /* a bad diagram stays as its source text */ });
}

export async function highlightCodeIn(el: Element): Promise<void> {
  const nodes = Array.from(el.querySelectorAll<HTMLElement>('pre code[class*="lang-"]:not([data-hl-done])'));
  if (!nodes.length) return;
  const { default: hljs } = await import('highlight.js/lib/common');
  for (const node of nodes) {
    node.setAttribute('data-hl-done', '1');
    const lang = /lang-(\S+)/.exec(node.className)?.[1];
    if (!lang || lang === 'text') continue;
    try { if (hljs.getLanguage(lang)) hljs.highlightElement(node); } catch { /* unknown language: leave plain */ }
  }
}

// friendlyError: translate a raw/technical error message (often surfaced from
// a backend/provider error string) into calmer, actionable copy for display
// in a node's UI — per this repo's convention of never silently swallowing
// LLM/provider errors, but also not showing a raw stack trace to the user.
// Falls through to returning `msg` unchanged if none of the known patterns
// match. Used by app.js wherever an error from core/api-client.js or a
// provider module (frontend/providers/*.js) is shown to the user.
export function friendlyError(msg: string): string {
  if (/anthropic key/i.test(msg))
    return 'No Anthropic API key set. Open Settings and paste your Claude key, or switch the model to DeepSeek.';
  if (/deepseek api key/i.test(msg))
    return 'No DeepSeek API key set. Open Settings and paste your DeepSeek key, or switch the model to Sonnet.';
  if (/no api key/i.test(msg))
    return 'No API key set. Open Settings and paste your key to get started.';
  if (/invalid.*key|key.*invalid|check it in personalization/i.test(msg))
    return 'That API key wasn\'t accepted. Double-check it in Settings — it may have been rotated or miscopied.';
  if (/serper.*rate limit/i.test(msg))
    return 'Serper web search is rate limited. Wait a bit, reduce parallel chats, or configure SearXNG for search.';
  if (/claude.*rate limit/i.test(msg))
    return 'Claude is rate limited. Wait a bit, reduce parallel chats, or switch this chat to DeepSeek.';
  if (/deepseek.*rate limit/i.test(msg))
    return 'DeepSeek is rate limited. Wait a bit, reduce parallel chats, or switch this chat to Sonnet.';
  if (/firecrawl.*rate limit/i.test(msg))
    return 'Firecrawl scraping is rate limited. Wait a bit or retry without scraping.';
  if (/rate limit|wait a moment/i.test(msg))
    return 'Too many requests — the API needs a breather. Wait a few seconds and try again.';
  if (/timed out|stopped sending data/i.test(msg))
    return 'That request stalled before finishing. Try again, or narrow the query into a smaller research step.';
  if (/out of credits|top up/i.test(msg))
    return 'You\'re out of API credits. Top up your account to continue.';
  if (/overloaded/i.test(msg))
    return 'The server is overloaded right now. Give it a moment and retry.';
  if (/network error|check your connection/i.test(msg))
    return 'Couldn\'t reach the server. Check your internet connection and try again.';
  if (/stream interrupted/i.test(msg))
    return 'The response was cut off mid-stream. You can retry to get a fresh answer.';
  return msg;
}

// isConfigError: does `msg` indicate a user-fixable configuration problem
// (missing/invalid API key, out of credits, auth status codes) rather than a
// transient/server-side failure? Used by app.js to decide whether to, e.g.,
// surface a "check Settings" affordance alongside the friendlyError() text.
export function isConfigError(msg: string): boolean {
  return /no api key|invalid.*key|key.*invalid|personalization|out of credits|top up|401|402/i.test(msg);
}
