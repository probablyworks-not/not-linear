import { describe, expect, it } from 'vitest';
import { quoteBlock, resolveContext } from '../../src/canvas/context/resolve';
import {
  addMessage, branchFrom, createRootThread, freezeSelection, setGeometry, synthesize, textPart,
} from '../../src/canvas/domain/commands';
import { emptyDoc, type CanvasDoc } from '../../src/canvas/types';

// What the model is given. The two properties that matter: an ancestor's exchange is carried into
// its branches, and layout is not an input — moving a card must not change a single byte of this.

const ctx = { now: 1 };
const doc = (): CanvasDoc => emptyDoc({
  id: 'cv_1', projectId: 'p1', title: 'T',
  counts: { threads: 0, messages: 0, outputs: 0 }, createdAt: 0, updatedAt: 0, rev: 1,
});

function conversation(): { d: CanvasDoc; rootId: string; replyId: string; partId: string } {
  const d = doc();
  const { thread } = createRootThread(d, 'what is a widget?', ctx);
  const reply = addMessage(d, {
    threadId: thread.id, author: { kind: 'model', provider: 'p', model: 'm' },
    parts: [textPart('A widget has a sprocket and a flange.')],
  }, ctx);
  return { d, rootId: thread.id, replyId: reply.id, partId: reply.parts[0]!.id };
}

describe('resolving a thread s context', () => {
  it('is the thread s own exchange for a root', () => {
    const { d, rootId } = conversation();
    const { messages } = resolveContext(d, rootId);
    expect(messages).toEqual([
      { role: 'user', content: 'what is a widget?' },
      { role: 'assistant', content: 'A widget has a sprocket and a flange.' },
    ]);
  });

  it('carries the ancestor chain into a branch, with the excerpt in front of the question', () => {
    const { d, replyId, partId } = conversation();
    const snap = freezeSelection(d, replyId, partId, 'sprocket', 13, ctx)!;
    const branch = branchFrom(d, { snapshotId: snap.id, prompt: 'what does the sprocket do?' }, ctx)!;

    const { messages, snapshots } = resolveContext(d, branch.thread.id);
    expect(messages.map(m => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(messages[0]!.content).toBe('what is a widget?');
    expect(messages[2]!.content).toBe('> sprocket\n\nwhat does the sprocket do?');
    expect(snapshots.map(s => s.id)).toEqual([snap.id]);
  });

  it('puts every source in front of a synthesis question', () => {
    const { d, replyId, partId } = conversation();
    const a = freezeSelection(d, replyId, partId, 'sprocket', 13, ctx)!;
    const b = freezeSelection(d, replyId, partId, 'flange', 27, ctx)!;
    const s = synthesize(d, { snapshotIds: [a.id, b.id], prompt: 'how do they fit together?' }, ctx)!;

    const { messages, manifest } = resolveContext(d, s.thread.id);
    const last = messages[messages.length - 1]!;
    expect(last.content).toContain('> sprocket');
    expect(last.content).toContain('> flange');
    expect(last.content).toContain('how do they fit together?');
    expect(manifest.snapshotIds).toEqual([a.id, b.id]);
  });

  it('does not change when a card is moved, resized, collapsed or hidden', () => {
    const { d, rootId, replyId, partId } = conversation();
    const snap = freezeSelection(d, replyId, partId, 'flange', 27, ctx)!;
    const branch = branchFrom(d, { snapshotId: snap.id, prompt: 'and the flange?' }, ctx)!;
    const before = JSON.stringify(resolveContext(d, branch.thread.id));

    setGeometry(d, rootId, { x: 900, y: -200, w: 1200, h: 800, collapsed: true });
    setGeometry(d, branch.thread.id, { hidden: true });

    expect(JSON.stringify(resolveContext(d, branch.thread.id))).toBe(before);
  });

  it('keeps the frozen excerpt after the source is edited away', () => {
    const { d, replyId, partId } = conversation();
    const snap = freezeSelection(d, replyId, partId, 'sprocket', 13, ctx)!;
    const branch = branchFrom(d, { snapshotId: snap.id, prompt: 'more?' }, ctx)!;
    // the source is rewritten after the branch was made
    const msg = d.messages.find(m => m.id === replyId)!;
    const part = msg.parts.find(p => p.id === partId)!;
    if (part.kind === 'text') part.text = 'completely different now';
    msg.rev += 1;

    const { messages } = resolveContext(d, branch.thread.id);
    // the question still carries what the user was actually looking at
    expect(messages[messages.length - 1]!.content).toContain('> sprocket');
  });

  it('skips empty messages rather than sending blanks', () => {
    const d = doc();
    const { thread } = createRootThread(d, 'hello', ctx);
    addMessage(d, { threadId: thread.id, author: { kind: 'model', provider: 'p', model: 'm' }, parts: [textPart('   ')] }, ctx);
    expect(resolveContext(d, thread.id).messages).toHaveLength(1);
  });
});

describe('quoteBlock', () => {
  it('prefixes every line, so a multi-line excerpt stays one quote', () => {
    expect(quoteBlock([{ content: 'one\ntwo' } as never])).toBe('> one\n> two');
  });
  it('separates several excerpts with a blank quoted line', () => {
    expect(quoteBlock([{ content: 'a' } as never, { content: 'b' } as never])).toBe('> a\n>\n> b');
  });
  it('is empty for no sources', () => {
    expect(quoteBlock([])).toBe('');
  });
});
