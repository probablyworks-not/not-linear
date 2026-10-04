import { create } from 'zustand';
import { loadChatState, updateChatState } from '../db/chat-repo';
import { createThreadIn, deleteThreadIn, MAIN_THREAD_ID, emptyState } from '../db/thread-ops';
import { setPrefIn, type PrefKey } from '../db/prefs-ops';
import { createDebouncedWriter } from '../lib/debounced-writer';
import { connectKey, disconnectKey, readApiKeys } from '../lib/api-keys';
import { applyTheme } from '../lib/theme';
import type { PersistedPrefs, PersistedProject, PersistedState, PersistedThread } from '../db/types';

// Mirrors frontend/core/state.js:31 `appState`, field for field, so a feature
// ported in P4-P6 finds the name it already knows. Persisted fields are
// hydrated from the shared Dexie row and written back only through repo
// actions below; the runtime-only fields (streams, controllers, attachments)
// are never persisted and exist now so P5 does not have to reshape the store.
//
// ADR-041: Zustand owns this. Dexie is the source of truth behind it, not a
// query cache in front of it — we never TanStack-Query the local database.

export interface AppState {
  // ---- Thread / chat ----
  currentThreadId: string;
  threadState: Record<string, PersistedThread>;
  mainMessages: Array<{ role: string; content: string }>;
  newChatCount: number;
  mainHistory: unknown[];
  currentCrumbTitle: string;

  // ---- User prefs ----
  prefs: PersistedPrefs;

  // ---- Projects ----
  projects: Record<string, PersistedProject>;
  projectCount: number;

  // ---- Branches (runtime; populated from threadState in P5b) ----
  branches: Record<string, unknown>;
  activeBranchId: string | null;

  // ---- Streaming / controllers (runtime only) ----
  mainStreaming: boolean;
  streamingThreadIds: Set<string>;
  mainControllers: Record<string, AbortController>;
  activeController: AbortController | null;

  // ---- Attachments (runtime only) ----
  threadAttachments: Record<string, unknown[]>;
  branchAttachments: Record<string, unknown[]>;

  // ---- API keys (localStorage.nl_api_keys, read in P4) ----
  apiKeys: Record<string, string>;

  // ---- Persisted bookkeeping legacy keeps in module scope / the DOM ----
  dynamicThreads: PersistedState['dynamic'];
  deletedThreadIds: string[];

  // ---- Lifecycle ----
  hydrated: boolean;
  error: string | null;
}

export interface AppActions {
  hydrate(): Promise<void>;
  /** Opens a thread: persists `current`, which legacy restores on its next load. */
  openThread(id: string): Promise<void>;
  createThread(): Promise<string | null>;
  /** Caller owns the confirm dialog; this is the write. */
  deleteThread(id: string): Promise<boolean>;
  /**
   * Sets one pref. Memory updates at once; the database write is immediate for
   * discrete choices and debounced (200ms, per key) for typed text. Writes only
   * this key, so a concurrent legacy save to a different pref is not clobbered.
   */
  setPref<K extends PrefKey>(key: K, value: PersistedPrefs[K], opts?: { debounce?: boolean }): Promise<void>;
  /** Theme is the one pref with a side effect: `nl_theme` and <html data-theme> must follow it. */
  setTheme(theme: string): Promise<void>;
  /** Writes any debounced pref edits now (blur, close, window hide, before a re-read). */
  flushPrefs(): Promise<void>;
  /** Re-reads localStorage.nl_api_keys, which the other app may have changed. */
  refreshApiKeys(): void;
  connectApiKey(provider: string, key: string): void;
  disconnectApiKey(provider: string): void;
}

const prefWriter = createDebouncedWriter<string>();

function fromPersisted(s: PersistedState): Partial<AppState> {
  return {
    currentThreadId: s.current,
    threadState: s.threads,
    newChatCount: s.chatCount,
    prefs: s.prefs,
    projects: s.projects,
    projectCount: s.projectCount,
    dynamicThreads: s.dynamic,
    deletedThreadIds: s.deletedThreads,
  };
}

/**
 * Everything but prefs. Thread actions use this: a pref being typed lives in
 * memory ahead of its debounced write, and copying the database's (older) prefs
 * back would roll the user's keystrokes back mid-sentence.
 */
function threadFields(s: PersistedState): Partial<AppState> {
  const all = fromPersisted(s);
  delete all.prefs;
  return all;
}

const initial = emptyState();

async function persistPref<K extends PrefKey>(key: K, value: PersistedPrefs[K]): Promise<void> {
  await updateChatState(s => setPrefIn(s, key, value));
}

export const useAppStore = create<AppState & AppActions>((set, get) => ({
  currentThreadId: MAIN_THREAD_ID,
  threadState: initial.threads,
  mainMessages: [],
  newChatCount: initial.chatCount,
  mainHistory: [],
  currentCrumbTitle: 'Non-linear chat system for research',
  prefs: {},
  projects: {},
  projectCount: initial.projectCount,
  branches: {},
  activeBranchId: null,
  mainStreaming: false,
  streamingThreadIds: new Set(),
  mainControllers: {},
  activeController: null,
  threadAttachments: {},
  branchAttachments: {},
  apiKeys: readApiKeys(),
  dynamicThreads: [],
  deletedThreadIds: [],
  hydrated: false,
  error: null,

  async hydrate() {
    try {
      const persisted = await loadChatState();
      set({ ...fromPersisted(persisted), apiKeys: readApiKeys(), hydrated: true, error: null });
      // Legacy re-applies prefs.theme on every load (app.js:4319). Only when one
      // is actually stored: with none, the pre-paint script's choice stands.
      if (persisted.prefs.theme) applyTheme(persisted.prefs.theme);
    } catch (e) {
      set({ hydrated: true, error: e instanceof Error ? e.message : String(e) });
    }
  },

  async openThread(id) {
    // Status-style change: immediate write, never debounced.
    set({ currentThreadId: id });
    try {
      const { state } = await updateChatState(s => { s.current = id; });
      set(threadFields(state));
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  async createThread() {
    try {
      const { state, result } = await updateChatState(s => createThreadIn(s, Date.now()));
      set({ ...threadFields(state), error: null });
      return result;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
      return null;
    }
  },

  async setPref(key, value, opts) {
    set({ prefs: { ...get().prefs, [key]: value } });
    const write = async (): Promise<void> => {
      try { await persistPref(key, value); }
      catch (e) { set({ error: e instanceof Error ? e.message : String(e) }); }
    };
    if (opts?.debounce) prefWriter.schedule(key, write);
    else { prefWriter.cancel(key); await write(); }
  },

  async setTheme(theme) {
    applyTheme(theme);
    await get().setPref('theme', theme);
  },

  flushPrefs() { return prefWriter.flushAll(); },

  refreshApiKeys() { set({ apiKeys: readApiKeys() }); },
  connectApiKey(provider, key) { set({ apiKeys: connectKey(provider, key) }); },
  disconnectApiKey(provider) { set({ apiKeys: disconnectKey(provider) }); },

  async deleteThread(id) {
    try {
      const { state, result } = await updateChatState(s => deleteThreadIn(s, id));
      set({ ...threadFields(state), error: null });
      return result;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
      return false;
    }
  },
}));
