import { describe, it, expect, afterEach } from 'vitest';
import { openChatDb } from '../../src/db/chat';
import { deleteAnnotations, readAnnotations, writeAnnotations, type AnnotationStroke } from '../../src/db/annotations-repo';

const tid = 'annotation-test:chat';
const stroke = (): AnnotationStroke => ({ anchor: { scope:'chat-stream', text:'P:hello', occurrence:0 }, points:[[0,0],[1,1]] });
afterEach(async () => { await deleteAnnotations(tid); });

describe('annotation records', () => {
  it('defaults to empty, snapshots strokes, and serializes overlapping writes', async () => {
    expect(await readAnnotations(tid)).toEqual([]);
    const strokes = [stroke()];
    const saved = writeAnnotations(tid, '', strokes);
    strokes[0]!.points.push([2,2]);
    await saved;
    expect((await readAnnotations(tid))[0]!.points).toHaveLength(2);
    await Promise.all([writeAnnotations(tid, '', []), writeAnnotations(tid, '', [stroke()])]);
    expect(await readAnnotations(tid)).toHaveLength(1);
  });
  it('isolates branches and removes every record when the chat is deleted', async () => {
    await writeAnnotations(tid, '', [stroke()]);
    await writeAnnotations(tid, 'child', [stroke()]);
    await writeAnnotations(tid, 'sibling', [stroke()]);
    await deleteAnnotations(tid, new Set(['child']));
    expect(await readAnnotations(tid, 'child')).toEqual([]);
    expect(await readAnnotations(tid, 'sibling')).toHaveLength(1);
    expect(await readAnnotations(tid)).toHaveLength(1);
    await deleteAnnotations(tid);
    expect(await readAnnotations(tid, 'sibling')).toEqual([]);
    expect(await readAnnotations(tid)).toEqual([]);
  });
  it('preserves the existing state row and v1 table schema', async () => {
    const db = openChatDb();
    const before = await db.kv.get('state');
    await writeAnnotations(tid, '', [stroke()]);
    await deleteAnnotations(tid);
    expect(await db.kv.get('state')).toEqual(before);
    expect(db.verno).toBe(1);
    expect(db.tables.map(t => t.name)).toEqual(['kv']);
    db.close();
  });
});
