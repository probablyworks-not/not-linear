import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { AppShell } from './shell/AppShell';
import { queryClient } from './lib/query-client';
import { handleEscape, installGlobalKeys } from './lib/keyboard';
import { installSwipeBack } from './lib/swipe-back';
import { registerView, mountView } from './registry/views';
import { useAppStore } from './state/app-store';
import { useUiStore } from './state/ui-store';
import { newChat, newChatInProject, syncFromDisk } from './state/actions';
import { viewForTab } from './shell/TabStrip';
import { flags } from './flags';
import { setProjectSources } from './projects/extras/sources';
import { artifactSource } from './projects/extras/artifact-source';
import { installRuntimeLogSync } from './lib/runtime-log-sync';
import { branchCurrentSelection, copyLastReply, retryFailedTurn } from './chat/shortcuts';
import './styles/app.css';

registerView({ id: 'chat', label: 'Chat' });
registerView({ id: 'notes', label: 'Notes' });
registerView({ id: 'canvas', label: 'Canvas' });
registerView({ id: 'blank', label: 'New tab' });

/** The thread the chat shortcuts act on, or null when a Notes page or blank tab is in front. */
function activeChatThread(): string | null {
  const id = useUiStore.getState().activeTabId ?? useAppStore.getState().currentThreadId;
  return viewForTab(id) === 'chat' ? id : null;
}

/** Two-finger swipe back: step out of whatever is open (the Esc chain), else return to the tab last left. */
function goBack(): void {
  if (handleEscape()) return;
  const id = useUiStore.getState().goBackTab();
  if (!id) return;
  mountView(viewForTab(id));
  if (viewForTab(id) === 'chat') void useAppStore.getState().openThread(id);
}

async function boot(): Promise<void> {
  setProjectSources({ artifacts: artifactSource });
  await useAppStore.getState().hydrate();
  const app = useAppStore.getState();
  useUiStore.getState().restoreTabs(new Set(app.deletedThreadIds), app.currentThreadId);
  mountView(viewForTab(useUiStore.getState().activeTabId ?? app.currentThreadId));

  if (flags.logs) installRuntimeLogSync();
  installGlobalKeys({
    // On a project's screen, ⌘N starts the chat inside that project.
    newChat: () => { const pid = useUiStore.getState().activeProjectId; void (pid ? newChatInProject(pid) : newChat()); },
    toggleSearch: () => { if (flags.search) useUiStore.getState().setSearchOpen(!useUiStore.getState().searchOpen); },
    toggleShortcuts: () => { const ui = useUiStore.getState(); ui.setShortcutsOpen(!ui.shortcutsOpen); },
    branchSelection: () => { const id = activeChatThread(); if (id) void branchCurrentSelection(id); },
    copyLastReply: () => { const id = activeChatThread(); if (id) void copyLastReply(id); },
    retryLastReply: () => { const id = activeChatThread(); if (id) void retryFailedTurn(id); },
  });
  installSwipeBack(goBack);
  // The other app may have changed the shared row while this one was hidden.
  window.addEventListener('focus', () => { void syncFromDisk(); useAppStore.getState().refreshApiKeys(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { void syncFromDisk(); useAppStore.getState().refreshApiKeys(); }
    else void useAppStore.getState().flushPrefs();
  });

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <AppShell />
      </QueryClientProvider>
    </StrictMode>,
  );
}

void boot();
