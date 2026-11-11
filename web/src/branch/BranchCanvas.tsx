import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, GitBranch, X } from 'lucide-react';
import { clsx } from 'clsx';
import { useAppStore } from '../state/app-store';
import { useUiStore } from '../state/ui-store';
import { useBranchStore } from './branch-store';
import { branchRowsForThread } from '../chat/branch-model';
import { resolveThreadTitle } from '../db/thread-ops';
import { titleFromQuote } from './actions';
import { openBranchRow } from './open-from';
import { CANVAS_NODE_H, CANVAS_NODE_W, canvasLayout, edgePath } from './canvas-layout';
import { ESC_PRIORITY, useEscLayer } from '../lib/keyboard';

const truncate = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1).trim() + '…' : s);
const INITIAL_VIEW = { x: 60, y: 40, z: 1 };
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 2;
const ZOOM_STEP = 1.2;
const FIT_PADDING = 40;
const clampZoom = (z: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/**
 * The spatial branch canvas (app.js:2823): every branch the chat has ever had, as a tree you
 * can pan. Read-only (ADR-019): it writes nothing, and a node click closes the canvas and
 * opens that branch the way the sidebar does. The nodes come from the same merged rows as
 * Recent branches, not from the panels that happen to be open, or branches that were closed
 * would vanish from the picture (the "connectors missing" regression).
 */
export function BranchCanvas({ threadId }: { threadId: string }) {
  const open = useUiStore(s => s.canvasOpen);
  const setOpen = useUiStore(s => s.setCanvasOpen);
  const thread = useAppStore(s => s.threadState[threadId]);
  const openPanels = useBranchStore(s => s.open);
  const [view, setView] = useState(INITIAL_VIEW);
  const viewport = useRef<HTMLDivElement>(null);
  const [grabbing, setGrabbing] = useState(false);
  const drag = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null);

  // Closing puts the view back at the origin, so each opening starts there (no effect needed).
  const close = useCallback(() => { setView(INITIAL_VIEW); setOpen(false); }, [setOpen]);
  useEscLayer('branchCanvas', ESC_PRIORITY.branchCanvas, open, close);

  const rows = useMemo(
    () => branchRowsForThread(thread, Object.values(openPanels).filter(b => b.threadId === threadId)),
    [thread, openPanels, threadId],
  );
  const layout = useMemo(() => canvasLayout(rows), [rows]);

  // Zoom keeps the point at the middle of the viewport fixed, so it grows and shrinks around what you are looking at.
  const zoomBy = useCallback((factor: number): void => {
    const el = viewport.current;
    const cx = (el?.clientWidth ?? 0) / 2;
    const cy = (el?.clientHeight ?? 0) / 2;
    setView(v => {
      const z = clampZoom(v.z * factor);
      return { x: cx - (cx - v.x) * (z / v.z), y: cy - (cy - v.y) * (z / v.z), z };
    });
  }, []);

  const fit = useCallback((): void => {
    const el = viewport.current;
    if (!el) return;
    const z = clampZoom(Math.min(1, (el.clientWidth - FIT_PADDING * 2) / layout.width, (el.clientHeight - FIT_PADDING * 2) / layout.height));
    setView({ x: (el.clientWidth - layout.width * z) / 2, y: (el.clientHeight - layout.height * z) / 2, z });
  }, [layout.width, layout.height]);

  // ⌘+ / ⌘− / ⌘0 while the canvas is up. They are claimed here so the browser's page zoom does not also fire.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      if (e.key === '=' || e.key === '+') { e.preventDefault(); zoomBy(ZOOM_STEP); }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomBy(1 / ZOOM_STEP); }
      else if (e.key === '0') { e.preventDefault(); fit(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, zoomBy, fit]);

  // Dragging the background pans; a drag that ends outside the viewport must still end.
  useEffect(() => {
    const move = (e: MouseEvent): void => {
      const d = drag.current;
      if (d) setView(v => ({ ...v, x: d.px + e.clientX - d.sx, y: d.py + e.clientY - d.sy }));
    };
    const up = (): void => { drag.current = null; setGrabbing(false); };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, []);

  if (!open) return null;
  const count = rows.length;
  const nodeTitle = (id: string): string => (id === 'doc' ? resolveThreadTitle(thread, 'Main thread') : titleFromQuote(layout.byId[id]!.quote));

  return (
    <div className="fixed inset-0 z-[500] flex flex-col bg-bg" role="dialog" aria-label="Branches" data-testid="branch-canvas">
      <div className="flex flex-none items-center gap-3 border-b border-rule px-[18px] py-3">
        <button type="button" title="Back" aria-label="Back" onClick={close} className="grid h-8 w-8 place-items-center rounded-lg text-text-2 hover:bg-bg-2 hover:text-text">
          <ArrowLeft size={16} />
        </button>
        <div className="h-5 w-px bg-rule" />
        <div className="flex items-center gap-2 text-base font-semibold text-text">
          <span className="grid h-[26px] w-[26px] place-items-center rounded-lg bg-bg-3 text-text-2"><GitBranch size={14} /></span>
          <span>Branches</span>
          <span className="rounded-full bg-bg-2 px-2 py-0.5 font-mono text-xs font-medium text-text-3" data-testid="canvas-count">{count} branch{count === 1 ? '' : 'es'}</span>
        </div>
        <div className="flex-1" />
        <button type="button" title="Close" aria-label="Close" onClick={close} className="grid h-8 w-8 place-items-center rounded-lg text-text-2 hover:bg-bg-2 hover:text-text">
          <X size={16} />
        </button>
      </div>
      <div
        ref={viewport}
        className={clsx('relative flex-1 overflow-hidden bg-[radial-gradient(var(--rule-2)_1px,transparent_1px)] bg-[length:26px_26px] bg-[position:-4px_-4px]', grabbing ? 'cursor-grabbing' : 'cursor-grab')}
        onMouseDown={e => {
          if ((e.target as HTMLElement).closest('[data-bc-id]')) return;
          drag.current = { sx: e.clientX, sy: e.clientY, px: view.x, py: view.y };
          setGrabbing(true);
        }}
      >
        <div className="absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }} data-testid="canvas-plane">
          <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={layout.width} height={layout.height} aria-hidden="true">
            {rows.map(r => {
              const pkey = r.parentBid && layout.byId[r.parentBid] ? r.parentBid : 'doc';
              const from = layout.positions[pkey];
              const to = layout.positions[r.id];
              return from && to ? <path key={r.id} d={edgePath(from, to)} stroke="var(--rule-2)" strokeWidth={1.4} fill="none" strokeLinecap="round" /> : null;
            })}
          </svg>
          {['doc', ...rows.map(r => r.id)].map(id => {
            const pos = layout.positions[id];
            if (!pos) return null;
            const isDoc = id === 'doc';
            const live = isDoc ? null : openPanels[id];
            const snap = isDoc ? null : thread?.branchSnapshots?.[id];
            // Legacy shows the latest answer only for a branch that is open; closed ones show their quote.
            const last = live ? [...((snap?.messages ?? []) as Array<{ role: string; content: unknown }>)].reverse().find(m => m.role === 'assistant') : null;
            const raw = isDoc ? 'Main document' : (typeof last?.content === 'string' && last.content ? last.content : layout.byId[id]!.quote);
            const kind = isDoc ? 'Main thread' : pos.depth >= 2 ? 'Sub-branch' : 'Branch';
            return (
              <div
                key={id} data-bc-id={id} role="button" tabIndex={0} aria-label={`${kind}: ${nodeTitle(id)}`}
                onClick={() => { close(); if (!isDoc) openBranchRow(threadId, layout.byId[id]!); }}
                onKeyDown={e => { if (e.key === 'Enter') { close(); if (!isDoc) openBranchRow(threadId, layout.byId[id]!); } }}
                className={clsx('absolute cursor-pointer rounded-[14px] border border-rule-2 p-3.5 shadow-md transition-[border-color,box-shadow] hover:border-text-3', isDoc ? 'bg-bg-2' : 'bg-surface')}
                style={{ left: pos.x, top: pos.y, width: CANVAS_NODE_W, minHeight: CANVAS_NODE_H }}
              >
                <div className="mb-2 flex items-center gap-2">
                  <span className={clsx('grid h-[26px] w-[26px] flex-none place-items-center rounded-[7px] font-mono text-xs font-bold', isDoc ? 'bg-bg-3 text-text-2' : 'bg-branch-soft text-branch')}>{isDoc ? '■' : '┣'}</span>
                  <div className="line-clamp-2 flex-1 text-sm font-semibold leading-snug text-text">{nodeTitle(id)}</div>
                </div>
                <div className="line-clamp-2 text-xs leading-normal text-text-3">{truncate(raw.replace(/\s+/g, ' ').trim(), 110)}</div>
                <div className={clsx('mt-2 inline-block rounded-full px-2 py-0.5 font-mono text-xs uppercase tracking-wide', isDoc ? 'bg-bg-3 text-text-3' : 'bg-branch-soft text-branch')}>{kind}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
