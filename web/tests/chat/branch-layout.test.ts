import {
  applySize, branchRail, layoutPanels, openAncestors, resizeBounds, resizeDelta, stacking, BRANCH_STACK_GAP,
  type PanelMeasure, type ResizeStart,
} from '../../src/branch/layout';

const rail = { top: 80, bottom: 700 };
const panel = (id: string, over: Partial<PanelMeasure> = {}): PanelMeasure => ({
  id, parentBid: null, reader: false, collapsed: false, userSized: false, height: 200, anchor: { top: 300, height: 20 }, docY: 300, ...over,
});

describe('rail', () => {
  it('sits below the topbar and above the composer, with floors', () => {
    expect(branchRail(54, 900)).toEqual({ top: 70, bottom: 808 });
    expect(branchRail(100, 900)).toEqual({ top: 112, bottom: 808 });
    expect(branchRail(undefined, 900).top).toBe(70);
    expect(branchRail(54, 200).bottom).toBe(70 + 140); // never thinner than 140px
  });
});

describe('layoutPanels', () => {
  it('a panel sits level with its anchor, offset to put the header on it', () => {
    const l = layoutPanels([panel('a')], rail, 'a');
    expect(l.tops.a).toBe(300 + 10 - 22);
  });

  it('a collapsed panel centres its (short) header on the anchor', () => {
    const l = layoutPanels([panel('a', { collapsed: true, height: 46 })], rail, 'a');
    expect(l.tops.a).toBe(310 - 23);
  });

  it('two panels wanting the same spot are pushed apart, never overlapping', () => {
    const l = layoutPanels([panel('a'), panel('b', { docY: 301 })], rail, 'a');
    const [first, second] = [l.tops.a!, l.tops.b!].sort((x, y) => x - y);
    expect(second! - first!).toBeGreaterThanOrEqual(200 + BRANCH_STACK_GAP);
  });

  it('a column that would run off the bottom shifts up, but not above the rail', () => {
    const many = ['a', 'b', 'c'].map((id, i) => panel(id, { anchor: { top: 600 + i, height: 10 }, docY: 600 + i, height: 300 }));
    const l = layoutPanels(many, rail, 'a');
    const tops = Object.values(l.tops).sort((x, y) => x - y);
    expect(tops[0]).toBeGreaterThanOrEqual(rail.top);
    for (let i = 1; i < tops.length; i++) expect(tops[i]! - tops[i - 1]!).toBeGreaterThanOrEqual(300 + BRANCH_STACK_GAP);
  });

  it('a panel whose anchor has scrolled out of the rail fades out and takes no space', () => {
    const l = layoutPanels([panel('a', { anchor: { top: 2000, height: 20 } }), panel('b')], rail, 'b');
    expect(l.sourceOut.has('a')).toBe(true);
    expect(l.tops.a).toBeUndefined();
    expect(l.tops.b).toBeDefined();
  });

  it('a panel with no anchor on the page (its source is gone) still lays out, in order', () => {
    const l = layoutPanels([panel('a', { anchor: null }), panel('b', { anchor: null })], rail, 'a');
    expect(l.sourceOut.size).toBe(0);
    expect(l.tops.b! - l.tops.a!).toBeGreaterThanOrEqual(0);
  });

  it('a hand-placed panel keeps its own top, clamped to the rail, and is remembered', () => {
    const l = layoutPanels([panel('a', { userSized: true, top: 150 })], rail, 'a');
    expect(l.tops.a).toBe(150);
    expect(l.remember.has('a')).toBe(true);
    expect(layoutPanels([panel('a', { userSized: true, top: 5 })], rail, 'a').tops.a).toBe(rail.top);
    expect(layoutPanels([panel('a')], rail, 'a').remember.size).toBe(0);
  });

  it('a child snaps onto its open parent', () => {
    const l = layoutPanels([
      panel('p', { anchor: { top: 200, height: 20 } }),
      panel('c', { parentBid: 'p', anchor: { top: 400, height: 20 } }),
    ], rail, 'c');
    expect(l.tops.c).toBe(l.tops.p);
  });

  it('LEGACY QUIRK, kept: in a three-deep chain the grandchild takes the middle panel\'s own placed top, because legacy reads each parent\'s top before that parent has snapped', () => {
    const l = layoutPanels([
      panel('p', { anchor: { top: 200, height: 20 } }),
      panel('c', { parentBid: 'p', anchor: { top: 400, height: 20 } }),
      panel('g', { parentBid: 'c', anchor: { top: 500, height: 20 } }),
    ], rail, 'g');
    expect(l.tops.c).toBe(l.tops.p);
    expect(l.tops.g).not.toBe(l.tops.p);
    expect(l.tops.g).toBeGreaterThan(l.tops.c!);
  });

  it('ancestors of a reader panel are left stacked behind it, not repositioned (bug #037 family)', () => {
    const l = layoutPanels([
      panel('p'), panel('c', { parentBid: 'p', reader: true }),
    ], rail, 'c');
    expect(l.readerEclipsed.has('p')).toBe(true);
    expect(l.tops.p).toBeUndefined();
    expect(l.tops.c).toBeUndefined(); // reader panels are fixed-position, laid out by CSS
  });

  it('no panels, no layout', () => {
    expect(layoutPanels([], rail, null).tops).toEqual({});
  });

  it('survives a cycle in parent ids', () => {
    expect(() => layoutPanels([panel('a', { parentBid: 'b' }), panel('b', { parentBid: 'a' })], rail, 'a')).not.toThrow();
  });
});

describe('stacking', () => {
  const p = (id: string, parentBid: string | null = null, reader = false) => ({ id, parentBid, reader });

  it('the active panel is on top, its open ancestors are behind it, everything else below', () => {
    const s = stacking([p('root'), p('mid', 'root'), p('leaf', 'mid'), p('other')], 'leaf');
    expect(s.zIndex).toEqual({ root: 2, mid: 2, leaf: 3, other: 1 });
    expect([...s.behindActive].sort()).toEqual(['mid', 'root']);
  });

  it('reader mode is a focus state: only the active panel may keep it', () => {
    const s = stacking([p('a', null, true), p('b', null, true)], 'b');
    expect([...s.clearReader]).toEqual(['a']);
    expect(s.zIndex).toEqual({ a: 1, b: 60 });
  });

  it('openAncestors walks nearest first and stops at a closed parent', () => {
    const byId = { c: p('c', 'b'), b: p('b', 'a') };
    expect(openAncestors('c', byId)).toEqual(['b']); // 'a' is not open
    expect(openAncestors(null, byId)).toEqual([]);
  });
});

describe('resize', () => {
  const bounds = resizeBounds(rail, 1400, 900);
  const start = (edge: ResizeStart['edge']): ResizeStart => ({ edge, startX: 1000, startY: 400, startW: 420, startH: 360, startTop: 200, startBottom: 560 });

  it('bounds follow the viewport', () => {
    expect(bounds).toEqual({ minTop: 80, maxBottom: 876, minWidth: 340, maxWidth: 900, minHeight: 220 });
    expect(resizeBounds(rail, 500, 900).maxWidth).toBe(468);
    expect(resizeBounds(rail, 200, 900).maxWidth).toBe(340); // never below the minimum
  });

  it('dragging the left edge left makes it wider, and only wider', () => {
    expect(resizeDelta(start('left'), 900, 450, bounds)).toEqual({ width: 520 });
  });

  it('dragging the bottom edge down makes it taller', () => {
    expect(resizeDelta(start('bottom'), 1000, 500, bounds)).toEqual({ height: 460 });
  });

  it('the top edge moves the top and keeps the bottom fixed, and cannot cross the minimum height', () => {
    expect(resizeDelta(start('top'), 1000, 300, bounds)).toEqual({ top: 100, height: 460 });
    expect(resizeDelta(start('top'), 1000, 900, bounds)).toEqual({ top: 340, height: 220 });
    expect(resizeDelta(start('top'), 1000, 0, bounds).top).toBe(bounds.minTop);
  });

  it('corners do both', () => {
    expect(resizeDelta(start('bottom-left'), 950, 450, bounds)).toEqual({ width: 470, height: 410 });
    expect(resizeDelta(start('top-left'), 950, 350, bounds)).toEqual({ width: 470, top: 150, height: 410 });
  });

  it('applySize clamps width and height into the bounds', () => {
    expect(applySize({ measuredTop: 200 }, { width: 5000 }, bounds).width).toBe(900);
    expect(applySize({ measuredTop: 200 }, { width: 10 }, bounds).width).toBe(340);
    expect(applySize({ measuredTop: 200 }, { height: 10 }, bounds).height).toBe(220);
    // a panel cannot be dragged taller than the space below its top
    expect(applySize({ measuredTop: 700 }, { height: 800 }, bounds).height).toBe(bounds.maxBottom - 700 + 0 > 220 ? bounds.maxBottom - 656 : 220);
  });

  it('applySize keeps the top where it was unless asked, and keeps a moved top inside the rail', () => {
    expect(applySize({ top: 250, measuredTop: 300 }, { height: 300 }, bounds).top).toBe(250);
    expect(applySize({ measuredTop: 300 }, { height: 300 }, bounds).top).toBe(300);
    expect(applySize({ measuredTop: 300 }, { top: 5, height: 300 }, bounds).top).toBe(bounds.minTop);
  });
});
