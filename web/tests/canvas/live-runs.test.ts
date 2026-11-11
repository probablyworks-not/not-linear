import { afterEach, expect, it } from 'vitest';
import { canvasRunKey, startCanvasRun, useCanvasRuns } from '../../src/canvas/exec/live-runs';

afterEach(() => {
  Object.values(useCanvasRuns.getState().runs).forEach(r => r.stop());
  useCanvasRuns.setState({ runs: {} });
});

it('keeps concurrent threads and equal thread ids in different canvases independent', () => {
  const a = startCanvasRun('canvas-a', 'thread')!;
  const b = startCanvasRun('canvas-a', 'other')!;
  const c = startCanvasRun('canvas-b', 'thread')!;
  const ca = new AbortController(), cb = new AbortController();
  a.register(ca); b.register(cb);
  a.setStatus('Searching'); b.setStatus('Thinking');
  expect(startCanvasRun('canvas-a', 'thread')).toBeNull();
  useCanvasRuns.getState().runs[canvasRunKey('canvas-a', 'thread')]!.stop();
  expect(ca.signal.aborted).toBe(true);
  expect(cb.signal.aborted).toBe(false);
  expect(c.signal.aborted).toBe(false);
  a.finish();
  expect(useCanvasRuns.getState().runs[canvasRunKey('canvas-a', 'other')]!.status).toBe('Thinking');
  expect(Object.keys(useCanvasRuns.getState().runs)).toHaveLength(2);
});

it('cancels a late controller and ignores stale status/cleanup after the next turn starts', () => {
  const a = startCanvasRun('canvas', 'thread')!;
  useCanvasRuns.getState().runs[canvasRunKey('canvas', 'thread')]!.stop();
  const late = new AbortController(); a.register(late);
  expect(late.signal.aborted).toBe(true);
  a.finish();
  const next = startCanvasRun('canvas', 'thread')!; next.setStatus('New turn');
  a.setStatus('Stale'); a.finish();
  expect(useCanvasRuns.getState().runs[canvasRunKey('canvas', 'thread')]!.status).toBe('New turn');
});
