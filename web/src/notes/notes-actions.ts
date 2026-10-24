import { toast } from 'sonner';
import { useAppStore } from '../state/app-store';
import { useUiStore } from '../state/ui-store';
import { closeProjectPanel, selectThread } from '../state/actions';
import { mountView } from '../registry/views';
import { viewForTab } from '../shell/TabStrip';
import { downscaleImage } from '../lib/downscale-image';
import { collectIds } from './notes-ops';
import {
  createNote, deleteNotes, duplicateNote, patchNote, reparentNote, setExpanded, setNoteProject, type Cover,
} from './notes-repo';
import { useNotesStore } from './notes-store';
import { openNote, openNotesIndex } from './open-note';

// What the Notes UI does, in one place: guard the backup lock, call the repo, refresh the store,
// say what happened. Messages are legacy's.

const store = () => useNotesStore.getState();
const note = (id: string) => store().notes.find(n => n.id === id);
const titleOf = (id: string) => { const t = note(id)?.title; return typeof t === 'string' && t ? t : 'Untitled'; };

/** False (after pointing at the backup) while Notes are still locked. */
function unlocked(): boolean {
  if (store().backup) return true;
  openNotesIndex();
  toast('Back up your notes first, then editing unlocks');
  return false;
}

async function guarded<T>(what: string, run: () => Promise<T>): Promise<T | undefined> {
  if (!unlocked()) return undefined;
  try {
    const out = await run();
    await store().load();
    return out;
  } catch (err) {
    toast.error(`Could not ${what}: ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}

export async function newPage(parent: string | null = null): Promise<void> {
  const made = await guarded('create a page', () => createNote(parent));
  if (made) openNote(made.id);
}

export async function toggleExpanded(id: string): Promise<void> {
  await guarded('expand', () => setExpanded(id, !store().openIds.has(id)));
}

export async function duplicatePage(id: string): Promise<void> {
  if (await guarded('duplicate the page', () => duplicateNote(id))) toast('page duplicated');
}

export async function movePage(id: string, parent: string | null): Promise<void> {
  const moved = await guarded('move the page', () => reparentNote(id, parent));
  if (moved) toast(parent ? `moved into ${titleOf(parent)}` : 'moved to top level');
}

export async function moveNoteToProject(id: string, pid: string | null): Promise<void> {
  const moved = await guarded('move the note', () => setNoteProject(id, pid));
  if (!moved) return;
  const name = pid ? useAppStore.getState().projects[pid]?.name || 'Untitled project' : '';
  toast(pid ? `moved into ${name}` : 'removed from project');
}

export async function newNoteInProject(pid: string): Promise<void> {
  const made = await guarded('create a page', async () => {
    const n = await createNote(null);
    await setNoteProject(n.id, pid);
    return n;
  });
  if (made) { closeProjectPanel(); openNote(made.id); }
}

function closeTabsFor(ids: string[]): void {
  const ui = useUiStore.getState();
  ui.dropTabs(ids.map(id => `note:${id}`));
  const next = useUiStore.getState().activeTabId;
  if (!next) return;
  if (viewForTab(next) === 'chat') void selectThread(next);
  else mountView(viewForTab(next));
}

export async function deletePage(id: string): Promise<void> {
  if (!unlocked()) return;
  const ids = collectIds(store().notes, id);
  const kids = Math.max(0, ids.length - 1);
  const ok = await useUiStore.getState().askConfirm({
    heading: ids.length > 1 ? 'Delete notes?' : 'Delete note?',
    name: titleOf(id),
    before: 'This removes',
    after: ids.length > 1 ? ` and ${kids} subpage${kids === 1 ? '' : 's'} from Notes.` : ' from Notes.',
    actionLabel: ids.length > 1 ? 'Delete notes' : 'Delete note',
  });
  if (!ok) return;
  if (await guarded('delete the page', () => deleteNotes(ids))) {
    closeTabsFor(ids);
    toast(ids.length > 1 ? 'Notes deleted' : 'Note deleted');
  }
}

export async function deleteAllPages(): Promise<void> {
  if (!unlocked()) return;
  const all = store().notes.map(n => n.id);
  if (!all.length) { toast('No notes to delete'); return; }
  const ok = await useUiStore.getState().askConfirm({
    heading: 'Delete all notes?', name: 'Notes', before: 'This removes',
    after: ' from the sidebar and clears every saved note page.', actionLabel: 'Delete all notes',
  });
  if (!ok) return;
  if (await guarded('delete the notes', () => deleteNotes(all))) {
    closeTabsFor(all);
    toast('Notes deleted');
  }
}

export async function setPageIcon(id: string, token: string | null): Promise<void> {
  await guarded('change the icon', () => patchNote(id, { emoji: token }));
}

export async function uploadPageIcon(id: string, file: File): Promise<void> {
  try {
    const url = await downscaleImage(file, { maxW: 128, maxH: 128, square: true, mime: 'image/png' });
    await setPageIcon(id, `img:${url}`);
  } catch { toast('could not read image'); }
}

export async function setPageCover(id: string, file: File): Promise<void> {
  try {
    const src = await downscaleImage(file, { maxW: 1600, mime: 'image/jpeg', quality: 0.85 });
    await guarded('set the cover', () => patchNote(id, { cover: { src, posY: 50 } satisfies Cover }));
  } catch { toast('could not read image'); }
}

export async function removePageCover(id: string): Promise<void> {
  await guarded('remove the cover', () => patchNote(id, { cover: null }));
}

export async function setCoverPosition(id: string, posY: number): Promise<void> {
  const cover = note(id)?.cover as Cover | undefined;
  if (!cover) return;
  await guarded('move the cover', () => patchNote(id, { cover: { ...cover, posY } }));
}

export async function setPageTags(id: string, tags: string[]): Promise<void> {
  await guarded('change the tags', () => patchNote(id, { tags }));
}

export async function setNotePinned(id: string, pinned: boolean): Promise<void> {
  await guarded('pin the note', () => patchNote(id, { pinned }));
}
