import { FolderMinus, Pin } from 'lucide-react';
import type { LegacyNote } from '../notes/types';
import { NoteGlyph } from '../notes/NoteGlyph';
import { ago, isPinned, noteTitle, notePreview } from './project-summary';
import { MoveToProjectButton } from './MoveToProjectButton';

const act = 'grid h-6 w-6 flex-none place-items-center rounded-[5px] text-sec-notes opacity-0 hover:bg-sec-notes-line focus-visible:opacity-100 group-hover:opacity-100';

/** One note as a tinted card. `compact` is the 2×2 tile on the overview; the full one fills the Notes drill-in. */
export function NoteCard({ note, pid, compact, onOpen, onPin, onMove, onRemove }: {
  note: LegacyNote; pid: string; compact?: boolean;
  onOpen(): void; onPin(pinned: boolean): void; onMove(to: string | null): void; onRemove(): void;
}) {
  const title = noteTitle(note);
  const pinned = isPinned(note);
  const updated = typeof note.updatedAt === 'number' ? note.updatedAt : undefined;
  return (
    <div
      data-note={note.id} data-pinned={pinned ? 'true' : 'false'}
      className={`group relative flex cursor-pointer flex-col rounded-xl border border-sec-notes-line bg-sec-notes-soft hover:brightness-95 ${compact ? 'min-h-[92px] gap-1 p-3' : 'min-h-[170px] gap-2 p-4'}`}
      onClick={e => { if (!(e.target as HTMLElement).closest('button')) onOpen(); }}
    >
      <div className="flex items-center gap-2">
        <span className="grid flex-none place-items-center text-sec-notes"><NoteGlyph value={note.emoji} size={compact ? 15 : 18} /></span>
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 truncate text-left text-sm font-semibold text-text">{title}</button>
        <button
          type="button" aria-label={`${pinned ? 'Unpin' : 'Pin'} ${title}`} aria-pressed={pinned} title={pinned ? 'Unpin' : 'Pin'}
          onClick={() => onPin(!pinned)}
          className={`grid h-6 w-6 flex-none place-items-center rounded-[5px] text-sec-notes hover:bg-sec-notes-line focus-visible:opacity-100 ${pinned ? '' : 'opacity-0 group-hover:opacity-100'}`}
        >
          <Pin size={13} fill={pinned ? 'currentColor' : 'none'} />
        </button>
      </div>
      <div className={`flex-1 text-xs leading-normal text-text-2 ${compact ? 'line-clamp-2' : 'line-clamp-4'}`}>{notePreview(note)}</div>
      <div className="flex items-center gap-1 text-xs text-text-3">
        <span>{ago(updated)}</span>
        <span className="flex-1" />
        <MoveToProjectButton label={`Move ${title} to another project`} current={pid} onMove={onMove} className={act} />
        <button type="button" title="Remove from project" aria-label={`Remove ${title} from project`} onClick={onRemove} className={act}>
          <FolderMinus size={13} />
        </button>
      </div>
    </div>
  );
}
