import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { AppShell } from './shell/AppShell';
import { queryClient } from './lib/query-client';
import { installGlobalKeys } from './lib/keyboard';
import { registerView, mountView } from './registry/views';
import { useAppStore } from './state/app-store';
import { useUiStore } from './state/ui-store';
import { newChat, syncFromDisk } from './state/actions';
import { viewForTab } from './shell/TabStrip';
import './styles/app.css';

registerView({ id: 'chat', label: 'Chat' });
registerView({ id: 'notes', label: 'Notes' });
registerView({ id: 'blank', label: 'New tab' });

async function boot(): Promise<void> {
  await useAppStore.getState().hydrate();
  const app = useAppStore.getState();
  useUiStore.getState().restoreTabs(new Set(app.deletedThreadIds), app.currentThreadId);
  mountView(viewForTab(useUiStore.getState().activeTabId ?? app.currentThreadId));

  installGlobalKeys({ newChat: () => { void newChat(); } });
  // The other app may have changed the shared row while this one was hidden.
  window.addEventListener('focus', () => { void syncFromDisk(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void syncFromDisk();
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
