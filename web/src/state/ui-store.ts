import { create } from 'zustand';
import { parseTabs, serializeTabs, TAB_STORAGE_KEY, type Tab } from './tabs';
import { MAIN_THREAD_ID } from '../db/thread-ops';
import { readPaneWidth, writePaneWidth } from '../notes/pane-width';

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

export type SettingsTab = 'general' | 'models' | 'skills' | 'integrations' | 'modes' | 'updates' | 'logs';

export type ProjectView = 'overview' | 'notes' | 'files' | 'artifacts' | 'canvas';

export interface UiState {
  sidebarOpen: boolean;
  settingsOpen: boolean;
  /** The Settings page tab showing while it is open. */
  settingsTab: SettingsTab;
  searchOpen: boolean;
  shortcutsOpen: boolean;
  highlightsOpen: boolean;
  threadMapOpen: boolean;
  canvasOpen: boolean;
  ctxOpen: boolean;
  imagePreview: { src: string; name: string } | null;
  /** An html/svg file from a reply, open in the sandboxed preview. */
  filePreview: { title: string; kind: 'html' | 'svg'; content: string } | null;
  projectsViewOpen: boolean;
  /** The project whose panel is open, if any. */
  activeProjectId: string | null;
  /** Which part of the project screen is showing: the overview or one of its drill-ins. */
  projectView: ProjectView;
  /** Set when the panel opens for a just-created project, so its name is selected for typing. */
  selectProjectName: boolean;
  tabs: Tab[];
  activeTabId: string | null;
  /** Tabs left behind by activating another, newest last. In memory only: a reload starts fresh. */
  tabHistory: string[];
  confirm: PendingConfirm | null;
  /** The note open beside the chat, if any. */
  notePaneId: string | null;
  /** The pane's requested width in px; the drawn width is clamped to the window. */
  notePaneWidth: number;
}

export interface UiActions {
  setSidebarOpen(open: boolean): void;
  setSettingsOpen(open: boolean): void;
  setSettingsTab(tab: SettingsTab): void;
  /** Opens Settings, on `tab` when given (otherwise on the tab it was last left on). */
  openSettings(tab?: SettingsTab): void;
  setSearchOpen(open: boolean): void;
  setShortcutsOpen(open: boolean): void;
  setHighlightsOpen(open: boolean): void;
  setThreadMapOpen(open: boolean): void;
  setCanvasOpen(open: boolean): void;
  setCtxOpen(open: boolean): void;
  setImagePreview(image: { src: string; name: string } | null): void;
  setFilePreview(file: { title: string; kind: 'html' | 'svg'; content: string } | null): void;
  setProjectsViewOpen(open: boolean): void;
  setActiveProject(pid: string | null, opts?: { selectName?: boolean }): void;
  setProjectView(view: ProjectView): void;
  /** Reads nl_tabs_v1; call after the app store has hydrated. */
  restoreTabs(deleted: ReadonlySet<string>, fallbackId: string): void;
  /** Opens `id` as a tab (if new) and activates it. */
  activateTab(id: string): void;
  closeTab(id: string): string | null;
  /** Re-activates the tab last left (skipping closed ones) and returns its id, or null when there is none. */
  goBackTab(): string | null;
  /** Drops tabs for threads that were deleted, activating a neighbour. */
  dropTabs(ids: string[]): void;
  /** Resolves true on confirm, false on cancel/Esc/outside click. */
  askConfirm(req: ConfirmRequest): Promise<boolean>;
  resolveConfirm(ok: boolean): void;
  openNotePane(noteId: string): void;
  closeNotePane(): void;
  /** `persist` is set when a drag ends: dragging itself writes nothing. */
  setNotePaneWidth(width: number, persist?: boolean): void;
}

const HISTORY_LIMIT = 50;

function persistTabs(tabs: Tab[], active: string | null): void {
  try { localStorage.setItem(TAB_STORAGE_KEY, serializeTabs(tabs, active)); } catch { /* storage may be blocked; tabs are a convenience */ }
}

export const useUiStore = create<UiState & UiActions>((set, get) => ({
  sidebarOpen: false, // legacy ships the sidebar collapsed
  settingsOpen: false,
  settingsTab: 'general',
  searchOpen: false,
  shortcutsOpen: false,
  highlightsOpen: false,
  threadMapOpen: false,
  canvasOpen: false,
  ctxOpen: false,
  imagePreview: null,
  filePreview: null,
  projectsViewOpen: false,
  activeProjectId: null,
  projectView: 'overview',
  selectProjectName: false,
  tabs: [],
  activeTabId: null,
  tabHistory: [],
  confirm: null,
  notePaneId: null,
  notePaneWidth: readPaneWidth(),

  openNotePane(noteId) { set({ notePaneId: noteId }); },
  closeNotePane() { set({ notePaneId: null }); },
  setNotePaneWidth(width, persist = false) {
    set({ notePaneWidth: width });
    if (persist) writePaneWidth(width);
  },
  setSidebarOpen(open) { set({ sidebarOpen: open }); },
  setSettingsOpen(open) { set({ settingsOpen: open }); },
  setSettingsTab(tab) { set({ settingsTab: tab }); },
  openSettings(tab) { set(tab ? { settingsOpen: true, settingsTab: tab } : { settingsOpen: true }); },
  setSearchOpen(open) { set({ searchOpen: open }); },
  setShortcutsOpen(open) { set({ shortcutsOpen: open }); },
  setHighlightsOpen(open) { set({ highlightsOpen: open }); },
  setThreadMapOpen(open) { set({ threadMapOpen: open }); },
  setCanvasOpen(open) { set({ canvasOpen: open }); },
  setCtxOpen(open) { set({ ctxOpen: open }); },
  setImagePreview(image) { set({ imagePreview: image }); },
  setFilePreview(file) { set({ filePreview: file }); },
  setProjectsViewOpen(open) { set({ projectsViewOpen: open }); },
  setActiveProject(pid, opts) { set({ activeProjectId: pid, projectView: 'overview', selectProjectName: !!opts?.selectName }); },
  setProjectView(view) { set({ projectView: view }); },

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
    const { activeTabId, tabHistory } = get();
    const history = activeTabId && activeTabId !== id ? [...tabHistory, activeTabId].slice(-HISTORY_LIMIT) : tabHistory;
    set({ tabs: next, activeTabId: id, tabHistory: history });
    persistTabs(next, id);
  },

  goBackTab() {
    const { tabs, tabHistory, activeTabId } = get();
    const history = [...tabHistory];
    let target: string | undefined;
    while ((target = history.pop()) !== undefined) {
      if (target !== activeTabId && tabs.some(t => t.id === target)) break;
    }
    if (target === undefined) { set({ tabHistory: [] }); return null; }
    set({ activeTabId: target, tabHistory: history });
    persistTabs(tabs, target);
    return target;
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
