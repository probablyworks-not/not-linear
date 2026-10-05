import { useUiStore } from '../state/ui-store';
import { mountView } from '../registry/views';
import { NOTE_TAB_PREFIX } from '../state/tabs';

export function openNote(id: string): void {
  useUiStore.getState().activateTab(`${NOTE_TAB_PREFIX}${id}`);
  mountView('notes');
}

export function openNotesIndex(): void {
  useUiStore.getState().activateTab('notes');
  mountView('notes');
}
