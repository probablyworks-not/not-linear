// Dexie/IndexedDB persistence layer.
// Uses window.Dexie (loaded as a CDN <script> before this module evaluates).
// DOM reads in persistAll use document.querySelectorAll directly (no app.js dependency).
// loadPersistedState receives DOM-mutating callbacks from app.js.

import { appState } from './state.js';

const NL_STORE = 'nl_state_v2'; // kept only for one-time migration from localStorage
export const STATIC_THREAD_IDS = new Set(['doc-main','pricing','onboarding','planning']);
export const deletedThreadIds = new Set();

// eslint-disable-next-line no-undef
const db = new Dexie('notlinear');
db.version(1).stores({ kv: 'key' });

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
    },
  }}).catch(e => console.warn('notlinear: save failed —', e.message));
}

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
    // Restore projects (additive [SCHEMA] field — absent in older saved state).
    if (saved.projects && typeof saved.projects === 'object'){
      Object.keys(saved.projects).forEach(pid => {
        const sp = saved.projects[pid];
        if (sp && sp.id) appState.projects[pid] = { id: sp.id, name: sp.name || 'Untitled project', rules: sp.rules || '', files: Array.isArray(sp.files) ? sp.files : [] };
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
