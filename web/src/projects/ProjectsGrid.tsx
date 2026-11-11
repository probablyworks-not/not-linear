import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowLeft, ChevronDown, Folder, Plus, Search } from 'lucide-react';
import { useAppStore } from '../state/app-store';
import { useUiStore } from '../state/ui-store';
import { newProject, openProjectPanel } from '../state/actions';
import { ESC_PRIORITY, useEscLayer } from '../lib/keyboard';
import { timeAgoShort } from '../lib/time-ago';
import { cycleIcon, PROJECT_ICON_CYCLE } from '../lib/mind-garden';
import { shapeFor, tintFor } from '../notes/bento';
import { Bloom } from '../notes/Bloom';
import { threadTouchedAt } from '../shell/recency';
import { chatCount, gridProjects, type ProjectSort } from '../db/project-ops';
import type { PersistedState, PersistedProject } from '../db/types';

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

  const total = Object.keys(projects).length;
  const threadTotal = Object.keys(threads).length;
  return (
    <div className="nl-index" data-testid="projects-index">
      <div className="nl-ix-head">
        <div className="nl-ix-titlewrap">
          <div className="nl-ix-icon"><Folder size={16} aria-hidden /></div>
          <div>
            <div className="nl-ix-title">Projects</div>
            <div className="nl-ix-sub">{total} project{total === 1 ? '' : 's'} · {threadTotal} thread{threadTotal === 1 ? '' : 's'}</div>
          </div>
        </div>
        <button type="button" className="nl-ix-new" onClick={() => { void newProject(); }}><Plus size={15} aria-hidden /><span>New project</span></button>
      </div>
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
      </div>

      <div className="nl-bento" data-testid="project-grid">
        {cards.map((p, i) => <ProjectBentoCard key={p.id} project={p} index={i} view={view} />)}
        <button type="button" id="pv-grid-new" className="nl-bento-add" onClick={() => { void newProject(); }}>
          <Plus size={18} aria-hidden /><span>New project</span>
        </button>
      </div>
    </div>
  );
}

/** One project as a bento card: tint and shape come from its icon and id, as on the Notes home. */
function ProjectBentoCard({ project: p, index, view }: { project: PersistedProject; index: number; view: PersistedState; }) {
  const n = chatCount(view, p.id);
  const emoji = (p as { emoji?: string }).emoji;
  const fallback = cycleIcon(PROJECT_ICON_CYCLE, index).id;
  const shape = shapeFor(p.id, index);
  const tint = tintFor(emoji || fallback);
  // The subtitle is the project's most recently touched chat, so the card says what is in it.
  const latest = Object.values(view.threads)
    .filter(t => t.projectId === p.id && t.title)
    .sort((a, b) => threadTouchedAt(b) - threadTouchedAt(a))[0];
  const name = p.name || 'Untitled project';
  return (
    <button
      type="button" data-pid={p.id} data-shape={shape || 'normal'} onClick={() => { void openProjectPanel(p.id); }}
      className={`nl-bento-item${shape ? ` ${shape}` : ''}`}
      style={{ ['--tbg' as string]: `var(--bento-${tint}-bg)`, ['--tfg' as string]: `var(--bento-${tint}-fg)` }}
    >
      <Bloom id={p.id} icon={emoji} shape={shape} fallbackId={fallback} />
      <div className="nl-ix-name">{name}</div>
      {latest?.title && <div className="relative z-[1] mt-1.5 line-clamp-2 text-sm text-text-3">{latest.title}</div>}
      <div className="nl-ix-meta">{n} thread{n === 1 ? '' : 's'} · Updated {timeAgoShort(p.updatedAt)}</div>
    </button>
  );
}
