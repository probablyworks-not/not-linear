import { memo, useCallback, useSyncExternalStore } from 'react';
import { Handle, NodeResizer, Position, type Node, type NodeProps } from '@xyflow/react';
import { proseFor } from './prose';
import { renders, streamStore, tally } from './stream-store';

export interface ProseData extends Record<string, unknown> {
  label: string;
  seed: number;
  streaming: boolean;
}
export type ProseNodeType = Node<ProseData, 'prose'>;

/** The streamed tail. Only this subtree subscribes, so a token cannot re-render the scene. */
const StreamTail = memo(function StreamTail() {
  const text = useSyncExternalStore(streamStore.subscribe, streamStore.get);
  tally('streamTail');
  return <p data-testid="stream-tail">{text}</p>;
});

export const ProseNode = memo(function ProseNode({ id, data, selected, width, height }: NodeProps<ProseNodeType>) {
  const n = tally(id);
  const paras = proseFor(data.seed);
  const lead = paras[0] ?? '';

  // Keyboard-only resize and branch. Shift+arrows resize; Enter asks for a branch.
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      window.dispatchEvent(new CustomEvent('spike:branch', { detail: id }));
      return;
    }
    if (!e.shiftKey || !e.key.startsWith('Arrow')) return;
    e.preventDefault();
    const dw = e.key === 'ArrowRight' ? 20 : e.key === 'ArrowLeft' ? -20 : 0;
    const dh = e.key === 'ArrowDown' ? 20 : e.key === 'ArrowUp' ? -20 : 0;
    window.dispatchEvent(new CustomEvent('spike:resize', { detail: { id, dw, dh } }));
  }, [id]);

  return (
    <div className="sp-node" tabIndex={0} onKeyDown={onKeyDown} data-testid={`node-${id}`}>
      <NodeResizer minWidth={240} minHeight={140} isVisible={!!selected} />
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />
      <div className="sp-head">
        <span>{data.label}</span>
        <span style={{ marginLeft: 'auto' }} data-testid={`dims-${id}`}>
          {Math.round(width ?? 0)}&times;{Math.round(height ?? 0)} · r{n}
        </span>
      </div>
      {/* `nodrag` is the whole text-selection contract: a drag starting here must not pan. */}
      <div className="sp-body nodrag">
        <p>
          {lead.slice(0, 60)}
          <span className="sp-mark">{lead.slice(60, 150)}</span>
          {lead.slice(150)}
        </p>
        {/* `nowheel` lets the inner panel consume its own scrolling. */}
        <div className="sp-inner nowheel" data-testid={`inner-${id}`}>
          {proseFor(data.seed + 2, 4).map((p, i) => <p key={i}>{p}</p>)}
        </div>
        {paras.slice(1).map((p, i) => <p key={i}>{p}</p>)}
        {data.streaming ? <StreamTail /> : null}
      </div>
    </div>
  );
});

export function renderCountOf(id: string): number {
  return renders.get(id) ?? 0;
}
