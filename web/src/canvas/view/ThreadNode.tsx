import { memo, useEffect, useRef, useSyncExternalStore } from 'react';
import { Handle, NodeResizer, Position, type Node, type NodeProps } from '@xyflow/react';
import { Download, Expand, GitBranch, Layers, MessageSquare, SquareDashedMousePointer } from 'lucide-react';
import type { CanvasMessage, CanvasThread, HighlightTone } from '../types';
import type { TextHighlight } from '../anchors';
import { PartView, type BlockPickHandler } from './PartView';
import { liveText } from './live-text';
import { renderMarkdown } from '../../lib/markdown';
import { modelLabelFromId } from '../../chat/models';
import { ClarifyCard } from '../../chat/ClarifyCard';
import { resolveClarify } from '../../chat/clarify';
import { useChatStore } from '../../chat/chat-store';

export interface ThreadData extends Record<string, unknown> {
  thread: CanvasThread;
  messages: CanvasMessage[];
  /** Frozen excerpts this thread was built from, already resolved for display. */
  sources: { id: string; label: string; status: 'ok' | 'changed' | 'missing'; highlightTone?: HighlightTone }[];
  /** Quotes frozen out of this thread's own messages (what got branched/synthesized *from* here),
   * keyed by message id then part id, so the source text itself can carry the same tint as the
   * branched card's chip — otherwise nothing in the original text shows what was branched. Grouped
   * by part up front so each `PartView` gets an already-stable array instead of filtering its own
   * slice out of the message's full list on every render. */
  highlightsByMessage: Record<string, Record<string, TextHighlight[]>>;
  /** Saves a reply as an output version and pins it into the project's Artifacts. */
  onSaveOutput(messageId: string): void;
  /** Opens the full, unclipped reply in the output-detail view (UI-09). */
  onViewOutput(messageId: string): void;
  /** True while this is the thread currently being sent to — always auto-grows while active;
   * a thread holding a generated-HTML reply auto-grows permanently instead (see `autoGrow` below),
   * since that content is never meant to scroll inside its own card. */
  active?: boolean;
  /** Reports this node's natural (unclipped) content size while auto-growing, in px. Height always
   * matters (a growing reply); width only moves a generated-HTML card (`CanvasWorkspace`'s
   * `hasHtml` branch) — a plain markdown card keeps its fixed reading-column width regardless of
   * what this reports. */
  onContentSize?(threadId: string, size: { width: number; height: number }): void;
  /** Fires on any body resize/reflow, so a highlight-anchored edge can re-measure its mark. */
  onBodyResize?(threadId: string): void;
  /** A block's left-edge handle was picked (click, Cmd/Ctrl-click, or a drag through several). */
  onBlockPick?: BlockPickHandler;
  /** The whole-card affordance was used — every message in this thread, frozen as one source. */
  onPickWhole?(threadId: string, rect: { left: number; top: number; width: number; height: number }): void;
  /** Set when some *other* thread was branched/synthesized from this entire card (a `WholeAnchor`
   * snapshot pointing at it) — tints the whole body the same way a branched quote tints its text. */
  wholeTone?: HighlightTone;
}
export type ThreadNodeType = Node<ThreadData, 'thread'>;

const KIND_ICON = { root: MessageSquare, branch: GitBranch, synthesis: Layers } as const;

/** C6. Only applied when a source still resolves `ok` — `changed`/`missing` keep their own
 * meaningful colour (yellow / dashed) since that status is a signal, not decoration. */
export const TONE_BG: Record<HighlightTone, string> = {
  blue: 'bg-cv-hl-blue', pink: 'bg-cv-hl-pink', brown: 'bg-cv-hl-brown',
  green: 'bg-cv-hl-green', yellow: 'bg-cv-hl-yellow', orange: 'bg-cv-hl-orange',
};

/**
 * The streaming tail. Subscribes to one message id, so a token re-renders this and nothing else —
 * not the card around it, and certainly not the scene.
 */
const LiveText = memo(function LiveText({ messageId }: { messageId: string }) {
  const text = useSyncExternalStore(liveText.subscribeTo(messageId), liveText.getOf(messageId));
  if (text === undefined) return null;
  // Same renderer as the finished part (PartView/Markdownish), so a reply reads the same mid-stream
  // as it does once PartView takes over — only highlight.js/mermaid wait for the DOM to settle.
  return <div data-testid="live-text" className="nl-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />;
});

const STATUS_TITLE = {
  ok: 'The source still reads as it did',
  changed: 'The source was edited after this was asked — the excerpt is kept',
  missing: 'The source is gone — the excerpt is kept',
} as const;

export const ThreadNode = memo(function ThreadNode({ data, selected, width, height }: NodeProps<ThreadNodeType>) {
  const {
    thread, messages, sources, highlightsByMessage, onSaveOutput, onViewOutput, active,
    onContentSize, onBodyResize, onBlockPick, onPickWhole, wholeTone,
  } = data;
  const headerRef = useRef<HTMLButtonElement>(null);
  const Icon = KIND_ICON[thread.kind];
  // Set by CanvasWorkspace's clarify pre-flight (send()) while it waits on the user; cleared once
  // answered or skipped. Only the active thread ever has one, so this read is cheap elsewhere.
  const clarifyQuestions = useChatStore(s => s.live[thread.id]?.clarify);

  // A generated-HTML reply is never meant to scroll inside its own card — the node should just be
  // as tall as the HTML (its width is a fixed reading column instead, set by the workspace). So a
  // thread holding one auto-grows permanently, not only while `active`.
  const hasHtml = messages.some(m => m.parts.some(p => p.kind === 'html'));
  const autoGrow = active || hasHtml;

  // While auto-growing, the body renders unclipped so it has a natural size, and a ResizeObserver
  // reports that size up so the workspace can grow the node (and the camera) to match — rather
  // than the usual fixed-size card that scrolls its own overflow. Width only actually moves a
  // generated-HTML card (`CanvasWorkspace`'s `hasHtml` branch ignores it otherwise) — the
  // iframe's own explicit width (`PartView.tsx`'s `HtmlFrame`) is what makes this body's
  // `scrollWidth` grow past the node's current width in the first place.
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!autoGrow || !onContentSize) return;
    const el = bodyRef.current;
    if (!el) return;
    const report = () => onContentSize(thread.id, {
      width: Math.ceil(el.scrollWidth / 8) * 8, height: Math.ceil(el.scrollHeight / 8) * 8,
    });
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [autoGrow, onContentSize, thread.id]);

  // Runs regardless of `active` — a highlight-anchored edge needs to re-measure its mark whenever
  // this card's body reflows (resize, streamed content settling, markdown remount), not just while
  // the card is the one actively growing.
  useEffect(() => {
    if (!onBodyResize) return;
    const el = bodyRef.current;
    if (!el) return;
    const report = () => onBodyResize(thread.id);
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [onBodyResize, thread.id]);

  // React Flow's pane checks for the `nowheel` class before it ever looks at `ctrlKey`, so a plain
  // CSS-class opt-out (the old approach here) swallows pinch/ctrl+scroll zoom too, not just plain
  // scroll-to-pan — the card silently ate every wheel gesture. A native listener lets us keep plain
  // scroll scoped to the card's own overflow while letting a ctrlKey wheel event (trackpad pinch, or
  // held Ctrl) bubble up to the canvas and zoom normally, same as everywhere else on the canvas.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => { if (!e.ctrlKey) e.stopPropagation(); };
    el.addEventListener('wheel', onWheel);
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  return (
    <article
      data-testid={`thread-node-${thread.id}`} data-thread={thread.id}
      className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-cv-edge bg-cv-card shadow-md"
      aria-label={thread.title}
    >
      <NodeResizer minWidth={260} minHeight={160} isVisible={!!selected} />
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />

      <header className="flex flex-none items-center gap-2 border-b border-cv-divider px-3 py-2">
        <Icon size={13} aria-hidden className="flex-none text-text-3" />
        <span className="min-w-0 flex-1 truncate font-mono text-xs uppercase tracking-widest text-text-3">{thread.title}</span>
        {onPickWhole && (
          <button
            ref={headerRef} type="button" data-testid="pick-whole-card" title="Select this whole card"
            onClick={() => onPickWhole(thread.id, headerRef.current?.getBoundingClientRect() ?? { left: 0, top: 0, width: 0, height: 0 })}
            className="nodrag flex-none text-text-3 hover:text-accent"
          >
            <SquareDashedMousePointer size={13} aria-hidden />
          </button>
        )}
        <span className="flex-none font-mono text-xs text-text-3" data-testid="node-dims">
          {Math.round(width ?? 0)}&times;{Math.round(height ?? 0)}
        </span>
      </header>

      {sources.length > 0 && (
        <div className="flex flex-none flex-wrap gap-1 border-b border-cv-divider px-3 py-1.5">
          {sources.map(s => (
            <span
              key={s.id} data-source={s.id} data-status={s.status} title={STATUS_TITLE[s.status]}
              className={`max-w-[200px] truncate rounded-sm px-1.5 py-px text-xs ${
                s.status === 'ok' ? `${TONE_BG[s.highlightTone ?? 'blue']} text-text`
                : s.status === 'changed' ? 'bg-cv-hl-yellow text-text'
                : 'border border-dashed border-cv-edge text-text-3'}`}
            >
              {s.status === 'missing' ? `${s.label} (source gone)` : s.label}
            </span>
          ))}
        </div>
      )}

      {/*
        `nodrag` and `user-select:text` together are the whole branching gesture. React Flow's own
        stylesheet sets `user-select: none` on every node, so without the override text inside a
        card cannot be selected at all — the defect the C0 spike caught. The wheel listener above
        (not a `nowheel` class — see its comment) lets the card scroll its own overflow instead of
        panning the world, without also blocking pinch/ctrl+scroll zoom.
      */}
      <div
        ref={bodyRef}
        className={`nodrag select-text px-3.5 py-3 [-webkit-user-select:text] ${wholeTone ? TONE_BG[wholeTone] : ''} ${
          autoGrow ? 'overflow-visible' : 'min-h-0 flex-1 overflow-auto'}`}
      >
        {messages.map(m => (
          <div key={m.id} data-message={m.id} className="mb-3 last:mb-0">
            <div className="mb-1 font-mono text-xs uppercase tracking-widest text-text-3">
              {m.author.kind === 'human' ? 'You' : m.author.kind === 'model' ? modelLabelFromId(m.author.model) : m.author.agentId}
              {m.provisional ? ' · working' : ''}
            </div>
            {m.provisional ? <LiveText messageId={m.id} /> : m.parts.map(p => (
              <PartView key={p.id} part={p} messageId={m.id} highlightsByPart={highlightsByMessage[m.id]} onBlockPick={onBlockPick} />
            ))}
            {!m.provisional && m.author.kind === 'model' && (
              <div className="mt-1.5 flex items-center gap-1.5">
                <button
                  type="button" data-testid="view-output" onClick={() => onViewOutput(m.id)}
                  className="nodrag flex items-center gap-1 rounded-md border border-cv-edge px-1.5 py-0.5 text-xs text-text-3 hover:text-text"
                >
                  <Expand size={11} aria-hidden /> View full
                </button>
                <button
                  type="button" data-testid="save-output" onClick={() => onSaveOutput(m.id)}
                  className="nodrag flex items-center gap-1 rounded-md border border-cv-edge px-1.5 py-0.5 text-xs text-text-3 hover:text-text"
                >
                  <Download size={11} aria-hidden /> Save to Artifacts
                </button>
              </div>
            )}
          </div>
        ))}
        {messages.length === 0 && <div className="text-xs text-text-3">Nothing here yet.</div>}
        {active && clarifyQuestions?.length ? (
          <div className="mt-3">
            <ClarifyCard
              questions={clarifyQuestions}
              onSubmit={answers => resolveClarify(thread.id, answers)}
              onSkip={() => resolveClarify(thread.id, null)}
            />
          </div>
        ) : null}
      </div>
    </article>
  );
});
