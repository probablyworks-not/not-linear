import { describe, expect, it } from 'vitest';
import { canvasSearchItems } from '../../src/canvas/search';
import { emptyDoc } from '../../src/canvas/types';
import type { CanvasDoc, CanvasMessage, CanvasThread } from '../../src/canvas/types';

// UI-08: a canvas result is a thread (jump to it) or a finished reply (open its full text). A
// still-streaming reply has no settled text to preview, so it must not show up as a result yet.

function thread(id: string, title: string): CanvasThread {
  return { id, title, kind: 'root', createdAt: 1, updatedAt: 1, rev: 1 };
}

function message(id: string, threadId: string, over: Partial<CanvasMessage> = {}): CanvasMessage {
  return {
    id, threadId, seq: 0, author: { kind: 'human' }, parts: [], createdAt: 1, updatedAt: 1, rev: 1,
    ...over,
  };
}

const BASE: CanvasDoc = emptyDoc({ id: 'c1', projectId: 'p1', title: 'Canvas', counts: { threads: 0, messages: 0, outputs: 0 }, createdAt: 1, updatedAt: 1, rev: 1 });

describe('canvas search results', () => {
  it('lists every thread by title', () => {
    const doc: CanvasDoc = { ...BASE, threads: [thread('th_1', 'Checkout flow'), thread('th_2', 'Pay later')] };
    const items = canvasSearchItems(doc);
    expect(items.filter(i => i.kind === 'thread').map(i => i.title)).toEqual(['Checkout flow', 'Pay later']);
  });

  it('adds one result per finished model reply, previewing its text', () => {
    const doc: CanvasDoc = {
      ...BASE,
      threads: [thread('th_1', 'Checkout flow')],
      messages: [message('ms_1', 'th_1', {
        author: { kind: 'model', provider: 'anthropic', model: 'claude' },
        parts: [{ id: 'pt_1', state: 'ready', kind: 'text', text: 'Use React Flow for the canvas.' }],
      })],
    };
    const items = canvasSearchItems(doc);
    const replies = items.filter(i => i.kind === 'message');
    expect(replies).toHaveLength(1);
    expect(replies[0]).toMatchObject({ threadId: 'th_1', messageId: 'ms_1', title: 'Checkout flow', sub: 'Use React Flow for the canvas.' });
  });

  it('leaves out a reply that is still streaming', () => {
    const doc: CanvasDoc = {
      ...BASE,
      threads: [thread('th_1', 'Checkout flow')],
      messages: [message('ms_1', 'th_1', {
        author: { kind: 'model', provider: 'anthropic', model: 'claude' }, provisional: true,
        parts: [{ id: 'pt_1', state: 'pending', kind: 'text', text: '' }],
      })],
    };
    expect(canvasSearchItems(doc).filter(i => i.kind === 'message')).toHaveLength(0);
  });

  it('leaves out a human message entirely', () => {
    const doc: CanvasDoc = {
      ...BASE,
      threads: [thread('th_1', 'Checkout flow')],
      messages: [message('ms_1', 'th_1', { parts: [{ id: 'pt_1', state: 'ready', kind: 'text', text: 'Should we build this?' }] })],
    };
    expect(canvasSearchItems(doc).filter(i => i.kind === 'message')).toHaveLength(0);
  });

  it('truncates a long preview with an ellipsis', () => {
    const long = 'x'.repeat(200);
    const doc: CanvasDoc = {
      ...BASE,
      threads: [thread('th_1', 'Checkout flow')],
      messages: [message('ms_1', 'th_1', {
        author: { kind: 'model', provider: 'anthropic', model: 'claude' },
        parts: [{ id: 'pt_1', state: 'ready', kind: 'text', text: long }],
      })],
    };
    const sub = canvasSearchItems(doc).find(i => i.kind === 'message')!.sub!;
    expect(sub.endsWith('…')).toBe(true);
    expect(sub.length).toBe(140);
  });
});
