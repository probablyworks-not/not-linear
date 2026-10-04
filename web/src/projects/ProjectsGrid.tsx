import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowLeft, ChevronDown, Folder, MessagesSquare, Plus, Search } from 'lucide-react';
import { useAppStore } from '../state/app-store';
import { useUiStore } from '../state/ui-store';
import { newProject, openProjectPanel } from '../state/actions';
import { ESC_PRIORITY, useEscLayer } from '../lib/keyboard';
import { timeAgoShort } from '../lib/time-ago';
import { chatCount, gridProjects, type ProjectSort } from '../db/project-ops';
import type { PersistedState } from '../db/types';

/** The full-screen "all chat projects" grid (index.html #projects-view, app.js:5420). */
export function ProjectsGrid() {
  const open = useUiStore(s => s.projectsViewOpen);
  const setOpen = useUiStore(s => s.setProjectsViewOpen);
  const close = (): void => setOpen(false);
  useEscLayer('projectsView', ESC_PRIORITY.projectsView, open, close);

  return (
    <Dialog.Root open={open} onOpenChange={o => { if (!o) close(); }}>
      <Dialog.Portal>
        <Dialog.Content
          aria-describedby={undefined} onEscapeKeyDown={e => e.preventDefault()}
          className="fixed inset-0 z-[150] flex flex-col bg-bg"
        >
          <div className="flex items-center gap-3 border-b border-rule px-7 py-3">
            <Dialog.Close aria-label="Back" title="Back" className="grid h-7 w-7 place-items-center rounded-md text-text-2 hover:bg-bg-2 hover:text-text">
              <ArrowLeft size={15} />
            </Dialog.Close>
            <Dialog.Title className="m-0 flex items-center gap-2 text-sm font-normal text-text-2">
              <Folder size={14} aria-hidden />Projects
            </Dialog.Title>
          </div>
          <div className="flex-1 overflow-y-auto">
            <Body />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Mounted only while open, so search and sort reset on every open (app.js:5440). */
function Body() {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<ProjectSort>('updated');
  const [menu, setMenu] = useState(false);
  const projects = useAppStore(s => s.projects);
  const threads = useAppStore(s => s.threadState);

  const view = { projects, threads } as PersistedState;
  const cards = gridProjects(view, search, sort);

  return (
    <div className="mx-auto w-full max-w-[920px] px-7 py-6">
      <div className="mb-5 flex items-center gap-2.5">
        <label className="flex flex-1 items-center gap-2 rounded-lg border border-rule-2 bg-surface px-3 py-2 text-text-3 focus-within:border-text-2">
          <Search size={14} aria-hidden />
          <input
            autoComplete="off" placeholder="Search projects…" aria-label="Search projects" value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 border-none bg-transparent text-sm text-text outline-none placeholder:text-text-3"
          />
        </label>
        <div className="relative">
          <button
            type="button" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(m => !m)}
            className="flex items-center gap-1.5 rounded-lg border border-rule-2 bg-surface px-3 py-2 text-sm text-text-2 hover:text-text"
          >
            Sort by <span>{sort === 'name' ? 'Name' : 'Last updated'}</span><ChevronDown size={13} aria-hidden />
          </button>
          {menu && (
            <div role="menu" className="absolute right-0 z-10 mt-1 min-w-[150px] rounded-lg border border-rule-2 bg-surface p-1 shadow-md">
              {([['updated', 'Last updated'], ['name', 'Name']] as const).map(([v, label]) => (
                <button
                  key={v} type="button" role="menuitemradio" aria-checked={sort === v}
                  onClick={() => { setSort(v); setMenu(false); }}
                  className="block w-full rounded-md px-2.5 py-1.5 text-left text-sm text-text-2 hover:bg-bg-2 hover:text-text"
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          type="button" onClick={() => { void newProject(); }}
          className="flex items-center gap-1.5 rounded-lg border border-text bg-text px-3 py-2 text-sm font-medium text-bg"
        >
          <Plus size={14} aria-hidden />New project
        </button>
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3.5" data-testid="project-grid">
        {cards.map(p => {
          const n = chatCount(view, p.id);
          return (
            <button
              key={p.id} type="button" data-pid={p.id} onClick={() => { void openProjectPanel(p.id); }}
              className="flex flex-col gap-2.5 rounded-xl border border-rule bg-surface p-4 text-left hover:border-rule-2 hover:bg-surface-2"
            >
              <span className="flex items-center gap-2.5">
                <Folder size={18} aria-hidden className="flex-none text-text-2" />
                <span className="truncate text-base font-medium text-text">{p.name || 'Untitled project'}</span>
              </span>
              <span className="flex items-center gap-1.5 text-xs text-text-3">
                <MessagesSquare size={12} aria-hidden />{n} thread{n === 1 ? '' : 's'}<span>·</span>Updated {timeAgoShort(p.updatedAt)}
              </span>
            </button>
          );
        })}
        <button
          type="button" id="pv-grid-new" onClick={() => { void newProject(); }}
          className="flex min-h-[84px] flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-rule-2 text-sm text-text-3 hover:border-text-3 hover:text-text-2"
        >
          <Plus size={16} aria-hidden /><span>New project</span>
        </button>
      </div>
    </div>
  );
}
