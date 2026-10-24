import { create } from 'zustand';
import { createDebouncedWriter } from '../lib/debounced-writer';
import { getCanvas, getViewState, putViewState, updateCanvas } from './canvas-repo';
import type { CanvasDoc, CanvasViewState } from './types';

// The open canvas. One document at a time — a canvas tab is a workspace, and two of them are two
// tabs, each with its own mount.
//
// Writes are split by what they are. Geometry (drag, resize, pan) is coalesced, because a drag is
// hundreds of frames and none of them is worth a transaction. Content (a new thread, a message, a
// frozen source) flushes immediately, because losing it is losing work. That split is the whole
// reason `layouts` and the content collections are separate in the schema.

const GEOMETRY_DEBOUNCE_MS = 400;
const VIEWPORT_DEBOUNCE_MS = 500;

const geometryWriter = createDebouncedWriter<string>(GEOMETRY_DEBOUNCE_MS);
const viewportWriter = createDebouncedWriter<string>(VIEWPORT_DEBOUNCE_MS);

export interface Snapshot { layouts: CanvasDoc['layouts']; label: string }

interface DocState {
  canvasId: string | null;
  doc: CanvasDoc | null;
  view: CanvasViewState | null;
  status: 'idle' | 'loading' | 'ready' | 'missing' | 'error';
  error: string;
  /** Geometry history only. Content undo is a separate, later problem. */
  undo: Snapshot[];
  /** True between a change and its write landing; the header shows it. */
  saving: boolean;

  load(canvasId: string): Promise<void>;
  /** Content change: applied in memory and written immediately. */
  apply<T>(fn: (doc: CanvasDoc) => T): Promise<T | null>;
  /** Geometry change: applied in memory, written on a debounce. */
  applyGeometry(fn: (doc: CanvasDoc) => void): void;
  /** Call once at the start of a drag or resize, never per frame (bug the C0 spike found). */
  beginGesture(label: string): void;
  undoGeometry(): void;
  setViewport(v: CanvasViewState['viewport']): void;
}

const UNDO_LIMIT = 50;

export const useCanvasDoc = create<DocState>((set, get) => ({
  canvasId: null, doc: null, view: null, status: 'idle', error: '', undo: [], saving: false,

  async load(canvasId) {
    set({ canvasId, status: 'loading', doc: null, view: null, undo: [], error: '' });
    try {
      const [doc, view] = await Promise.all([getCanvas(canvasId), getViewState(canvasId)]);
      // A different canvas may have been opened while this was in flight.
      if (get().canvasId !== canvasId) return;
      set(doc ? { doc, view, status: 'ready' } : { status: 'missing' });
    } catch (err) {
      if (get().canvasId !== canvasId) return;
      set({ status: 'error', error: err instanceof Error ? err.message : String(err) });
    }
  },

  async apply(fn) {
    const { canvasId, doc } = get();
    if (!canvasId || !doc) return null;
    let out: unknown;
    set({ saving: true });
    try {
      const { doc: saved } = await updateCanvas(canvasId, d => { out = fn(d); });
      if (get().canvasId === canvasId) set({ doc: saved, saving: false });
    } catch (err) {
      set({ saving: false, error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
    return out as never;
  },

  applyGeometry(fn) {
    const { canvasId, doc } = get();
    if (!canvasId || !doc) return;
    // Apply to a copy so React sees a new reference, then coalesce the write.
    const next: CanvasDoc = { ...doc, layouts: doc.layouts.map(l => ({ ...l, entries: { ...l.entries } })) };
    fn(next);
    set({ doc: next, saving: true });
    geometryWriter.schedule(canvasId, () => {
      const latest = get().doc;
      if (!latest || get().canvasId !== canvasId) return;
      void updateCanvas(canvasId, d => { d.layouts = latest.layouts; })
        .then(() => { if (get().canvasId === canvasId) set({ saving: false }); })
        .catch((e: unknown) => set({ saving: false, error: e instanceof Error ? e.message : String(e) }));
    });
  },

  beginGesture(label) {
    const doc = get().doc;
    if (!doc) return;
    const snap: Snapshot = { layouts: doc.layouts.map(l => ({ ...l, entries: { ...l.entries } })), label };
    set(s => ({ undo: [...s.undo, snap].slice(-UNDO_LIMIT) }));
  },

  undoGeometry() {
    const { undo, canvasId, doc } = get();
    const last = undo[undo.length - 1];
    if (!last || !doc || !canvasId) return;
    set({ doc: { ...doc, layouts: last.layouts }, undo: undo.slice(0, -1), saving: true });
    geometryWriter.schedule(canvasId, () => {
      void updateCanvas(canvasId, d => { d.layouts = last.layouts; })
        .then(() => set({ saving: false }))
        .catch(() => set({ saving: false }));
    });
  },

  setViewport(viewport) {
    const { canvasId } = get();
    if (!canvasId) return;
    const view: CanvasViewState = { ...(get().view ?? { updatedAt: 0 }), viewport, updatedAt: Date.now() };
    set({ view });
    viewportWriter.schedule(canvasId, () => { void putViewState(canvasId, view); });
  },
}));

/** Flush any pending geometry before the tab goes away. Never the only path to a write. */
export async function flushCanvasWrites(): Promise<void> {
  await Promise.all([geometryWriter.flushAll(), viewportWriter.flushAll()]);
}

/** Tests only: drop pending writes so one test's debounce cannot fire against the next one's db. */
export function cancelCanvasWritesForTests(canvasId: string): void {
  geometryWriter.cancel(canvasId);
  viewportWriter.cancel(canvasId);
}
