import { enterTarget, filterItems, moveActive, splitHighlight } from '../../src/search/palette';

// Each expectation below is a rule read off app.js:6159-6236, not an invention.
const items = [
  { title: 'Non-linear chat system' },
  { title: 'Pricing research' },
  { title: 'Onboarding flow review', sub: 'Pricing research' },
  { title: 'Q3 planning notes' },
];

describe('filterItems', () => {
  it('an empty or blank query keeps everything, in order', () => {
    expect(filterItems(items, '')).toEqual(items);
    expect(filterItems(items, '   ')).toEqual(items);
  });
  it('is a case-insensitive substring match that preserves order (it is a filter, not a ranking)', () => {
    expect(filterItems(items, 'PRICING').map(i => i.title)).toEqual(['Pricing research', 'Onboarding flow review']);
    expect(filterItems(items, 'in').map(i => i.title)).toEqual(['Non-linear chat system', 'Pricing research', 'Onboarding flow review', 'Q3 planning notes']);
  });
  it('trims the query for matching', () => {
    expect(filterItems(items, '  plan  ').map(i => i.title)).toEqual(['Q3 planning notes']);
  });
  it('also searches the secondary text', () => {
    expect(filterItems(items, 'research').map(i => i.title)).toContain('Onboarding flow review');
  });
  it('returns nothing for a miss', () => {
    expect(filterItems(items, 'zzz')).toEqual([]);
  });
});

describe('splitHighlight', () => {
  it('splits around the first case-insensitive match, keeping the original casing', () => {
    expect(splitHighlight('Pricing research', 'RESE')).toEqual({ before: 'Pricing ', match: 'rese', after: 'arch' });
  });
  it('no query or no match leaves the text whole', () => {
    expect(splitHighlight('abc', '')).toEqual({ before: 'abc', match: '', after: '' });
    expect(splitHighlight('abc', 'x')).toEqual({ before: 'abc', match: '', after: '' });
  });
  it('only the first occurrence is marked', () => {
    expect(splitHighlight('banana', 'an')).toEqual({ before: 'b', match: 'an', after: 'ana' });
  });
  it('keeps markup-like text as plain text (React escapes it; nothing is parsed)', () => {
    expect(splitHighlight('a <b>bold</b> thing', '<b>')).toEqual({ before: 'a ', match: '<b>', after: 'bold</b> thing' });
  });
});

describe('moveActive (legacy clamps, never wraps)', () => {
  it('ArrowDown from nothing lands on the first result', () => {
    expect(moveActive(-1, 'ArrowDown', 4)).toBe(0);
  });
  it('ArrowUp from nothing ALSO lands on the first result, because legacy clamps the floor to 0', () => {
    expect(moveActive(-1, 'ArrowUp', 4)).toBe(0);
  });
  it('stops at both ends', () => {
    expect(moveActive(3, 'ArrowDown', 4)).toBe(3);
    expect(moveActive(0, 'ArrowUp', 4)).toBe(0);
  });
  it('steps by one', () => {
    expect(moveActive(1, 'ArrowDown', 4)).toBe(2);
    expect(moveActive(2, 'ArrowUp', 4)).toBe(1);
  });
});

describe('enterTarget', () => {
  it('opens the highlighted result, else the first', () => {
    expect(enterTarget(['a', 'b', 'c'], 2)).toBe('c');
    expect(enterTarget(['a', 'b', 'c'], -1)).toBe('a');
  });
  it('opens nothing when there are no results', () => {
    expect(enterTarget([], -1)).toBeUndefined();
  });
});
