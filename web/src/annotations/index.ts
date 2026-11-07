import { initAnnotations } from './layer';
import { getActiveViewId, onViewChange } from '../registry/views';
import { useCanvasDoc } from '../canvas/canvas-doc-store';
import { useAppStore } from '../state/app-store';
import { useUiStore } from '../state/ui-store';
import '../styles/annotations.css';

let installed = false;
export function installAnnotations(): void {
  if (installed) return;
  installed = true;
  const annotations = initAnnotations({
    getThreadId: () => getActiveViewId() === 'canvas' ? `canvas:${useCanvasDoc.getState().canvasId ?? ''}` : useAppStore.getState().currentThreadId,
    getCanvasBranchId: messageId => useCanvasDoc.getState().doc?.messages.find(message => message.id === messageId)?.threadId ?? '',
    isChat: () => {
      const ui = useUiStore.getState();
      return (getActiveViewId() === 'chat' || (getActiveViewId() === 'canvas' && useCanvasDoc.getState().status === 'ready')) && !ui.canvasOpen && !ui.settingsOpen && !ui.searchOpen && !ui.projectsViewOpen && !ui.activeProjectId;
    },
  });
  onViewChange(annotations.refresh);
  useAppStore.subscribe(annotations.refresh);
  useCanvasDoc.subscribe(annotations.refresh);
  useUiStore.subscribe(annotations.refresh);
}
