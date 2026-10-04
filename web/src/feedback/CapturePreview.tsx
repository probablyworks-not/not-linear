import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Eraser, Pencil, Plus, Trash2, Undo2 } from 'lucide-react';
import { clsx } from 'clsx';
import { ESC_PRIORITY, useEscLayer } from '../lib/keyboard';
import { addPreview, discardPreview, useFeedbackStore } from './feedback-store';
import { annotationColor, canvasPoint, redraw, type Stroke } from './annotate';

/**
 * Review a fresh capture before it joins the report (core/feedback.js:212).
 * Screenshots can be drawn on with a pen; nothing is attached until "Add to
 * report", and Discard - or Escape - deletes the file that was just captured.
 */
export function CapturePreview() {
  const preview = useFeedbackStore(s => s.preview);
  // Above every other surface: legacy handles this Escape in the capture phase, ahead of everything else.
  useEscLayer('feedbackPreview', ESC_PRIORITY.feedbackPreview, preview !== null, () => { void discardPreview(); });

  return (
    <Dialog.Root open={preview !== null} onOpenChange={o => { if (!o) void discardPreview(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[500] bg-scrim" />
        <Dialog.Content
          aria-describedby={undefined} onEscapeKeyDown={e => e.preventDefault()}
          className="fixed left-1/2 top-1/2 z-[501] flex max-h-[90vh] w-fit max-w-[min(1100px,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col gap-2.5 rounded-xl border border-rule-2 bg-surface p-3.5 shadow-lg"
        >
          {preview && <PreviewBody kind={preview.kind} path={preview.path} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function PreviewBody({ kind, path }: { kind: 'image' | 'video'; path: string }) {
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [pen, setPen] = useState(true);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const drawing = useRef(false);
  // Cache-busting, as legacy does: the file at this path is rewritten when annotations are saved.
  const [src] = useState(() => `/${path}?t=${Date.now()}`);

  // Load the image once, size the canvas to its natural pixels. The canvas is an external drawing surface.
  useEffect(() => {
    if (kind !== 'image') return undefined;
    const img = new Image();
    img.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      imgRef.current = img;
      setState('ready');
    };
    img.onerror = () => setState('error');
    img.src = src;
    return () => { img.onload = null; img.onerror = null; };
  }, [kind, src]);

  // Repaint whenever the strokes change.
  useEffect(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    const ctx = canvas?.getContext('2d');
    if (state === 'ready' && canvas && img && ctx) redraw(ctx, canvas, img, strokes, annotationColor());
  }, [strokes, state]);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) =>
    canvasPoint(e.currentTarget.getBoundingClientRect(), e.currentTarget, e.clientX, e.clientY);

  const add = (): void => {
    const canvas = canvasRef.current;
    const b64 = kind === 'image' && strokes.length && canvas ? canvas.toDataURL('image/png').split(',')[1]! : null;
    void addPreview(b64);
  };

  const tool = 'grid h-7 w-7 place-items-center rounded-md border border-rule bg-transparent text-text-3 hover:border-rule-2 hover:text-text';
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <Dialog.Title className="m-0 text-sm font-semibold text-text">
          {kind === 'image' ? 'Screenshot — draw to annotate' : 'Recording preview'}
        </Dialog.Title>
        {kind === 'image' && (
          <div className="flex gap-1">
            <button
              type="button" title="Pen" aria-label="Pen" aria-pressed={pen} onClick={() => setPen(p => !p)}
              className={clsx(tool, pen && 'border-annotate-line bg-annotate-faint text-annotate')}
            >
              <Pencil size={14} />
            </button>
            <button type="button" title="Undo" aria-label="Undo" className={tool} onClick={() => setStrokes(s => s.slice(0, -1))}><Undo2 size={14} /></button>
            <button type="button" title="Clear annotations" aria-label="Clear annotations" className={tool} onClick={() => setStrokes([])}><Eraser size={14} /></button>
          </div>
        )}
      </div>

      <div className="flex min-h-0 items-center justify-center overflow-auto">
        {kind === 'image' ? (
          <>
            <canvas
              ref={canvasRef} data-testid="fb-canvas" hidden={state !== 'ready'}
              className="max-h-[70vh] max-w-full cursor-crosshair rounded-lg border border-rule object-contain"
              onPointerDown={e => {
                if (!pen) return;
                drawing.current = true;
                // Read the event NOW: a state updater runs later, after React has reset e.currentTarget.
                const p = point(e);
                setStrokes(s => [...s, [p]]);
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={e => {
                if (!drawing.current) return;
                const p = point(e);
                setStrokes(s => s.map((st, i) => (i === s.length - 1 ? [...st, p] : st)));
              }}
              onPointerUp={() => { drawing.current = false; }}
            />
            {state === 'error' && <div className="p-8 text-sm text-text-3">Could not load the screenshot.</div>}
          </>
        ) : state === 'error' ? (
          <div className="p-8 text-sm text-text-3">Preview not supported in this browser — the recording is still saved and can be added.</div>
        ) : (
          <video
            src={src} controls muted autoPlay onError={() => setState('error')}
            className="max-h-[70vh] max-w-full rounded-lg border border-rule"
          />
        )}
      </div>

      <div className="flex justify-end gap-2">
        <button
          type="button" onClick={() => { void discardPreview(); }}
          className="flex items-center gap-1.5 rounded-md border border-rule-2 px-3 py-1.5 text-sm text-text-2 hover:border-annotate-line hover:text-annotate"
        >
          <Trash2 size={13} aria-hidden />Discard
        </button>
        <button
          type="button" onClick={add}
          className="flex items-center gap-1.5 rounded-md border border-rule-2 bg-bg-2 px-3 py-1.5 text-sm font-medium text-text hover:bg-accent hover:text-bg"
        >
          <Plus size={13} aria-hidden />Add to report
        </button>
      </div>
    </>
  );
}
