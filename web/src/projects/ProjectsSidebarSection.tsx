import { Folder, LayoutGrid, MoreHorizontal, Plus } from 'lucide-react';
import { useAppStore } from '../state/app-store';
import { useUiStore } from '../state/ui-store';
import { newProject, openProjectPanel } from '../state/actions';
import { projectList } from '../db/project-ops';

/** Sidebar "Projects": the list, a way to the full grid, and a way to make one (index.html:105). */
export function ProjectsSidebarSection() {
  const projects = useAppStore(s => s.projects);
  const setProjectsViewOpen = useUiStore(s => s.setProjectsViewOpen);
  const list = projectList({ projects });
  const iconBtn = 'grid h-[18px] w-[18px] place-items-center rounded text-text-3 hover:bg-bg-3 hover:text-text';

  return (
    <>
      <div className="mx-2 mb-1 mt-3.5 flex items-center justify-between font-mono text-xs uppercase tracking-widest text-text-3">
        <span>Projects</span>
        <span className="flex gap-0.5">
          <button type="button" title="View all projects" aria-label="View all projects" className={iconBtn} onClick={() => setProjectsViewOpen(true)}>
            <LayoutGrid size={13} />
          </button>
          <button type="button" title="New project" aria-label="New project" className={iconBtn} onClick={() => { void newProject(); }}>
            <Plus size={13} />
          </button>
        </span>
      </div>
      <div role="list" aria-label="Projects">
        {list.map(p => (
          <div key={p.id} role="listitem" data-project={p.id} className="group relative flex w-full items-center rounded-md p-0 text-sm leading-tight text-text-2 hover:bg-bg-2 hover:text-text">
            <button type="button" onClick={() => { void openProjectPanel(p.id); }} className="flex min-w-0 flex-1 items-center gap-[9px] px-2 py-1.5 text-left">
              <Folder size={15} aria-hidden className="flex-none" />
              <span className="truncate">{p.name || 'Untitled project'}</span>
            </button>
            <button
              type="button" title="Project settings" aria-label={`Settings for ${p.name || 'Untitled project'}`}
              onClick={() => { void openProjectPanel(p.id); }}
              className="mr-1 grid h-6 w-6 flex-none place-items-center rounded-[5px] text-text-3 opacity-0 hover:bg-bg-3 hover:text-text focus-visible:opacity-100 group-hover:opacity-100"
            >
              <MoreHorizontal size={14} />
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
