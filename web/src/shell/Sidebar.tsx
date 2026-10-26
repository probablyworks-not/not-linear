import { useMemo, useState } from 'react';
import { clsx } from 'clsx';
import { FileText, MessageSquare, PanelLeftClose, Pencil, Search, Settings, Trash2 } from 'lucide-react';
import { useAppStore } from '../state/app-store';
import { useUiStore } from '../state/ui-store';
import { deleteChat, moveChat, newChat, selectThread, setThreadGlyph } from '../state/actions';
import { ESC_PRIORITY, useEscLayer } from '../lib/keyboard';
import { visibleThreads, MAIN_THREAD_ID } from '../db/thread-ops';
import { flags } from '../flags';
import { MoveToProjectButton } from '../projects/MoveToProjectButton';
import { ProjectsSidebarSection } from '../projects/ProjectsSidebarSection';
import { RecentBranches } from '../branch/RecentBranches';
import { NotesSidebarSection } from '../notes/NotesSidebarSection';
import { CanvasesSidebarSection } from '../canvas/view/CanvasesSidebarSection';
import { SidebarSection } from './SidebarSection';
import { ShowMoreButton } from './ShowMoreButton';
import { SIDEBAR_VISIBLE, byRecency, threadTouchedAt } from './recency';
import { GlyphButton } from '../ui/GlyphButton';
import { THREAD_ICON_CYCLE } from '../lib/mind-garden';

const SIDE_ITEM = 'relative flex w-full items-center gap-[9px] rounded-md text-left text-sm leading-tight text-text-2 hover:bg-bg-2 hover:text-text';

export function Sidebar() {
  const open = useUiStore(s => s.sidebarOpen);
  const setOpen = useUiStore(s => s.setSidebarOpen);
  const setSettingsOpen = useUiStore(s => s.setSettingsOpen);
  const setSearchOpen = useUiStore(s => s.setSearchOpen);
  const activeTabId = useUiStore(s => s.activeTabId);
  const threadState = useAppStore(s => s.threadState);
  const dynamic = useAppStore(s => s.dynamicThreads);
  const deleted = useAppStore(s => s.deletedThreadIds);
  const name = useAppStore(s => s.prefs.name);
  const projects = useAppStore(s => s.projects);

  const [showAll, setShowAll] = useState(false);
  // A chat filed in a project is reached through the project, not the flat list (app.js:5348).
  const rows = useMemo(
    () => byRecency(
      visibleThreads({
        threads: threadState, dynamic, deletedThreads: deleted,
        current: MAIN_THREAD_ID, chatCount: 1, projects: {}, projectCount: 1, prefs: {},
      }).filter(r => !(flags.projects && r.projectId && projects[r.projectId])),
      r => threadTouchedAt(threadState[r.id]),
    ),
    [threadState, dynamic, deleted, projects],
  );
  const shown = showAll ? rows : rows.slice(0, SIDEBAR_VISIBLE);

  useEscLayer('sidebar', ESC_PRIORITY.sidebar, open, () => setOpen(false));
  const displayName = name || 'You';

  return (
    <>
      {open && <div className="fixed inset-0 z-[70] bg-scrim md:hidden" onClick={() => setOpen(false)} />}
      <aside
        aria-label="Left pane"
        aria-hidden={!open}
        className={clsx(
          'fixed inset-y-0 left-0 z-[80] flex w-sidebar flex-col border-r border-rule bg-surface-2 px-2.5 py-3.5 shadow-lg',
          // `invisible` when closed takes the pane out of the tab order (legacy
          // leaves it off-screen but focusable); transitioning visibility keeps
          // the slide-out visible until it finishes.
          'transition-[transform,visibility] duration-200 ease-out',
          open ? 'translate-x-0' : 'invisible -translate-x-[calc(100%+1px)]',
        )}
      >
        <div className="mb-3.5 flex items-center gap-[9px] px-2 py-1.5">
          <span className="text-base font-semibold tracking-tight">
            not<span className="text-accent">linear</span>
          </span>
          <button
            type="button" title="Close left pane" aria-label="Close left pane"
            onClick={() => setOpen(false)}
            className="ml-auto grid h-6 w-6 place-items-center rounded-md text-text-3 hover:bg-bg-3 hover:text-text"
          >
            <PanelLeftClose size={15} />
          </button>
        </div>

        <div className="-mx-2.5 flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden px-2.5">
          {flags.search && (
            <button
              type="button" onClick={() => setSearchOpen(true)} aria-label="Search"
              className={`${SIDE_ITEM} mb-1 px-2 py-1.5`}
            >
              <Search size={15} aria-hidden />
              <span className="flex-1 truncate">Search</span>
              <span className="font-mono text-xs text-text-3">⌘K</span>
            </button>
          )}
          <button
            type="button" onClick={() => { void newChat(); }}
            className="flex w-full items-center gap-[9px] rounded-[10px] border border-rule-2 bg-text px-3 py-2 text-left text-sm font-medium text-bg shadow-md"
          >
            <Pencil size={13} aria-hidden />
            <span className="flex-1 truncate">New chat</span>
            <span className="rounded-[5px] bg-kbd-bg px-1.5 py-0.5 font-mono text-xs text-kbd-fg">⌘N</span>
          </button>

          {flags.projects && <ProjectsSidebarSection />}

          <SidebarSection section="threads" label="Threads">
          <div role="list">
            {shown.map((row, rowIndex) => {
              const active = row.id === activeTabId;
              return (
                <div
                  key={row.id} role="listitem" data-thread={row.id} data-title={row.title}
                  className={clsx(SIDE_ITEM, 'group p-0', active && 'bg-bg-2 text-text')}
                >
                  <GlyphButton
                    value={row.emoji} cycle={THREAD_ICON_CYCLE} index={rowIndex} size={22}
                    fallback={row.isStatic ? <FileText size={15} aria-hidden /> : <MessageSquare size={15} aria-hidden />}
                    onPick={token => { void setThreadGlyph(row.id, token); }}
                    className="ml-2 grid h-[22px] w-[22px] flex-none cursor-pointer place-items-center rounded-md text-sm hover:bg-bg-3"
                  />
                  <button
                    type="button" onClick={() => { void selectThread(row.id); }}
                    aria-current={active ? 'page' : undefined}
                    className="flex min-w-0 flex-1 items-center gap-[9px] py-1.5 pl-1 pr-2 text-left"
                  >
                    <span className="truncate">{row.title}</span>
                    {row.unread && <span aria-label="Unread" className="ml-auto h-1.5 w-1.5 flex-none rounded-full bg-accent-2" />}
                  </button>
                  {flags.projects && row.id !== MAIN_THREAD_ID && (
                    <MoveToProjectButton
                      label={`Move ${row.title} to a project`} current={row.projectId}
                      onMove={pid => { void moveChat(row.id, pid); }}
                      className="mr-0.5 grid h-6 w-6 flex-none place-items-center rounded-[5px] text-text-3 opacity-0 hover:bg-bg-3 hover:text-text focus-visible:opacity-100 group-hover:opacity-100"
                    />
                  )}
                  {row.id !== MAIN_THREAD_ID && (
                    <button
                      type="button" title="Delete chat" aria-label={`Delete ${row.title}`}
                      onClick={() => { void deleteChat(row.id); }}
                      className="mr-1 grid h-6 w-6 flex-none place-items-center rounded-[5px] text-text-3 opacity-0 hover:bg-bg-3 hover:text-text focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {rows.length > SIDEBAR_VISIBLE && (
            <ShowMoreButton expanded={showAll} hidden={rows.length - SIDEBAR_VISIBLE} onToggle={() => setShowAll(v => !v)} />
          )}
          </SidebarSection>

          {flags.notesV2 && <NotesSidebarSection />}

          {flags.canvas && <CanvasesSidebarSection />}

          {flags.chat && <RecentBranches />}
        </div>

        {/* Identity + the way into Settings (flags.settings). */}
        {flags.settings ? (
          <button
            type="button" onClick={() => setSettingsOpen(true)} aria-label="Open settings"
            className="mt-auto flex w-full items-center gap-2 rounded-md p-2 text-left hover:bg-bg-2"
          >
            <div className="grid h-6 w-6 place-items-center rounded-full bg-bg-3 text-xs font-medium">
              {(displayName.trim()[0] ?? 'Y').toUpperCase()}
            </div>
            <div className="flex-1 truncate text-sm font-medium">{displayName}</div>
            <Settings size={14} className="text-text-3" aria-hidden />
          </button>
        ) : (
          <div className="mt-auto flex items-center gap-2 rounded-md p-2">
            <div className="grid h-6 w-6 place-items-center rounded-full bg-bg-3 text-xs font-medium">
              {(displayName.trim()[0] ?? 'Y').toUpperCase()}
            </div>
            <div className="flex-1 truncate text-sm font-medium">{displayName}</div>
          </div>
        )}
      </aside>
    </>
  );
}
