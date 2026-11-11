import { beforeEach, describe, expect, it } from 'vitest';
import { saveOutputToArtifacts } from '../../src/canvas/save-output';
import { createCanvas, getCanvas, pendingOperations, resetCanvasDbForTests, updateCanvas } from '../../src/canvas/canvas-repo';
import { saveOutputVersion, textPart } from '../../src/canvas/domain/commands';
import { listArtifacts, resetArtifactsDbForTests } from '../../src/db/artifacts-repo';
import type { CanvasDoc, OutputVersion } from '../../src/canvas/types';

// Saving an output into project Artifacts crosses two databases, so it cannot be one transaction.
// The property that matters: a retry must never leave two artifacts behind.

async function canvasWithOutput(text = '# findings'): Promise<{ doc: CanvasDoc; output: OutputVersion }> {
  const c = await createCanvas({ projectId: 'p1', title: 'Research' });
  const { doc, result } = await updateCanvas(c.summary.id, d => saveOutputVersion(d, null, [textPart(text)], { now: 1 }));
  return { doc, output: result.output };
}

describe('saving a canvas output to project artifacts', () => {
  beforeEach(() => {
    resetCanvasDbForTests(`canvas-${Math.random()}`);
    resetArtifactsDbForTests(`artifacts-${Math.random()}`);
  });

  it('creates the artifact and marks the operation done', async () => {
    const { doc, output } = await canvasWithOutput();
    const res = await saveOutputToArtifacts(doc, output, 'Findings');

    expect(res.status).toBe('saved');
    const arts = await listArtifacts('p1');
    expect(arts).toHaveLength(1);
    expect(arts[0]).toMatchObject({ title: 'Findings', type: 'MD', source: 'canvas', canvasId: doc.summary.id, canvasOutputVersionId: output.id });
    expect(await pendingOperations()).toHaveLength(0);
  });

  it('a second save of the same output does not make a second artifact', async () => {
    const { doc, output } = await canvasWithOutput();
    await saveOutputToArtifacts(doc, output, 'Findings');
    const again = await saveOutputToArtifacts(doc, output, 'Findings');

    expect(again.status).toBe('resumed');
    expect(await listArtifacts('p1')).toHaveLength(1);
  });

  it('a later canvas edit becomes a new version, never a rewrite of the saved one', async () => {
    const { doc, output } = await canvasWithOutput('# v1');
    await saveOutputToArtifacts(doc, output, 'Findings');

    // the canvas moves on
    const { doc: doc2, result } = await updateCanvas(doc.summary.id, d =>
      saveOutputVersion(d, output.familyId, [textPart('# v2')], { now: 2 }));
    expect(result.output.version).toBe(2);

    await saveOutputToArtifacts(doc2, result.output, 'Findings');
    const arts = await listArtifacts('p1');
    expect(arts).toHaveLength(1);
    expect(arts[0]!.version).toBe(2);
    // the first version is still readable: history, not a rewrite
    expect(arts[0]!.versions.map(v => v.content)).toEqual(['# v1', '# v2']);
  });

  it('refuses when the canvas is not in a project, and says why', async () => {
    const { doc, output } = await canvasWithOutput();
    const orphan: CanvasDoc = { ...doc, summary: { ...doc.summary, projectId: null } };
    const res = await saveOutputToArtifacts(orphan, output, 'Findings');
    expect(res.status).toBe('failed');
    expect(res.error).toMatch(/not in a project/);
    expect(await listArtifacts('p1')).toHaveLength(0);
  });

  it('picks the artifact type from the parts', async () => {
    const c = await createCanvas({ projectId: 'p2', title: 'C' });
    const { doc, result } = await updateCanvas(c.summary.id, d => saveOutputVersion(d, null, [
      { id: 'pt_h', kind: 'html', state: 'ready', html: '<p>hi</p>' },
    ], { now: 1 }));
    await saveOutputToArtifacts(doc, result.output, 'Page');
    expect((await listArtifacts('p2'))[0]!.type).toBe('HTML');
  });
});
