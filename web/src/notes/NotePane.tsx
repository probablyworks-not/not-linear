import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ExternalLink, X } from 'lucide-react';
import { useUiStore } from '../state/ui-store';
import { useNotesStore } from './notes-store';
import { openNote } from './open-note';
import { NoteGlyph } from './NoteGlyph';
import { SaveToArtifactsButton } from './SaveToArtifactsButton';
import { PANE_DEFAULT, SIDEBAR_PX, clampPaneWidth, paneLayout } from './pane-width';

// BlockNote is large and chat should not pay for it until a note is actually opened.
const NotePage = lazy(() => import('./NotePage').then(m => ({ default: m.NotePage })));

const ARROW_STEP = 24;

function useViewportWidth(): number {
  const [w, setW] = useState(window.innerWidth);
  useEffect(() => {
    const on = (): void => setW(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return w;
}

/**
 * A note beside the chat, on the right. The chat column makes room for it (ChatView reads the same
 * layout), the left edge is a drag handle, and the width is remembered. Below 900px it covers the
 * chat instead. The pane writes `--note-pane-room` so the branch drawer sits to its left.
 */
export function NotePane({ noteId }: { noteId: string }) {
  const requested = useUiStore(s => s.notePaneWidth);
  const setWidth = useUiStore(s => s.setNotePaneWidth);
  const close = useUiStore(s => s.closeNotePane);
  const note = useNotesStore(s => s.notes.find(n => n.id === noteId));
  const load = useNotesStore(s => s.load);
  const viewport = useViewportWidth();
  const [top, setTop] = useState(0);
  const [dragging, setDragging] = useState(false);
  const live = useRef(requested);
  const sidebarOpen = useUiStore(s => s.sidebarOpen);
  const reserved = sidebarOpen ? SIDEBAR_PX : 0;
  const layout = paneLayout(requested, viewport, reserved);

  // The store is normally filled by the Notes view; a chat can open a note without ever visiting it.
  useEffect(() => { void load(); }, [load]);

  // Sit below the top bar while it is showing. It slides in and out on a transition, so keep measuring
  // for as long as it moves; measuring only on scroll left the bar drawn over this pane's close button.
  useLayoutEffect(() => {
    let raf = 0;
    let until = 0;
    const measure = (): void => setTop(Math.max(0, document.querySelector('[data-topbar]')?.getBoundingClientRect().bottom ?? 0));
    const track = (): void => {
      measure();
      if (performance.now() < until) raf = requestAnimationFrame(track);
    };
    const kick = (): void => { until = performance.now() + 300; cancelAnimationFrame(raf); raf = requestAnimationFrame(track); };
    const bar = document.querySelector('[data-topbar]')?.parentElement ?? null;
    const watch = bar ? new MutationObserver(kick) : null;
    if (bar) watch?.observe(bar, { attributes: true, attributeFilter: ['data-shown', 'class'] });
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, { passive: true });
    return () => {
      cancelAnimationFrame(raf); watch?.disconnect();
      window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure);
    };
  }, []);

  // Tell the rest of the page how much room the pane takes.
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--note-pane-room', layout.beside ? `${layout.width}px` : '0px');
    return () => { root.style.removeProperty('--note-pane-room'); };
  }, [layout.beside, layout.width]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    // Read from the event before any state update: React resets currentTarget afterwards.
    e.currentTarget.setPointerCapture(e.pointerId);
    live.current = layout.width;
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!dragging) return;
    live.current = clampPaneWidth(window.innerWidth - e.clientX, window.innerWidth, reserved);
    setWidth(live.current);
  };
  const endDrag = (): void => {
    if (!dragging) return;
    setDragging(false);
    setWidth(live.current, true);
  };
  const onHandleKey = (e: React.KeyboardEvent): void => {
    const dir = e.key === 'ArrowLeft' ? 1 : e.key === 'ArrowRight' ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    setWidth(clampPaneWidth(layout.width + dir * ARROW_STEP, window.innerWidth, reserved), true);
  };

  const title = typeof note?.title === 'string' && note.title ? note.title : 'Untitled';
  return (
    <aside
      aria-label="Note" data-testid="note-pane" data-beside={layout.beside}
      className="fixed bottom-0 right-0 z-20 flex flex-col border-l border-rule-2 bg-bg shadow-lg"
      style={{ top, width: layout.width, transition: dragging ? 'none' : 'top 150ms ease-out' }}
    >
      <div
        role="separator" aria-orientation="vertical" aria-label="Resize note" aria-valuemin={0} aria-valuenow={layout.width} tabIndex={0}
        data-testid="note-pane-resize" data-dragging={dragging}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}
        onDoubleClick={() => setWidth(PANE_DEFAULT, true)} onKeyDown={onHandleKey}
        className="absolute -left-1 top-0 z-10 h-full w-2 cursor-col-resize touch-none after:absolute after:inset-y-0 after:left-[3px] after:w-px after:bg-transparent hover:after:bg-accent focus-visible:after:bg-accent data-[dragging=true]:after:bg-accent"
      />
      <div className="flex flex-none items-center gap-2 border-b border-rule px-3 py-1.5">
        <span className="grid h-5 w-5 flex-none place-items-center text-sm">{note ? <NoteGlyph value={note.emoji} /> : null}</span>
        <span className="min-w-0 flex-1 truncate text-sm text-text-2" data-testid="note-pane-title">{title}</span>
        <SaveToArtifactsButton noteId={noteId} />
        <button
          type="button" title="Open as full page" aria-label="Open as full page"
          onClick={() => { close(); openNote(noteId); }}
          className="grid h-7 w-7 place-items-center rounded-md text-text-2 hover:bg-bg-2 hover:text-text"
        ><ExternalLink size={14} /></button>
        <button
          type="button" title="Close note" aria-label="Close note" onClick={close}
          className="grid h-7 w-7 place-items-center rounded-md text-text-2 hover:bg-bg-2 hover:text-text"
        ><X size={15} /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Suspense fallback={<p className="p-6 text-sm text-text-3">Loading&hellip;</p>}>
          <NotePage noteId={noteId} compact />
        </Suspense>
      </div>
    </aside>
  );
}
