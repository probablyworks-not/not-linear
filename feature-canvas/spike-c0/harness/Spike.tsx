import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background, Controls, MiniMap, ReactFlow, ReactFlowProvider,
  applyNodeChanges, useReactFlow,
  type Edge, type NodeChange, type Viewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ProseNode, type ProseNodeType } from './ProseNode';
import { paint, renders, streamStore, tally, totalNodeRenders } from './stream-store';

const COLS = 6;
const NODE_W = 360;
const NODE_H = 300;
const GAP_X = 160;
const GAP_Y = 120;
const COUNT = 60;

function seedScene(): { nodes: ProseNodeType[]; edges: Edge[] } {
  const nodes: ProseNodeType[] = [];
  const edges: Edge[] = [];
  for (let i = 0; i < COUNT; i++) {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    nodes.push({
      id: `n${i}`,
      type: 'prose',
      position: { x: col * (NODE_W + GAP_X), y: row * (NODE_H + GAP_Y) },
      width: NODE_W,
      height: NODE_H,
      data: { label: i === 0 ? 'streaming reply' : `reply ${i}`, seed: i, streaming: i === 0 },
    });
    if (i > 0) edges.push({ id: `e${i}`, source: `n${i - 1}`, target: `n${i}`, animated: false });
  }
  return { nodes, edges };
}

interface Snapshot { nodes: ProseNodeType[]; label: string }

function SpikeInner() {
  const seeded = useMemo(() => seedScene(), []);
  const [nodes, setNodes] = useState<ProseNodeType[]>(seeded.nodes);
  const [edges] = useState<Edge[]>(seeded.edges);
  const [undoStack, setUndoStack] = useState<Snapshot[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [zoomReadout, setZoomReadout] = useState(1);
  const [perf, setPerf] = useState({ mean: 0, p95: 0, worst: 0, lastInteraction: 0 });
  const nodesRef = useRef<ProseNodeType[]>(seeded.nodes);
  const gesture = useRef(false);
  const rf = useReactFlow();
  tally('scene');

  useEffect(() => { if (!paint.firstMs) paint.firstMs = Math.round(performance.now()); }, []);
  useEffect(() => { nodesRef.current = nodes; }, [nodes]);

  const push = useCallback((label: string) => {
    setUndoStack(s => [...s, { nodes: nodesRef.current, label }].slice(-50));
  }, []);

  const onNodesChange = useCallback((changes: NodeChange<ProseNodeType>[]) => {
    // One undo entry per gesture, snapshotted at its START: by the time a resize reports
    // `resizing: false` the nodes already hold the new geometry, so a snapshot taken then
    // makes undo a no-op. Gate on a ref so intermediate frames add nothing.
    const startsResize = changes.some(c => c.type === 'dimensions' && c.resizing === true);
    const startsDrag = changes.some(c => c.type === 'position' && c.dragging === true);
    if ((startsResize || startsDrag) && !gesture.current) {
      gesture.current = true;
      push(startsResize ? 'resize' : 'drag');
    }
    if (changes.some(c => (c.type === 'dimensions' && c.resizing === false) || (c.type === 'position' && c.dragging === false))) {
      gesture.current = false;
    }
    const s = changes.find(c => c.type === 'select' && c.selected);
    if (s && s.type === 'select') setSel(s.id);
    setNodes(nds => applyNodeChanges(changes, nds));
  }, [push]);

  const undo = useCallback(() => {
    setUndoStack(s => {
      const last = s[s.length - 1];
      if (last) setNodes(last.nodes);
      return s.slice(0, -1);
    });
  }, []);

  useEffect(() => {
    const onResize = (e: Event) => {
      const d = (e as CustomEvent<{ id: string; dw: number; dh: number }>).detail;
      push('kbd-resize');
      setNodes(nds => nds.map(n => n.id === d.id
        ? { ...n, width: Math.max(240, (n.width ?? NODE_W) + d.dw), height: Math.max(140, (n.height ?? NODE_H) + d.dh) }
        : n));
    };
    const onBranch = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      const src = nodesRef.current.find(n => n.id === id);
      if (!src) return;
      push('branch');
      const child: ProseNodeType = {
        id: `b${Date.now()}`,
        type: 'prose',
        // Beside the source with vertical jitter. Nothing else moves.
        position: { x: src.position.x + (src.width ?? NODE_W) + 80, y: src.position.y + (Math.random() * 80 - 40) },
        width: 360, height: 260,
        data: { label: `branch of ${id}`, seed: src.data.seed + 7, streaming: false },
      };
      setNodes(nds => [...nds, child]);
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
    };
    window.addEventListener('spike:resize', onResize);
    window.addEventListener('spike:branch', onBranch);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('spike:resize', onResize);
      window.removeEventListener('spike:branch', onBranch);
      window.removeEventListener('keydown', onKey);
    };
  }, [push, undo]);

  const stream = useCallback(() => {
    streamStore.reset();
    const words = 'A token arriving must update one card and nothing else. '.repeat(40).split(' ');
    let i = 0;
    const t = setInterval(() => {
      if (i >= words.length) { clearInterval(t); return; }
      streamStore.append((words[i++] ?? '') + ' ');
    }, 25);
  }, []);

  const benchPan = useCallback(() => {
    const frames: number[] = [];
    const start = rf.getViewport();
    let f = 0;
    let prev = performance.now();
    const step = () => {
      const now = performance.now();
      frames.push(now - prev);
      prev = now;
      rf.setViewport({ x: start.x - f * 6, y: start.y - f * 2, zoom: start.zoom });
      if (++f < 120) requestAnimationFrame(step);
      else {
        const sorted = [...frames].slice(1).sort((a, b) => a - b);
        setPerf(p => ({
          ...p,
          mean: Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length * 10) / 10,
          p95: Math.round((sorted[Math.floor(sorted.length * 0.95)] ?? 0) * 10) / 10,
          worst: Math.round((sorted[sorted.length - 1] ?? 0) * 10) / 10,
        }));
      }
    };
    requestAnimationFrame(step);
  }, [rf]);

  const setZoom = useCallback((z: number) => {
    const t0 = performance.now();
    // Anchor on n0 (world origin) so the zoom presets are deterministic for the driver.
    rf.setViewport({ x: 80, y: 140, zoom: z }, { duration: 0 });
    setZoomReadout(z);
    requestAnimationFrame(() => setPerf(p => ({ ...p, lastInteraction: Math.round((performance.now() - t0) * 10) / 10 })));
  }, [rf]);

  const nodeTypes = useMemo(() => ({ prose: ProseNode }), []);
  const selected = nodes.find(n => n.id === sel) ?? null;

  return (
    <>
      <ReactFlow<ProseNodeType>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onMove={(_, v: Viewport) => setZoomReadout(v.zoom)}
        minZoom={0.2}
        maxZoom={2}
        panOnScroll
        zoomOnScroll={false}
        zoomOnDoubleClick={false}
        nodesFocusable
        selectionKeyCode={null}
        proOptions={{ hideAttribution: false }}
      >
        <Background gap={26} />
        <Controls />
        <MiniMap pannable zoomable style={{ width: 200, height: 120 }} />
      </ReactFlow>
      <Hud
        zoom={zoomReadout}
        undoDepth={undoStack.length}
        lastUndo={undoStack[undoStack.length - 1]?.label ?? '—'}
        selected={selected}
        perf={perf}
      />
      <div className="sp-bar">
        <button onClick={() => setZoom(0.5)}>50%</button>
        <button onClick={() => setZoom(1)}>100%</button>
        <button onClick={() => setZoom(2)}>200%</button>
        <button onClick={stream} data-testid="btn-stream">stream</button>
        <button onClick={benchPan} data-testid="btn-bench">bench pan</button>
        <button onClick={undo} data-testid="btn-undo">undo</button>
        <button data-testid="btn-reset" onClick={() => setNodes(nds => nds.map(n =>
          n.id === 'n0' ? { ...n, width: NODE_W, height: NODE_H } : n))}>reset n0</button>
      </div>
      {selected ? <ScopedComposer node={selected} /> : null}
    </>
  );
}

/** Screen-space composer anchored to a world-space node, clamped into the viewport. */
function ScopedComposer({ node }: { node: ProseNodeType }) {
  const rf = useReactFlow();
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force(n => n + 1), 60);
    return () => clearInterval(t);
  }, []);
  tally('composer');
  const anchor = rf.flowToScreenPosition({ x: node.position.x, y: node.position.y + (node.height ?? 0) });
  const W = 360, H = 98, PAD = 12;
  let top = anchor.y + PAD;
  if (top + H > window.innerHeight - PAD) top = anchor.y - H - PAD * 2;
  top = Math.max(PAD, Math.min(top, window.innerHeight - H - PAD));
  const left = Math.max(PAD, Math.min(anchor.x, window.innerWidth - W - PAD));
  return (
    <div className="sp-composer" style={{ top, left }} data-testid="scoped-composer">
      <div className="sp-chip">{node.data.label}</div>
      <input placeholder="Ask about this source…" aria-label="Ask about this source" />
    </div>
  );
}

function Hud({ zoom, undoDepth, lastUndo, selected, perf }: {
  zoom: number; undoDepth: number; lastUndo: string;
  selected: ProseNodeType | null;
  perf: { mean: number; p95: number; worst: number; lastInteraction: number };
}) {
  const [, force] = useState(0);
  useEffect(() => {
    const t = setInterval(() => force(n => n + 1), 400);
    return () => clearInterval(t);
  }, []);
  const streamTail = renders.get('streamTail') ?? 0;
  const scene = renders.get('scene') ?? 0;
  const n0 = renders.get('n0') ?? 0;
  const n7 = renders.get('n7') ?? 0;
  return (
    <div className="sp-hud" data-testid="hud">
      <table>
        <tbody>
          <tr><td>zoom</td><td>{Math.round(zoom * 100)}%</td></tr>
          <tr><td>selected logical w&times;h</td><td data-testid="hud-dims">{selected ? `${Math.round(selected.width ?? 0)}×${Math.round(selected.height ?? 0)}` : '—'}</td></tr>
          <tr><td>undo depth / last</td><td data-testid="hud-undo">{undoDepth} / {lastUndo}</td></tr>
          <tr><td>first paint</td><td data-testid="hud-paint">{paint.firstMs} ms</td></tr>
          <tr><td>pan frame mean / p95 / worst</td><td data-testid="hud-frames">{perf.mean} / {perf.p95} / {perf.worst} ms</td></tr>
          <tr><td>zoom-to interaction</td><td>{perf.lastInteraction} ms</td></tr>
          <tr><td>renders: scene</td><td data-testid="hud-scene">{scene}</td></tr>
          <tr><td>renders: streamTail</td><td data-testid="hud-tail">{streamTail}</td></tr>
          <tr><td>renders: n0 (streaming) / n7</td><td data-testid="hud-nodes">{n0} / {n7}</td></tr>
          <tr><td>renders: all nodes</td><td>{totalNodeRenders()}</td></tr>
        </tbody>
      </table>
    </div>
  );
}

export function Spike() {
  return (
    <div style={{ height: '100%' }}>
      <ReactFlowProvider>
        <SpikeInner />
      </ReactFlowProvider>
    </div>
  );
}
