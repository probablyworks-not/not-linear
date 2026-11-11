import { describe, expect, it } from 'vitest';
import { planPages } from '../../../feature-canvas/pagination-prototype/plan-pages.mjs';

const blocks = (...heights: number[]) => heights.map((height, i) => ({ id: `b${i}`, height }));

describe('HTML pagination planning prototype', () => {
  it('sizes a short page to its content plus padding', () => {
    expect(planPages(blocks(80, 120), { height: 600, padding: 20 })).toEqual([
      { ids: ['b0', 'b1'], height: 240, oversized: false },
    ]);
  });
  it('fills bounded sections and shrinks the last section', () => {
    expect(planPages(blocks(250, 250, 300, 100), { height: 600, padding: 20 })).toEqual([
      { ids: ['b0', 'b1'], height: 600, oversized: false },
      { ids: ['b2', 'b3'], height: 440, oversized: false },
    ]);
  });
  it('keeps headings with following content without reordering blocks', () => {
    const measured = [{ id: 'intro', height: 400 }, { id: 'heading', height: 50, keepWithNext: true }, { id: 'paragraph', height: 200 }];
    expect(planPages(measured, { height: 600, padding: 20 }).map(p => p.ids)).toEqual([
      ['intro'], ['heading', 'paragraph'],
    ]);
  });
  it('does not force a heading and oversized chart into a growing page', () => {
    const measured = [{ id: 'heading', height: 50, keepWithNext: true }, { id: 'chart', height: 900 }];
    expect(planPages(measured, { height: 600, padding: 20 })).toEqual([
      { ids: ['heading'], height: 600, oversized: false },
      { ids: ['chart'], height: 940, oversized: true },
    ]);
  });
  it('isolates oversized content and never emits empty intermediate pages', () => {
    const pages = planPages(blocks(900, 100, 800), { height: 600, padding: 20 });
    expect(pages.map(p => p.ids)).toEqual([['b0'], ['b1'], ['b2']]);
    expect(pages.map(p => p.oversized)).toEqual([true, false, true]);
  });
  it('starts an empty generation with one placeholder page', () => {
    expect(planPages([], { height: 600, padding: 20 })).toEqual([
      { ids: [], height: 600, oversized: false },
    ]);
  });
  it('accepts exact boundaries without an extra empty page', () => {
    expect(planPages(blocks(280, 280), { height: 600, padding: 20 })).toHaveLength(1);
  });
  it('is deterministic and leaves source measurements unchanged', () => {
    const measured = Object.freeze(blocks(100, 200, 300).map(b => Object.freeze(b)));
    expect(planPages(measured)).toEqual(planPages(measured));
    expect(measured.map(b => b.height)).toEqual([100, 200, 300]);
  });
  it.each([NaN, Infinity, -1])('rejects invalid block heights: %s', height => {
    expect(() => planPages([{ id: 'bad', height }])).toThrow();
  });
  it.each([0, -1, NaN, Infinity, 40])('rejects unusable page heights: %s', height => {
    expect(() => planPages([], { height, padding: 20 })).toThrow();
  });
  it('rejects duplicate block identities', () => {
    expect(() => planPages([{ id: 'same', height: 1 }, { id: 'same', height: 2 }])).toThrow();
  });
  it('preserves every source block exactly once across a large report', () => {
    const measured = Array.from({ length: 1000 }, (_, i) => ({ id: `b${i}`, height: 20 + i % 150 }));
    const pages = planPages(measured);
    expect(pages.flatMap(p => p.ids)).toEqual(measured.map(b => b.id));
    expect(pages.every(p => p.height <= 640)).toBe(true);
  });
});
