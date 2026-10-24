import { beforeEach, describe, expect, it } from 'vitest';
import { useCanvasStore, canvasesOf } from '../../src/canvas/canvas-store';
import { createCanvas, getCanvas, resetCanvasDbForTests, unassignCanvasesOfProject, updateCanvas } from '../../src/canvas/canvas-repo';
import { createRootThread } from '../../src/canvas/domain/commands';

// The library's behaviour, below the UI: create, rename, duplicate, delete, and the recovery
// listing a deleted project leaves behind.

const reset = (): void => {
  resetCanvasDbForTests(`canvas-${Math.random()}`);
  useCanvasStore.setState({ byProject: {}, unassigned: [], loaded: {}, error: {} });
};

describe('canvas library', () => {
  beforeEach(reset);

  it('creates into the project it was asked for and lists it', async () => {
    const made = await useCanvasStore.getState().create('p1', 'First');
    expect(made?.title).toBe('First');
    expect(canvasesOf(useCanvasStore.getState(), 'p1').map(c => c.title)).toEqual(['First']);
    expect(canvasesOf(useCanvasStore.getState(), 'p2')).toEqual([]);
  });

  it('renames in place', async () => {
    const made = (await useCanvasStore.getState().create('p1', 'Old'))!;
    await useCanvasStore.getState().rename('p1', made.id, 'New');
    expect(canvasesOf(useCanvasStore.getState(), 'p1').map(c => c.title)).toEqual(['New']);
  });

  it('duplicates with the content, and the copy is independent', async () => {
    const made = (await useCanvasStore.getState().create('p1', 'Source'))!;
    await updateCanvas(made.id, doc => { createRootThread(doc, 'a question', { now: 1 }); });
    await useCanvasStore.getState().load('p1');

    const copy = await useCanvasStore.getState().duplicate('p1', made.id);
    expect(copy?.title).toBe('Source copy');
    expect(canvasesOf(useCanvasStore.getState(), 'p1')).toHaveLength(2);

    const copied = (await getCanvas(copy!.id))!;
    const original = (await getCanvas(made.id))!;
    expect(copied.threads).toHaveLength(1);
    expect(copied.threads[0]!.id).not.toBe(original.threads[0]!.id);
    expect(copied.messages[0]!.parts[0]).toMatchObject({ text: 'a question' });
  });

  it('deletes only the one asked for', async () => {
    const a = (await useCanvasStore.getState().create('p1', 'A'))!;
    await useCanvasStore.getState().create('p1', 'B');
    await useCanvasStore.getState().remove('p1', a.id);
    expect(canvasesOf(useCanvasStore.getState(), 'p1').map(c => c.title)).toEqual(['B']);
    expect(await getCanvas(a.id)).toBeNull();
  });

  it('returns the SAME empty array every time, so a zustand selector can settle', () => {
    // A fresh `[]` from the selector makes useSyncExternalStore re-render forever, which takes the
    // whole project panel down with it. Caught by e2e the first time; asserted here from now on.
    const s = useCanvasStore.getState();
    expect(canvasesOf(s, 'never-loaded')).toBe(canvasesOf(s, 'never-loaded'));
    expect(canvasesOf(s, 'never-loaded')).toBe(canvasesOf(s, 'also-never-loaded'));
  });

  it('and the same array identity for a project that really has canvases', async () => {
    await useCanvasStore.getState().create('p1', 'One');
    const s = useCanvasStore.getState();
    expect(canvasesOf(s, 'p1')).toBe(canvasesOf(s, 'p1'));
  });

  it('marks a project loaded even when it has nothing, so empty reads as empty', async () => {
    await useCanvasStore.getState().load('p1');
    expect(useCanvasStore.getState().loaded['p1']).toBe(true);
    expect(useCanvasStore.getState().error['p1']).toBe('');
    expect(canvasesOf(useCanvasStore.getState(), 'p1')).toEqual([]);
  });
});

describe('a deleted project leaves its canvases reachable', () => {
  beforeEach(reset);

  it('moves them to the unassigned listing rather than deleting them', async () => {
    const kept = await createCanvas({ projectId: 'p1', title: 'Months of work' });
    await createCanvas({ projectId: 'p2', title: 'Elsewhere' });

    await unassignCanvasesOfProject('p1');
    await useCanvasStore.getState().load('p2');

    expect(canvasesOf(useCanvasStore.getState(), 'p1')).toEqual([]);
    expect(useCanvasStore.getState().unassigned.map(c => c.title)).toEqual(['Months of work']);
    // and it still opens
    expect(await getCanvas(kept.summary.id)).not.toBeNull();
  });

  it('the listing is visible from any project, so the work is never stranded', async () => {
    await createCanvas({ projectId: 'p1', title: 'Orphan' });
    await unassignCanvasesOfProject('p1');
    await useCanvasStore.getState().load('p9');
    expect(useCanvasStore.getState().unassigned.map(c => c.title)).toEqual(['Orphan']);
  });
});
