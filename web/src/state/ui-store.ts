import { create } from 'zustand';
import { parseTabs, serializeTabs, TAB_STORAGE_KEY, type Tab } from './tabs';
import { MAIN_THREAD_ID } from '../db/thread-ops';

// Shell state that belongs to no feature: sidebar, tabs, the confirm dialog.
// Kept apart from app-store because none of it is in `appState` — legacy keeps
// it in DOM classes and module variables.

export interface ConfirmRequest {
  heading: string;
  /** Rendered as: before + ` "name"` + after — the legacy dialog's exact shape. */
  name: string;
  before: string;
  after: string;
  actionLabel: string;
}

interface PendingConfirm extends ConfirmRequest { resolve(ok: boolean): void }

export interface UiState {
  sidebarOpen: boolean;
  settingsOpen: boolean;
  modesOpen: boolean;
  searchOpen: boolean;
  projectsViewOpen: boolean;
  /** The project whose panel is open, if any. */
  activeProjectId: string | null;
  /** Set when the panel opens for a just-created project, so its name is selected for typing. */
  selectProjectName: boolean;
  tabs: Tab[];
  activeTabId: string | null;
  confirm: PendingConfirm | null;
}

export interface UiActions {
  setSidebarOpen(open: boolean): void;
  setSettingsOpen(open: boolean): void;
  setModesOpen(open: boolean): void;
  setSearchOpen(open: boolean): void;
  setProjectsViewOpen(open: boolean): void;
  setActiveProject(pid: string | null, opts?: { selectName?: boolean }): void;
  /** Reads nl_tabs_v1; call after the app store has hydrated. */
  restoreTabs(deleted: ReadonlySet<string>, fallbackId: string): void;
  /** Opens `id` as a tab (if new) and activates it. */
  activateTab(id: string): void;
  closeTab(id: string): string | null;
  /** Drops tabs for threads that were deleted, activating a neighbour. */
  dropTabs(ids: string[]): void;
  /** Resolves true on confirm, false on cancel/Esc/outside click. */
  askConfirm(req: ConfirmRequest): Promise<boolean>;
  resolveConfirm(ok: boolean): void;
}

function persistTabs(tabs: Tab[], active: string | null): void {
  try { localStorage.setItem(TAB_STORAGE_KEY, serializeTabs(tabs, active)); } catch { /* storage may be blocked; tabs are a convenience */ }
}

export const useUiStore = create<UiState & UiActions>((set, get) => ({
  sidebarOpen: false, // legacy ships the sidebar collapsed
  settingsOpen: false,
  modesOpen: false,
  searchOpen: false,
  projectsViewOpen: false,
  activeProjectId: null,
  selectProjectName: false,
  tabs: [],
  activeTabId: null,
  confirm: null,

  setSidebarOpen(open) { set({ sidebarOpen: open }); },
  setSettingsOpen(open) { set({ settingsOpen: open }); },
  setModesOpen(open) { set({ modesOpen: open }); },
  setSearchOpen(open) { set({ searchOpen: open }); },
  setProjectsViewOpen(open) { set({ projectsViewOpen: open }); },
  setActiveProject(pid, opts) { set({ activeProjectId: pid, selectProjectName: !!opts?.selectName }); },

  restoreTabs(deleted, fallbackId) {
    let raw: string | null = null;
    try { raw = localStorage.getItem(TAB_STORAGE_KEY); } catch { /* see persistTabs */ }
    const stored = parseTabs(raw, deleted);
    // "closing the last tab reopens the main thread" (ADR-021): never zero tabs.
    const tabs = stored.tabs.length ? stored.tabs : [{ id: fallbackId }];
    const active = stored.active && tabs.some(t => t.id === stored.active) ? stored.active : tabs[0]!.id;
    set({ tabs, activeTabId: active });
  },

  activateTab(id) {
    const { tabs } = get();
    const next = tabs.some(t => t.id === id) ? tabs : [...tabs, { id }];
    set({ tabs: next, activeTabId: id });
    persistTabs(next, id);
  },

  closeTab(id) {
    const { tabs, activeTabId } = get();
    const idx = tabs.findIndex(t => t.id === id);
    if (idx < 0) return activeTabId;
    let next = tabs.filter(t => t.id !== id);
    if (next.length === 0) next = [{ id: MAIN_THREAD_ID }];
    const active = activeTabId === id ? (next[Math.min(idx, next.length - 1)]!.id) : activeTabId;
    set({ tabs: next, activeTabId: active });
    persistTabs(next, active);
    return active;
  },

  dropTabs(ids) {
    const drop = new Set(ids);
    const { tabs, activeTabId } = get();
    if (!tabs.some(t => drop.has(t.id))) return;
    let next = tabs.filter(t => !drop.has(t.id));
    if (next.length === 0) next = [{ id: MAIN_THREAD_ID }];
    const active = activeTabId && !drop.has(activeTabId) ? activeTabId : next[0]!.id;
    set({ tabs: next, activeTabId: active });
    persistTabs(next, active);
  },

  askConfirm(req) {
    // Only one at a time: a new request cancels the pending one (core/ui.js:97).
    get().confirm?.resolve(false);
    return new Promise<boolean>(resolve => set({ confirm: { ...req, resolve } }));
  },

  resolveConfirm(ok) {
    const pending = get().confirm;
    if (!pending) return;
    set({ confirm: null });
    pending.resolve(ok);
  },
}));
