import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Bell, Check, CircleAlert, X } from 'lucide-react';
import { Glyph } from '../../ui/Glyph';
import { timeAgoShort } from '../../lib/time-ago';
import { useCanvasNotifications, type CanvasNotification } from '../notifications';

export function CanvasNotifications({ canvasId, onOpen }: { canvasId: string; onOpen(id: string): void }) {
  const items = useCanvasNotifications(s => s.items);
  const markRead = useCanvasNotifications(s => s.markRead);
  const markAllRead = useCanvasNotifications(s => s.markAllRead);
  const [open, setOpen] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [brief, setBrief] = useState<CanvasNotification | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const bell = useRef<HTMLButtonElement>(null);
  const seen = useRef(new Set(items.map(n => n.id)));
  const scoped = items.filter(n => n.canvasId === canvasId);
  const unread = scoped.filter(n => !n.read).length;
  useEffect(() => {
    const fresh = items.find(n => n.canvasId === canvasId && !seen.current.has(n.id));
    items.forEach(n => seen.current.add(n.id));
    if (!fresh) return;
    setBrief(fresh);
    const timer = setTimeout(() => setBrief(null), 6500);
    return () => clearTimeout(timer);
  }, [items, canvasId]);
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLButtonElement>('.cv-notice-close')?.focus();
    const outside = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  const visit = (n: CanvasNotification) => { markRead(n.id); setOpen(false); setBrief(null); onOpen(n.threadId); };
  const icon = (n: CanvasNotification) => <span className={`cv-notice-icon ${n.kind}`} aria-hidden="true"><Glyph
    value={`icon:${n.kind === 'completed' ? 'branch' : 'compass'}`} cycle={[]} index={0} size={24}
    fallback={n.kind === 'completed' ? <Check size={20} /> : <CircleAlert size={20} />} /></span>;
  return <div ref={root} className="cv-notifications" onKeyDown={e => {
    if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); setBrief(null); bell.current?.focus(); }
  }}>
    <button ref={bell} type="button" className="cv-notice-bell" aria-label={`Notifications, ${unread} unread`}
      aria-expanded={open} aria-controls="canvas-notifications" onClick={() => { setOpen(v => !v); setBrief(null); }}>
      <Bell size={16} aria-hidden="true" />{unread > 0 && <span className="cv-notice-count">{unread > 9 ? '9+' : unread}</span>}
    </button>
    {open && <section id="canvas-notifications" className="cv-notice-panel" role="region" aria-label="Canvas notifications">
      <div className="cv-notice-heading"><div><h2>Notifications</h2><p>A little signal from your canvas</p></div>
        <button type="button" className="cv-notice-close" aria-label="Close notifications" onClick={() => { setOpen(false); bell.current?.focus(); }}><X size={16} /></button></div>
      <div className="cv-notice-filters"><div>
        <button type="button" aria-pressed={!unreadOnly} onClick={() => setUnreadOnly(false)}>All</button>
        <button type="button" aria-pressed={unreadOnly} onClick={() => setUnreadOnly(true)}>Unread · {unread}</button>
      </div><button type="button" disabled={!unread} onClick={() => markAllRead(canvasId)}>Mark all read</button></div>
      <div className="cv-notice-list">{scoped.filter(n => !unreadOnly || !n.read).map(n => <button type="button" key={n.id}
        className={`cv-notice-row ${n.read ? '' : 'unread'}`} onClick={() => visit(n)}>
        {icon(n)}<span className="cv-notice-copy"><strong>{n.kind === 'completed' ? 'Your reply is ready' : 'A reply needs attention'}</strong>
          <span>{n.title}</span><small>{timeAgoShort(n.createdAt)} · Open thread</small></span>
        {!n.read && <span className="cv-notice-dot" aria-label="Unread" />}<ArrowUpRight size={14} aria-hidden="true" />
      </button>)}{!scoped.some(n => !unreadOnly || !n.read) && <div className="cv-notice-empty"><Glyph value="icon:roots" cycle={[]} index={0} size={36} fallback={<Bell size={28} />} /><strong>{unreadOnly ? 'All caught up' : 'Room to think'}</strong><p>Completed replies and errors appear here.</p></div>}</div>
      <footer>THIS CANVAS · THIS SESSION</footer>
    </section>}
    <div aria-live="polite" aria-atomic="true">{brief && !open && <div className="cv-notice-brief">
      <button type="button" className="cv-notice-row" onClick={() => visit(brief)}>{icon(brief)}<span className="cv-notice-copy"><strong>{brief.kind === 'completed' ? 'Your reply is ready' : 'A reply needs attention'}</strong><span>{brief.title}</span><small>Open thread ↗</small></span></button>
      <button type="button" aria-label="Dismiss notification" onClick={() => setBrief(null)}><X size={14} /></button>
    </div>}</div>
  </div>;
}
