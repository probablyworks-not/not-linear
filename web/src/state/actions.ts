import { useAppStore } from './app-store';
import { useUiStore } from './ui-store';
import { mountView } from '../registry/views';
import { confirmDeleteChat } from '../ui/confirm-copy';
import { toast } from '../ui/toast';
import { MAIN_THREAD_ID, visibleThreads } from '../db/thread-ops';

// Shell-level operations that span both stores. These are what the legacy
// `register*Opener` bridges became: plain functions, callable from anywhere.

export async function selectThread(id: string): Promise<void> {
  useUiStore.getState().activateTab(id);
  mountView('chat');
  await useAppStore.getState().openThread(id);
}

export async function newChat(): Promise<void> {
  const id = await useAppStore.getState().createThread();
  if (!id) return;
  useUiStore.getState().activateTab(id);
  mountView('chat');
  if (window.innerWidth <= 760) useUiStore.getState().setSidebarOpen(false);
  toast('New chat opened');
}

export async function deleteChat(id: string): Promise<void> {
  if (id === MAIN_THREAD_ID) return;
  const app = useAppStore.getState();
  const row = visibleThreads({
    threads: app.threadState, current: app.currentThreadId, dynamic: app.dynamicThreads,
    deletedThreads: app.deletedThreadIds, chatCount: app.newChatCount,
    projects: app.projects, projectCount: app.projectCount, prefs: app.prefs,
  }).find(r => r.id === id);
  const ui = useUiStore.getState();
  if (!(await ui.askConfirm(confirmDeleteChat(row?.title ?? 'this chat')))) return;
  if (!(await app.deleteThread(id))) return;
  useUiStore.getState().dropTabs([id]);
  const next = useUiStore.getState().activeTabId;
  if (next) await useAppStore.getState().openThread(next);
  toast('Chat deleted');
}

/**
 * Re-reads the shared row. Called when the window regains focus: the other app
 * may have created or deleted threads while this one sat in the background.
 * (Cross-app live notification is not available — the two apps ship different
 * Dexie builds — so focus is the sync point.)
 */
export async function syncFromDisk(): Promise<void> {
  // Pending debounced edits first, or the re-read would overwrite text still being typed.
  await useAppStore.getState().flushPrefs();
  await useAppStore.getState().hydrate();
  useUiStore.getState().dropTabs(useAppStore.getState().deletedThreadIds);
}
