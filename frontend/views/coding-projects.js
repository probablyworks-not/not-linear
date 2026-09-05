// Coding Projects — a self-registering view (see ADR-003…ADR-006).
// Full-screen overlay (#cp-screen) shown via the view registry; chat sits
// underneath, untouched. CP02 built the seam; CP03 adds the real list view:
// a localStorage project registry, a filesystem scan per project (CP01
// endpoints), an LLM-generated status sentence (ADR-005) with heuristic
// fallback, plus gallery / empty states and a minimal add-folder flow.

import { registerView, mountView } from '../core/registry.js';
import { appState } from '../core/state.js';
import { loggedFetch, readResponseBody } from '../core/api-client.js';
import { esc, renderMarkdown } from '../core/markdown.js';
import { toast, wireTabInsertsTab } from '../core/ui.js';
import { openEmojiPicker } from '../core/emoji.js';
import { loadMindGarden, renderIconSvg, parseIconToken } from '../core/mind-garden.js';

// Render a stored project glyph: an emoji char, a Mind Garden token
// (`"icon:<id>"` or `"icon:<id>:<hex>"`), or the Tabler-folder fallback.
function emojiHTML(value, size = 22){
  const fallback = '<i class="ti ti-folder"></i>';
  if (!value) return fallback;
  const parsed = parseIconToken(value);
  if (parsed){
    const svg = renderIconSvg(parsed.id, { size, color: parsed.color });
    return svg || fallback;
  }
  return esc(value);
}

const $ = (s, r = document) => r.querySelector(s);

let currentProjectId = null;   // null = list view; otherwise the open project page

const SIDE_COLLAPSE_KEY = 'nl_cp_side_collapsed_v1';
const PROJECTS_KEY = 'nl_cp_projects_v1';
const STATUS_CACHE_KEY = 'nl_cp_status_cache_v1';
const COMMENTS_KEY = 'nl_cp_comments_v1';

let galleryMode = false;       // session-sticky list/gallery toggle
let scanCache = new Map();     // projectId -> scan result (this session)

// ---------- small utils ----------
function lsRead(key, fallback){
  try { return JSON.parse(localStorage.getItem(key) || '') ?? fallback; }
  catch { return fallback; }
}
function lsWrite(key, val){
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}
function relTime(ms){
  if (!ms) return '—';
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  const m = s / 60; if (m < 60) return `${Math.floor(m)}m ago`;
  const h = m / 60; if (h < 24) return `${Math.floor(h)}h ago`;
  const d = h / 24; if (d < 30) return `${Math.floor(d)}d ago`;
  const mo = d / 30; if (mo < 12) return `${Math.floor(mo)}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}
function daysSince(ms){ return ms ? (Date.now() - ms) / 86400000 : Infinity; }

// ---------- registry ----------
function loadProjects(){ const v = lsRead(PROJECTS_KEY, []); return Array.isArray(v) ? v : []; }
function saveProjects(list){ lsWrite(PROJECTS_KEY, list); }
function commentCount(id){ return loadComments(id).length; }
function loadComments(id){ const all = lsRead(COMMENTS_KEY, {}) || {}; return Array.isArray(all[id]) ? all[id] : []; }
function saveComments(id, arr){ const all = lsRead(COMMENTS_KEY, {}) || {}; all[id] = arr; lsWrite(COMMENTS_KEY, all); }
function addComment(id, text){
  const who = appState?.prefs?.name || 'You';
  const c = { id: 'c' + Date.now(), who, avatar: (who.trim()[0] || '?').toUpperCase(), text, t: Date.now() };
  const arr = loadComments(id); arr.push(c); saveComments(id, arr); return c;
}
function deleteComment(id, cid){ saveComments(id, loadComments(id).filter(c => c.id !== cid)); }

// ---------- comments rendering (CP06) ----------
function commentItemHtml(c){
  return `
    <div class="cp-comment" data-cid="${c.id}">
      <div class="cp-avatar">${esc(c.avatar || (c.who?.[0] || '?').toUpperCase())}</div>
      <div class="cp-comment-main">
        <div class="cp-comment-meta"><span class="cp-comment-who">${esc(c.who || 'you')}</span><span class="cp-comment-time">${relTime(c.t)}</span><button class="cp-comment-del" title="delete">×</button></div>
        <div class="cp-comment-body">${esc(c.text)}</div>
      </div>
    </div>`;
}

// Render the comment list into hostEl. order 'asc' = oldest→newest (popover),
// 'desc' = newest→oldest (page thread). emptyCopy varies by surface.
function renderCommentList(hostEl, id, order, emptyCopy){
  let arr = loadComments(id);
  arr = order === 'desc' ? [...arr].reverse() : arr;
  hostEl.innerHTML = arr.length
    ? arr.map(commentItemHtml).join('')
    : `<div class="cp-comment-empty">${esc(emptyCopy)}</div>`;
  hostEl.querySelectorAll('.cp-comment-del').forEach(btn => {
    btn.addEventListener('click', () => {
      const cid = btn.closest('.cp-comment').dataset.cid;
      deleteComment(id, cid);
      toast('comment deleted');
      renderCommentList(hostEl, id, order, emptyCopy);
      refreshCommentCounts(id);
    });
  });
}

// Auto-growing composer (textarea up to 120px) + send. ⌘/Ctrl+Enter posts.
function wireComposer(textarea, sendBtn, id, afterPost){
  const grow = () => { textarea.style.height = 'auto'; textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px'; };
  textarea.addEventListener('input', grow);
  const post = () => {
    const text = textarea.value.trim();
    if (!text) return;
    addComment(id, text);
    textarea.value = ''; grow();
    afterPost();
    refreshCommentCounts(id);
  };
  sendBtn.addEventListener('click', post);
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)){ e.preventDefault(); post(); }
  });
  wireTabInsertsTab(textarea);
}

// Keep the list-row chip count and the page block header count in sync.
function refreshCommentCounts(id){
  const n = commentCount(id);
  const chip = $(`.cp-row[data-id="${id}"] .cp-comments`);
  if (chip) chip.innerHTML = `💬${n ? ' ' + n : ''}`;
  const pageCount = $('#cp-comments-count');
  if (pageCount && currentProjectId === id) pageCount.textContent = String(n);
}

function addProject(path, name, emoji){
  const list = loadProjects();
  const id = 'cp' + Date.now().toString(36);
  const seg = String(path).replace(/\/+$/, '').split('/').pop() || path;
  list.unshift({ id, path, emoji: emoji || '📁', name: name || seg });
  saveProjects(list);
  return id;
}


// ---------- scan ----------
async function scanProject(path){
  const res = await loggedFetch('/__notlinear_scan_project', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path }),
  }, { kind: 'cp_scan' });
  return await readResponseBody(res, { kind: 'json', label: 'cp_scan' });
}

// Count unchecked GitHub-style checkboxes (`- [ ]`) in a markdown file's text.
function countOpen(text){
  if (!text) return 0;
  const m = text.match(/^[ \t>]*[-*+]\s+\[ \]/gm);
  return m ? m.length : 0;
}
function maxMtime(files){
  return Object.values(files || {}).reduce((mx, f) => Math.max(mx, (f && f.mtime) || 0), 0);
}
function maxMarkdownMtime(markdownFiles){
  return (Array.isArray(markdownFiles) ? markdownFiles : [])
    .reduce((mx, f) => Math.max(mx, (f && f.mtime) || 0), 0);
}
function missingCount(files){
  return ['readme', 'changelog', 'bugs', 'tasks'].filter(k => !(files?.[k]?.present)).length;
}

// ---------- status sentence (ADR-005) ----------
function statusCacheGet(path, mtime){
  const cache = lsRead(STATUS_CACHE_KEY, {}) || {};
  const hit = cache[path];
  return (hit && hit.mtime === mtime) ? hit.text : null;
}
function statusCacheSet(path, mtime, text){
  const cache = lsRead(STATUS_CACHE_KEY, {}) || {};
  cache[path] = { mtime, text };
  lsWrite(STATUS_CACHE_KEY, cache);
}

// Local fallback when there's no key or the call fails — never blocks the list.
function heuristicStatus(scan){
  const files = scan.files || {};
  if (!files.readme?.present && !files.changelog?.present && !files.tasks?.present){
    return 'no docs yet · drop a readme to get started';
  }
  const parts = [];
  const cl = files.changelog?.text || '';
  const firstCl = cl.split('\n').map(l => l.trim())
    .find(l => l && !/^#{1,6}\s*$/.test(l) && !/^[-=]{3,}$/.test(l));
  if (firstCl) parts.push(firstCl.replace(/^#{1,6}\s*/, '').slice(0, 80));
  const tasks = files.tasks?.text || '';
  const firstOpen = tasks.split('\n').map(l => l.trim())
    .find(l => /^[-*+]\s+\[ \]/.test(l));
  if (firstOpen) parts.push('next: ' + firstOpen.replace(/^[-*+]\s+\[ \]\s*/, '').slice(0, 70));
  return parts.join(' · ') || 'no changelog or tasks yet';
}

async function llmStatus(scan){
  const key = appState?.apiKeys?.deepseek;
  if (!key) return null;
  const files = scan.files || {};
  const cl = (files.changelog?.text || '').slice(0, 1800);
  const tk = (files.tasks?.text || '').slice(0, 1200);
  const prompt =
    `You write a single terse lowercase status line for a code project, ≤18 words, no trailing period. ` +
    `State what was last shipped and the next blocker. Use "·" to separate the two halves if useful.\n\n` +
    `CHANGELOG:\n${cl || '(none)'}\n\nTASKS:\n${tk || '(none)'}`;
  try {
    // Isolated non-streaming DeepSeek call (OpenAI-compatible). Deliberately does
    // NOT touch appState._activeController (which callDeepSeek mutates) so it can
    // never interrupt an in-flight chat stream.
    const res = await loggedFetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({
        model: 'deepseek-v4-flash',
        max_tokens: 80,
        stream: false,
        thinking: { type: 'disabled' },
        messages: [{ role: 'user', content: prompt }],
      }),
    }, { kind: 'cp_status' });
    if (!res.ok) return null;
    const data = await readResponseBody(res, { kind: 'json', label: 'cp_status' });
    const text = (data?.choices?.[0]?.message?.content || '').trim();
    return text || null;
  } catch { return null; }
}

// Resolve a project's display data from a scan; status is filled async.
function deriveMeta(scan){
  const files = scan.files || {};
  const bugs = countOpen(files.bugs?.text);
  const mtime = Math.max(maxMtime(files), maxMarkdownMtime(scan.markdownFiles));
  const miss = missingCount(files);
  const stale = daysSince(mtime) > 14;
  const attn = !files.bugs?.present || (bugs > 0 && stale) || miss > 1;
  return { bugs, mtime, miss, stale, attn };
}

// ---------- rendering ----------
function statusHtml(text){
  return `<span class="cp-status"><i class="ti ti-sparkles"></i><span class="cp-status-text">${esc(text || 'scanning…')}</span></span>`;
}

function rowHtml(p, scan, meta){
  const bugChip = meta.bugs > 0
    ? `<span class="cp-bugs${meta.stale ? ' attn' : ''}">🐛 ${meta.bugs}</span>`
    : `<span class="cp-bugs muted">🐛 —</span>`;
  const cc = commentCount(p.id);
  const commentChip = `<button class="cp-comments" data-comments="${p.id}" title="comments">💬${cc ? ' ' + cc : ''}</button>`;
  return `
    <div class="cp-row${galleryMode ? ' card' : ''}" data-id="${p.id}" role="button" tabindex="0">
      <button class="cp-emoji" data-emoji="${p.id}" title="emoji">${emojiHTML(p.emoji)}</button>
      <div class="cp-namecol">
        <div class="cp-name">${esc(p.name || p.path)}${meta.attn ? '<span class="cp-attn" title="needs attention">•</span>' : ''}</div>
        <div class="cp-path">${esc(p.path)}</div>
      </div>
      ${statusHtml(scan && scan.ok ? '' : (scan ? 'scan failed' : 'scanning…'))}
      <div class="cp-meta-right">
        ${bugChip}
        <span class="cp-updated">${relTime(meta.mtime)}</span>
        ${commentChip}
      </div>
    </div>`;
}

function emptyHtml(){
  return `
    <div class="cp-empty">
      <i class="ti ti-folder-code" aria-hidden="true"></i>
      <div class="cp-empty-line">nothing here yet — add a folder to start, or point notlinear at one root folder and all your projects show up.</div>
      <div class="cp-empty-cta">
        <button class="cp-btn primary" id="cp-empty-add">add folder</button>
        <button class="cp-btn ghost" id="cp-empty-root" disabled title="coming later">set root</button>
      </div>
    </div>`;
}

function headerHtml(){
  return `
    <div class="cp-head">
      <h1 class="cp-title">coding projects</h1>
      <div class="cp-head-actions">
        <button class="cp-btn ghost" id="cp-view-toggle" title="list / gallery"><i class="ti ti-${galleryMode ? 'list' : 'layout-grid'}"></i></button>
        <button class="cp-btn ghost" id="cp-rescan" title="rescan"><i class="ti ti-refresh"></i></button>
        <button class="cp-btn primary" id="cp-add">+ add folder</button>
      </div>
    </div>`;
}

async function fillStatus(p, scan){
  const row = $(`.cp-row[data-id="${p.id}"] .cp-status-text`);
  if (!row || !scan?.ok) { if (row) row.textContent = 'scan failed'; return; }
  const mtime = maxMtime(scan.files);
  let text = statusCacheGet(p.path, mtime);
  if (!text){
    text = await llmStatus(scan);
    if (text) statusCacheSet(p.path, mtime, text);
    else text = heuristicStatus(scan);
  }
  const live = $(`.cp-row[data-id="${p.id}"] .cp-status-text`);
  if (live) live.textContent = text;
}

async function render(){
  const inner = $('#cp-inner');
  if (!inner) return;
  const projects = loadProjects();

  if (!projects.length){
    inner.innerHTML = headerHtml() + emptyHtml();
    wireListEvents();
    return;
  }

  const grid = galleryMode ? 'cp-grid' : 'cp-list';
  inner.innerHTML = headerHtml() + `<div class="${grid}" id="cp-projects">` +
    projects.map(p => rowHtml(p, scanCache.get(p.id), deriveMeta(scanCache.get(p.id) || { files: {} }))).join('') +
    `</div>`;
  wireListEvents();

  // Scan (or reuse cached scan) then refine each row in place.
  for (const p of projects){
    let scan = scanCache.get(p.id);
    if (!scan){
      try { scan = await scanProject(p.path); } catch { scan = { ok: false }; }
      scanCache.set(p.id, scan);
      refineRow(p, scan);
    }
    fillStatus(p, scan);
  }
}

function refineRow(p, scan){
  const rowEl = $(`.cp-row[data-id="${p.id}"]`);
  if (!rowEl) return;
  const meta = deriveMeta(scan && scan.ok ? scan : { files: {} });
  rowEl.outerHTML = rowHtml(p, scan, meta);
  wireRow($(`.cp-row[data-id="${p.id}"]`));
}

// ---------- events ----------
function updateProject(id, patch){
  const list = loadProjects();
  const p = list.find(x => x.id === id);
  if (!p) return;
  Object.assign(p, patch);
  saveProjects(list);
}

function setCrumb(){
  const crumb = $('.cp-crumb');
  if (!crumb) return;
  if (currentProjectId){
    const p = loadProjects().find(x => x.id === currentProjectId);
    crumb.innerHTML =
      `<i class="ti ti-folder-code"></i><span class="cp-crumb-link" id="cp-crumb-home">coding projects</span>` +
      `<span class="sep">/</span><span class="cp-crumb-here">${esc(p?.name || 'project')}</span>`;
    $('#cp-crumb-home')?.addEventListener('click', showList);
  } else {
    crumb.innerHTML = `<i class="ti ti-folder-code"></i><span class="cp-crumb-here" id="cp-crumb">coding projects</span>`;
  }
}

function showList(){
  currentProjectId = null;
  setCrumb();
  render();
}

function openProject(id){
  currentProjectId = id;
  setCrumb();
  renderProjectPage(id);
}

// ---------- project page (CP04) ----------
function docsPresentCount(files){
  return ['readme', 'changelog', 'bugs', 'tasks'].filter(k => files?.[k]?.present).length;
}

function formatSize(bytes){
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n}b`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}kb`;
  return `${(n / (1024 * 1024)).toFixed(1)}mb`;
}

function markdownFilesForScan(scan, files){
  const scanned = Array.isArray(scan?.markdownFiles) ? scan.markdownFiles : [];
  if (scanned.length) return scanned;
  // Backward-compatible fallback for a stale server that predates markdownFiles.
  return ['readme', 'changelog', 'bugs', 'tasks']
    .map(k => files?.[k]?.present ? { ...files[k], relativePath: files[k].filename || `${k}.md` } : null)
    .filter(Boolean);
}

function markdownFileCellHtml(file, index){
  const rel = file.relativePath || file.filename || 'untitled.md';
  const size = file.tooBig ? 'too large' : formatSize(file.size);
  return `<button class="cp-file-cell" data-file="md:${index}" title="${esc(rel)}"><i class="ti ti-file-text"></i><span class="cp-file-name">${esc(rel)}</span><span class="cp-file-size">${esc(size)}</span></button>`;
}

function markdownFilesHtml(filesList, truncated){
  if (!filesList.length){
    return `<div class="cp-file-empty"><i class="ti ti-file-off"></i><span>no markdown files found</span></div>`;
  }
  const cells = filesList.map(markdownFileCellHtml).join('');
  const note = truncated
    ? `<div class="cp-file-note">showing first 200 markdown files</div>`
    : '';
  return cells + note;
}

function renderProjectPage(id){
  const inner = $('#cp-inner');
  const p = loadProjects().find(x => x.id === id);
  if (!inner || !p) { showList(); return; }
  const scan = scanCache.get(id);
  const files = (scan && scan.ok && scan.files) || {};
  const meta = deriveMeta(scan && scan.ok ? scan : { files: {} });
  const markdownFiles = markdownFilesForScan(scan, files);

  const metaStrip = `${markdownFiles.length} md files · ${docsPresentCount(files)}/4 convention docs · ${meta.bugs} open bugs · updated ${relTime(meta.mtime)} · manual`;

  inner.innerHTML = `
    <div class="cp-page-head">
      <button class="cp-emoji lg" id="cp-page-emoji" title="emoji">${emojiHTML(p.emoji)}</button>
      <div class="cp-page-titlecol">
        <input class="cp-page-title" id="cp-page-title" value="${esc(p.name || '')}" placeholder="project name" />
        <div class="cp-page-path"><i class="ti ti-folder"></i>${esc(p.path)}</div>
      </div>
    </div>
    <div class="cp-meta-strip">${esc(metaStrip)}</div>

    <section class="cp-block">
      <div class="cp-block-head"><i class="ti ti-files"></i><span>files</span></div>
      <div class="cp-files-grid">
        ${markdownFilesHtml(markdownFiles, !!scan?.markdownFilesTruncated)}
      </div>
    </section>

    <section class="cp-block" id="cp-comments-block">
      <div class="cp-block-head"><i class="ti ti-message-dots"></i><span>notes &amp; comments</span><span class="cp-block-count" id="cp-comments-count">${commentCount(id)}</span></div>
      <div class="cp-composer page">
        <textarea class="cp-composer-input" id="cp-page-comment" rows="1" placeholder="add a note about this project…"></textarea>
        <button class="cp-composer-send" id="cp-page-comment-send" title="send (⌘↵)"><i class="ti ti-arrow-up"></i></button>
      </div>
      <div class="cp-pop-list page" id="cp-page-comments"></div>
    </section>`;

  wireProjectPage(id, scan);

  // If we opened before the scan finished, fetch then re-render this page.
  if (!scan){
    scanProject(p.path).then(s => { scanCache.set(id, s); }).catch(() => scanCache.set(id, { ok: false }))
      .then(() => { if (currentProjectId === id) renderProjectPage(id); });
  }
}

function wireProjectPage(id, scan){
  const titleEl = $('#cp-page-title');
  const persist = () => {
    const v = titleEl.value.trim();
    if (v) { updateProject(id, { name: v }); renderSidebarList(); toast('renamed'); }
  };
  titleEl?.addEventListener('blur', persist);
  titleEl?.addEventListener('keydown', (e) => { if (e.key === 'Enter'){ e.preventDefault(); titleEl.blur(); } });

  $('#cp-page-emoji')?.addEventListener('click', (e) =>
    pickEmojiFor(id, e.currentTarget, () => { const el = $('#cp-page-emoji'); if (el) el.innerHTML = emojiHTML(loadProjects().find(x => x.id === id)?.emoji); }));
  document.querySelectorAll('#cp-inner .cp-file-cell[data-file]').forEach(cell => {
    cell.addEventListener('click', () => openDrawer(id, cell.dataset.file));
  });

  // Comments thread (newest → oldest on the page).
  const listEl = $('#cp-page-comments');
  if (listEl){
    const refresh = () => renderCommentList(listEl, id, 'desc', 'no notes yet — capture a thought, a TODO, anything.');
    refresh();
    wireComposer($('#cp-page-comment'), $('#cp-page-comment-send'), id, refresh);
  }
}

// Open the native macOS folder picker and resolve to the chosen path (or null).
async function pickFolderPath(){
  let res;
  try {
    res = await fetch('/__notlinear_pick_folder', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  } catch { toast('folder picker needs the local server (run backend/server.py)'); return null; }
  if (res.status === 404 || res.status === 501){ toast('restart the server — folder picker endpoint missing'); return null; }
  let data; try { data = await res.json(); } catch { data = null; }
  if (data?.cancelled) return null;
  if (!data || !data.ok){ toast(data?.error ? `picker error: ${data.error}` : 'could not pick folder'); return null; }
  return data.path || null;
}

function wireRow(rowEl){
  if (!rowEl) return;
  rowEl.addEventListener('click', (e) => {
    const emojiBtn = e.target.closest('.cp-emoji');
    if (emojiBtn){ e.stopPropagation(); pickEmojiFor(rowEl.dataset.id, emojiBtn, () => refineRow(loadProjects().find(x => x.id === rowEl.dataset.id), scanCache.get(rowEl.dataset.id))); return; }
    const cBtn = e.target.closest('.cp-comments');
    if (cBtn){ e.stopPropagation(); openCommentsPopover(rowEl.dataset.id, cBtn); return; }
    openProject(rowEl.dataset.id);
  });
  rowEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); openProject(rowEl.dataset.id); }
  });
}

function wireListEvents(){
  $('#cp-add')?.addEventListener('click', (e) => openAddPopover(e.currentTarget));
  $('#cp-empty-add')?.addEventListener('click', (e) => openAddPopover(e.currentTarget));
  $('#cp-rescan')?.addEventListener('click', () => { scanCache = new Map(); render(); });
  $('#cp-view-toggle')?.addEventListener('click', () => { galleryMode = !galleryMode; render(); });
  document.querySelectorAll('#cp-inner .cp-row').forEach(wireRow);
}

// ---------- floating popovers (comments / emoji / add) ----------
let activePopover = null;
let popoverOutside = null;

function closeFloater(){
  if (!activePopover) return;
  activePopover.remove();
  activePopover = null;
  if (popoverOutside){ document.removeEventListener('mousedown', popoverOutside); popoverOutside = null; }
}
// Backward-compatible alias used by navBack and comment-button handlers.
const closeCommentsPopover = closeFloater;

// Position `pop` under `anchorEl`, clamp to viewport, register as the active
// floater, and close it on outside click. width/height are layout hints.
function attachFloater(pop, anchorEl, width, height){
  document.body.appendChild(pop);
  const r = anchorEl.getBoundingClientRect();
  pop.style.width = width + 'px';
  pop.style.top = Math.min(r.bottom + 6, window.innerHeight - (height || 360) - 8) + 'px';
  pop.style.left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8)) + 'px';
  activePopover = pop;
  popoverOutside = (e) => {
    if (e.target.closest('.cp-pop') || anchorEl.contains(e.target) || e.target === anchorEl) return;
    closeFloater();
  };
  setTimeout(() => document.addEventListener('mousedown', popoverOutside), 0);
}

function openCommentsPopover(projectId, anchorEl){
  closeFloater();
  const p = loadProjects().find(x => x.id === projectId);
  if (!p) return;
  const pop = document.createElement('div');
  pop.className = 'cp-pop';
  pop.innerHTML = `
    <div class="cp-pop-head"><span class="cp-pop-emoji">${emojiHTML(p.emoji)}</span><span class="cp-pop-name">${esc(p.name || p.path)}</span><span class="cp-pop-count" id="cp-pop-count">${commentCount(projectId)}</span></div>
    <div class="cp-pop-list" id="cp-pop-list"></div>
    <div class="cp-composer">
      <textarea class="cp-composer-input" id="cp-pop-input" rows="1" placeholder="add a comment…"></textarea>
      <button class="cp-composer-send" id="cp-pop-send" title="send (⌘↵)"><i class="ti ti-arrow-up"></i></button>
    </div>`;
  attachFloater(pop, anchorEl, 320, 340);
  const listEl = pop.querySelector('#cp-pop-list');
  const refresh = () => {
    renderCommentList(listEl, projectId, 'asc', 'nothing here yet — write something.');
    pop.querySelector('#cp-pop-count').textContent = String(commentCount(projectId));
    listEl.scrollTop = listEl.scrollHeight;
  };
  refresh();
  wireComposer(pop.querySelector('#cp-pop-input'), pop.querySelector('#cp-pop-send'), projectId, refresh);
  pop.querySelector('#cp-pop-input').focus();
}

// ---------- emoji picker (CP07; shared picker lives in core/emoji.js) ----------
function pickEmojiFor(projectId, anchorEl, rerender){
  openEmojiPicker(anchorEl, (emoji) => {
    updateProject(projectId, { emoji });
    toast('icon updated');
    renderSidebarList();
    rerender();
  });
}

// ---------- add-project popover (CP07) ----------
function openAddPopover(anchorEl){
  closeFloater();
  const pop = document.createElement('div');
  pop.className = 'cp-pop cp-add-pop';
  pop.innerHTML = `
    <div class="cp-pop-head"><span class="cp-pop-name">add coding project</span></div>
    <div class="cp-add-body">
      <label class="cp-add-label">folder path</label>
      <div class="cp-add-pathrow">
        <input class="cp-add-input mono" id="cp-add-path" placeholder="~/code/my-project" autocomplete="off">
        <button class="cp-btn ghost" id="cp-add-browse" title="browse…"><i class="ti ti-folder-search"></i></button>
      </div>
      <label class="cp-add-label">display name <span class="cp-add-opt">optional</span></label>
      <input class="cp-add-input" id="cp-add-name" placeholder="defaults to folder name" autocomplete="off">
      <label class="cp-add-label">icon</label>
      <button class="cp-add-icon-btn" id="cp-add-icon-btn" type="button" title="pick an icon"><span class="cp-add-icon-glyph"><i class="ti ti-folder"></i></span><span class="cp-add-icon-label">pick icon</span></button>
    </div>
    <div class="cp-add-foot">
      <button class="cp-btn" id="cp-add-cancel">cancel</button>
      <button class="cp-btn primary" id="cp-add-submit" disabled>add project</button>
    </div>`;
  attachFloater(pop, anchorEl, 320, 360);

  const pathEl = pop.querySelector('#cp-add-path');
  const nameEl = pop.querySelector('#cp-add-name');
  const submit = pop.querySelector('#cp-add-submit');
  let chosenEmoji = '';   // empty until the user picks one; row renders the ti-folder fallback

  const syncEnabled = () => { submit.disabled = !pathEl.value.trim(); };
  pathEl.addEventListener('input', syncEnabled);

  const iconBtn = pop.querySelector('#cp-add-icon-btn');
  iconBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    openEmojiPicker(iconBtn, (token) => {
      chosenEmoji = token;
      const glyph = iconBtn.querySelector('.cp-add-icon-glyph');
      const label = iconBtn.querySelector('.cp-add-icon-label');
      if (glyph) glyph.innerHTML = emojiHTML(token);
      if (label) label.textContent = 'change icon';
      iconBtn.classList.add('on');
    });
  });

  pop.querySelector('#cp-add-browse').addEventListener('click', async () => {
    const path = await pickFolderPath();
    if (path){ pathEl.value = path; syncEnabled(); }
  });

  const doAdd = () => {
    const path = pathEl.value.trim();
    if (!path) return;
    const id = addProject(path, nameEl.value.trim(), chosenEmoji);
    const name = loadProjects().find(x => x.id === id)?.name;
    closeFloater();
    toast(`added ${name}`);
    renderSidebarList();
    render();
  };
  submit.addEventListener('click', doAdd);
  pop.querySelector('#cp-add-cancel').addEventListener('click', closeFloater);
  [pathEl, nameEl].forEach(el => el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && pathEl.value.trim()){ e.preventDefault(); doAdd(); }
  }));
  pathEl.focus();
}

// ---------- file preview drawer (CP05, read-only) ----------
let drawerFileKey = null;

function drawerOpen(){ return $('#cp-screen')?.classList.contains('drawer-open'); }

function openDrawer(projectId, fileKey){
  const p = loadProjects().find(x => x.id === projectId);
  const scan = scanCache.get(projectId);
  let f = null;
  if (fileKey?.startsWith('md:')){
    const markdownFiles = markdownFilesForScan(scan, (scan && scan.ok && scan.files) || {});
    const idx = Number(fileKey.slice(3));
    f = Number.isInteger(idx) ? markdownFiles[idx] : null;
  } else {
    f = scan?.files?.[fileKey];
  }
  if (!p || !f?.present) return;
  drawerFileKey = fileKey;
  const relPath = f.relativePath || f.filename || `${fileKey}.md`;
  const fullPath = `${p.path.replace(/\/+$/, '')}/${relPath}`;
  $('#cp-drawer-path').textContent = fullPath;
  $('#cp-drawer-size').textContent = f.tooBig ? 'too large' : formatSize(f.size);
  $('#cp-drawer-body').innerHTML = f.tooBig
    ? '<p>file too large to preview</p>'
    : renderMarkdown(f.text || '');
  $('#cp-drawer-body').scrollTop = 0;
  $('#cp-drawer-reveal').onclick = () => toast('reveal in finder — coming later');
  $('#cp-drawer').classList.add('show');
  $('#cp-drawer').setAttribute('aria-hidden', 'false');
  $('#cp-screen').classList.add('drawer-open');
}

function closeDrawer(){
  drawerFileKey = null;
  $('#cp-drawer')?.classList.remove('show');
  $('#cp-drawer')?.setAttribute('aria-hidden', 'true');
  $('#cp-screen')?.classList.remove('drawer-open');
}

// ---------- overlay + sidebar ----------
function showOverlay(){ $('#cp-screen')?.classList.add('show'); currentProjectId = null; setCrumb(); render(); }
function hideOverlay(){ $('#cp-screen')?.classList.remove('show'); }
function openList(){ mountView('coding-projects'); }
function backToChat(){ mountView('chat'); }
function navBack(){
  if (activePopover){ closeCommentsPopover(); return; }
  if (drawerOpen()){ closeDrawer(); return; }
  if (currentProjectId) showList(); else backToChat();
}

function readCollapse(){ return lsRead(SIDE_COLLAPSE_KEY, {}) || {}; }
function applyCollapse(){
  const list = $('#cp-side-list');
  const caret = $('#cp-side-head .cp-caret');
  if (!list) return;
  const collapsed = !!readCollapse().cp;
  list.classList.toggle('collapsed', collapsed);
  if (caret) caret.style.transform = collapsed ? 'rotate(-90deg)' : '';
}
function toggleCollapse(){
  const next = readCollapse(); next.cp = !next.cp; lsWrite(SIDE_COLLAPSE_KEY, next); applyCollapse();
}

function renderSidebarList(){
  const host = $('#cp-side-list');
  if (!host) return;
  const projects = loadProjects();
  host.innerHTML = projects.map(p =>
    `<button class="side-item cp-side-item" data-id="${p.id}"><span class="cp-side-emoji">${emojiHTML(p.emoji)}</span><span>${esc(p.name || p.path)}</span></button>`
  ).join('');
  host.querySelectorAll('.cp-side-item').forEach(btn => {
    btn.addEventListener('click', () => { mountView('coding-projects'); openProject(btn.dataset.id); });
  });
}

function wireSidebar(){
  const head = $('#cp-side-head');
  const addBtn = $('#cp-add-project');
  const caret = $('#cp-side-head .cp-caret');
  caret?.addEventListener('click', (e) => { e.stopPropagation(); toggleCollapse(); });
  head?.addEventListener('click', (e) => {
    if (e.target.closest('#cp-add-project') || e.target.closest('.cp-caret')) return;
    openList();
  });
  addBtn?.addEventListener('click', (e) => { e.stopPropagation(); openList(); setTimeout(() => openAddPopover($('#cp-add') || addBtn), 0); });
  applyCollapse();
  renderSidebarList();
  // Any rows with `"icon:..."` glyphs rendered with the 📁 fallback on first
  // paint; rerender once the Mind Garden SVGs are available.
  loadMindGarden().then(() => renderSidebarList()).catch(() => {});
}

export function initCodingProjects(){
  if (!$('#cp-screen')) return;
  $('#cp-back')?.addEventListener('click', navBack);
  $('#cp-drawer-close')?.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('#cp-screen')?.classList.contains('show')) navBack();
  });
  // Close the drawer when clicking outside it (but not when clicking a file cell,
  // which re-opens it). Only active while the overlay is showing.
  document.addEventListener('mousedown', (e) => {
    if (!drawerOpen()) return;
    if (e.target.closest('#cp-drawer') || e.target.closest('.cp-file-cell[data-file]')) return;
    closeDrawer();
  });
  registerView({
    id: 'coding-projects',
    label: 'Coding projects',
    icon: 'ti-folder-code',
    mount: showOverlay,
    unmount: hideOverlay,
  });
  wireSidebar();
}
