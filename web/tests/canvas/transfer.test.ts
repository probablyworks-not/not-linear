import { beforeEach, describe, expect, it } from 'vitest';
import {
  CANVAS_TRANSFER_FORMAT, TransferFormatError, duplicateCanvas, exportCanvases, importCanvases,
  remapDoc, remapDraftTarget,
} from '../../src/canvas/transfer';
import {
  createCanvas, getCanvas, listAllCanvases, resetCanvasDbForTests, updateCanvas,
} from '../../src/canvas/canvas-repo';
import {
  addMessage, branchFrom, createRootThread, freezeSelection, saveOutputVersion, setGeometry, textPart,
} from '../../src/canvas/domain/commands';
import type { CanvasDoc } from '../../src/canvas/types';

const ctx = { now: 1 };

/** A canvas with a root, a reply, a frozen selection, a branch, geometry and an output. */
async function populated(): Promise<string> {
  const c = await createCanvas({ projectId: 'p1', title: 'Original' });
  await updateCanvas(c.summary.id, doc => {
    const { thread } = createRootThread(doc, 'the question', ctx);
    const reply = addMessage(doc, {
      threadId: thread.id, author: { kind: 'model', provider: 'p', model: 'm' },
      parts: [textPart('alpha beta gamma')],
    }, ctx);
    const snap = freezeSelection(doc, reply.id, reply.parts[0]!.id, 'beta', 6, ctx)!;
    branchFrom(doc, { snapshotId: snap.id, prompt: 'why beta?' }, ctx);
    setGeometry(doc, thread.id, { x: 42, y: 84, w: 500, h: 400 });
    saveOutputVersion(doc, null, [textPart('# report')], ctx);
  });
  return c.summary.id;
}

const allIds = (doc: CanvasDoc): string[] => [
  doc.summary.id,
  ...doc.threads.map(t => t.id),
  ...doc.messages.map(m => m.id),
  ...doc.snapshots.map(s => s.id),
  ...doc.relations.map(r => r.id),
  ...doc.outputs.map(o => o.id),
];

describe('export and import', () => {
  beforeEach(() => { resetCanvasDbForTests(`canvas-${Math.random()}`); });

  it('round-trips content, links, sources, layout and versions', async () => {
    const id = await populated();
    const before = (await getCanvas(id))!;
    const dump = await exportCanvases([id]);

    resetCanvasDbForTests(`canvas-${Math.random()}`);
    const report = await importCanvases(dump);
    expect(report.imported).toHaveLength(1);
    expect(report.skipped).toHaveLength(0);

    const after = (await getCanvas(report.imported[0]!.newId))!;
    expect(after.threads).toHaveLength(before.threads.length);
    expect(after.messages).toHaveLength(before.messages.length);
    expect(after.snapshots[0]!.content).toBe('beta');
    expect(after.outputs[0]!.parts[0]).toMatchObject({ kind: 'text', text: '# report' });
    const rootId = after.threads.find(t => t.kind === 'root')!.id;
    expect(after.layouts[0]!.entries[rootId]).toMatchObject({ x: 42, y: 84, w: 500, h: 400 });
  });

  it('remaps every id, and the links still point at things that exist', async () => {
    const id = await populated();
    const before = (await getCanvas(id))!;
    const dump = await exportCanvases([id]);
    const report = await importCanvases(dump);
    const after = (await getCanvas(report.imported[0]!.newId))!;

    // no id survives...
    const old = new Set(allIds(before));
    for (const fresh of allIds(after)) expect(old.has(fresh)).toBe(false);

    // ...and nothing dangles
    const threadIds = new Set(after.threads.map(t => t.id));
    const snapIds = new Set(after.snapshots.map(s => s.id));
    const messageIds = new Set(after.messages.map(m => m.id));
    for (const r of after.relations) {
      expect(threadIds.has(r.toThreadId)).toBe(true);
      expect(threadIds.has(r.fromThreadId)).toBe(true);
      if (r.snapshotId) expect(snapIds.has(r.snapshotId)).toBe(true);
    }
    for (const m of after.messages) expect(threadIds.has(m.threadId)).toBe(true);
    for (const s of after.snapshots) {
      if (s.anchor.kind === 'text') expect(messageIds.has(s.anchor.messageId)).toBe(true);
    }
    // the layout is keyed by entity id, so its keys were remapped too
    for (const key of Object.keys(after.layouts[0]!.entries)) expect(old.has(key)).toBe(false);
  });

  it('importing the same file twice makes two independent canvases', async () => {
    const id = await populated();
    const dump = await exportCanvases([id]);
    const a = await importCanvases(dump);
    const b = await importCanvases(dump);
    expect(a.imported[0]!.newId).not.toBe(b.imported[0]!.newId);
    expect(await listAllCanvases()).toHaveLength(3); // the original plus two imports
  });

  it('rejects a damaged canvas instead of importing half of it', async () => {
    const id = await populated();
    const dump = await exportCanvases([id]);
    dump.canvases[0]!.doc.summary.title = 'tampered with';

    const report = await importCanvases(dump);
    expect(report.imported).toHaveLength(0);
    expect(report.skipped[0]!.reason).toMatch(/checksum/);
  });

  it('refuses a format or schema it does not understand', async () => {
    await expect(importCanvases({ format: 99, schemaVersion: 1, canvases: [] })).rejects.toBeInstanceOf(TransferFormatError);
    await expect(importCanvases({ format: CANVAS_TRANSFER_FORMAT, schemaVersion: 99, canvases: [] })).rejects.toBeInstanceOf(TransferFormatError);
    await expect(importCanvases('not an export')).rejects.toBeInstanceOf(TransferFormatError);
    await expect(importCanvases({ format: CANVAS_TRANSFER_FORMAT, schemaVersion: 1 })).rejects.toBeInstanceOf(TransferFormatError);
  });

  it('carries its own format and schema version so a future build can tell', async () => {
    const dump = await exportCanvases([await populated()]);
    expect(dump.format).toBe(CANVAS_TRANSFER_FORMAT);
    expect(dump.schemaVersion).toBe(1);
    expect(dump.canvases[0]!.checksum).toMatch(/^[0-9a-f]{8}$/);
  });

  it('exports every canvas when asked for none in particular', async () => {
    await populated();
    await createCanvas({ projectId: 'p2', title: 'Second' });
    expect((await exportCanvases()).canvases).toHaveLength(2);
  });
});

describe('duplicate', () => {
  beforeEach(() => { resetCanvasDbForTests(`canvas-${Math.random()}`); });

  it('copies the content and remaps the ids, leaving the original alone', async () => {
    const id = await populated();
    const copy = (await duplicateCanvas(id))!;
    const original = (await getCanvas(id))!;

    expect(copy.summary.id).not.toBe(id);
    expect(copy.summary.title).toBe('Original copy');
    expect(copy.threads).toHaveLength(original.threads.length);
    expect(copy.snapshots[0]!.content).toBe('beta');
    expect(original.summary.title).toBe('Original');
    const sharedIds = new Set(allIds(original));
    for (const fresh of allIds(copy)) expect(sharedIds.has(fresh)).toBe(false);
  });

  it('returns null for a canvas that is not there', async () => {
    expect(await duplicateCanvas('cv_nope')).toBeNull();
  });
});

describe('draft targets', () => {
  it('follow the remap when they name a thread, and are left alone otherwise', () => {
    const map = new Map([['th_old', 'th_new']]);
    expect(remapDraftTarget('thread:th_old', map)).toBe('thread:th_new');
    expect(remapDraftTarget('thread:th_unknown', map)).toBe('thread:th_unknown');
    expect(remapDraftTarget('new', map)).toBe('new');
  });
});

describe('remapDoc', () => {
  it('keeps the id family, so a remapped thread id is still a thread id', async () => {
    resetCanvasDbForTests(`canvas-${Math.random()}`);
    const doc = (await getCanvas(await populated()))!;
    const { doc: next, map } = remapDoc(doc);
    for (const [from, to] of map) expect(to.split('_')[0]).toBe(from.split('_')[0]);
    expect(next.threads.every(t => t.id.startsWith('th_'))).toBe(true);
    expect(next.messages.every(m => m.id.startsWith('ms_'))).toBe(true);
  });
});
