import { beforeEach, describe, expect, it } from 'vitest';
import {
  CanvasConflictError, CanvasMissingError, beginOperation, clearDraft, completeOperation,
  createCanvas, deleteCanvas, failOperation, getCanvas, getDrafts, getViewState, listAllCanvases,
  listCanvases, pendingOperations, putDraft, putViewState, renameCanvas, resetCanvasDbForTests,
  unassignCanvasesOfProject, updateCanvas,
} from '../../src/canvas/canvas-repo';
import { createRootThread, textPart } from '../../src/canvas/domain/commands';
import type { Draft } from '../../src/canvas/types';

const ctx = { now: 5_000 };

describe('canvas repo', () => {
  beforeEach(() => { resetCanvasDbForTests(`canvas-${Math.random()}`); });

  it('creates, lists newest-first within a project, and reads back whole', async () => {
    const a = await createCanvas({ projectId: 'p1', title: 'Alpha' }, 1000);
    await createCanvas({ projectId: 'p1', title: 'Beta' }, 2000);
    await createCanvas({ projectId: 'p2', title: 'Other' }, 3000);

    expect((await listCanvases('p1')).map(c => c.title)).toEqual(['Beta', 'Alpha']);
    expect((await listCanvases('p2')).map(c => c.title)).toEqual(['Other']);
    expect(await getCanvas(a.summary.id)).toMatchObject({ summary: { title: 'Alpha' } });
    expect(await getCanvas('cv_nope')).toBeNull();
  });

  it('round-trips content through a reload', async () => {
    const c = await createCanvas({ projectId: 'p1', title: 'T' });
    await updateCanvas(c.summary.id, doc => { createRootThread(doc, 'the question', ctx); });

    const again = (await getCanvas(c.summary.id))!;
    expect(again.threads).toHaveLength(1);
    expect(again.messages[0]!.parts[0]).toMatchObject({ kind: 'text', text: 'the question' });
    expect(again.summary.counts).toEqual({ threads: 1, messages: 1, outputs: 0 });
  });

  it('keeps the index entry derived from the document, never hand-maintained', async () => {
    const c = await createCanvas({ projectId: 'p1', title: 'T' });
    await updateCanvas(c.summary.id, doc => {
      createRootThread(doc, 'one', ctx);
      createRootThread(doc, 'two', ctx);
    });
    const [summary] = await listCanvases('p1');
    expect(summary!.counts).toEqual({ threads: 2, messages: 2, outputs: 0 });
  });

  it('refuses a stale write instead of clobbering it, and hands back what it found', async () => {
    const c = await createCanvas({ projectId: 'p1', title: 'T' });
    const staleRev = c.summary.rev;

    // another tab writes first
    await updateCanvas(c.summary.id, doc => { createRootThread(doc, 'theirs', ctx); }, { expectedRev: staleRev });

    await expect(
      updateCanvas(c.summary.id, doc => { createRootThread(doc, 'mine', ctx); }, { expectedRev: staleRev }),
    ).rejects.toBeInstanceOf(CanvasConflictError);

    const after = (await getCanvas(c.summary.id))!;
    expect(after.messages.map(m => (m.parts[0] as { text: string }).text)).toEqual(['theirs']);

    try {
      await updateCanvas(c.summary.id, doc => { doc.summary.title = 'x'; }, { expectedRev: staleRev });
    } catch (e) {
      expect((e as CanvasConflictError).current.summary.rev).toBe(after.summary.rev);
    }
  });

  it('without expectedRev the write is unconditional, for the single-tab case', async () => {
    const c = await createCanvas({ projectId: 'p1', title: 'T' });
    await updateCanvas(c.summary.id, doc => { doc.summary.title = 'one'; });
    await updateCanvas(c.summary.id, doc => { doc.summary.title = 'two'; });
    expect((await getCanvas(c.summary.id))!.summary.title).toBe('two');
  });

  it('throws for a canvas that is not there', async () => {
    await expect(updateCanvas('cv_nope', d => d)).rejects.toBeInstanceOf(CanvasMissingError);
  });

  it('renames through the index too', async () => {
    const c = await createCanvas({ projectId: 'p1', title: 'Old' });
    await renameCanvas(c.summary.id, 'New');
    expect((await listCanvases('p1'))[0]!.title).toBe('New');
  });
});

describe('project deletion', () => {
  beforeEach(() => { resetCanvasDbForTests(`canvas-${Math.random()}`); });

  it('moves canvases to Unassigned rather than deleting them', async () => {
    await createCanvas({ projectId: 'p1', title: 'Keep me' });
    await createCanvas({ projectId: 'p2', title: 'Untouched' });

    const moved = await unassignCanvasesOfProject('p1');
    expect(moved).toHaveLength(1);
    expect(await listCanvases('p1')).toHaveLength(0);
    expect((await listCanvases(null)).map(c => c.title)).toEqual(['Keep me']);
    expect(await listCanvases('p2')).toHaveLength(1);
    expect(await listAllCanvases()).toHaveLength(2);
  });

  it('an explicit delete takes the document, its drafts and its viewport', async () => {
    const c = await createCanvas({ projectId: 'p1', title: 'T' });
    await putDraft(c.summary.id, { target: 'new', text: 'x', snapshotIds: [], attachmentAssetIds: [], updatedAt: 1 });
    await putViewState(c.summary.id, { viewport: { x: 1, y: 2, zoom: 1 }, updatedAt: 1 });
    await deleteCanvas(c.summary.id);
    expect(await getCanvas(c.summary.id)).toBeNull();
    expect(await getDrafts(c.summary.id)).toEqual({});
    expect(await getViewState(c.summary.id)).toBeNull();
    expect(await listCanvases('p1')).toHaveLength(0);
  });
});

describe('drafts', () => {
  beforeEach(() => { resetCanvasDbForTests(`canvas-${Math.random()}`); });

  const draft = (target: string, text: string): Draft =>
    ({ target, text, snapshotIds: [], attachmentAssetIds: [], updatedAt: 1 });

  it('are scoped per canvas and per target, so nothing leaks between them', async () => {
    const a = await createCanvas({ projectId: 'p1', title: 'A' });
    const b = await createCanvas({ projectId: 'p1', title: 'B' });

    await putDraft(a.summary.id, draft('new', 'draft for A'));
    await putDraft(a.summary.id, { ...draft('thread:th_1', 'reply in A'), model: 'opus' });
    await putDraft(b.summary.id, draft('new', 'draft for B'));

    const aDrafts = await getDrafts(a.summary.id);
    expect(aDrafts['new']?.text).toBe('draft for A');
    expect(aDrafts['thread:th_1']?.model).toBe('opus');
    expect((await getDrafts(b.summary.id))['new']?.text).toBe('draft for B');
    expect((await getDrafts(b.summary.id))['thread:th_1']).toBeUndefined();
  });

  it('writing a draft does not touch the canvas document or its revision', async () => {
    const c = await createCanvas({ projectId: 'p1', title: 'T' });
    const before = (await getCanvas(c.summary.id))!.summary.rev;
    await putDraft(c.summary.id, draft('new', 'typing…'));
    expect((await getCanvas(c.summary.id))!.summary.rev).toBe(before);
  });

  it('clears one target and leaves the rest', async () => {
    const c = await createCanvas({ projectId: 'p1', title: 'T' });
    await putDraft(c.summary.id, draft('new', 'a'));
    await putDraft(c.summary.id, draft('thread:t1', 'b'));
    await clearDraft(c.summary.id, 'new');
    expect(Object.keys(await getDrafts(c.summary.id))).toEqual(['thread:t1']);
  });
});

describe('view state', () => {
  beforeEach(() => { resetCanvasDbForTests(`canvas-${Math.random()}`); });

  it('stores the viewport without touching the document revision', async () => {
    const c = await createCanvas({ projectId: 'p1', title: 'T' });
    const before = (await getCanvas(c.summary.id))!.summary.rev;
    await putViewState(c.summary.id, { viewport: { x: 10, y: 20, zoom: 0.5 }, updatedAt: 9 });
    expect((await getViewState(c.summary.id))!.viewport.zoom).toBe(0.5);
    expect((await getCanvas(c.summary.id))!.summary.rev).toBe(before);
  });
});

describe('cross-database operations', () => {
  beforeEach(() => { resetCanvasDbForTests(`canvas-${Math.random()}`); });

  const input = { kind: 'save-artifact' as const, canvasId: 'cv_1', dedupeKey: 'cv_1:ov_1', payload: { title: 'Report' } };

  it('a retry of the same logical save resumes the pending record instead of starting a second', async () => {
    const first = await beginOperation(input);
    const retry = await beginOperation(input);
    expect(first.resumed).toBe(false);
    expect(retry.resumed).toBe(true);
    expect(retry.op.id).toBe(first.op.id);
    expect(await pendingOperations()).toHaveLength(1);
  });

  it('a completed save is not repeated by a later retry', async () => {
    const { op } = await beginOperation(input);
    await completeOperation(op.id, 'artifact_7');
    expect(await pendingOperations()).toHaveLength(0);
    const again = await beginOperation(input);
    expect(again.resumed).toBe(true);
    expect(again.op.result).toBe('artifact_7');
  });

  it('a failed save can be started again', async () => {
    const { op } = await beginOperation(input);
    await failOperation(op.id, 'quota');
    const again = await beginOperation(input);
    expect(again.resumed).toBe(false);
    expect(again.op.id).not.toBe(op.id);
  });
});
