import { beforeEach, describe, expect, it } from 'vitest';
import { createCanvas, deleteCanvas, getCanvas, readCanvasAnnotations, resetCanvasDbForTests, updateCanvas, writeCanvasAnnotations } from '../../src/canvas/canvas-repo';
import { createRootThread, deleteThread } from '../../src/canvas/domain/commands';
import { readAnnotations, writeAnnotations } from '../../src/db/annotations-repo';

const strokes = [{ anchor:{scope:'message:m1',text:'P:Saved annotation',occurrence:0},width:.02,points:[[0,0],[1,1]] as [number,number][] }];
const ctx = {now:10};
beforeEach(() => resetCanvasDbForTests(`canvas-annotation-${Math.random()}`));
async function setup(){
  const canvas = await createCanvas({projectId:null,title:'Annotations'});
  const result = await updateCanvas(canvas.summary.id, doc => createRootThread(doc,'A saved reply',ctx));
  return {canvasId:canvas.summary.id,threadId:result.result.thread.id};
}
describe('Canvas annotation records', () => {
  it('saves separately without changing document content, layout, or revision', async () => {
    const {canvasId,threadId} = await setup();
    const before = await getCanvas(canvasId);
    expect(await readCanvasAnnotations(canvasId,threadId)).toEqual([]);
    await writeAnnotations(`canvas:${canvasId}`,threadId,strokes);
    expect(await readAnnotations(`canvas:${canvasId}`,threadId)).toEqual(strokes);
    expect(await getCanvas(canvasId)).toEqual(before);
  });
  it('keeps canvases and threads isolated', async () => {
    const a = await setup(), b = await setup();
    await writeCanvasAnnotations(a.canvasId,a.threadId,strokes);
    expect(await readCanvasAnnotations(b.canvasId,b.threadId)).toEqual([]);
    expect(await readCanvasAnnotations(a.canvasId,'other')).toEqual([]);
  });
  it('cleans up a removed thread and rejects late writes that would resurrect it', async () => {
    const {canvasId,threadId} = await setup();
    await writeCanvasAnnotations(canvasId,threadId,strokes);
    await updateCanvas(canvasId,doc => deleteThread(doc,threadId,ctx));
    expect(await readCanvasAnnotations(canvasId,threadId)).toEqual([]);
    await expect(writeCanvasAnnotations(canvasId,threadId,strokes)).rejects.toThrow('no longer exists');
  });
  it('deleting a canvas removes its marks and keeps another canvas intact', async () => {
    const a = await setup(),b=await setup();
    await writeCanvasAnnotations(a.canvasId,a.threadId,strokes);
    await writeCanvasAnnotations(b.canvasId,b.threadId,strokes);
    await deleteCanvas(a.canvasId);
    expect(await readCanvasAnnotations(a.canvasId,a.threadId)).toEqual([]);
    expect(await readCanvasAnnotations(b.canvasId,b.threadId)).toEqual(strokes);
    await expect(writeCanvasAnnotations(a.canvasId,a.threadId,strokes)).rejects.toThrow();
  });
});
