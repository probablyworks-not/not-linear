import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background, Controls, MiniMap, Panel, ReactFlow, ReactFlowProvider,
  applyNodeChanges, useReactFlow, useViewport,
  type Edge, type NodeChange, type Viewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { BookOpen, Frame, Layers, LayoutPanelTop, Undo2, Waypoints } from 'lucide-react';
import { ESC_PRIORITY, useEscLayer } from '../../lib/keyboard';
import { useCanvasDoc } from '../canvas-doc-store';
import {
  highlightsByMessage as highlightsByMessageFn, messageText, resolveAnchor, wholeHighlightsByThread, type TextHighlight,
} from '../anchors';
import { canvasContextBlock } from '../context/resolve';
import {
  branchFrom, continueThread, createRootThread, deleteOrphanSnapshot, freezeSelection, freezeWholeThread, setGeometry, synthesize,
} from '../domain/commands';
import { DEFAULT_LAYOUT_ID, type CanvasDoc, type CanvasPart, type SourceSnapshot, type ThreadKind } from '../types';
import { saveOutputVersion } from '../domain/commands';
import { saveOutputToArtifacts } from '../save-output';
import { toast } from '../../ui/toast';
import { useAppStore } from '../../state/app-store';
import { canvasTurnDeps, newSubmissionId, runCanvasTurn } from '../exec/run-canvas-turn';
import { HTML_REPLY_INSTRUCTIONS, wantsHtmlReply } from '../exec/html-trigger';
import { planModel } from '../../chat/models';
import { awaitAnswers, renderClarifyBlock, runClarify, shouldClarify } from '../../chat/clarify';
import { buildClarifyBrief } from '../../chat/clarify-brief';
import { getClarifyFirst } from '../../chat/clarify-pref';
import { createDebouncedWriter } from '../../lib/debounced-writer';
import { liveText } from './live-text';
import { ThreadNode, type ThreadNodeType } from './ThreadNode';
import { HighlightEdge } from './HighlightEdge';
import { useHighlightAnchors } from './useHighlightAnchors';
import { InkComposer, type ComposerTarget } from './InkComposer';
import { ReadingView } from './ReadingView';
import { OutputDetailView } from './OutputDetailView';
import { ContextIslandsPanel } from './ContextIslandsPanel';
import { useCanvasSelection } from './useCanvasSelection';
import { registerCanvasHandlers } from './canvas-bridge';
import { newId } from '../ids';
import { useAttachments } from '../../attachments/attachments-store';
import { flags } from '../../flags';
import { useChatStore } from '../../chat/chat-store';
import type { ChatMessage } from '../../providers/types';
import { selectForTurn } from '../../skills/skills-store';
import { renderSkillsBlock } from '../../skills/skills-prompt';

const NODE_W = 360, NODE_H = 300;
/** The active thread gets a wider card while it grows — a 360px column turns a long reply into
 * an absurdly tall, hard-to-read strip. */
const ACTIVE_W = 640;
/** A generated-HTML reply gets a fixed, comfortable reading width instead — like a document page,
 * not sized to the markup's own (often arbitrary) layout width. It still only ever grows tall to
 * fit its content (see `hasHtml` in the node builder below), never scrolling inside the card. */
const HTML_W = 880;
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
  const storeError = useCanvasDoc(s => s.error);
  const undoDepth = useCanvasDoc(s => s.undo.length);
  const apply = useCanvasDoc(s => s.apply);
  const applyGeometry = useCanvasDoc(s => s.applyGeometry);
  const beginGesture = useCanvasDoc(s => s.beginGesture);
  const undoGeometry = useCanvasDoc(s => s.undoGeometry);
  const setViewport = useCanvasDoc(s => s.setViewport);

  const [reading, setReading] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [detailMessageId, setDetailMessageId] = useState<string | null>(null);
  const [pickedSources, setPickedRaw] = useState<string[]>([]);
  // Every `setPicked` call in this component goes through here instead of `setPickedRaw`
  // directly: whatever drops out of the tray (an "x", Escape, a pane click, a fresh non-additive
  // pick replacing the old one) is garbage-collected via `deleteOrphanSnapshot` — a no-op for any
  // id a relation already cites (branched/synthesized from), so a used source is never touched.
  const setPicked = useCallback((next: string[] | ((prev: string[]) => string[])) => {
    setPickedRaw(prev => {
      const resolved = typeof next === 'function' ? next(prev) : next;
      const dropped = prev.filter(id => !resolved.includes(id));
      if (dropped.length) void apply(d => { for (const id of dropped) deleteOrphanSnapshot(d, id); });
      return resolved;
    });
  }, [apply]);
  // Where the composer should float when it opened from a text selection — the selection's own
  // rect is gone by the time the composer renders (addSelectionAsSource clears it), so this is
  // captured at the moment of picking and cleared whenever the picked sources empty out.
  //
  // A pick made inside the ReactFlow pane is stored in flow space (`pickFlowAnchor`) and
  // re-projected to screen space on every render via `flowToScreenPosition` below, so the composer
  // stays glued to the quote it came from as the user pans/zooms afterward — it used to cache the
  // screen rect once at pick time, which left it stranded wherever the viewport happened to be when
  // the user zoomed, rather than tracking the source (bug: composer drifting off-screen on zoom).
  // A pick made outside the pane (Reading View, Output Detail — screen-space overlays that never
  // pan/zoom) keeps the plain screen anchor instead, since there's no flow transform to project
  // through there.
  const [pickScreenAnchor, setPickScreenAnchor] = useState<{ x: number; y: number } | null>(null);
  const [pickFlowAnchor, setPickFlowAnchor] = useState<{ x: number; y: number } | null>(null);
  // Flow-space Y of the quote behind the pick, so the branched card can land level with the
  // text it came from instead of the source card's top (see `placeBeside`'s `besideY`). Screen
  // space, not flow space, is what the popover wants, which is why this is tracked separately.
  const [pickFlowY, setPickFlowY] = useState<number | null>(null);
  // Subscribing here (rather than just reading `rf.getViewport()`) is what makes this component
  // re-render continuously as the user pans/zooms, not just once the gesture ends.
  useViewport();
  const [targetThread, setTargetThread] = useState<string | null>(null);
  // C7. Default shows every connector at full opacity; toggled off, only the hovered/selected
  // thread's connectors stay bright so a dense canvas reads at a glance.
  const [linksVisible, setLinksVisible] = useState(true);
  const [hoverThreadId, setHoverThreadId] = useState<string | null>(null);
  const [gesture, setGestureActive] = useState(false);
  // Bumped by any source card's body resize, so highlight-anchored edges re-measure their mark.
  const [resizeTick, setResizeTick] = useState(0);
  const onBodyResize = useCallback(() => setResizeTick(t => t + 1), []);
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // The thread currently being sent to grows to fit its content and pulls the camera with it;
  // every other node keeps its fixed, scrollable card — except a thread holding a generated-HTML
  // reply, which auto-grows tall *and* wide permanently (see `hasHtml` in the node builder below):
  // that content is never meant to scroll inside its own card, and (unlike a plain markdown reply)
  // isn't forced into a fixed reading-column width either — it sizes to its own natural content on
  // both axes, clamped in `PartView.tsx`'s `HtmlFrame`. Size only ever grows within a session —
  // once a node settles (goes inactive) its grown size is persisted as the new floor.
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [autoSizes, setAutoSizes] = useState<Record<string, { width: number; height: number }>>({});
  const prevActiveRef = useRef<string | null>(null);
  // True once the user has panned/zoomed by hand this turn — stops the camera from following the
  // growing active node until the next send.
  const userFramedRef = useRef(false);
  const prefs = useAppStore(s => s.prefs);
  const projects = useAppStore(s => s.projects);
  const project = doc?.summary.projectId ? projects[doc.summary.projectId] : undefined;
  const rf = useReactFlow();
  const highlightAnchors = useHighlightAnchors(doc, resizeTick, rf);

  const partTextOf = useMemo(() => partTextLookup(doc), [doc]);
  const { selection, clear: clearSelection } = useCanvasSelection(partTextOf);

  // Reading mode is a dismissible surface, so it joins the Escape ladder rather than owning a key.
  useEscLayer('canvasReading', ESC_PRIORITY.canvasReading, reading, () => setReading(false));
  useEscLayer('canvasComposer', ESC_PRIORITY.canvasComposer, pickedSources.length > 0 || !!targetThread, () => {
    setPicked([]); setPickScreenAnchor(null); setPickFlowAnchor(null); setPickFlowY(null); setTargetThread(null); clearSelection();
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

  // Grows only (never shrinks) while a thread is auto-growing; recorded separately from persisted
  // geometry so a page reload always starts from the last settled, persisted size. Width only
  // actually moves anything for a `hasHtml` thread (see the node builder below) — for every other
  // thread it's tracked the same way but never read.
  const onContentSize = useCallback((threadId: string, size: { width: number; height: number }) => {
    const targetH = Math.max(NODE_H, size.height + 64 /* header + padding chrome */);
    const targetW = Math.max(NODE_W, size.width + 28 /* card side padding */);
    setAutoSizes(prev => {
      const cur = prev[threadId];
      if (cur && targetH <= cur.height && targetW <= cur.width) return prev;
      return { ...prev, [threadId]: { width: Math.max(targetW, cur?.width ?? 0), height: Math.max(targetH, cur?.height ?? 0) } };
    });
  }, []);

  // Where a newly-picked chip floats the composer and levels the branched card — same rect-based
  // placement `addSelectionAsSource` already does for a free-range quote, shared here so block and
  // whole-card picks land the same way.
  const placePick = useCallback((rect: { left: number; top: number; width: number; height: number }) => {
    setPickScreenAnchor(null);
    setPickFlowAnchor(rf.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top }));
    setPickFlowY(rf.screenToFlowPosition({ x: rect.left, y: rect.top + rect.height / 2 }).y);
  }, [rf]);

  // A block handle's click/drag-through — see `PartView.tsx`'s `BlockPickHandler`. A plain click
  // (`additive` false) replaces the tray with just this block, matching a fresh free-range pick;
  // Cmd/Ctrl (or any block after the first in a drag-through run) appends.
  const pickBlock = useCallback<NonNullable<ThreadNodeType['data']['onBlockPick']>>((messageId, partId, quote, additive, rect) => {
    const text = partTextOf(partId);
    const start = text ? text.indexOf(quote) : -1;
    if (start < 0) return;
    void apply(d => freezeSelection(d, messageId, partId, quote, start, { now: Date.now() })).then(made => {
      if (!made) return;
      setPicked(p => (additive ? [...p, made.id] : [made.id]));
      placePick(rect);
    });
  }, [partTextOf, apply, placePick, setPicked]);

  // The whole-card affordance in `ThreadNode`'s header — always replaces the tray, same as a fresh
  // block pick, since picking an entire card is a deliberate single choice rather than something
  // meant to compose silently with whatever was already picked.
  const pickWhole = useCallback((threadId: string, rect: { left: number; top: number; width: number; height: number }) => {
    void apply(d => freezeWholeThread(d, threadId, { now: Date.now() })).then(made => {
      if (!made) return;
      setPicked([made.id]);
      placePick(rect);
    });
  }, [apply, placePick, setPicked]);

  // Keyed by thread id: the last content signature built for that thread and the `data` object it
  // produced. A doc edit always hands us brand-new object references for everything (the document
  // round-trips through IndexedDB, which structured-clones the whole tree) — so without this, every
  // thread's `data` prop would get a new identity on every edit anywhere on the canvas, defeating
  // `ThreadNode`'s `memo()` and re-rendering (and re-parsing the markdown of) every card for a change
  // to just one of them. Reusing the previous `data` object when a thread's own content is unchanged
  // is what lets `memo()` actually skip the untouched cards.
  const [nodeDataCache] = useState(() => new Map<string, { sig: string; data: ThreadNodeType['data'] }>());

  const nodes = useMemo<ThreadNodeType[]>(() => {
    if (!doc) return [];
    const layout = doc.layouts.find(l => l.id === DEFAULT_LAYOUT_ID);
    // Every quote that was ever frozen as a branch/synthesis source, so the original text can show
    // the same mark the branched card's source chip does — otherwise there's no visible link
    // between a card and the exact words it came from (only the chip's label names it). Shared
    // with `ReadingView`/`OutputDetailView` (`anchors.ts`'s `highlightsByMessage`) so the same
    // quote is marked the same way wherever its source text is rendered.
    const allHighlights = highlightsByMessageFn(doc);
    const wholeHighlights = wholeHighlightsByThread(doc);
    const cache = nodeDataCache;
    const liveIds = new Set(doc.threads.map(t => t.id));
    for (const id of cache.keys()) if (!liveIds.has(id)) cache.delete(id);

    return doc.threads.map(thread => {
      const geo = layout?.entries[thread.id];
      const sources = doc.relations
        .filter(r => r.toThreadId === thread.id && r.snapshotId)
        .map(r => doc.snapshots.find(s => s.id === r.snapshotId))
        .filter((s): s is SourceSnapshot => !!s)
        .map(s => ({ id: s.id, label: s.label, status: resolveAnchor(s, doc).status, highlightTone: s.highlightTone }));
      const isActive = thread.id === activeThreadId;
      const autoSize = autoSizes[thread.id];
      const messages = doc.messages.filter(m => m.threadId === thread.id).sort((a, b) => a.seq - b.seq);
      // A generated-HTML reply is never meant to scroll inside its own card (see `ThreadNode`'s
      // own `hasHtml`) — the node stays as tall *and as wide* as its real content permanently, not
      // just while active, sized to what `HtmlFrame`'s bridge script actually measured
      // (`autoSize`), falling back to `HTML_W` only until the first report arrives.
      const hasHtml = messages.some(m => m.parts.some(p => p.kind === 'html'));
      // Grouped by part, not just message, so each PartView gets an already-stable, pre-filtered
      // array for its own part — filtering per-part at render time (the old `forPart`) produced a
      // fresh array reference on every render, defeating memoization downstream regardless of
      // whether the highlights actually changed. Narrowed to this thread's own messages out of the
      // whole-document map so each card's memoized `data` only changes when ITS highlights do.
      const highlightsByMessage: Record<string, Record<string, TextHighlight[]>> = {};
      for (const m of messages) {
        const hl = allHighlights[m.id];
        if (hl) highlightsByMessage[m.id] = hl;
      }

      const wholeTone = wholeHighlights[thread.id];

      // Cheap-relative-to-rendering content signature. Function props (onSaveOutput/onViewOutput/
      // onContentSize/onBodyResize/onBlockPick/onPickWhole) are already stable via useCallback/
      // useState setters, so they don't need to be part of it — JSON.stringify drops them
      // (functions aren't serializable).
      const sig = JSON.stringify([thread, messages, sources, highlightsByMessage, isActive, autoSize, wholeTone]);
      const cached = cache.get(thread.id);
      const data: ThreadNodeType['data'] = cached && cached.sig === sig ? cached.data : {
        thread,
        messages,
        sources,
        highlightsByMessage,
        onSaveOutput: (id: string) => { void onSaveOutput(id); },
        onViewOutput: setDetailMessageId,
        active: isActive,
        onContentSize,
        onBodyResize,
        onBlockPick: pickBlock,
        onPickWhole: pickWhole,
        wholeTone,
      };
      cache.set(thread.id, { sig, data });

      return {
        id: thread.id,
        type: 'thread' as const,
        position: { x: geo?.x ?? 0, y: geo?.y ?? 0 },
        width: hasHtml
          ? Math.max(autoSize?.width ?? 0, geo?.w ?? HTML_W)
          : isActive ? Math.max(geo?.w ?? NODE_W, ACTIVE_W) : (geo?.w ?? NODE_W),
        height: hasHtml
          ? Math.max(autoSize?.height ?? 0, geo?.h ?? NODE_H)
          : isActive && autoSize ? Math.max(autoSize.height, geo?.h ?? NODE_H) : (geo?.h ?? NODE_H),
        hidden: geo?.hidden,
        data,
      };
    });
  }, [doc, onSaveOutput, activeThreadId, autoSizes, onContentSize, onBodyResize, pickBlock, pickWhole, nodeDataCache]);

  const activeOrHovered = targetThread ?? hoverThreadId;
  const edges = useMemo<Edge[]>(() => {
    if (!doc) return [];
    return doc.relations
      .filter(r => r.fromThreadId !== r.toThreadId)
      .map(r => {
        const related = !!activeOrHovered && (r.fromThreadId === activeOrHovered || r.toThreadId === activeOrHovered);
        return {
          id: r.id, source: r.fromThreadId, target: r.toThreadId,
          type: 'highlight' as const,
          data: { anchor: r.snapshotId ? highlightAnchors.get(r.snapshotId) : undefined },
          className: r.kind === 'synthesis' ? 'nl-edge-synthesis' : 'nl-edge-branch',
          style: { opacity: linksVisible || related ? 1 : 0.25 },
        };
      });
  }, [doc, linksVisible, activeOrHovered, highlightAnchors]);

  const threadKindById = useMemo(() => {
    const m = new Map<string, ThreadKind>();
    doc?.threads.forEach(t => m.set(t.id, t.kind));
    return m;
  }, [doc]);
  const minimapNodeColor = useCallback((n: { id: string }): string => {
    const kind = threadKindById.get(n.id);
    return kind === 'branch' ? 'var(--cv-hl-blue)' : kind === 'synthesis' ? 'var(--cv-hl-green)' : 'var(--cv-edge)';
  }, [threadKindById]);

  const onNodesChange = useCallback((changes: NodeChange<ThreadNodeType>[]) => {
    // One undo entry per gesture, snapshotted at its START. Snapshotting on completion captures
    // the geometry that already changed, which makes undo a silent no-op — the C0 spike's defect.
    const starts = changes.some(c => (c.type === 'dimensions' && c.resizing === true) || (c.type === 'position' && c.dragging === true));
    const ends = changes.some(c => (c.type === 'dimensions' && c.resizing === false) || (c.type === 'position' && c.dragging === false));
    if (starts && !gesture) { setGestureActive(true); beginGesture('move'); }
    if (ends) setGestureActive(false);

    const next = applyNodeChanges(changes, nodes);

    // Only write when something actually moved. React Flow re-measures its nodes whenever they
    // change identity, so writing unconditionally here makes a loop: write → new document → new
    // nodes array → re-measure → write. The debounced writer then re-schedules forever, the write
    // never lands, and the header sits on "Saving…" over work that is not happening.
    const current = useCanvasDoc.getState().doc?.layouts.find(l => l.id === DEFAULT_LAYOUT_ID)?.entries ?? {};
    const moved = next.filter(n => {
      const was = current[n.id];
      return !was
        || was.x !== n.position.x || was.y !== n.position.y
        || was.w !== (n.width ?? NODE_W) || was.h !== (n.height ?? NODE_H);
    });
    if (moved.length === 0) return;

    applyGeometry(d => {
      for (const n of moved) {
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
    if (made) {
      setPicked(p => [...p, made.id]);
      const anchorPoint = { x: selection.rect.left + selection.rect.width / 2, y: selection.rect.top };
      // Reading View and the Output Detail overlay render the same content as a plain scrolling
      // panel, outside the ReactFlow pane entirely — a screen->flow conversion of a selection made
      // there doesn't land anywhere near the source card (it was mapping overlay screen pixels
      // through the canvas's pan/zoom transform as if the overlay WAS the canvas), which is what
      // sent branched cards to the top of the canvas regardless of where the quote actually was.
      // Same reasoning governs the anchor itself: only an in-pane pick can be tracked through
      // pan/zoom via the flow transform, so only it goes into `pickFlowAnchor`.
      if (selection.inCanvasPane) {
        setPickScreenAnchor(null);
        setPickFlowAnchor(rf.screenToFlowPosition(anchorPoint));
        setPickFlowY(rf.screenToFlowPosition({ x: selection.rect.left, y: selection.rect.top + selection.rect.height / 2 }).y);
      } else {
        setPickFlowAnchor(null);
        setPickScreenAnchor(anchorPoint);
        setPickFlowY(null);
      }
    }
    clearSelection();
  }, [selection, apply, clearSelection, rf, setPicked]);

  const pickAnchor = pickFlowAnchor ? rf.flowToScreenPosition(pickFlowAnchor) : pickScreenAnchor;
  const target = useMemo<ComposerTarget>(() => {
    if (snapshots.length >= 2) return { key: 'synthesis', label: `Combine ${snapshots.length} sources`, anchor: pickAnchor ?? undefined };
    if (snapshots.length === 1) return { key: 'new', label: 'Branch from the selected source', anchor: pickAnchor ?? undefined };
    if (targetThread) {
      const t = doc?.threads.find(x => x.id === targetThread);
      return { key: `thread:${targetThread}`, label: `Reply in ${t?.title ?? 'this thread'}` };
    }
    return { key: 'new', label: 'New question' };
  }, [snapshots.length, targetThread, doc, pickAnchor]);

  // C9. Scoped by target, not just canvas, so attaching a file to "ask about this source" never
  // leaks into the next unrelated question — same reasoning as the per-target draft (FR-05).
  const attachKey = useMemo(() => `canvas:${canvasId}:${target.key}`, [canvasId, target.key]);
  const files = useAttachments(s => s.files[attachKey]) ?? [];
  const skillsKey = useMemo(() => `canvas:${canvasId}:${target.key}`, [canvasId, target.key]);

  const send = useCallback(async (text: string, skills?: string[]) => {
    const now = Date.now();
    const files = useAttachments.getState().files[attachKey] ?? [];
    // The question is written first, and on its own: if the model never answers, the user still has
    // what they asked and where they asked it from.
    const threadId = await apply(d => {
      if (snapshots.length >= 2) return synthesize(d, { snapshotIds: snapshots.map(s => s.id), prompt: text, besideY: pickFlowY ?? undefined }, { now })?.thread.id ?? null;
      if (snapshots.length === 1) return branchFrom(d, { snapshotId: snapshots[0]!.id, prompt: text, besideY: pickFlowY ?? undefined }, { now })?.thread.id ?? null;
      if (targetThread) { continueThread(d, targetThread, text, { now }); return targetThread; }
      return createRootThread(d, text, { now }, text.slice(0, 48)).thread.id;
    });
    setPicked([]);
    setPickScreenAnchor(null);
    setPickFlowAnchor(null);
    setPickFlowY(null);
    setTargetThread(null);
    if (!threadId) return;

    // C9. The attachments ride on the question that was just written, purely for display and
    // disclosure on the canvas itself — Canvas has no asset store yet (C5), so `assetId` is empty
    // and nothing ever dereferences it. The real bytes reach the model separately, below.
    if (files.length) {
      await apply(d => {
        const msgs = d.messages.filter(m => m.threadId === threadId && m.author.kind === 'human');
        const last = msgs[msgs.length - 1];
        if (!last) return;
        for (const f of files) {
          last.parts.push({ id: newId('pt'), state: 'ready', kind: 'attachment', assetId: '', name: f.name, mime: f.type, bytes: f.size });
        }
      });
      useAttachments.getState().clear(attachKey);
    }

    setActiveThreadId(threadId);
    userFramedRef.current = false;
    setBusy(true);
    setSendError('');
    const projectId = useCanvasDoc.getState().doc?.summary.projectId;
    // Branch replies are a scoped follow-up on a highlighted quote — default to brief. HTML
    // rendering is opt-in only, from an explicit phrase in the prompt, never inferred.
    const thread = useCanvasDoc.getState().doc?.threads.find(t => t.id === threadId);
    const isBranch = thread?.kind === 'branch';
    const wantsHtml = wantsHtmlReply(text);
    // C10. Memory and Files are whole-canvas context, not per-thread — folded in here rather than
    // through resolveContext's per-message loop. canvasContextBlock() is the exact same read the
    // Context Islands panel renders, so "included" there can never drift from what was sent.
    const canvasContext = doc ? canvasContextBlock(doc) : '';
    // P7 skills, same seam chat/Notes use: a pure selection, folded into extraContext, with the
    // picks recorded for SkillsUsedLine (shared, in-memory `useChatStore` map — no persistence).
    const threadMsgs = useCanvasDoc.getState().doc?.messages.filter(m => m.threadId === threadId) ?? [];
    const lastModelMsg = [...threadMsgs].reverse().find(m => m.author.kind === 'model');
    const picked = flags.skills ? await selectForTurn(text, lastModelMsg ? messageText(lastModelMsg) : '', skills) : [];
    if (flags.skills) useChatStore.getState().setSkillsUsed(skillsKey, picked.map(p => ({ name: p.skill.name, reason: p.reason, score: p.score })));

    // Questions before answers: same "clarify intent first" pre-flight chat runs
    // (run-and-persist.ts), ported here since canvas calls runTurn directly and skips it
    // otherwise. The pre-flight's own AbortController lives in abortRef so Stop cancels it too;
    // runCanvasTurn below installs its own controller once the real turn starts.
    let clarifiedBlock = '';
    const clarifyPlan = planModel(prefs.model as string | undefined, !!prefs.thinking);
    if (clarifyPlan.supported && shouldClarify({ enabled: flags.clarify && getClarifyFirst(), userText: text, alreadyClarified: false })) {
      const clarifyController = new AbortController();
      abortRef.current = clarifyController;
      setStatus('Understanding your request…');
      // threadMsgs' last entry is the user message just written for this send — clarify.ts takes
      // that separately as `userText`, so history is everything before it.
      const history: ChatMessage[] = threadMsgs
        .slice(0, -1)
        .map(m => ({ role: m.author.kind === 'model' ? 'assistant' : 'user', content: messageText(m) }));
      // Same digest chat/branch sends build (clarify-brief.ts) — without it, the clarify pre-pass
      // is blind to the highlighted passage this branch/synthesis was opened from and asks what
      // "this" refers to instead of assuming it, same as a chat branch would. Covers both a fresh
      // branch/synthesis (snapshots, just picked) and a follow-up inside an existing thread (its
      // own frozen sources, via doc.relations — snapshots is empty there since picks were cleared).
      const threadQuote = (useCanvasDoc.getState().doc?.relations ?? [])
        .filter(r => r.toThreadId === threadId && r.snapshotId)
        .map(r => useCanvasDoc.getState().doc?.snapshots.find(s => s.id === r.snapshotId))
        .filter((s): s is SourceSnapshot => !!s)
        .map(s => s.content);
      const quote = (snapshots.length ? snapshots.map(s => s.content) : threadQuote).join('\n\n');
      const brief = buildClarifyBrief({ project, quote });
      const questions = await runClarify(
        { plan: clarifyPlan, userText: text, history, ...(brief ? { brief } : {}), signal: clarifyController.signal },
        canvasTurnDeps(),
      );
      if (!clarifyController.signal.aborted && questions.length) {
        useChatStore.getState().setLive(threadId, {
          turnId: threadId, userText: text, text: '', thinking: '', status: null, clarify: questions,
        });
        const answers = await awaitAnswers(threadId, clarifyController.signal);
        useChatStore.getState().setLive(threadId, undefined);
        clarifiedBlock = renderClarifyBlock(answers ?? []);
      }
      setStatus(null);
      if (clarifyController.signal.aborted) {
        setBusy(false);
        abortRef.current = null;
        setActiveThreadId(null);
        return;
      }
    }

    const extraContext = [
      wantsHtml ? HTML_REPLY_INSTRUCTIONS : '',
      isBranch
        ? 'This is a branch reply to a scoped follow-up question on a highlighted quote. Default to the shortest answer that fully answers it — 1-3 sentences for a definitional or clarifying question ("what does this mean", "why"). Only write multiple paragraphs, a list, or sections if the question itself explicitly asks for elaboration, a how-to, or a comparison.'
        : '',
      renderSkillsBlock(picked),
      canvasContext,
      clarifiedBlock,
    ].filter(Boolean).join('\n\n');
    try {
      const result = await runCanvasTurn(
        {
          threadId,
          submissionId: newSubmissionId(),
          modelPref: prefs.model as string | undefined,
          prefs,
          wantsHtml,
          ...(extraContext ? { extraContext } : {}),
          ...(projectId && projects[projectId] ? { project: projects[projectId] } : {}),
          ...(files.length ? { attachments: files } : {}),
        },
        {
          apply: fn => useCanvasDoc.getState().apply(fn),
          onDelta: (messageId, soFar) => {
            // An HTML reply streams its raw tags/CSS as text underneath — showing that live would
            // balloon the node's measured content height (it's markup, not prose), which drags the
            // "grow the active node to fit" + fitView camera logic into zooming out to fit a box
            // that's about to shrink back to the fixed-height iframe the instant it settles. Show a
            // small constant placeholder instead; `soFar` still reaches the document untouched below,
            // so settle() and refresh-recovery both still see the real accumulated text.
            liveText.set(messageId, wantsHtml ? 'Generating the HTML document…' : soFar);
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
      // A run can end badly without throwing. Say so here too, not only on the card, because the
      // card may be off-screen.
      if (result.error) setSendError(result.error);
    } catch (e) {
      // Never swallow. Before this, a throw here vanished into an unhandled rejection and the
      // canvas simply sat there — which is indistinguishable from the app being broken.
      setSendError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setStatus(null);
      abortRef.current = null;
      setActiveThreadId(null);
    }
  }, [apply, snapshots, targetThread, prefs, projects, project, attachKey, doc, pickFlowY, skillsKey, setPicked]);

  // A thread's grown height/width are only a floor once it settles (goes inactive) — persisted
  // the same way drag/resize geometry is, on gesture end rather than on every delta. Read the
  // target size directly rather than off `nodes`: by the time this runs, `nodes` has already
  // recomputed with isActive=false for prevId, which would read back the narrow, pre-grow width.
  useEffect(() => {
    const prevId = prevActiveRef.current;
    if (prevId && prevId !== activeThreadId) {
      const auto = autoSizes[prevId];
      const n = nodes.find(x => x.id === prevId);
      const docNow = useCanvasDoc.getState().doc;
      const current = docNow?.layouts.find(l => l.id === DEFAULT_LAYOUT_ID)?.entries[prevId];
      // A generated-HTML reply keeps its content-measured width (`auto.width`, falling back to
      // `HTML_W` before the first bridge report) rather than the `ACTIVE_W` floor other replies
      // get while streaming — persisting `ACTIVE_W` here would otherwise overwrite it the first
      // time the thread settles.
      const hasHtml = docNow?.messages.some(m => m.threadId === prevId && m.parts.some(p => p.kind === 'html')) ?? false;
      const w = hasHtml ? Math.max(auto?.width ?? 0, current?.w ?? HTML_W) : Math.max(current?.w ?? NODE_W, ACTIVE_W);
      const h = auto?.height;
      if (n && ((h && h > (current?.h ?? NODE_H)) || w > (current?.w ?? NODE_W))) {
        applyGeometry(d => setGeometry(d, prevId, {
          x: n.position.x, y: n.position.y, w, h: Math.max(h ?? 0, current?.h ?? NODE_H),
        }));
      }
    }
    prevActiveRef.current = activeThreadId;
  }, [activeThreadId, autoSizes, nodes, applyGeometry]);

  // Frames the active node once, when it starts streaming, and again only if it has since grown
  // past the edge of the current view — not on every token. A user who pans or zooms by hand
  // (onMoveStart fires with a real event, never with one of our own fitView calls) keeps control
  // for the rest of this turn: the camera stops following until the next send.
  const onMoveStart = useCallback((event: unknown) => { if (event) userFramedRef.current = true; }, []);
  useEffect(() => {
    if (!activeThreadId || userFramedRef.current) return;
    const n = nodes.find(x => x.id === activeThreadId);
    if (!n) return;
    const vp = rf.getViewport();
    const bounds = document.querySelector('.react-flow')?.getBoundingClientRect();
    const nodeBottomScreen = (n.position.y + (n.height ?? NODE_H)) * vp.zoom + vp.y;
    const fits = bounds ? nodeBottomScreen <= bounds.height - 16 : false;
    if (fits) return;
    const raf = requestAnimationFrame(() => {
      if (userFramedRef.current) return;
      rf.fitView({ nodes: [{ id: activeThreadId }], padding: 0.15, duration: 350, maxZoom: 1 });
    });
    return () => cancelAnimationFrame(raf);
  }, [activeThreadId, autoSizes, nodes, rf]);

  // Stop is best effort: it cannot reverse work the provider has already done, and whatever text
  // arrived stays on the card.
  const stop = useCallback(() => { abortRef.current?.abort(); }, []);

  const showOnCanvas = useCallback((threadId: string) => {
    setReading(false);
    const n = nodes.find(x => x.id === threadId);
    if (n) rf.setCenter(n.position.x + (n.width ?? NODE_W) / 2, n.position.y + (n.height ?? NODE_H) / 2, { zoom: 1, duration: 200 });
  }, [nodes, rf]);

  // The canvas search palette (UI-08) is mounted as AppShell's sibling, not this tree's descendant,
  // so it reaches the open workspace through this registration rather than a prop.
  useEffect(() => registerCanvasHandlers(canvasId, {
    focusThread: showOnCanvas,
    openOutputDetail: setDetailMessageId,
  }), [canvasId, showOnCanvas]);

  // Restore the saved viewport once, when it arrives. A ref, not state: this records that an
  // external system (React Flow's viewport) has been told something, and re-rendering for it
  // would be a cascading render.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || !view || !doc) return;
    restored.current = true;
    rf.setViewport(view.viewport);
  }, [view, doc, rf]);

  // Figma-style camera shortcuts: Shift+1 fits all threads, Shift+0 resets to 100%. Skipped while
  // typing so they don't hijack a literal "1"/"0" in the composer or a title field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target;
      if (t instanceof HTMLElement && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (e.key === '1') { e.preventDefault(); rf.fitView({ padding: 0.15, duration: 200 }); }
      else if (e.key === '0') { e.preventDefault(); rf.setViewport({ ...rf.getViewport(), zoom: 1 }, { duration: 200 }); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [rf]);

  const nodeTypes = useMemo(() => ({ thread: ThreadNode }), []);
  const edgeTypes = useMemo(() => ({ highlight: HighlightEdge }), []);
  if (!doc) return null;

  if (reading) {
    return (
      <>
        <WorkspaceHeader
          doc={doc} saving={saving} reading onToggleReading={() => setReading(false)} undoDepth={undoDepth} onUndo={undoGeometry}
          onToggleContext={() => setContextOpen(v => !v)}
        />
        <ReadingView doc={doc} onBack={() => setReading(false)} onShowOnCanvas={showOnCanvas} />
        {detailMessageId && (
          <OutputDetailView
            doc={doc} messageId={detailMessageId} onClose={() => setDetailMessageId(null)}
            onSaveOutput={id => { void onSaveOutput(id); }}
          />
        )}
        {contextOpen && (
          <ContextIslandsPanel
            canvasId={canvasId} doc={doc} project={project} apply={apply}
            onViewOutput={setDetailMessageId} onClose={() => setContextOpen(false)}
          />
        )}
      </>
    );
  }

  return (
    <>
      <WorkspaceHeader
        doc={doc} saving={saving} reading={false} onToggleReading={() => setReading(true)} undoDepth={undoDepth} onUndo={undoGeometry}
        onToggleContext={() => setContextOpen(v => !v)}
      />
      <div className="relative min-h-0 flex-1">
        {/*
          React Flow's wrapper forces `height: 100%` inline and that percentage never resolves
          against a flex item's flex-grown size (the flex item's `height` CSS value stays `auto`
          even though its laid-out box is definite — the parent here measures correctly, but a
          percentage-height child of an auto-height box has nothing to resolve against, so it
          collapses to 0 and every node/control silently fails to paint). An absolutely positioned
          wrapper sizes against the ancestor's actual layout box instead of its `height` value, so
          nest React Flow in one.
        */}
        <div className="absolute inset-0">
          <ReactFlow<ThreadNodeType>
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onNodeClick={(_, n) => setTargetThread(n.id)}
            onPaneClick={() => { setTargetThread(null); setPicked([]); setPickScreenAnchor(null); setPickFlowAnchor(null); setPickFlowY(null); }}
            onNodeMouseEnter={(_, n) => setHoverThreadId(n.id)}
            onNodeMouseLeave={() => setHoverThreadId(null)}
            onMoveStart={onMoveStart}
            onMoveEnd={(_, v: Viewport) => setViewport(v)}
            minZoom={MIN_ZOOM}
            maxZoom={MAX_ZOOM}
            panOnScroll
            zoomOnPinch
            zoomOnScroll={false}
            zoomOnDoubleClick={false}
            nodesFocusable
            selectionKeyCode="Shift"
            deleteKeyCode={null}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={26} />
            <Controls showInteractive={false} />
            <MiniMap
              pannable zoomable ariaLabel="Canvas minimap" style={{ width: 200, height: 120 }}
              nodeColor={minimapNodeColor} nodeStrokeColor={minimapNodeColor}
            />
            <Panel position="bottom-left">
              <button
                type="button" data-testid="canvas-links-toggle" aria-pressed={linksVisible}
                onClick={() => setLinksVisible(v => !v)}
                title={linksVisible ? 'Dim connectors except the hovered or selected thread' : 'Show every connector at full brightness'}
                className={`flex items-center gap-1.5 rounded-md border border-cv-edge px-2 py-1 font-mono text-xs ${
                  linksVisible ? 'bg-cv-card text-text-2' : 'bg-cv-card-inset text-text'}`}
              >
                <Waypoints size={12} aria-hidden /> Links
              </button>
            </Panel>
          </ReactFlow>
        </div>

        {selection && selection.start >= 0 && selection.rect.width + selection.rect.height > 0 && (
          <div
            data-testid="canvas-selection-popover"
            className="fixed z-[70] -translate-x-1/2 rounded-full bg-ask px-1 py-1 text-ask-fg shadow-lg"
            style={{
              left: selection.rect.left + selection.rect.width / 2,
              // Prefer floating above the selection; when there isn't room (near the top of a
              // card, or the top of the viewport), render below it instead of clamping to a fixed
              // y that ends up overlapping whatever text sits above the selection.
              top: selection.rect.top - 40 >= 8 ? selection.rect.top - 40 : selection.rect.top + selection.rect.height + 8,
            }}
          >
            <button
              type="button" data-testid="add-source"
              onClick={() => { void addSelectionAsSource(); }}
              className="rounded-full px-2.5 py-1 text-xs text-ask-fg-soft hover:bg-ask-chip hover:text-ask-fg"
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
          onRemoveSource={id => {
            if (pickedSources.length <= 1) { setPickScreenAnchor(null); setPickFlowAnchor(null); setPickFlowY(null); }
            setPicked(p => p.filter(x => x !== id));
          }}
          onSend={send}
          busy={busy}
          onStop={stop}
          attachKey={attachKey}
          files={files}
          skillsKey={skillsKey}
        />
        {(sendError || storeError) && (
          <div
            role="alert" data-testid="canvas-error"
            className="fixed inset-x-0 bottom-[150px] z-[60] mx-auto w-[min(560px,calc(100vw-32px))] rounded-lg border border-danger-border bg-danger-soft px-3 py-2 text-sm text-danger shadow-lg"
          >
            {sendError || storeError}
          </div>
        )}
        {status && (
          <div data-testid="canvas-status" className="pointer-events-none fixed bottom-[130px] left-1/2 z-[60] -translate-x-1/2 rounded-full border border-cv-edge bg-cv-card px-3 py-1 text-xs text-text-3 shadow-md">
            {status}
          </div>
        )}
      </div>
      {detailMessageId && (
        <OutputDetailView
          doc={doc} messageId={detailMessageId} onClose={() => setDetailMessageId(null)}
          onSaveOutput={id => { void onSaveOutput(id); }}
        />
      )}
      {contextOpen && (
        <ContextIslandsPanel
          canvasId={canvasId} doc={doc} project={project} apply={apply}
          onViewOutput={setDetailMessageId} onClose={() => setContextOpen(false)}
        />
      )}
    </>
  );
}

function WorkspaceHeader({ doc, saving, reading, onToggleReading, undoDepth, onUndo, onToggleContext }: {
  doc: CanvasDoc; saving: boolean; reading: boolean; onToggleReading(): void; undoDepth: number; onUndo(): void;
  onToggleContext(): void;
}) {
  return (
    // `relative z-40`: the AppShell tab-strip/breadcrumb bar is a `fixed z-30` sibling that slides
    // in whenever the pointer is within 36px of the window top (`useEdgeReveal`) — which is
    // exactly where this header's own Undo/Context/Read buttons sit. Without a higher stacking
    // context here, clicking any of them reveals that bar on top of this one, and because both
    // occupy the same screen position it looks like the canvas's own toolbar vanished.
    <header className="relative z-40 flex flex-none items-center gap-2.5 border-b border-cv-divider bg-cv-ground px-7 py-3">
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
        type="button" onClick={onToggleContext} data-testid="canvas-context-toggle"
        className="flex items-center gap-1.5 rounded-md border border-rule-2 px-2 py-1 text-xs text-text-2 hover:text-text"
      >
        <LayoutPanelTop size={12} aria-hidden /> Context
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
