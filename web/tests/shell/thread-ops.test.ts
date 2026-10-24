import { createThreadIn, deleteThreadIn, emptyState, resolveThreadTitle, visibleThreads } from '../../src/db/thread-ops';
import type { PersistedState } from '../../src/db/types';

const fresh = (): PersistedState => emptyState();

describe('createThreadIn (mirrors app.js startNewChat)', () => {
  it('numbers titles from chatCount and gives the exact legacy thread shape', () => {
    const s = fresh();
    const a = createThreadIn(s, 1000);
    const b = createThreadIn(s, 2000);
    expect(s.threads[a]!.title).toBe('Untitled chat');
    expect(s.threads[b]!.title).toBe('Untitled chat 2');
    expect(s.chatCount).toBe(3);
    expect(s.threads[a]).toEqual({
      kind: 'chat', title: 'Untitled chat', stream: '', docContent: '<p><br></p>',
      tokenIn: 0, tokenCacheHit: 0, tokenOut: 0, cost: 0,
      highlights: [], branchSnapshots: {}, branchRecents: {},
    });
    expect(s.dynamic).toEqual([{ id: a, title: 'Untitled chat' }, { id: b, title: 'Untitled chat 2' }]);
    expect(s.current).toBe(b);
  });
});

describe('deleteThreadIn (mirrors app.js deleteThread)', () => {
  it('removes the thread, records the tombstone, and falls back to doc-main', () => {
    const s = fresh();
    const id = createThreadIn(s, 1);
    expect(deleteThreadIn(s, id)).toBe(true);
    expect(s.threads[id]).toBeUndefined();
    expect(s.dynamic).toEqual([]);
    expect(s.deletedThreads).toEqual([id]);
    expect(s.current).toBe('doc-main');
  });
  it('never deletes doc-main', () => {
    const s = fresh();
    expect(deleteThreadIn(s, 'doc-main')).toBe(false);
    expect(s.deletedThreads).toEqual([]);
  });
  it('tombstones a seed thread that has no persisted entry', () => {
    const s = fresh();
    expect(deleteThreadIn(s, 'pricing')).toBe(true);
    expect(visibleThreads(s).map(r => r.id)).not.toContain('pricing');
  });
  it('does not duplicate tombstones and leaves other threads alone', () => {
    const s = fresh();
    const a = createThreadIn(s, 1);
    const b = createThreadIn(s, 2);
    s.threads[b]!.stream = '<p class="x">rendered <span class="highlighted" data-hid="h1">html</span></p>';
    deleteThreadIn(s, a);
    deleteThreadIn(s, a);
    expect(s.deletedThreads).toEqual([a]);
    expect(s.threads[b]!.stream).toContain('data-hid="h1"');
  });
});

describe('visibleThreads', () => {
  it('lists seeds then dynamic threads, hiding deleted ones', () => {
    const s = fresh();
    const id = createThreadIn(s, 5);
    expect(visibleThreads(s).map(r => r.id)).toEqual(['doc-main', 'pricing', 'onboarding', 'planning', id]);
  });
  it('does not list a thread twice if it is in dynamic and a seed', () => {
    const s = fresh();
    s.dynamic.push({ id: 'pricing', title: 'x' });
    expect(visibleThreads(s).filter(r => r.id === 'pricing')).toHaveLength(1);
  });
});

describe('resolveThreadTitle (mirrors app.js resolveThreadTitle)', () => {
  it('lets an untitled chat borrow its h1', () => {
    expect(resolveThreadTitle({ kind: 'chat', title: 'Untitled chat 3', h1: 'Why <em>tides</em> exist' }, 'x')).toBe('Why tides exist');
  });
  it('keeps a real title over the h1', () => {
    expect(resolveThreadTitle({ kind: 'chat', title: 'Mine', h1: 'Other' }, 'x')).toBe('Mine');
  });
  it('never borrows for kind=doc', () => {
    expect(resolveThreadTitle({ kind: 'doc', title: 'Untitled chat', h1: 'Other' }, 'x')).toBe('Untitled chat');
  });
});
