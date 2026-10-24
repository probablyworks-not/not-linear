import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cancelCanvasWritesForTests, flushCanvasWrites, useCanvasDoc } from '../../src/canvas/canvas-doc-store';
import { createCanvas, getCanvas, getViewState, resetCanvasDbForTests } from '../../src/canvas/canvas-repo';
import { createRootThread, setGeometry } from '../../src/canvas/domain/commands';

// The workspace's write policy, which is the reason `layouts` is a separate collection: geometry
// is coalesced because a drag is hundreds of frames, content flushes immediately because losing it
// is losing work.

const freshStore = (): void => {
  // A pending debounce from the previous test would fire against the next test's database.
  const prev = useCanvasDoc.getState().canvasId;
  if (prev) cancelCanvasWritesForTests(prev);
  useCanvasDoc.setState({ canvasId: null, doc: null, view: null, status: 'idle', error: '', undo: [], pendingWrites: 0, geometryPending: false, saving: false });
};

async function openCanvas(): Promise<string> {
  const c = await createCanvas({ projectId: 'p1', title: 'T' });
  await useCanvasDoc.getState().load(c.summary.id);
  return c.summary.id;
}

afterEach(async () => { await flushCanvasWrites(); });

describe('the open canvas document', () => {
  beforeEach(() => { resetCanvasDbForTests(`canvas-${Math.random()}`); freshStore(); });

  it('loads a canvas, and reports a missing one rather than throwing', async () => {
    const id = await openCanvas();
    expect(useCanvasDoc.getState().status).toBe('ready');
    expect(useCanvasDoc.getState().doc?.summary.id).toBe(id);

    freshStore();
    await useCanvasDoc.getState().load('cv_nope');
    expect(useCanvasDoc.getState().status).toBe('missing');
  });

  it('writes a content change through immediately', async () => {
    const id = await openCanvas();
    await useCanvasDoc.getState().apply(d => createRootThread(d, 'a question', { now: 1 }));
    // straight from the database, not from the store's copy
    expect((await getCanvas(id))!.threads).toHaveLength(1);
    expect(useCanvasDoc.getState().saving).toBe(false);
  });

  it('coalesces geometry: the in-memory doc moves at once, the database waits', async () => {
    const id = await openCanvas();
    await useCanvasDoc.getState().apply(d => createRootThread(d, 'q', { now: 1 }));
    const threadId = useCanvasDoc.getState().doc!.threads[0]!.id;

    for (let x = 0; x < 20; x++) {
      useCanvasDoc.getState().applyGeometry(d => setGeometry(d, threadId, { x, y: x * 2 }));
    }
    // the UI already sees the last frame...
    expect(useCanvasDoc.getState().doc!.layouts[0]!.entries[threadId]).toMatchObject({ x: 19, y: 38 });
    // ...while the database still has none of the twenty, because the write is still pending
    expect((await getCanvas(id))!.layouts[0]!.entries[threadId]?.x ?? 0).toBe(0);

    await flushCanvasWrites();
    // one write, carrying the last frame
    expect((await getCanvas(id))!.layouts[0]!.entries[threadId]).toMatchObject({ x: 19, y: 38 });
  });

  it('a drag does not change a message, a snapshot or a relation', async () => {
    await openCanvas();
    await useCanvasDoc.getState().apply(d => createRootThread(d, 'q', { now: 1 }));
    const before = JSON.stringify({
      m: useCanvasDoc.getState().doc!.messages,
      s: useCanvasDoc.getState().doc!.snapshots,
      r: useCanvasDoc.getState().doc!.relations,
    });
    const threadId = useCanvasDoc.getState().doc!.threads[0]!.id;
    useCanvasDoc.getState().applyGeometry(d => setGeometry(d, threadId, { x: 500, y: 500, w: 900, h: 700 }));
    const after = JSON.stringify({
      m: useCanvasDoc.getState().doc!.messages,
      s: useCanvasDoc.getState().doc!.snapshots,
      r: useCanvasDoc.getState().doc!.relations,
    });
    expect(after).toBe(before);
  });
});

describe('geometry undo', () => {
  beforeEach(() => { resetCanvasDbForTests(`canvas-${Math.random()}`); freshStore(); });

  it('snapshots at the START of a gesture, so one gesture is one restorable step', async () => {
    await openCanvas();
    await useCanvasDoc.getState().apply(d => createRootThread(d, 'q', { now: 1 }));
    const threadId = useCanvasDoc.getState().doc!.threads[0]!.id;
    useCanvasDoc.getState().applyGeometry(d => setGeometry(d, threadId, { x: 10, y: 10, w: 360, h: 300 }));

    // gesture: one snapshot, then many frames
    useCanvasDoc.getState().beginGesture('resize');
    for (let w = 360; w <= 560; w += 20) {
      useCanvasDoc.getState().applyGeometry(d => setGeometry(d, threadId, { w }));
    }
    expect(useCanvasDoc.getState().undo).toHaveLength(1);
    expect(useCanvasDoc.getState().doc!.layouts[0]!.entries[threadId]!.w).toBe(560);

    useCanvasDoc.getState().undoGeometry();
    // back to where the gesture began — not to the frame before the last one
    expect(useCanvasDoc.getState().doc!.layouts[0]!.entries[threadId]!.w).toBe(360);
    expect(useCanvasDoc.getState().undo).toHaveLength(0);
  });

  it('does nothing when there is nothing to undo', async () => {
    await openCanvas();
    expect(() => useCanvasDoc.getState().undoGeometry()).not.toThrow();
    expect(useCanvasDoc.getState().undo).toHaveLength(0);
  });
});

describe('the saving indicator', () => {
  beforeEach(() => { resetCanvasDbForTests(`canvas-${Math.random()}`); freshStore(); });

  it('clears once the writes land, and never claims work that is not happening', async () => {
    await openCanvas();
    await useCanvasDoc.getState().apply(d => createRootThread(d, 'q', { now: 1 }));
    const threadId = useCanvasDoc.getState().doc!.threads[0]!.id;

    useCanvasDoc.getState().applyGeometry(d => setGeometry(d, threadId, { x: 5 }));
    expect(useCanvasDoc.getState().saving).toBe(true);

    await flushCanvasWrites();
    expect(useCanvasDoc.getState().saving).toBe(false);
    expect(useCanvasDoc.getState().pendingWrites).toBe(0);
  });

  it('stays settled when many geometry frames coalesce into one write', async () => {
    // `schedule()` replaces the pending callback, so N frames produce one write. Counting the
    // frames instead of flagging the write is what left the header stuck on "Saving…".
    await openCanvas();
    await useCanvasDoc.getState().apply(d => createRootThread(d, 'q', { now: 1 }));
    const threadId = useCanvasDoc.getState().doc!.threads[0]!.id;

    for (let x = 0; x < 30; x++) {
      useCanvasDoc.getState().applyGeometry(d => setGeometry(d, threadId, { x }));
    }
    expect(useCanvasDoc.getState().saving).toBe(true);
    await flushCanvasWrites();
    expect(useCanvasDoc.getState().saving).toBe(false);
    expect(useCanvasDoc.getState().geometryPending).toBe(false);
  });

  it('survives overlapping writes without getting stuck', async () => {
    await openCanvas();
    await useCanvasDoc.getState().apply(d => createRootThread(d, 'q', { now: 1 }));
    const threadId = useCanvasDoc.getState().doc!.threads[0]!.id;

    // a content write and a geometry write in flight at once
    const content = useCanvasDoc.getState().apply(d => { d.summary.title = 'renamed'; });
    useCanvasDoc.getState().applyGeometry(d => setGeometry(d, threadId, { x: 9 }));
    await content;
    await flushCanvasWrites();

    expect(useCanvasDoc.getState().pendingWrites).toBe(0);
    expect(useCanvasDoc.getState().saving).toBe(false);
  });

  it('clears even when the scheduled write finds the canvas closed', async () => {
    await openCanvas();
    await useCanvasDoc.getState().apply(d => createRootThread(d, 'q', { now: 1 }));
    const threadId = useCanvasDoc.getState().doc!.threads[0]!.id;
    useCanvasDoc.getState().applyGeometry(d => setGeometry(d, threadId, { x: 5 }));

    // the tab closes before the debounce fires — the early-return path
    useCanvasDoc.setState({ canvasId: 'cv_somewhere_else' });
    await flushCanvasWrites();

    expect(useCanvasDoc.getState().pendingWrites).toBe(0);
    expect(useCanvasDoc.getState().saving).toBe(false);
  });
});

describe('viewport', () => {
  beforeEach(() => { resetCanvasDbForTests(`canvas-${Math.random()}`); freshStore(); });

  it('is device-local and does not touch the document', async () => {
    const id = await openCanvas();
    const revBefore = useCanvasDoc.getState().doc!.summary.rev;
    useCanvasDoc.getState().setViewport({ x: 120, y: -40, zoom: 0.5 });
    await flushCanvasWrites();

    expect((await getViewState(id))!.viewport).toEqual({ x: 120, y: -40, zoom: 0.5 });
    expect((await getCanvas(id))!.summary.rev).toBe(revBefore);
  });
});
