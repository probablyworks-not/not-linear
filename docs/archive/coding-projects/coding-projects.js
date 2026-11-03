// ============================================================================
// Coding Projects view — a Notion-style dashboard over local code projects.
//
// What it does: lists the user's local code projects and, for each one,
// reads the project's README/CHANGELOG/BUGS/TASKS files (via a backend
// filesystem scan) to show a what's-there / what's-missing checklist, a
// count of open bugs (unchecked `- [ ]` items in BUGS.md), a last-updated
// timestamp, and a short LLM-generated (or heuristic-fallback) status
// sentence. Clicking a project opens a per-project page; clicking a
// markdown file there opens a read-only preview drawer.
//
// It is strictly additive: it is a self-contained view that reads project
// docs off disk (through the backend's scan endpoint) and writes only to
// its own localStorage keys (see PROJECTS_KEY / STATUS_CACHE_KEY /
// COMMENTS_KEY / SIDE_COLLAPSE_KEY below). It never touches the chat
// database, threads, or branches.
//
// Self-registration: this module doesn't render anything until
// initCodingProjects() (exported at the bottom, called once at app startup)
// registers itself with the view registry (frontend/core/registry.js) via
// registerView({ id: 'coding-projects', mount: showOverlay, unmount:
// hideOverlay, ... }). The registry is the generic "one view visible at a
// time" host used by every feature (chat, notes, coding-projects, ...);
// mountView('coding-projects') / mountView('chat') is how this view and the
// chat view swap places without either one knowing about the other.
//
// Full-screen overlay (#cp-screen) shown via the view registry; chat sits
// underneath, untouched. CP02 built the seam; CP03 adds the real list view:
// a localStorage project registry, a filesystem scan per project (CP01
// endpoints), an LLM-generated status sentence (ADR-005) with heuristic
// fallback, plus gallery / empty states and a minimal add-folder flow.
//
// Backend calls (all via frontend/core/api-client.js's loggedFetch, per the
// "no direct fetch from a component" convention — see backend/server.py):
//   - POST /__notlinear_scan_project  — walks a project folder, reads its
//     README/CHANGELOG/BUGS/TASKS (and other markdown) files, and returns
//     their text/size/mtime. See scanProject() below.
//   - POST /__notlinear_pick_folder   — opens the native macOS folder
//     picker and returns the chosen path. See pickFolderPath() below.
// Markdown file previews reuse frontend/core/markdown.js's renderMarkdown()
// (also esc() for HTML-escaping user/file-derived strings throughout this
// file). Styling lives in frontend/styles/coding-projects.css (all `cp-*`
// classes referenced in the template strings below come from there).
// ============================================================================

import { registerView, mountView } from '../core/registry.js';
import { appState } from '../core/state.js';
import { loggedFetch, readResponseBody } from '../core/api-client.js';
import { esc, renderMarkdown, highlightCodeIn } from '../core/markdown.js';
import { toast, wireTabInsertsTab } from '../core/ui.js';
import { openEmojiPicker } from '../core/emoji.js';
import { loadMindGarden, renderIconSvg, parseIconToken } from '../core/mind-garden.js';

// Render a stored project glyph: an emoji char, a Mind Garden token
// (`"icon:<id>"` or `"icon:<id>:<hex>"`), or the Tabler-folder fallback.
// Used everywhere a project's icon is drawn: list rows, gallery cards,
// the project page header, the sidebar, and the add-folder popover.
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

// Scoped query-selector shorthand; `r` lets callers query within a popover
// or drawer root instead of always searching the whole document.
const $ = (s, r = document) => r.querySelector(s);

let currentProjectId = null;   // null = list view; otherwise the open project page

// localStorage keys. Everything this view persists lives under these four
// keys — intentionally NOT the chat/notes Dexie databases (see AGENTS.md /
// ADR-007-style separation: this feature must not touch chat state).
const SIDE_COLLAPSE_KEY = 'nl_cp_side_collapsed_v1';   // sidebar list collapsed/expanded
const PROJECTS_KEY = 'nl_cp_projects_v1';              // the project registry itself
const STATUS_CACHE_KEY = 'nl_cp_status_cache_v1';      // cached LLM status sentence per project path+mtime
const COMMENTS_KEY = 'nl_cp_comments_v1';              // per-project notes/comments

let galleryMode = false;       // session-sticky list/gallery toggle
let scanCache = new Map();     // projectId -> scan result (this session)

// ---------- small utils ----------
// JSON localStorage read/write helpers. Swallow parse/quota errors so a
// corrupted or missing key degrades to `fallback` instead of throwing and
// breaking the whole view.
function lsRead(key, fallback){
  try { return JSON.parse(localStorage.getItem(key) || '') ?? fallback; }
  catch { return fallback; }
}
function lsWrite(key, val){
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}
// Format a timestamp (ms) as a short relative-time string ("3m ago", "2d
// ago", ...) for row/comment/status "last updated" displays.
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
// Used by deriveMeta() to decide whether a project's docs are "stale"
// (no changes in the last 14 days) for the attention-needed indicator.
function daysSince(ms){ return ms ? (Date.now() - ms) / 86400000 : Infinity; }

// ---------- registry ----------
// The project registry: the list of { id, path, name, emoji } entries the
// user has added. This is the source of truth for "what projects exist" —
// separate from scanCache, which holds the (re-fetchable) filesystem scan
// results keyed by the same project id.
function loadProjects(){ const v = lsRead(PROJECTS_KEY, []); return Array.isArray(v) ? v : []; }
function saveProjects(list){ lsWrite(PROJECTS_KEY, list); }
function commentCount(id){ return loadComments(id).length; }
function loadComments(id){ const all = lsRead(COMMENTS_KEY, {}) || {}; return Array.isArray(all[id]) ? all[id] : []; }
function saveComments(id, arr){ const all = lsRead(COMMENTS_KEY, {}) || {}; all[id] = arr; lsWrite(COMMENTS_KEY, all); }
// Append a comment/note to a project's thread. Comments are local-only
// annotations the user writes about a project (not derived from its files).
function addComment(id, text){
  const who = appState?.prefs?.name || 'You';
  const c = { id: 'c' + Date.now(), who, avatar: (who.trim()[0] || '?').toUpperCase(), text, t: Date.now() };
  const arr = loadComments(id); arr.push(c); saveComments(id, arr); return c;
}
function deleteComment(id, cid){ saveComments(id, loadComments(id).filter(c => c.id !== cid)); }

// ---------- comments rendering (CP06) ----------
// HTML for a single comment/note row (avatar initial, author, relative
// time, a delete button, and the escaped comment body). Shared by both the
// list-row popover thread and the project-page thread.
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

// Add a new project to the registry from the add-folder popover. Derives a
// default display name from the last path segment when the user leaves the
// name field blank (e.g. "/code/my-app/" -> "my-app").
function addProject(path, name, emoji){
  const list = loadProjects();
  const id = 'cp' + Date.now().toString(36);
  const seg = String(path).replace(/\/+$/, '').split('/').pop() || path;
  list.unshift({ id, path, emoji: emoji || '📁', name: name || seg });
  saveProjects(list);
  return id;
}


// ---------- scan ----------
// Ask the backend to scan a project folder on disk: it looks for
// README/CHANGELOG/BUGS/TASKS (and other markdown files) and returns their
// text/size/mtime. Goes through loggedFetch/readResponseBody from
// frontend/core/api-client.js (never a bare fetch) so the call is logged
// and its response parsed consistently with the rest of the app.
async function scanProject(path){
  const res = await loggedFetch('/__notlinear_scan_project', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ path }),
  }, { kind: 'cp_scan' });
  return await readResponseBody(res, { kind: 'json', label: 'cp_scan' });
}

// Count unchecked GitHub-style checkboxes (`- [ ]`) in a markdown file's text.
// Regex breakdown: `^[ \t>]*` allows leading whitespace/blockquote markers,
// `[-*+]\s+` matches any markdown bullet style, `\[ \]` is the literal
// unchecked-box token (a checked box `[x]` deliberately does not match).
// Used against BUGS.md text to derive the "open bugs" count for a project.
function countOpen(text){
  if (!text) return 0;
  const m = text.match(/^[ \t>]*[-*+]\s+\[ \]/gm);
  return m ? m.length : 0;
}
// Latest mtime across the four convention docs (readme/changelog/bugs/tasks)
// returned by the scan, used as the project's "last updated" timestamp.
function maxMtime(files){
  return Object.values(files || {}).reduce((mx, f) => Math.max(mx, (f && f.mtime) || 0), 0);
}
// Same idea but over the full markdownFiles list (any .md in the project),
// so "last updated" also reflects edits to docs outside the four conventions.
function maxMarkdownMtime(markdownFiles){
  return (Array.isArray(markdownFiles) ? markdownFiles : [])
    .reduce((mx, f) => Math.max(mx, (f && f.mtime) || 0), 0);
}
// How many of the four convention docs (readme/changelog/bugs/tasks) are
// absent from the scan — drives the "needs attention" heuristic below.
function missingCount(files){
  return ['readme', 'changelog', 'bugs', 'tasks'].filter(k => !(files?.[k]?.present)).length;
}

// ---------- status sentence (ADR-005) ----------
// Cache keyed by (path, mtime) so the (costly, LLM-backed) status sentence
// is only regenerated when the project's docs have actually changed since
// the last scan — a cache hit returns instantly with no network call.
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
// Builds the same "last shipped · next up" shape as the LLM version, but by
// simple string parsing instead of a model call.
function heuristicStatus(scan){
  const files = scan.files || {};
  if (!files.readme?.present && !files.changelog?.present && !files.tasks?.present){
    return 'no docs yet · drop a readme to get started';
  }
  const parts = [];
  const cl = files.changelog?.text || '';
  // First non-empty, non-heading, non-rule line of CHANGELOG.md is treated
  // as "what was last shipped" (skips markdown `#` headings and `---`/`===`
  // horizontal-rule lines so the sentence doesn't start with formatting noise).
  const firstCl = cl.split('\n').map(l => l.trim())
    .find(l => l && !/^#{1,6}\s*$/.test(l) && !/^[-=]{3,}$/.test(l));
  if (firstCl) parts.push(firstCl.replace(/^#{1,6}\s*/, '').slice(0, 80));
  const tasks = files.tasks?.text || '';
  // First unchecked `- [ ]` line in TASKS.md is treated as "what's next".
  const firstOpen = tasks.split('\n').map(l => l.trim())
    .find(l => /^[-*+]\s+\[ \]/.test(l));
  if (firstOpen) parts.push('next: ' + firstOpen.replace(/^[-*+]\s+\[ \]\s*/, '').slice(0, 70));
  return parts.join(' · ') || 'no changelog or tasks yet';
}

// Ask DeepSeek (an OpenAI-compatible chat completion endpoint, separate
// from the Anthropic/Claude chat path used elsewhere in the app) to write a
// one-line status sentence from the project's CHANGELOG + TASKS text.
// Returns null (falling back to heuristicStatus) when there's no API key,
// the request fails, or the response is empty — this must never block or
// error out the project list.
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
// `attn` (needs-attention) is true when: there's no BUGS.md at all, or
// there are open bugs and the docs are stale (>14 days untouched), or more
// than one of the four convention docs is missing. Drives the small dot
// next to a project's name in rowHtml().
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
// The sparkle-icon status line shown in each row; `text` is either the
// heuristic/LLM status sentence or a placeholder ("scanning…"/"scan failed").
function statusHtml(text){
  return `<span class="cp-status"><i class="ti ti-sparkles"></i><span class="cp-status-text">${esc(text || 'scanning…')}</span></span>`;
}

// Build one project row (list mode) or card (gallery mode via the `card`
// class) — icon, name + attention dot + path, status sentence, bug count
// chip, last-updated time, and the comment-count button. `scan` may be
// undefined (not yet fetched) or `{ ok: false }` (fetch failed); rowHtml
// degrades gracefully in both cases via statusHtml's fallback text.
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

// Zero-state shown when the project registry is empty (per CLAUDE.md's
// "empty states matter" — invites adding a folder instead of showing a
// bare list). "set root" (batch-import a folder of projects) is stubbed
// disabled for a later version.
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

// Top bar for the list view: title, list/gallery toggle, rescan, and add.
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

// Populate a row's status text in place, after the row's initial paint:
// try the mtime-keyed cache, then the LLM (llmStatus), then fall back to
// the heuristic. Runs per-row/async so slow or missing LLM calls don't
// block the rest of the list from appearing.
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
  // Re-query rather than reuse `row`: the row may have been replaced
  // (outerHTML swap in refineRow) by the time this async work resolves.
  const live = $(`.cp-row[data-id="${p.id}"] .cp-status-text`);
  if (live) live.textContent = text;
}

// Main list-view render: paints the header + all rows immediately using
// whatever's in scanCache (so the list appears instantly even before any
// scan completes), wires up click handlers, then scans each project that
// isn't cached yet and refines its row/status in place as results land.
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

// Replace one row's DOM with a freshly rendered version once its scan
// result is known, and re-wire its event listeners (outerHTML replacement
// drops the old element and its listeners entirely).
function refineRow(p, scan){
  const rowEl = $(`.cp-row[data-id="${p.id}"]`);
  if (!rowEl) return;
  const meta = deriveMeta(scan && scan.ok ? scan : { files: {} });
  rowEl.outerHTML = rowHtml(p, scan, meta);
  wireRow($(`.cp-row[data-id="${p.id}"]`));
}

// ---------- events ----------
// Merge `patch` into a project's registry entry (e.g. rename, change emoji)
// and persist. Used by the title/emoji editors on the project page and row.
function updateProject(id, patch){
  const list = loadProjects();
  const p = list.find(x => x.id === id);
  if (!p) return;
  Object.assign(p, patch);
  saveProjects(list);
}

// Render the breadcrumb: "coding projects" alone at the list view, or
// "coding projects / <project name>" (with the first segment clickable to
// go back to the list) when a project page is open.
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

// Navigate back to the list view.
function showList(){
  currentProjectId = null;
  setCrumb();
  render();
}

// Navigate to a project's detail page.
function openProject(id){
  currentProjectId = id;
  setCrumb();
  renderProjectPage(id);
}

// ---------- project page (CP04) ----------
// How many of the four convention docs are present — the "x/4 convention
// docs" figure in the project page's meta strip (inverse of missingCount).
function docsPresentCount(files){
  return ['readme', 'changelog', 'bugs', 'tasks'].filter(k => files?.[k]?.present).length;
}

// Human-readable file size (bytes/kb/mb) for the file-cell size labels.
function formatSize(bytes){
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return '—';
  if (n < 1024) return `${n}b`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}kb`;
  return `${(n / (1024 * 1024)).toFixed(1)}mb`;
}

// The list of markdown files to show in the project page's file grid.
// Prefers the scan's full markdownFiles list (every .md found in the
// project); falls back to synthesizing entries from just the four
// convention docs for a stale/older backend that predates markdownFiles.
function markdownFilesForScan(scan, files){
  const scanned = Array.isArray(scan?.markdownFiles) ? scan.markdownFiles : [];
  if (scanned.length) return scanned;
  // Backward-compatible fallback for a stale server that predates markdownFiles.
  return ['readme', 'changelog', 'bugs', 'tasks']
    .map(k => files?.[k]?.present ? { ...files[k], relativePath: files[k].filename || `${k}.md` } : null)
    .filter(Boolean);
}

// One clickable file cell in the project page's file grid; data-file="md:N"
// (N = index into the markdownFiles array) is read back by openDrawer()'s
// click handler in wireProjectPage() to identify which file to preview.
function markdownFileCellHtml(file, index){
  const rel = file.relativePath || file.filename || 'untitled.md';
  const size = file.tooBig ? 'too large' : formatSize(file.size);
  return `<button class="cp-file-cell" data-file="md:${index}" title="${esc(rel)}"><i class="ti ti-file-text"></i><span class="cp-file-name">${esc(rel)}</span><span class="cp-file-size">${esc(size)}</span></button>`;
}

// The file grid's contents: empty state, or the file cells plus a note when
// the backend truncated the list (scan caps at 200 markdown files).
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

// Render a single project's detail page: header (icon + editable name +
// path), a meta strip summarizing doc coverage/bugs/last-updated, a grid of
// clickable markdown files (opens the read-only preview drawer), and the
// notes/comments thread. If the project hasn't been scanned yet, kicks off
// scanProject() and re-renders this page once it resolves (see the `if
// (!scan)` block below) so opening a project page always eventually shows
// real data even without waiting on the list view's background scan loop.
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

// Wire up the project page's interactive bits: rename-on-blur/Enter for the
// title input, the emoji picker button, click-to-open-file for each markdown
// file cell (routes to openDrawer, the read-only preview), and the notes
// thread composer.
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
// Note this is a bare fetch (not loggedFetch) since it's a lightweight,
// non-scan/non-LLM local IPC call to the backend's folder-picker endpoint;
// every failure mode (server not running, endpoint missing, user cancelled,
// picker error) is turned into a calm toast rather than a thrown error.
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

// Wire one list/gallery row's click and keyboard behavior: clicking the
// emoji or comments sub-controls stops propagation and opens their own
// popover instead of navigating; clicking (or Enter/Space on) the row
// itself opens the project page.
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

// Wire the list view's header buttons (add folder, rescan, list/gallery
// toggle) plus every currently-rendered row. Called after every render()
// of the list, since render() replaces #cp-inner's innerHTML wholesale.
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

// Close and remove the currently open floating popover (comments/emoji/add),
// if any, and tear down its outside-click listener.
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

// Open the comments popover anchored under a row's comment-count button:
// header with the project's icon/name/count, the comment thread (oldest
// first, since this is a compact live popover rather than a full page),
// and a composer to add a new one.
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
// Open the shared emoji/icon picker (frontend/core/emoji.js) anchored to
// `anchorEl`, persist the chosen glyph onto the project, and let the caller
// decide how to redraw (`rerender`) since this is called both from list
// rows and the project page header, which render differently.
function pickEmojiFor(projectId, anchorEl, rerender){
  openEmojiPicker(anchorEl, (emoji) => {
    updateProject(projectId, { emoji });
    toast('icon updated');
    renderSidebarList();
    rerender();
  });
}

// ---------- add-project popover (CP07) ----------
// Build and wire the "add coding project" popover: a folder path field
// (typed or picked via the native picker), an optional display name, and
// an icon picker. Submitting calls addProject() and refreshes both the
// sidebar and the list view.
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
let drawerFileKey = null;   // which file is currently shown, so re-clicking the same cell is a no-op-safe reopen

function drawerOpen(){ return $('#cp-screen')?.classList.contains('drawer-open'); }

// Open the read-only markdown preview drawer for a file cell click.
// `fileKey` is either "md:<index>" (an index into the scan's markdownFiles
// array, from markdownFileCellHtml's data-file attribute) or one of the
// four convention-doc keys (readme/changelog/bugs/tasks) for older
// call sites. Renders the file's markdown via core/markdown.js's
// renderMarkdown — this is a preview only; there is no edit/write path.
// "Open in Finder" is stubbed for later (see the reveal button below).
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
  highlightCodeIn($('#cp-drawer-body'));
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
// mount/unmount pair registered with the view registry below: showing the
// overlay always resets to the list view (never reopens onto a stale
// project page) and re-renders fresh.
function showOverlay(){ $('#cp-screen')?.classList.add('show'); currentProjectId = null; setCrumb(); render(); }
function hideOverlay(){ $('#cp-screen')?.classList.remove('show'); }
// Switch the whole app to this view via the shared registry (used by the
// sidebar's "coding projects" header and its add-project shortcut).
function openList(){ mountView('coding-projects'); }
// Hand control back to the chat view via the shared registry.
function backToChat(){ mountView('chat'); }
// Back/escape handling with a priority order: close an open popover first,
// then an open file drawer, then step up from a project page to the list,
// and only then leave the feature entirely back to chat.
function navBack(){
  if (activePopover){ closeCommentsPopover(); return; }
  if (drawerOpen()){ closeDrawer(); return; }
  if (currentProjectId) showList(); else backToChat();
}

function readCollapse(){ return lsRead(SIDE_COLLAPSE_KEY, {}) || {}; }
// Apply the persisted collapsed/expanded state to the sidebar's project
// list section (toggling a class and rotating the disclosure caret).
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

// Render the app-wide sidebar's list of coding projects (a persistent
// shortcut list living outside #cp-screen, alongside the sidebar's other
// features) so a project can be jumped to without first opening this view's
// own list page.
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

// Wire the sidebar's coding-projects section: the collapse caret, clicking
// the header to open this view's list page, and the header's own
// add-project shortcut (opens the list then immediately opens the
// add-folder popover, via a setTimeout so the list has finished rendering
// #cp-add first).
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

// Entry point, called once at app startup (see the file-level comment
// above). Bails out if the overlay's static markup (#cp-screen) isn't in
// the page yet — this feature's DOM shell must already exist in
// index.html/similar for it to attach to. Wires the overlay's own chrome
// (back button, drawer close, escape key, click-outside-drawer), then
// registers this view with the shared registry (frontend/core/registry.js)
// so mountView('coding-projects') can activate it, and finally wires the
// persistent sidebar shortcut.
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
