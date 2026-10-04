/* Notes — Notion-style notebook view (per the original notes_product.md PRD,
   which is no longer in the repo; see FEATURES.md → Notes. Implemented
   against the design-bundle reference notes-editor.js + Notes.html).

   WHAT THIS FEATURE IS (see FEATURES.md / AGENTS.md "FEATURE — Notes"):
   A personal notebook, entered from a top-level sidebar section, that opens
   a full-screen overlay page editor. Pages are made of typed "blocks"
   (text/headings/lists/todo/toggle/quote/callout/divider/code/equation/
   image/table/columns/page-link, plus media/file/bookmark/embed) that the
   user assembles with a "/" slash menu, and can format inline text with a
   floating selection toolbar. This view is registered with the rest of the
   app's view system (core/registry.js, view id 'notes') and is strictly
   ADDITIVE — it must never change chat/threads/branches.

   DOM STRUCTURE this module drives (declared in frontend/index.html, styled
   in frontend/styles/notes.css scoped under .nt-screen):
   - #nt-side-head / #nt-side-tree — the persistent sidebar section (page
     tree, add/duplicate/delete affordances) that lives outside the overlay
     so users see their notes without opening Notes.
   - #nt-screen — the full-screen overlay that hosts the page editor itself
     (crumbs, page title/tags/cover, the block list).
   - #nt-slash — the "/" slash-command menu for inserting/turning blocks.
   - #nt-mention — the "@" mention menu for inline note/chat references.
   - #nt-ftoolbar — the floating format toolbar shown on text selection.
   - #nt-branch-stack / #nt-branch-menu — floating "ask AI" branch panels
     anchored to note text (see "note branches" section below).
   - an emoji/icon popover (core/emoji.js) for page icons and callout emoji.
   All of the above use an `nt-*` id/class prefix specifically so they can
   never collide with the main chat shell's ids/classes.

   PERSISTENCE (ADR-007 — deliberate, not accidental):
   Notes is intentionally NOT stored in the main chat `notlinear` Dexie db
   (frontend/core/store.js). It opens its own separate Dexie database,
   `notlinear-notes`, with a single `kv` key/value store (see the
   "persistence" section below). This keeps Notes' schema fully decoupled
   from chat/threads/projects so it can evolve (or be removed) without ever
   touching the chat schema, and vice versa. Do NOT fold Notes into the
   `notlinear` db or bump its `db.version` for Notes' sake — see ADR-007 in
   docs/project-notes/DECISIONS.md.

   Differences from the PRD:
   - Persistence is Dexie (IndexedDB), not localStorage. We open a separate
     `notlinear-notes` db so the existing `notlinear` db schema is untouched.
     A one-time migration imports any pre-existing `nl_notes_v1` localStorage
     payload, then clears it.
   - Theme is owned by the rest of the app; no duplicated theme button here.
   - Toast comes from core/ui.js; emoji popover stays local because the
     PRD specifies the 8-col grid + random/remove affordance. */

// registerView/mountView wire this module into the shared view-switcher (the
// mechanism any view, chat included, uses to become the active full-screen
// surface); openChatTab/openNoteTab/refreshOpenTabs let Notes open/refresh
// tabs in the shared tab strip without reaching into chat's own state.
import { registerView, mountView, openChatTab, openNoteTab, refreshOpenTabs } from '../core/registry.js';
// Shared UI helpers used by chat too — toast (transient status message) and
// confirmDeleteItem (the shared "are you sure" dialog); wireTabInsertsTab
// makes Tab insert a literal tab character in the branch composer textareas
// instead of shifting focus.
import { toast, confirmDeleteItem, wireTabInsertsTab } from '../core/ui.js';
// Shared emoji/icon popover (page icons, callout icons) — kept in core so
// chat and Notes both get the same picker UI without duplicating it.
import { openEmojiPicker, closeEmojiPicker } from '../core/emoji.js';
// Mind Garden icon set — lets a page/callout icon be a themed SVG token
// ("icon:<id>[:<hex>]") instead of only a plain emoji glyph.
import { loadMindGarden, renderIconSvg, parseIconToken } from '../core/mind-garden.js';
// Shared Markdown-to-HTML renderer, used only for AI branch replies (note
// body text itself is NOT markdown-rendered — it's stored/edited as rich
// contentEditable HTML in `b.text`).
import { renderMarkdown, highlightCodeIn } from '../core/markdown.js';
// Shared fetch wrapper (adds logging/timeout) used for the link-preview
// (bookmark) backend call.
import { loggedFetch, readResponseBody } from '../core/api-client.js';
// Read-only access to chat's in-memory thread list, used only to populate
// the "@mention a chat" candidates — Notes never writes to appState/chat state.
import { appState } from '../core/state.js';
import { providerForModelPref, modelIdForModelPref, modeSystemPromptParts } from '../providers/tools.js';

// Render a Mind Garden icon token ("icon:<id>[:<hex>]"), a custom uploaded
// image token ("img:<dataURL>"), or a plain emoji glyph. Returns HTML —
// callers use innerHTML so the SVG/img renders.
function glyphHTML(value, fallback = '📄', size = 22){
  if (!value) return escapeHtml(fallback);
  if (typeof value === 'string' && value.startsWith('img:')){
    const r = Math.round(size * 0.22);
    return `<img class="nt-icon-img" src="${escapeHtml(value.slice(4))}" width="${size}" height="${size}" style="object-fit:cover;border-radius:${r}px;display:block" alt="">`;
  }
  const parsed = parseIconToken(value);
  if (parsed){
    const svg = renderIconSvg(parsed.id, { size, color: parsed.color });
    return svg || escapeHtml(fallback);
  }
  return escapeHtml(value);
}

// Tiny local DOM/format helpers — scoped to this module only (not shared
// with chat's own `$`/`$$` helpers in app.js, to keep the two views decoupled).
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const clamp = (n, min, max) => Math.min(Math.max(n, min), max);
const truncate = (s, n = 70) => (s || '').length > n ? (s || '').slice(0, n - 1).trim() + '…' : (s || '');

// ---------- persistence (Dexie, separate db so we don't touch chat schema) ----------
// ADR-007: Notes deliberately opens its OWN Dexie database (`notlinear-notes`)
// rather than sharing frontend/core/store.js's `notlinear` db used by chat.
// This is an intentional architectural boundary, not an oversight — it means
// Notes' schema can change freely without a chat db.version bump, and chat's
// persistence (a documented bug-cluster area) is never put at risk by Notes
// work. The db has a single `kv` store (key -> value blob), holding three
// top-level keys defined below rather than one row per note.
// eslint-disable-next-line no-undef
const db = new Dexie('notlinear-notes');
db.version(1).stores({ kv: 'key' });

const STORE_KEY = 'nl_notes_v1';    // the full notes array (every page + its blocks)
const SEL_KEY = 'nl_notes_selected_v1'; // last-open note id, restored on reload
const OPEN_KEY = 'nl_notes_open_v1';    // set of sidebar-tree ids currently expanded

let saveTimer = null;
// Debounced save (~180ms), matching the repo-wide pattern of "typed content
// is debounced, not written on every keystroke." Every block/title/tag edit
// calls save() (not writeState() directly) so rapid typing coalesces into a
// single Dexie write instead of one per keystroke.
function writeState(){
  return Promise.all([
    db.kv.put({ key: STORE_KEY, value: state.notes }),
    db.kv.put({ key: SEL_KEY, value: state.selectedId }),
    db.kv.put({ key: OPEN_KEY, value: [...state.openIds] }),
  ]);
}
function save(){
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    writeState().catch(e => console.warn('notes save:', e.message));
  }, 180);
}
// Bumps the currently open note's updatedAt — call before save() at any
// genuine content-edit site (all editing UI only ever acts on the open note).
function touchSelected(){
  const n = getNote(state.selectedId);
  if (n) n.updatedAt = Date.now();
}
// Bypasses the debounce for save sites that need the write to land
// immediately (e.g. deletion) rather than possibly being lost to a page
// unload before the 180ms timer fires.
async function saveNow(){
  if (saveTimer){
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  try {
    await writeState();
  } catch (e){
    console.warn('notes save:', e.message);
  }
}

// ---------- state ----------
function uid(p='b'){ return p + '_' + Math.random().toString(36).slice(2,9); }
function escapeHtml(s){ return (s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// Single in-memory source of truth for the whole feature — notes (pages +
// their block trees), which note/tab is open, which sidebar rows are
// expanded, and whether the index (overview) is showing instead of a page.
// Mutated directly by the functions below, then persisted via save()/saveNow().
const state = {
  notes: [],
  selectedId: null,
  openIds: new Set(),
  loaded: false,
  showIndex: false,
};

// Reads the three kv keys from the notlinear-notes db into `state`, with a
// one-time fallback: if this is the very first load after the feature
// shipped (no `nl_notes_v1` row in Dexie yet), migrate any pre-existing
// localStorage payload from the original PRD-specified storage and clear it
// so the migration only ever runs once.
async function loadState(){
  try {
    const [rawNotes, rawSel, rawOpen] = await Promise.all([
      db.kv.get(STORE_KEY),
      db.kv.get(SEL_KEY),
      db.kv.get(OPEN_KEY),
    ]);
    if (rawNotes && Array.isArray(rawNotes.value)){
      state.notes = rawNotes.value;
    } else {
      // one-time migration from localStorage
      try {
        const ls = localStorage.getItem(STORE_KEY);
        if (ls){
          const parsed = JSON.parse(ls);
          if (Array.isArray(parsed)){
            state.notes = parsed;
            await db.kv.put({ key: STORE_KEY, value: state.notes });
            localStorage.removeItem(STORE_KEY);
          }
        }
      } catch {}
    }
    state.selectedId = (rawSel && typeof rawSel.value === 'string' && state.notes.find(n => n.id === rawSel.value)?.id) || state.notes[0]?.id || null;
    state.openIds = new Set(Array.isArray(rawOpen?.value) ? rawOpen.value.filter(id => state.notes.some(n => n.id === id)) : []);
  } catch (e){
    console.warn('notes load failed:', e.message);
    state.notes = [];
    state.selectedId = null;
    state.openIds = new Set();
  }
  state.loaded = true;
}

// ---------- tree helpers ----------
// Notes form two independent trees: the sidebar page tree (n.parent, walked
// by kidsOf/pathOf) and each page's own block tree (b.children/b.cols,
// walked by findBlock and friends below). Both are plain arrays of plain
// objects — there is no normalized/indexed store, so every lookup here is a
// linear scan; fine at notebook scale, not meant to scale to thousands of pages.
function getNote(id){ return state.notes.find(n => n.id === id); }
function kidsOf(pid){ return state.notes.filter(n => n.parent === pid); }
function pathOf(id){ const out = []; let cur = getNote(id); while (cur){ out.unshift(cur); cur = cur.parent ? getNote(cur.parent) : null; } return out; }
function noteTabId(id){ return 'note:' + id; }
// Recursively locates a block by id anywhere in a page's block tree —
// straight children, toggle/indent `.children`, or `.cols` (column) arrays —
// returning its containing list/index/path so callers can splice it in place.
function findBlock(blocks, id, path = []){
  for (let i = 0; i < blocks.length; i++){
    const b = blocks[i];
    if (b.id === id) return { block:b, list:blocks, index:i, path };
    if (b.children){ const r = findBlock(b.children, id, [...path, b.id]); if (r) return r; }
    if (b.cols){ for (let c = 0; c < b.cols.length; c++){ const r = findBlock(b.cols[c], id, [...path, b.id+':'+c]); if (r) return r; } }
  }
  return null;
}
function insertAfter(list, id, newBlock){
  const i = list.findIndex(b => b.id === id);
  list.splice(i + 1, 0, newBlock);
  return newBlock;
}
function removeBlock(list, id){
  const i = list.findIndex(b => b.id === id);
  if (i >= 0) list.splice(i, 1);
}
// Notion-style Tab/Shift+Tab: nest a block under its immediately preceding sibling
// (as that sibling's last child), or pop it back out to its grandparent's list.
// Reuses the same `children` array already used by toggle blocks — every block
// tree walk (findBlock/blocksToText/blocksToMarkdown/collectHeadings) already
// recurses into `.children` regardless of block type, so this needs no new storage.
function indentBlock(b, parentList){
  const i = parentList.findIndex(x => x.id === b.id);
  if (i <= 0) return false;
  const prev = parentList[i - 1];
  parentList.splice(i, 1);
  if (!prev.children) prev.children = [];
  prev.children.push(b);
  return true;
}
function outdentBlock(b, parentList, note){
  if (!note) return false;
  const found = findBlock(note.blocks, b.id);
  if (!found || !found.path.length) return false;
  const parentId = found.path[found.path.length - 1];
  if (parentId.includes(':')) return false; // inside a column — not a block-tree parent
  const parentFound = findBlock(note.blocks, parentId);
  if (!parentFound) return false;
  removeBlock(parentList, b.id);
  parentFound.list.splice(parentFound.index + 1, 0, b);
  return true;
}

// ---------- emoji popover — uses the shared Mind Garden icon picker ----------
// Anchored under the trigger; selecting an icon yields a token like
// `"icon:<id>"` which glyphHTML() resolves to inline SVG.
function openEmojiPop(target, anchor){
  openEmojiPicker(anchor, (value) => {
    if (target.kind === 'page'){
      const n = getNote(target.noteId);
      if (n){ n.emoji = value || '📄'; n.updatedAt = Date.now(); save(); renderSidebar(); renderPage(); refreshOpenTabs(); }
    } else if (target.kind === 'callout'){
      const n = getNote(state.selectedId);
      const found = n && findBlock(n.blocks, target.blockId);
      if (found){ found.block.emoji = value || '💡'; n.updatedAt = Date.now(); save(); renderPage(); }
    }
  });
}
function closeEmojiPop(){ closeEmojiPicker(); }

// ---------- sidebar tree ----------
// Renders the persistent #nt-side-tree (in the app's always-visible sidebar,
// not the #nt-screen overlay) so the page tree is visible even when Notes
// isn't the active view. Rebuilt wholesale on every call — simple, and cheap
// enough at notebook scale.
function renderSidebar(){
  const host = $('#nt-side-tree'); if (!host) return;
  host.innerHTML = '';
  kidsOf(null).forEach(n => host.appendChild(renderRow(n, 0)));
}
// Builds one sidebar row (expand caret, icon, title, add/duplicate/delete
// actions) plus its expanded children, recursively. depth drives indent via
// inline padding-left rather than nested CSS, since tree depth is unbounded.
function renderRow(n, depth){
  const wrap = document.createElement('div');
  const row = document.createElement('div');
  row.className = 'nt-nrow' + (state.selectedId === n.id ? ' active' : '') + (state.openIds.has(n.id) ? ' open' : '') + (kidsOf(n.id).length ? ' has-kids' : '');
  row.style.paddingLeft = (depth * 14) + 'px';

  const twi = document.createElement('button'); twi.className = 'nt-twi'; twi.title = 'expand';
  twi.innerHTML = '<i class="ti ti-chevron-down"></i>';
  twi.addEventListener('click', e => { e.stopPropagation(); if (state.openIds.has(n.id)) state.openIds.delete(n.id); else state.openIds.add(n.id); save(); renderSidebar(); });
  row.appendChild(twi);

  const em = document.createElement('div'); em.className = 'nt-em'; em.innerHTML = glyphHTML(n.emoji, '📄', 18); row.appendChild(em);
  const lab = document.createElement('div'); lab.className = 'nt-lab'; lab.textContent = n.title || 'Untitled'; if (!n.title) lab.classList.add('placeholder');
  row.appendChild(lab);

  const acts = document.createElement('div'); acts.className = 'nt-actions';
  const addBtn = document.createElement('button'); addBtn.title = 'add subpage'; addBtn.innerHTML = '<i class="ti ti-plus"></i>';
  addBtn.addEventListener('click', e => { e.stopPropagation(); newPage(n.id); });
  const dupBtn = document.createElement('button'); dupBtn.title = 'duplicate page'; dupBtn.innerHTML = '<i class="ti ti-copy"></i>';
  dupBtn.addEventListener('click', e => { e.stopPropagation(); duplicatePage(n.id); });
  const delBtn = document.createElement('button'); delBtn.className = 'nt-del'; delBtn.title = 'delete note'; delBtn.innerHTML = '<i class="ti ti-trash"></i>';
  delBtn.addEventListener('click', e => { e.stopPropagation(); confirmDeleteNote(n.id); });
  acts.appendChild(addBtn); acts.appendChild(dupBtn); acts.appendChild(delBtn);
  row.appendChild(acts);

  row.addEventListener('click', () => openPageTab(n.id));
  wireSideDrag(row, n);
  wrap.appendChild(row);

  const kids = kidsOf(n.id);
  if (kids.length){
    const k = document.createElement('div'); k.className = 'nt-nkids' + (state.openIds.has(n.id) ? ' open' : '');
    kids.forEach(c => k.appendChild(renderRow(c, depth + 1)));
    wrap.appendChild(k);
  }
  return wrap;
}

// Gathers a note and every descendant subpage id — used before deletion so
// the whole subtree is removed together, not just the clicked page.
function collectNoteIds(noteId){
  const collect = id => { const ids = [id]; kidsOf(id).forEach(c => ids.push(...collect(c.id))); return ids; };
  return collect(noteId);
}

// Shared delete path for both "delete one note (+ subpages)" and "delete all
// notes" — filters the ids out of state, fixes up openIds/selectedId, then
// flushes immediately with saveNow() (not the debounced save()) since a
// deletion should never be silently lost to an unload racing the 180ms timer.
async function deleteNoteIds(ids, message){
  closeAllNoteBranches();
  const idSet = new Set(ids);
  state.notes = state.notes.filter(n => !idSet.has(n.id));
  state.openIds = new Set([...state.openIds].filter(id => !idSet.has(id) && state.notes.some(n => n.id === id)));
  if (!state.notes.some(n => n.id === state.selectedId)){
    state.selectedId = state.notes[0]?.id || null;
  }
  await saveNow();
  renderSidebar();
  if (state.showIndex || !getNote(state.selectedId)) renderIndex();
  else renderPage();
  toast(message);
}

async function confirmDeleteNote(noteId){
  const n = getNote(noteId);
  if (!n) return;
  const ids = collectNoteIds(noteId);
  const childCount = Math.max(0, ids.length - 1);
  const ok = await confirmDeleteItem({
    heading:ids.length > 1 ? 'Delete notes?' : 'Delete note?',
    name:n.title || 'Untitled',
    before:'This removes',
    after:ids.length > 1 ? ` and ${childCount} subpage${childCount === 1 ? '' : 's'} from Notes.` : ' from Notes.',
    actionLabel:ids.length > 1 ? 'Delete notes' : 'Delete note',
  });
  if (!ok) return;
  await deleteNoteIds(ids, ids.length > 1 ? 'Notes deleted' : 'Note deleted');
}

async function confirmDeleteAllNotes(){
  if (!state.notes.length){
    toast('No notes to delete');
    return;
  }
  const ok = await confirmDeleteItem({
    heading:'Delete all notes?',
    name:'Notes',
    before:'This removes',
    after:' from the sidebar and clears every saved note page.',
    actionLabel:'Delete all notes',
  });
  if (!ok) return;
  await deleteNoteIds(state.notes.map(n => n.id), 'Notes deleted');
}

function selectNote(id){
  closeAllNoteBranches();
  state.selectedId = id; state.showIndex = false; save();
  renderSidebar(); renderPage();
}

function openPageTab(id){
  if (!openNoteTab(id)){
    mountView('notes');
    selectNote(id);
  }
}

// Show the Notes index (overview of all pages) instead of a single page.
function openIndex(){
  closeAllNoteBranches();
  state.showIndex = true;
  renderSidebar(); renderIndex();
}

function newPage(parentId){
  const now = Date.now();
  const n = { id: uid('n'), emoji:'📄', title:'', tags:[], parent: parentId || null, blocks:[ { id:uid(), type:'text', text:'' } ], createdAt: now, updatedAt: now };
  state.notes.push(n);
  if (parentId) state.openIds.add(parentId);
  save();
  openPageTab(n.id);
  setTimeout(() => { const t = $('#nt-screen .pg-title'); if (t){ t.focus(); placeCaretEnd(t); } }, 30);
}

// ---------- duplicate page (deep copy, fresh ids, subpages included) ----------
// Deep-clones a block list via JSON round-trip (cheap and safe since blocks
// are plain JSON-serializable data, never DOM nodes or functions), then
// assigns every block a fresh id so the copy shares no identity with the
// original — required because ids are used as branch anchors, drag targets,
// and DOM dataset keys.
function deepCopyBlocks(list){
  return (list || []).map(b => {
    const c = JSON.parse(JSON.stringify(b));
    c.id = uid();
    if (c.children) c.children = deepCopyBlocks(c.children);
    if (c.cols) c.cols = c.cols.map(col => deepCopyBlocks(col));
    return c;
  });
}
// Recursively copies a page and all its sidebar-tree subpages under a new
// parent, preserving the subtree shape (each child gets its own fresh copy
// parented to the corresponding copy above it, not all flattened under one node).
function duplicateSubtree(sourceId, newParentId){
  const src = getNote(sourceId); if (!src) return null;
  const now = Date.now();
  const copy = { id: uid('n'), emoji: src.emoji, title: src.title, tags: [...(src.tags || [])], parent: newParentId, blocks: deepCopyBlocks(src.blocks), createdAt: now, updatedAt: now };
  state.notes.push(copy);
  kidsOf(sourceId).forEach(c => duplicateSubtree(c.id, copy.id));
  return copy;
}
// Duplicates a page (and subpages) then splices the top-level copy directly
// after the original in state.notes purely for a nicer sidebar ordering —
// array order elsewhere doesn't matter since rendering is driven by
// n.parent, not array position.
function duplicatePage(noteId){
  const src = getNote(noteId); if (!src) return;
  const copy = duplicateSubtree(noteId, src.parent);
  const ci = state.notes.findIndex(x => x.id === copy.id);
  const [moved] = state.notes.splice(ci, 1);
  const si = state.notes.findIndex(x => x.id === noteId);
  state.notes.splice(si + 1, 0, moved);
  if (src.parent) state.openIds.add(src.parent);
  save(); renderSidebar();
  toast('page duplicated');
}

// ---------- drag-to-reparent (sidebar tree) ----------
// Native HTML5 drag-and-drop (dragstart/dragover/drop) reparents a sidebar
// row onto another row (nest under it) or onto the tree background (move to
// top level, wired in wireSidebar() below). sideDragCtx tracks the in-flight
// drag's source id across the drag/dragover/drop event sequence.
let sideDragCtx = null;
function clearSideDropMarks(){
  $$('#nt-side-tree .nt-nrow.drop-into').forEach(x => x.classList.remove('drop-into'));
}
function reparentNote(id, newParentId){
  const n = getNote(id); if (!n || n.parent === newParentId) return;
  n.parent = newParentId;
  if (newParentId) state.openIds.add(newParentId);
  save(); renderSidebar();
  toast(newParentId ? `moved into ${getNote(newParentId).title || 'Untitled'}` : 'moved to top level');
}
// Attaches the drag handlers to one sidebar row. Guards against dropping a
// note onto its own descendant (collectNoteIds(sideDragCtx.id).includes(n.id))
// which would otherwise create a cycle in the parent tree.
function wireSideDrag(row, n){
  row.draggable = true;
  row.addEventListener('dragstart', e => {
    e.stopPropagation();
    sideDragCtx = { id: n.id };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', n.id);
    setTimeout(() => row.classList.add('dragging'), 0);
  });
  row.addEventListener('dragend', () => { sideDragCtx = null; row.classList.remove('dragging'); clearSideDropMarks(); });
  row.addEventListener('dragover', e => {
    if (!sideDragCtx || collectNoteIds(sideDragCtx.id).includes(n.id)) return;
    e.preventDefault(); e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    clearSideDropMarks();
    row.classList.add('drop-into');
  });
  row.addEventListener('dragleave', e => {
    if (!row.contains(e.relatedTarget)) row.classList.remove('drop-into');
  });
  row.addEventListener('drop', e => {
    if (!sideDragCtx || collectNoteIds(sideDragCtx.id).includes(n.id)) return;
    e.preventDefault(); e.stopPropagation();
    reparentNote(sideDragCtx.id, n.id);
    sideDragCtx = null; clearSideDropMarks();
  });
}

// ---------- image downscaling (cover photos + page icons — kept small so the
// notlinear-notes Dexie value doesn't bloat with full-resolution originals) ----------
function downscaleImage(file, { maxW, maxH = Infinity, square = false, mime = 'image/png', quality }){
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(fr.error);
    fr.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
        if (square){
          const side = Math.min(sw, sh);
          sx = (sw - side) / 2; sy = (sh - side) / 2; sw = side; sh = side;
        }
        const scale = Math.min(1, maxW / sw, maxH / sh);
        const dw = Math.max(1, Math.round(sw * scale)), dh = Math.max(1, Math.round(sh * scale));
        const canvas = document.createElement('canvas'); canvas.width = dw; canvas.height = dh;
        canvas.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);
        resolve(canvas.toDataURL(mime, quality));
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}
// Downscales and stores a chosen file as the page's cover photo (dataURL,
// inline in the note object — see downscaleImage's size-budget note above).
async function applyCoverFile(n, f){
  if (!f) return;
  try {
    const src = await downscaleImage(f, { maxW: 1600, mime: 'image/jpeg', quality: 0.85 });
    n.cover = { src, posY: 50 }; n.updatedAt = Date.now(); save(); renderPage();
  } catch { toast('could not read image'); }
}

// ---------- page render ----------
// The single "render the whole open page" function — cover, icon, title,
// tags, meta line, the block list, the trailing click-to-add-block spacer,
// and the bottom "ask AI about this note" CTA. Called after essentially
// every mutation (renderPage() is the feature's re-render, not a diffed
// virtual-DOM update) — acceptable at notebook scale, and it keeps every
// other function in this file simple: mutate `state`, call save(), call
// renderPage().
function renderPage(){
  const pageEl = $('#nt-page'); const crumbsEl = $('#nt-crumbs');
  if (!pageEl || !crumbsEl) return;
  pageEl.classList.remove('nt-pg-index');
  const n = getNote(state.selectedId);
  if (!n){
    pageEl.innerHTML = '<div style="color:var(--text-3);font-style:italic;padding-top:80px;text-align:center">no pages yet — create one to start writing.</div>';
    crumbsEl.innerHTML = '';
    $('#nt-export-btn')?.classList.add('hidden');
    return;
  }
  $('#nt-export-btn')?.classList.remove('hidden');

  // breadcrumbs
  crumbsEl.innerHTML = '';
  const wsB = document.createElement('button'); wsB.className = 'nt-crumb';
  wsB.innerHTML = '<i class="ti ti-stack-2"></i><span class="nt-lab">Workspace</span>';
  wsB.addEventListener('click', () => mountView('chat'));
  crumbsEl.appendChild(wsB);
  const sep0 = document.createElement('span'); sep0.className = 'sep'; sep0.textContent = '/'; crumbsEl.appendChild(sep0);
  const ntsB = document.createElement('button'); ntsB.className = 'nt-crumb';
  ntsB.innerHTML = '<i class="ti ti-notes"></i><span class="nt-lab">Notes</span>';
  ntsB.addEventListener('click', () => openIndex());
  crumbsEl.appendChild(ntsB);
  pathOf(n.id).forEach((p, i, arr) => {
    const sep = document.createElement('span'); sep.className = 'sep'; sep.textContent = '/'; crumbsEl.appendChild(sep);
    const b = document.createElement('button'); b.className = 'nt-crumb' + (i === arr.length - 1 ? ' current' : '');
    b.innerHTML = `<span class="nt-em">${glyphHTML(p.emoji, '📄', 18)}</span><span class="nt-lab">${escapeHtml(p.title || 'Untitled')}</span>`;
    b.addEventListener('click', () => openPageTab(p.id));
    crumbsEl.appendChild(b);
  });

  // header + tags + blocks
  pageEl.innerHTML = '';

  const coverWrap = document.createElement('div'); coverWrap.className = 'cover-wrap' + (n.cover ? ' has-cover' : '');
  if (n.cover){
    const cimg = document.createElement('img'); cimg.className = 'cover-img'; cimg.src = n.cover.src;
    cimg.style.objectPosition = 'center ' + (n.cover.posY ?? 50) + '%';
    coverWrap.appendChild(cimg);
    const ctrls = document.createElement('div'); ctrls.className = 'cover-controls';
    const repoBtn = document.createElement('button'); repoBtn.type = 'button'; repoBtn.innerHTML = '<i class="ti ti-arrows-vertical"></i> Reposition';
    const changeBtn = document.createElement('button'); changeBtn.type = 'button'; changeBtn.innerHTML = '<i class="ti ti-photo"></i> Change';
    const rmBtn = document.createElement('button'); rmBtn.type = 'button'; rmBtn.innerHTML = '<i class="ti ti-trash"></i> Remove';
    const coverFile = document.createElement('input'); coverFile.type = 'file'; coverFile.accept = 'image/*'; coverFile.style.display = 'none';
    coverFile.addEventListener('change', () => applyCoverFile(n, coverFile.files[0]));
    changeBtn.addEventListener('click', e => { e.stopPropagation(); coverFile.click(); });
    rmBtn.addEventListener('click', e => { e.stopPropagation(); delete n.cover; n.updatedAt = Date.now(); save(); renderPage(); });
    repoBtn.addEventListener('click', e => {
      e.stopPropagation();
      // Vertical-drag-to-reposition: update the cover's CSS object-position
      // live on every mousemove for immediate visual feedback, but only call
      // save() once on mouseup — position changes save on drag-end, same as
      // block/branch drag elsewhere in this file, so a drag doesn't spam Dexie.
      const startY = e.clientY; const startPos = n.cover.posY ?? 50;
      const rect = coverWrap.getBoundingClientRect();
      const onMove = mv => {
        const pos = Math.max(0, Math.min(100, startPos + ((mv.clientY - startY) / rect.height) * 100));
        cimg.style.objectPosition = 'center ' + pos + '%';
        n.cover.posY = pos;
      };
      const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); n.updatedAt = Date.now(); save(); };
      document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
    });
    ctrls.appendChild(repoBtn); ctrls.appendChild(changeBtn); ctrls.appendChild(rmBtn);
    coverWrap.appendChild(ctrls); coverWrap.appendChild(coverFile);
  } else {
    const addBtn = document.createElement('button'); addBtn.type = 'button'; addBtn.className = 'cover-add'; addBtn.innerHTML = '<i class="ti ti-photo-plus"></i> Add cover';
    const coverFile = document.createElement('input'); coverFile.type = 'file'; coverFile.accept = 'image/*'; coverFile.style.display = 'none';
    coverFile.addEventListener('change', () => applyCoverFile(n, coverFile.files[0]));
    addBtn.addEventListener('click', e => { e.stopPropagation(); coverFile.click(); });
    coverWrap.appendChild(addBtn); coverWrap.appendChild(coverFile);
  }
  pageEl.appendChild(coverWrap);

  const iconWrap = document.createElement('div'); iconWrap.className = 'pg-icon-wrap';
  const emb = document.createElement('button'); emb.className = 'pg-emoji'; emb.dataset.emojiTrigger = '1'; emb.innerHTML = glyphHTML(n.emoji, '📄', 36);
  emb.addEventListener('click', () => openEmojiPop({ kind:'page', noteId:n.id }, emb));
  iconWrap.appendChild(emb);

  const iconActs = document.createElement('div'); iconActs.className = 'pg-icon-actions';
  const iconFile = document.createElement('input'); iconFile.type = 'file'; iconFile.accept = 'image/*'; iconFile.style.display = 'none';
  iconFile.addEventListener('change', async () => {
    const f = iconFile.files[0]; if (!f) return;
    try {
      n.emoji = 'img:' + await downscaleImage(f, { maxW: 128, maxH: 128, square: true, mime: 'image/png' });
      n.updatedAt = Date.now(); save(); renderPage(); renderSidebar(); refreshOpenTabs();
    } catch { toast('could not read image'); }
  });
  const uploadBtn = document.createElement('button'); uploadBtn.type = 'button'; uploadBtn.title = 'upload image icon'; uploadBtn.innerHTML = '<i class="ti ti-camera"></i>';
  uploadBtn.addEventListener('click', e => { e.stopPropagation(); iconFile.click(); });
  iconActs.appendChild(uploadBtn); iconActs.appendChild(iconFile);
  if (typeof n.emoji === 'string' && n.emoji.startsWith('img:')){
    const rmIconBtn = document.createElement('button'); rmIconBtn.type = 'button'; rmIconBtn.title = 'remove custom icon'; rmIconBtn.innerHTML = '<i class="ti ti-x"></i>';
    rmIconBtn.addEventListener('click', e => { e.stopPropagation(); n.emoji = null; n.updatedAt = Date.now(); save(); renderPage(); renderSidebar(); refreshOpenTabs(); });
    iconActs.appendChild(rmIconBtn);
  }
  iconWrap.appendChild(iconActs);
  pageEl.appendChild(iconWrap);

  // Page title is its own contentEditable (not a block) — Enter moves focus
  // into the first block's editor instead of inserting a newline, matching
  // Notion's "title is a single line" behavior.
  const title = document.createElement('div'); title.className = 'pg-title'; title.contentEditable = 'true';
  title.textContent = n.title || '';
  title.dataset.empty = n.title ? 'false' : 'true';
  title.addEventListener('input', () => { n.title = title.textContent; title.dataset.empty = n.title ? 'false' : 'true'; n.updatedAt = Date.now(); save(); renderSidebar(); updateCurrentCrumbLabel(); refreshOpenTabs(); });
  title.addEventListener('keydown', e => {
    if (e.key === 'Enter'){ e.preventDefault();
      const firstBlock = pageEl.querySelector('.b .editor');
      if (firstBlock){ firstBlock.focus(); placeCaretEnd(firstBlock); }
    }
  });
  pageEl.appendChild(title);

  const tags = document.createElement('div'); tags.className = 'pg-tags';
  (n.tags || []).forEach((t, i) => {
    const tg = document.createElement('span'); tg.className = 'tag'; tg.innerHTML = `# ${escapeHtml(t)} <span class="x" title="remove">×</span>`;
    tg.querySelector('.x').addEventListener('click', () => { n.tags.splice(i, 1); n.updatedAt = Date.now(); save(); renderPage(); });
    tags.appendChild(tg);
  });
  const addTag = document.createElement('button'); addTag.className = 'tag add'; addTag.textContent = '+ add tag';
  addTag.addEventListener('click', () => {
    const inp = document.createElement('input'); inp.type = 'text'; inp.className = 'tag-input'; inp.placeholder = 'tag…';
    addTag.replaceWith(inp); inp.focus();
    const commit = () => { const v = inp.value.trim(); if (v && !n.tags.includes(v)){ n.tags.push(v); n.updatedAt = Date.now(); save(); } renderPage(); };
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') commit();
      else if (e.key === 'Escape') renderPage();
    });
    inp.addEventListener('blur', commit);
  });
  tags.appendChild(addTag);
  pageEl.appendChild(tags);

  const meta = document.createElement('div'); meta.className = 'pg-meta';
  const parentNote = n.parent ? getNote(n.parent) : null;
  const where = parentNote ? `subpage of ${escapeHtml(parentNote.title || 'Untitled')}` : 'top-level';
  meta.innerHTML = `<span>${n.blocks.length} blocks</span><span class="dot"></span><span>updated ${escapeHtml(timeAgo(n.updatedAt || n.createdAt) || 'just now')}</span><span class="dot"></span><span>${where}</span>`;
  pageEl.appendChild(meta);

  pruneAnchors(n);
  const blocks = document.createElement('div'); blocks.className = 'blocks';
  n.blocks.forEach(b => blocks.appendChild(renderBlock(b, n.blocks, n)));
  pageEl.appendChild(blocks);

  const tail = document.createElement('div'); tail.style.height = '80px'; tail.style.cursor = 'text';
  tail.addEventListener('click', () => {
    if (n.blocks.length === 0 || n.blocks[n.blocks.length - 1].type !== 'text' || (n.blocks[n.blocks.length - 1].text || '').trim()){
      const nb = { id:uid(), type:'text', text:'' }; n.blocks.push(nb); n.updatedAt = Date.now(); save(); renderPage();
      setTimeout(() => focusBlock(nb.id), 20);
    } else {
      const last = pageEl.querySelector('.b:last-of-type .editor'); if (last) last.focus();
    }
  });
  pageEl.appendChild(tail);

  // bottom CTA — ask AI about this note.
  // This creates a note-wide branch (quote:null, blockId:null) rather than a
  // text-anchored one — see the "note branches" section far below for how
  // text-anchored vs. note-wide branches differ.
  const cta = document.createElement('div'); cta.className = 'nt-branch-cta';
  const ctaIcon = document.createElement('i'); ctaIcon.className = 'ti ti-sparkles'; cta.appendChild(ctaIcon);
  const ctaInp = document.createElement('div'); ctaInp.className = 'nt-branch-cta-inp'; ctaInp.contentEditable = 'true'; ctaInp.dataset.ph = 'Ask AI about this note…';
  const ctaBtn = document.createElement('button'); ctaBtn.className = 'nt-branch-cta-btn'; ctaBtn.title = 'Ask AI'; ctaBtn.innerHTML = '<i class="ti ti-arrow-up"></i>';
  const doCtaAsk = () => {
    const text = ctaInp.textContent.trim(); ctaInp.textContent = '';
    const bid = uid('nb');
    if (!n.branches) n.branches = [];
    n.branches.push({ bid, quote:null, blockId:null, messages:[], createdAt:Date.now(), touchedAt:Date.now() });
    n.updatedAt = Date.now(); save();
    openNoteBranch(bid);
    if (text) setTimeout(() => sendNoteMsg(bid, text), 50);
  };
  ctaInp.addEventListener('keydown', e => { if (e.key==='Enter' && !e.shiftKey){ e.preventDefault(); doCtaAsk(); } });
  ctaBtn.addEventListener('click', doCtaAsk);
  cta.appendChild(ctaInp); cta.appendChild(ctaBtn);
  pageEl.appendChild(cta);
}

// Cheap targeted DOM patch (vs. a full renderPage()) for the one case where
// only the breadcrumb trail's current-page label needs to change — typing
// in the title on every keystroke.
function updateCurrentCrumbLabel(){
  const n = getNote(state.selectedId);
  const lab = $('#nt-crumbs .nt-crumb.current .nt-lab');
  if (lab && n) lab.textContent = n.title || 'Untitled';
}

// ---------- index render (overview of all pages) ----------
// Human-relative timestamp ("3 minutes ago") for the sidebar/index "updated"
// meta line; falls back to an absolute date once it's more than a few weeks old.
function timeAgo(ts){
  if (!ts) return '';
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return min + (min === 1 ? ' minute ago' : ' minutes ago');
  const hr = Math.floor(min / 60);
  if (hr < 24) return hr + (hr === 1 ? ' hour ago' : ' hours ago');
  const day = Math.floor(hr / 24);
  if (day < 7) return day + (day === 1 ? ' day ago' : ' days ago');
  const wk = Math.floor(day / 7);
  if (wk < 5) return wk + (wk === 1 ? ' week ago' : ' weeks ago');
  return new Date(ts).toLocaleDateString(undefined, { month:'short', day:'numeric' });
}

// ---------- bento card tint + corner-bloom icon ----------
// 8 muted bg/fg swatch pairs (see --bento-t*-bg/-fg in notes.css). Which pair
// a note gets is hashed from its own icon, so the same icon always lands on
// the same tint across renders/sessions, without persisting anything.
const BENTO_TINTS = ['t0', 't1', 't2', 't3', 't4', 't5', 't6', 't7'];
function tintFor(iconValue){
  let sum = 0;
  for (const ch of String(iconValue || '')) sum += ch.codePointAt(0);
  return BENTO_TINTS[sum % BENTO_TINTS.length];
}

// Deterministic per-note "randomness" (seeded by id, not by render) so the
// bloom's size/rotation stay put across re-renders instead of jittering.
function seedRand(seed){
  let s = 0; for (let i = 0; i < seed.length; i++){ s = (s << 5) - s + seed.charCodeAt(i); s |= 0; }
  return function(){
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Like glyphHTML(), but lets a Mind Garden icon token be tinted — respects an
// explicit per-icon color the user already picked, falling back to the
// tint's color only when they haven't chosen one. Plain emoji/img tokens are
// already colorful/photographic, so they pass through glyphHTML() untouched.
function bentoIconHTML(value, size, tintColor){
  if (typeof value === 'string' && value.startsWith('icon:')){
    const parsed = parseIconToken(value);
    if (parsed){
      const svg = renderIconSvg(parsed.id, { size, color: parsed.color || tintColor });
      if (svg) return svg;
    }
  }
  return glyphHTML(value, '📄', size);
}

function renderIndex(){
  const pageEl = $('#nt-page'); const crumbsEl = $('#nt-crumbs');
  if (!pageEl || !crumbsEl) return;
  pageEl.classList.add('nt-pg-index');
  $('#nt-export-btn')?.classList.add('hidden');

  // breadcrumbs: Workspace / Notes (current)
  crumbsEl.innerHTML = '';
  const wsB = document.createElement('button'); wsB.className = 'nt-crumb';
  wsB.innerHTML = '<i class="ti ti-stack-2"></i><span class="nt-lab">Workspace</span>';
  wsB.addEventListener('click', () => mountView('chat'));
  crumbsEl.appendChild(wsB);
  const sep0 = document.createElement('span'); sep0.className = 'sep'; sep0.textContent = '/'; crumbsEl.appendChild(sep0);
  const ntsB = document.createElement('button'); ntsB.className = 'nt-crumb current';
  ntsB.innerHTML = '<i class="ti ti-notes"></i><span class="nt-lab">Notes</span>';
  crumbsEl.appendChild(ntsB);

  // body
  pageEl.innerHTML = '';
  const wrap = document.createElement('div'); wrap.className = 'nt-index';

  const head = document.createElement('div'); head.className = 'nt-ix-head';
  const titleWrap = document.createElement('div'); titleWrap.className = 'nt-ix-titlewrap';
  const total = state.notes.length;
  titleWrap.innerHTML = `<div class="nt-ix-icon"><i class="ti ti-notes"></i></div>`
    + `<div><div class="nt-ix-title">Notes</div>`
    + `<div class="nt-ix-sub">${total} page${total === 1 ? '' : 's'}</div></div>`;
  head.appendChild(titleWrap);
  const newBtn = document.createElement('button'); newBtn.className = 'nt-ix-new';
  newBtn.innerHTML = '<i class="ti ti-plus"></i><span>New page</span>';
  newBtn.addEventListener('click', () => newPage(null));
  head.appendChild(newBtn);
  wrap.appendChild(head);

  const roots = kidsOf(null).slice().sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
  if (!roots.length){
    const empty = document.createElement('button'); empty.className = 'nt-ix-empty';
    empty.innerHTML = '<i class="ti ti-file-plus"></i><span>No pages yet — create your first one.</span>';
    empty.addEventListener('click', () => newPage(null));
    wrap.appendChild(empty);
  } else {
    const grid = document.createElement('div'); grid.className = 'nt-bento';
    roots.forEach((n, i) => grid.appendChild(renderBentoCard(n, i)));
    const addTile = document.createElement('button'); addTile.className = 'nt-bento-add'; addTile.type = 'button';
    addTile.innerHTML = '<i class="ti ti-plus"></i><span>New note</span>';
    addTile.addEventListener('click', () => newPage(null));
    grid.appendChild(addTile);
    wrap.appendChild(grid);
  }

  pageEl.appendChild(wrap);
}

// Deterministic bento shape per note — hashed from the note's own id so the
// mix of normal/wide/tall/big cards stays put across re-renders instead of
// reshuffling. idx 0 (most-recently-edited) is always pinned to 'big' so
// there's a stable anchor tile; the rest get a weighted-random shape (mostly
// normal, occasional wide/tall, rare big) so the grid doesn't look uniform.
function shapeFor(n, idx){
  if (idx === 0) return 'big';
  const r = seedRand(n.id + ':shape')();
  if (r < 0.55) return '';
  if (r < 0.76) return 'wide';
  if (r < 0.92) return 'tall';
  return 'big';
}

const BLOOM_BASE_SIZE = { '': 100, wide: 130, tall: 130, big: 150 };

function renderBentoCard(n, idx){
  const kids = kidsOf(n.id);
  const shape = shapeFor(n, idx);
  const card = document.createElement('div'); card.className = 'nt-bento-item' + (shape ? ' ' + shape : '');

  const t = tintFor(n.emoji || '📄');
  card.style.setProperty('--tbg', `var(--bento-${t}-bg)`);
  card.style.setProperty('--tfg', `var(--bento-${t}-fg)`);

  // Corner bloom — a giant, faint copy of the note's own icon bleeding off
  // the bottom-right corner (never top-right, so it can't collide with the
  // hover-revealed add/delete buttons there). Skipped for uploaded photo
  // icons (img: tokens) — a huge faint raster photo reads as a bug, not art.
  if (!(typeof n.emoji === 'string' && n.emoji.startsWith('img:'))){
    const rand = seedRand(n.id);
    const size = BLOOM_BASE_SIZE[shape] + Math.round(rand() * 50);
    const rot = Math.round(rand() * 20 - 10);
    const bloom = document.createElement('span');
    bloom.className = 'nt-bloom';
    bloom.style.cssText = `bottom:-20px;right:-20px;transform:rotate(${rot}deg)`;
    bloom.innerHTML = bentoIconHTML(n.emoji, size, 'var(--tfg)');
    card.appendChild(bloom);
  }

  const lab = document.createElement('div'); lab.className = 'nt-ix-name'; lab.textContent = n.title || 'Untitled';
  if (!n.title) lab.classList.add('placeholder');
  card.appendChild(lab);

  const meta = document.createElement('div'); meta.className = 'nt-ix-meta';
  const parts = [`${n.blocks.length} block${n.blocks.length === 1 ? '' : 's'}`];
  if (kids.length) parts.push(`${kids.length} subpage${kids.length === 1 ? '' : 's'}`);
  const ago = timeAgo(n.updatedAt || n.createdAt);
  if (ago) parts.push(ago);
  meta.textContent = parts.join(' · ');
  card.appendChild(meta);

  const acts = document.createElement('div'); acts.className = 'nt-ix-acts';
  const addBtn = document.createElement('button'); addBtn.title = 'add subpage'; addBtn.innerHTML = '<i class="ti ti-plus"></i>';
  addBtn.addEventListener('click', e => { e.stopPropagation(); newPage(n.id); });
  const delBtn = document.createElement('button'); delBtn.className = 'nt-ix-del'; delBtn.title = 'delete page'; delBtn.innerHTML = '<i class="ti ti-trash"></i>';
  delBtn.addEventListener('click', e => { e.stopPropagation(); confirmDeleteNote(n.id); });
  acts.appendChild(addBtn); acts.appendChild(delBtn);
  card.appendChild(acts);

  card.addEventListener('click', () => openPageTab(n.id));
  return card;
}

// ---------- media/file/bookmark/embed helpers (A4-A7) ----------
// Sniffs a pasted URL into a playable media kind (YouTube/Vimeo get an
// embeddable player URL synthesized; direct .mp4/.mp3-style links get a
// native <video>/<audio> tag; anything else falls back to a plain link card).
function classifyMediaUrl(url){
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/);
  if (yt) return { kind:'youtube', embedSrc:'https://www.youtube.com/embed/' + yt[1] };
  const vm = url.match(/vimeo\.com\/(\d+)/);
  if (vm) return { kind:'vimeo', embedSrc:'https://player.vimeo.com/video/' + vm[1] };
  if (/\.(mp4|webm|mov)(\?.*)?$/i.test(url)) return { kind:'video' };
  if (/\.(mp3|wav|ogg)(\?.*)?$/i.test(url)) return { kind:'audio' };
  return { kind:'unrecognized' };
}
function humanFileSize(bytes){
  if (!bytes) return '0 B';
  const units = ['B','KB','MB','GB'];
  let i = 0, n = bytes;
  while (n >= 1024 && i < units.length - 1){ n /= 1024; i++; }
  return (i === 0 ? n : n.toFixed(1)) + ' ' + units[i];
}
function fileIconClass(mime, name){
  const ext = (name || '').split('.').pop().toLowerCase();
  if ((mime || '').startsWith('image/')) return 'ti-photo';
  if ((mime || '').startsWith('video/')) return 'ti-movie';
  if ((mime || '').startsWith('audio/')) return 'ti-music';
  if (ext === 'pdf') return 'ti-file-type-pdf';
  if (['zip','rar','7z'].includes(ext)) return 'ti-file-zip';
  if (['doc','docx'].includes(ext)) return 'ti-file-type-doc';
  return 'ti-file';
}
// Allowlist of a few common public embed patterns (A7). Only these hardcoded
// origins ever get an iframe src — an unmatched URL never does.
const EMBED_ALLOWLIST = [
  { nm:'figma', test:/figma\.com\/(file|proto)\//, embed:u => 'https://www.figma.com/embed?embed_host=notlinear&url=' + encodeURIComponent(u) },
  { nm:'codepen', test:/codepen\.io\/[\w-]+\/pen\/[\w-]+/, embed:u => {
    const m = u.match(/codepen\.io\/([\w-]+)\/pen\/([\w-]+)/);
    return 'https://codepen.io/' + m[1] + '/embed/' + m[2] + '?default-tab=result';
  } },
  { nm:'maps', test:/google\.[a-z.]+\/maps\//, embed:u => {
    const m = u.match(/[?&]q=([^&]+)/);
    return 'https://maps.google.com/maps?q=' + (m ? m[1] : encodeURIComponent(u)) + '&output=embed';
  } },
];
function transformEmbedUrl(url){
  const match = EMBED_ALLOWLIST.find(e => e.test.test(url));
  return match ? match.embed(url) : null;
}
// Fetches a link-preview (title/description/domain/favicon) for a bookmark
// block from the backend proxy (avoids CORS/leaking the request from the
// client directly to arbitrary third-party sites). On any failure, marks the
// block fetchFailed so renderBlock falls back to a plain link card rather
// than getting stuck on a permanent loading state.
async function fetchBookmark(b, url){
  try {
    const res = await loggedFetch('/__notlinear_link_preview', {
      method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ url }),
    }, { label:'link_preview', timeoutMs: 8000 });
    const data = await readResponseBody(res, { kind:'json', label:'link_preview' });
    if (data && data.ok){ b.title = data.title; b.description = data.description; b.domain = data.domain; b.favicon = data.favicon; }
    else b.fetchFailed = true;
  } catch {
    b.fetchFailed = true;
  }
  touchSelected(); save(); renderPage();
}

// ---------- block render / rendering (block model) ----------
// Builds the DOM for a single block, dispatching on b.type — this is the
// heart of the block model described in FEATURES.md → Notes. Every block gets
// a shared gutter (add-below / drag-grip) and a `.content` slot whose inner
// markup depends on the type (contentEditable "editor" for rich-text types,
// or bespoke widget markup for image/table/media/file/bookmark/embed/cols/
// toc/page-link). Recurses into b.children (toggle contents, or any
// Tab-indented block) and b.cols (multi-column layout) to render nested
// block trees. Called once per block from renderPage() and recursively from
// itself for nested content.
function renderBlock(b, parentList, note){
  const el = document.createElement('div'); el.className = 'b ' + b.type; el.dataset.bid = b.id;
  if (b.type === 'toggle' && b.headingLevel) el.classList.add('is-h' + b.headingLevel);
  if (b.type === 'todo' && b.done) el.classList.add('done');
  if (b.type === 'toggle' && b.open) el.classList.add('open');

  const gutter = document.createElement('div'); gutter.className = 'gutter';
  const plus = document.createElement('button'); plus.title = 'add block below'; plus.innerHTML = '<i class="ti ti-plus"></i>';
  plus.addEventListener('click', () => { const nb = insertAfter(parentList, b.id, { id:uid(), type:'text', text:'' }); touchSelected(); save(); renderPage(); setTimeout(() => focusBlock(nb.id), 20); });
  const grip = document.createElement('button'); grip.className = 'grip'; grip.title = 'drag to move · click for actions'; grip.innerHTML = '<i class="ti ti-grip-vertical"></i>';
  grip.addEventListener('click', () => blockMenu(b, parentList));
  gutter.appendChild(plus); gutter.appendChild(grip);
  el.appendChild(gutter);
  wireBlockDrag(el, grip, b, parentList);

  const content = document.createElement('div'); content.className = 'content';

  if (b.type === 'bullet' || b.type === 'numbered'){
    const lead = document.createElement('div'); lead.className = 'lead';
    if (b.type === 'numbered'){
      const idx = parentList.filter(x => x.type === 'numbered').indexOf(b) + 1;
      lead.textContent = idx + '.';
    }
    content.appendChild(lead);
  } else if (b.type === 'todo'){
    const lead = document.createElement('div'); lead.className = 'lead';
    const ck = document.createElement('div'); ck.className = 'ck'; ck.innerHTML = '<i class="ti ti-check"></i>';
    ck.addEventListener('click', () => { b.done = !b.done; touchSelected(); save(); el.classList.toggle('done'); });
    lead.appendChild(ck); content.appendChild(lead);
  } else if (b.type === 'toggle'){
    const lead = document.createElement('div'); lead.className = 'lead';
    lead.innerHTML = '<i class="ti ti-chevron-down"></i>';
    lead.addEventListener('click', () => { b.open = !b.open; touchSelected(); save(); el.classList.toggle('open', b.open); });
    content.appendChild(lead);
  } else if (b.type === 'callout'){
    const lead = document.createElement('div'); lead.className = 'lead'; lead.dataset.emojiTrigger = '1';
    lead.innerHTML = glyphHTML(b.emoji, '💡', 22);
    lead.style.cursor = 'pointer';
    lead.addEventListener('click', e => { e.stopPropagation(); openEmojiPop({ kind:'callout', blockId:b.id }, lead); });
    content.appendChild(lead);
  } else if (b.type === 'page-link'){
    const lead = document.createElement('div'); lead.className = 'lead';
    const target = b.target ? getNote(b.target) : null;
    lead.innerHTML = target ? glyphHTML(target.emoji, '📄', 22) : escapeHtml('📄');
    content.appendChild(lead);
  }

  if (b.type === 'divider'){
    const ed = document.createElement('div'); ed.className = 'editor'; content.appendChild(ed);
  } else if (b.type === 'code'){
    const head = document.createElement('div'); head.className = 'code-head';
    const sel = document.createElement('select');
    ['plain','javascript','typescript','python','rust','go','html','css','sql','json','bash'].forEach(l => {
      const o = document.createElement('option'); o.value = l; o.textContent = l; if (l === (b.lang || 'plain')) o.selected = true; sel.appendChild(o);
    });
    sel.addEventListener('change', () => { b.lang = sel.value; touchSelected(); save(); highlightCodeEditor(ed, b); });
    head.appendChild(sel);
    const right = document.createElement('div'); right.className = 'right';
    const cp = document.createElement('button'); cp.title = 'copy'; cp.innerHTML = '<i class="ti ti-copy"></i>';
    cp.addEventListener('click', () => { navigator.clipboard.writeText(b.text || ''); toast('copied'); });
    right.appendChild(cp); head.appendChild(right);
    content.appendChild(head);
    const ed = document.createElement('div'); ed.className = 'editor'; ed.contentEditable = 'plaintext-only'; ed.setAttribute('spellcheck', 'false'); ed.textContent = b.text || '';
    attachEditor(ed, b, parentList, true, note);
    let hlTimer = null;
    ed.addEventListener('input', () => { clearTimeout(hlTimer); hlTimer = setTimeout(() => highlightCodeEditor(ed, b), 300); });
    ed.addEventListener('blur', () => { clearTimeout(hlTimer); highlightCodeEditor(ed, b); });
    content.appendChild(ed);
    highlightCodeEditor(ed, b);
  } else if (b.type === 'eq'){
    const ed = document.createElement('div'); ed.className = 'editor eq-source'; ed.contentEditable = 'plaintext-only';
    ed.setAttribute('spellcheck', 'false'); ed.dataset.ph = 'e.g. x^2 + y^2 = z^2'; ed.textContent = b.text || '';
    const preview = document.createElement('div'); preview.className = 'eq-preview';
    attachEditor(ed, b, parentList, true, note);
    let eqTimer = null;
    ed.addEventListener('input', () => { clearTimeout(eqTimer); eqTimer = setTimeout(() => renderEqPreview(preview, b.text || ''), 300); });
    content.appendChild(ed); content.appendChild(preview);
    renderEqPreview(preview, b.text || '');
  } else if (b.type === 'image'){
    const slot = document.createElement('div'); slot.className = 'img-slot' + (b.src ? ' has-img' : '');
    if (b.src){
      const img = document.createElement('img'); img.src = b.src;
      if (b.width) img.style.width = b.width + 'px';
      img.addEventListener('error', () => {
        slot.classList.add('img-broken');
        slot.innerHTML = '<div class="img-broken-msg"><i class="ti ti-photo-off"></i><span>couldn’t load this image — click to replace</span></div>';
      }, { once:true });
      slot.appendChild(img);
      const handle = document.createElement('div'); handle.className = 'img-resize-handle'; handle.title = 'drag to resize';
      handle.addEventListener('mousedown', e => {
        e.preventDefault(); e.stopPropagation();
        // Live-resize the <img> width on every mousemove; only persist
        // (touchSelected + save) once on mouseup — the drag-ends-then-saves
        // pattern used throughout this file for size/position changes.
        const startX = e.clientX; const startW = img.getBoundingClientRect().width;
        const maxW = content.clientWidth || slot.clientWidth || 800;
        const onMove = mv => { img.style.width = Math.max(120, Math.min(startW + (mv.clientX - startX), maxW)) + 'px'; };
        const onUp = () => {
          document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp);
          b.width = Math.round(parseFloat(img.style.width)); touchSelected(); save();
        };
        document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
      });
      slot.appendChild(handle);
    } else {
      const ph = document.createElement('div'); ph.className = 'img-ph';
      ph.innerHTML = '<span>📷 click or drop an image</span>';
      const urlBtn = document.createElement('button'); urlBtn.type = 'button'; urlBtn.className = 'img-url-btn'; urlBtn.textContent = 'paste image URL';
      urlBtn.addEventListener('click', e => {
        e.stopPropagation();
        const url = prompt('Image URL (https://…)');
        if (url && /^https?:\/\//i.test(url.trim())){ b.src = url.trim(); touchSelected(); save(); renderPage(); }
      });
      slot.appendChild(ph); slot.appendChild(urlBtn);
    }
    const file = document.createElement('input'); file.type = 'file'; file.accept = 'image/*'; file.style.display = 'none';
    file.addEventListener('change', () => {
      const f = file.files[0]; if (!f) return;
      const fr = new FileReader(); fr.onload = () => { b.src = fr.result; delete b.width; touchSelected(); save(); renderPage(); }; fr.readAsDataURL(f);
    });
    slot.addEventListener('click', e => { if (e.target.closest('.img-url-btn') || e.target.closest('.img-resize-handle')) return; file.click(); });
    slot.addEventListener('dragover', e => { e.preventDefault(); slot.style.background = 'var(--bg-2)'; });
    slot.addEventListener('dragleave', () => { slot.style.background = ''; });
    slot.addEventListener('drop', e => {
      e.preventDefault(); slot.style.background = '';
      const f = e.dataTransfer.files[0];
      if (f){ const fr = new FileReader(); fr.onload = () => { b.src = fr.result; delete b.width; touchSelected(); save(); renderPage(); }; fr.readAsDataURL(f); return; }
      const url = (e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain') || '').trim();
      if (/^https?:\/\//i.test(url)){ b.src = url; delete b.width; touchSelected(); save(); renderPage(); }
    });
    content.appendChild(slot); content.appendChild(file);
    const cap = document.createElement('div'); cap.className = 'editor'; cap.contentEditable = 'true'; cap.dataset.ph = 'write a caption…';
    cap.innerHTML = b.caption || '';
    cap.addEventListener('input', () => { b.caption = cap.innerHTML; touchSelected(); save(); });
    content.appendChild(cap);
  } else if (b.type === 'toc'){
    const box = document.createElement('div'); box.className = 'toc-box';
    box.appendChild(buildTocBody(note));
    content.appendChild(box);
  } else if (b.type === 'table'){
    const tbl = document.createElement('table');
    (b.rows || [['','','']]).forEach((row, ri) => {
      const tr = document.createElement('tr');
      row.forEach((cell, ci) => {
        const td = document.createElement(ri === 0 ? 'th' : 'td'); td.contentEditable = 'true'; td.innerHTML = cell || '';
        td.addEventListener('input', () => { b.rows[ri][ci] = td.innerHTML; touchSelected(); save(); });
        tr.appendChild(td);
      });
      tbl.appendChild(tr);
    });
    content.appendChild(tbl);
    const tbar = document.createElement('div'); tbar.className = 'tbar';
    const addRow = document.createElement('button'); addRow.innerHTML = '<i class="ti ti-plus"></i> row';
    addRow.addEventListener('click', () => { const cols = b.rows[0].length; b.rows.push(Array(cols).fill('')); touchSelected(); save(); renderPage(); });
    const addCol = document.createElement('button'); addCol.innerHTML = '<i class="ti ti-plus"></i> column';
    addCol.addEventListener('click', () => { b.rows.forEach(r => r.push('')); touchSelected(); save(); renderPage(); });
    tbar.appendChild(addRow); tbar.appendChild(addCol);
    content.appendChild(tbar);
  } else if (b.type === 'media'){
    const box = document.createElement('div'); box.className = 'media-box';
    if (!b.url){
      const ph = document.createElement('button'); ph.type = 'button'; ph.className = 'media-ph';
      ph.innerHTML = '<i class="ti ti-movie"></i><span>paste a video or audio URL</span>';
      ph.addEventListener('click', () => {
        const url = prompt('Video/audio URL (YouTube, Vimeo, or a direct file link)');
        if (!url || !url.trim()) return;
        const trimmed = url.trim();
        const info = classifyMediaUrl(trimmed);
        b.url = trimmed; b.kind = info.kind; if (info.embedSrc) b.embedSrc = info.embedSrc;
        touchSelected(); save(); renderPage();
      });
      box.appendChild(ph);
    } else if (b.kind === 'youtube' || b.kind === 'vimeo'){
      const frame = document.createElement('iframe'); frame.className = 'media-frame'; frame.src = b.embedSrc;
      frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups');
      frame.allow = 'accelerometer; autoplay; encrypted-media; picture-in-picture'; frame.loading = 'lazy';
      box.appendChild(frame);
    } else if (b.kind === 'video'){
      const v = document.createElement('video'); v.controls = true; v.src = b.url; v.className = 'media-native';
      box.appendChild(v);
    } else if (b.kind === 'audio'){
      const a = document.createElement('audio'); a.controls = true; a.src = b.url; a.className = 'media-native-audio';
      box.appendChild(a);
    } else {
      const card = document.createElement('div'); card.className = 'media-unrecognized';
      card.innerHTML = '<i class="ti ti-link-off"></i><span>can’t embed this link — </span>';
      const link = document.createElement('a'); link.href = b.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = b.url;
      card.appendChild(link);
      box.appendChild(card);
    }
    content.appendChild(box);
  } else if (b.type === 'file'){
    const box = document.createElement('div'); box.className = 'file-box';
    if (!b.name){
      const ph = document.createElement('div'); ph.className = 'file-ph';
      ph.innerHTML = '<i class="ti ti-paperclip"></i><span>click or drop a file to attach</span>';
      box.appendChild(ph);
      const input = document.createElement('input'); input.type = 'file'; input.style.display = 'none';
      const handleFile = f => {
        if (!f) return;
        b.name = f.name; b.mime = f.type || ''; b.size = f.size;
        if (f.size > 5 * 1024 * 1024){ b.tooLarge = true; touchSelected(); save(); renderPage(); return; }
        const fr = new FileReader();
        fr.onload = () => { b.src = fr.result; touchSelected(); save(); renderPage(); };
        fr.readAsDataURL(f);
      };
      input.addEventListener('change', () => handleFile(input.files[0]));
      box.addEventListener('click', () => input.click());
      box.addEventListener('dragover', e => { e.preventDefault(); box.style.background = 'var(--bg-2)'; });
      box.addEventListener('dragleave', () => { box.style.background = ''; });
      box.addEventListener('drop', e => { e.preventDefault(); box.style.background = ''; handleFile(e.dataTransfer.files[0]); });
      box.appendChild(input);
    } else {
      const card = document.createElement('div'); card.className = 'file-card';
      const icon = document.createElement('i'); icon.className = 'ti ' + fileIconClass(b.mime, b.name);
      const meta = document.createElement('div'); meta.className = 'file-meta';
      const nm = document.createElement('div'); nm.className = 'file-name'; nm.textContent = b.name;
      const sz = document.createElement('div'); sz.className = 'file-size';
      sz.textContent = b.tooLarge ? 'too large to embed — use a link instead' : humanFileSize(b.size);
      meta.appendChild(nm); meta.appendChild(sz);
      card.appendChild(icon); card.appendChild(meta);
      if (!b.tooLarge && b.src){
        const dl = document.createElement('a'); dl.href = b.src; dl.download = b.name; dl.className = 'file-dl'; dl.innerHTML = '<i class="ti ti-download"></i>';
        card.appendChild(dl);
      }
      box.appendChild(card);
    }
    content.appendChild(box);
  } else if (b.type === 'bookmark'){
    const box = document.createElement('div'); box.className = 'bookmark-box';
    if (!b.url){
      const ph = document.createElement('button'); ph.type = 'button'; ph.className = 'bookmark-ph';
      ph.innerHTML = '<i class="ti ti-bookmark"></i><span>paste a URL to bookmark</span>';
      ph.addEventListener('click', () => {
        const url = prompt('URL to bookmark (https://…)');
        if (!url || !/^https?:\/\//i.test(url.trim())) return;
        const trimmed = url.trim();
        b.url = trimmed; b.fetchFailed = false; touchSelected(); save(); renderPage();
        fetchBookmark(b, trimmed);
      });
      box.appendChild(ph);
    } else if (b.fetchFailed){
      const card = document.createElement('a'); card.className = 'bookmark-plain'; card.href = b.url; card.target = '_blank'; card.rel = 'noopener noreferrer';
      card.innerHTML = '<i class="ti ti-link"></i>';
      const span = document.createElement('span'); span.textContent = b.url; card.appendChild(span);
      box.appendChild(card);
    } else if (!b.title){
      const loading = document.createElement('div'); loading.className = 'bookmark-loading';
      loading.innerHTML = '<i class="ti ti-loader-2"></i><span>fetching preview…</span>';
      box.appendChild(loading);
    } else {
      const card = document.createElement('a'); card.className = 'bookmark-card'; card.href = b.url; card.target = '_blank'; card.rel = 'noopener noreferrer';
      const info = document.createElement('div'); info.className = 'bookmark-info';
      const title = document.createElement('div'); title.className = 'bookmark-title'; title.textContent = b.title;
      if (b.description){ const d = document.createElement('div'); d.className = 'bookmark-desc'; d.textContent = b.description; info.appendChild(title); info.appendChild(d); }
      else info.appendChild(title);
      const domainRow = document.createElement('div'); domainRow.className = 'bookmark-domain';
      const fav = document.createElement('img'); fav.className = 'bookmark-favicon'; fav.src = b.favicon; fav.alt = '';
      fav.addEventListener('error', () => { fav.style.visibility = 'hidden'; });
      const domainText = document.createElement('span'); domainText.textContent = b.domain;
      domainRow.appendChild(fav); domainRow.appendChild(domainText);
      info.appendChild(domainRow);
      card.appendChild(info);
      box.appendChild(card);
    }
    content.appendChild(box);
  } else if (b.type === 'embed'){
    const box = document.createElement('div'); box.className = 'embed-box';
    if (!b.url){
      const ph = document.createElement('button'); ph.type = 'button'; ph.className = 'embed-ph';
      ph.innerHTML = '<i class="ti ti-code"></i><span>paste a Figma, CodePen, or Google Maps link</span>';
      ph.addEventListener('click', () => {
        const url = prompt('URL to embed (Figma, CodePen, or Google Maps)');
        if (!url || !url.trim()) return;
        const trimmed = url.trim();
        const embedSrc = transformEmbedUrl(trimmed);
        if (embedSrc){ b.url = trimmed; b.embedSrc = embedSrc; touchSelected(); save(); renderPage(); }
        else {
          applyType(b, 'bookmark'); b.url = trimmed; b.fetchFailed = false; touchSelected(); save(); renderPage();
          fetchBookmark(b, trimmed);
        }
      });
      box.appendChild(ph);
    } else {
      const frame = document.createElement('iframe'); frame.className = 'embed-frame'; frame.src = b.embedSrc;
      frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups');
      frame.loading = 'lazy';
      box.appendChild(frame);
    }
    content.appendChild(box);
  } else if (b.type === 'cols'){
    (b.cols || [[], []]).forEach((colBlocks, ci) => {
      const col = document.createElement('div'); col.className = 'col'; col.dataset.colIdx = ci;
      if (colBlocks.length === 0){
        const empty = document.createElement('div'); empty.className = 'child-empty'; empty.textContent = 'empty column — click to add';
        empty.addEventListener('click', () => {
          const nb = { id:uid(), type:'text', text:'' }; b.cols[ci].push(nb); touchSelected(); save(); renderPage(); setTimeout(() => focusBlock(nb.id), 20);
        });
        col.appendChild(empty);
      } else {
        colBlocks.forEach(cb => col.appendChild(renderBlock(cb, colBlocks, note)));
      }
      content.appendChild(col);
    });
  } else if (b.type === 'page-link'){
    const target = b.target ? getNote(b.target) : null;
    const ed = document.createElement('div'); ed.className = 'editor';
    ed.textContent = target ? (target.title || 'Untitled') : (b.text || 'Untitled subpage');
    ed.addEventListener('click', () => {
      if (target) openPageTab(target.id);
      else {
        const cur = getNote(state.selectedId);
        const spNow = Date.now();
        const sp = { id:uid('n'), emoji:'📄', title:b.text || 'New page', tags:[], parent:cur.id, blocks:[{ id:uid(), type:'text', text:'' }], createdAt: spNow, updatedAt: spNow };
        state.notes.push(sp); b.target = sp.id; state.openIds.add(cur.id); touchSelected(); save();
        openPageTab(sp.id);
      }
    });
    content.appendChild(ed);
  } else {
    // Default/fallback path — every plain rich-text block type (text,
    // h1-h4, bullet, numbered, todo, toggle's own label, quote, callout)
    // renders as one contentEditable "editor" div whose innerHTML IS the
    // persisted b.text; see attachEditor() for the input/keydown wiring.
    const ed = document.createElement('div'); ed.className = 'editor'; ed.contentEditable = 'true'; ed.dataset.ph = phFor(b);
    ed.innerHTML = b.text || '';
    attachEditor(ed, b, parentList, false, note);
    content.appendChild(ed);
  }

  const blockBranches = note ? (note.branches||[]).filter(br => br.blockId === b.id) : [];
  if (blockBranches.length){
    const badge = document.createElement('button'); badge.className = 'nt-brbadge'; badge.title = 'View branches';
    badge.innerHTML = '<i class="ti ti-git-branch"></i><span>' + blockBranches.length + '</span>';
    badge.addEventListener('click', e => { e.stopPropagation(); openNoteBranch(blockBranches[blockBranches.length - 1].bid); });
    content.appendChild(badge);
  }

  el.appendChild(content);

  if (b.type === 'toggle'){
    const wrap = document.createElement('div'); wrap.className = 'child-wrap';
    if (!b.children) b.children = [];
    if (b.children.length === 0){
      const empty = document.createElement('div'); empty.className = 'child-empty'; empty.textContent = 'empty — click to add';
      empty.addEventListener('click', () => { const nb = { id:uid(), type:'text', text:'' }; b.children.push(nb); touchSelected(); save(); renderPage(); setTimeout(() => focusBlock(nb.id), 20); });
      wrap.appendChild(empty);
    } else {
      b.children.forEach(cb => wrap.appendChild(renderBlock(cb, b.children, note)));
    }
    el.appendChild(wrap);
  } else if (b.children?.length){
    // Any block type can gain nested children via Tab-indent (indentBlock), not just toggles.
    const wrap = document.createElement('div'); wrap.className = 'child-wrap indent-children';
    b.children.forEach(cb => wrap.appendChild(renderBlock(cb, b.children, note)));
    el.appendChild(wrap);
  }
  return el;
}

// Placeholder text shown (via CSS ::before on data-ph) when a block's editor is empty.
function phFor(b){
  if (b.type === 'h1') return 'Heading 1';
  if (b.type === 'h2') return 'Heading 2';
  if (b.type === 'h3') return 'Heading 3';
  if (b.type === 'h4') return 'Heading 4';
  if (b.type === 'bullet' || b.type === 'numbered') return 'List';
  if (b.type === 'todo') return 'To-do';
  if (b.type === 'toggle') return 'Toggle';
  if (b.type === 'quote') return 'Quote';
  if (b.type === 'callout') return 'Callout';
  return "Type '/' for commands";
}

// Focuses a block's editor by id and places the caret at its end — used
// after every structural block operation (insert/split/indent/outdent) that
// is immediately followed by `setTimeout(() => focusBlock(id), ~20)`. The
// small delay lets the just-triggered renderPage() finish rebuilding the DOM
// first, since the target element doesn't exist yet during the same tick.
function focusBlock(id){
  const ed = $('#nt-page')?.querySelector('[data-bid="' + id + '"] .editor');
  if (ed){ ed.focus(); placeCaretEnd(ed); }
}
// Collapses the browser Selection to the end of an element's content —
// the standard DOM Range recipe for "put the caret at the end" since there's
// no simpler native API for contentEditable elements.
function placeCaretEnd(el){
  const r = document.createRange(); r.selectNodeContents(el); r.collapse(false);
  const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
}

// Lightweight per-block actions menu, triggered from the grip icon — uses a
// native prompt() rather than a styled dropdown, a deliberately minimal
// implementation (grip's primary job is drag; this covers delete/duplicate).
function blockMenu(b, parentList){
  const choice = prompt('block actions: type "del" to delete, "dup" to duplicate, or cancel', 'dup');
  if (choice === 'del'){ removeBlock(parentList, b.id); if (parentList.length === 0) parentList.push({ id:uid(), type:'text', text:'' }); touchSelected(); save(); renderPage(); }
  else if (choice === 'dup'){ const c = JSON.parse(JSON.stringify(b)); c.id = uid(); insertAfter(parentList, b.id, c); touchSelected(); save(); renderPage(); }
}

// ---------- drag-to-reorder ----------
// Native HTML5 drag-and-drop, initiated only from a block's grip handle
// (not the whole block, so text selection inside the editor isn't hijacked
// into a drag). dragCtx tracks the block+list being dragged across the
// dragstart/dragover/drop sequence, mirroring sideDragCtx for the sidebar tree.
let dragCtx = null;

function clearDropMarks(){
  $$('#nt-page .b.drop-above, #nt-page .b.drop-below, #nt-page .b.drop-into').forEach(x => x.classList.remove('drop-above', 'drop-below', 'drop-into'));
}

// Wires one block's grip as a drag source and the block itself as a drop
// target. Dropping on the left 2/3 of a toggle block reorders as a sibling
// (drop-above/drop-below); dropping on its right third nests the dragged
// block inside the toggle as a new child (drop-into) — the array splice
// happens immediately on drop, then saves + re-renders.
function wireBlockDrag(el, grip, b, parentList){
  grip.draggable = true;
  grip.addEventListener('dragstart', e => {
    e.stopPropagation();
    dragCtx = { id: b.id, list: parentList };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', b.id);
    e.dataTransfer.setDragImage(el, 0, 0);
    setTimeout(() => el.classList.add('dragging'), 0);
  });
  grip.addEventListener('dragend', () => { dragCtx = null; el.classList.remove('dragging'); clearDropMarks(); });

  el.addEventListener('dragover', e => {
    if (!dragCtx || dragCtx.id === b.id || el.closest('.b.dragging')) return;
    e.preventDefault(); e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    const r = el.getBoundingClientRect();
    clearDropMarks();
    if (b.type === 'toggle' && e.clientX > r.left + r.width * 2 / 3){
      el.classList.add('drop-into');
    } else {
      el.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-above' : 'drop-below');
    }
  });
  el.addEventListener('dragleave', e => {
    if (!el.contains(e.relatedTarget)) el.classList.remove('drop-above', 'drop-below', 'drop-into');
  });
  el.addEventListener('drop', e => {
    if (!dragCtx || dragCtx.id === b.id || el.closest('.b.dragging')) return;
    e.preventDefault(); e.stopPropagation();
    const r = el.getBoundingClientRect();
    const nestZone = b.type === 'toggle' && e.clientX > r.left + r.width * 2 / 3;
    const above = e.clientY < r.top + r.height / 2;
    const si = dragCtx.list.findIndex(x => x.id === dragCtx.id);
    if (si === -1){ dragCtx = null; clearDropMarks(); return; }
    const [moved] = dragCtx.list.splice(si, 1);
    if (nestZone){
      if (!b.children) b.children = [];
      b.children.push(moved);
      b.open = true;
    } else {
      let ti = parentList.findIndex(x => x.id === b.id);
      if (!above) ti += 1;
      parentList.splice(ti, 0, moved);
    }
    dragCtx = null; clearDropMarks();
    touchSelected(); save(); renderPage();
  });
}

// ---------- page-wide select & copy (⌘A ⌘A → ⌘C, or drag across blocks) ----------
let blockSelAll = false;
let blockSelIds = null; // Set of top-level block ids, for a partial drag-selected range

function selectAllBlocks(){
  const page = $('#nt-page'); if (!page) return;
  window.getSelection()?.removeAllRanges();
  if (document.activeElement && page.contains(document.activeElement)) document.activeElement.blur();
  $$('#nt-page .b').forEach(x => x.classList.add('bsel'));
  blockSelAll = true;
  blockSelIds = null;
}
function clearBlockSel(){
  if (!blockSelAll && !blockSelIds) return;
  $$('#nt-page .b.bsel').forEach(x => x.classList.remove('bsel'));
  blockSelAll = false;
  blockSelIds = null;
}

// mouse drag across multiple sibling blocks: each block is its own
// contenteditable, so the browser's native Selection can't span them (Chrome
// clamps a cross-editing-host Selection to the host the drag started in).
// We detect the crossing and fall back to our own highlight + text copy.
let blockDragCtx = null; // { list, startId, startIdx }

// Maps a DOM node under the mouse back to its top-level block + index in the
// page's own `n.blocks` array (only top-level; nested toggle/column children
// return null and are excluded from range-select, since a range spanning
// mixed nesting levels has no well-defined selection semantics here).
function topLevelBlockAt(el){
  const wrap = el?.closest?.('#nt-page .b'); if (!wrap) return null;
  const id = wrap.dataset.bid;
  const n = getNote(state.selectedId); if (!n) return null;
  const idx = (n.blocks || []).findIndex(x => x.id === id);
  if (idx === -1) return null; // nested (toggle/column child) — not supported for range-select
  return { id, idx, list: n.blocks };
}

// Highlights every block between indices i0 and i1 (inclusive, any order)
// with the `.bsel` class and records the selected id set for later copy.
function paintBlockRange(list, i0, i1){
  const lo = Math.min(i0, i1), hi = Math.max(i0, i1);
  const ids = new Set(list.slice(lo, hi + 1).map(x => x.id));
  $$('#nt-page .b').forEach(x => x.classList.toggle('bsel', ids.has(x.dataset.bid)));
  blockSelIds = ids;
  blockSelAll = false;
}

// Installs the mousedown/mousemove/mouseup listeners on #nt-page that detect
// a mouse drag crossing from one block's editor into another and switch to
// the custom cross-block highlight (see the comment above blockDragCtx for
// why the browser's native Selection can't do this itself).
function wireBlockRangeDrag(){
  const page = $('#nt-page'); if (!page) return;
  page.addEventListener('mousedown', e => {
    if (e.button !== 0 || !e.target.closest('.editor')) return;
    const start = topLevelBlockAt(e.target);
    if (!start) { blockDragCtx = null; return; }
    blockDragCtx = { list: start.list, startId: start.id, startIdx: start.idx, crossed: false };
  });
  page.addEventListener('mousemove', e => {
    if (!blockDragCtx || e.buttons !== 1) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const cur = topLevelBlockAt(el); if (!cur || cur.list !== blockDragCtx.list) return;
    if (cur.idx === blockDragCtx.startIdx && !blockDragCtx.crossed) return; // still inside the start block — let native selection handle it
    blockDragCtx.crossed = true;
    window.getSelection()?.removeAllRanges();
    paintBlockRange(blockDragCtx.list, blockDragCtx.startIdx, cur.idx);
  });
  document.addEventListener('mouseup', () => { blockDragCtx = null; });
}

function stripHtml(html){
  const d = document.createElement('div'); d.innerHTML = html || '';
  return d.textContent || '';
}

// ---------- table of contents block (derived, nothing extra persisted) ----------
// The 'toc' block type has no persisted content of its own — it's rebuilt
// from the page's current headings every render (buildTocBody) and patched
// live on edit (refreshToc), so a toc block never goes stale relative to the
// headings around it.
function collectHeadings(list, out = []){
  for (const b of list || []){
    if (['h1','h2','h3','h4'].includes(b.type)) out.push({ id:b.id, level:Number(b.type[1]), text:stripHtml(b.text) });
    if (b.children?.length) collectHeadings(b.children, out);
    if (b.cols) b.cols.forEach(c => collectHeadings(c, out));
  }
  return out;
}
function buildTocBody(note){
  const body = document.createElement('div'); body.className = 'toc-body';
  const heads = collectHeadings(note ? note.blocks : []);
  if (!heads.length){
    body.innerHTML = '<div class="toc-empty">No headings yet — add a Heading block to populate this list.</div>';
    return body;
  }
  const minLevel = Math.min(...heads.map(h => h.level));
  heads.forEach(h => {
    const row = document.createElement('button'); row.type = 'button'; row.className = 'toc-row';
    row.style.paddingLeft = ((h.level - minLevel) * 14) + 'px';
    row.textContent = h.text || 'Untitled heading';
    row.addEventListener('click', () => jumpToBlock(h.id));
    body.appendChild(row);
  });
  return body;
}
// Scrolls a TOC entry's target heading into view and briefly flashes it so
// the user can visually locate the jump target.
function jumpToBlock(id){
  const el = $('#nt-page [data-bid="' + id + '"]'); if (!el) return;
  el.scrollIntoView({ behavior:'smooth', block:'center' });
  el.classList.add('jump-flash');
  setTimeout(() => el.classList.remove('jump-flash'), 900);
}
// Called from attachEditor's input handler whenever a heading block changes,
// so any toc block(s) on the page update without a full renderPage().
function refreshToc(note){
  if (!note) return;
  $$('#nt-page .b.toc .toc-body').forEach(old => old.replaceWith(buildTocBody(note)));
}

// Plain-text serialization of a block list (recursively), used for
// clipboard copy (⌘C on a page/range selection) — strips all HTML, unlike
// blocksToMarkdown() below which is used for file export and keeps Markdown syntax.
function blocksToText(list, depth = 0){
  const ind = '  '.repeat(depth);
  const out = [];
  let num = 0;
  for (const b of list || []){
    num = b.type === 'numbered' ? num + 1 : 0;
    if (b.type === 'h1') out.push(ind + '# ' + stripHtml(b.text));
    else if (b.type === 'h2') out.push(ind + '## ' + stripHtml(b.text));
    else if (b.type === 'h3') out.push(ind + '### ' + stripHtml(b.text));
    else if (b.type === 'h4') out.push(ind + '#### ' + stripHtml(b.text));
    else if (b.type === 'bullet') out.push(ind + '- ' + stripHtml(b.text));
    else if (b.type === 'numbered') out.push(ind + num + '. ' + stripHtml(b.text));
    else if (b.type === 'todo') out.push(ind + (b.done ? '- [x] ' : '- [ ] ') + stripHtml(b.text));
    else if (b.type === 'quote') out.push(ind + '> ' + stripHtml(b.text));
    else if (b.type === 'callout') out.push(ind + (b.emoji || '💡') + ' ' + stripHtml(b.text));
    else if (b.type === 'toggle') out.push(ind + stripHtml(b.text));
    else if (b.type === 'divider') out.push(ind + '---');
    else if (b.type === 'code') out.push(ind + '```' + (b.lang && b.lang !== 'plain' ? b.lang : ''), b.text || '', ind + '```');
    else if (b.type === 'image'){ if (b.caption) out.push(ind + '[image] ' + stripHtml(b.caption)); }
    else if (b.type === 'table') (b.rows || []).forEach(r => out.push(ind + r.map(stripHtml).join(' | ')));
    else if (b.type === 'cols') (b.cols || []).forEach(c => { const t = blocksToText(c, depth); if (t) out.push(t); });
    else if (b.type === 'page-link'){
      const t = b.target ? getNote(b.target) : null;
      out.push(ind + '📄 ' + (t ? (t.title || 'Untitled') : (b.text || 'Untitled subpage')));
    }
    else if (b.type === 'media'){ if (b.url) out.push(ind + '[' + (b.kind || 'media') + '] ' + b.url); }
    else if (b.type === 'file'){ if (b.name) out.push(ind + '[file] ' + b.name); }
    else if (b.type === 'bookmark'){ if (b.url) out.push(ind + '[bookmark] ' + (b.title || b.url)); }
    else if (b.type === 'embed'){ if (b.url) out.push(ind + '[embed] ' + b.url); }
    else if (b.type === 'toc') { /* derived from the page's headings, nothing extra to export */ }
    else out.push(ind + stripHtml(b.text));
    // Nesting via Tab-indent isn't limited to toggles (see indentBlock) —
    // any block type can carry indented children, so recurse regardless of type.
    if (b.type !== 'cols' && b.children?.length) out.push(blocksToText(b.children, depth + 1));
  }
  return out.join('\n');
}

// Whole-page plain-text serialization (title + all blocks) — used for the
// ⌘A ⌘A → ⌘C "copy whole page" path.
function noteToText(n){
  const head = n.title ? n.title + '\n\n' : '';
  return head + blocksToText(n.blocks, 0);
}

// ---------- export: page (+ subpages) as a single Markdown file ----------
// b.text holds inline HTML (bold/italic/links/etc.) for rich blocks; kept
// as-is rather than converted, since Markdown renderers accept inline HTML.
// GitHub-Markdown-style heading anchor slug, used for the page-link "jump to
// section" fragment in exported Markdown (#slug).
function slugifyHeading(s){
  return String(s || '').toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/\s+/g, '-') || 'untitled';
}
// Finds subpages referenced via an in-content page-link block (as opposed to
// the sidebar-tree parent/child relationship) so noteToMarkdown() can walk
// both kinds of subpage relationship when flattening into one export file.
function collectSubpageIds(list, out = []){
  for (const b of list || []){
    if (b.type === 'page-link' && b.target) out.push(b.target);
    if (b.children?.length) collectSubpageIds(b.children, out);
    if (b.cols) b.cols.forEach(c => collectSubpageIds(c, out));
  }
  return out;
}
// Markdown serialization of a block list, for the "export as .md" feature —
// unlike blocksToText(), this keeps b.text's inline HTML (bold/italic/links)
// as-is rather than stripping it, since Markdown renderers tolerate inline
// HTML fine (see the file-export section-header comment above).
function blocksToMarkdown(list, depth = 0){
  const ind = '  '.repeat(depth);
  const out = [];
  let num = 0;
  for (const b of list || []){
    num = b.type === 'numbered' ? num + 1 : 0;
    if (b.type === 'h1') out.push(ind + '# ' + (b.text || ''));
    else if (b.type === 'h2') out.push(ind + '## ' + (b.text || ''));
    else if (b.type === 'h3') out.push(ind + '### ' + (b.text || ''));
    else if (b.type === 'h4') out.push(ind + '#### ' + (b.text || ''));
    else if (b.type === 'bullet') out.push(ind + '- ' + (b.text || ''));
    else if (b.type === 'numbered') out.push(ind + num + '. ' + (b.text || ''));
    else if (b.type === 'todo') out.push(ind + (b.done ? '- [x] ' : '- [ ] ') + (b.text || ''));
    else if (b.type === 'quote') out.push(ind + '> ' + (b.text || ''));
    else if (b.type === 'callout') out.push(ind + '> ' + (b.emoji || '💡') + ' ' + (b.text || ''));
    else if (b.type === 'toggle') out.push(ind + '**' + (stripHtml(b.text) || 'Toggle') + '**');
    else if (b.type === 'divider') out.push(ind + '---');
    else if (b.type === 'code') out.push([ind + '```' + (b.lang && b.lang !== 'plain' ? b.lang : ''), b.text || '', ind + '```'].join('\n'));
    else if (b.type === 'equation') out.push(ind + '$$' + (b.text || '') + '$$');
    else if (b.type === 'image'){ if (b.src) out.push(ind + '![' + stripHtml(b.caption || '') + '](' + b.src + ')'); }
    else if (b.type === 'table'){
      const rows = b.rows || [];
      if (rows.length){
        const cell = c => (c || '').replace(/\|/g, '\\|');
        const lines = [ind + '| ' + rows[0].map(cell).join(' | ') + ' |', ind + '| ' + rows[0].map(() => '---').join(' | ') + ' |'];
        rows.slice(1).forEach(r => lines.push(ind + '| ' + r.map(cell).join(' | ') + ' |'));
        out.push(lines.join('\n'));
      }
    }
    else if (b.type === 'cols') (b.cols || []).forEach(c => { const t = blocksToMarkdown(c, depth); if (t) out.push(t); });
    else if (b.type === 'page-link'){
      const t = b.target ? getNote(b.target) : null;
      const title = t ? (t.title || 'Untitled') : (b.text || 'Untitled subpage');
      out.push(ind + '📄 [' + title + '](#' + slugifyHeading(title) + ')');
    }
    else if (b.type === 'media'){ if (b.url) out.push(ind + '[' + (b.kind || 'media') + '](' + b.url + ')'); }
    else if (b.type === 'file'){ if (b.src) out.push(ind + '[' + (b.name || 'file') + '](' + b.src + ')'); }
    else if (b.type === 'bookmark'){ if (b.url) out.push(ind + '[' + (b.title || b.url) + '](' + b.url + ')'); }
    else if (b.type === 'embed'){ if (b.url) out.push(ind + '[embed](' + b.url + ')'); }
    else if (b.type === 'toc'){ /* derived from headings, nothing extra to export */ }
    else out.push(ind + (b.text || ''));
    // Nesting via Tab-indent isn't limited to toggles (see indentBlock) —
    // any block type can carry indented children, so recurse regardless of type.
    if (b.type !== 'cols' && b.children?.length){ const t = blocksToMarkdown(b.children, depth + 1); if (t) out.push(t); }
  }
  return out.join('\n\n');
}
// walks subpages recursively so they land as sections in the same file —
// both sidebar-tree children (kidsOf, n.parent) and in-content page-link
// targets (collectSubpageIds), since a subpage can exist via either path;
// a visited set guards against duplicates and a subpage linking back up
function noteToMarkdown(note){
  const visited = new Set();
  const sections = [];
  (function emit(n, depth){
    if (!n || visited.has(n.id)) return;
    visited.add(n.id);
    sections.push((depth === 0 ? '# ' : '## ') + (n.title || 'Untitled'));
    const body = blocksToMarkdown(n.blocks, 0);
    if (body) sections.push(body);
    const childIds = new Set([...kidsOf(n.id).map(c => c.id), ...collectSubpageIds(n.blocks)]);
    childIds.forEach(sid => emit(getNote(sid), 1));
  })(note, 0);
  return sections.join('\n\n---\n\n') + '\n';
}
// Saves the exported Markdown, trying progressively more-native mechanisms
// and falling back gracefully: a native app bridge (if wrapped in a webview),
// then the backend's save-file endpoint, then the browser's native
// showSaveFilePicker, and finally a plain <a download> blob URL for browsers
// that support none of the above.
async function exportNoteMarkdown(note){
  const md = noteToMarkdown(note);
  const filename = (note.title || 'Untitled').replace(/[\\/:*?"<>|]/g, '').trim() + '.md';
  if (window.webkit?.messageHandlers?.notlinear){
    window.webkit.messageHandlers.notlinear.postMessage({ action:'saveFile', filename, content: md });
    return;
  }
  try {
    const res = await fetch('/__notlinear_save_file', {
      method:'POST', headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ filename, content: md }),
    });
    const json = await res.json();
    if (json.ok || json.cancelled) return;
  } catch (_) {}
  if (window.showSaveFilePicker){
    try {
      const handle = await window.showSaveFilePicker({ suggestedName: filename, types:[{ description:'Markdown', accept:{ 'text/markdown':['.md'] } }] });
      const writable = await handle.createWritable();
      await writable.write(md);
      await writable.close();
      return;
    } catch (err) { if (err.name === 'AbortError') return; }
  }
  const blob = new Blob([md], { type:'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.style.display = 'none';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// ---------- per-block editor wiring ----------
// Attaches the common event set every rich-text/plaintext block editor
// needs: persist on input (debounced via save()), route keydown to
// onEditorKey (Enter/Backspace/Tab/arrow/slash-menu/mention-menu handling),
// route paste to onEditorPaste (image paste), and show/hide the floating
// format toolbar on selection change. `plain` distinguishes plaintext-only
// editors (code/eq blocks, where b.text = ed.textContent) from rich ones
// (b.text = ed.innerHTML, preserving bold/italic/links/etc).
function attachEditor(ed, b, parentList, plain, note){
  ed.addEventListener('input', () => {
    b.text = plain ? ed.textContent : ed.innerHTML;
    touchSelected(); save();
    if (!plain) maybeMarkdownShortcut(ed, b, parentList);
    maybeOpenSlash(ed, b, parentList);
    if (!plain) maybeOpenMention(ed, b);
    if (['h1','h2','h3','h4'].includes(b.type)) refreshToc(getNote(state.selectedId));
  });
  ed.addEventListener('keydown', e => onEditorKey(e, ed, b, parentList, plain, note));
  ed.addEventListener('paste', e => onEditorPaste(e, ed, b, parentList));
  ed.addEventListener('mouseup', () => maybeShowToolbar(ed));
  ed.addEventListener('keyup', e => { if (e.shiftKey || ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) maybeShowToolbar(ed); });
  ed.addEventListener('blur', () => setTimeout(() => { if (!isToolbarFocused()) hideToolbar(); }, 100));
  if (!plain){ wireAnchorSpans(ed); wireEqSpans(ed, b); wireMentionSpans(ed); }
}

// Pasted images (screenshots, copied files) land as proper Image blocks — with
// the existing max-width clamp + drag-to-resize handle — instead of the browser's
// default behavior of dumping a full-resolution <img> inline with no size limit.
function onEditorPaste(e, ed, b, parentList){
  const items = e.clipboardData && e.clipboardData.items; if (!items) return;
  const files = [];
  for (const item of items){
    if (item.kind === 'file' && item.type.startsWith('image/')){
      const f = item.getAsFile(); if (f) files.push(f);
    }
  }
  if (!files.length) return;
  e.preventDefault();
  (async () => {
    let afterId = b.id;
    const emptyTextBlock = b.type === 'text' && !ed.textContent.trim();
    for (let i = 0; i < files.length; i++){
      const src = await new Promise((resolve, reject) => {
        const fr = new FileReader(); fr.onload = () => resolve(fr.result); fr.onerror = reject; fr.readAsDataURL(files[i]);
      });
      if (i === 0 && emptyTextBlock){
        b.type = 'image'; b.src = src; b.caption = ''; delete b.text;
      } else {
        const nb = { id:uid(), type:'image', src, caption:'' };
        insertAfter(parentList, afterId, nb); afterId = nb.id;
      }
    }
    touchSelected(); save(); renderPage();
  })();
}

// Central keydown handler for every block editor — first defers to the
// slash-menu / mention-menu if one is open (arrow keys navigate it, Enter/Tab
// picks, Escape closes it), then handles Notion-style block-editing keys:
// Tab/Shift+Tab indent/outdent, ⌘A block-then-page select, formatting
// shortcuts (⌘B/I/U/E, ⌘⇧H), Enter to split into a new block, Backspace at
// an empty/start position to merge into the previous block or demote a
// styled block back to plain text, and Up/Down at the caret's start/end to
// move focus to the sibling block.
function onEditorKey(e, ed, b, parentList, plain, note){
  const slash = $('#nt-slash');
  if (slash?.classList.contains('show')){
    if (e.key === 'ArrowDown'){ e.preventDefault(); slashMove(1); return; }
    if (e.key === 'ArrowUp'){ e.preventDefault(); slashMove(-1); return; }
    if (e.key === 'Enter' || e.key === 'Tab'){ e.preventDefault(); slashPick(); return; }
    if (e.key === 'Escape'){ e.preventDefault(); hideSlash(); return; }
  }
  const mention = $('#nt-mention');
  if (mention?.classList.contains('show')){
    if (e.key === 'ArrowDown'){ e.preventDefault(); mentionMove(1); return; }
    if (e.key === 'ArrowUp'){ e.preventDefault(); mentionMove(-1); return; }
    if (e.key === 'Enter' || e.key === 'Tab'){ e.preventDefault(); mentionPick(); return; }
    if (e.key === 'Escape'){ e.preventDefault(); hideMention(); return; }
  }

  if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.altKey){
    e.preventDefault();
    if (e.shiftKey){
      if (outdentBlock(b, parentList, note)){ touchSelected(); save(); renderPage(); setTimeout(() => focusBlock(b.id), 20); }
      return;
    }
    if (indentBlock(b, parentList)){ touchSelected(); save(); renderPage(); setTimeout(() => focusBlock(b.id), 20); return; }
    // No preceding sibling to nest under (e.g. first block in the list) — insert a literal tab
    // on the current line instead of silently doing nothing.
    document.execCommand('insertText', false, '\t');
    return;
  }

  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'a'){
    // ⌘A once selects this block's text; ⌘A again (or on an empty block) selects the whole page
    const txt = ed.textContent;
    const s = window.getSelection();
    if (!txt || (s && s.toString() === txt)){
      e.preventDefault();
      selectAllBlocks();
      return;
    }
  }

  if (!plain && (e.metaKey || e.ctrlKey)){
    const k = e.key.toLowerCase();
    if (k === 'b'){ e.preventDefault(); document.execCommand('bold'); return; }
    if (k === 'i'){ e.preventDefault(); document.execCommand('italic'); return; }
    if (k === 'u'){ e.preventDefault(); document.execCommand('underline'); return; }
    if (k === 'e'){ e.preventDefault(); wrapSelection('code'); return; }
    if (e.shiftKey && k === 'h'){ e.preventDefault(); wrapSelection('mark'); return; }
  }

  if (e.key === 'Enter' && !e.shiftKey){
    if (plain) return;
    e.preventDefault();
    hideSlash();
    if (!ed.textContent.trim()){
      if (['h1','h2','h3','h4','bullet','numbered','todo','quote','callout','toggle'].includes(b.type)){
        b.type = 'text'; delete b.headingLevel; delete b.emoji; touchSelected(); save(); renderPage(); setTimeout(() => focusBlock(b.id), 20); return;
      }
    }
    const nextType = ['bullet','numbered','todo'].includes(b.type) ? b.type : 'text';
    const nb = { id:uid(), type:nextType, text:'' };
    if (nextType === 'todo') nb.done = false;
    insertAfter(parentList, b.id, nb); touchSelected(); save(); renderPage(); setTimeout(() => focusBlock(nb.id), 20);
    return;
  }

  if (e.key === 'Backspace'){
    if (!ed.textContent && isCaretAtStart(ed)){
      e.preventDefault();
      if (['h1','h2','h3','h4','bullet','numbered','todo','quote','callout','toggle'].includes(b.type)){
        b.type = 'text'; touchSelected(); save(); renderPage(); setTimeout(() => focusBlock(b.id), 20); return;
      }
      const i = parentList.findIndex(x => x.id === b.id);
      if (i > 0){
        const prev = parentList[i - 1];
        removeBlock(parentList, b.id);
        if (parentList.length === 0) parentList.push({ id:uid(), type:'text', text:'' });
        touchSelected(); save(); renderPage(); setTimeout(() => focusBlock(prev.id), 20);
      }
      return;
    }
  }

  if (e.key === 'ArrowUp' && isCaretAtStart(ed)){
    const i = parentList.findIndex(x => x.id === b.id);
    if (i > 0){ e.preventDefault(); focusBlock(parentList[i - 1].id); }
  }
  if (e.key === 'ArrowDown' && isCaretAtEnd(ed)){
    const i = parentList.findIndex(x => x.id === b.id);
    if (i < parentList.length - 1){ e.preventDefault(); focusBlock(parentList[i + 1].id); }
  }
}

// Both isCaretAtStart/isCaretAtEnd use the same trick: build a "probe" Range
// spanning from the editor's start (or the caret, for the End check) to the
// caret, then measure its rendered text length. Zero-length means the caret
// has no text before (or after) it — i.e. it's at the very start (or end) of
// the editor's content. This is more reliable than comparing offsets
// directly since contentEditable can spread text across many nested nodes.
function isCaretAtStart(ed){
  const s = window.getSelection(); if (!s.rangeCount) return true;
  const r = s.getRangeAt(0); if (!r.collapsed) return false;
  const probe = document.createRange(); probe.selectNodeContents(ed); probe.setEnd(r.endContainer, r.endOffset);
  return probe.toString().length === 0;
}
function isCaretAtEnd(ed){
  const s = window.getSelection(); if (!s.rangeCount) return true;
  const r = s.getRangeAt(0); if (!r.collapsed) return false;
  const probe = document.createRange(); probe.selectNodeContents(ed); probe.setStart(r.endContainer, r.endOffset);
  return probe.toString().length === 0;
}

// ---------- code block syntax highlighting (hljs — colors via tokens.css, no stock theme) ----------
// caretOffset/setCaretOffset convert between a plain character offset and a
// live DOM Selection, needed because re-highlighting a code block replaces
// its innerHTML wholesale (hljs.highlight() returns fresh markup with new
// text nodes) which would otherwise silently drop the caret; capturing the
// offset before and restoring it after keeps typing feeling uninterrupted.
function caretOffset(el){
  const s = window.getSelection(); if (!s.rangeCount) return el.textContent.length;
  const r = s.getRangeAt(0); if (!el.contains(r.endContainer)) return el.textContent.length;
  const probe = document.createRange(); probe.selectNodeContents(el); probe.setEnd(r.endContainer, r.endOffset);
  return probe.toString().length;
}
// Walks the element's text nodes (TreeWalker) to find the node/offset pair
// `offset` characters in, then collapses the Selection there.
function setCaretOffset(el, offset){
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node, count = 0;
  while ((node = walker.nextNode())){
    const next = count + node.length;
    if (offset <= next){
      const range = document.createRange(); range.setStart(node, offset - count); range.collapse(true);
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(range);
      return;
    }
    count = next;
  }
  const range = document.createRange(); range.selectNodeContents(el); range.collapse(false);
  const s = window.getSelection(); s.removeAllRanges(); s.addRange(range);
}
// Re-renders a code block's editor with hljs syntax-highlighting markup.
// Debounced (300ms, see the `input`/`blur` wiring where this is called from)
// rather than run on every keystroke — highlighting on every character
// during fast typing would visibly stutter for larger code blocks. hljs is
// loaded globally (not imported) and is optional: if it's unavailable, or
// the language is 'plain', falls back to plain textContent, and highlight
// errors (e.g. an hljs internal issue) also fail safe to plain text rather
// than corrupting the block.
function highlightCodeEditor(ed, b){
  const text = b.text || '';
  if (typeof hljs === 'undefined' || !b.lang || b.lang === 'plain'){ ed.textContent = text; return; }
  const focused = document.activeElement === ed;
  const offset = focused ? caretOffset(ed) : 0;
  try {
    ed.innerHTML = hljs.highlight(text, { language: b.lang, ignoreIllegals: true }).value;
  } catch {
    ed.textContent = text; return;
  }
  if (focused) setCaretOffset(ed, offset);
}

// ---------- LaTeX rendering (KaTeX) ----------
// Renders a block-equation's LaTeX source into `target` via the globally
// loaded KaTeX library (optional dependency, like hljs above — falls back to
// plain text if KaTeX isn't present). Invalid LaTeX renders a calm inline
// error message instead of throwing up to the caller.
function renderEqPreview(target, text){
  target.classList.remove('eq-error');
  if (!text.trim()){ target.innerHTML = '<span class="eq-placeholder">preview will appear here</span>'; return; }
  if (typeof katex === 'undefined'){ target.textContent = text; return; }
  try {
    katex.render(text, target, { throwOnError: true, displayMode: true });
  } catch {
    target.classList.add('eq-error');
    target.innerHTML = '<div class="eq-error-msg"><i class="ti ti-alert-triangle"></i><span>invalid LaTeX</span></div>';
  }
}

// Notion-style Markdown auto-formatting: typing e.g. "# " at the start of a
// text block converts it into a Heading 1 block (clearing the trigger
// characters), mirroring the same conversions available via the slash menu.
// Checked on every input event (see attachEditor) after the slash/mention
// menu checks, so it only fires for the current block's whole text matching
// one of the trigger patterns exactly.
function maybeMarkdownShortcut(ed, b, parentList){
  const txt = ed.textContent;
  const map = [
    [/^# $/, 'h1'], [/^## $/, 'h2'], [/^### $/, 'h3'], [/^#### $/, 'h4'],
    [/^- $/, 'bullet'], [/^\* $/, 'bullet'], [/^\+ $/, 'bullet'],
    [/^1\. $/, 'numbered'],
    [/^\[\] $/, 'todo'], [/^\[ \] $/, 'todo'],
    [/^> $/, 'quote'],
    [/^--- $/, 'divider'],
  ];
  for (const [re, t] of map){
    if (re.test(txt)){
      b.type = t; b.text = '';
      if (t === 'todo') b.done = false;
      ed.innerHTML = ''; touchSelected(); save(); renderPage(); setTimeout(() => focusBlock(b.id), 10);
      return;
    }
  }
}

// ---------- slash menu ----------
// Static catalogue of every insertable block type, grouped into sections
// (rendered as non-selectable headers by renderSlash). `sc` is the Markdown
// shortcut shown next to each item as a hint (not itself executable — the
// actual Markdown-shortcut matching lives in maybeMarkdownShortcut above).
const SLASH_ITEMS = [
  { sec:'Basic blocks' },
  { id:'text', nm:'Text', sc:'', icon:'<i class="ti ti-typography"></i>' },
  { id:'page', nm:'Page', sc:'', icon:'<i class="ti ti-file"></i>' },
  { id:'h1', nm:'Heading 1', sc:'#', icon:'<span class="gly">H1</span>' },
  { id:'h2', nm:'Heading 2', sc:'##', icon:'<span class="gly">H2</span>' },
  { id:'h3', nm:'Heading 3', sc:'###', icon:'<span class="gly">H3</span>' },
  { id:'h4', nm:'Heading 4', sc:'####', icon:'<span class="gly">H4</span>' },
  { id:'bullet', nm:'Bulleted list', sc:'-', icon:'<i class="ti ti-list"></i>' },
  { id:'numbered', nm:'Numbered list', sc:'1.', icon:'<i class="ti ti-list-numbers"></i>' },
  { id:'todo', nm:'To-do list', sc:'[]', icon:'<i class="ti ti-square-check"></i>' },
  { id:'toggle', nm:'Toggle list', sc:'>', icon:'<i class="ti ti-chevron-right"></i>' },
  { sec:'Media & content' },
  { id:'code', nm:'Code', sc:'', icon:'<i class="ti ti-code"></i>' },
  { id:'quote', nm:'Quote', sc:'""', icon:'<i class="ti ti-quote"></i>' },
  { id:'callout', nm:'Callout', sc:'', icon:'<i class="ti ti-bulb"></i>' },
  { id:'divider', nm:'Divider', sc:'---', icon:'<i class="ti ti-separator-horizontal"></i>' },
  { id:'image', nm:'Image', sc:'', icon:'<i class="ti ti-photo"></i>' },
  { id:'table', nm:'Table', sc:'', icon:'<i class="ti ti-table"></i>' },
  { id:'media', nm:'Video / audio', sc:'', icon:'<i class="ti ti-movie"></i>' },
  { id:'file', nm:'File attachment', sc:'', icon:'<i class="ti ti-paperclip"></i>' },
  { id:'bookmark', nm:'Bookmark', sc:'', icon:'<i class="ti ti-bookmark"></i>' },
  { id:'embed', nm:'Embed', sc:'', icon:'<i class="ti ti-code"></i>' },
  { sec:'Advanced' },
  { id:'toggle-h1', nm:'Toggle heading 1', sc:'', icon:'<span class="gly">▸H1</span>' },
  { id:'toggle-h2', nm:'Toggle heading 2', sc:'', icon:'<span class="gly">▸H2</span>' },
  { id:'toggle-h3', nm:'Toggle heading 3', sc:'', icon:'<span class="gly">▸H3</span>' },
  { id:'cols-2', nm:'2 columns', sc:'', icon:'<i class="ti ti-columns-2"></i>' },
  { id:'cols-3', nm:'3 columns', sc:'', icon:'<i class="ti ti-columns-3"></i>' },
  { id:'equation', nm:'Block equation', sc:'', icon:'<span class="gly">Σ</span>' },
  { id:'toc', nm:'Table of contents', sc:'', icon:'<i class="ti ti-list-details"></i>' },
];
let slashState = { open:false, query:'', target:null, parentList:null, filtered:[], cursor:0 };

// Checked on every editor input event (see attachEditor). Builds a Range
// from the editor's start to the caret and reads its text back out — the
// same "probe range" technique used by isCaretAtStart/End — to see whether
// the text immediately before the caret matches a trailing "/query" run
// (with no other slash or whitespace inside it). If so, opens the menu with
// that text as the filter query; otherwise closes it.
function maybeOpenSlash(ed, b, parentList){
  const s = window.getSelection(); if (!s.rangeCount) return;
  const r = s.getRangeAt(0); if (!r.collapsed) return;
  const range = document.createRange(); range.selectNodeContents(ed); range.setEnd(r.endContainer, r.endOffset);
  const before = range.toString();
  const m = before.match(/(^|\s)(\/[^\s\/]*)$/);
  if (m){
    slashState = { open:true, query:m[2].slice(1).toLowerCase(), target:b, parentList, filtered:[], cursor:0 };
    renderSlash();
  } else hideSlash();
}

// Rebuilds the #nt-slash popup's contents from the current query: filters
// SLASH_ITEMS by name match, drops any section header that ends up with no
// items under it, and positions the popup at the current caret's bounding
// rect so it tracks the text cursor as the user types.
function renderSlash(){
  const slashEl = $('#nt-slash'); if (!slashEl) return;
  const items = SLASH_ITEMS.filter(it => it.sec || it.nm.toLowerCase().includes(slashState.query));
  const cleaned = [];
  for (let i = 0; i < items.length; i++){
    const it = items[i];
    if (it.sec){
      let has = false;
      for (let j = i + 1; j < items.length; j++){ if (items[j].sec) break; has = true; break; }
      if (has) cleaned.push(it);
    } else cleaned.push(it);
  }
  slashState.filtered = cleaned.filter(it => !it.sec);
  if (slashState.cursor >= slashState.filtered.length) slashState.cursor = 0;

  slashEl.innerHTML = '';
  if (slashState.filtered.length === 0){
    slashEl.innerHTML = '<div class="empty">No results · keep typing or press esc</div>';
  } else {
    cleaned.forEach(it => {
      if (it.sec){ const s = document.createElement('div'); s.className = 'slash-section'; s.textContent = it.sec; slashEl.appendChild(s); return; }
      const row = document.createElement('div'); row.className = 'slash-item';
      const idx = slashState.filtered.indexOf(it); if (idx === slashState.cursor) row.classList.add('on');
      row.dataset.id = it.id;
      row.innerHTML = `<div class="icw">${it.icon}</div><div class="nm">${escapeHtml(it.nm)}</div><div class="sc">${escapeHtml(it.sc || '')}</div>`;
      row.addEventListener('mouseenter', () => { slashState.cursor = idx; $$('#nt-slash .slash-item').forEach(x => x.classList.remove('on')); row.classList.add('on'); });
      row.addEventListener('mousedown', e => { e.preventDefault(); pickSlash(it.id); });
      slashEl.appendChild(row);
    });
  }
  const sel = window.getSelection();
  if (sel.rangeCount){
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    slashEl.style.left = Math.min(window.innerWidth - 380, rect.left) + 'px';
    slashEl.style.top = (rect.bottom + 6) + 'px';
  }
  slashEl.classList.add('show');
}
function hideSlash(){ slashState.open = false; $('#nt-slash')?.classList.remove('show'); }
function slashMove(d){
  if (!slashState.filtered.length) return;
  slashState.cursor = (slashState.cursor + d + slashState.filtered.length) % slashState.filtered.length;
  const rows = $$('#nt-slash .slash-item');
  rows.forEach((r, i) => r.classList.toggle('on', i === slashState.cursor));
  rows[slashState.cursor]?.scrollIntoView({ block:'nearest' });
}
function slashPick(){ const it = slashState.filtered[slashState.cursor]; if (it) pickSlash(it.id); }

// Applies the chosen slash-menu item: first strips the "/query" trigger text
// back out of the block (everything from the last "/" onward), then converts
// the block via applyType(). Some picks (image/table/divider/columns/etc.)
// leave the current block converted to the widget and additionally insert a
// fresh empty text block after it, since those widget types aren't good
// places to keep typing.
function pickSlash(id){
  const b = slashState.target; if (!b) return;
  const parentList = slashState.parentList;
  const ed = $('#nt-page')?.querySelector('[data-bid="' + b.id + '"] .editor');
  if (ed){
    const txt = ed.textContent;
    const lastSlash = txt.lastIndexOf('/');
    if (lastSlash >= 0){
      ed.innerHTML = escapeHtml(txt.slice(0, lastSlash));
      b.text = ed.innerHTML;
    }
  }
  applyType(b, id);
  hideSlash();
  touchSelected(); save(); renderPage();
  setTimeout(() => {
    if (['image','table','divider','cols-2','cols-3','toc','media','file','bookmark','embed'].includes(id)){
      const cur = getNote(state.selectedId);
      const list = parentList || cur.blocks;
      const nb = { id:uid(), type:'text', text:'' };
      insertAfter(list, b.id, nb); touchSelected(); save(); renderPage(); focusBlock(nb.id);
    } else focusBlock(b.id);
  }, 20);
}

// Converts a block in place to a new type (used by both the slash menu and
// the toolbar's "turn into" picker). Starts by deleting every type-specific
// field any block type might have, so switching e.g. table -> text doesn't
// leave a dangling `b.rows` around; then sets the new type and whatever
// fresh defaults that type needs. The 'page' case is special: it also
// creates a brand-new subpage note and turns this block into a page-link to it.
function applyType(b, id){
  delete b.headingLevel; delete b.children; delete b.cols; delete b.rows; delete b.target; delete b.src; delete b.width; delete b.caption; delete b.lang; delete b.emoji;
  delete b.url; delete b.kind; delete b.name; delete b.size; delete b.mime; delete b.tooLarge;
  delete b.title; delete b.description; delete b.domain; delete b.favicon; delete b.fetchFailed; delete b.embedSrc;
  if (id === 'text') b.type = 'text';
  else if (['h1','h2','h3','h4'].includes(id)) b.type = id;
  else if (id === 'bullet') b.type = 'bullet';
  else if (id === 'numbered') b.type = 'numbered';
  else if (id === 'todo'){ b.type = 'todo'; b.done = false; }
  else if (id === 'toggle'){ b.type = 'toggle'; b.open = true; b.children = []; }
  else if (id === 'toggle-h1'){ b.type = 'toggle'; b.open = true; b.children = []; b.headingLevel = 1; }
  else if (id === 'toggle-h2'){ b.type = 'toggle'; b.open = true; b.children = []; b.headingLevel = 2; }
  else if (id === 'toggle-h3'){ b.type = 'toggle'; b.open = true; b.children = []; b.headingLevel = 3; }
  else if (id === 'toggle-h4'){ b.type = 'toggle'; b.open = true; b.children = []; b.headingLevel = 4; }
  else if (id === 'quote') b.type = 'quote';
  else if (id === 'callout'){ b.type = 'callout'; b.emoji = '💡'; }
  else if (id === 'code'){ b.type = 'code'; b.text = (b.text || '').replace(/<[^>]+>/g, ''); b.lang = 'plain'; }
  else if (id === 'divider'){ b.type = 'divider'; b.text = ''; }
  else if (id === 'image'){ b.type = 'image'; b.src = null; b.caption = ''; }
  else if (id === 'table'){ b.type = 'table'; b.rows = [['Header 1','Header 2','Header 3'], ['','',''], ['','','']]; }
  else if (id === 'cols-2'){ b.type = 'cols'; b.cols = [[{ id:uid(), type:'text', text:'' }], [{ id:uid(), type:'text', text:'' }]]; }
  else if (id === 'cols-3'){ b.type = 'cols'; b.cols = [[{ id:uid(), type:'text', text:'' }], [{ id:uid(), type:'text', text:'' }], [{ id:uid(), type:'text', text:'' }]]; }
  else if (id === 'equation') b.type = 'eq';
  else if (id === 'toc') b.type = 'toc';
  else if (id === 'media'){ b.type = 'media'; b.url = null; }
  else if (id === 'file'){ b.type = 'file'; b.name = null; }
  else if (id === 'bookmark'){ b.type = 'bookmark'; b.url = null; }
  else if (id === 'embed'){ b.type = 'embed'; b.url = null; }
  else if (id === 'page'){
    const cur = getNote(state.selectedId);
    const sp = { id:uid('n'), emoji:'📄', title:b.text || 'New page', tags:[], parent:cur.id, blocks:[{ id:uid(), type:'text', text:'' }] };
    state.notes.push(sp); state.openIds.add(cur.id);
    b.type = 'page-link'; b.target = sp.id; b.text = sp.title;
  }
}

// ---------- @-mention menu (inline note/chat references) ----------
// Mirrors the slash menu above, but inserts an inline contenteditable="false"
// chip at the caret (like insertInlineEq) instead of converting the whole
// block — mentions can sit mid-paragraph next to other rich text.
let mentionState = { open:false, query:'', ed:null, filtered:[], cursor:0 };

// Same "probe range" pattern as maybeOpenSlash, but matching "@query"
// instead of "/query". The extra guard up front closes the menu immediately
// if the caret has landed inside an already-inserted mention chip (which is
// contentEditable="false", so this shouldn't normally happen, but a stray
// click could still put focus there).
function maybeOpenMention(ed, b){
  const s = window.getSelection(); if (!s.rangeCount) return;
  const r = s.getRangeAt(0); if (!r.collapsed) return;
  if (r.startContainer.nodeType === 1 ? r.startContainer.closest?.('.nt-mention') : r.startContainer.parentElement?.closest('.nt-mention')){ hideMention(); return; }
  const range = document.createRange(); range.selectNodeContents(ed); range.setEnd(r.endContainer, r.endOffset);
  const before = range.toString();
  const m = before.match(/(^|\s)@([^\s@]*)$/);
  if (m){
    mentionState = { open:true, query:m[2].toLowerCase(), ed, editingBlock:b, filtered:[], cursor:0 };
    renderMention();
  } else hideMention();
}

function mentionCandidates(){
  const notes = state.notes.map(n => ({ kind:'note', id:n.id, label:n.title || 'Untitled', icon:glyphHTML(n.emoji, '📄', 16) }));
  const chats = Object.entries(appState.threadState || {}).map(([id, st]) => ({ kind:'chat', id, label:st?.title || 'Untitled chat', icon:'💬' }));
  return { notes, chats };
}

function renderMention(){
  const el = $('#nt-mention'); if (!el) return;
  const { notes, chats } = mentionCandidates();
  const q = mentionState.query;
  const filterFn = c => c.label.toLowerCase().includes(q);
  const noteMatches = notes.filter(filterFn).slice(0, 8);
  const chatMatches = chats.filter(filterFn).slice(0, 8);
  mentionState.filtered = [...noteMatches, ...chatMatches];
  if (mentionState.cursor >= mentionState.filtered.length) mentionState.cursor = 0;

  el.innerHTML = '';
  if (mentionState.filtered.length === 0){
    el.innerHTML = '<div class="empty">No matches · keep typing or press esc</div>';
  } else {
    const addSection = (label, items) => {
      if (!items.length) return;
      const s = document.createElement('div'); s.className = 'mention-section'; s.textContent = label; el.appendChild(s);
      items.forEach(it => {
        const idx = mentionState.filtered.indexOf(it);
        const row = document.createElement('div'); row.className = 'mention-item'; if (idx === mentionState.cursor) row.classList.add('on');
        row.innerHTML = `<div class="icw">${it.icon}</div><div class="nm">${escapeHtml(it.label)}</div>`;
        row.addEventListener('mouseenter', () => { mentionState.cursor = idx; $$('#nt-mention .mention-item').forEach(x => x.classList.remove('on')); row.classList.add('on'); });
        row.addEventListener('mousedown', e => { e.preventDefault(); pickMention(it.kind, it.id, it.label); });
        el.appendChild(row);
      });
    };
    addSection('Notes', noteMatches);
    addSection('Chats', chatMatches);
  }
  const sel = window.getSelection();
  if (sel.rangeCount){
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    el.style.left = Math.min(window.innerWidth - 340, rect.left) + 'px';
    el.style.top = (rect.bottom + 6) + 'px';
  }
  el.classList.add('show');
}
function hideMention(){ mentionState.open = false; $('#nt-mention')?.classList.remove('show'); }
function mentionMove(d){
  if (!mentionState.filtered.length) return;
  mentionState.cursor = (mentionState.cursor + d + mentionState.filtered.length) % mentionState.filtered.length;
  const rows = $$('#nt-mention .mention-item');
  rows.forEach((r, i) => r.classList.toggle('on', i === mentionState.cursor));
  rows[mentionState.cursor]?.scrollIntoView({ block:'nearest' });
}
function mentionPick(){ const it = mentionState.filtered[mentionState.cursor]; if (it) pickMention(it.kind, it.id, it.label); }

// Replaces the typed "@query" text with an inline, non-editable mention chip
// (contentEditable="false" span carrying data-kind/data-id) plus a trailing
// space so typing continues naturally after it. Note: this assumes the
// "@query" run lives entirely inside one DOM Text node (true for the normal
// continuous-typing case) — see the inline comment below for the fallback.
function pickMention(kind, id, label){
  const ed = mentionState.ed;
  hideMention();
  if (!ed) return;
  const s = window.getSelection(); if (!s.rangeCount) return;
  const r = s.getRangeAt(0);
  const endNode = r.endContainer, endOffset = r.endOffset;
  const matchLen = 1 + mentionState.query.length;
  if (endNode.nodeType !== 3 || endOffset < matchLen) return; // caret must be in a text node with the "@query" run — edge cases (e.g. spanning nodes) are skipped, matching the tolerance of the existing slash-menu insertion
  const range = document.createRange();
  range.setStart(endNode, endOffset - matchLen);
  range.setEnd(endNode, endOffset);
  range.deleteContents();
  const span = document.createElement('span');
  span.className = 'nt-mention'; span.contentEditable = 'false';
  span.dataset.kind = kind; span.dataset.id = id;
  span.innerHTML = `${kind === 'note' ? '📄' : '💬'} ${escapeHtml(label)}`;
  range.insertNode(span);
  const spaceNode = document.createTextNode(' ');
  span.after(spaceNode);
  const after = document.createRange();
  after.setStartAfter(spaceNode); after.collapse(true);
  s.removeAllRanges(); s.addRange(after);
  wireMentionSpans(ed);
  const b = mentionState.editingBlock;
  if (b){ b.text = ed.innerHTML; touchSelected(); save(); }
}

// Attaches a click handler to every mention chip in an editor's current
// innerHTML — this must be re-run whenever innerHTML is reassigned (e.g.
// after code/eq re-render or a fresh block render), since replacing
// innerHTML drops any previously attached listeners. dataset.wired guards
// against double-wiring the same still-live chip.
function wireMentionSpans(ed){
  ed.querySelectorAll('.nt-mention[data-id]').forEach(span => {
    if (span.dataset.wired) return;
    span.dataset.wired = '1';
    span.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      if (span.dataset.kind === 'note') openPageTab(span.dataset.id);
      else openChatTab(span.dataset.id);
    });
  });
}

// ---------- floating format toolbar ----------
// Shows the #nt-ftoolbar positioned above the current text selection
// whenever there IS a non-collapsed selection inside an editor (called from
// attachEditor's mouseup/keyup handlers); hides it otherwise. Also syncs
// which format buttons show as "active" via document.queryCommandState,
// which reflects whether the current selection is already bold/italic/etc.
function maybeShowToolbar(ed){
  const ftb = $('#nt-ftoolbar'); if (!ftb) return;
  const s = window.getSelection();
  if (!s || s.isCollapsed || !s.rangeCount){ hideToolbar(); return; }
  const r = s.getRangeAt(0);
  if (!ed.contains(r.commonAncestorContainer) && r.commonAncestorContainer !== ed){ hideToolbar(); return; }
  const rect = r.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0){ hideToolbar(); return; }
  ftb.classList.add('show');
  ftb.style.left = Math.max(8, Math.min(window.innerWidth - ftb.offsetWidth - 8, rect.left + rect.width / 2 - ftb.offsetWidth / 2)) + 'px';
  ftb.style.top = (rect.top - ftb.offsetHeight - 8) + 'px';
  $$('#nt-ftoolbar button[data-cmd]').forEach(btn => {
    const c = btn.dataset.cmd;
    if (['bold','italic','underline'].includes(c)){
      try { btn.classList.toggle('on', document.queryCommandState(c)); } catch {}
    }
  });
}
function hideToolbar(){ $('#nt-ftoolbar')?.classList.remove('show'); $$('#nt-ftoolbar .picker').forEach(p => p.classList.remove('show')); }
function isToolbarFocused(){ const ftb = $('#nt-ftoolbar'); return document.activeElement && (document.activeElement === ftb || ftb?.contains(document.activeElement)); }

// Walks up from the current Selection's start node to find the enclosing
// `.b` block wrapper, then looks up that block's live data object in the
// current note's block tree — the toolbar/formatting functions below use
// this to know which block's `b.text` to update after a DOM formatting op.
function currentBlockFromSelection(){
  const s = window.getSelection(); if (!s.rangeCount) return null;
  let node = s.getRangeAt(0).startContainer;
  while (node && node.nodeType !== 1) node = node.parentNode;
  const wrap = node && node.closest && node.closest('.b'); if (!wrap) return null;
  const id = wrap.dataset.bid;
  const n = getNote(state.selectedId); if (!n) return null;
  const f = findBlock(n.blocks, id); return f ? { block:f.block, list:f.list } : null;
}

// Wraps the current selection's contents in a new element of the given tag
// (e.g. 'code' for inline code, 'mark' via applyHighlight below). Uses
// Range.extractContents()/insertNode() rather than document.execCommand,
// since execCommand has no built-in "wrap in arbitrary tag" command. Can
// throw if the selection spans element boundaries in a way extractContents
// can't cleanly handle — caught and silently no-op'd rather than corrupting
// the block, matching this file's general tolerance for edge-case selections.
function wrapSelection(tag){
  const s = window.getSelection(); if (!s.rangeCount || s.isCollapsed) return;
  const r = s.getRangeAt(0);
  const el = document.createElement(tag);
  try { el.appendChild(r.extractContents()); r.insertNode(el); } catch {}
}
// Wraps/unwraps the selection in a <span data-color="..."> for text color —
// passing a falsy color removes color spans instead of adding one.
function applyColor(c){
  const s = window.getSelection(); if (!s.rangeCount || s.isCollapsed) return;
  const r = s.getRangeAt(0);
  const span = document.createElement('span'); if (c) span.dataset.color = c;
  if (!c){
    span.appendChild(r.extractContents());
    span.querySelectorAll('[data-color]').forEach(el => el.removeAttribute('data-color'));
    r.insertNode(span); return;
  }
  span.appendChild(r.extractContents()); r.insertNode(span);
}
// Wraps/unwraps the selection in a <mark> for highlight color; removing
// highlight (falsy c) unwraps every <mark> inside the selection back to
// plain text nodes rather than just the outermost one, in case the
// selection spans multiple existing highlighted runs.
function applyHighlight(c){
  const s = window.getSelection(); if (!s.rangeCount || s.isCollapsed) return;
  const r = s.getRangeAt(0);
  if (!c){
    const frag = r.extractContents();
    const tmp = document.createElement('div'); tmp.appendChild(frag);
    tmp.querySelectorAll('mark').forEach(m => { const t = document.createTextNode(m.textContent); m.replaceWith(t); });
    while (tmp.firstChild) r.insertNode(tmp.firstChild);
    return;
  }
  const m = document.createElement('mark'); if (c !== 'yellow') m.dataset.c = c;
  m.appendChild(r.extractContents()); r.insertNode(m);
}
// Called after every toolbar formatting action (bold/italic/color/etc. all
// mutate the DOM directly via execCommand or wrapSelection). Since those
// operations touch the DOM without going through attachEditor's 'input'
// listener in every case, this reads the resulting innerHTML back out of the
// live editor and writes it into the block's persisted b.text explicitly.
function afterFormat(){
  const cur = currentBlockFromSelection();
  if (cur){
    const ed = $('#nt-page')?.querySelector('[data-bid="' + cur.block.id + '"] .editor');
    if (ed){ cur.block.text = ed.innerHTML; touchSelected(); save(); }
  }
}

// ---------- note branches (replaces inline comments) ----------
// Branch data lives at note.branches = [{bid, quote, blockId, messages, createdAt, touchedAt}].
// Text-anchored branches wrap selected text in <span class="nt-br-anchor" data-bid="…">.
// Note-wide branches (from bottom CTA) have blockId/quote = null.

const BRANCHABLE = new Set(['text','h1','h2','h3','h4','bullet','numbered','todo','toggle','quote','callout']);
let activeBranchId = null;
// Open floating panels, keyed by bid: { el, collapsed, reader, width, height,
// top, streaming, controller }. Mirrors chat's `branches` object (app.js).
const noteBranches = {};
let noteBranchLayoutRaf = 0;
let noteBranchMenuTarget = null;

function blockEditorEl(id){
  const wrap = $('#nt-page')?.querySelector('[data-bid="' + id + '"]');
  return wrap ? wrap.querySelector(':scope > .content > .editor') : null;
}

function getNoteBranch(note, bid){ return (note.branches||[]).find(br => br.bid === bid); }

// Removes branches whose text anchor (<span class="nt-br-anchor"
// data-bid="...">) is no longer present anywhere in the note's block text —
// i.e. the user deleted the highlighted passage the branch was attached to.
// Called at the top of every renderPage(), so a stale branch panel is closed
// (via closeNoteBranch) as soon as its anchor text disappears, keeping
// note.branches from silently accumulating orphaned entries.
function pruneAnchors(note){
  if (!note.branches?.length) return;
  const texts = [];
  function collectTexts(blocks){ blocks.forEach(b => { if (b.text) texts.push(b.text); if (b.children) collectTexts(b.children); if (b.cols) b.cols.forEach(c => collectTexts(c)); }); }
  collectTexts(note.blocks);
  const combined = texts.join('');
  const kept = [];
  note.branches.forEach(br => {
    const alive = !br.blockId || combined.includes('data-bid="' + br.bid + '"');
    if (alive) kept.push(br);
    else if (noteBranches[br.bid]) closeNoteBranch(br.bid);
  });
  note.branches = kept;
  if (!note.branches.length) delete note.branches;
}

// Wires click-to-open on every branch-anchor span in an editor — same
// re-wire-after-innerHTML-replace need as wireMentionSpans above.
function wireAnchorSpans(ed){
  ed.querySelectorAll('.nt-br-anchor[data-bid]').forEach(span => {
    span.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); openNoteBranch(span.dataset.bid); });
  });
}

// Renders one inline LaTeX span's KaTeX output — same optional-dependency /
// fail-to-plain-text handling as renderEqPreview (block equations) above.
function renderInlineEq(span, tex){
  span.dataset.tex = tex;
  span.classList.remove('eq-error');
  if (typeof katex === 'undefined'){ span.textContent = tex; return; }
  try { katex.render(tex, span, { throwOnError: true, displayMode: false }); }
  catch { span.classList.add('eq-error'); span.textContent = tex || '(empty equation)'; }
}
// Converts the current text selection into an inline equation: the selected
// text becomes the LaTeX source (r.toString()), replaced in place by a
// non-editable rendered span carrying that source in data-tex for later editing.
function insertInlineEq(){
  const s = window.getSelection(); if (!s.rangeCount || s.isCollapsed) return;
  const r = s.getRangeAt(0);
  const tex = r.toString(); if (!tex.trim()) return;
  const span = document.createElement('span'); span.className = 'nt-eq-inline'; span.contentEditable = 'false';
  r.deleteContents(); r.insertNode(span);
  renderInlineEq(span, tex);
  const after = document.createRange(); after.setStartAfter(span); after.collapse(true);
  s.removeAllRanges(); s.addRange(after);
}
// Click-to-edit on every inline-eq span — reopens a prompt() with the
// existing LaTeX source; an empty result unwraps the span back to plain text.
function wireEqSpans(ed, b){
  ed.querySelectorAll('.nt-eq-inline').forEach(span => {
    span.addEventListener('click', e => {
      e.preventDefault(); e.stopPropagation();
      const next = prompt('Edit LaTeX', span.dataset.tex || '');
      if (next == null) return;
      if (!next.trim()){ span.replaceWith(document.createTextNode(span.dataset.tex || '')); }
      else renderInlineEq(span, next);
      b.text = ed.innerHTML; touchSelected(); save();
    });
  });
}

// Creates a new text-anchored branch from the current selection: wraps the
// selected text in an `.nt-br-anchor` span (persisted as part of the block's
// HTML — the anchor lives inline with the content, same approach as ADR-009's
// comment spans, so it survives reload/re-render for free and disappears
// automatically if that text is later deleted, per pruneAnchors above),
// records a new entry in note.branches, then opens its panel.
function startBranch(){
  const cur = currentBlockFromSelection();
  if (!cur || !BRANCHABLE.has(cur.block.type)){ toast('select text in a text block to branch'); return; }
  const s = window.getSelection();
  if (!s.rangeCount || s.isCollapsed){ toast('select some text to branch on'); return; }
  const ed = blockEditorEl(cur.block.id);
  const node = s.getRangeAt(0).commonAncestorContainer;
  if (!ed || !(ed.contains(node) || ed === node)){ toast('select text in a note to branch'); return; }
  const note = getNote(state.selectedId); if (!note) return;
  const bid = uid('nb');
  const r = s.getRangeAt(0);
  const span = document.createElement('span'); span.className = 'nt-br-anchor'; span.dataset.bid = bid;
  let quote = '';
  try { span.appendChild(r.extractContents()); r.insertNode(span); quote = span.textContent; }
  catch { toast("couldn't branch there"); return; }
  cur.block.text = ed.innerHTML;
  if (!note.branches) note.branches = [];
  note.branches.push({ bid, quote:quote.slice(0, 200), blockId:cur.block.id, messages:[], createdAt:Date.now(), touchedAt:Date.now() });
  note.updatedAt = Date.now(); save(); hideToolbar(); renderPage();
  setTimeout(() => openNoteBranch(bid), 20);
}

function noteBranchStackEl(){ return $('#nt-branch-stack'); }
function noteBranchMenuEl(){ return $('#nt-branch-menu'); }

function titleFromNoteQuote(q){ return truncate(q || 'Untitled branch', 36); }

function flashNoteBranch(el){
  el.style.boxShadow = '0 0 0 2px rgba(217,119,87,0.4), ' + getComputedStyle(el).boxShadow;
  setTimeout(() => { el.style.boxShadow = ''; }, 700);
}

// Opens (or refocuses) a branch's floating panel. Mirrors chat's own
// branch-panel UI/DOM structure and interaction pattern (branch-head/
// branch-quote/branch-body/branch-compose/branch-resize/.msg/.composer
// classes are the SAME global CSS classes chat.css defines — reused
// deliberately rather than duplicated, per ADR in DECISIONS.md) but is a
// fully separate implementation living in this file, keyed by `note.
// branches[]` (this ADR-007 db) rather than chat's own thread state, and
// rendered into #nt-branch-stack rather than chat's branch rail. Notes
// branches intentionally don't nest (no "branch the branch"), so there is no
// ancestor-chain logic here, unlike chat's branch context building.
function openNoteBranch(bid){
  const note = getNote(state.selectedId); if (!note) return;
  const br = getNoteBranch(note, bid); if (!br) return;

  // Panel already open — just bring it to front / unfold it rather than
  // creating a duplicate DOM node.
  if (noteBranches[bid]){
    const nb = noteBranches[bid];
    if (nb.collapsed) toggleNoteCollapse(bid);
    activeBranchId = bid;
    rebalanceNotes();
    flashNoteBranch(nb.el);
    setTimeout(() => nb.el.querySelector('textarea')?.focus(), 0);
    return;
  }

  closeAllNoteBranches();
  const stack = noteBranchStackEl(); if (!stack) return;

  const el = document.createElement('div');
  el.className = `branch entering ${br.collapsed ? 'collapsed' : 'expanded'}${br.messages.length ? '' : ' empty'}`;
  if (br.userSized) el.classList.add('user-sized');
  if (br.reader) el.classList.add('reader');
  el.style.top = '72px';
  el.dataset.bid = bid;
  el.innerHTML = `
    <div class="branch-head">
      <div class="ico"><i class="ti ti-git-branch"></i></div>
      <div class="title"><span class="ttl">${escapeHtml(titleFromNoteQuote(br.quote))}</span></div>
      <div class="actions">
        <button data-h="reader" title="Expand branch" aria-label="Expand branch"><i class="ti ti-arrows-maximize"></i></button>
        <button data-h="collapse" title="Collapse/expand"><i class="ti ti-chevron-up"></i></button>
        <button data-h="menu" title="Branch actions"><i class="ti ti-dots"></i></button>
        <button data-h="close" title="Close branch"><i class="ti ti-x"></i></button>
      </div>
    </div>
    ${br.quote ? `<div class="branch-quote"><span class="lab">Branched from note</span>"${escapeHtml(truncate(br.quote, 140))}"</div>` : ''}
    <div class="branch-body"></div>
    <div class="branch-compose">
      <div class="composer">
        <textarea rows="1" placeholder="${br.quote ? 'Ask about this passage…' : 'Ask about this note…'}"></textarea>
        <div class="compose-row">
          <div class="left">
            <button class="chip nbp-model-chip" title="Select model" aria-haspopup="menu"></button>
            <button class="chip nbp-mode-chip" title="Conversation mode" aria-haspopup="menu"></button>
          </div>
          <button class="send-btn" disabled><i class="ti ti-arrow-up"></i></button>
        </div>
      </div>
    </div>
    <div class="branch-resize" data-edge="top" title="Resize upward" aria-hidden="true"></div>
    <div class="branch-resize" data-edge="bottom" title="Resize downward" aria-hidden="true"></div>
    <div class="branch-resize" data-edge="left" title="Resize sideways" aria-hidden="true"></div>
    <div class="branch-resize" data-edge="top-left" title="Resize upward and sideways" aria-hidden="true"></div>
    <div class="branch-resize" data-edge="bottom-left" title="Resize downward and sideways" aria-hidden="true"></div>
  `;
  if (br.width) el.style.width = Math.round(br.width) + 'px';
  if (br.userSized && Number.isFinite(br.height)) el.style.height = Math.round(br.height) + 'px';
  if (br.userSized && Number.isFinite(br.top)) el.style.top = Math.round(br.top) + 'px';
  stack.appendChild(el);
  requestAnimationFrame(() => el.classList.remove('entering'));

  noteBranches[bid] = {
    el,
    collapsed: !!br.collapsed,
    reader: !!br.reader,
    width: br.width || null,
    height: br.height || null,
    top: Number.isFinite(br.top) ? br.top : null,
    streaming: false,
    controller: null,
  };
  activeBranchId = bid;
  syncNoteReaderButton(bid);
  renderNoteBranchBody(bid);

  el.querySelector('[data-h="reader"]').addEventListener('click', () => toggleNoteReader(bid));
  el.querySelector('[data-h="collapse"]').addEventListener('click', () => toggleNoteCollapse(bid));
  el.querySelector('[data-h="menu"]').addEventListener('click', e => openNoteBranchMenu(e.currentTarget, bid));
  el.querySelector('[data-h="close"]').addEventListener('click', () => closeNoteBranch(bid));
  el.querySelector('.branch-head .actions').addEventListener('click', e => e.stopPropagation());
  el.querySelector('.branch-head').addEventListener('click', e => { if (e.target.closest('.actions')) return; toggleNoteCollapse(bid); });
  wireNoteBranchResize(el, bid);
  document.dispatchEvent(new Event('nl:refresh-chips'));   // app.js fills the model/mode chips from prefs

  const ta = el.querySelector('textarea');
  const sb = el.querySelector('.send-btn');
  const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(120, ta.scrollHeight) + 'px'; };
  ta.addEventListener('input', () => { grow(); updateNoteBranchSendState(bid); });
  ta.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); if (!noteBranches[bid]?.streaming) doSendFromComposer(bid); }
  });
  wireTabInsertsTab(ta);
  sb.addEventListener('click', () => {
    const nb = noteBranches[bid]; if (!nb) return;
    if (nb.streaming){ nb.controller?.abort(); return; }
    doSendFromComposer(bid);
  });
  el.querySelector('.branch-body').addEventListener('scroll', scheduleNoteBranchLayout, { passive:true });

  setTimeout(() => ta.focus(), 280);
  rebalanceNotes();
}

// Reads the branch panel's textarea, clears it, and hands the text off to sendNoteMsg.
function doSendFromComposer(bid){
  const nb = noteBranches[bid]; if (!nb) return;
  const ta = nb.el.querySelector('textarea'); if (!ta) return;
  const v = ta.value.trim(); if (!v) return;
  ta.value = ''; ta.style.height = '';
  sendNoteMsg(bid, v);
}

// Re-renders a branch panel's message list from persisted br.messages —
// unlike chat's branch reopen (which uses a snapshot/reopen protocol per
// DECISIONS.md), Notes branch messages are plain serializable data, so the
// body can simply be redrawn from scratch every time a panel opens or
// updates, with no capture/restore step needed.
function renderNoteBranchBody(bid){
  const nb = noteBranches[bid]; if (!nb) return;
  const note = getNote(state.selectedId);
  const br = note && getNoteBranch(note, bid);
  if (!br) return;
  const body = nb.el.querySelector('.branch-body'); if (!body) return;
  body.innerHTML = '';
  br.messages.forEach(msg => {
    const el = document.createElement('div'); el.className = 'msg ' + msg.role;
    if (msg.role === 'user') el.innerHTML = '<div class="bub">' + escapeHtml(msg.content) + '</div>';
    else { el.innerHTML = renderMarkdown(msg.content); highlightCodeIn(el); }
    body.appendChild(el);
  });
  body.scrollTop = body.scrollHeight;
  nb.el.classList.toggle('empty', !br.messages.length);
}

// Enables/disables the send button based on whether the composer has text —
// skipped while a response is already streaming (the button repurposes to a
// stop control during that time, wired directly in openNoteBranch).
function updateNoteBranchSendState(bid){
  const nb = noteBranches[bid]; if (!nb || nb.streaming) return;
  const ta = nb.el.querySelector('textarea');
  const sb = nb.el.querySelector('.send-btn');
  if (!ta || !sb) return;
  sb.disabled = !ta.value.trim();
}

// Copies a branch panel's live (in-memory) collapsed/reader/size/position
// state back onto its persisted note.branches[] record and saves. Called
// from every geometry-changing action (collapse, reader toggle, resize-end,
// close) rather than on every intermediate drag frame — geometry, like
// block drag/position elsewhere in this file, is saved on drag-END, not
// continuously.
function persistNoteBranchGeometry(bid){
  const nb = noteBranches[bid]; if (!nb) return;
  const note = getNote(state.selectedId);
  const br = note && getNoteBranch(note, bid);
  if (!br) return;
  br.collapsed = nb.collapsed;
  br.reader = nb.reader;
  if (nb.el.classList.contains('user-sized')){
    br.userSized = true;
    if (Number.isFinite(nb.width)) br.width = nb.width;
    if (Number.isFinite(nb.height)) br.height = nb.height;
    if (Number.isFinite(nb.top)) br.top = nb.top;
  }
  save();
}

// Aborts any in-flight AI request, persists final geometry, then animates
// the panel out and removes it from the DOM + the in-memory noteBranches map
// (the underlying note.branches[] record itself is untouched — closing a
// panel doesn't delete the branch, only deleteNoteBranch below does that).
function closeNoteBranch(bid){
  const nb = noteBranches[bid]; if (!nb) return;
  if (nb.streaming && nb.controller) nb.controller.abort();
  persistNoteBranchGeometry(bid);
  nb.el.style.transition = 'opacity 180ms, transform 180ms';
  nb.el.style.opacity = '0'; nb.el.style.transform = 'translateX(20px)';
  setTimeout(() => {
    nb.el.remove();
    delete noteBranches[bid];
    if (activeBranchId === bid) activeBranchId = null;
    rebalanceNotes();
  }, 180);
}

function closeAllNoteBranches(){
  Object.keys(noteBranches).forEach(closeNoteBranch);
}

function syncNoteReaderButton(bid){
  const nb = noteBranches[bid]; if (!nb) return;
  const btn = nb.el.querySelector('[data-h="reader"]'); if (!btn) return;
  const expanded = !!nb.reader;
  const label = expanded ? 'Shrink branch' : 'Expand branch';
  btn.title = label; btn.setAttribute('aria-label', label);
  btn.innerHTML = `<i class="ti ${expanded ? 'ti-arrows-minimize' : 'ti-arrows-maximize'}"></i>`;
}

function setNoteBranchExpanded(nb){
  nb.collapsed = false;
  nb.el.classList.remove('collapsed');
  nb.el.classList.add('expanded');
  if (nb.height){ nb.el.style.height = Math.round(nb.height) + 'px'; nb.el.classList.add('user-sized'); }
}

function toggleNoteCollapse(bid){
  const nb = noteBranches[bid]; if (!nb) return;
  nb.collapsed = !nb.collapsed;
  nb.el.classList.toggle('collapsed', nb.collapsed);
  nb.el.classList.toggle('expanded', !nb.collapsed);
  if (nb.collapsed) nb.el.style.height = '';
  else if (nb.height) nb.el.style.height = Math.round(nb.height) + 'px';
  if (nb.collapsed && nb.reader){ nb.reader = false; nb.el.classList.remove('reader'); syncNoteReaderButton(bid); }
  persistNoteBranchGeometry(bid);
  rebalanceNotes();
}

function toggleNoteReader(bid){
  const nb = noteBranches[bid]; if (!nb) return;
  const next = !nb.reader;
  nb.reader = next;
  nb.el.classList.toggle('reader', next);
  if (next) setNoteBranchExpanded(nb);
  if (next && !nb.height){
    const r = nb.el.getBoundingClientRect();
    setNoteBranchSize(nb, Math.max(r.width, 620), Math.max(r.height, 480));
  }
  syncNoteReaderButton(bid);
  activeBranchId = bid;
  persistNoteBranchGeometry(bid);
  rebalanceNotes();
}

// The vertical strip (below the topbar, above the bottom edge) that branch
// panels are allowed to occupy — mirrors chat's own branch-rail concept.
function noteBranchRail(){
  const topbar = $('#nt-topbar');
  const top = Math.max(70, (topbar?.getBoundingClientRect().bottom || 54) + 12);
  const bottom = Math.max(top + 140, window.innerHeight - 92);
  return { top, bottom };
}

// Reads the shared `--drawer-gap` CSS var (viewport margin) to compute how
// wide a branch panel is allowed to grow — capped at 900px so a panel can't
// swallow the whole viewport on an ultrawide monitor.
function noteBranchMaxWidth(){
  const gap = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--drawer-gap')) || 16;
  return Math.max(340, Math.min(900, window.innerWidth - gap * 2));
}

function noteBranchResizeBounds(){
  const rail = noteBranchRail();
  return { minTop:rail.top, maxBottom:window.innerHeight - 24, minWidth:340, maxWidth:noteBranchMaxWidth(), minHeight:220 };
}

// Clamps and applies a branch panel's width/height/top, writing width also
// into the `--nt-drawer-w` CSS var. This var is deliberately its OWN
// variable — separate from chat's shared `--drawer-w` — so resizing a Notes
// branch panel can never cross-contaminate chat's branch rail width, and
// vice versa (see DECISIONS.md). Marks the panel `.user-sized` so later
// auto-layout (layoutNoteBranches) respects the manual size/position instead
// of recalculating it from the anchor.
function setNoteBranchSize(nb, width, height, top = null){
  if (!nb?.el) return;
  const bounds = noteBranchResizeBounds();
  const savedTop = nb.top ?? parseFloat(nb.el.style.top);
  let nextTop = Number.isFinite(top) ? top : (Number.isFinite(savedTop) ? savedTop : nb.el.getBoundingClientRect().top);
  if (Number.isFinite(width)){
    nb.width = clamp(width, bounds.minWidth, bounds.maxWidth);
    document.documentElement.style.setProperty('--nt-drawer-w', Math.round(nb.width) + 'px');
    nb.el.style.width = Math.round(nb.width) + 'px';
  }
  if (Number.isFinite(height)){
    nextTop = clamp(nextTop, bounds.minTop, bounds.maxBottom - bounds.minHeight);
    nb.height = clamp(height, bounds.minHeight, bounds.maxBottom - nextTop);
    if (!nb.collapsed) nb.el.style.height = Math.round(nb.height) + 'px';
  }
  if (Number.isFinite(top)){
    nb.top = clamp(nextTop, bounds.minTop, bounds.maxBottom - (nb.height || bounds.minHeight));
    nb.el.style.top = Math.round(nb.top) + 'px';
  } else if (nb.top == null) {
    nb.top = parseFloat(nb.el.style.top) || nb.el.getBoundingClientRect().top;
  }
  nb.el.classList.add('user-sized');
  scheduleNoteBranchLayout();
}

// Pointer-based resize (pointerdown/pointermove/pointerup, using
// setPointerCapture so the drag keeps tracking even if the cursor leaves the
// handle) for each of the panel's 5 resize handles (top/bottom/left/
// top-left/bottom-left edges — no right-edge handle since the panel is
// anchored to the right rail). Persists geometry only once, in `finish()` on
// pointerup/pointercancel — live resizing during the drag only updates the
// DOM via setNoteBranchSize, matching the file's drag-ends-then-saves pattern.
function wireNoteBranchResize(el, bid){
  const handles = $$('.branch-resize', el);
  if (!handles.length) return;
  let drag = null;
  const finish = (e) => {
    if (!drag) return;
    try { drag.handle.releasePointerCapture(e.pointerId); } catch(_){}
    drag = null;
    document.body.classList.remove('resizing-branch','resize-x','resize-y','resize-ne-sw','resize-nw-se');
    persistNoteBranchGeometry(bid);
  };
  handles.forEach(handle => handle.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const nb = noteBranches[bid]; if (!nb) return;
    e.preventDefault(); e.stopPropagation();
    setNoteBranchExpanded(nb);
    const r = nb.el.getBoundingClientRect();
    const edge = handle.dataset.edge || 'bottom-left';
    drag = { handle, edge, startX:e.clientX, startY:e.clientY, startW:r.width, startH:r.height, startTop:r.top, startBottom:r.bottom };
    handle.setPointerCapture(e.pointerId);
    document.body.classList.add('resizing-branch');
    document.body.classList.toggle('resize-x', edge === 'left');
    document.body.classList.toggle('resize-y', edge === 'top' || edge === 'bottom');
    document.body.classList.toggle('resize-ne-sw', edge === 'bottom-left');
    document.body.classList.toggle('resize-nw-se', edge === 'top-left');
  }));
  handles.forEach(handle => handle.addEventListener('pointermove', e => {
    if (!drag) return;
    const nb = noteBranches[bid]; if (!nb) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    const changesWidth = drag.edge.includes('left');
    const changesTop = drag.edge.includes('top');
    const changesBottom = drag.edge.includes('bottom');
    const nextWidth = changesWidth ? drag.startW - dx : NaN;
    let nextHeight = NaN;
    let nextTop = null;
    if (changesTop){
      const bounds = noteBranchResizeBounds();
      nextTop = clamp(drag.startTop + dy, bounds.minTop, drag.startBottom - bounds.minHeight);
      nextHeight = drag.startBottom - nextTop;
    } else if (changesBottom){
      nextHeight = drag.startH + dy;
    }
    setNoteBranchSize(nb, nextWidth, nextHeight, nextTop);
  }));
  handles.forEach(handle => handle.addEventListener('pointerup', finish));
  handles.forEach(handle => handle.addEventListener('pointercancel', finish));
}

// Updates z-index (active panel on top; in reader mode, above everything
// via a high z-index) across all open branch panels, then schedules a
// layout pass. Called after any change to which panel is "active" (open,
// collapse toggle, reader toggle, close).
function rebalanceNotes(){
  const ids = Object.keys(noteBranches);
  ids.forEach(id => {
    const nb = noteBranches[id];
    nb.el.style.zIndex = id === activeBranchId ? (nb.reader ? '60' : '3') : '1';
  });
  noteBranchStackEl()?.classList.toggle('has-active', ids.length > 0);
  scheduleNoteBranchLayout();
}

// rAF-debounced trigger for layoutNoteBranches — coalesces bursts of layout
// requests (scroll events, resize drags, multiple panels reacting to the
// same DOM change) into at most one layout pass per animation frame.
function scheduleNoteBranchLayout(){
  if (noteBranchLayoutRaf) return;
  noteBranchLayoutRaf = requestAnimationFrame(() => {
    noteBranchLayoutRaf = 0;
    layoutNoteBranches();
  });
}

// Finds a branch's source anchor span in the currently-rendered page (may be
// absent if the anchor was pruned, or if this is a note-wide branch with no
// blockId/quote at all). CSS.escape guards against a bid value containing
// characters that would otherwise break the attribute-selector string.
function noteBranchAnchorEl(bid){
  const escaped = window.CSS?.escape ? CSS.escape(bid) : String(bid).replace(/"/g, '\\"');
  return $(`#nt-page .nt-br-anchor[data-bid="${escaped}"]`);
}

// True if a source anchor's bounding rect overlaps the branch rail's visible
// vertical extent at all (used to decide whether to visually flag a panel as
// "source scrolled out of view" via the .source-out class).
function noteSourceIsVisible(rect, rail){
  return rect.bottom >= rail.top && rect.top <= rail.bottom;
}

// Positions every open, non-reader-mode branch panel vertically within the
// rail, roughly aligned with its source anchor's on-screen position (like
// chat's own branch declutter/rail placement, with the ancestor-chain/
// reader-eclipse/parent-snap logic removed since Notes branches don't nest).
// Panels with a manual (`user-sized`) top position keep it; others derive a
// "desired" top from their anchor's vertical center. After computing desired
// positions, sorts by desired top and pushes overlapping panels down
// (cursor-based stacking) so multiple open panels never visually overlap,
// then — if that push made the stack taller than the rail — shifts the whole
// stack up as much as room allows to fit everything back in.
// Slides the note page left (via right padding on .nt-pgwrap) just enough that
// the open branch panel never covers the centered page column — so expanding
// or resizing a panel pushes the note aside instead of overlaying it.
function shiftNotePageForBranches(){
  const wrap = $('.nt-pgwrap'); if (!wrap) return;
  const gap = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--drawer-gap')) || 16;
  let panelW = 0;
  Object.values(noteBranches).forEach(nb => {
    if (nb.collapsed) return;
    panelW = Math.max(panelW, nb.el.getBoundingClientRect().width);
  });
  const PAGE_MAX = 780, PAGE_MIN = 420;
  let shift = 0;
  if (panelW){
    const reserved = panelW + gap * 2;
    shift = Math.min(Math.max(0, 2 * reserved + PAGE_MAX - window.innerWidth), Math.max(0, window.innerWidth - PAGE_MIN));
  }
  wrap.style.paddingRight = shift ? Math.round(shift) + 'px' : '';
}

window.addEventListener('resize', () => { if (Object.keys(noteBranches).length) scheduleNoteBranchLayout(); });

function layoutNoteBranches(){
  shiftNotePageForBranches();
  const ids = Object.keys(noteBranches);
  if (!ids.length) return;
  const rail = noteBranchRail();

  const placements = ids.filter(id => !noteBranches[id].reader).map((id, index) => {
    const nb = noteBranches[id];
    const anchor = noteBranchAnchorEl(id);
    const anchorRect = anchor?.getBoundingClientRect();
    const sourceOut = anchorRect && !noteSourceIsVisible(anchorRect, rail);
    nb.el.classList.toggle('source-out', !!sourceOut);
    if (sourceOut) return null;

    const height = nb.el.offsetHeight || (nb.collapsed ? 46 : 360);
    const headerOffset = nb.collapsed ? height / 2 : 22;
    const anchorY = anchorRect ? anchorRect.top + anchorRect.height / 2 : rail.top + index * 56;
    const maxTop = rail.bottom - height;
    const hasManualTop = nb.el.classList.contains('user-sized') && Number.isFinite(nb.top);
    const desired = hasManualTop ? clamp(nb.top, rail.top, Math.max(rail.top, maxTop)) : clamp(anchorY - headerOffset, rail.top, Math.max(rail.top, maxTop));
    return { id, el:nb.el, height, desired, top:desired };
  }).filter(Boolean).sort((a, b) => a.desired - b.desired);

  if (!placements.length) return;

  let cursor = rail.top;
  placements.forEach(p => { p.top = Math.max(p.desired, cursor); cursor = p.top + p.height + 10; });

  const overflow = cursor - 10 - rail.bottom;
  if (overflow > 0){
    const availableShift = Math.max(0, placements[0].top - rail.top);
    const shift = Math.min(overflow, availableShift);
    placements.forEach(p => { p.top -= shift; });
  }

  placements.forEach(p => {
    p.el.style.top = Math.round(p.top) + 'px';
    if (noteBranches[p.id]?.el.classList.contains('user-sized')) noteBranches[p.id].top = p.top;
  });
}

// Opens the shared #nt-branch-menu dropdown (copy source quote / close /
// delete) positioned under the clicked "..." button; noteBranchMenuTarget
// tracks which branch it's currently open for.
function openNoteBranchMenu(anchor, bid){
  noteBranchMenuTarget = bid;
  const menu = noteBranchMenuEl(); if (!menu) return;
  const r = anchor.getBoundingClientRect();
  menu.classList.add('show');
  menu.style.left = (r.right - menu.offsetWidth) + 'px';
  menu.style.top = (r.bottom + 6) + 'px';
}

function closeNoteBranchMenu(){ noteBranchMenuEl()?.classList.remove('show'); noteBranchMenuTarget = null; }

// One-time wiring for the shared branch-actions dropdown (there's only ever
// one #nt-branch-menu element, reused across whichever branch's "..." was
// last clicked) — outside-click closes it, and its buttons dispatch on the
// current noteBranchMenuTarget.
function wireNoteBranchMenu(){
  const menu = noteBranchMenuEl(); if (!menu || menu.dataset.wired) return;
  menu.dataset.wired = '1';
  document.addEventListener('mousedown', e => {
    if (menu.classList.contains('show') && !menu.contains(e.target)) closeNoteBranchMenu();
  });
  menu.addEventListener('click', e => {
    const btn = e.target.closest('button'); if (!btn || !noteBranchMenuTarget) return;
    const bid = noteBranchMenuTarget;
    const act = btn.dataset.act;
    if (act === 'copy'){
      const note = getNote(state.selectedId);
      const br = note && getNoteBranch(note, bid);
      navigator.clipboard?.writeText(br?.quote || '').catch(() => {});
      toast('Copied source quote');
    } else if (act === 'close'){
      closeNoteBranch(bid);
    } else if (act === 'delete'){
      deleteNoteBranch(bid);
    }
    closeNoteBranchMenu();
  });
}

// Builds the system prompt for a branch's AI conversation: the note's
// breadcrumb path (for context on where in the notebook this is), a
// flattened plain-text dump of the note's own content (HTML-tag-stripped,
// capped at 3000 chars to bound prompt size), and — for text-anchored
// branches — the specific quoted passage the branch was started from. This
// is Notes' equivalent of chat's buildBranchContext(), but built as one
// system-prompt string per send rather than an ancestor-chain message list,
// since Notes branches are flat (no branch-of-a-branch nesting).
function buildNoteSystemPrompt(note, quote){
  const path = pathOf(note.id).map(n => n.title || 'Untitled').join(' › ');
  const texts = [];
  function ext(blocks){ blocks.forEach(b => { if (b.text) texts.push(b.text.replace(/<[^>]+>/g,'')); if (b.children) ext(b.children); if (b.cols) b.cols.forEach(c => ext(c)); }); }
  ext(note.blocks);
  const content = texts.join('\n').slice(0, 3000);
  let prompt = 'You are a research assistant helping the user think through their notes. Be concise and insightful.\n\nNote: ' + path;
  if (content) prompt += '\n\nContent:\n' + content;
  if (quote) prompt += '\n\nSelected passage:\n“' + quote + '”';
  const modeParts = modeSystemPromptParts(appState.prefs.mode);
  if (modeParts.length) prompt += '\n\n' + modeParts.join('\n');
  return prompt;
}

// Streams an AI response for a note branch by calling the provider's HTTP
// API directly from the browser (Claude's Messages API, or DeepSeek's
// OpenAI-compatible chat/completions), using whichever API key is present
// in localStorage (`nl_api_keys` — the same Settings-managed keys chat
// itself uses). This bypasses the backend's own proxy/logging path that
// chat's request pipeline goes through; it exists as a self-contained
// branch-messaging path scoped to this file only. Both branches below parse
// the provider's SSE `data: ...` stream manually (no SDK), buffering partial
// lines across chunks, and forward each text delta via onDelta as it
// arrives so the branch panel can render token-by-token.
async function streamNoteAI(messages, systemPrompt, signal, onDelta, onDone, onError){
  const keys = JSON.parse(localStorage.getItem('nl_api_keys') || '{}');
  const modelPref = appState.prefs.model;
  const provider = providerForModelPref(modelPref);
  const modelId = modelIdForModelPref(modelPref);
  const claudeKey = provider === 'anthropic' ? (keys.anthropic || keys.claude) : null;
  const deepseekKey = provider === 'deepseek' ? keys.deepseek : null;

  if (provider !== 'anthropic' && provider !== 'deepseek'){
    onError('Notes branches support Claude and DeepSeek models for now — pick one from the model menu.');
    return;
  }
  if (claudeKey){
    try {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method:'POST',
        headers:{ 'x-api-key':claudeKey, 'anthropic-version':'2023-06-01', 'content-type':'application/json' },
        body:JSON.stringify({ model:modelId, max_tokens:2000, stream:true, system:systemPrompt, messages }),
        signal,
      });
      if (!resp.ok){ const t=await resp.text(); onError('Claude ' + resp.status + ': ' + t.slice(0,200)); return; }
      const reader = resp.body.getReader(); const dec = new TextDecoder(); let full='', buf='';
      while (true){
        const {done,value} = await reader.read(); if (done) break;
        buf += dec.decode(value,{stream:true});
        const lines = buf.split('\n'); buf = lines.pop();
        for (const line of lines){
          if (!line.startsWith('data: ')) continue;
          const d = line.slice(6).trim(); if (d==='[DONE]') continue;
          try { const ev=JSON.parse(d); if (ev.type==='content_block_delta' && ev.delta?.type==='text_delta'){ full+=ev.delta.text; onDelta(ev.delta.text); } } catch {}
        }
      }
      onDone(full);
    } catch(err){ if (err.name==='AbortError') return; onError(err.message||'Network error'); }
  } else if (deepseekKey){
    try {
      const resp = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method:'POST',
        headers:{ 'Authorization':'Bearer '+deepseekKey, 'Content-Type':'application/json' },
        body:JSON.stringify({ model:modelId, max_tokens:2000, stream:true, thinking:{ type:'disabled' }, messages:[{role:'system',content:systemPrompt},...messages] }),
        signal,
      });
      if (!resp.ok){ const t=await resp.text(); onError('DeepSeek ' + resp.status + ': ' + t.slice(0,200)); return; }
      const reader = resp.body.getReader(); const dec = new TextDecoder(); let full='', buf='';
      while (true){
        const {done,value} = await reader.read(); if (done) break;
        buf += dec.decode(value,{stream:true});
        const lines = buf.split('\n'); buf = lines.pop();
        for (const line of lines){
          if (!line.startsWith('data: ')) continue;
          const d = line.slice(6).trim(); if (d==='[DONE]') continue;
          try { const ev=JSON.parse(d); const delta=ev.choices?.[0]?.delta?.content; if (delta){ full+=delta; onDelta(delta); } } catch {}
        }
      }
      onDone(full);
    } catch(err){ if (err.name==='AbortError') return; onError(err.message||'Network error'); }
  } else {
    onError('No ' + (provider === 'deepseek' ? 'DeepSeek' : 'Claude') + ' API key — add one in Settings, or pick a different model.');
  }
}

// Sends a user message in a branch: appends it to br.messages and saves
// immediately (not debounced — a sent chat message shouldn't be lost),
// renders the user bubble + a streaming "thinking" placeholder, then drives
// streamNoteAI to fill that placeholder in as text arrives. On completion,
// appends the assistant reply to br.messages and saves; on error, shows the
// error inline AND pops the just-added user message back off (so a failed
// send doesn't leave an orphaned "asked but never answered" turn in history).
function sendNoteMsg(bid, text){
  const nb = noteBranches[bid]; if (!nb || nb.streaming || !text.trim()) return;
  const note = getNote(state.selectedId); if (!note) return;
  const br = getNoteBranch(note, bid); if (!br) return;

  br.messages.push({ role:'user', content:text }); br.touchedAt = Date.now(); note.updatedAt = Date.now(); save();

  const body = nb.el.querySelector('.branch-body'); if (!body) return;
  nb.el.classList.remove('empty');

  const userEl = document.createElement('div'); userEl.className = 'msg user';
  userEl.innerHTML = '<div class="bub">' + escapeHtml(text) + '</div>';
  body.appendChild(userEl);

  const aiEl = document.createElement('div'); aiEl.className = 'msg ai streaming';
  aiEl.innerHTML = '<span class="nbp-thinking">…</span>';
  body.appendChild(aiEl); body.scrollTop = body.scrollHeight;

  const sendBtn = nb.el.querySelector('.send-btn');
  const inp = nb.el.querySelector('textarea');
  if (sendBtn) sendBtn.innerHTML = '<i class="ti ti-player-stop"></i>';
  if (inp) inp.disabled = true;

  nb.streaming = true; nb.controller = new AbortController();

  const systemPrompt = buildNoteSystemPrompt(note, br.quote);
  const apiMsgs = br.messages.map(m => ({ role:m.role, content:m.content }));
  if (br.quote && br.messages.length === 1){
    apiMsgs[0] = { role:'user', content:'“' + br.quote + '”\n\n' + text };
  }

  let fullContent = '';
  streamNoteAI(apiMsgs, systemPrompt, nb.controller.signal,
    (delta) => {
      if (aiEl.querySelector('.nbp-thinking')) aiEl.innerHTML = '';
      fullContent += delta;
      aiEl.innerHTML = renderMarkdown(fullContent);
      body.scrollTop = body.scrollHeight;
    },
    () => {
      nb.streaming = false; nb.controller = null;
      aiEl.classList.remove('streaming');
      highlightCodeIn(aiEl);
      br.messages.push({ role:'assistant', content:fullContent }); br.touchedAt = Date.now(); note.updatedAt = Date.now(); save();
      if (sendBtn) sendBtn.innerHTML = '<i class="ti ti-arrow-up"></i>';
      if (inp){ inp.disabled = false; setTimeout(() => inp.focus(), 0); }
      updateNoteBranchSendState(bid);
    },
    (err) => {
      nb.streaming = false; nb.controller = null;
      aiEl.classList.remove('streaming');
      aiEl.innerHTML = '<span class="nbp-err">Error: ' + escapeHtml(err) + '</span>';
      br.messages.pop(); save();
      if (sendBtn) sendBtn.innerHTML = '<i class="ti ti-arrow-up"></i>';
      if (inp) inp.disabled = false;
    }
  );
}

// Permanently deletes a branch: unwraps its anchor span back to plain text
// in the source block (so the highlighted-looking text returns to normal,
// same "unwrap the marker span" approach ADR-009 uses for resolving inline
// comments), removes the note.branches[] record, and closes the panel if open.
function deleteNoteBranch(bid){
  const note = getNote(state.selectedId); if (!note) return;
  const br = getNoteBranch(note, bid); if (!br) return;
  if (br.blockId){
    const found = findBlock(note.blocks, br.blockId);
    if (found){
      const ed = blockEditorEl(br.blockId);
      if (ed){
        const span = ed.querySelector('.nt-br-anchor[data-bid="' + bid + '"]');
        if (span){ const p=span.parentNode; while(span.firstChild) p.insertBefore(span.firstChild,span); p.removeChild(span); p.normalize(); found.block.text=ed.innerHTML; }
      }
    }
  }
  note.branches = (note.branches||[]).filter(b => b.bid !== bid);
  if (!note.branches.length) delete note.branches;
  note.updatedAt = Date.now(); save();
  if (noteBranches[bid]) closeNoteBranch(bid); else if (activeBranchId === bid) activeBranchId = null;
  renderPage();
}

// ---------- once-only DOM wiring ----------
// Wires the static #nt-ftoolbar element's buttons a single time (dataset.wired
// guards against double-attaching listeners across repeated showOverlay()
// calls, since the toolbar element itself persists in the DOM rather than
// being rebuilt per-render like block content is). Each command either
// applies a formatting op directly then calls afterFormat() to persist it,
// opens a color/turn-into picker popover, or triggers a branch/link action.
function wireToolbar(){
  const ftb = $('#nt-ftoolbar'); if (!ftb || ftb.dataset.wired) return;
  ftb.dataset.wired = '1';
  ftb.addEventListener('mousedown', e => e.preventDefault());
  $$('#nt-ftoolbar button[data-cmd]').forEach(btn => {
    btn.addEventListener('click', () => {
      const c = btn.dataset.cmd;
      if (c === 'bold' || c === 'italic' || c === 'underline'){ document.execCommand(c); afterFormat(); }
      else if (c === 'strike'){ document.execCommand('strikeThrough'); afterFormat(); }
      else if (c === 'code'){ wrapSelection('code'); afterFormat(); }
      else if (c === 'eq'){ insertInlineEq(); afterFormat(); }
      else if (c === 'link'){ const url = prompt('Link URL'); if (url){ document.execCommand('createLink', false, url); afterFormat(); } }
      else if (c === 'branch'){ startBranch(); }
      else if (c === 'color' || c === 'turn'){
        const id = c === 'color' ? 'nt-picker-color' : 'nt-picker-turn';
        $$('#nt-ftoolbar .picker').forEach(p => { if (p.id !== id) p.classList.remove('show'); });
        document.getElementById(id).classList.toggle('show');
      }
    });
  });
  $$('#nt-picker-color .row').forEach(row => {
    row.addEventListener('mousedown', e => e.preventDefault());
    row.addEventListener('click', () => {
      if (row.dataset.color !== undefined){ applyColor(row.dataset.color); afterFormat(); }
      if (row.dataset.hl !== undefined){ applyHighlight(row.dataset.hl); afterFormat(); }
    });
  });
  $$('#nt-picker-turn .row').forEach(row => {
    row.addEventListener('mousedown', e => e.preventDefault());
    row.addEventListener('click', () => {
      const turn = row.dataset.turn;
      const cur = currentBlockFromSelection();
      if (cur){ applyType(cur.block, turn); touchSelected(); save(); renderPage(); setTimeout(() => focusBlock(cur.block.id), 20); }
      hideToolbar();
    });
  });
}

// Document-level listeners for cross-cutting behavior that isn't tied to any
// one block/element: ⌘C/Escape while a page-wide or range block selection is
// active, closing the emoji popover / format toolbar / slash menu / mention
// menu on an outside click, tracking scroll for the topbar's shadow, and the
// export button. Called once from initNotes().
function wireGlobalListeners(){
  // attach once; safe to leave running across mounts
  document.addEventListener('keydown', e => {
    if ((!blockSelAll && !blockSelIds) || !$('#nt-screen')?.classList.contains('show')) return;
    const k = e.key.toLowerCase();
    if ((e.metaKey || e.ctrlKey) && k === 'c'){
      e.preventDefault();
      const n = getNote(state.selectedId);
      if (n){
        const text = blockSelAll ? noteToText(n) : blocksToText((n.blocks || []).filter(b => blockSelIds.has(b.id)));
        navigator.clipboard.writeText(text);
        toast(blockSelAll ? 'page copied' : 'selection copied');
      }
      clearBlockSel();
    } else if (e.key === 'Escape'){
      e.preventDefault(); clearBlockSel();
    } else if ((e.metaKey || e.ctrlKey) && k === 'a'){
      e.preventDefault(); // already all selected — stay put
    } else if (!e.metaKey && !e.ctrlKey) clearBlockSel();
  }, true);
  document.addEventListener('mousedown', e => {
    clearBlockSel();
    if (!e.target.closest('#nt-emoji-pop, .cp-emoji-pop, [data-emoji-trigger]')) closeEmojiPop();
    if (!e.target.closest('#nt-ftoolbar')){
      setTimeout(() => { const s = window.getSelection(); if (!s.rangeCount || s.isCollapsed) hideToolbar(); }, 50);
    }
    if (!e.target.closest('#nt-slash') && !e.target.closest('.nt-screen .b .editor')) hideSlash();
    if (!e.target.closest('#nt-mention') && !e.target.closest('.nt-screen .b .editor')) hideMention();
  });
  const screen = $('#nt-screen');
  screen?.addEventListener('scroll', () => { $('#nt-topbar')?.classList.toggle('scrolled', screen.scrollTop > 4); });
  wireBlockRangeDrag();
  $('#nt-export-btn')?.addEventListener('click', () => {
    const n = getNote(state.selectedId);
    if (!n) return;
    exportNoteMarkdown(n);
    toast('exporting…');
  });
}

// ---------- mount / unmount ----------
// Memoizes the loadState() promise so concurrent callers (e.g. wireSidebar's
// eager load and showOverlay's own load) share one in-flight/completed load
// rather than racing separate Dexie reads.
let bootPromise = null;
function ensureLoaded(){
  if (!bootPromise) bootPromise = loadState();
  return bootPromise;
}

// mount() callback registered with core/registry.js — invoked when the
// Notes view becomes the active full-screen surface. Ensures data is loaded,
// wires the (idempotent) toolbar, reveals the #nt-screen overlay, and
// renders either the index or the last-open page.
async function showOverlay(){
  await ensureLoaded();
  wireToolbar();
  $('#nt-screen')?.classList.add('show');
  renderSidebar();
  if (state.showIndex || !getNote(state.selectedId)) renderIndex();
  else renderPage();
}
// unmount() callback — hides the overlay and tears down every transient
// popover/panel so switching away from Notes doesn't leave floating UI
// (slash menu, mention menu, toolbar, emoji popover, branch panels) visible
// over whatever view comes next.
function hideOverlay(){ $('#nt-screen')?.classList.remove('show'); hideSlash(); hideMention(); hideToolbar(); closeEmojiPop(); closeAllNoteBranches(); }

// ---------- sidebar wiring (in the persistent app sidebar) ----------
// Wires the ALWAYS-VISIBLE sidebar section (#nt-side-head/#nt-side-tree,
// distinct from the #nt-screen overlay) — clicking it opens the Notes index,
// the caret collapses/expands the tree, add/clear-all buttons, and
// drag-to-top-level (dropping a dragged row on the tree background itself
// rather than on another row, which wireSideDrag handles per-row).
function wireSidebar(){
  const head = $('#nt-side-head');
  const addBtn = $('#nt-side-add');
  const clearBtn = $('#nt-side-clear');
  const tree = $('#nt-side-tree');
  if (!head || !tree) return;
  // load + render the tree immediately so users see their notes without
  // opening the view first
  ensureLoaded().then(() => renderSidebar());

  head.addEventListener('click', e => {
    if (e.target.closest('#nt-side-add') || e.target.closest('#nt-side-clear') || e.target.closest('.nt-caret')) return;
    openNotesIndex();
  });
  $('.nt-caret', head)?.addEventListener('click', e => {
    e.stopPropagation();
    const collapsed = tree.classList.toggle('collapsed');
    head.classList.toggle('is-collapsed', collapsed);
  });
  addBtn?.addEventListener('click', e => { e.stopPropagation(); newPage(null); });
  clearBtn?.addEventListener('click', e => { e.stopPropagation(); confirmDeleteAllNotes(); });

  tree.addEventListener('dragover', e => { if (!sideDragCtx) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
  tree.addEventListener('drop', e => {
    if (!sideDragCtx) return;
    e.preventDefault();
    reparentNote(sideDragCtx.id, null);
    sideDragCtx = null; clearSideDropMarks();
  });
}

// Opens the notes view showing the index/"new note" grid rather than
// whichever note happened to be selected last (state.selectedId persists
// across sessions) — used by any entry point whose intent is "start fresh in
// Notes," not "reopen where I left off."
export function openNotesIndex(){
  closeAllNoteBranches();
  state.showIndex = true;
  mountView('notes');
}

// Lets the shared tab strip (core/registry.js) await Notes' data being
// loaded before it needs to reason about note tabs, without itself knowing
// anything about Dexie/state internals.
export async function ensureNotesLoadedForTabs(){
  await ensureLoaded();
}

// Used by the tab strip to decide whether a "note:<id>" tab still points at
// a real note (e.g. after the note was deleted elsewhere).
export function noteExists(id){
  return !!getNote(id);
}

// Reports which tab id represents "what Notes is currently showing" — the
// synthetic 'notes' id for the index, or a per-note tab id otherwise. Used
// by the tab strip to highlight the active tab.
export function getCurrentNotesTabId(){
  if (state.showIndex || !getNote(state.selectedId)) return 'notes';
  return noteTabId(state.selectedId);
}

// Supplies a note tab's label/icon for the shared tab strip to render,
// without the tab strip needing to know the shape of a note object.
export function getNoteTabMeta(id){
  const n = getNote(id);
  if (!n) return { label: 'Missing note', iconHtml: '<i class="ti ti-notebook"></i>' };
  return { label: n.title || 'Untitled', iconHtml: glyphHTML(n.emoji, '📄', 14) };
}

// Entry point used when a note tab (or an @mention chip) is clicked from
// outside this module — opens Notes directly to that page rather than
// wherever state.selectedId currently points.
export function openNoteInTab(id){
  ensureLoaded().then(() => {
    if (!getNote(id)){
      state.showIndex = true;
      mountView('notes');
      return;
    }
    closeAllNoteBranches();
    state.selectedId = id;
    state.showIndex = false;
    save();
    mountView('notes');
    renderSidebar();
    renderPage();
  });
}

// Feature entry point, called once at app startup. Bails out entirely if
// #nt-screen isn't in the DOM (defensive — lets this module be safely
// imported even where the Notes markup hasn't been added to index.html),
// otherwise registers 'notes' as a view via core/registry.js (the same
// mechanism chat's own view registers through) and wires the always-on
// sidebar/global listeners.
export function initNotes(){
  if (!$('#nt-screen')) return;
  registerView({
    id: 'notes',
    label: 'Notes',
    icon: 'ti-notes',
    mount: showOverlay,
    unmount: hideOverlay,
  });
  wireSidebar();
  wireGlobalListeners();
  wireNoteBranchMenu();
}
