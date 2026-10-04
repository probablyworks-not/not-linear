import { create } from 'zustand';
import { loadChatState, updateChatState } from '../db/chat-repo';
import { createThreadIn, deleteThreadIn, MAIN_THREAD_ID, emptyState } from '../db/thread-ops';
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
}

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

const initial = emptyState();

export const useAppStore = create<AppState & AppActions>((set) => ({
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
  apiKeys: {},
  dynamicThreads: [],
  deletedThreadIds: [],
  hydrated: false,
  error: null,

  async hydrate() {
    try {
      set({ ...fromPersisted(await loadChatState()), hydrated: true, error: null });
    } catch (e) {
      set({ hydrated: true, error: e instanceof Error ? e.message : String(e) });
    }
  },

  async openThread(id) {
    // Status-style change: immediate write, never debounced.
    set({ currentThreadId: id });
    try {
      const { state } = await updateChatState(s => { s.current = id; });
      set(fromPersisted(state));
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  async createThread() {
    try {
      const { state, result } = await updateChatState(s => createThreadIn(s, Date.now()));
      set({ ...fromPersisted(state), error: null });
      return result;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
      return null;
    }
  },

  async deleteThread(id) {
    try {
      const { state, result } = await updateChatState(s => deleteThreadIn(s, id));
      set({ ...fromPersisted(state), error: null });
      return result;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
      return false;
    }
  },
}));
