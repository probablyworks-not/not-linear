import { useCanvasDoc } from '../canvas-doc-store';
import { useUiStore } from '../../state/ui-store';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { highlightCodeIn, renderMarkdown, renderMermaidIn } from '../../lib/markdown';
import type { CanvasPart } from '../types';
import { structureReply } from './structure-reply';
import { withSelectionBridge } from './html-bridge';
import { htmlSelectionBus } from './html-selection-bus';
import { applyHighlights, type TextHighlight } from './apply-highlights';
import { canScroll } from './wheel';
import { htmlAnchors } from './html-anchors';
import { quoteOccurrence, sourceRange } from './selection-source';
import { BLOCK_HANDLE_ATTR, blockQuote, tagBlocks } from './block-select';

/** Fired when a block's left-edge hover handle is picked — a click (one block, `additive` false
 * unless Cmd/Ctrl was held) or a drag through several handles (one call per block in the run, see
 * `Markdownish`'s mousedown/mouseover/mouseup wiring below). `rect` is the clicked/last block's own
 * bounding box, the same "where to float the composer" signal a free-range selection's `rect`
 * already provides (`useCanvasSelection.ts`). */
export type BlockPickHandler = (
  messageId: string, partId: string, quote: string, additive: boolean,
  rect: { left: number; top: number; width: number; height: number },
  occurrence?: number,
  sourceSpan?: { start: number; end: number },
) => void;

// Renders a typed part. Markdown, code, maths and diagrams go through the app's existing renderer
// so a Canvas reply reads exactly like a chat reply — but it renders *parts*, and never parses
// layout back out of saved markup the way the legacy chat stream does (ADR-038).

// Memoized: the caller (`PartView`/`ThreadNode`) passes an already-stable `highlights` array (built
// once per thread content-change in `CanvasWorkspace`, not re-filtered per render), so `text`,
// `partId` and `highlights` only change identity when this part's own content actually did —
// letting an edit elsewhere on the canvas skip re-parsing this markdown entirely.
const Markdownish = memo(function Markdownish({
  text, partId, messageId, highlights, onBlockPick, sourceText = text,
}: {
  text: string; sourceText?: string; partId: string; messageId: string; highlights?: readonly TextHighlight[]; onBlockPick?: BlockPickHandler;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // `onBlockPick` is read through a ref rather than a dependency so the listener effect below is
  // attached once per mount, not re-attached every time an unrelated prop identity changes —
  // stacking duplicate listeners on the same persistent `el` across re-renders would double- (or
  // N-)fire a click.
  const onBlockPickRef = useRef(onBlockPick);
  useEffect(() => { onBlockPickRef.current = onBlockPick; }, [onBlockPick]);

  // Mermaid and highlight.js both work on mounted DOM: external systems, so an effect is right.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    renderMermaidIn(el);
    void highlightCodeIn(el);
    structureReply(el);
    // Only where a pick can actually go anywhere — Reading View and the Output Detail overlay
    // reuse this same renderer outside the canvas, with no `onBlockPick` wired up; tagging blocks
    // there would show hover handles that do nothing when clicked.
    if (onBlockPickRef.current) tagBlocks(el);
    // Always run, even with an empty list: a highlight going from present to absent (its snapshot
    // was deleted — a cancelled "ask about this" pick) still needs the stale `<mark>` unwrapped,
    // which only `applyHighlights`'s own reconciliation does.
    applyHighlights(el, highlights ?? [], sourceText);
  }, [text, sourceText, highlights]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handleIndexOf = (t: EventTarget | null): number | null => {
      const btn = t instanceof Element ? t.closest(`[${BLOCK_HANDLE_ATTR}]`) : null;
      const v = btn?.getAttribute(BLOCK_HANDLE_ATTR);
      return v === null || v === undefined ? null : Number(v);
    };
    let dragStart: number | null = null;
    let dragOver: number | null = null;
    let startAdditive = false;
    const onMouseDown = (e: MouseEvent): void => {
      const i = handleIndexOf(e.target);
      if (i === null) return;
      e.preventDefault(); // a handle starts a block pick, never a native text-selection drag
      dragStart = i; dragOver = i;
      startAdditive = e.metaKey || e.ctrlKey;
    };
    const onMouseOver = (e: MouseEvent): void => {
      if (dragStart === null) return;
      const i = handleIndexOf(e.target);
      if (i !== null) dragOver = i;
    };
    const onMouseUp = (): void => {
      if (dragStart === null || !onBlockPickRef.current) { dragStart = null; return; }
      const [lo, hi] = dragStart <= (dragOver ?? dragStart) ? [dragStart, dragOver ?? dragStart] : [dragOver ?? dragStart, dragStart];
      for (let i = lo; i <= hi; i++) {
        const quote = blockQuote(el, i);
        if (!quote) continue;
        const block = el.querySelector<HTMLElement>(`[data-block="${i}"]`);
        const rect = block?.getBoundingClientRect() ?? { left: 0, top: 0, width: 0, height: 0 };
        const range = document.createRange();
        if (block) range.selectNodeContents(block);
        const occurrence = block ? quoteOccurrence(el, range, quote) : 0;
        const span = sourceRange(sourceText, quote, occurrence, false, el);
        onBlockPickRef.current(messageId, partId, quote, i === lo ? startAdditive : true, rect, occurrence, span ?? undefined);
      }
      dragStart = null; dragOver = null;
    };
    el.addEventListener('mousedown', onMouseDown);
    el.addEventListener('mouseover', onMouseOver);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      el.removeEventListener('mousedown', onMouseDown);
      el.removeEventListener('mouseover', onMouseOver);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [messageId, partId, sourceText]);

  return (
    <div
      ref={ref} data-part={partId} className="nl-md"
      // The same trusted path the chat stream uses: our own renderer's output, not model HTML.
      dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }}
    />
  );
});

interface NlHtmlPartMessage {
  __nlHtmlPart: true;
  type: 'selection' | 'wheel' | 'anchors' | 'escape' | 'pagination';
  height?: number; pages?: { top: number; height: number }[]; fallback?: string; oversized?: boolean;
  marks?: { id: string; rect: { left: number; top: number; width: number; height: number } }[];
  text?: string;
  occurrence?: number;
  element?: { tag: string; index: number };
  rect?: { left: number; top: number; width: number; height: number };
  deltaX?: number;
  deltaY?: number;
  deltaMode?: number;
  ctrlKey?: boolean;
  metaKey?: boolean;
  clientX?: number;
  clientY?: number;
}

const isNlHtmlPartMessage = (data: unknown): data is NlHtmlPartMessage =>
  !!data && typeof data === 'object' && (data as { __nlHtmlPart?: unknown }).__nlHtmlPart === true;

/** Bounded previews/readers or a continuous document measured inside its opaque sandbox. */
export function HtmlFrame({ part, messageId, fullPage, highlights, paginated = false, streamHtml, onPreviewReady }: {
  part: Extract<CanvasPart, { kind: 'html' }>; messageId: string; fullPage?: boolean; highlights?: readonly TextHighlight[]; paginated?: boolean; streamHtml?: string; onPreviewReady?: (ready: boolean) => void;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  const srcDoc = withSelectionBridge(part.html, fullPage, paginated, streamHtml !== undefined);
  const [layout, setLayout] = useState<{ height: number; pages: { top: number; height: number }[]; fallback?: string; oversized?: boolean } | null>(null);
  const requestLayout = useCallback(() => {
    if (paginated) ref.current?.contentWindow?.postMessage({ __nlHtmlCommand: 'paginate' }, '*');
  }, [paginated]);
  const streamRef = useRef(streamHtml);
  useEffect(() => { streamRef.current = streamHtml; }, [streamHtml]);
  const publishStream = useCallback(() => {
    if (streamRef.current !== undefined) ref.current?.contentWindow?.postMessage({ __nlHtmlCommand: 'stream', html: streamRef.current }, '*');
  }, []);
  useEffect(publishStream, [streamHtml, publishStream]);
  const paint = useCallback(() => {
    const palette = getComputedStyle(document.documentElement);
    const marks = (highlights ?? []).map(h => {
      let occurrence = 0;
      if (h.start !== undefined) {
        while (true) {
          const span = sourceRange(part.html, h.quote, occurrence, true);
          if (!span || span.start >= h.start) break;
          occurrence++;
        }
      }
      return { id: h.id, quote: h.quote, occurrence, color: palette.getPropertyValue(`--cv-hl-${h.tone}`).trim() };
    });
    ref.current?.contentWindow?.postMessage({ __nlHtmlCommand: 'marks', marks }, '*');
  }, [highlights, part.html]);
  useEffect(() => { paint(); }, [paint]);

  useEffect(() => {
    const onMessage = (ev: MessageEvent): void => {
      if (ev.source !== ref.current?.contentWindow) return;
      if (ev.data?.__nlHtmlPart === true && ev.data.type === 'stream-ready') {
        onPreviewReady?.(true);
        return;
      }
      if (!isNlHtmlPartMessage(ev.data)) return;
      if (ev.data.type === 'pagination' && paginated) {
        const { height, pages, fallback, oversized } = ev.data;
        if (typeof height !== 'number' || !Number.isFinite(height) || height < 1 || height > 100000 || !Array.isArray(pages) || pages.length > 201 || pages.some(p => !Number.isFinite(p.top) || !Number.isFinite(p.height) || p.top < 0 || p.height < 1 || p.top + p.height > height + 1)) return;
        setLayout(previous => {
          const next = { height, pages, fallback, oversized };
          return JSON.stringify(previous) === JSON.stringify(next) ? previous : next;
        });
      } else if (ev.data.type === 'escape') {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      } else if (ev.data.type === 'anchors' && Array.isArray(ev.data.marks)) {
        if (ref.current) htmlAnchors.update(ref.current, ev.data.marks);
      } else if (ev.data.type === 'selection') {
        const text = ev.data.text?.trim();
        if (!text || !ev.data.rect) { htmlSelectionBus.emit(null); return; }
        const frame = ref.current?.getBoundingClientRect();
        const sx = frame && ref.current?.offsetWidth ? frame.width / ref.current.offsetWidth : 1;
        const sy = frame && ref.current?.offsetHeight ? frame.height / ref.current.offsetHeight : 1;
        htmlSelectionBus.emit({
          messageId, partId: part.id, quote: text, occurrence: ev.data.occurrence, element: ev.data.element,
          rect: { left: (ev.data.rect.left + (ref.current?.clientLeft ?? 0)) * sx + (frame?.left ?? 0), top: (ev.data.rect.top + (ref.current?.clientTop ?? 0)) * sy + (frame?.top ?? 0), width: ev.data.rect.width * sx, height: ev.data.rect.height * sy },
          inCanvasPane: !!ref.current?.closest('.react-flow'),
        });
      } else if (ev.data.type === 'wheel') {
        // Re-dispatch as a native wheel event on the ReactFlow pane the iframe sits inside, at the
        // iframe's own screen position — a wheel event born inside a cross-origin iframe document
        // has no other way to reach react-flow's own listeners (see `html-bridge.ts`).
        const pane = ref.current?.closest<HTMLElement>('.react-flow')?.querySelector<HTMLElement>('.react-flow__renderer');
        const frame = ref.current?.getBoundingClientRect();
        if (!frame) return;
        if (!pane) {
          let el = ref.current?.parentElement;
          while (el) {
            const style = getComputedStyle(el);
            if (/auto|scroll/.test(style.overflow + style.overflowY + style.overflowX) && canScroll(el, ev.data.deltaX ?? 0, ev.data.deltaY ?? 0)) {
              const unit = ev.data.deltaMode === 1 ? 16 : ev.data.deltaMode === 2 ? el.clientHeight : 1;
              el.scrollBy((ev.data.deltaX ?? 0) * unit, (ev.data.deltaY ?? 0) * unit); break;
            }
            el = el.parentElement;
          }
          return;
        }
        pane.dispatchEvent(new WheelEvent('wheel', {
          bubbles: true, cancelable: true,
          deltaX: ev.data.deltaX, deltaY: ev.data.deltaY, deltaMode: ev.data.deltaMode,
          ctrlKey: ev.data.ctrlKey, metaKey: ev.data.metaKey,
          clientX: frame.left + (ev.data.clientX ?? 0) * (frame.width / (ref.current?.offsetWidth || frame.width)),
          clientY: frame.top + (ev.data.clientY ?? 0) * (frame.height / (ref.current?.offsetHeight || frame.height)),
        }));
      }
    };
    const frame = ref.current;
    const clear = () => frame?.contentWindow?.postMessage({ __nlHtmlCommand: 'clear' }, '*');
    window.addEventListener('message', onMessage);
    window.addEventListener('nl-clear-html-selection', clear);
    requestLayout();
    return () => {
      window.removeEventListener('message', onMessage);
      window.removeEventListener('nl-clear-html-selection', clear);
      if (frame) htmlAnchors.remove(frame);
    };
  }, [messageId, part.id, paginated, requestLayout, onPreviewReady]);

  const pages = paginated ? layout?.pages ?? [] : [];
  const mask = pages.length ? {
    maskImage: pages.map(() => 'linear-gradient(black,black)').join(','),
    maskSize: pages.map(p => `100% ${p.height}px`).join(','),
    maskPosition: pages.map(p => `0 ${p.top}px`).join(','),
    maskRepeat: 'no-repeat',
  } : {};
  return (
    <div className={fullPage ? 'h-full min-h-0' : 'relative'} data-testid={paginated ? 'html-sections' : undefined}>
      {layout?.fallback && paginated && <p role="status" className="mb-2 text-xs text-text-3">This layout uses a scrollable section to preserve its formatting and interactions.</p>}
      {layout?.oversized && paginated && <p role="status" className="mb-2 text-xs text-text-3">An interactive chart or complex layout is kept together in a taller section.</p>}
      <div className={fullPage ? 'h-full min-h-0' : 'relative'}>
        <iframe
          ref={ref} data-part={part.id} title={part.title || 'Generated HTML'} sandbox="allow-scripts" srcDoc={srcDoc}
          onLoad={() => { paint(); publishStream(); requestLayout(); }}
          style={{ height: fullPage ? '100%' : paginated ? layout?.height ?? 640 : 480, width: fullPage ? '100%' : 880, maxWidth: '100%', ...mask }}
          className={`block min-h-0 bg-cv-card ${pages.length ? '' : 'rounded-lg border border-cv-edge'}`}
        />
        {pages.map((p, i) => <div key={i} data-testid="html-section" aria-label={`Answer section ${i + 1}`}
          className="pointer-events-none absolute inset-x-0 rounded-lg border border-cv-edge"
          style={{ top: p.top, height: p.height }} />)}
      </div>
    </div>
  );
}

// Keyed by part id (the `tool_result` markdown sub-render uses `${part.id}-body`, see below), built
// once per thread content-change in `CanvasWorkspace` — so a plain property lookup here hands
// `Markdownish` the same array reference across renders when nothing about this part's highlights
// changed, rather than a fresh `.filter()` result every time.
export function PartView({ part, messageId, highlightsByPart, onBlockPick, fullPage, paginated }: {
  part: CanvasPart; messageId: string; fullPage?: boolean; paginated?: boolean; highlightsByPart?: Record<string, readonly TextHighlight[]>; onBlockPick?: BlockPickHandler;
}) {
  if (part.state === 'failed') {
    return (
      <div role="alert" data-part={part.id} className="rounded-lg border border-danger-border bg-danger-soft p-2.5 text-xs text-danger">
        {part.error || 'This part could not be produced.'}
      </div>
    );
  }
  if (part.state === 'pending') {
    return <div data-part={part.id} className="text-xs text-text-3">Working&hellip;</div>;
  }
  switch (part.kind) {
    case 'text':
    case 'report':
      return <Markdownish text={part.text} partId={part.id} messageId={messageId} highlights={highlightsByPart?.[part.id]} onBlockPick={onBlockPick} />;
    case 'code':
      return <Markdownish sourceText={part.text} text={`\`\`\`${part.language}\n${part.text}\n\`\`\``} partId={part.id} messageId={messageId} highlights={highlightsByPart?.[part.id]} onBlockPick={onBlockPick} />;
    case 'tool_result':
      return (
        <details data-part={part.id} className="rounded-lg border border-cv-edge bg-cv-card-inset px-2.5 py-1.5 text-xs">
          <summary className="cursor-pointer text-text-3">{part.title}</summary>
          <Markdownish text={part.markdown} partId={`${part.id}-body`} messageId={messageId} highlights={highlightsByPart?.[`${part.id}-body`]} onBlockPick={onBlockPick} />
        </details>
      );
    case 'html':
      // Untrusted: scripts are allowed (so a self-contained chart script can run), but
      // `allow-same-origin` is withheld, so the document still executes in an opaque, isolated
      // origin with no access to the app's cookies, storage, or DOM. Same boundary as
      // ArtifactDetail otherwise. The declared network policy lands with the HTML surface in C5.
      return <HtmlFrame part={part} messageId={messageId} fullPage={fullPage} paginated={paginated || !fullPage} highlights={highlightsByPart?.[part.id]} />;
    case 'attachment':
      return <AttachmentView part={part} />;
    case 'image':
    case 'video':
      // C5. Declared so a media part can be stored now and shown then, rather than rendering
      // something that pretends to be a generated image.
      return (
        <div data-part={part.id} className="rounded-lg border border-dashed border-cv-edge px-2.5 py-2 text-xs text-text-3">
          {part.kind === 'image' ? 'Image' : 'Video'} output is not available in this release.
        </div>
      );
    default:
      return null;
  }
}

function AttachmentView({ part }: { part: Extract<CanvasPart, { kind: 'attachment' }> }) {
  const asset = useCanvasDoc(s => s.doc?.assets.find(a => a.id === part.assetId));
  const src = asset?.state === 'ready' && asset.mime.startsWith('image/') && asset.location.kind === 'inline'
    ? `data:${asset.mime};base64,${asset.location.data}` : null;
  if (src) return (
    <button type="button" data-part={part.id} aria-label={`Preview ${part.name}`}
      onClick={() => useUiStore.getState().setImagePreview({ src, name: part.name })}
      className="nodrag my-2 block w-full cursor-zoom-in rounded-lg border border-cv-edge bg-cv-card-inset p-2 text-left">
      <img src={src} alt={part.name} className="max-h-[360px] w-full rounded object-contain" />
      <span className="mt-1 block truncate text-xs text-text-3">{part.name}</span>
    </button>
  );
  return <div data-part={part.id} className="flex items-center gap-2 rounded-lg border border-cv-edge bg-cv-card-inset px-2.5 py-1.5 text-xs text-text-2">
    <span className="truncate">{part.name}</span><span className="font-mono text-text-3">{Math.round(part.bytes / 1024)}kB</span>
  </div>;
}
