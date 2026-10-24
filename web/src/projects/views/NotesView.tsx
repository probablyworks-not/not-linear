import { useState } from 'react';
import { NotebookText } from 'lucide-react';
import type { LegacyNote } from '../../notes/types';
import { moveNoteToProject, newNoteInProject, setNotePinned } from '../../notes/notes-actions';
import { openNote } from '../../notes/open-note';
import { closeProjectPanel } from '../../state/actions';
import { NoteCard } from '../NoteCard';
import { NotePicker } from '../NotePicker';
import { filterNotes, isPinned, type NoteFilter } from '../project-summary';
import { FilterPills, headerGhost, headerPrimary, ViewHeader } from './ViewHeader';

/** The Notes drill-in. Filters are All and Pinned; "Linked to chats" waits for a note-to-chat link to exist. */
export function NotesView({ pid, projectName, notes, ungrouped }: { pid: string; projectName: string; notes: LegacyNote[]; ungrouped: LegacyNote[] }) {
  const [filter, setFilter] = useState<NoteFilter>('all');
  const [picker, setPicker] = useState(false);
  const shown = filterNotes(notes, filter);
  const pinned = notes.filter(isPinned).length;
  return (
    <div data-testid="notes-view">
      <ViewHeader
        projectName={projectName} icon={<NotebookText size={22} aria-hidden className="text-sec-notes" />}
        title="Notes" count={notes.length} subtitle="Write alongside your chats — notes live in this project"
        actions={(
          <>
            <button type="button" className={headerGhost} aria-expanded={picker} onClick={() => setPicker(p => !p)}>Add existing</button>
            <button type="button" className={headerPrimary} onClick={() => { void newNoteInProject(pid); }}>New note</button>
          </>
        )}
      />
      <FilterPills<NoteFilter> value={filter} onChange={setFilter} options={[{ id: 'all', label: 'All', count: notes.length }, { id: 'pinned', label: 'Pinned', count: pinned }]} />
      {picker && <NotePicker notes={ungrouped} onPick={id => { void moveNoteToProject(id, pid); }} />}
      {shown.length === 0 ? (
        <div className="rounded-xl border border-dashed border-rule-2 p-8 text-center text-sm text-text-3">
          {filter === 'pinned' ? 'No pinned notes. Pin one with the pin on its card.' : 'No notes yet.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map(n => (
            <NoteCard
              key={n.id} note={n} pid={pid}
              onOpen={() => { closeProjectPanel(); openNote(n.id); }}
              onPin={p => { void setNotePinned(n.id, p); }}
              onMove={to => { void moveNoteToProject(n.id, to); }}
              onRemove={() => { void moveNoteToProject(n.id, null); }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
