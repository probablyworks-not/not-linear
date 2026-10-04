import { useEffect, useRef, useState } from 'react';
import { Bug, Camera, Crop, Image as ImageIcon, Monitor, Square, Video, X } from 'lucide-react';
import { clsx } from 'clsx';
import {
  closePanel, currentContext, doShot, removeMedia, saveFeedback, setText, setType, startRec, stopRec,
  useFeedbackStore, type CaptureMode, type FeedbackType,
} from './feedback-store';

/**
 * The floating Feedback panel (core/feedback.js initFeedback). A non-modal
 * dialog: it stays beside the app so a bug can be filed while looking at it.
 * It hides itself during a capture so it is not in its own screenshot.
 */
export function FeedbackPanel() {
  const s = useFeedbackStore();
  const [menu, setMenu] = useState<null | { for: 'shot' | 'rec'; left: number; bottom: number }>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [now, setNow] = useState(() => Date.now());

  // Focus the box when the panel opens (legacy: textEl.focus()). Focus is an external system.
  useEffect(() => { if (s.open) textRef.current?.focus(); }, [s.open]);

  // Tick the Stop · m:ss label while recording.
  useEffect(() => {
    if (!s.recording) return undefined;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [s.recording]);

  // Dismiss the capture menu on the next pointerdown anywhere else.
  useEffect(() => {
    if (!menu) return undefined;
    const away = (e: PointerEvent): void => {
      if (!(e.target as Element).closest('[data-capture-menu]')) setMenu(null);
    };
    const t = setTimeout(() => document.addEventListener('pointerdown', away), 0);
    return () => { clearTimeout(t); document.removeEventListener('pointerdown', away); };
  }, [menu]);

  if (!s.open) return null;

  // `now` may predate the recording by up to a tick, so never show a negative time.
  const secs = Math.max(0, Math.floor((now - s.recStartedAt) / 1000));
  const recLabel = `Stop · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
  const ctx = currentContext();

  const openMenu = (kind: 'shot' | 'rec', anchor: HTMLElement): void => {
    const a = anchor.getBoundingClientRect();
    const p = panelRef.current!.getBoundingClientRect();
    setMenu({ for: kind, left: a.left - p.left, bottom: p.bottom - a.top + 6 });
  };
  const pick = (mode: CaptureMode): void => {
    const kind = menu?.for;
    setMenu(null);
    if (kind === 'shot') void doShot(mode); else void startRec(mode);
  };

  // Drag by the header; once dragged the panel is positioned by left/top instead of right/bottom.
  const onHeadDown = (e: React.PointerEvent): void => {
    if ((e.target as Element).closest('[data-fb-close]')) return;
    const rect = panelRef.current!.getBoundingClientRect();
    const dx = e.clientX - rect.left;
    const dy = e.clientY - rect.top;
    const move = (ev: PointerEvent): void => setPos({
      left: Math.max(0, Math.min(window.innerWidth - rect.width, ev.clientX - dx)),
      top: Math.max(0, Math.min(window.innerHeight - rect.height, ev.clientY - dy)),
    });
    const up = (): void => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // Tab inserts a tab character instead of leaving the box (core/ui.js wireTabInsertsTab).
  const onTextKey = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key !== 'Tab' || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
    e.preventDefault();
    const el = e.currentTarget;
    const start = el.selectionStart;
    setText(el.value.slice(0, start) + '\t' + el.value.slice(el.selectionEnd));
    requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = start + 1; });
  };

  const mediaBtn = 'flex flex-1 items-center justify-center gap-1.5 rounded-md border border-rule bg-transparent px-2 py-1.5 text-sm text-text-2 enabled:hover:border-rule-2 enabled:hover:text-text disabled:opacity-50';
  const typeBtn = (t: FeedbackType, label: string) => (
    <button
      type="button" aria-pressed={s.type === t} onClick={() => setType(t)}
      className={clsx(
        'flex-1 rounded-md border px-2 py-1 text-sm',
        s.type === t ? 'border-rule-2 bg-accent-soft text-text' : 'border-transparent text-text-3 hover:text-text-2',
      )}
    >
      {label}
    </button>
  );

  return (
    <div
      ref={panelRef} role="dialog" aria-label="Feedback" aria-modal="false"
      // Escape closes the panel only when focus is inside it, and must not also reach the app-level chain.
      onKeyDown={e => { if (e.key === 'Escape' && !s.preview) { e.stopPropagation(); closePanel(); } }}
      style={pos ? { left: pos.left, top: pos.top, right: 'auto', bottom: 'auto' } : undefined}
      className={clsx(
        'fixed bottom-6 right-6 z-[400] flex w-[320px] flex-col gap-2.5 rounded-[10px] border border-rule-2 bg-surface p-3 shadow-lg',
        s.capturing && 'invisible',
      )}
    >
      <div className="flex cursor-grab select-none items-center justify-between active:cursor-grabbing" onPointerDown={onHeadDown}>
        <span className="flex items-center gap-1.5 text-sm font-semibold text-text"><Bug size={14} aria-hidden />Feedback</span>
        <button
          type="button" data-fb-close title="Close (Esc)" aria-label="Close feedback" onClick={closePanel}
          className="grid h-6 w-6 place-items-center rounded-md text-text-3 hover:bg-accent-soft hover:text-text"
        >
          <X size={14} />
        </button>
      </div>

      <div className="flex gap-1.5">{typeBtn('bug', 'Bug')}{typeBtn('idea', 'Idea')}</div>

      <textarea
        ref={textRef} rows={4} aria-label="Feedback text" value={s.text}
        placeholder={s.type === 'bug' ? 'What happened?' : "What's the idea?"}
        onChange={e => setText(e.target.value)} onKeyDown={onTextKey}
        className="w-full resize-y rounded-md border border-rule bg-bg px-2.5 py-2 text-sm text-text placeholder:text-text-3 focus:border-rule-2 focus:outline-none"
      />

      {s.type === 'bug' && (
        <div className="flex gap-1.5">
          <button type="button" className={mediaBtn} disabled={s.shotBusy} onClick={e => openMenu('shot', e.currentTarget)}>
            <Camera size={13} aria-hidden />Screenshot
          </button>
          <button
            type="button" disabled={s.recBusy}
            className={clsx(mediaBtn, s.recording && 'border-annotate-line text-annotate')}
            onClick={e => { if (s.recording) void stopRec(); else openMenu('rec', e.currentTarget); }}
          >
            {s.recording ? <Square size={12} aria-hidden fill="currentColor" /> : <Video size={13} aria-hidden />}
            {s.recording ? recLabel : 'Record'}
          </button>
        </div>
      )}

      {s.media.length > 0 && (
        <div className="flex flex-wrap gap-1.5" data-testid="fb-chips">
          {s.media.map((p, i) => (
            <span key={`${p}-${i}`} title={p} className="inline-flex items-center gap-1 rounded-[5px] border border-rule bg-bg-2 px-1.5 py-0.5 text-xs text-text-2">
              {p.endsWith('.mov') ? <Video size={11} aria-hidden /> : <ImageIcon size={11} aria-hidden />}
              {p.split('/').pop()}
              <button type="button" title="Remove" aria-label={`Remove ${p.split('/').pop()}`} onClick={() => removeMedia(i)} className="text-text-3 hover:text-text">
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <span data-testid="fb-ctx" className="min-w-0 truncate font-mono text-xs text-text-3">{ctx.view} · {ctx.thread}</span>
        <button
          type="button" disabled={s.saving} onClick={() => { void saveFeedback(); }}
          className="rounded-md border border-rule-2 bg-bg-2 px-3.5 py-1 text-sm font-medium text-text enabled:hover:bg-accent enabled:hover:text-bg disabled:opacity-50"
        >
          Save
        </button>
      </div>

      {menu && (
        <div
          data-capture-menu role="menu" style={{ left: menu.left, bottom: menu.bottom }}
          className="absolute z-10 flex min-w-[150px] flex-col gap-0.5 rounded-[7px] border border-rule-2 bg-surface p-1 shadow-md"
        >
          <button type="button" role="menuitem" onClick={() => pick('area')} className="flex items-center gap-2 rounded-[5px] px-2 py-1.5 text-left text-sm text-text-2 hover:bg-accent-soft hover:text-text">
            <Crop size={14} aria-hidden />Select area
          </button>
          <button type="button" role="menuitem" onClick={() => pick('full')} className="flex items-center gap-2 rounded-[5px] px-2 py-1.5 text-left text-sm text-text-2 hover:bg-accent-soft hover:text-text">
            <Monitor size={14} aria-hidden />Full screen
          </button>
        </div>
      )}
    </div>
  );
}
