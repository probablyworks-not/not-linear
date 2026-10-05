import { Download } from 'lucide-react';
import { toast } from 'sonner';
import { saveMarkdownFile } from '../lib/save-file';
import { exportFilename, noteToMarkdown } from './export-markdown';
import { useNotesStore } from './notes-store';

/** Top-bar button, shown on an open page only. Writes nothing, so it works before the backup. */
export function ExportButton({ noteId }: { noteId: string }) {
  return (
    <button
      type="button" title="Export page + subpages as Markdown" aria-label="Export as Markdown" data-testid="export-note"
      onClick={() => {
        const all = useNotesStore.getState().notes;
        const note = all.find(n => n.id === noteId);
        if (!note) return;
        // Straight from the click: a save dialog has to be opened by the gesture itself (BUGS #021/#022).
        saveMarkdownFile(exportFilename(note), noteToMarkdown(all, noteId)).catch(() => toast.error('Could not export this note'));
      }}
      className="grid h-7 w-7 place-items-center rounded-md text-text-2 hover:bg-bg-2 hover:text-text"
    >
      <Download size={15} />
    </button>
  );
}
