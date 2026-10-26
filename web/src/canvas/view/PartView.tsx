import { memo, useEffect, useRef, useState } from 'react';
import { highlightCodeIn, renderMarkdown, renderMermaidIn } from '../../lib/markdown';
import type { CanvasPart } from '../types';
import { structureReply } from './structure-reply';
import { withSelectionBridge } from './html-bridge';
import { htmlSelectionBus } from './html-selection-bus';
import { applyHighlights, type TextHighlight } from './apply-highlights';
import { BLOCK_HANDLE_ATTR, blockQuote, tagBlocks } from './block-select';

/** Fired when a block's left-edge hover handle is picked — a click (one block, `additive` false
 * unless Cmd/Ctrl was held) or a drag through several handles (one call per block in the run, see
 * `Markdownish`'s mousedown/mouseover/mouseup wiring below). `rect` is the clicked/last block's own
 * bounding box, the same "where to float the composer" signal a free-range selection's `rect`
 * already provides (`useCanvasSelection.ts`). */
export type BlockPickHandler = (
  messageId: string, partId: string, quote: string, additive: boolean,
  rect: { left: number; top: number; width: number; height: number },
) => void;

// Renders a typed part. Markdown, code, maths and diagrams go through the app's existing renderer
// so a Canvas reply reads exactly like a chat reply — but it renders *parts*, and never parses
// layout back out of saved markup the way the legacy chat stream does (ADR-038).

// Memoized: the caller (`PartView`/`ThreadNode`) passes an already-stable `highlights` array (built
// once per thread content-change in `CanvasWorkspace`, not re-filtered per render), so `text`,
// `partId` and `highlights` only change identity when this part's own content actually did —
// letting an edit elsewhere on the canvas skip re-parsing this markdown entirely.
const Markdownish = memo(function Markdownish({
  text, partId, messageId, highlights, onBlockPick,
}: {
  text: string; partId: string; messageId: string; highlights?: readonly TextHighlight[]; onBlockPick?: BlockPickHandler;
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
    applyHighlights(el, highlights ?? []);
  }, [text, highlights]);

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
        onBlockPickRef.current(messageId, partId, quote, i === lo ? startAdditive : true, rect);
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
  }, [messageId, partId]);

  return (
    <div
      ref={ref} data-part={partId} className="nl-md"
      // The same trusted path the chat stream uses: our own renderer's output, not model HTML.
      dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }}
    />
  );
});

const MIN_HTML_HEIGHT = 160;
const DEFAULT_HTML_HEIGHT = 320;
const MIN_HTML_WIDTH = 360;
const MAX_HTML_WIDTH = 1400;
const DEFAULT_HTML_WIDTH = 880;

interface NlHtmlPartMessage {
  __nlHtmlPart: true;
  type: 'height' | 'selection' | 'wheel';
  height?: number;
  width?: number;
  text?: string;
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

/** The sandboxed iframe for a generated-HTML reply, auto-sized to its real content on both axes —
 * height uncapped (so the canvas node grows tall to fit rather than the iframe ever scrolling its
 * own content), width clamped to a sane range (`MIN_HTML_WIDTH`–`MAX_HTML_WIDTH`) so a document
 * that fits in a narrow table doesn't sit in an oversized card and a wide one isn't clipped. Also
 * bridges a selection made inside it back out to the same "Ask about this" flow markdown text
 * uses (`html-bridge.ts`/`html-selection-bus.ts`) — a sandboxed document has no other way out. */
function HtmlFrame({ part, messageId }: { part: Extract<CanvasPart, { kind: 'html' }>; messageId: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(DEFAULT_HTML_HEIGHT);
  const [width, setWidth] = useState(DEFAULT_HTML_WIDTH);
  const srcDoc = withSelectionBridge(part.html);

  useEffect(() => {
    const onMessage = (ev: MessageEvent): void => {
      if (ev.source !== ref.current?.contentWindow || !isNlHtmlPartMessage(ev.data)) return;
      if (ev.data.type === 'height' && typeof ev.data.height === 'number') {
        setHeight(Math.max(MIN_HTML_HEIGHT, ev.data.height));
        if (typeof ev.data.width === 'number') setWidth(Math.min(MAX_HTML_WIDTH, Math.max(MIN_HTML_WIDTH, ev.data.width)));
      } else if (ev.data.type === 'selection') {
        const text = ev.data.text?.trim();
        if (!text || !ev.data.rect) { htmlSelectionBus.emit(null); return; }
        const frame = ref.current?.getBoundingClientRect();
        htmlSelectionBus.emit({
          messageId, partId: part.id, quote: text,
          rect: { left: ev.data.rect.left + (frame?.left ?? 0), top: ev.data.rect.top + (frame?.top ?? 0), width: ev.data.rect.width, height: ev.data.rect.height },
          inCanvasPane: !!ref.current?.closest('.react-flow'),
        });
      } else if (ev.data.type === 'wheel') {
        // Re-dispatch as a native wheel event on the ReactFlow pane the iframe sits inside, at the
        // iframe's own screen position — a wheel event born inside a cross-origin iframe document
        // has no other way to reach react-flow's own listeners (see `html-bridge.ts`).
        const pane = ref.current?.closest<HTMLElement>('.react-flow');
        const frame = ref.current?.getBoundingClientRect();
        if (!pane || !frame) return;
        pane.dispatchEvent(new WheelEvent('wheel', {
          bubbles: true, cancelable: true,
          deltaX: ev.data.deltaX, deltaY: ev.data.deltaY, deltaMode: ev.data.deltaMode,
          ctrlKey: ev.data.ctrlKey, metaKey: ev.data.metaKey,
          clientX: frame.left + (ev.data.clientX ?? 0), clientY: frame.top + (ev.data.clientY ?? 0),
        }));
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [messageId, part.id]);

  return (
    <iframe
      ref={ref} data-part={part.id} title={part.title || 'Generated HTML'} sandbox="allow-scripts" srcDoc={srcDoc}
      // `maxWidth: 100%` is what keeps this from overflowing a narrower container than the
      // measured width — Reading View's and Output Detail's own fixed-width panels, in particular.
      style={{ height, width, maxWidth: '100%' }} className="rounded-lg border border-cv-edge bg-cv-card"
    />
  );
}

// Keyed by part id (the `tool_result` markdown sub-render uses `${part.id}-body`, see below), built
// once per thread content-change in `CanvasWorkspace` — so a plain property lookup here hands
// `Markdownish` the same array reference across renders when nothing about this part's highlights
// changed, rather than a fresh `.filter()` result every time.
export function PartView({ part, messageId, highlightsByPart, onBlockPick }: {
  part: CanvasPart; messageId: string; highlightsByPart?: Record<string, readonly TextHighlight[]>; onBlockPick?: BlockPickHandler;
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
      return <Markdownish text={`\`\`\`${part.language}\n${part.text}\n\`\`\``} partId={part.id} messageId={messageId} highlights={highlightsByPart?.[part.id]} onBlockPick={onBlockPick} />;
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
      return <HtmlFrame part={part} messageId={messageId} />;
    case 'attachment':
      return (
        <div data-part={part.id} className="flex items-center gap-2 rounded-lg border border-cv-edge bg-cv-card-inset px-2.5 py-1.5 text-xs text-text-2">
          <span className="truncate">{part.name}</span>
          <span className="font-mono text-text-3">{Math.round(part.bytes / 1024)}kB</span>
        </div>
      );
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
