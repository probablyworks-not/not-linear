import { beforeEach, describe, expect, it } from 'vitest';
import {
  createRun, deleteRun, deriveCounts, getRun, listRuns, resetDesignsDbForTests, RunMissingError, updateRun,
  type CreateRunInput,
} from '../../src/designs/designs-repo';
import { DESIGNS_INDEX_KEY, openDesignsDb, runKey } from '../../src/db/designs';
import type { Flow, Requirement, SpecRunDoc } from '../../src/designs/types';

const bundle = () => ({
  files: [{ name: 'active.dc.html', size: 36031, kind: 'dc' as const, content: '<x-dc></x-dc>' }],
  skipped: [],
});
const base = (): CreateRunInput => ({ projectId: 'p1', title: 'Project details v2', bundle: bundle() });

const flow = (id: string, status: Flow['status'] = 'pending'): Flow => ({
  id, title: `flow ${id}`, trigger: 'click', steps: [], successState: 'done', failureStates: [], evidence: [], status,
});
const requirement = (id: string, status: Requirement['status'] = 'pending'): Requirement => ({
  id, title: `req ${id}`, statement: 's', acceptanceCriteria: [], priority: 'must', flowIds: [], screenIds: [],
  evidence: [], source: 'model', status,
});

describe('designs repo', () => {
  let dbName = '';
  beforeEach(() => { dbName = `designs-${Math.random()}`; resetDesignsDbForTests(dbName); });

  it('creates a run that lists and reloads', async () => {
    const doc = await createRun(base());
    expect(doc.run.stage).toBe('parsed');
    expect(doc.run.status).toBe('idle');
    expect(doc.run.visionUsed).toBe(false);
    expect(await listRuns('p1')).toHaveLength(1);
    expect((await getRun(doc.run.id))?.bundle.files[0]!.name).toBe('active.dc.html');
  });

  it('keeps projects apart and lists newest first', async () => {
    const a = await createRun(base());
    const b = await createRun({ ...base(), title: 'Settings' });
    await createRun({ ...base(), projectId: 'p2' });
    await updateRun(a.run.id, d => { d.run.title = 'touched'; });
    const rows = await listRuns('p1');
    expect(rows.map(r => r.id)).toEqual([a.run.id, b.run.id]);
    expect(await listRuns('p2')).toHaveLength(1);
  });

  it('re-derives the index entry from the document on every write', async () => {
    const { run } = await createRun(base());
    await updateRun(run.id, d => {
      d.spec.screens = [{ id: 'sActive', parent_state: null, fidelity_tier: 'standard', boundary_confidence: 'high', elements: [], repeated_structures: [] }];
      d.flows = [flow('F1', 'accepted'), flow('F2')];
      d.requirements = [requirement('R-001', 'accepted'), requirement('R-002', 'rejected'), requirement('R-003')];
    });
    const [entry] = await listRuns('p1');
    // rejected and stale items are not counted; pending spans flows and requirements
    expect(entry!.counts).toEqual({ screens: 1, flows: 2, requirements: 2, pending: 2 });
    expect((await getRun(run.id))!.run.counts).toEqual(entry!.counts);
  });

  it('serialises overlapping writes instead of dropping one', async () => {
    const { run } = await createRun(base());
    await Promise.all([
      updateRun(run.id, d => { d.flows = [...d.flows, flow('F1')]; }),
      updateRun(run.id, d => { d.flows = [...d.flows, flow('F2')]; }),
      updateRun(run.id, d => { d.requirements = [...d.requirements, requirement('R-001')]; }),
    ]);
    const doc = (await getRun(run.id))!;
    expect(doc.flows.map(f => f.id).sort()).toEqual(['F1', 'F2']);
    expect(doc.requirements).toHaveLength(1);
    expect(doc.run.counts.pending).toBe(3);
  });

  it('refuses to update a run that is not there', async () => {
    await expect(updateRun('dr_nope', d => d)).rejects.toBeInstanceOf(RunMissingError);
  });

  it('deletes the heavy row and the index entry together', async () => {
    const { run } = await createRun(base());
    const other = await createRun(base());
    await deleteRun(run.id);
    expect(await getRun(run.id)).toBeNull();
    expect((await listRuns('p1')).map(r => r.id)).toEqual([other.run.id]);
    const raw = openDesignsDb(dbName);
    expect(await raw.kv.get(runKey(run.id))).toBeUndefined();
    raw.close();
  });

  it('stores the bundle in the run row, never in the index row', async () => {
    const { run } = await createRun(base());
    const raw = openDesignsDb(dbName);
    const index = JSON.stringify((await raw.kv.get(DESIGNS_INDEX_KEY))?.value);
    raw.close();
    expect(index).not.toContain('active.dc.html');
    expect(index).toContain(run.id);
  });
});

describe('deriveCounts', () => {
  const doc = (over: Partial<SpecRunDoc>): SpecRunDoc => ({
    run: {} as SpecRunDoc['run'], bundle: bundle(), spec: { source_file: '', extracted_at: '', screens: [], design_tokens: { components: [] }, unresolved_style_bindings: [], flagged_unreferenced_bindings: [] },
    flows: [], requirements: [], questions: [], answers: [], log: [], ...over,
  });

  it('counts edited items as live and leaves stale ones out', () => {
    const counts = deriveCounts(doc({
      flows: [flow('F1', 'edited'), flow('F2', 'stale')],
      requirements: [requirement('R-001', 'edited'), requirement('R-002', 'stale'), requirement('R-003', 'accepted')],
    }));
    expect(counts).toEqual({ screens: 0, flows: 1, requirements: 2, pending: 0 });
  });
});
