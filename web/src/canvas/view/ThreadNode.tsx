import { memo, useSyncExternalStore } from 'react';
import { Handle, NodeResizer, Position, type Node, type NodeProps } from '@xyflow/react';
import { Download, GitBranch, Layers, MessageSquare } from 'lucide-react';
import type { CanvasMessage, CanvasThread } from '../types';
import { PartView } from './PartView';
import { liveText } from './live-text';

export interface ThreadData extends Record<string, unknown> {
  thread: CanvasThread;
  messages: CanvasMessage[];
  /** Frozen excerpts this thread was built from, already resolved for display. */
  sources: { id: string; label: string; status: 'ok' | 'changed' | 'missing' }[];
  /** Saves a reply as an output version and pins it into the project's Artifacts. */
  onSaveOutput(messageId: string): void;
}
export type ThreadNodeType = Node<ThreadData, 'thread'>;

const KIND_ICON = { root: MessageSquare, branch: GitBranch, synthesis: Layers } as const;

/**
 * The streaming tail. Subscribes to one message id, so a token re-renders this and nothing else —
 * not the card around it, and certainly not the scene.
 */
const LiveText = memo(function LiveText({ messageId }: { messageId: string }) {
  const text = useSyncExternalStore(liveText.subscribeTo(messageId), liveText.getOf(messageId));
  if (text === undefined) return null;
  return <div data-testid="live-text" className="nl-md whitespace-pre-wrap">{text}</div>;
});

const STATUS_TITLE = {
  ok: 'The source still reads as it did',
  changed: 'The source was edited after this was asked — the excerpt is kept',
  missing: 'The source is gone — the excerpt is kept',
} as const;

export const ThreadNode = memo(function ThreadNode({ data, selected, width, height }: NodeProps<ThreadNodeType>) {
  const { thread, messages, sources, onSaveOutput } = data;
  const Icon = KIND_ICON[thread.kind];

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
                s.status === 'ok' ? 'bg-cv-hl-blue text-text'
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
        card cannot be selected at all — the defect the C0 spike caught. `nowheel` lets the card
        scroll its own overflow instead of panning the world.
      */}
      <div className="nodrag nowheel min-h-0 flex-1 select-text overflow-auto px-3.5 py-3 [-webkit-user-select:text]">
        {messages.map(m => (
          <div key={m.id} data-message={m.id} className="mb-3 last:mb-0">
            <div className="mb-1 font-mono text-xs uppercase tracking-widest text-text-3">
              {m.author.kind === 'human' ? 'You' : m.author.kind === 'model' ? m.author.model : m.author.agentId}
              {m.provisional ? ' · working' : ''}
            </div>
            {m.provisional ? <LiveText messageId={m.id} /> : m.parts.map(p => <PartView key={p.id} part={p} />)}
            {!m.provisional && m.author.kind === 'model' && (
              <button
                type="button" data-testid="save-output" onClick={() => onSaveOutput(m.id)}
                className="nodrag mt-1.5 flex items-center gap-1 rounded-md border border-cv-edge px-1.5 py-0.5 text-xs text-text-3 hover:text-text"
              >
                <Download size={11} aria-hidden /> Save to Artifacts
              </button>
            )}
          </div>
        ))}
        {messages.length === 0 && <div className="text-xs text-text-3">Nothing here yet.</div>}
      </div>
    </article>
  );
});
