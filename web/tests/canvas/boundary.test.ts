import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { createCanvas, getCanvas, resetCanvasDbForTests, updateCanvas } from '../../src/canvas/canvas-repo';
import { resolveThreadSources } from '../../src/canvas/anchors';
import {
  acceptRun, addMessage, ancestorChain, branchFrom, createRootThread, freezeSelection,
  saveOutputVersion, setRunStatus, textPart,
} from '../../src/canvas/domain/commands';

// AC-16: "A non-Canvas test consumer can resolve the same context and output versions without
// importing React Flow or Canvas components." This is the boundary the future Agents interface
// depends on, so it is asserted two ways: statically, over the import graph, and behaviourally, by
// driving a whole branch/synthesis/output flow through the domain and repo alone.

const SRC = join(__dirname, '../../src/canvas');

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return filesUnder(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

const importsOf = (file: string): string[] =>
  [...readFileSync(file, 'utf8').matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)].map(m => m[1]!);

describe('the Canvas data boundary (AC-16)', () => {
  it('nothing outside canvas/view imports React Flow, React or the view layer', () => {
    const offenders: string[] = [];
    for (const file of filesUnder(SRC)) {
      if (file.includes('/view/')) continue;
      for (const spec of importsOf(file)) {
        if (/^@xyflow\//.test(spec) || spec === 'react' || spec === 'react-dom' || /(^|\/)view\//.test(spec)) {
          offenders.push(`${file.slice(SRC.length + 1)} -> ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the domain layer is pure: no Dexie, no repo, no provider', () => {
    const offenders: string[] = [];
    const pure = [join(SRC, 'domain'), join(SRC, 'types.ts'), join(SRC, 'ids.ts'), join(SRC, 'anchors.ts')];
    for (const target of pure) {
      const files = statSync(target).isDirectory() ? filesUnder(target) : [target];
      for (const file of files) {
        for (const spec of importsOf(file)) {
          if (spec === 'dexie' || /db\/canvas/.test(spec) || /canvas-repo/.test(spec) || /providers\//.test(spec)) {
            offenders.push(`${file.slice(SRC.length + 1)} -> ${spec}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('only canvas-repo touches the canvas database', () => {
    const writers = filesUnder(join(__dirname, '../../src'))
      .filter(f => importsOf(f).some(s => /db\/canvas$/.test(s)))
      .map(f => f.split('/src/')[1]!);
    expect(writers.sort()).toEqual(['canvas/canvas-repo.ts']);
  });
});

describe('a non-Canvas consumer', () => {
  beforeEach(() => { resetCanvasDbForTests(`canvas-${Math.random()}`); });

  it('resolves context, provenance and output versions with no UI in sight', async () => {
    const ctx = { now: 10 };
    const c = await createCanvas({ projectId: 'p1', title: 'Shared' });

    // Everything below is what an Agents runtime would do: write through the domain commands,
    // persist through the repo, read back the same records.
    const { result } = await updateCanvas(c.summary.id, doc => {
      const root = createRootThread(doc, 'original question', ctx);
      const reply = addMessage(doc, {
        threadId: root.thread.id, author: { kind: 'model', provider: 'anthropic', model: 'opus' },
        parts: [textPart('the answer mentions widgets and sprockets')],
      }, ctx);
      const snap = freezeSelection(doc, reply.id, reply.parts[0]!.id, 'widgets', 20, ctx)!;
      const branch = branchFrom(doc, { snapshotId: snap.id, prompt: 'more on widgets' }, ctx)!;
      const run = acceptRun(doc, { submissionId: 'sub-1', threadId: branch.thread.id, provider: 'anthropic', model: 'opus' }, ctx);
      const out = saveOutputVersion(doc, null, [textPart('# widget report')], ctx, run.run.id);
      setRunStatus(doc, run.run.id, 'completed', ctx, { outputVersionId: out.output.id, usage: { inputTokens: 10, outputTokens: 20 } });
      return { rootId: root.thread.id, branchId: branch.thread.id, outputId: out.output.id, runId: run.run.id };
    });

    const doc = (await getCanvas(c.summary.id))!;

    // ancestry
    expect(ancestorChain(doc, result.branchId)).toEqual([result.rootId, result.branchId]);

    // provenance: the exact excerpt the branch was given, and its status today
    const sources = resolveThreadSources(doc, result.branchId);
    expect(sources).toHaveLength(1);
    expect(sources[0]!.snapshot.content).toBe('widgets');
    expect(sources[0]!.resolution.status).toBe('ok');

    // the output version, reachable from the run that produced it
    const run = doc.runs.find(r => r.id === result.runId)!;
    expect(run.status).toBe('completed');
    expect(run.usage).toEqual({ inputTokens: 10, outputTokens: 20 });
    const output = doc.outputs.find(o => o.id === run.outputVersionId)!;
    expect(output.version).toBe(1);
    expect(output.parts[0]).toMatchObject({ kind: 'text', text: '# widget report' });
    expect(output.producedByRunId).toBe(result.runId);
  });
});
