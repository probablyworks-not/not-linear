// Spike only. The narrow-subscription pattern the plan prescribes: streamed text lives
// outside the React Flow node array, so a token does not change `nodes` and therefore
// cannot re-render the scene. Only the streaming node subscribes.
let text = '';
const listeners = new Set<() => void>();

export const streamStore = {
  subscribe(fn: () => void): () => void { listeners.add(fn); return () => listeners.delete(fn); },
  get(): string { return text; },
  append(chunk: string): void { text += chunk; listeners.forEach(fn => fn()); },
  reset(): void { text = ''; listeners.forEach(fn => fn()); },
};

/** Per-component render tallies, so the HUD can prove what re-rendered. */
export const renders = new Map<string, number>();
export function tally(key: string): number {
  const n = (renders.get(key) ?? 0) + 1;
  renders.set(key, n);
  return n;
}
export function totalNodeRenders(): number {
  let n = 0;
  for (const [k, v] of renders) if (k !== 'scene') n += v;
  return n;
}

/** First-paint stamp, written once from an effect and read by the HUD's tick (no setState in an effect). */
export const paint = { firstMs: 0 };
