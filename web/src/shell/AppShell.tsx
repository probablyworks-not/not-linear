import { useMemo, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { useAppStore } from '../state/app-store';
import { useUiStore } from '../state/ui-store';
import { useActiveViewId } from '../registry/views';
import { newChat } from '../state/actions';
import { MAIN_THREAD_ID, visibleThreads } from '../db/thread-ops';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { TabStrip } from './TabStrip';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { Toaster } from '../ui/toast';
import { SettingsDialog } from '../settings/SettingsDialog';
import { ModesDialog } from '../settings/ModesDialog';
import { SearchPalette } from '../search/SearchPalette';
import { ProjectsGrid } from '../projects/ProjectsGrid';
import { ProjectPanel } from '../projects/ProjectPanel';
import { FeedbackPanel } from '../feedback/FeedbackPanel';
import { CapturePreview } from '../feedback/CapturePreview';
import { ChatView } from '../chat/ChatView';
import { Breadcrumbs } from '../chat/Breadcrumbs';
import { ImagePreview } from '../ui/ImagePreview';
import { flags } from '../flags';

export function AppShell() {
  const sidebarOpen = useUiStore(s => s.sidebarOpen);
  const activeTabId = useUiStore(s => s.activeTabId);
  const view = useActiveViewId();
  const threadState = useAppStore(s => s.threadState);
  const dynamic = useAppStore(s => s.dynamicThreads);
  const deleted = useAppStore(s => s.deletedThreadIds);
  const error = useAppStore(s => s.error);

  const title = useMemo(() => {
    const rows = visibleThreads({
      threads: threadState, dynamic, deletedThreads: deleted,
      current: MAIN_THREAD_ID, chatCount: 1, projects: {}, projectCount: 1, prefs: {},
    });
    return rows.find(r => r.id === activeTabId)?.title ?? 'Untitled chat';
  }, [threadState, dynamic, deleted, activeTabId]);

  const trail: ReactNode = view === 'notes' ? 'Notes'
    : view === 'blank' ? 'New tab'
    : flags.chat && activeTabId ? <Breadcrumbs threadId={activeTabId} fallbackTitle={title} /> : title;

  return (
    <div className="min-h-full">
      <Sidebar />
      <div className={clsx('flex min-h-screen flex-col transition-[margin] duration-200 ease-out', sidebarOpen && 'md:ml-sidebar')}>
        <TabStrip />
        <Topbar trail={trail} />
        {error && (
          // Errors read as a calm statement of what happened, not an apology.
          <div role="alert" className="mx-7 mt-2 rounded-md border border-rule-2 bg-surface-2 px-3 py-2 text-sm text-text-2">{error}</div>
        )}
        {view === 'chat' && flags.chat && activeTabId ? (
          <main className="flex flex-1 flex-col"><ChatView key={activeTabId} threadId={activeTabId} /></main>
        ) : (
          <main className="flex flex-1 items-center justify-center px-7 py-16">
            {view === 'blank' ? (
              <div className="text-center">
                <p className="mb-4 text-sm text-text-2">Start a chat, or pick one from the left pane.</p>
                <button
                  type="button" onClick={() => { void newChat(); }}
                  className="rounded-lg border border-rule-2 bg-bg-2 px-3.5 py-2 text-sm text-text hover:bg-bg-3"
                >
                  New chat
                </button>
              </div>
            ) : (
              <p className="max-w-sm text-center text-sm text-text-3" data-testid="pane-placeholder">
                {view === 'notes'
                  ? 'Notes open in the classic app until the editor moves over.'
                  : 'This thread opens in the classic app until chat moves over. Everything you see in the left pane is the same data.'}
              </p>
            )}
          </main>
        )}
      </div>
      {flags.settings && <SettingsDialog />}
      {flags.modes && <ModesDialog />}
      {flags.search && <SearchPalette />}
      {flags.projects && <ProjectsGrid />}
      {flags.projects && <ProjectPanel />}
      {flags.feedback && <FeedbackPanel />}
      {flags.feedback && <CapturePreview />}
      <ConfirmDialog />
      <ImagePreview />
      <Toaster />
    </div>
  );
}
