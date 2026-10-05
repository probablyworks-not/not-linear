import { useEffect } from 'react';
import { NotebookText, Plus, Trash2, FilePlus2 } from 'lucide-react';
import { parseIconToken, renderIconSvg, useMindGarden } from '../lib/mind-garden';
import { BackupNotice } from './BackupNotice';
import { bloomFor, shapeFor, timeAgo, tintFor } from './bento';
import { NoteGlyph } from './NoteGlyph';
import { deletePage, newPage } from './notes-actions';
import { kidsOf } from './notes-ops';
import { useNotesStore } from './notes-store';
import { openNote } from './open-note';
import type { LegacyNote } from './types';

// The Notes home page: a bento grid, newest-edited first. Each card's colour comes from its icon, its
// shape from its id, and the faint icon bleeding off its corner is the page's own icon (legacy
// renderBentoCard). Nothing about the layout is stored.

/** A giant, faint copy of the page's icon. Skipped for uploaded photos: a huge faint raster reads as a bug. */
function Bloom({ note, shape }: { note: LegacyNote; shape: ReturnType<typeof shapeFor> }) {
  const entries = useMindGarden(s => s.entries);
  const load = useMindGarden(s => s.load);
  useEffect(() => { void load(); }, [load]);
  const icon = note.emoji;
  if (typeof icon === 'string' && icon.startsWith('img:')) return null;
  const { size, rotate } = bloomFor(note.id, shape);

  // An icon the user coloured keeps its colour; otherwise it takes the card's tint (legacy bentoIconHTML).
  const parsed = typeof icon === 'string' && icon.startsWith('icon:') ? parseIconToken(icon) : null;
  const svg = parsed ? renderIconSvg(entries, parsed.id, { size, color: parsed.color || 'var(--tfg)' }) : '';
  return (
    <span className="nl-bloom" aria-hidden style={{ transform: `rotate(${rotate}deg)` }}>
      {svg
        ? <span dangerouslySetInnerHTML={{ __html: svg }} />
        : <span style={{ fontSize: size, lineHeight: 1 }}><NoteGlyph value={icon} size={size} /></span>}
    </span>
  );
}

function BentoCard({ note, index, notes }: { note: LegacyNote; index: number; notes: readonly LegacyNote[] }) {
  const shape = shapeFor(note.id, index);
  const tint = tintFor(note.emoji || '📄');
  const kids = kidsOf(notes, note.id).length;
  const blocks = Array.isArray(note.blocks) ? note.blocks.length : 0;
  const title = typeof note.title === 'string' && note.title ? note.title : '';
  const ago = timeAgo(Number(note.updatedAt ?? note.createdAt) || undefined);
  const meta = [`${blocks} block${blocks === 1 ? '' : 's'}`, kids ? `${kids} subpage${kids === 1 ? '' : 's'}` : '', ago].filter(Boolean).join(' · ');

  return (
    <div
      role="button" tabIndex={0} data-note-card={note.id} data-shape={shape || 'normal'}
      className={`nl-bento-item${shape ? ` ${shape}` : ''}`}
      style={{ ['--tbg' as string]: `var(--bento-${tint}-bg)`, ['--tfg' as string]: `var(--bento-${tint}-fg)` }}
      onClick={() => openNote(note.id)}
      onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openNote(note.id); } }}
    >
      <Bloom note={note} shape={shape} />
      <div className={`nl-ix-name${title ? '' : ' placeholder'}`}>{title || 'Untitled'}</div>
      <div className="nl-ix-meta">{meta}</div>
      <div className="nl-ix-acts">
        <button type="button" title="Add subpage" aria-label={`Add subpage to ${title || 'Untitled'}`} onClick={e => { e.stopPropagation(); void newPage(note.id); }}><Plus size={13} /></button>
        <button type="button" className="nl-ix-del" title="Delete page" aria-label={`Delete ${title || 'Untitled'}`} onClick={e => { e.stopPropagation(); void deletePage(note.id); }}><Trash2 size={13} /></button>
      </div>
    </div>
  );
}

export function NotesIndex() {
  const notes = useNotesStore(s => s.notes);
  const loaded = useNotesStore(s => s.loaded);
  const locked = useNotesStore(s => s.backup === null);
  if (!loaded) return <p className="p-8 text-sm text-text-3">Loading&hellip;</p>;

  const roots = kidsOf(notes, null).slice().sort((a, b) => Number(b.updatedAt ?? b.createdAt ?? 0) - Number(a.updatedAt ?? a.createdAt ?? 0));
  return (
    <div className="nl-index" data-testid="notes-index">
      <div className="nl-ix-head">
        <div className="nl-ix-titlewrap">
          <div className="nl-ix-icon"><NotebookText size={16} aria-hidden /></div>
          <div>
            <div className="nl-ix-title">Notes</div>
            <div className="nl-ix-sub">{notes.length} page{notes.length === 1 ? '' : 's'}</div>
          </div>
        </div>
        <button type="button" className="nl-ix-new" onClick={() => { void newPage(null); }}><Plus size={15} aria-hidden /><span>New page</span></button>
      </div>
      {locked && <BackupNotice />}
      {roots.length === 0 ? (
        <button type="button" className="nl-ix-empty" onClick={() => { void newPage(null); }}>
          <FilePlus2 size={18} aria-hidden /><span>No pages yet &mdash; create your first one.</span>
        </button>
      ) : (
        <div className="nl-bento" data-testid="notes-grid">
          {roots.map((n, i) => <BentoCard key={n.id} note={n} index={i} notes={notes} />)}
          <button type="button" className="nl-bento-add" onClick={() => { void newPage(null); }}><Plus size={18} aria-hidden /><span>New note</span></button>
        </div>
      )}
    </div>
  );
}
