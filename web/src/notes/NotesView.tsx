import { useEffect } from 'react';
import { useUiStore } from '../state/ui-store';
import { NOTE_TAB_PREFIX, isNoteTabId } from '../state/tabs';
import { NotePage } from './NotePage';
import { NotesIndex } from './NotesIndex';
import { useNotesStore } from './notes-store';

export function NotesView() {
  const activeTabId = useUiStore(s => s.activeTabId);
  const load = useNotesStore(s => s.load);

  // Reads the database on entry and whenever the window regains focus, because the classic app
  // may have saved in between (the same two-writer rule as the chat store, ADR-041).
  useEffect(() => {
    void load();
    const onFocus = () => { void load(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);

  return (
    <main className="flex-1">
      {activeTabId && isNoteTabId(activeTabId)
        ? <NotePage noteId={activeTabId.slice(NOTE_TAB_PREFIX.length)} />
        : <NotesIndex />}
    </main>
  );
}
