import { beforeEach, describe, expect, it, vi } from 'vitest';

// A storage failure must be surfaced, never swallowed into "this project has no canvases"
// (docs/DESIGN.md: "never swallow an error — surface it in the UI where it happened"). Mocked at
// the repo boundary because a real quota or corruption failure cannot be provoked in fake-indexeddb.

vi.mock('../../src/canvas/canvas-repo', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/canvas/canvas-repo')>();
  return { ...actual, listCanvases: vi.fn() };
});

const { listCanvases } = await import('../../src/canvas/canvas-repo');
const { useCanvasStore, canvasesOf } = await import('../../src/canvas/canvas-store');

describe('a storage failure', () => {
  beforeEach(() => {
    useCanvasStore.setState({ byProject: {}, unassigned: [], loaded: {}, error: {} });
    vi.mocked(listCanvases).mockReset();
  });

  it('is reported on the project, not hidden as an empty list', async () => {
    vi.mocked(listCanvases).mockRejectedValue(new Error('QuotaExceededError'));
    await useCanvasStore.getState().load('p1');

    expect(useCanvasStore.getState().error['p1']).toBe('QuotaExceededError');
    expect(useCanvasStore.getState().loaded['p1']).toBe(true);
    expect(canvasesOf(useCanvasStore.getState(), 'p1')).toEqual([]);
  });

  it('clears once a later load succeeds', async () => {
    vi.mocked(listCanvases).mockRejectedValueOnce(new Error('boom'));
    await useCanvasStore.getState().load('p1');
    expect(useCanvasStore.getState().error['p1']).toBe('boom');

    vi.mocked(listCanvases).mockResolvedValue([]);
    await useCanvasStore.getState().load('p1');
    expect(useCanvasStore.getState().error['p1']).toBe('');
  });
});
