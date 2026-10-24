import { Frame, Plus } from 'lucide-react';
import { useUiStore } from '../../state/ui-store';
import { openCanvas } from '../../canvas/open-canvas';
import { useCanvasStore } from '../../canvas/canvas-store';
import { shortTime } from '../project-summary';
import type { CanvasSummary } from '../../canvas/types';
import { EmptyBody, SectionCard } from './SectionCard';

/** The Canvases section of the project overview: a count, the most recent few, New and View all. */
export function CanvasesCard({ pid, canvases, error }: { pid: string; canvases: readonly CanvasSummary[]; error?: string }) {
  const setView = useUiStore(s => s.setProjectView);
  const create = useCanvasStore(s => s.create);
  const empty = canvases.length === 0;

  const newCanvas = async (): Promise<void> => {
    const made = await create(pid);
    if (made) openCanvas(made.id);
  };

  return (
    <SectionCard
      accent="canvas" icon={<Frame size={16} aria-hidden />} label="Canvases" count={canvases.length}
      empty={empty} span="col-span-3" testId="card-canvases" onHeader={() => setView('canvas')}
      action={(
        <button
          type="button" aria-label="New canvas" title="New canvas" data-testid="canvas-new-card"
          onClick={() => { void newCanvas(); }}
          className="grid h-[22px] w-[22px] place-items-center rounded-md text-text-3 hover:bg-bg-3 hover:text-text"
        >
          <Plus size={13} />
        </button>
      )}
    >
      {error ? (
        <div role="alert" className="rounded-lg border border-danger-border bg-danger-soft p-2.5 text-xs text-danger">Could not load canvases: {error}</div>
      ) : empty ? (
        <EmptyBody
          accent="canvas" icon={<Frame size={24} aria-hidden />} title="No canvases yet"
          hint="A canvas is a space to think in: ask, branch from any part of an answer, and bring the useful paths back together."
        >
          <button type="button" data-testid="canvas-new-empty" onClick={() => { void newCanvas(); }} className="h-[30px] rounded-[9px] border border-text bg-text px-3 text-xs text-bg">New canvas</button>
        </EmptyBody>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {canvases.slice(0, 3).map(c => (
            <li key={c.id}>
              <button
                type="button" data-canvas={c.id} onClick={() => openCanvas(c.id)}
                className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm text-text-2 hover:bg-bg-2 hover:text-text"
              >
                <Frame size={13} aria-hidden className="flex-none text-sec-canvas" />
                <span className="min-w-0 flex-1 truncate">{c.title}</span>
                <span className="flex-none font-mono text-xs text-text-3">{shortTime(c.updatedAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
