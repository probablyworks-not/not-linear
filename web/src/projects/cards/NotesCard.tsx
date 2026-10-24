import { NotebookText, Plus } from 'lucide-react';
import type { LegacyNote } from '../../notes/types';
import { moveNoteToProject, newNoteInProject, setNotePinned } from '../../notes/notes-actions';
import { openNote } from '../../notes/open-note';
import { closeProjectPanel } from '../../state/actions';
import { useUiStore } from '../../state/ui-store';
import { NoteCard } from '../NoteCard';
import { NotePicker } from '../NotePicker';
import { filterNotes } from '../project-summary';
import { EmptyBody, SectionCard } from './SectionCard';

export function NotesCard({ pid, notes, ungrouped, picker, onTogglePicker }: {
  pid: string; notes: LegacyNote[]; ungrouped: LegacyNote[]; picker: boolean; onTogglePicker(): void;
}) {
  const setView = useUiStore(s => s.setProjectView);
  const tiles = filterNotes(notes, 'all').slice(0, 4);
  const empty = notes.length === 0;
  const ghost = 'h-8 rounded-lg border px-3 text-xs';
  return (
    <SectionCard
      accent="notes" icon={<NotebookText size={16} aria-hidden />} label="Notes" count={notes.length} empty={empty} span="col-span-3" testId="card-notes"
      onHeader={empty ? undefined : () => setView('notes')}
      action={empty ? undefined : (
        <>
          <button type="button" onClick={onTogglePicker} aria-expanded={picker} className="rounded-md px-2 py-1 text-xs text-branch hover:bg-bg-2">Add existing</button>
          <button type="button" title="New note" aria-label="New note" onClick={() => { void newNoteInProject(pid); }} className="grid h-6 w-6 place-items-center rounded-md text-text-3 hover:bg-bg-2 hover:text-text">
            <Plus size={14} />
          </button>
        </>
      )}
    >
      {picker && <NotePicker notes={ungrouped} onPick={id => { void moveNoteToProject(id, pid); }} />}
      {empty ? (
        <EmptyBody accent="notes" icon={<NotebookText size={24} aria-hidden />} title="No notes yet" hint="Capture decisions, research and loose thoughts next to your chats.">
          <button type="button" onClick={() => { void newNoteInProject(pid); }} className={`${ghost} border-rule-2 bg-surface text-text`}>New note</button>
          <button type="button" onClick={onTogglePicker} aria-expanded={picker} className={`${ghost} border-transparent text-branch`}>Add existing</button>
        </EmptyBody>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {tiles.map(n => (
            <NoteCard
              key={n.id} note={n} pid={pid} compact
              onOpen={() => { closeProjectPanel(); openNote(n.id); }}
              onPin={p => { void setNotePinned(n.id, p); }}
              onMove={to => { void moveNoteToProject(n.id, to); }}
              onRemove={() => { void moveNoteToProject(n.id, null); }}
            />
          ))}
        </div>
      )}
    </SectionCard>
  );
}
