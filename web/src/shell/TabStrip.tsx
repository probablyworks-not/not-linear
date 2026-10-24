import { clsx } from 'clsx';
import { FileText, Frame, MessageSquare, NotebookText, Plus, SquarePen, X } from 'lucide-react';
import { useMemo } from 'react';
import { useAppStore } from '../state/app-store';
import { useUiStore } from '../state/ui-store';
import { NOTE_TAB_PREFIX, canvasIdOfTab, isCanvasTabId, isNoteTabId, isSingletonTab, SINGLETON_TABS } from '../state/tabs';
import { useNotesStore } from '../notes/notes-store';
import { useCanvasStore } from '../canvas/canvas-store';
import { selectThread } from '../state/actions';
import { mountView } from '../registry/views';
import { Glyph } from '../ui/Glyph';
import { NoteGlyph } from '../notes/NoteGlyph';
import { MAIN_THREAD_ID, STATIC_THREAD_IDS, visibleThreads } from '../db/thread-ops';

/** Which registry view a tab belongs to. */
export function viewForTab(id: string): 'chat' | 'notes' | 'canvas' | 'blank' {
  if (id === 'blank') return 'blank';
  if (id === 'notes' || isNoteTabId(id)) return 'notes';
  if (isCanvasTabId(id)) return 'canvas';
  return 'chat';
}

function noteLabel(notes: { id: string; title?: unknown }[], tabId: string): string {
  const t = notes.find(n => n.id === tabId.slice(NOTE_TAB_PREFIX.length))?.title;
  return typeof t === 'string' && t ? t : 'Note';
}

function noteIcon(notes: { id: string; emoji?: unknown }[], tabId: string): unknown {
  return notes.find(n => n.id === tabId.slice(NOTE_TAB_PREFIX.length))?.emoji;
}

export function TabStrip() {
  const tabs = useUiStore(s => s.tabs);
  const activeId = useUiStore(s => s.activeTabId);
  const activate = useUiStore(s => s.activateTab);
  const close = useUiStore(s => s.closeTab);
  const threadState = useAppStore(s => s.threadState);
  const dynamic = useAppStore(s => s.dynamicThreads);
  const deleted = useAppStore(s => s.deletedThreadIds);
  const notes = useNotesStore(s => s.notes);
  const byProject = useCanvasStore(s => s.byProject);
  const unassignedCanvases = useCanvasStore(s => s.unassigned);

  // A canvas tab's label comes from whatever summaries are loaded; a tab restored before its
  // project has been opened falls back to "Canvas" rather than showing a raw id.
  const canvasTitles = useMemo(() => {
    const all = [...Object.values(byProject).flat(), ...unassignedCanvases];
    return new Map(all.map(c => [c.id, c.title]));
  }, [byProject, unassignedCanvases]);

  const titles = useMemo(() => {
    const rows = visibleThreads({
      threads: threadState, dynamic, deletedThreads: deleted,
      current: MAIN_THREAD_ID, chatCount: 1, projects: {}, projectCount: 1, prefs: {},
    });
    return new Map(rows.map(r => [r.id, r.title]));
  }, [threadState, dynamic, deleted]);

  const open = (id: string): void => {
    if (viewForTab(id) === 'chat') { void selectThread(id); return; }
    activate(id);
    mountView(viewForTab(id));
  };

  const closeTab = (id: string): void => {
    const next = close(id);
    if (next) open(next);
  };

  return (
    <div className="flex w-full items-end gap-0.5 border-b border-rule bg-bg px-7 pt-1">
      <div role="tablist" aria-label="Open tabs" className="flex min-w-0 flex-1 items-end gap-0.5 overflow-x-auto [scrollbar-width:none]">
        {tabs.map(tab => {
          const active = tab.id === activeId;
          const label = isSingletonTab(tab.id)
            ? SINGLETON_TABS[tab.id].label
            : isNoteTabId(tab.id) ? noteLabel(notes, tab.id)
            : isCanvasTabId(tab.id) ? canvasTitles.get(canvasIdOfTab(tab.id)) ?? 'Canvas'
            : (titles.get(tab.id) ?? tab.id);
          const Icon = tab.id === 'blank' ? SquarePen
            : tab.id === 'notes' || isNoteTabId(tab.id) ? NotebookText
            : isCanvasTabId(tab.id) ? Frame
            : STATIC_THREAD_IDS.has(tab.id) ? FileText : MessageSquare;
          return (
            <div
              key={tab.id} role="tab" aria-selected={active}
              className={clsx(
                'flex flex-none cursor-pointer items-center gap-1.5 whitespace-nowrap border-b-2 px-1 py-2 text-xs',
                active ? 'border-branch text-text' : 'border-transparent text-text-3 hover:text-text-2',
              )}
            >
              <button type="button" onClick={() => open(tab.id)} className="flex items-center gap-1.5">
                {/* A chosen glyph replaces the default icon; with none chosen the tab keeps its icon (as legacy, app.js:6414). */}
                {isNoteTabId(tab.id) && noteIcon(notes, tab.id)
                  ? <NoteGlyph value={noteIcon(notes, tab.id)} size={14} />
                  : threadState[tab.id]?.emoji
                  ? <Glyph value={threadState[tab.id]?.emoji} cycle={[]} index={0} size={14} fallback={<Icon size={13} aria-hidden />} />
                  : <Icon size={13} aria-hidden />}
                <span className="max-w-[180px] truncate">{label}</span>
              </button>
              <button
                type="button" aria-label={`Close ${label}`} onClick={() => closeTab(tab.id)}
                className="ml-0.5 rounded p-px text-text-3 hover:bg-bg-3 hover:text-text"
              >
                <X size={12} />
              </button>
            </div>
          );
        })}
      </div>
      <button
        type="button" title="New tab" aria-label="New tab"
        onClick={() => open('blank')}
        className="mb-1.5 ml-1 grid h-[26px] w-[26px] flex-none place-items-center rounded-md text-text-3 hover:bg-bg-2 hover:text-text"
      >
        <Plus size={14} />
      </button>
    </div>
  );
}
