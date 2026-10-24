import { useEffect, useRef, useState } from 'react';
import { ArrowUp, X } from 'lucide-react';
import { clearDraft, getDrafts, putDraft } from '../canvas-repo';
import { createDebouncedWriter } from '../../lib/debounced-writer';
import type { Draft, SourceSnapshot } from '../types';

// The Ink composer. Screen-space: it sits outside the pan/zoom transform so it never scales with
// the world, and it is clamped into the viewport so Send is always reachable (AC-08).
//
// Its draft is persisted per canvas AND per target. That is the whole of FR-05/AC09: switching
// canvases, or switching between asking a new question and replying to a thread, must never carry
// text, sources or model choice across. The chat composer keeps its draft in component state; this
// one cannot.

const draftWriter = createDebouncedWriter<string>(250);

export interface ComposerTarget {
  /** `new` | `thread:<id>` | `synthesis` */
  key: string;
  label: string;
  /** Screen-space anchor, when the composer is scoped to a card. */
  anchor?: { x: number; y: number };
}

interface Props {
  canvasId: string;
  target: ComposerTarget;
  sources: SourceSnapshot[];
  onRemoveSource(id: string): void;
  onSend(text: string): void | Promise<void>;
  busy?: boolean;
  onStop?(): void;
}

const W = 360, H = 98, PAD = 12;

export function InkComposer({ canvasId, target, sources, onRemoveSource, onSend, busy, onStop }: Props) {
  const [text, setText] = useState('');
  const [loaded, setLoaded] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  // Restore this target's draft. Reading persisted state is an external system. The composer is
  // keyed by target upstream, so a target switch is a fresh mount and there is nothing to reset
  // here — resetting would be the cascading render the lint rule is about.
  useEffect(() => {
    let live = true;
    void getDrafts(canvasId).then(all => {
      if (!live) return;
      setText(all[target.key]?.text ?? '');
      setLoaded(true);
    });
    return () => { live = false; };
  }, [canvasId, target.key]);

  // Persist on a debounce, keyed by canvas+target so two targets never cancel each other.
  useEffect(() => {
    if (!loaded) return;
    const draft: Draft = {
      target: target.key, text, snapshotIds: sources.map(s => s.id),
      attachmentAssetIds: [], updatedAt: Date.now(),
    };
    const key = `${canvasId}:${target.key}`;
    if (!text.trim() && sources.length === 0) draftWriter.schedule(key, () => clearDraft(canvasId, target.key));
    else draftWriter.schedule(key, () => putDraft(canvasId, draft));
  }, [canvasId, target.key, text, sources, loaded]);

  // Leaving the composer — switching target, closing the canvas — must not lose what was typed.
  // The debounce is an optimisation, not the contract, so flush it on the way out. A page unload
  // is a separate matter: React cleanup does not run reliably then, which is exactly why the
  // debounce is short rather than why this is the only path.
  useEffect(() => () => { void draftWriter.flushAll(); }, []);

  const canSend = !busy && text.trim().length > 0;
  const send = (): void => {
    if (!canSend) return;
    const value = text;
    setText('');
    void clearDraft(canvasId, target.key);
    void onSend(value);
  };

  const style = target.anchor
    ? {
        left: Math.max(PAD, Math.min(target.anchor.x, window.innerWidth - W - PAD)),
        top: Math.max(PAD, Math.min(target.anchor.y + PAD, window.innerHeight - H - PAD)),
      }
    : { left: '50%', bottom: 22, transform: 'translateX(-50%)' };

  return (
    <div
      data-testid="ink-composer" data-target={target.key}
      className="fixed z-[60] w-[360px] rounded-2xl border border-cv-edge bg-cv-card p-2.5 shadow-lg"
      style={style}
    >
      {sources.length > 0 && (
        // The chips are what "what the model will see" means before you send (FR-04). Each removes
        // on its own; removing one never clears the rest.
        <div data-testid="context-chips" className="mb-1.5 flex max-h-[98px] flex-wrap gap-1 overflow-auto">
          {sources.map(s => (
            <span key={s.id} data-chip={s.id} className="flex max-w-full items-center gap-1 rounded-sm bg-cv-hl-blue px-1.5 py-px text-xs text-text">
              <span className="min-w-0 truncate">{s.label}</span>
              <button
                type="button" aria-label={`Remove ${s.label} from context`}
                onClick={() => onRemoveSource(s.id)} className="flex-none text-text-3 hover:text-text"
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="mb-1 font-mono text-xs uppercase tracking-widest text-text-3">{target.label}</div>
      <div className="flex items-end gap-1.5">
        <textarea
          ref={ref} value={text} rows={1} aria-label="Ask about this canvas"
          placeholder={sources.length ? 'Ask about the selected source…' : 'Ask anything…'}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
            // Escape belongs to the Esc ladder, not to a bare listener here.
          }}
          className="max-h-[120px] min-h-[36px] flex-1 resize-none rounded-[10px] border border-cv-edge bg-cv-card-inset px-2.5 py-2 text-sm text-text placeholder:text-text-3"
        />
        {busy ? (
          <button type="button" onClick={onStop} aria-label="Stop" className="grid h-[30px] w-[30px] flex-none place-items-center rounded-full border border-cv-edge text-text-2">
            <span className="h-2.5 w-2.5 rounded-[2px] bg-text-2" />
          </button>
        ) : (
          <button
            type="button" onClick={send} disabled={!canSend} aria-label="Send"
            className="grid h-[30px] w-[30px] flex-none place-items-center rounded-full bg-text text-bg disabled:opacity-40"
          >
            <ArrowUp size={15} />
          </button>
        )}
      </div>
    </div>
  );
}
