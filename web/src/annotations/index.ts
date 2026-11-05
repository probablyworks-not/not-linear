import { initAnnotations } from './layer';
import { getActiveViewId, onViewChange } from '../registry/views';
import { useAppStore } from '../state/app-store';
import { useUiStore } from '../state/ui-store';
import '../styles/annotations.css';

let installed = false;
export function installAnnotations(): void {
  if (installed) return;
  installed = true;
  const annotations = initAnnotations({
    getThreadId: () => useAppStore.getState().currentThreadId,
    isChat: () => {
      const ui = useUiStore.getState();
      return getActiveViewId() === 'chat' && !ui.canvasOpen && !ui.settingsOpen && !ui.searchOpen && !ui.projectsViewOpen && !ui.activeProjectId;
    },
  });
  onViewChange(annotations.refresh);
  useAppStore.subscribe(annotations.refresh);
  useUiStore.subscribe(annotations.refresh);
}
