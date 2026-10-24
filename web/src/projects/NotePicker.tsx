import { Plus } from 'lucide-react';
import type { LegacyNote } from '../notes/types';
import { NoteGlyph } from '../notes/NoteGlyph';
import { noteTitle } from './project-summary';

/** Notes that belong to no project, offered for filing into this one. */
export function NotePicker({ notes, onPick }: { notes: readonly LegacyNote[]; onPick(id: string): void }) {
  return (
    <div className="mb-2.5 rounded-lg border border-rule bg-bg p-1" data-testid="existing-note-picker">
      {notes.length === 0 && <div className="p-2.5 text-sm text-text-3">No ungrouped notes to add.</div>}
      {notes.map(n => (
        <button key={n.id} type="button" onClick={() => onPick(n.id)} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-text-2 hover:bg-bg-2 hover:text-text">
          <span className="grid w-[18px] flex-none place-items-center"><NoteGlyph value={n.emoji} size={14} /></span>
          <span className="min-w-0 flex-1 truncate">{noteTitle(n)}</span>
          <Plus size={14} aria-hidden className="flex-none" />
        </button>
      ))}
    </div>
  );
}
