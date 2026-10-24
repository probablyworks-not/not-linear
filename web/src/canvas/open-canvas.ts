import { useUiStore } from '../state/ui-store';
import { mountView } from '../registry/views';
import { canvasTabId } from '../state/tabs';

/**
 * Opening a canvas gives it its own tab, unlike Notes' singleton `notes` tab. That singleton is
 * what bugs #042/#043 were about — two notes could not be open at once and navigating between them
 * lost the first. A canvas is a workspace, so each gets an identity from the start.
 */
export function openCanvas(canvasId: string): void {
  useUiStore.getState().activateTab(canvasTabId(canvasId));
  mountView('canvas');
}
