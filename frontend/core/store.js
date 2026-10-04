// Dexie/IndexedDB persistence layer.
// Uses window.Dexie (loaded as a CDN <script> before this module evaluates).
// DOM reads in persistAll use document.querySelectorAll directly (no app.js dependency).
// loadPersistedState receives DOM-mutating callbacks from app.js.
//
// This is the persistence layer for the main chat/threads/projects Dexie
// database, named "notlinear". It is deliberately a SEPARATE database from
// the Notes feature's own "notlinear-notes" db (see frontend/views/notes.js
// and PRD notes_product.md) — that split is intentional, per ADR-007 in
// docs/project-notes/DECISIONS.md, so Notes persistence and the chat schema
// below can evolve independently. Do not add Notes data into this db, and do
// not bump this db's schema version for Notes-only changes.
//
// SCHEMA IS SACRED (per AGENTS.md "do not touch" list): the `db.version(1)`
// call and the `kv` object store's shape below define the on-disk layout that
// existing users' browsers already have persisted. Do not change the store
// name, key path, or add/remove/rename a `db.version()` call without also
// writing a Dexie schema migration (a new `db.version(N)` block with an
// `.upgrade()` as needed) — silently altering this in place can corrupt or
// orphan already-persisted user data. If you think you need a schema change,
// stop and confirm the migration path with the user first (see AGENTS.md /
// CLAUDE.md "Plan mode for risky changes: ... persistence/IndexedDB").
//
// Only app.js currently imports this module: it calls persistAll() on
// changes it wants saved immediately, and loadPersistedState() once at
// startup to rehydrate appState (core/state.js) and the DOM. Note the actual
// storage model here is a single 'state' row holding one big JSON blob
// (`db.kv.put({ key: 'state', value: {...} })`) rather than one row per
// thread/project — that's why this file, not Dexie itself, is what defines
// the shape of "the chat schema" in practice.

import { appState } from './state.js';
import { hasMode, DEFAULT_MODE_ID } from './modes.js';

const NL_STORE = 'nl_state_v2'; // kept only for one-time migration from localStorage
export const STATIC_THREAD_IDS = new Set(['doc-main','pricing','onboarding','planning']);
export const deletedThreadIds = new Set();

// eslint-disable-next-line no-undef
const db = new Dexie('notlinear'); // the chat/threads/projects db — see ADR-007
                                    // for why Notes uses a separate 'notlinear-notes' db instead.
db.version(1).stores({ kv: 'key' }); // SACRED: see schema note above — bump with a
                                      // new db.version() + migration, never edit in place.

// persistAll: write the current in-memory chat/threads/projects state (a mix
// of appState fields from core/state.js and some DOM state read directly from
// the sidebar) to the single 'state' row in the 'kv' Dexie store. Called by
// app.js on relevant state changes — per the project's persistence
// convention (see CLAUDE.md "Persistence — debounce, don't blast"), callers
// are expected to debounce frequent changes (e.g. typing) themselves rather
// than calling this on every keystroke; position/status changes are expected
// to call this immediately. Failures are caught and logged as a console
// warning rather than thrown, since a failed save shouldn't crash the app.
export function persistAll(){
  const dynamicThreads = [...document.querySelectorAll('.sidebar [data-thread]')]
    .filter(b => !STATIC_THREAD_IDS.has(b.dataset.thread))
    .map(b => ({ id: b.dataset.thread, title: b.dataset.title || '' }));
  db.kv.put({ key: 'state', value: {
    threads: appState.threadState,
    current: appState.currentThreadId,
    dynamic: dynamicThreads,
    deletedThreads: [...deletedThreadIds],
    chatCount: appState.newChatCount,
    projects: appState.projects,
    projectCount: appState.projectCount,
    prefs: {
      name: appState.prefs.name,
      tone: appState.prefs.tone,
      context: appState.prefs.context,
      model: appState.prefs.model,
      mode: appState.prefs.mode,
      folderName: appState.prefs.folderName,
      searxngUrl: appState.prefs.searxngUrl,
      thinking: appState.prefs.thinking,
      theme: appState.prefs.theme,
      rankingLlm: appState.prefs.rankingLlm,
      customModes: appState.prefs.customModes,
      modeOverrides: appState.prefs.modeOverrides,
    },
  }}).catch(e => console.warn('notlinear: save failed —', e.message));
}

// loadPersistedState: read the saved 'state' row back out of Dexie (falling
// back to a one-time migration from the old localStorage key NL_STORE if
// Dexie has nothing yet, then clearing that localStorage key), and merge it
// into appState (core/state.js) plus the DOM. Because this module intentionally
// has no direct reference to app.js's DOM-manipulation closures, the actual
// rendering/DOM-mutation steps (rendering prefs, adding thread buttons,
// updating titles, refreshing unread indicators, rendering the projects grid)
// are passed in as callbacks by app.js, the sole caller, at startup. Returns
// `true` if saved state was found and applied, `false` otherwise (including
// on error, which is caught and logged rather than thrown).
export async function loadPersistedState({ renderPrefsUI, resolveThreadTitle, addThreadButton, updateThreadButtonTitle, refreshThreadUnreadIndicators, renderProjects }){
  try {
    let saved;
    const stored = await db.kv.get('state');
    if (stored) {
      saved = stored.value;
    } else {
      // One-time migration: import existing data from localStorage then clear it
      const raw = localStorage.getItem(NL_STORE);
      if (raw) {
        saved = JSON.parse(raw);
        await db.kv.put({ key: 'state', value: saved });
        localStorage.removeItem(NL_STORE);
      }
    }
    if (!saved) return false;
    if (saved.prefs){
      Object.assign(appState.prefs, saved.prefs);
      if (!Array.isArray(appState.prefs.customModes)) appState.prefs.customModes = [];
      if (!appState.prefs.modeOverrides || typeof appState.prefs.modeOverrides !== 'object') appState.prefs.modeOverrides = {};
      if (!hasMode(appState.prefs.mode)) appState.prefs.mode = DEFAULT_MODE_ID;
      appState.prefs.thinking = false; // always off by default; user must re-enable each session
      renderPrefsUI();
    }
    deletedThreadIds.clear();
    (saved.deletedThreads || []).forEach(id => {
      if (id && id !== 'doc-main') deletedThreadIds.add(id);
    });
    deletedThreadIds.forEach(id => {
      delete appState.threadState[id];
      [...document.querySelectorAll('.sidebar [data-thread]')].find(btn => btn.dataset.thread === id)?.remove();
    });
    // Re-create any dynamic thread buttons
    const existingIds = new Set([...document.querySelectorAll('.sidebar [data-thread]')].map(b => b.dataset.thread));
    (saved.dynamic || []).forEach(({ id, title }) => {
      if (deletedThreadIds.has(id)) return;
      const savedTitle = resolveThreadTitle(saved.threads?.[id], title);
      if (!existingIds.has(id)) addThreadButton(id, savedTitle);
    });
    // Merge saved thread states over the empty defaults
    if (saved.threads) Object.assign(appState.threadState, saved.threads);
    deletedThreadIds.forEach(id => delete appState.threadState[id]);
    [...document.querySelectorAll('.sidebar [data-thread]')]
      .filter(btn => !STATIC_THREAD_IDS.has(btn.dataset.thread))
      .forEach(btn => {
        const state = appState.threadState[btn.dataset.thread];
        if (!state) return;
        const title = resolveThreadTitle(state, btn.dataset.title || btn.textContent);
        state.title = title;
        updateThreadButtonTitle(btn.dataset.thread, title);
      });
    if (saved.chatCount) appState.newChatCount = saved.chatCount;
    // Restore projects (additive [SCHEMA] fields — absent in older saved state).
    // updatedAt added for notlinear Redesign TASK-RD07 (projects-grid "Last
    // updated" sort); defaults to 0 for pre-existing saves with no field.
    if (saved.projects && typeof saved.projects === 'object'){
      Object.keys(saved.projects).forEach(pid => {
        const sp = saved.projects[pid];
        if (sp && sp.id) appState.projects[pid] = { id: sp.id, name: sp.name || 'Untitled project', rules: sp.rules || '', files: Array.isArray(sp.files) ? sp.files : [], path: sp.path || '', updatedAt: sp.updatedAt || 0 };
      });
    }
    if (saved.projectCount) appState.projectCount = saved.projectCount;
    renderProjects();
    if (saved.current && !deletedThreadIds.has(saved.current) && document.querySelector(`.sidebar [data-thread="${saved.current}"]`)) appState.currentThreadId = saved.current;
    else appState.currentThreadId = 'doc-main';
    refreshThreadUnreadIndicators();
    return true;
  } catch(e){
    console.warn('notlinear: load failed —', e.message);
    return false;
  }
}
