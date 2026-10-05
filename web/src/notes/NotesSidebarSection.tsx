import { useEffect, useState } from 'react';
import { clsx } from 'clsx';
import { ChevronRight, Copy, NotebookText, Plus, Trash2 } from 'lucide-react';
import { useUiStore } from '../state/ui-store';
import { SidebarSection } from '../shell/SidebarSection';
import { NoteGlyph } from './NoteGlyph';
import { deleteAllPages, deletePage, duplicatePage, movePage, newPage, toggleExpanded } from './notes-actions';
import { canReparent, kidsOf } from './notes-ops';
import { useNotesStore } from './notes-store';
import { openNote, openNotesIndex } from './open-note';

const ICON_BTN = 'grid h-5 w-5 flex-none place-items-center rounded text-text-3 hover:bg-bg-3 hover:text-text';

// The page being dragged. Module state, like legacy's sideDragCtx: a drag is one gesture in one window.
let dragging: string | null = null;

function NoteRow({ id, depth }: { id: string; depth: number }) {
  const notes = useNotesStore(s => s.notes);
  const open = useNotesStore(s => s.openIds.has(id));
  const activeTabId = useUiStore(s => s.activeTabId);
  const [over, setOver] = useState(false);
  const n = notes.find(x => x.id === id);
  if (!n) return null;
  const kids = kidsOf(notes, id);
  const active = activeTabId === `note:${id}`;
  const title = typeof n.title === 'string' && n.title ? n.title : 'Untitled';
  const droppable = () => dragging !== null && canReparent(notes, dragging, id);

  return (
    <div>
      <div
        role="listitem" data-note={id} data-has-kids={kids.length > 0} draggable
        className={clsx(
          'group flex items-center gap-1 rounded-md py-1 pr-1 text-sm leading-tight text-text-2 hover:bg-bg-2 hover:text-text',
          active && 'bg-bg-2 text-text', over && 'ring-1 ring-inset ring-branch',
        )}
        style={{ paddingLeft: 4 + depth * 14 }}
        onDragStart={e => { e.stopPropagation(); dragging = id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', id); }}
        onDragEnd={() => { dragging = null; setOver(false); }}
        onDragOver={e => { if (!droppable()) return; e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move'; setOver(true); }}
        onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false); }}
        onDrop={e => {
          if (!droppable()) return;
          e.preventDefault(); e.stopPropagation();
          const moving = dragging; dragging = null; setOver(false);
          if (moving) void movePage(moving, id);
        }}
      >
        <button
          type="button" aria-label={open ? 'Collapse' : 'Expand'} aria-expanded={kids.length ? open : undefined}
          onClick={e => { e.stopPropagation(); void toggleExpanded(id); }}
          className={clsx(ICON_BTN, kids.length === 0 && 'invisible')}
        >
          <ChevronRight size={12} className={clsx('transition-transform duration-150', open && 'rotate-90')} />
        </button>
        <button
          type="button" onClick={() => openNote(id)} aria-current={active ? 'page' : undefined}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span className="grid w-[18px] flex-none place-items-center"><NoteGlyph value={n.emoji} size={16} /></span>
          <span className={clsx('truncate', !n.title && 'text-text-3')}>{title}</span>
        </button>
        <span className="flex flex-none items-center opacity-0 focus-within:opacity-100 group-hover:opacity-100">
          <button type="button" title="Add subpage" aria-label={`Add subpage to ${title}`} onClick={() => { void newPage(id); }} className={ICON_BTN}><Plus size={12} /></button>
          <button type="button" title="Duplicate page" aria-label={`Duplicate ${title}`} onClick={() => { void duplicatePage(id); }} className={ICON_BTN}><Copy size={12} /></button>
          <button type="button" title="Delete note" aria-label={`Delete ${title}`} onClick={() => { void deletePage(id); }} className={ICON_BTN}><Trash2 size={12} /></button>
        </span>
      </div>
      {open && kids.map(k => <NoteRow key={k.id} id={k.id} depth={depth + 1} />)}
    </div>
  );
}

export function NotesSidebarSection() {
  const notes = useNotesStore(s => s.notes);
  const load = useNotesStore(s => s.load);

  useEffect(() => { void load(); }, [load]);

  const roots = kidsOf(notes, null);
  return (
    <SidebarSection
      section="notes" label="Notes"
      actions={(
        <>
          <button type="button" title="All notes" aria-label="All notes" onClick={openNotesIndex} className={ICON_BTN}><NotebookText size={13} /></button>
          <button type="button" title="Delete all notes" aria-label="Delete all notes" onClick={() => { void deleteAllPages(); }} className={ICON_BTN}><Trash2 size={13} /></button>
          <button type="button" title="New note" aria-label="New note" onClick={() => { void newPage(null); }} className={ICON_BTN}><Plus size={13} /></button>
        </>
      )}
    >
      {/* Dropping on the empty part of the list moves a page to the top level (legacy wireSidebar). */}
      <div
        role="list" data-testid="notes-tree" className="min-h-[24px] pb-5"
        onDragOver={e => { if (dragging !== null && canReparent(notes, dragging, null)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } }}
        onDrop={e => {
          if (dragging === null || !canReparent(notes, dragging, null)) return;
          e.preventDefault();
          const moving = dragging; dragging = null;
          void movePage(moving, null);
        }}
      >
        {roots.map(n => <NoteRow key={n.id} id={n.id} depth={0} />)}
        {roots.length === 0 && <p className="px-2 py-1 text-xs text-text-3">No notes yet.</p>}
      </div>
    </SidebarSection>
  );
}
