import { useUiStore } from '../state/ui-store';
import { mountView } from '../registry/views';
import { canvasTabId } from '../state/tabs';
import { closeProjectPanel } from '../state/actions';

/**
 * Opening a canvas gives it its own tab, unlike Notes' singleton `notes` tab. That singleton is
 * what bugs #042/#043 were about — two notes could not be open at once and navigating between them
 * lost the first. A canvas is a workspace, so each gets an identity from the start.
 */
export function openCanvas(canvasId: string): void {
  // A canvas is an ordinary tab, so the project screen has to let go of it. The project panel is a
  // full-screen Radix dialog: left open it sits over the tab and marks everything behind it
  // aria-hidden, which hides the canvas from assistive technology and from the keyboard. The plan
  // calls this out as the one ownership question a canvas tab raises.
  closeProjectPanel();
  useUiStore.getState().setProjectsViewOpen(false);
  useUiStore.getState().activateTab(canvasTabId(canvasId));
  mountView('canvas');
}
