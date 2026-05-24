// Pure markdown rendering utilities — no app state, no DOM globals required.
// Exported for use by app.js and any future module that renders markdown.

export function esc(s){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]); }

function inlineMd(raw){
  // escape HTML, then apply inline patterns
  let s = esc(raw);
  s = s.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*([^*\n]+?)\*/g, '<em>$1</em>');
  s = s.replace(/`([^`]+?)`/g, '<code>$1</code>');
  // markdown links [label](url) — must run before bare-URL pass to avoid capturing the closing )
  const mdLinks = [];
  s = s.replace(/\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g, (_, label, url) => {
    const i = mdLinks.length;
    mdLinks.push(`<a href="${url}" target="_blank" rel="noopener noreferrer">${label || url}</a>`);
    return `\x02${i}\x03`;
  });
  // auto-link bare URLs
  s = s.replace(/https?:\/\/[^\s<>"{}|\\^`]+/g, url => {
    const m = url.match(/^(.+?)([.,;:!?]+)$/);
    if (m) return `<a href="${m[1]}" target="_blank" rel="noopener noreferrer">${m[1]}</a>${m[2]}`;
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
  });
  // restore markdown links
  if (mdLinks.length) s = s.replace(/\x02(\d+)\x03/g, (_, i) => mdLinks[+i]);
  return s;
}

function splitTableRow(line){
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  const cells = [];
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

function isTableDivider(line){
  const cells = splitTableRow(line);
  return cells.length >= 2 && cells.every(cell => /^:?-+:?$/.test(cell.trim()));
}

function tableAlignClasses(dividerLine){
  return splitTableRow(dividerLine).map(cell => {
    const t = cell.trim();
    if (t.startsWith(':') && t.endsWith(':')) return ' md-align-center';
    if (t.endsWith(':')) return ' md-align-right';
    return '';
  });
}

function normalizeTableCells(cells, count){
  const out = cells.slice(0, count);
  if (cells.length > count && count > 0) out[count - 1] = cells.slice(count - 1).join(' | ');
  while (out.length < count) out.push('');
  return out;
}

function renderTable(headers, dividerLine, rows){
  const aligns = tableAlignClasses(dividerLine);
  const count = headers.length;
  const ths = normalizeTableCells(headers, count).map((cell, i) => `<th class="${aligns[i] || ''}">${inlineMd(cell)}</th>`).join('');
  const trs = rows.map(row => {
    const tds = normalizeTableCells(splitTableRow(row), count).map((cell, i) => `<td class="${aligns[i] || ''}">${inlineMd(cell)}</td>`).join('');
    return `<tr>${tds}</tr>`;
  }).join('');
  return `<div class="md-table-wrap"><table><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table></div>`;
}

function normalizeMarkdownForDisplay(text){
  let s = String(text || '').replace(/\r\n?/g, '\n');
  // Some models stream compact prose around tool calls or lists. Add block breaks
  // only before clear Markdown structures that are visibly glued to prior text.
  s = s.replace(/([a-z0-9][.!?])(?=[A-Z][a-z]{2,})/g, '$1\n\n');
  s = s.replace(/([^\n])(\s*)(#{1,4}\s+)/g, '$1\n\n$3');
  s = s.replace(/([^\n])[ \t]+(\d{1,2}\.\s+(?=[A-Z][A-Za-z0-9&/()'' -]{1,70}(?:\s|$)))/g, '$1\n\n$2');

  const fieldLabels = [
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
  fieldLabels.forEach(label => {
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`([^\\n\\s])[ \\t]*(${escapedLabel}:)`, 'g');
    s = s.replace(re, '$1\n$2');
  });

  return s;
}

export function renderMarkdown(text){
  const lines = normalizeMarkdownForDisplay(text).split('\n');
  let html = '';
  let listTag = null; // 'ul' or 'ol'
  const labelLineRe = /^([A-Za-z0-9][A-Za-z0-9’' -]{1,36}:)\s*(.*)$/;

  const closeList = () => { if (listTag){ html += `</${listTag}>`; listTag = null; } };

  for (let i = 0; i < lines.length; i++){
    const line = lines[i].trimEnd();

    // fenced code blocks
    const fenceM = line.match(/^```(\w*)$/);
    if (fenceM) {
      const lang = fenceM[1].toLowerCase();
      const codeLines = [];
      i++;
      while (i < lines.length && lines[i].trimEnd() !== '```') { codeLines.push(lines[i]); i++; }
      const isComplete = i < lines.length;
      const code = codeLines.join('\n');
      closeList();
      if (lang === 'mermaid' && isComplete) {
        html += `<div class="mermaid mermaid-block">${esc(code)}</div>`;
      } else if (lang === 'mermaid') {
        html += `<pre class="lang-mermaid"><code>${esc(code)}</code></pre>`;
      } else {
        const langClass = lang ? ` class="lang-${esc(lang)}"` : '';
        html += `<pre><code${langClass}>${esc(code)}</code></pre>`;
      }
      continue;
    }

    // tables
    if (line.includes('|') && lines[i + 1] && isTableDivider(lines[i + 1])){
      const headers = splitTableRow(line);
      const dividerLine = lines[i + 1];
      const rows = [];
      i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')){
        rows.push(lines[i].trimEnd());
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
    if (hm){ closeList(); const tag = 'h' + hm[1].length; html += `<${tag}>${inlineMd(hm[2])}</${tag}>`; continue; }

    // hr
    if (/^[-*_]{3,}$/.test(line.trim())){ closeList(); html += '<hr>'; continue; }

    // unordered list
    const ulm = line.match(/^[-*+] (.+)/);
    if (ulm){
      if (listTag !== 'ul'){ closeList(); html += '<ul>'; listTag = 'ul'; }
      html += `<li>${inlineMd(ulm[1])}</li>`; continue;
    }

    // ordered list
    const olm = line.match(/^(\d+)\. (.+)/);
    if (olm){
      if (labelLineRe.test((lines[i + 1] || '').trim())){
        closeList();
        html += `<p class="md-number-line"><strong>${inlineMd(`${olm[1]}. ${olm[2]}`)}</strong></p>`;
        continue;
      }
      if (listTag !== 'ol'){ closeList(); html += '<ol>'; listTag = 'ol'; }
      html += `<li>${inlineMd(olm[2])}</li>`; continue;
    }

    // compact field label line
    const labelm = line.match(labelLineRe);
    if (labelm){
      closeList();
      html += `<p class="md-label-line"><strong>${inlineMd(labelm[1])}</strong>${labelm[2] ? ' ' + inlineMd(labelm[2]) : ''}</p>`;
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

export function hasMarkdownTable(text){
  const lines = String(text || '').split('\n');
  return lines.some((line, i) => line.includes('|') && lines[i + 1] && isTableDivider(lines[i + 1]));
}

export function markdownTextFromRendered(el){
  const blocks = [...el.children];
  return (blocks.length ? blocks.map(child => child.textContent) : [el.textContent]).join('\n');
}

export function renderMermaidIn(el) {
  if (typeof mermaid === 'undefined') return;
  if (!window._mermaidInited) {
    mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'loose', fontFamily: 'Space Grotesk, system-ui, sans-serif' });
    window._mermaidInited = true;
  }
  const nodes = Array.from(el.querySelectorAll('.mermaid.mermaid-block:not([data-mermaid-rendered])'));
  if (!nodes.length) return;
  nodes.forEach(n => n.setAttribute('data-mermaid-rendered', '1'));
  mermaid.run({ nodes }).catch(() => {});
}

export function friendlyError(msg){
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

export function isConfigError(msg){
  return /no api key|invalid.*key|key.*invalid|personalization|out of credits|top up|401|402/i.test(msg);
}
