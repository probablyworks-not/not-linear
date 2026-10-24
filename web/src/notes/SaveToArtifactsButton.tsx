import { Shapes } from 'lucide-react';
import { saveToArtifacts } from '../projects/extras/save-to-artifacts';
import { useAppStore } from '../state/app-store';
import { noteToMarkdown } from './export-markdown';
import { useNotesStore } from './notes-store';

/** Snapshots this note into its project's AI artifacts. Saving again adds a version. Needs the note to be in a project. */
export function SaveToArtifactsButton({ noteId }: { noteId: string }) {
  const notes = useNotesStore(s => s.notes);
  const projects = useAppStore(s => s.projects);
  const note = notes.find(n => n.id === noteId);
  const pid = typeof note?.projectId === 'string' && projects[note.projectId] ? note.projectId : null;
  const title = pid ? 'Save to project artifacts' : 'Move this note into a project to save it to artifacts';
  return (
    <button
      type="button" title={title} aria-label="Save to artifacts" data-testid="save-note-artifact" disabled={!pid}
      onClick={() => {
        if (!pid || !note) return;
        const name = typeof note.title === 'string' && note.title.trim() ? note.title.trim() : 'Untitled';
        void saveToArtifacts({ projectId: pid, title: name, type: 'MD', content: noteToMarkdown(notes, noteId), chatId: '', source: 'note-save', noteId, dedupeKey: `note:${noteId}` });
      }}
      className="grid h-7 w-7 place-items-center rounded-md text-text-2 hover:bg-bg-2 hover:text-text disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
    ><Shapes size={14} /></button>
  );
}
