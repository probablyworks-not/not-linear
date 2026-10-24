import { parseIconToken, cycleIcon, THREAD_ICON_CYCLE, PROJECT_ICON_CYCLE } from '../../src/lib/mind-garden';

describe('Mind Garden tokens', () => {
  it('parses icon:<id>[:colour] and rejects anything else', () => {
    expect(parseIconToken('icon:book')?.id).toBe('book');
    expect(parseIconToken('icon:book:c0392b')).toEqual({ id: 'book', color: '#c0392b' });
    for (const bad of ['', '📘', 'book', 'icon:', undefined, null, 5]) expect(parseIconToken(bad)).toBeNull();
  });
  it('default glyphs cycle by list position', () => {
    for (const c of [THREAD_ICON_CYCLE, PROJECT_ICON_CYCLE] as ReadonlyArray<ReadonlyArray<{ id: string; color: string }>>) {
      expect(cycleIcon(c, 0)).toEqual(cycleIcon(c, c.length));
      expect(cycleIcon(c, 1)).toEqual(c[1]);
    }
  });
});
