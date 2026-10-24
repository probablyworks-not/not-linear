import { useState } from 'react';
import { Copy, Frame, Pencil, Trash2 } from 'lucide-react';
import { useUiStore } from '../../state/ui-store';
import { openCanvas } from '../../canvas/open-canvas';
import { useCanvasStore } from '../../canvas/canvas-store';
import type { CanvasSummary } from '../../canvas/types';
import { shortTime } from '../project-summary';
import { confirmDeleteCanvas } from '../../ui/confirm-copy';
import { EmptyBody } from '../cards/SectionCard';
import { headerPrimary, ViewHeader } from './ViewHeader';

/** The Canvases drill-in: search, create, rename, duplicate, delete, reopen. */
export function CanvasesView({ pid, projectName, canvases }: { pid: string; projectName: string; canvases: readonly CanvasSummary[] }) {
  const [q, setQ] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const create = useCanvasStore(s => s.create);
  const rename = useCanvasStore(s => s.rename);
  const duplicate = useCanvasStore(s => s.duplicate);
  const remove = useCanvasStore(s => s.remove);
  const unassigned = useCanvasStore(s => s.unassigned);
  const askConfirm = useUiStore(s => s.askConfirm);

  // Search is a filter over what is already loaded, so it resets when the view is reopened.
  const needle = q.trim().toLowerCase();
  const shown = needle ? canvases.filter(c => c.title.toLowerCase().includes(needle)) : canvases;

  const newCanvas = async (): Promise<void> => {
    const made = await create(pid);
    if (made) openCanvas(made.id);
  };

  const confirmDelete = async (c: CanvasSummary): Promise<void> => {
    const ok = await askConfirm(confirmDeleteCanvas(c.title));
    if (ok) await remove(pid, c.id);
  };

  const commitRename = async (c: CanvasSummary): Promise<void> => {
    const next = draft.trim();
    setRenaming(null);
    if (next && next !== c.title) await rename(pid, c.id, next);
  };

  return (
    <div data-testid="canvases-view">
      <ViewHeader
        projectName={projectName} icon={<Frame size={22} aria-hidden className="text-sec-canvas" />}
        title="Canvases" count={canvases.length}
        subtitle="Spaces to think in: ask, branch from any part of an answer, and bring the useful paths back together"
        actions={<button type="button" data-testid="canvas-new" className={headerPrimary} onClick={() => { void newCanvas(); }}>New canvas</button>}
      />

      {canvases.length > 0 && (
        <input
          type="search" value={q} onChange={e => setQ(e.target.value)}
          aria-label="Search canvases" placeholder="Search canvases"
          className="mb-4 h-[34px] w-full max-w-[320px] rounded-[10px] border border-rule bg-surface px-3 text-sm text-text placeholder:text-text-3"
        />
      )}

      {canvases.length === 0 ? (
        <div className="rounded-[14px] border border-dashed border-rule-2 px-6 py-10">
          <EmptyBody
            accent="canvas" icon={<Frame size={24} aria-hidden />} title="No canvases yet"
            hint="A canvas keeps a question and everything it branched into in one place, so you can come back to it."
          >
            <button type="button" className="h-[30px] rounded-[9px] border border-text bg-text px-3 text-xs text-bg" onClick={() => { void newCanvas(); }}>New canvas</button>
          </EmptyBody>
        </div>
      ) : shown.length === 0 ? (
        <div className="rounded-[14px] border border-dashed border-rule-2 px-6 py-8 text-center text-sm text-text-3">
          No canvas matches “{q.trim()}”.
        </div>
      ) : (
        <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map(c => (
            <li key={c.id} data-canvas={c.id} className="group rounded-[14px] border border-rule bg-surface p-3.5 hover:border-rule-2">
              {renaming === c.id ? (
                <input
                  autoFocus value={draft} aria-label="Canvas name"
                  onChange={e => setDraft(e.target.value)}
                  onBlur={() => { void commitRename(c); }}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { void commitRename(c); }
                    if (e.key === 'Escape') { e.stopPropagation(); setRenaming(null); }
                  }}
                  className="mb-1.5 w-full rounded-md border border-rule-2 bg-bg-2 px-2 py-1 text-base text-text"
                />
              ) : (
                <button
                  type="button" data-testid="canvas-open" onClick={() => openCanvas(c.id)}
                  className="mb-1.5 block w-full truncate text-left text-base font-medium text-text hover:underline"
                >
                  {c.title}
                </button>
              )}
              <div className="flex items-center gap-2 text-xs text-text-3">
                <span className="font-mono">{c.counts.threads} thread{c.counts.threads === 1 ? '' : 's'}</span>
                <span aria-hidden>·</span>
                <span className="font-mono">{shortTime(c.updatedAt)}</span>
                <span className="flex-1" />
                <span className="flex gap-0.5 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover:opacity-100">
                  <IconBtn label={`Rename ${c.title}`} onClick={() => { setRenaming(c.id); setDraft(c.title); }}><Pencil size={13} /></IconBtn>
                  <IconBtn label={`Duplicate ${c.title}`} onClick={() => { void duplicate(pid, c.id); }}><Copy size={13} /></IconBtn>
                  <IconBtn label={`Delete ${c.title}`} onClick={() => { void confirmDelete(c); }}><Trash2 size={13} /></IconBtn>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {unassigned.length > 0 && (
        <section className="mt-8" data-testid="canvases-unassigned">
          <h3 className="m-0 mb-1 font-mono text-xs uppercase tracking-widest text-text-3">From deleted projects</h3>
          <p className="mb-2.5 text-xs text-text-3">
            Deleting a project keeps its canvases. They stay here until you move or delete them.
          </p>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {unassigned.map(c => (
              <li key={c.id}>
                <button
                  type="button" data-canvas={c.id} onClick={() => openCanvas(c.id)}
                  className="flex w-full items-center gap-2 rounded-md border border-dashed border-rule-2 px-2.5 py-1.5 text-left text-sm text-text-2 hover:text-text"
                >
                  <Frame size={13} aria-hidden className="flex-none text-text-3" />
                  <span className="min-w-0 flex-1 truncate">{c.title}</span>
                  <span className="flex-none font-mono text-xs text-text-3">{shortTime(c.updatedAt)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function IconBtn({ label, onClick, children }: { label: string; onClick(): void; children: React.ReactNode }) {
  return (
    <button
      type="button" aria-label={label} title={label} onClick={onClick}
      className="grid h-6 w-6 place-items-center rounded-[5px] text-text-3 hover:bg-bg-3 hover:text-text"
    >
      {children}
    </button>
  );
}
