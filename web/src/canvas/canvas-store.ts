import { create } from 'zustand';
import {
  createCanvas, deleteCanvas, listAllCanvases, listCanvases, renameCanvas,
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
  loaded: Record<string, boolean>;
  error: Record<string, string>;
  load(pid: string): Promise<void>;
  create(pid: string, title?: string): Promise<CanvasSummary | null>;
  rename(pid: string, id: string, title: string): Promise<void>;
  duplicate(pid: string, id: string): Promise<CanvasSummary | null>;
  remove(pid: string, id: string): Promise<void>;
}

const PROJECT_KEY = (pid: string | null): string => pid ?? '';

/** Shared, so a selector for a project with no canvases returns the SAME array every render.
 *  A fresh `[]` here makes useSyncExternalStore re-render forever. */
const NONE: readonly CanvasSummary[] = [];

export const useCanvasStore = create<CanvasState>((set, get) => ({
  byProject: {}, unassigned: [], loaded: {}, error: {},

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
      await get().load(pid);
      return doc.summary;
    } catch (err) {
      set(s => ({ error: { ...s.error, [pid]: err instanceof Error ? err.message : String(err) } }));
      return null;
    }
  },

  async rename(pid, id, title) {
    await renameCanvas(id, title);
    await get().load(pid);
  },

  async duplicate(pid, id) {
    const doc = await duplicateCanvas(id);
    await get().load(pid);
    return doc?.summary ?? null;
  },

  async remove(pid, id) {
    await deleteCanvas(id);
    await get().load(pid);
  },
}));

export const canvasesOf = (s: CanvasState, pid: string): readonly CanvasSummary[] =>
  s.byProject[PROJECT_KEY(pid)] ?? NONE;

/** Every canvas in every project; what a future global listing would read. */
export const allCanvases = listAllCanvases;
