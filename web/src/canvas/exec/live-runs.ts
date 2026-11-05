import { create } from 'zustand';

interface CanvasRun {
  status: string | null;
  stop(): void;
}

/** Runtime only. Navigation and other threads must not replace a response's controller. */
export const useCanvasRuns = create<{ runs: Record<string, CanvasRun> }>(() => ({ runs: {} }));
export const canvasRunKey = (canvasId: string, threadId: string): string => `${canvasId}:${threadId}`;

export function startCanvasRun(canvasId: string, threadId: string) {
  const key = canvasRunKey(canvasId, threadId);
  if (useCanvasRuns.getState().runs[key]) return null;
  const cancellation = new AbortController();
  let controller: AbortController | null = null;
  const entry: CanvasRun = { status: null, stop: () => cancellation.abort() };
  cancellation.signal.addEventListener('abort', () => controller?.abort(), { once: true });
  useCanvasRuns.setState(s => ({ runs: { ...s.runs, [key]: entry } }));
  return {
    signal: cancellation.signal,
    register(next: AbortController): void {
      controller = next;
      if (cancellation.signal.aborted) next.abort();
    },
    setStatus(status: string | null): void {
      useCanvasRuns.setState(s => s.runs[key]?.stop === entry.stop
        ? { runs: { ...s.runs, [key]: { ...entry, status } } }
        : s);
    },
    finish(): void {
      useCanvasRuns.setState(s => {
        if (s.runs[key]?.stop !== entry.stop) return s;
        const runs = { ...s.runs };
        delete runs[key];
        return { runs };
      });
    },
  };
}
