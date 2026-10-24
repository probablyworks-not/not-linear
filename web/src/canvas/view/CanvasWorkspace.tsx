import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background, Controls, MiniMap, ReactFlow, ReactFlowProvider,
  applyNodeChanges, useReactFlow,
  type Edge, type NodeChange, type Viewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { BookOpen, Frame, Layers, Undo2 } from 'lucide-react';
import { ESC_PRIORITY, useEscLayer } from '../../lib/keyboard';
import { useCanvasDoc } from '../canvas-doc-store';
import { resolveAnchor } from '../anchors';
import {
  branchFrom, continueThread, createRootThread, freezeSelection, setGeometry, synthesize,
} from '../domain/commands';
import { DEFAULT_LAYOUT_ID, type CanvasDoc, type CanvasPart, type SourceSnapshot } from '../types';
import { saveOutputVersion } from '../domain/commands';
import { saveOutputToArtifacts } from '../save-output';
import { toast } from '../../ui/toast';
import { useAppStore } from '../../state/app-store';
import { newSubmissionId, runCanvasTurn } from '../exec/run-canvas-turn';
import { createDebouncedWriter } from '../../lib/debounced-writer';
import { liveText } from './live-text';
import { ThreadNode, type ThreadNodeType } from './ThreadNode';
import { InkComposer, type ComposerTarget } from './InkComposer';
import { ReadingView } from './ReadingView';
import { useCanvasSelection } from './useCanvasSelection';

const NODE_W = 360, NODE_H = 300;
const MIN_ZOOM = 0.2, MAX_ZOOM = 2;
/** Streamed text reaches the document this often, so a reload mid-stream keeps the partial answer. */
const STREAM_PERSIST_MS = 350;
const streamWriter = createDebouncedWriter<string>(STREAM_PERSIST_MS);

/** Part text, for turning a DOM selection into an offset into the part that was frozen. */
function partTextLookup(doc: CanvasDoc | null) {
  return (partId: string): string | null => {
    if (!doc) return null;
    for (const m of doc.messages) {
      for (const p of m.parts) {
        if (p.id !== partId) continue;
        if (p.kind === 'text' || p.kind === 'code' || p.kind === 'report') return p.text;
        if (p.kind === 'html') return p.html;
        if (p.kind === 'tool_result') return p.markdown;
      }
    }
    return null;
  };
}

function Workspace({ canvasId }: { canvasId: string }) {
  const doc = useCanvasDoc(s => s.doc);
  const view = useCanvasDoc(s => s.view);
  const saving = useCanvasDoc(s => s.saving);
  const undoDepth = useCanvasDoc(s => s.undo.length);
  const apply = useCanvasDoc(s => s.apply);
  const applyGeometry = useCanvasDoc(s => s.applyGeometry);
  const beginGesture = useCanvasDoc(s => s.beginGesture);
  const undoGeometry = useCanvasDoc(s => s.undoGeometry);
  const setViewport = useCanvasDoc(s => s.setViewport);

  const [reading, setReading] = useState(false);
  const [pickedSources, setPicked] = useState<string[]>([]);
  const [targetThread, setTargetThread] = useState<string | null>(null);
  const [gesture, setGestureActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const prefs = useAppStore(s => s.prefs);
  const projects = useAppStore(s => s.projects);
  const rf = useReactFlow();

  const partTextOf = useMemo(() => partTextLookup(doc), [doc]);
  const { selection, clear: clearSelection } = useCanvasSelection(partTextOf);

  // Reading mode is a dismissible surface, so it joins the Escape ladder rather than owning a key.
  useEscLayer('canvasReading', ESC_PRIORITY.canvasReading, reading, () => setReading(false));
  useEscLayer('canvasComposer', ESC_PRIORITY.canvasComposer, pickedSources.length > 0 || !!targetThread, () => {
    setPicked([]); setTargetThread(null); clearSelection();
  });

  // Save a reply as an immutable output version, then pin that version into project Artifacts.
  // Both halves matter: the version is the canvas's own history, the artifact is the thing the
  // user takes away, and a later canvas edit must not rewrite what they took.
  const onSaveOutput = useCallback(async (messageId: string) => {
    const current = useCanvasDoc.getState().doc;
    const message = current?.messages.find(m => m.id === messageId);
    if (!current || !message) return;
    const thread = current.threads.find(t => t.id === message.threadId);
    const title = thread?.title ?? 'Canvas output';
    const made = await apply(d => {
      const msg = d.messages.find(m => m.id === messageId);
      if (!msg) return null;
      const parts: CanvasPart[] = msg.parts.map(p => ({ ...p }));
      // Reuse this message's family, so saving it again is a new *version* of one artifact rather
      // than a second artifact. Identical content makes no version at all.
      const { output } = saveOutputVersion(d, msg.outputFamilyId ?? null, parts, { now: Date.now() });
      msg.outputFamilyId = output.familyId;
      return output;
    });
    const after = useCanvasDoc.getState().doc;
    if (!made || !after) return;
    const res = await saveOutputToArtifacts(after, made, title);
    if (res.status === 'failed') toast(res.error ?? 'Could not save this output.');
    else if (res.status === 'resumed') toast('Already saved to Artifacts');
    else toast(res.status === 'unchanged' ? 'No change since the last save' : `Saved to Artifacts${res.version && res.version > 1 ? ` (v${res.version})` : ''}`);
  }, [apply]);

  const nodes = useMemo<ThreadNodeType[]>(() => {
    if (!doc) return [];
    const layout = doc.layouts.find(l => l.id === DEFAULT_LAYOUT_ID);
    return doc.threads.map(thread => {
      const geo = layout?.entries[thread.id];
      const sources = doc.relations
        .filter(r => r.toThreadId === thread.id && r.snapshotId)
        .map(r => doc.snapshots.find(s => s.id === r.snapshotId))
        .filter((s): s is SourceSnapshot => !!s)
        .map(s => ({ id: s.id, label: s.label, status: resolveAnchor(s, doc).status }));
      return {
        id: thread.id,
        type: 'thread' as const,
        position: { x: geo?.x ?? 0, y: geo?.y ?? 0 },
        width: geo?.w ?? NODE_W,
        height: geo?.h ?? NODE_H,
        hidden: geo?.hidden,
        data: {
          thread,
          messages: doc.messages.filter(m => m.threadId === thread.id).sort((a, b) => a.seq - b.seq),
          sources,
          onSaveOutput: (id: string) => { void onSaveOutput(id); },
        },
      };
    });
  }, [doc, onSaveOutput]);

  const edges = useMemo<Edge[]>(() => {
    if (!doc) return [];
    return doc.relations
      .filter(r => r.fromThreadId !== r.toThreadId)
      .map(r => ({
        id: r.id, source: r.fromThreadId, target: r.toThreadId,
        className: r.kind === 'synthesis' ? 'nl-edge-synthesis' : 'nl-edge-branch',
      }));
  }, [doc]);

  const onNodesChange = useCallback((changes: NodeChange<ThreadNodeType>[]) => {
    // One undo entry per gesture, snapshotted at its START. Snapshotting on completion captures
    // the geometry that already changed, which makes undo a silent no-op — the C0 spike's defect.
    const starts = changes.some(c => (c.type === 'dimensions' && c.resizing === true) || (c.type === 'position' && c.dragging === true));
    const ends = changes.some(c => (c.type === 'dimensions' && c.resizing === false) || (c.type === 'position' && c.dragging === false));
    if (starts && !gesture) { setGestureActive(true); beginGesture('move'); }
    if (ends) setGestureActive(false);

    const next = applyNodeChanges(changes, nodes);
    applyGeometry(d => {
      for (const n of next) {
        setGeometry(d, n.id, { x: n.position.x, y: n.position.y, w: n.width ?? NODE_W, h: n.height ?? NODE_H });
      }
    });
  }, [nodes, applyGeometry, beginGesture, gesture]);

  const snapshots = useMemo(
    () => (doc ? pickedSources.map(id => doc.snapshots.find(s => s.id === id)).filter((s): s is SourceSnapshot => !!s) : []),
    [doc, pickedSources],
  );

  const addSelectionAsSource = useCallback(async () => {
    if (!selection || selection.start < 0) return;
    const made = await apply(d => freezeSelection(d, selection.messageId, selection.partId, selection.quote, selection.start, { now: Date.now() }));
    if (made) setPicked(p => [...p, made.id]);
    clearSelection();
  }, [selection, apply, clearSelection]);

  const target = useMemo<ComposerTarget>(() => {
    if (snapshots.length >= 2) return { key: 'synthesis', label: `Combine ${snapshots.length} sources` };
    if (snapshots.length === 1) return { key: 'new', label: 'Branch from the selected source' };
    if (targetThread) {
      const t = doc?.threads.find(x => x.id === targetThread);
      return { key: `thread:${targetThread}`, label: `Reply in ${t?.title ?? 'this thread'}` };
    }
    return { key: 'new', label: 'New question' };
  }, [snapshots.length, targetThread, doc]);

  const send = useCallback(async (text: string) => {
    const now = Date.now();
    // The question is written first, and on its own: if the model never answers, the user still has
    // what they asked and where they asked it from.
    const threadId = await apply(d => {
      if (snapshots.length >= 2) return synthesize(d, { snapshotIds: snapshots.map(s => s.id), prompt: text }, { now })?.thread.id ?? null;
      if (snapshots.length === 1) return branchFrom(d, { snapshotId: snapshots[0]!.id, prompt: text }, { now })?.thread.id ?? null;
      if (targetThread) { continueThread(d, targetThread, text, { now }); return targetThread; }
      return createRootThread(d, text, { now }, text.slice(0, 48)).thread.id;
    });
    setPicked([]);
    setTargetThread(null);
    if (!threadId) return;

    setBusy(true);
    const projectId = useCanvasDoc.getState().doc?.summary.projectId;
    try {
      const result = await runCanvasTurn(
        {
          threadId,
          submissionId: newSubmissionId(),
          modelPref: prefs.model as string | undefined,
          prefs,
          ...(projectId && projects[projectId] ? { project: projects[projectId] } : {}),
        },
        {
          apply: fn => useCanvasDoc.getState().apply(fn),
          onDelta: (messageId, soFar) => {
            liveText.set(messageId, soFar);
            // Coalesced: a token is not worth a transaction, but a refresh must not lose the answer.
            streamWriter.schedule(messageId, () => useCanvasDoc.getState().apply(d => {
              const m = d.messages.find(x => x.id === messageId);
              const part = m?.parts[0];
              if (part && part.kind === 'text') part.text = soFar;
            }).then(() => undefined));
          },
          onStatus: setStatus,
          register: c => { abortRef.current = c; },
        },
      );
      await streamWriter.flushAll();
      if (result.messageId) liveText.clear(result.messageId);
    } finally {
      setBusy(false);
      setStatus(null);
      abortRef.current = null;
    }
  }, [apply, snapshots, targetThread, prefs, projects]);

  // Stop is best effort: it cannot reverse work the provider has already done, and whatever text
  // arrived stays on the card.
  const stop = useCallback(() => { abortRef.current?.abort(); }, []);

  const showOnCanvas = useCallback((threadId: string) => {
    setReading(false);
    const n = nodes.find(x => x.id === threadId);
    if (n) rf.setCenter(n.position.x + (n.width ?? NODE_W) / 2, n.position.y + (n.height ?? NODE_H) / 2, { zoom: 1, duration: 200 });
  }, [nodes, rf]);

  // Restore the saved viewport once, when it arrives. A ref, not state: this records that an
  // external system (React Flow's viewport) has been told something, and re-rendering for it
  // would be a cascading render.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || !view || !doc) return;
    restored.current = true;
    rf.setViewport(view.viewport);
  }, [view, doc, rf]);

  const nodeTypes = useMemo(() => ({ thread: ThreadNode }), []);
  if (!doc) return null;

  if (reading) {
    return (
      <>
        <WorkspaceHeader doc={doc} saving={saving} reading onToggleReading={() => setReading(false)} undoDepth={undoDepth} onUndo={undoGeometry} />
        <ReadingView doc={doc} onBack={() => setReading(false)} onShowOnCanvas={showOnCanvas} />
      </>
    );
  }

  return (
    <>
      <WorkspaceHeader doc={doc} saving={saving} reading={false} onToggleReading={() => setReading(true)} undoDepth={undoDepth} onUndo={undoGeometry} />
      <div className="relative min-h-0 flex-1">
        <ReactFlow<ThreadNodeType>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onNodeClick={(_, n) => setTargetThread(n.id)}
          onPaneClick={() => { setTargetThread(null); setPicked([]); }}
          onMoveEnd={(_, v: Viewport) => setViewport(v)}
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
          panOnScroll
          zoomOnScroll={false}
          zoomOnDoubleClick={false}
          nodesFocusable
          selectionKeyCode={null}
          deleteKeyCode={null}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={26} />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable ariaLabel="Canvas minimap" style={{ width: 200, height: 120 }} />
        </ReactFlow>

        {selection && selection.start >= 0 && selection.rect.width + selection.rect.height > 0 && (
          <div
            data-testid="canvas-selection-popover"
            className="fixed z-[70] -translate-x-1/2 rounded-lg border border-rule-2 bg-surface px-1 py-1 shadow-md"
            style={{ left: selection.rect.left + selection.rect.width / 2, top: Math.max(8, selection.rect.top - 40) }}
          >
            <button
              type="button" data-testid="add-source"
              onClick={() => { void addSelectionAsSource(); }}
              className="rounded-md px-2 py-1 text-xs text-text-2 hover:bg-bg-2 hover:text-text"
            >
              Ask about this
            </button>
          </div>
        )}

        <InkComposer
          key={target.key}
          canvasId={canvasId}
          target={target}
          sources={snapshots}
          onRemoveSource={id => setPicked(p => p.filter(x => x !== id))}
          onSend={send}
          busy={busy}
          onStop={stop}
        />
        {status && (
          <div data-testid="canvas-status" className="pointer-events-none fixed bottom-[130px] left-1/2 z-[60] -translate-x-1/2 rounded-full border border-cv-edge bg-cv-card px-3 py-1 text-xs text-text-3 shadow-md">
            {status}
          </div>
        )}
      </div>
    </>
  );
}

function WorkspaceHeader({ doc, saving, reading, onToggleReading, undoDepth, onUndo }: {
  doc: CanvasDoc; saving: boolean; reading: boolean; onToggleReading(): void; undoDepth: number; onUndo(): void;
}) {
  return (
    <header className="flex flex-none items-center gap-2.5 border-b border-cv-divider bg-cv-ground px-7 py-3">
      <Frame size={16} aria-hidden className="text-sec-canvas" />
      <h1 data-testid="canvas-title" className="m-0 truncate text-base font-medium text-text">{doc.summary.title}</h1>
      <span className="font-mono text-xs text-text-3">
        {doc.summary.counts.threads} thread{doc.summary.counts.threads === 1 ? '' : 's'}
      </span>
      <span className="flex-1" />
      <button
        type="button" onClick={onUndo} disabled={undoDepth === 0} data-testid="canvas-undo"
        aria-label="Undo the last move or resize"
        className="flex items-center gap-1.5 rounded-md border border-rule-2 px-2 py-1 text-xs text-text-2 hover:text-text disabled:opacity-40"
      >
        <Undo2 size={12} aria-hidden /> Undo
      </button>
      <button
        type="button" onClick={onToggleReading} data-testid="canvas-reading-toggle"
        className="flex items-center gap-1.5 rounded-md border border-rule-2 px-2 py-1 text-xs text-text-2 hover:text-text"
      >
        {reading ? <Layers size={12} aria-hidden /> : <BookOpen size={12} aria-hidden />}
        {reading ? 'Canvas' : 'Read'}
      </button>
      <span data-testid="canvas-save-state" className="font-mono text-xs text-text-3">{saving ? 'Saving…' : 'Saved'}</span>
    </header>
  );
}

/** Loads the canvas, then hands it to the workspace. */
export function CanvasWorkspace({ canvasId }: { canvasId: string }) {
  const status = useCanvasDoc(s => s.status);
  const error = useCanvasDoc(s => s.error);
  const load = useCanvasDoc(s => s.load);

  useEffect(() => { void load(canvasId); }, [load, canvasId]);

  if (status === 'loading' || status === 'idle') {
    return <main data-testid="canvas-workspace" data-canvas={canvasId} className="flex-1 p-8 text-sm text-text-3">Loading canvas&hellip;</main>;
  }
  if (status === 'error') {
    return (
      <main data-testid="canvas-workspace" data-canvas={canvasId} className="flex-1 p-8">
        <div role="alert" className="max-w-[460px] rounded-lg border border-danger-border bg-danger-soft p-3 text-sm text-danger">
          This canvas could not be opened: {error}
        </div>
      </main>
    );
  }
  if (status === 'missing') {
    return (
      <main data-testid="canvas-workspace" data-canvas={canvasId} className="flex-1 p-8">
        <div className="max-w-[460px] text-sm text-text-2">
          <div className="mb-1 text-base font-medium text-text">This canvas is gone</div>
          It was deleted, or it was never on this device. Close the tab to tidy up.
        </div>
      </main>
    );
  }
  return (
    <main data-testid="canvas-workspace" data-canvas={canvasId} className="flex min-h-0 flex-1 flex-col bg-cv-ground">
      <ReactFlowProvider>
        <Workspace canvasId={canvasId} />
      </ReactFlowProvider>
    </main>
  );
}
