import { useAppStore } from './app-store';
import { useUiStore } from './ui-store';
import { mountView } from '../registry/views';
import { confirmDeleteChat } from '../ui/confirm-copy';
import { toast } from '../ui/toast';
import { MAIN_THREAD_ID, visibleThreads } from '../db/thread-ops';
import { confirmDeleteProject } from '../ui/confirm-copy';
import { pickFiles } from '../attachments/pick-files';
import { readFiles } from '../attachments/read-files';
import { LOCAL_HEADER } from '../lib/api';

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

// ---- Projects -------------------------------------------------------------

/** app.js:5393 openProjectPanel: stamp updatedAt on first open, tuck the sidebar away, show the panel. */
export async function openProjectPanel(pid: string, opts?: { selectName?: boolean }): Promise<void> {
  const ui = useUiStore.getState();
  ui.setProjectsViewOpen(false);
  ui.setSidebarOpen(false);
  ui.setActiveProject(pid, opts);
  await useAppStore.getState().touchProjectOnOpen(pid);
}

export function closeProjectPanel(): void {
  useUiStore.getState().setActiveProject(null);
  void useAppStore.getState().flushPrefs();
}

export async function newProject(): Promise<void> {
  const pid = await useAppStore.getState().createProject();
  if (pid) await openProjectPanel(pid, { selectName: true });
}

/** app.js:5576 newChatInProject. */
export async function newChatInProject(pid: string): Promise<void> {
  await useAppStore.getState().flushPrefs();
  const id = await useAppStore.getState().newChatInProject(pid);
  if (!id) return;
  const ui = useUiStore.getState();
  ui.activateTab(id);
  mountView('chat');
  closeProjectPanel();
  if (window.innerWidth <= 760) ui.setSidebarOpen(false);
  toast('New chat in project');
}

export async function addExistingChat(pid: string, tid: string): Promise<void> {
  if (await useAppStore.getState().addChatToProject(pid, tid)) toast('Chat added to project');
}

/** app.js:5516 click on a chat row in the panel. */
export async function openProjectChat(tid: string): Promise<void> {
  closeProjectPanel();
  await selectThread(tid);
}

/** app.js:5675 #project-delete. */
export async function deleteProjectWithConfirm(pid: string): Promise<void> {
  const p = useAppStore.getState().projects[pid];
  if (!p) return;
  if (!(await useUiStore.getState().askConfirm(confirmDeleteProject(p.name || 'Untitled project')))) return;
  closeProjectPanel();
  if (await useAppStore.getState().deleteProject(pid)) toast('Project deleted');
}

// ---- Project files and linked folder (P4 item 5) ----------------------------

/** app.js:5694 #project-add-file. */
export async function addFilesToProject(pid: string): Promise<void> {
  const picked = await pickFiles();
  if (!picked.length) return;
  try {
    const read = await readFiles(picked);
    if (!read.length) { toast('No readable files added'); return; }
    // The panel may have been closed, or the project deleted, while the files were read.
    if (!useAppStore.getState().projects[pid]) return;
    await useAppStore.getState().addProjectFiles(pid, read);
    toast(`Added ${read.length} file${read.length > 1 ? 's' : ''} to project`);
  } catch (e) {
    toast('Could not add files: ' + (e instanceof Error ? e.message : String(e)));
    console.error('notlinear: add project file error', e);
  }
}

/** app.js:5604 #project-link-folder. The server records the pick in its consent ledger (ADR-035). */
export async function linkProjectFolder(pid: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch('/__notlinear_pick_folder', { method: 'POST', headers: { 'content-type': 'application/json', ...LOCAL_HEADER }, body: '{}' });
  } catch {
    toast('Folder picker needs the local server (run backend/server.py)');
    return;
  }
  if (res.status === 404 || res.status === 501) { toast('Restart the server — folder picker endpoint missing'); return; }
  let data: { cancelled?: boolean; ok?: boolean; path?: string; error?: string } | null;
  try { data = (await res.json()) as typeof data; } catch { data = null; }
  if (data?.cancelled) return;
  if (!data?.ok) { toast(data?.error ? `Picker error: ${data.error}` : 'Could not pick folder'); return; }
  if (await useAppStore.getState().setProjectPath(pid, data.path || '')) toast('Folder linked');
}

export async function unlinkProjectFolder(pid: string): Promise<void> {
  if (await useAppStore.getState().setProjectPath(pid, '')) toast('Folder unlinked');
}

/** Saves the icon chosen for a thread (`thread.emoji`, the field both apps read and write). */
export async function setThreadGlyph(threadId: string, token: string): Promise<void> {
  await useAppStore.getState().updateThreads(s => {
    const t = s.threads[threadId] ?? (s.deletedThreads.includes(threadId) ? undefined : (s.threads[threadId] = { kind: 'chat', title: 'Untitled chat', stream: '' }));
    if (t) t.emoji = token;
  });
}

/** The same for a project (`project.emoji`). */
export async function setProjectGlyph(projectId: string, token: string): Promise<void> {
  await useAppStore.getState().updateThreads(s => {
    const p = s.projects[projectId];
    if (p) (p as { emoji?: string }).emoji = token;
  });
}
