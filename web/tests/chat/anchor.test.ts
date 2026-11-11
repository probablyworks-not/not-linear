import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  anchorToRange, applyMarks, markIdsIn, rangeToAnchor, readMarks, selectedTextSegments, stripMarks, wrapRangeTextSegments,
  type MarkSpec,
} from '../../src/chat/anchor';
import type { PersistedState } from '../../src/db/types';

const box = (html: string): HTMLElement => {
  const el = document.createElement('div');
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
};
afterEach(() => { document.body.innerHTML = ''; });

const rangeOf = (el: Element, from: string, to: string = from): Range => {
  const text = el.textContent ?? '';
  const start = text.indexOf(from);
  const end = text.indexOf(to, start) + to.length;
  const r = anchorToRange(el, start, end);
  if (!r) throw new Error('no range');
  return r;
};

describe('wrapRangeTextSegments', () => {
  it('wraps part of one text node, splitting it either side', () => {
    const el = box('<p>hello brave new world</p>');
    wrapRangeTextSegments(rangeOf(el, 'brave'), { className: 'highlighted', datasetKey: 'hid', id: 'h1' });
    expect(el.innerHTML).toBe('<p>hello <span class="highlighted" data-hid="h1">brave</span> new world</p>');
  });

  it('a selection across several elements becomes one span per text node, all with the same id', () => {
    const el = box('<p>alpha <strong>beta</strong> gamma <em>delta</em></p>');
    wrapRangeTextSegments(rangeOf(el, 'pha bet', 'ta gam'), { className: 'branched', datasetKey: 'bid', id: 'b1' });
    const spans = [...el.querySelectorAll('[data-bid="b1"]')].map(s => s.textContent);
    expect(spans).toEqual(['pha ', 'beta', ' gam']);
    expect(el.textContent).toBe('alpha beta gamma delta');
  });

  it('never wraps whitespace-only text nodes, as legacy does not', () => {
    const el = box('<p>one</p> <p>two</p>');
    const r = document.createRange();
    r.selectNodeContents(el);
    expect(selectedTextSegments(r).map(s => s.node.nodeValue)).toEqual(['one', 'two']);
  });

  it('throws when nothing is selected', () => {
    const el = box('<p>x</p>');
    const r = document.createRange();
    r.setStart(el.firstChild!, 0);
    r.collapse(true);
    expect(() => wrapRangeTextSegments(r, { className: 'highlighted', datasetKey: 'hid', id: 'h' })).toThrow('No selected text');
  });
});

describe('offsets', () => {
  it('rangeToAnchor and anchorToRange are inverses, across element boundaries', () => {
    const el = box('<p>alpha <strong>beta</strong> gamma</p><p>delta</p>');
    const r = rangeOf(el, 'beta', 'delta');
    const a = rangeToAnchor(el, r)!;
    expect(a).toEqual({ start: 6, end: 21, text: 'beta gammadelta' });
    expect(anchorToRange(el, a.start, a.end)!.toString()).toBe('beta gammadelta');
  });

  it('is unchanged by wrapping, which is what makes offsets durable', () => {
    const el = box('<p>alpha beta gamma</p>');
    const before = rangeToAnchor(el, rangeOf(el, 'gamma'))!;
    wrapRangeTextSegments(rangeOf(el, 'alpha'), { className: 'highlighted', datasetKey: 'hid', id: 'h' });
    expect(rangeToAnchor(el, rangeOf(el, 'gamma'))).toEqual(before);
  });

  it('rejects a selection outside the container, an empty one, and out-of-bounds offsets', () => {
    const el = box('<p>inside</p>');
    const other = box('<p>outside</p>');
    expect(rangeToAnchor(el, rangeOf(other, 'outside'))).toBeNull();
    const empty = document.createRange();
    empty.setStart(el.firstChild!.firstChild!, 2);
    empty.collapse(true);
    expect(rangeToAnchor(el, empty)).toBeNull();
    expect(anchorToRange(el, 3, 99)).toBeNull();
    expect(anchorToRange(el, -1, 2)).toBeNull();
    expect(anchorToRange(el, 4, 4)).toBeNull();
  });
});

describe('applyMarks', () => {
  const marks: MarkSpec[] = [
    { id: 'h1', kind: 'highlight', runs: [{ start: 0, end: 5, text: 'alpha' }] },
    { id: 'b1', kind: 'branch', runs: [{ start: 11, end: 16, text: 'gamma' }] },
  ];
  const html = '<p>alpha beta gamma</p>';

  it('wraps each mark with legacy markup', () => {
    const el = box(html);
    expect(applyMarks(el, marks).skipped).toEqual([]);
    expect(el.innerHTML).toBe('<p><span class="highlighted" data-hid="h1">alpha</span> beta <span class="branched" data-bid="b1">gamma</span></p>');
  });

  it('is idempotent: applying the same list again changes nothing', () => {
    const el = box(html);
    applyMarks(el, marks);
    const once = el.innerHTML;
    applyMarks(el, marks);
    applyMarks(el, marks);
    expect(el.innerHTML).toBe(once);
  });

  it('does not depend on the order the list is given in', () => {
    const a = box(html);
    const b = box(html);
    applyMarks(a, marks);
    applyMarks(b, [...marks].reverse());
    expect(a.innerHTML).toBe(b.innerHTML);
  });

  it('replaces whatever marks were there, so a stale span does not linger', () => {
    const el = box('<p><span class="highlighted" data-hid="old">alpha</span> beta gamma</p>');
    applyMarks(el, [marks[1]!]);
    expect(el.querySelector('[data-hid="old"]')).toBeNull();
    expect(el.querySelectorAll('[data-bid="b1"]')).toHaveLength(1);
  });

  it('handles overlapping marks, each keeping its own full text', () => {
    const el = box('<p>one two three four</p>');
    const both: MarkSpec[] = [
      { id: 'h1', kind: 'highlight', runs: [{ start: 4, end: 13, text: 'two three' }] },
      { id: 'b1', kind: 'branch', runs: [{ start: 8, end: 18, text: 'three four' }] },
    ];
    expect(applyMarks(el, both).skipped).toEqual([]);
    const textOf = (sel: string) => [...el.querySelectorAll(sel)].map(s => s.textContent).join('');
    expect(textOf('[data-hid="h1"]')).toBe('two three');
    expect(textOf('[data-bid="b1"]')).toBe('three four');
    expect(el.textContent).toBe('one two three four');
  });

  it('skips a mark whose text is no longer at its offsets rather than marking the wrong words', () => {
    const el = box('<p>completely different text</p>');
    const { skipped } = applyMarks(el, marks);
    expect(skipped.map(m => m.id)).toEqual(['b1', 'h1']);
    expect(el.querySelector('span')).toBeNull();
  });

  it('stripMarks restores the plain text and merges the split nodes', () => {
    const el = box(html);
    applyMarks(el, marks);
    stripMarks(el);
    expect(el.innerHTML).toBe(html);
    expect(el.querySelector('p')!.childNodes).toHaveLength(1);
  });
});

describe('readMarks', () => {
  it('reads back what applyMarks wrote', () => {
    const el = box('<p>alpha <strong>beta</strong> gamma</p>');
    const marks: MarkSpec[] = [
      { id: 'h1', kind: 'highlight', runs: [{ start: 0, end: 5, text: 'alpha' }] },
      { id: 'b1', kind: 'branch', runs: [{ start: 6, end: 16, text: 'beta gamma' }] },
    ];
    applyMarks(el, marks);
    expect(readMarks(el)).toEqual(marks);
  });

  it('joins the several spans legacy writes for one multi-node selection into one mark', () => {
    const el = box('<p>alpha <strong>beta</strong> gamma</p>');
    wrapRangeTextSegments(rangeOf(el, 'pha', 'gam'), { className: 'branched', datasetKey: 'bid', id: 'b1' });
    expect(el.querySelectorAll('[data-bid="b1"]').length).toBeGreaterThan(1);
    expect(readMarks(el)).toEqual([{ id: 'b1', kind: 'branch', runs: [{ start: 2, end: 14, text: 'pha beta gam' }] }]);
  });

  it('a selection that starts in whitespace reads back from the first word actually wrapped', () => {
    const el = box('<p>one</p> <p>two</p>');
    const r = document.createRange();
    r.selectNodeContents(el);
    wrapRangeTextSegments(r, { className: 'highlighted', datasetKey: 'hid', id: 'h' });
    expect(readMarks(el)).toEqual([{ id: 'h', kind: 'highlight', runs: [{ start: 0, end: 7, text: 'one two' }] }]);
  });

  it('one id on two separated pieces of text stays two runs, and the words between are not marked', () => {
    const el = box('<p><span class="branched" data-bid="b1">alpha</span> beta gamma <span class="branched" data-bid="b1">delta</span></p>');
    const marks = readMarks(el);
    expect(marks).toEqual([{ id: 'b1', kind: 'branch', runs: [{ start: 0, end: 5, text: 'alpha' }, { start: 17, end: 22, text: 'delta' }] }]);
    applyMarks(el, marks);
    expect([...el.querySelectorAll('[data-bid="b1"]')].map(s => s.textContent)).toEqual(['alpha', 'delta']);
  });

  it('markIdsIn lists ids without needing offsets', () => {
    const ids = markIdsIn('<p><span class="highlighted" data-hid="h1">a</span><span class="branched" data-bid="b1">b</span></p>');
    expect([...ids.highlight]).toEqual(['h1']);
    expect([...ids.branch]).toEqual(['b1']);
  });
});

const FIXTURE = resolve(__dirname, '../fixtures/notlinear.kv.v1.json');
const real: PersistedState | null = existsSync(FIXTURE)
  ? ((JSON.parse(readFileSync(FIXTURE, 'utf8')) as { rows: Array<{ key: string; value: unknown }> }).rows.find(r => r.key === 'state')?.value as PersistedState)
  : null;

/** Every saved HTML blob that can hold marks: a thread's stream, its doc body, and each branch panel's body. */
function realBlobs(): Array<{ where: string; html: string }> {
  const out: Array<{ where: string; html: string }> = [];
  for (const [tid, t] of Object.entries(real?.threads ?? {})) {
    if (typeof t.stream === 'string') out.push({ where: `${tid}.stream`, html: t.stream });
    if (typeof t.docContent === 'string') out.push({ where: `${tid}.docContent`, html: t.docContent });
    for (const [bid, snap] of Object.entries((t.branchSnapshots ?? {}) as Record<string, { bodyHTML?: string }>)) {
      if (typeof snap.bodyHTML === 'string') out.push({ where: `${tid}.branch.${bid}`, html: snap.bodyHTML });
    }
  }
  return out;
}
const MARKS = '.highlighted[data-hid], .branched[data-bid]';
/**
 * For each mark id, WHICH non-whitespace characters of the container it covers.
 * Coverage rather than span text, because legacy nests spans (a highlight inside a
 * branch's span) and concatenating span text would count the nested words twice.
 */
function coverage(el: Element): Record<string, number[]> {
  const offsets = new Map<Node, number>();
  let pos = 0;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) { offsets.set(walker.currentNode, pos); pos += walker.currentNode.nodeValue!.length; }
  const out: Record<string, Set<number>> = {};
  el.querySelectorAll<HTMLElement>(MARKS).forEach(span => {
    const key = span.classList.contains('branched') ? `b:${span.dataset.bid}` : `h:${span.dataset.hid}`;
    const covered = (out[key] ??= new Set());
    const w = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) {
      const node = w.currentNode as Text;
      const base = offsets.get(node)!;
      [...node.nodeValue!].forEach((ch, i) => { if (ch.trim()) covered.add(base + i); });
    }
  });
  // A span with no text in it (real data has a few) marks nothing, so it has no coverage to compare.
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v.size).map(([k, v]) => [k, [...v].sort((x, y) => x - y)]));
}

describe.skipIf(!real)('against the real fixture', () => {
  const blobs = realBlobs();

  it('has marks to test with', () => {
    const n = blobs.reduce((c, b) => c + (b.html.match(/data-(?:hid|bid)=/g) ?? []).length, 0);
    expect(n).toBeGreaterThan(50);
  });

  it('readMarks then applyMarks onto the bare text reproduces every mark, in every saved blob', () => {
    for (const { where, html } of blobs) {
      const el = box(html);
      const marks = readMarks(el);
      const original = coverage(el);
      const bare = box(html);
      stripMarks(bare);
      const { skipped } = applyMarks(bare, marks);
      expect(skipped, where).toEqual([]);
      expect(coverage(bare), where).toEqual(original);
      expect(bare.textContent, where).toBe(el.textContent);
      // and the structured form is stable: reading what was just written gives the same marks
      expect(readMarks(bare), where).toEqual(marks);
      el.remove();
      bare.remove();
    }
  });

  it('applyMarks is idempotent on real data', () => {
    for (const { where, html } of blobs.slice(0, 60)) {
      const el = box(html);
      const marks = readMarks(el);
      applyMarks(el, marks);
      const once = el.innerHTML;
      applyMarks(el, marks);
      expect(el.innerHTML, where).toBe(once);
      el.remove();
    }
  });
});
