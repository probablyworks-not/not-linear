import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { bloomFor, shapeFor, seedRand, timeAgo, tintFor } from '../../../src/notes/bento';
import { notesFns } from '../helpers/legacy-notes-source';

// Checked against the REAL legacy functions, so a card keeps the colour and shape it has in the classic app.
interface Legacy {
  tintFor(v: unknown): string; seedRand(s: string): () => number; shapeFor(n: { id: string }, i: number): string; timeAgo(ts: number): string;
}
const legacy = notesFns<Legacy>(
  ['tintFor', 'seedRand', 'shapeFor', 'timeAgo'],
  { BENTO_TINTS: ['t0', 't1', 't2', 't3', 't4', 't5', 't6', 't7'] },
  '{ tintFor, seedRand, shapeFor, timeAgo }',
);

describe('bento helpers match legacy', () => {
  it('tint', () => fc.assert(fc.property(fc.oneof(fc.string(), fc.constantFrom('📄', 'icon:star:#fff', 'img:data:x', undefined, null)), v => {
    expect(tintFor(v)).toBe(legacy.tintFor(v));
  }), { numRuns: 400 }));

  it('seeded random sequence', () => fc.assert(fc.property(fc.string({ maxLength: 20 }), s => {
    const a = seedRand(s); const b = legacy.seedRand(s);
    for (let i = 0; i < 5; i++) expect(a()).toBe(b());
  }), { numRuns: 300 }));

  it('shape', () => fc.assert(fc.property(fc.stringMatching(/^n_[a-z0-9]{1,7}$/), fc.integer({ min: 0, max: 30 }), (id, i) => {
    expect(shapeFor(id, i)).toBe(legacy.shapeFor({ id }, i));
  }), { numRuns: 400 }));

  it('time ago, across every range', () => fc.assert(fc.property(fc.integer({ min: 0, max: 90 * 24 * 3600 * 1000 }), ms => {
    const ts = Date.now() - ms;
    expect(timeAgo(ts)).toBe(legacy.timeAgo(ts));
  }), { numRuns: 400 }));
});

describe('shape', () => {
  it('pins the most recent page as the big tile and uses every shape', () => {
    expect(shapeFor('anything', 0)).toBe('big');
    const seen = new Set(Array.from({ length: 200 }, (_, i) => shapeFor(`n_${i}`, 1)));
    expect(seen).toEqual(new Set(['', 'wide', 'tall', 'big']));
  });
  it('is stable for a given page', () => expect(shapeFor('n_abc', 3)).toBe(shapeFor('n_abc', 3)));
  it('bloom is bigger on bigger cards and tilts at most 10 degrees', () => {
    for (let i = 0; i < 50; i++) {
      const b = bloomFor(`n_${i}`, 'big');
      expect(b.size).toBeGreaterThanOrEqual(150);
      expect(Math.abs(b.rotate)).toBeLessThanOrEqual(10);
    }
  });
  it('empty timestamps give nothing', () => expect(timeAgo(undefined)).toBe(''));
});
