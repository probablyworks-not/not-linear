import { create } from 'zustand';
import type { BranchSpec } from '../db/branch-ops';

// Runtime state of the branch panels that are open right now: geometry and focus, nothing
// else. A branch's CONTENT is never held here; it lives in the thread row (its snapshot),
// written as it arrives, so closing a panel can never lose it (bugs #008/#009 were exactly
// content that lived only in a DOM about to be torn down). Flat, per CLAUDE.md.

export interface OpenBranch extends BranchSpec {
  threadId: string;
  collapsed: boolean;
  reader: boolean;
  /** Set once the user resizes or moves it; geometry is not persisted (legacy does not either). */
  userSized: boolean;
  width?: number;
  height?: number;
  top?: number;
  /** True for the first frame, so the CSS enter transition runs. */
  entering: boolean;
  /** Fading out; removed once the transition has played. */
  closing?: boolean;
}

interface BranchStore {
  open: Record<string, OpenBranch>;
  /** Insertion order, which layout uses as the tie-break between panels. */
  order: string[];
  activeId: string | null;
  /** Bumped to make a panel pulse (reopened, jumped to). `n` re-triggers the same id. */
  flash: { id: string; n: number } | null;
  put(b: OpenBranch): void;
  patch(id: string, patch: Partial<OpenBranch>): void;
  remove(id: string): void;
  setActive(id: string | null): void;
  flashPanel(id: string): void;
  clear(): void;
}

export const useBranchStore = create<BranchStore>((set) => ({
  open: {},
  order: [],
  activeId: null,
  flash: null,
  put: b => set(s => ({ open: { ...s.open, [b.id]: b }, order: s.order.includes(b.id) ? s.order : [...s.order, b.id] })),
  patch: (id, patch) => set(s => (s.open[id] ? { open: { ...s.open, [id]: { ...s.open[id]!, ...patch } } } : s)),
  remove: id => set(s => {
    if (!s.open[id]) return s;
    const rest = { ...s.open };
    delete rest[id];
    return { open: rest, order: s.order.filter(x => x !== id), activeId: s.activeId === id ? null : s.activeId };
  }),
  setActive: id => set({ activeId: id }),
  flashPanel: id => set(s => ({ flash: { id, n: (s.flash?.n ?? 0) + 1 } })),
  clear: () => set({ open: {}, order: [], activeId: null }),
}));

export function openList(): OpenBranch[] {
  const { open, order } = useBranchStore.getState();
  return order.map(id => open[id]).filter((b): b is OpenBranch => !!b);
}
