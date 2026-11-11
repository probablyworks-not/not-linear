import { useState } from 'react';
import { Folder, LayoutGrid, MoreHorizontal, Plus } from 'lucide-react';
import { useAppStore } from '../state/app-store';
import { useUiStore } from '../state/ui-store';
import { newProject, openProjectPanel, setProjectGlyph } from '../state/actions';
import { GlyphButton } from '../ui/GlyphButton';
import { PROJECT_ICON_CYCLE } from '../lib/mind-garden';
import { projectList } from '../db/project-ops';
import { SidebarSection } from '../shell/SidebarSection';
import { ShowMoreButton } from '../shell/ShowMoreButton';
import { SIDEBAR_VISIBLE, byRecency, threadTouchedAt } from '../shell/recency';

/** Sidebar "Projects": the list, a way to the full grid, and a way to make one (index.html:105). */
export function ProjectsSidebarSection() {
  const projects = useAppStore(s => s.projects);
  const setProjectsViewOpen = useUiStore(s => s.setProjectsViewOpen);
  const threadState = useAppStore(s => s.threadState);
  const [showAll, setShowAll] = useState(false);
  // A project is as recent as its own edits or its most recently active chat.
  const touched = new Map<string, number>();
  for (const t of Object.values(threadState)) {
    if (t?.projectId) touched.set(t.projectId, Math.max(touched.get(t.projectId) ?? 0, threadTouchedAt(t)));
  }
  const list = byRecency(projectList({ projects }), p => Math.max(p.updatedAt || 0, touched.get(p.id) ?? 0));
  const shown = showAll ? list : list.slice(0, SIDEBAR_VISIBLE);
  const iconBtn = 'grid h-[18px] w-[18px] place-items-center rounded text-text-3 hover:bg-bg-3 hover:text-text';

  return (
    <SidebarSection
      section="projects" label="Projects"
      actions={(
        <>
          <button type="button" title="View all projects" aria-label="View all projects" className={iconBtn} onClick={() => setProjectsViewOpen(true)}>
            <LayoutGrid size={13} />
          </button>
          <button type="button" title="New project" aria-label="New project" className={iconBtn} onClick={() => { void newProject(); }}>
            <Plus size={13} />
          </button>
        </>
      )}
    >
      <div role="list" aria-label="Projects">
        {shown.map((p, idx) => (
          <div key={p.id} role="listitem" data-project={p.id} className="group relative flex w-full items-center rounded-md p-0 text-sm leading-tight text-text-2 hover:bg-bg-2 hover:text-text">
            <GlyphButton
              value={(p as { emoji?: string }).emoji} cycle={PROJECT_ICON_CYCLE} index={idx} size={22} fallback={<Folder size={15} aria-hidden />}
              onPick={token => { void setProjectGlyph(p.id, token); }}
              className="ml-2 grid h-[22px] w-[22px] flex-none cursor-pointer place-items-center rounded-md hover:bg-bg-3"
            />
            <button type="button" onClick={() => { void openProjectPanel(p.id); }} className="flex min-w-0 flex-1 items-center gap-[9px] py-1.5 pl-1 pr-2 text-left">
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
      {list.length > SIDEBAR_VISIBLE && (
        <ShowMoreButton expanded={showAll} hidden={list.length - SIDEBAR_VISIBLE} onToggle={() => setShowAll(v => !v)} />
      )}
    </SidebarSection>
  );
}
