import { describe, expect, it } from 'vitest';
import { resolveAnchor, resolveThreadSources } from '../../src/canvas/anchors';
import {
  addMessage, branchFrom, createRootThread, editMessagePart, freezeSelection, textPart,
} from '../../src/canvas/domain/commands';
import { emptyDoc, type CanvasDoc } from '../../src/canvas/types';

// AC-05: a source edited or deleted after generation leaves the historical output interpretable.
// The resolver reports `changed` or `missing` and always hands back the frozen copy. It must never
// silently relink to different text, and nothing here regenerates anything.

const ctx = { now: 1 };
const REPLY = 'alpha beta gamma delta';

function seeded(): { d: CanvasDoc; replyId: string; partId: string } {
  const d = emptyDoc({
    id: 'cv_1', projectId: null, title: 'T',
    counts: { threads: 0, messages: 0, outputs: 0 }, createdAt: 0, updatedAt: 0, rev: 1,
  });
  const { thread } = createRootThread(d, 'q', ctx);
  const reply = addMessage(d, {
    threadId: thread.id,
    author: { kind: 'model', provider: 'p', model: 'm' },
    parts: [textPart(REPLY)],
  }, ctx);
  return { d, replyId: reply.id, partId: reply.parts[0]!.id };
}

describe('anchor resolution', () => {
  it('resolves to ok while the source is untouched', () => {
    const { d, replyId, partId } = seeded();
    const snap = freezeSelection(d, replyId, partId, 'beta gamma', 6, ctx)!;
    const r = resolveAnchor(snap, d);
    expect(r.status).toBe('ok');
    expect(r.current).toBe('beta gamma');
    expect(r.offset).toEqual({ start: 6, end: 16 });
  });

  it('reports changed, and where the quote moved to, when the source is edited around it', () => {
    const { d, replyId, partId } = seeded();
    const snap = freezeSelection(d, replyId, partId, 'beta gamma', 6, ctx)!;
    editMessagePart(d, replyId, partId, `PREFIX ${REPLY}`, ctx);

    const r = resolveAnchor(snap, d);
    expect(r.status).toBe('changed');
    expect(r.frozen).toBe('beta gamma');
    expect(r.offset).toEqual({ start: 13, end: 23 });
  });

  it('reports missing when the quoted text is gone, and still hands back the frozen copy', () => {
    const { d, replyId, partId } = seeded();
    const snap = freezeSelection(d, replyId, partId, 'beta gamma', 6, ctx)!;
    editMessagePart(d, replyId, partId, 'something else entirely', ctx);

    const r = resolveAnchor(snap, d);
    expect(r.status).toBe('missing');
    expect(r.frozen).toBe('beta gamma');
    expect(r.current).toBeUndefined();
  });

  it('reports missing when the whole message is deleted', () => {
    const { d, replyId, partId } = seeded();
    const snap = freezeSelection(d, replyId, partId, 'beta', 6, ctx)!;
    d.messages = d.messages.filter(m => m.id !== replyId);
    expect(resolveAnchor(snap, d).status).toBe('missing');
  });

  it('does not relink to a different occurrence at the same offsets', () => {
    const { d, replyId, partId } = seeded();
    const snap = freezeSelection(d, replyId, partId, 'beta gamma', 6, ctx)!;
    // same length at the same offsets, entirely different words
    editMessagePart(d, replyId, partId, 'alpha XXXX YYYYY delta', ctx);
    const r = resolveAnchor(snap, d);
    expect(r.status).toBe('missing');
    expect(r.current).not.toBe('XXXX YYYYY');
  });

  it('an old answer still resolves its own version after the source moves on', () => {
    const { d, replyId, partId } = seeded();
    const snap = freezeSelection(d, replyId, partId, 'gamma', 11, ctx)!;
    const branch = branchFrom(d, { snapshotId: snap.id, prompt: 'why gamma?' }, ctx)!;
    editMessagePart(d, replyId, partId, 'rewritten from scratch', ctx);

    const [source] = resolveThreadSources(d, branch.thread.id);
    expect(source!.resolution.status).toBe('missing');
    // the branch and the evidence it was given both survive the edit
    expect(source!.snapshot.content).toBe('gamma');
    expect(d.threads.some(t => t.id === branch.thread.id)).toBe(true);
  });

  it('a whole-message anchor notices the message changed', () => {
    const { d, replyId, partId } = seeded();
    const snap = freezeSelection(d, replyId, partId, REPLY, 0, ctx)!;
    expect(resolveAnchor(snap, d).status).toBe('ok');
    editMessagePart(d, replyId, partId, `${REPLY} plus more`, ctx);
    expect(resolveAnchor(snap, d).status).toBe('changed');
  });
});
