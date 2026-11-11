import { useEffect } from 'react';
import { Frame, Plus } from 'lucide-react';
import { useCanvasStore } from '../canvas-store';
import { openCanvas } from '../open-canvas';
import { Glyph } from '../../ui/Glyph';
import { CANVAS_ICON_CYCLE } from '../../lib/mind-garden';
import { useUiStore } from '../../state/ui-store';
import { SidebarSection } from '../../shell/SidebarSection';
import { shortTime } from '../../projects/project-summary';

const VISIBLE = 5;
const ICON_BTN = 'grid h-[18px] w-[18px] place-items-center rounded text-text-3 hover:bg-bg-3 hover:text-text';

/**
 * C12. The sidebar's "Canvases" section — the most recently touched canvases across every
 * project, same "quick nav" role `RecentBranches` plays for branches. Unlike the Threads/Notes
 * sections, this does not exclude canvases filed in a project: a canvas has no "no project" home
 * the way a chat does (every canvas belongs to some project, or is in the Unassigned recovery
 * listing), so excluding project-filed ones would leave this almost always empty.
 */
export function CanvasesSidebarSection() {
  const all = useCanvasStore(s => s.all);
  const loadAll = useCanvasStore(s => s.loadAll);
  const create = useCanvasStore(s => s.create);
  const activeTabId = useUiStore(s => s.activeTabId);
  const activeProjectId = useUiStore(s => s.activeProjectId);

  useEffect(() => { void loadAll(); }, [loadAll]);

  const shown = all.slice(0, VISIBLE);

  // Files the new canvas under whatever project is currently open, or Unassigned if none is.
  const newCanvas = async (): Promise<void> => {
    const made = await create(activeProjectId);
    if (made) openCanvas(made.id);
  };

  return (
    <SidebarSection
      section="canvases" label="Canvases"
      actions={(
        <button type="button" title="New canvas" aria-label="New canvas" className={ICON_BTN} onClick={() => { void newCanvas(); }}>
          <Plus size={13} />
        </button>
      )}
    >
      <div role="list" data-testid="canvases-sidebar-list">
        {shown.length === 0 && <div className="px-2 py-1.5 text-sm leading-snug text-text-3">No canvases yet</div>}
        {shown.map((c, i) => {
          const active = activeTabId === `canvas:${c.id}`;
          return (
            <button
              key={c.id} type="button" data-canvas={c.id} onClick={() => openCanvas(c.id)}
              aria-current={active ? 'page' : undefined}
              className={`flex w-full items-center gap-[9px] rounded-md px-2 py-1.5 text-left text-sm leading-tight text-text-2 hover:bg-bg-2 hover:text-text ${active ? 'bg-bg-2 text-text' : ''}`}
            >
              <Glyph value={c.emoji} cycle={CANVAS_ICON_CYCLE} index={i} size={16} fallback={<Frame size={15} aria-hidden />} />
              <span className="min-w-0 flex-1 truncate">{c.title}</span>
              <span className="flex-none font-mono text-xs text-text-3">{shortTime(c.updatedAt)}</span>
            </button>
          );
        })}
      </div>
    </SidebarSection>
  );
}
