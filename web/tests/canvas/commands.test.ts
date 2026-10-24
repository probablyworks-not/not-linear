import { describe, expect, it } from 'vitest';
import {
  acceptRun, addMessage, ancestorChain, branchFrom, continueThread, createRootThread, deleteThread,
  editMessagePart, freezeSelection, placeBeside, retryRun, saveOutputVersion, setGeometry,
  setRunStatus, synthesize, textPart,
} from '../../src/canvas/domain/commands';
import { emptyDoc, type CanvasDoc, type CanvasSummary } from '../../src/canvas/types';

const ctx = { now: 1_000 };
const summary = (): CanvasSummary => ({
  id: 'cv_test', projectId: 'p1', title: 'T',
  counts: { threads: 0, messages: 0, outputs: 0 }, createdAt: 0, updatedAt: 0, rev: 1,
});
const doc = (): CanvasDoc => emptyDoc(summary());

/** A root with one model reply, which is what everything else branches from. */
function seeded(): { d: CanvasDoc; threadId: string; replyId: string; partId: string } {
  const d = doc();
  const { thread } = createRootThread(d, 'what is this', ctx);
  const reply = addMessage(d, {
    threadId: thread.id,
    author: { kind: 'model', provider: 'anthropic', model: 'opus' },
    parts: [textPart('alpha beta gamma delta')],
  }, ctx);
  const part = reply.parts[0]!;
  return { d, threadId: thread.id, replyId: reply.id, partId: part.id };
}

describe('threads and messages', () => {
  it('first send makes exactly one root thread and one message', () => {
    const d = doc();
    const { thread, message } = createRootThread(d, 'hello', ctx);
    expect(d.threads).toHaveLength(1);
    expect(thread.kind).toBe('root');
    expect(d.messages).toEqual([message]);
    expect(d.summary.counts).toEqual({ threads: 1, messages: 1, outputs: 0 });
  });

  it('continue appends to the target thread and never creates one', () => {
    const { d, threadId } = seeded();
    const before = d.threads.length;
    const m = continueThread(d, threadId, 'and then?', ctx);
    expect(m?.seq).toBe(2);
    expect(d.threads).toHaveLength(before);
    expect(continueThread(d, 'th_nope', 'x', ctx)).toBeNull();
  });

  it('sequence numbers are per thread, not global', () => {
    const { d, threadId } = seeded();
    const snap = freezeSelection(d, seeded().replyId, 'pt_x', 'q', 0, ctx);
    expect(snap).toBeNull(); // the message belongs to a different document
    const other = createRootThread(d, 'second root', ctx);
    expect(other.message.seq).toBe(0);
    expect(continueThread(d, threadId, 'x', ctx)?.seq).toBe(2);
  });
});

describe('branching', () => {
  it('links the new thread to the exact snapshot and leaves the source untouched', () => {
    const { d, threadId, replyId, partId } = seeded();
    const snap = freezeSelection(d, replyId, partId, 'beta gamma', 6, ctx)!;
    const sourceMessagesBefore = d.messages.filter(m => m.threadId === threadId).length;

    const res = branchFrom(d, { snapshotId: snap.id, prompt: 'say more' }, ctx)!;
    expect(res.thread.kind).toBe('branch');
    expect(res.relation).toMatchObject({ kind: 'branch', fromThreadId: threadId, toThreadId: res.thread.id, snapshotId: snap.id });
    expect(d.messages.filter(m => m.threadId === threadId)).toHaveLength(sourceMessagesBefore);
    expect(snap.content).toBe('beta gamma');
  });

  it('refuses a snapshot it does not have', () => {
    const { d } = seeded();
    expect(branchFrom(d, { snapshotId: 'sn_nope', prompt: 'x' }, ctx)).toBeNull();
  });

  it('nests: a branch of a branch walks back to the root', () => {
    const { d, threadId, replyId, partId } = seeded();
    const s1 = freezeSelection(d, replyId, partId, 'alpha', 0, ctx)!;
    const b1 = branchFrom(d, { snapshotId: s1.id, prompt: 'one' }, ctx)!;
    const r1 = addMessage(d, { threadId: b1.thread.id, author: { kind: 'model', provider: 'p', model: 'm' }, parts: [textPart('child reply')] }, ctx);
    const s2 = freezeSelection(d, r1.id, r1.parts[0]!.id, 'child', 0, ctx)!;
    const b2 = branchFrom(d, { snapshotId: s2.id, prompt: 'two' }, ctx)!;
    expect(ancestorChain(d, b2.thread.id)).toEqual([threadId, b1.thread.id, b2.thread.id]);
  });
});

describe('synthesis', () => {
  it('links one new thread to every source and leaves the originals intact', () => {
    const { d, replyId, partId } = seeded();
    const a = freezeSelection(d, replyId, partId, 'alpha', 0, ctx)!;
    const b = freezeSelection(d, replyId, partId, 'delta', 17, ctx)!;
    const threadsBefore = d.threads.map(t => ({ ...t }));

    const res = synthesize(d, { snapshotIds: [a.id, b.id], prompt: 'combine' }, ctx)!;
    expect(res.thread.kind).toBe('synthesis');
    expect(res.relations).toHaveLength(2);
    expect(res.relations.map(r => r.snapshotId).sort()).toEqual([a.id, b.id].sort());
    for (const before of threadsBefore) {
      const after = d.threads.find(t => t.id === before.id)!;
      expect(after.kind).toBe(before.kind);
    }
  });

  it('needs at least two sources', () => {
    const { d, replyId, partId } = seeded();
    const a = freezeSelection(d, replyId, partId, 'alpha', 0, ctx)!;
    expect(synthesize(d, { snapshotIds: [a.id], prompt: 'x' }, ctx)).toBeNull();
    expect(synthesize(d, { snapshotIds: [a.id, 'sn_nope'], prompt: 'x' }, ctx)).toBeNull();
  });
});

describe('runs', () => {
  it('one submission is accepted once, however many times it is sent', () => {
    const { d, threadId } = seeded();
    const input = { submissionId: 'sub-1', threadId, provider: 'anthropic', model: 'opus' };
    const first = acceptRun(d, input, ctx);
    const second = acceptRun(d, input, ctx);
    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.run.id).toBe(first.run.id);
    expect(d.runs).toHaveLength(1);
  });

  it('a completed submission is not re-accepted, so a replayed send cannot charge twice', () => {
    const { d, threadId } = seeded();
    const input = { submissionId: 'sub-1', threadId, provider: 'p', model: 'm' };
    const { run } = acceptRun(d, input, ctx);
    setRunStatus(d, run.id, 'completed', ctx);
    expect(acceptRun(d, input, ctx).duplicate).toBe(true);
    expect(d.runs).toHaveLength(1);
  });

  it('retry adds an attempt and preserves the earlier one with its partial output', () => {
    const { d, threadId } = seeded();
    const { run } = acceptRun(d, { submissionId: 'sub-1', threadId, provider: 'p', model: 'm' }, ctx);
    const partial = addMessage(d, { threadId, author: { kind: 'model', provider: 'p', model: 'm' }, parts: [textPart('half an ans')], producedByRunId: run.id, provisional: true }, ctx);
    setRunStatus(d, run.id, 'interrupted', ctx, { error: 'refreshed mid-stream' });

    const again = retryRun(d, run.id, ctx)!;
    expect(again.attempt).toBe(2);
    expect(again.submissionId).toBe(run.submissionId);
    expect(d.runs).toHaveLength(2);
    // the interrupted attempt's text survives, and stops being provisional
    expect(d.messages.find(m => m.id === partial.id)?.parts[0]).toMatchObject({ kind: 'text', text: 'half an ans' });
    expect(d.messages.find(m => m.id === partial.id)?.provisional).toBeUndefined();
  });

  it('a cancelled run keeps what already arrived', () => {
    const { d, threadId } = seeded();
    const { run } = acceptRun(d, { submissionId: 's', threadId, provider: 'p', model: 'm' }, ctx);
    addMessage(d, { threadId, author: { kind: 'model', provider: 'p', model: 'm' }, parts: [textPart('partial')], producedByRunId: run.id, provisional: true }, ctx);
    setRunStatus(d, run.id, 'cancelled', ctx);
    expect(d.messages.some(m => m.parts.some(p => p.kind === 'text' && p.text === 'partial'))).toBe(true);
    expect(d.runs[0]!.endedAt).toBe(ctx.now);
  });
});

describe('outputs', () => {
  it('versions within a family, and ignores an identical re-save', () => {
    const d = doc();
    const first = saveOutputVersion(d, null, [textPart('# v1')], ctx);
    expect(first.created).toBe(true);
    expect(first.output.version).toBe(1);
    const same = saveOutputVersion(d, first.output.familyId, [textPart('# v1')], ctx);
    expect(same.created).toBe(false);
    expect(d.outputs).toHaveLength(1);
    const next = saveOutputVersion(d, first.output.familyId, [textPart('# v2')], ctx);
    expect(next.output.version).toBe(2);
    // the earlier version is immutable
    expect(d.outputs[0]!.parts[0]).toMatchObject({ text: '# v1' });
  });
});

describe('layout is separate from content', () => {
  it('a new card goes beside its source and moves nothing else', () => {
    const { d, threadId, replyId, partId } = seeded();
    setGeometry(d, threadId, { x: 100, y: 200 });
    const others = { ...d.layouts[0]!.entries };
    const snap = freezeSelection(d, replyId, partId, 'beta', 6, ctx)!;
    const b = branchFrom(d, { snapshotId: snap.id, prompt: 'x' }, ctx)!;

    const entries = d.layouts[0]!.entries;
    expect(entries[threadId]).toEqual(others[threadId]);
    expect(entries[b.thread.id]!.x).toBeGreaterThan(entries[threadId]!.x);
  });

  it('moving or resizing a card changes no message, snapshot or relation', () => {
    const { d, threadId } = seeded();
    const before = JSON.stringify({ m: d.messages, s: d.snapshots, r: d.relations });
    setGeometry(d, threadId, { x: 9, y: 9, w: 800, h: 600, collapsed: true });
    placeBeside(d, 'th_other', threadId);
    expect(JSON.stringify({ m: d.messages, s: d.snapshots, r: d.relations })).toBe(before);
  });

  it('placement is deterministic, so a re-import lands in the same place', () => {
    const a = doc(); const b = doc();
    placeBeside(a, 'th_fixed', null);
    placeBeside(b, 'th_fixed', null);
    placeBeside(a, 'th_child', 'th_fixed');
    placeBeside(b, 'th_child', 'th_fixed');
    expect(a.layouts[0]!.entries['th_child']).toEqual(b.layouts[0]!.entries['th_child']);
  });
});

describe('deletion', () => {
  it('removing a thread takes its messages, edges and geometry, and nothing else', () => {
    const { d, threadId, replyId, partId } = seeded();
    const snap = freezeSelection(d, replyId, partId, 'beta', 6, ctx)!;
    const b = branchFrom(d, { snapshotId: snap.id, prompt: 'x' }, ctx)!;
    expect(deleteThread(d, b.thread.id, ctx)).toBe(true);
    expect(d.threads.map(t => t.id)).toEqual([threadId]);
    expect(d.relations).toHaveLength(0);
    expect(d.layouts[0]!.entries[b.thread.id]).toBeUndefined();
    // the frozen evidence outlives the card that cited it
    expect(d.snapshots).toHaveLength(1);
  });
});

describe('editing bumps a revision', () => {
  it('so that an anchor taken earlier can tell it changed', () => {
    const { d, replyId, partId } = seeded();
    const before = d.messages.find(m => m.id === replyId)!.rev;
    editMessagePart(d, replyId, partId, 'alpha BETA gamma delta', ctx);
    expect(d.messages.find(m => m.id === replyId)!.rev).toBe(before + 1);
  });
});
