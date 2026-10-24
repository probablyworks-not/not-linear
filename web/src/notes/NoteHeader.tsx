import { useRef, useState } from 'react';
import { Camera, ImagePlus, MoveVertical, Trash2, X } from 'lucide-react';
import { GlyphButton } from '../ui/GlyphButton';
import { timeAgo } from './bento';
import { NoteGlyph } from './NoteGlyph';
import { removePageCover, setCoverPosition, setPageCover, setPageIcon, setPageTags, uploadPageIcon } from './notes-actions';
import { useNotesStore } from './notes-store';
import type { Cover } from './notes-repo';
import type { LegacyNote } from './types';

// Everything above the blocks, laid out as the classic page is: a hairline cover strip that offers
// "Add cover" on hover, a big icon with camera/remove on hover, a 40px title, quiet mono tags and meta.
// The 54px inset is BlockNote's own, so the header and the text share one left edge.

const INSET = 'pl-[54px]';
const SMALL_BTN = 'grid h-6 w-6 place-items-center rounded-[5px] bg-bg-2 text-text-3 hover:bg-bg-3 hover:text-text';
const COVER_BTN = 'inline-flex items-center gap-1 rounded-md bg-scrim px-2.5 py-1.5 text-xs text-white hover:opacity-90';

function FilePicker({ onFile, children, className, title }: { onFile(f: File): void; children: React.ReactNode; className: string; title?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" title={title} className={className} onClick={() => ref.current?.click()}>{children}</button>
      <input
        ref={ref} type="file" accept="image/*" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onFile(f); }}
      />
    </>
  );
}

function CoverBar({ note, editable }: { note: LegacyNote; editable: boolean }) {
  const cover = note.cover as Cover | undefined;
  const [pos, setPos] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);

  if (!cover) {
    // A hairline until hovered, then room for the button (legacy .cover-wrap).
    return (
      <div className="group relative h-2 rounded-lg hover:bg-bg-2" data-testid="note-cover-strip">
        {editable && (
          <FilePicker className="absolute left-0 top-2.5 z-10 hidden items-center gap-1.5 rounded-md bg-bg-2 px-2.5 py-1.5 text-xs text-text-2 hover:bg-bg-3 group-hover:flex focus-visible:flex" onFile={f => { void setPageCover(note.id, f); }}>
            <ImagePlus size={12} aria-hidden /> Add cover
          </FilePicker>
        )}
      </div>
    );
  }
  const shown = pos ?? cover.posY ?? 50;
  const startReposition = (e: React.MouseEvent) => {
    e.stopPropagation();
    const startY = e.clientY;
    const start = cover.posY ?? 50;
    const height = box.current?.getBoundingClientRect().height || 1;
    let last = start;
    const move = (mv: MouseEvent) => { last = Math.max(0, Math.min(100, start + ((mv.clientY - startY) / height) * 100)); setPos(last); };
    const up = () => {
      document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up);
      void setCoverPosition(note.id, last).then(() => setPos(null));
    };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
  };
  return (
    <div ref={box} data-testid="note-cover" className="group relative mb-2 h-[200px] w-full overflow-hidden rounded-lg">
      <img src={cover.src} alt="" draggable={false} className="block h-full w-full select-none rounded-lg object-cover" style={{ objectPosition: `center ${shown}%` }} />
      {editable && (
        <div className="absolute bottom-2.5 right-2.5 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <button type="button" className={COVER_BTN} onMouseDown={startReposition}><MoveVertical size={12} aria-hidden /> Reposition</button>
          <FilePicker className={COVER_BTN} onFile={f => { void setPageCover(note.id, f); }}><ImagePlus size={12} aria-hidden /> Change</FilePicker>
          <button type="button" className={COVER_BTN} onClick={() => { void removePageCover(note.id); }}><Trash2 size={12} aria-hidden /> Remove</button>
        </div>
      )}
    </div>
  );
}

function Tags({ note, editable }: { note: LegacyNote; editable: boolean }) {
  const tags = Array.isArray(note.tags) ? (note.tags as unknown[]).filter((t): t is string => typeof t === 'string') : [];
  const [adding, setAdding] = useState(false);
  const commit = (raw: string) => {
    const v = raw.trim();
    setAdding(false);
    if (v && !tags.includes(v)) void setPageTags(note.id, [...tags, v]);
  };
  return (
    <div className={`mb-0.5 mt-2.5 flex flex-wrap items-center gap-1.5 font-mono text-[11px] ${INSET}`} data-testid="note-tags">
      {tags.map(t => (
        <span key={t} className="inline-flex items-center gap-[5px] rounded-[11px] bg-bg-2 px-2 py-0.5 text-text-2">
          # {t}
          {editable && (
            <button type="button" aria-label={`Remove tag ${t}`} title="remove" onClick={() => { void setPageTags(note.id, tags.filter(x => x !== t)); }} className="grid h-3 w-3 place-items-center rounded-full text-text-3 hover:bg-bg-3 hover:text-text">
              <X size={10} />
            </button>
          )}
        </span>
      ))}
      {editable && (adding ? (
        <input
          autoFocus aria-label="New tag" placeholder="tag…" className="min-w-[80px] rounded-[11px] border border-rule-2 bg-bg-2 px-2 py-0.5 font-mono text-[11px] text-text outline-none"
          onKeyDown={e => { if (e.key === 'Enter') commit(e.currentTarget.value); else if (e.key === 'Escape') setAdding(false); }}
          onBlur={e => commit(e.currentTarget.value)}
        />
      ) : (
        <button type="button" className="rounded-[11px] border border-dashed border-rule-2 px-2 py-0.5 text-text-3 hover:bg-bg-2 hover:text-text-2" onClick={() => setAdding(true)}>+ add tag</button>
      ))}
    </div>
  );
}

/** Cover, icon, title, tags and the meta line: everything above the blocks. */
export function NoteHeader({ note, editable, onTitleChange }: { note: LegacyNote; editable: boolean; onTitleChange(title: string): void }) {
  const notes = useNotesStore(s => s.notes);
  const parent = typeof note.parent === 'string' ? notes.find(n => n.id === note.parent) : undefined;
  const custom = typeof note.emoji === 'string' && note.emoji.startsWith('img:');
  const parentTitle = typeof parent?.title === 'string' && parent.title ? parent.title : 'Untitled';
  const blockCount = Array.isArray(note.blocks) ? note.blocks.length : 0;
  const when = timeAgo(Number(note.updatedAt ?? note.createdAt) || undefined) || 'just now';
  const dot = <span className="h-[3px] w-[3px] rounded-full bg-text-3 opacity-50" aria-hidden />;
  return (
    <header>
      <CoverBar note={note} editable={editable} />
      <div className={`group mb-1 flex items-end gap-1.5 ${INSET} -ml-1.5`}>
        {editable ? (
          <GlyphButton
            value={note.emoji} cycle={[]} index={0} size={56} title="Change icon"
            fallback={<NoteGlyph value={note.emoji} size={56} />}
            onPick={token => { void setPageIcon(note.id, token); }}
            className="grid cursor-pointer place-items-center rounded-[10px] p-1.5 hover:bg-bg-2"
          />
        ) : <span className="grid place-items-center p-1.5"><NoteGlyph value={note.emoji} size={56} /></span>}
        {editable && (
          <span className="flex gap-0.5 pb-2 opacity-0 transition-opacity duration-100 group-hover:opacity-100 focus-within:opacity-100">
            <FilePicker title="Upload image icon" className={SMALL_BTN} onFile={f => { void uploadPageIcon(note.id, f); }}>
              <Camera size={13} aria-label="Upload image icon" />
            </FilePicker>
            {custom && (
              <button type="button" title="Remove custom icon" aria-label="Remove custom icon" onClick={() => { void setPageIcon(note.id, null); }} className={SMALL_BTN}>
                <X size={13} />
              </button>
            )}
          </span>
        )}
      </div>
      <input
        aria-label="Note title" defaultValue={typeof note.title === 'string' ? note.title : ''} disabled={!editable} placeholder="Untitled"
        onChange={e => onTitleChange(e.target.value)}
        className={`mb-0.5 mt-2 block min-h-[48px] w-full bg-transparent pr-0 text-[40px] font-bold leading-[1.15] tracking-[-0.025em] text-text outline-none placeholder:text-text-3 disabled:opacity-100 ${INSET}`}
      />
      <Tags note={note} editable={editable} />
      <p className={`mb-[22px] mt-3 flex items-center gap-3.5 font-mono text-[11.5px] text-text-3 ${INSET}`} data-testid="note-meta">
        <span>{blockCount} blocks</span>{dot}<span>updated {when}</span>{dot}<span>{parent ? `subpage of ${parentTitle}` : 'top-level'}</span>
      </p>
    </header>
  );
}
