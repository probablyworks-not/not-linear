import { describe, expect, it } from 'vitest';
import { canReparent, collectIds, deepCopyBlocks, newNote, pathOf, uid, withDuplicate } from '../../src/notes/notes-ops';
import type { LegacyNote } from '../../src/notes/types';

const n = (id: string, parent: string | null, extra: object = {}): LegacyNote => ({ id, title: id, emoji: '📄', tags: ['t'], parent, blocks: [{ id: `${id}-b`, type: 'text', text: id }], ...extra });
const tree = [n('a', null), n('b', 'a'), n('c', 'b'), n('d', null)];

describe('tree helpers', () => {
  it('collects a subtree and a path', () => {
    expect(collectIds(tree, 'a').sort()).toEqual(['a', 'b', 'c']);
    expect(pathOf(tree, 'c').map(x => x.id)).toEqual(['a', 'b', 'c']);
  });
  it('survives a parent cycle in bad data', () => {
    expect(pathOf([n('x', 'y'), n('y', 'x')], 'x').length).toBe(2);
  });
});

describe('newNote', () => {
  it('has legacy shape: icon, empty title, one empty text block, parent', () => {
    const p = newNote('a', 5);
    expect(p).toMatchObject({ emoji: '📄', title: '', tags: [], parent: 'a', createdAt: 5, updatedAt: 5 });
    expect(p.blocks).toEqual([{ id: expect.stringMatching(/^b_/), type: 'text', text: '' }]);
    expect(p.id).toMatch(/^n_[a-z0-9]+$/);
  });
  it('uid has the legacy shape', () => expect(uid('x')).toMatch(/^x_[a-z0-9]{1,7}$/));
});

describe('duplicate', () => {
  it('copies the whole subtree with fresh ids, keeps its shape, and places the copy after the original', () => {
    const src = [...tree, { ...n('e', 'a'), cover: { src: 'x', posY: 5 }, branches: [{ bid: 'nb' }] }];
    const out = withDuplicate(src, 'a')!;
    const added = out.notes.filter(x => !src.some(o => o.id === x.id));
    expect(added).toHaveLength(4);
    const top = out.notes.find(x => x.id === out.topId)!;
    expect(top.parent).toBeNull();
    expect(out.notes[out.notes.findIndex(x => x.id === 'a') + 1]!.id).toBe(top.id);
    const kidTitles = (id: string) => out.notes.filter(x => x.parent === id).map(x => x.title).sort();
    expect(kidTitles(top.id)).toEqual(['b', 'e']);
    const copyB = out.notes.find(x => x.parent === top.id && x.title === 'b')!;
    expect(kidTitles(copyB.id)).toEqual(['c']);
    for (const c of added) {
      expect(c).not.toHaveProperty('cover');
      expect(c).not.toHaveProperty('branches');
      expect(src.some(o => o.blocks.some(b => (c.blocks as { id: string }[]).some(x => x.id === b.id)))).toBe(false);
    }
    expect(src).toHaveLength(5); // input untouched
  });
  it('is null for an unknown page', () => expect(withDuplicate(tree, 'nope')).toBeNull());
  it('re-ids nested blocks, children and columns', () => {
    const [c] = deepCopyBlocks([{ id: 'x', type: 'cols', cols: [[{ id: 'y', type: 'text', children: [{ id: 'z', type: 'text' }] }]] }]);
    const ids = JSON.stringify(c);
    expect(ids).not.toMatch(/"id":"[xyz]"/);
  });
});

describe('reparent', () => {
  it('allows a move, to top level too', () => {
    expect(canReparent(tree, 'd', 'a')).toBe(true);
    expect(canReparent(tree, 'c', null)).toBe(true);
  });
  it('refuses a no-op, itself, a descendant, an unknown target and an unknown page', () => {
    expect(canReparent(tree, 'd', null)).toBe(false);
    expect(canReparent(tree, 'a', 'a')).toBe(false);
    expect(canReparent(tree, 'a', 'c')).toBe(false);
    expect(canReparent(tree, 'a', 'zzz')).toBe(false);
    expect(canReparent(tree, 'zzz', 'a')).toBe(false);
  });
});
