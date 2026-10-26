import { create } from 'zustand';
import {
  createCanvas, deleteCanvas, listAllCanvases, listCanvases, renameCanvas, setCanvasGlyph,
} from './canvas-repo';
import { duplicateCanvas } from './transfer';
import type { CanvasSummary } from './types';

// Flat, like the other feature stores. Holds summaries only — never a canvas document, which the
// workspace loads for itself. `loaded` tells "still loading" from "really empty", so the card can
// show an empty state that means something.

interface CanvasState {
  byProject: Record<string, CanvasSummary[]>;
  /** Canvases whose project was deleted. Kept reachable rather than orphaned (AC-17). */
  unassigned: CanvasSummary[];
  /** C12. Every canvas, across every project, most-recently-touched first — what the sidebar's
   * "Canvases" section reads. Loaded on demand rather than kept live, same as `byProject`. */
  all: CanvasSummary[];
  loaded: Record<string, boolean>;
  error: Record<string, string>;
  load(pid: string): Promise<void>;
  loadAll(): Promise<void>;
  /** `pid: null` files the canvas as unassigned — the sidebar's own "+" has no project open. */
  create(pid: string | null, title?: string): Promise<CanvasSummary | null>;
  rename(pid: string, id: string, title: string): Promise<void>;
  setGlyph(pid: string, id: string, token: string): Promise<void>;
  duplicate(pid: string, id: string): Promise<CanvasSummary | null>;
  remove(pid: string, id: string): Promise<void>;
}

const PROJECT_KEY = (pid: string | null): string => pid ?? '';

/** Shared, so a selector for a project with no canvases returns the SAME array every render.
 *  A fresh `[]` here makes useSyncExternalStore re-render forever. */
const NONE: readonly CanvasSummary[] = [];

export const useCanvasStore = create<CanvasState>((set, get) => ({
  byProject: {}, unassigned: [], all: [], loaded: {}, error: {},

  async loadAll() {
    set({ all: await listAllCanvases() });
  },

  async load(pid) {
    try {
      const [mine, orphans] = await Promise.all([listCanvases(pid), listCanvases(null)]);
      set(s => ({
        byProject: { ...s.byProject, [PROJECT_KEY(pid)]: mine },
        unassigned: orphans,
        loaded: { ...s.loaded, [pid]: true },
        error: { ...s.error, [pid]: '' },
      }));
    } catch (err) {
      // Surface it. A storage failure must not look like an empty project.
      set(s => ({ loaded: { ...s.loaded, [pid]: true }, error: { ...s.error, [pid]: err instanceof Error ? err.message : String(err) } }));
    }
  },

  async create(pid, title = 'Untitled canvas') {
    try {
      const doc = await createCanvas({ projectId: pid, title });
      // `load` is project-scoped; a null pid has no `byProject` bucket to refresh, just the
      // shared `unassigned` list (which `load(someOtherPid)` would also refetch as a side effect,
      // but there's no "other" project to scope that call to here).
      await Promise.all([
        pid !== null ? get().load(pid) : listCanvases(null).then(unassigned => set({ unassigned })),
        get().loadAll(),
      ]);
      return doc.summary;
    } catch (err) {
      set(s => ({ error: { ...s.error, [PROJECT_KEY(pid)]: err instanceof Error ? err.message : String(err) } }));
      return null;
    }
  },

  async rename(pid, id, title) {
    await renameCanvas(id, title);
    await Promise.all([get().load(pid), get().loadAll()]);
  },

  async setGlyph(pid, id, token) {
    await setCanvasGlyph(id, token);
    await Promise.all([get().load(pid), get().loadAll()]);
  },

  async duplicate(pid, id) {
    const doc = await duplicateCanvas(id);
    await Promise.all([get().load(pid), get().loadAll()]);
    return doc?.summary ?? null;
  },

  async remove(pid, id) {
    await deleteCanvas(id);
    await Promise.all([get().load(pid), get().loadAll()]);
  },
}));

export const canvasesOf = (s: CanvasState, pid: string): readonly CanvasSummary[] =>
  s.byProject[PROJECT_KEY(pid)] ?? NONE;

/** Every canvas in every project, most-recently-touched first. Kept here too for a caller that
 * wants it without the store (e.g. outside a React render). */
export const allCanvases = listAllCanvases;
