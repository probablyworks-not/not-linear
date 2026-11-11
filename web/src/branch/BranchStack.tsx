import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpCircle, Copy, Trash2, X } from 'lucide-react';
import { useAppStore } from '../state/app-store';
import { toast } from '../ui/toast';
import { useBranchStore, type OpenBranch } from './branch-store';
import { BranchPanel, type PanelFlags } from './BranchPanel';
import { closeBranch, deleteBranch, promoteBranch } from './actions';
import { layoutPanels, branchRail, stacking, type PanelMeasure } from './layout';
import { ESC_PRIORITY, useEscLayer } from '../lib/keyboard';

const esc = (id: string): string => (typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(id) : id.replace(/["\\]/g, '\\$&'));

/** The first anchor for this branch anywhere on the page (legacy's `$('.branched[data-bid=…]')`). */
function anchorFor(anchorBid: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`.branched[data-bid="${esc(anchorBid)}"]`);
}

interface MenuState { id: string; right: number; bottom: number }

/**
 * The floating column of open branch panels on the right (app.js:3174). It owns layout: each
 * panel wants to sit level with its anchor in the text, panels are pushed apart so they never
 * overlap, a child stacks onto its parent, and one whose anchor has scrolled away fades out.
 * The rules are in branch/layout.ts as pure functions; this component measures the page, asks
 * them where things go, and applies the answer. Below 1100px the whole stack is hidden by CSS,
 * exactly as legacy hides it.
 */
export function BranchStack({ threadId, fallbackTitle }: { threadId: string; fallbackTitle: string }) {
  const open = useBranchStore(s => s.open);
  const order = useBranchStore(s => s.order);
  const activeId = useBranchStore(s => s.activeId);
  const els = useRef(new Map<string, HTMLElement>());
  const raf = useRef(0);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [placed, setPlaced] = useState<{ sourceOut: Set<string>; readerEclipsed: Set<string> }>({ sourceOut: new Set(), readerEclipsed: new Set() });

  const panels = useMemo(() => order.map(id => open[id]).filter((b): b is OpenBranch => !!b && b.threadId === threadId), [order, open, threadId]);
  const stack = useMemo(() => stacking(panels, activeId), [panels, activeId]);

  // Reader mode is a focus state: a panel that is not the active one leaves it.
  useEffect(() => {
    stack.clearReader.forEach(id => useBranchStore.getState().patch(id, { reader: false }));
  }, [stack]);

  const registerEl = useCallback((id: string, el: HTMLElement | null) => {
    if (el) els.current.set(id, el);
    else els.current.delete(id);
  }, []);

  const runLayout = useCallback(() => {
    const current = Object.values(useBranchStore.getState().open).filter(b => b.threadId === threadId);
    if (!current.length) return;
    const rail = branchRail(document.querySelector('[data-topbar]')?.getBoundingClientRect().bottom, window.innerHeight);
    const measures: PanelMeasure[] = current.map(b => {
      const anchor = anchorFor(b.anchorBid);
      const r = anchor?.getBoundingClientRect();
      return {
        id: b.id, parentBid: b.parentBid, reader: b.reader, collapsed: b.collapsed, userSized: b.userSized, top: b.top,
        height: els.current.get(b.id)?.offsetHeight ?? 0,
        anchor: r ? { top: r.top, height: r.height } : null,
        docY: r ? r.top + window.scrollY + r.height / 2 : Number.MAX_SAFE_INTEGER,
      };
    });
    const layout = layoutPanels(measures, rail, useBranchStore.getState().activeId);
    for (const [id, top] of Object.entries(layout.tops)) {
      const el = els.current.get(id);
      if (el) el.style.top = `${top}px`;
      const b = useBranchStore.getState().open[id];
      if (b && layout.remember.has(id) && Math.abs((b.top ?? -1) - top) >= 1) useBranchStore.getState().patch(id, { top });
    }
    setPlaced(prev => {
      const same = (a: Set<string>, c: Set<string>): boolean => a.size === c.size && [...a].every(x => c.has(x));
      return same(prev.sourceOut, layout.sourceOut) && same(prev.readerEclipsed, layout.readerEclipsed)
        ? prev : { sourceOut: layout.sourceOut, readerEclipsed: layout.readerEclipsed };
    });
  }, [threadId]);

  const scheduleLayout = useCallback(() => {
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => { raf.current = 0; runLayout(); });
  }, [runLayout]);

  // Layout after every change to the set of panels, their geometry, or focus.
  useLayoutEffect(() => { runLayout(); }, [runLayout, panels, activeId]);

  // Page scroll, window resize and panels changing size all move where things should sit.
  useEffect(() => {
    window.addEventListener('resize', scheduleLayout);
    window.addEventListener('scroll', scheduleLayout, { passive: true });
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scheduleLayout);
    els.current.forEach(el => ro?.observe(el));
    return () => {
      window.removeEventListener('resize', scheduleLayout);
      window.removeEventListener('scroll', scheduleLayout);
      ro?.disconnect();
      if (raf.current) { cancelAnimationFrame(raf.current); raf.current = 0; }
    };
  }, [scheduleLayout, panels.length]);

  // A resized panel sets the drawer width for the page (legacy writes --drawer-w in setBranchSize).
  const widths = panels.map(b => b.width ?? 0).join(',');
  useEffect(() => {
    const last = [...panels].reverse().find(b => b.width);
    if (last?.width) document.documentElement.style.setProperty('--drawer-w', `${Math.round(last.width)}px`);
  }, [widths]); // eslint-disable-line react-hooks/exhaustive-deps

  const onMenu = useCallback((anchor: HTMLElement, id: string) => {
    const r = anchor.getBoundingClientRect();
    setMenu({ id, right: r.right, bottom: r.bottom });
  }, []);

  const flagsFor = (b: OpenBranch): PanelFlags => ({
    behindActive: stack.behindActive.has(b.id),
    sourceOut: placed.sourceOut.has(b.id),
    readerEclipsed: placed.readerEclipsed.has(b.id),
    zIndex: stack.zIndex[b.id] ?? 1,
  });

  return (
    <>
      <div className={`branch-stack${panels.length ? ' has-active' : ''}`} data-testid="branch-stack">
        {panels.map(b => (
          <BranchPanel key={b.id} branch={b} flags={flagsFor(b)} registerEl={registerEl} onLayout={scheduleLayout} onMenu={onMenu} />
        ))}
      </div>
      {menu && <BranchMenu menu={menu} fallbackTitle={fallbackTitle} onClose={() => setMenu(null)} />}
    </>
  );
}

function BranchMenu({ menu, fallbackTitle, onClose }: { menu: MenuState; fallbackTitle: string; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const b = useBranchStore(s => s.open[menu.id]);
  const threadId = b?.threadId ?? useAppStore.getState().currentThreadId;

  // Right-aligned under the button that opened it; its own width is only known after layout.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.left = `${Math.max(8, menu.right - el.offsetWidth)}px`;
    el.style.top = `${menu.bottom + 6}px`;
  }, [menu]);

  useEffect(() => {
    const down = (e: MouseEvent): void => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    document.addEventListener('mousedown', down);
    return () => document.removeEventListener('mousedown', down);
  }, [onClose]);
  useEscLayer('branchMenu', ESC_PRIORITY.branchMenu, true, onClose);

  if (!b) return null;
  const item = 'flex w-full items-center gap-2 rounded-sm px-2.5 py-1.5 text-left text-sm text-text hover:bg-bg-3';
  const icon = 'w-4 text-text-2';
  const run = (fn: () => void): void => { onClose(); fn(); };
  return (
    <div ref={ref} role="menu" aria-label="Branch actions" data-testid="branch-menu" className="fixed z-[220] min-w-[200px] rounded-lg border border-rule-2 bg-surface-2 p-1 shadow-lg">
      <button type="button" role="menuitem" className={item} onClick={() => run(() => { void promoteBranch(b.id, fallbackTitle); })}>
        <ArrowUpCircle size={14} className={icon} />
        <span>Make this the main thread<span className="block text-xs text-text-3">Replace the doc with this conversation</span></span>
      </button>
      <button type="button" role="menuitem" className={item} onClick={() => run(() => { void navigator.clipboard?.writeText(b.quote).catch(() => {}); toast('Copied source quote'); })}>
        <Copy size={14} className={icon} /><span>Copy as quote</span>
      </button>
      <div className="my-[3px] h-px bg-rule" />
      <button type="button" role="menuitem" className={item} onClick={() => run(() => { void closeBranch(b.id); })}>
        <X size={14} className={icon} /><span>Close branch</span>
      </button>
      <button type="button" role="menuitem" className={`${item} text-danger`} onClick={() => run(() => { void deleteBranch(b.id, threadId); })}>
        <Trash2 size={14} className="w-4" />
        <span>Delete branch<span className="block text-xs text-text-3">Remove it from this chat</span></span>
      </button>
    </div>
  );
}
