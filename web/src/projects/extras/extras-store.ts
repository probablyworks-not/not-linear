import { create } from 'zustand';
import { getProjectSources } from './sources';
import type { ProjectArtifact, ProjectMemoryItem } from './types';

// Flat, per-project caches of what the sources returned. `loaded` tells "still loading" from "really empty".

interface ExtrasState {
  artifacts: Record<string, ProjectArtifact[]>;
  memory: Record<string, ProjectMemoryItem[]>;
  loaded: Record<string, boolean>;
  error: Record<string, string>;
  load(pid: string): Promise<void>;
  removeMemory(pid: string, id: string): Promise<void>;
  removeArtifact(pid: string, id: string): Promise<void>;
}

export const useExtrasStore = create<ExtrasState>((set, get) => ({
  artifacts: {}, memory: {}, loaded: {}, error: {},

  async load(pid) {
    const src = getProjectSources();
    try {
      const [artifacts, memory] = await Promise.all([src.artifacts.list(pid), src.memory.list(pid)]);
      set(s => ({
        artifacts: { ...s.artifacts, [pid]: artifacts }, memory: { ...s.memory, [pid]: memory },
        loaded: { ...s.loaded, [pid]: true }, error: { ...s.error, [pid]: '' },
      }));
    } catch (err) {
      // Surface it: the cards show this instead of pretending the project has nothing.
      set(s => ({ loaded: { ...s.loaded, [pid]: true }, error: { ...s.error, [pid]: err instanceof Error ? err.message : String(err) } }));
    }
  },

  async removeMemory(pid, id) {
    await getProjectSources().memory.remove?.(pid, id);
    set(s => ({ memory: { ...s.memory, [pid]: (get().memory[pid] ?? []).filter(m => m.id !== id) } }));
  },

  async removeArtifact(pid, id) {
    await getProjectSources().artifacts.remove?.(id);
    set(s => ({ artifacts: { ...s.artifacts, [pid]: (get().artifacts[pid] ?? []).filter(a => a.id !== id) } }));
  },
}));
