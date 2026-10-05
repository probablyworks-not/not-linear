import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { canvasLayout, edgePath, CANVAS_GAP_X, CANVAS_GAP_Y, CANVAS_NODE_H, CANVAS_NODE_W } from '../../src/branch/canvas-layout';
import { branchRowsForThread, type BranchRow } from '../../src/chat/branch-model';
import { parseSummary, summaryTranscript } from '../../src/branch/thread-summary';
import type { PersistedState, PersistedThread } from '../../src/db/types';

const row = (id: string, parentBid: string | null, order: number): BranchRow => ({
  id, anchorBid: id, quote: id, parentBid, depth: 1, order, open: false, touchedAt: 0, mainTurnId: null, mainTurnPrompt: '',
});
const STEP = CANVAS_NODE_H + CANVAS_GAP_Y;
const COL = CANVAS_NODE_W + CANVAS_GAP_X;

describe('canvasLayout (app.js:2823 bcLayout)', () => {
  it('no branches: just the main thread at the origin', () => {
    const l = canvasLayout([]);
    expect(l.positions).toEqual({ doc: { x: 0, y: 0, depth: 0 } });
  });

  it('roots stack as rows one column in; the main thread sits level with the middle of them', () => {
    const l = canvasLayout([row('a', null, 0), row('b', null, 1), row('c', null, 2)]);
    expect(l.positions.a).toEqual({ x: COL, y: 0, depth: 1 });
    expect(l.positions.b).toEqual({ x: COL, y: STEP, depth: 1 });
    expect(l.positions.c).toEqual({ x: COL, y: 2 * STEP, depth: 1 });
    expect(l.positions.doc!.y).toBe(STEP);
  });

  it('a parent sits level with the middle of its children, which are a column further right', () => {
    const l = canvasLayout([row('p', null, 0), row('k1', 'p', 1), row('k2', 'p', 2)]);
    expect(l.positions.k1).toEqual({ x: 2 * COL, y: 0, depth: 2 });
    expect(l.positions.k2).toEqual({ x: 2 * COL, y: STEP, depth: 2 });
    expect(l.positions.p).toEqual({ x: COL, y: STEP / 2, depth: 1 });
  });

  it('a branch whose parent is not in the list hangs off the main thread, not nowhere', () => {
    const l = canvasLayout([row('orphan', 'gone', 0)]);
    expect(l.childrenOf.doc).toEqual(['orphan']);
    expect(l.positions.orphan!.depth).toBe(1);
  });

  it('siblings keep the order the branches appear in, whatever order they are listed', () => {
    const l = canvasLayout([row('late', null, 5), row('early', null, 1)]);
    expect(l.childrenOf.doc).toEqual(['early', 'late']);
    expect(l.positions.early!.y).toBeLessThan(l.positions.late!.y);
  });

  it('the plane is big enough for every node', () => {
    const l = canvasLayout([row('p', null, 0), row('k', 'p', 1)]);
    for (const p of Object.values(l.positions)) {
      expect(p.x + CANVAS_NODE_W).toBeLessThanOrEqual(l.width);
      expect(p.y + CANVAS_NODE_H).toBeLessThanOrEqual(l.height);
    }
  });

  it('a cycle in saved parent ids does not recurse forever', () => {
    expect(() => canvasLayout([row('a', 'b', 0), row('b', 'a', 1)])).not.toThrow();
  });

  it('edges run from a parent\'s right edge to a child\'s left, level with each node\'s middle', () => {
    const d = edgePath({ x: 0, y: 0, depth: 0 }, { x: COL, y: 100, depth: 1 });
    expect(d.startsWith(`M ${CANVAS_NODE_W} ${CANVAS_NODE_H / 2} C`)).toBe(true);
    expect(d.endsWith(`${COL - 8} ${100 + CANVAS_NODE_H / 2}`)).toBe(true);
  });
});

describe('parseSummary (app.js:2670)', () => {
  it('splits ABOUT and IDEAS, accepting -, • and * bullets', () => {
    expect(parseSummary('ABOUT: A thread about tides.\n\nIDEAS:\n- gravity\n• the moon\n* the sun')).toEqual({
      about: 'A thread about tides.', ideas: ['gravity', 'the moon', 'the sun'],
    });
  });
  it('a bare first line is the about line, and unbulleted lines under IDEAS are ideas', () => {
    expect(parseSummary('Just a sentence.')).toEqual({ about: 'Just a sentence.', ideas: [] });
    expect(parseSummary('ABOUT: x\nIDEAS:\nplain idea')).toEqual({ about: 'x', ideas: ['plain idea'] });
  });
  it('is tolerant of a half-streamed answer', () => {
    expect(parseSummary('ABOUT: Tid')).toEqual({ about: 'Tid', ideas: [] });
    expect(parseSummary('ABOUT: Tides\n\nIDEAS:\n- gra')).toEqual({ about: 'Tides', ideas: ['gra'] });
  });
});

describe('summaryTranscript (app.js:2751)', () => {
  const thread = {
    mainMessages: [{ role: 'user', content: 'Why tides?' }, { role: 'assistant', content: 'The moon.' }],
    branchSnapshots: {
      b1: { quote: 'the moon', messages: [{ role: 'user', content: 'More?' }, { role: 'assistant', content: 'Gravity.' }] },
    },
  } as unknown as PersistedThread;

  it('is the conversation, then each branch with the words it came from', () => {
    expect(summaryTranscript(thread)).toBe(
      'User: Why tides?\n\nAssistant: The moon.\n\n--- Branches ---\n\nBranch 1 (from: "the moon"):\nUser: More?\n\nAssistant: Gravity.',
    );
  });
  it('with no branches there is no branch section; array content keeps only its text blocks', () => {
    const t = { mainMessages: [{ role: 'user', content: [{ type: 'image' }, { type: 'text', text: 'hello' }] }] } as unknown as PersistedThread;
    expect(summaryTranscript(t)).toBe('User: hello');
  });
});

const FIXTURE = resolve(__dirname, '../fixtures/notlinear.kv.v1.json');
const real: PersistedState | null = existsSync(FIXTURE)
  ? ((JSON.parse(readFileSync(FIXTURE, 'utf8')) as { rows: Array<{ key: string; value: unknown }> }).rows.find(r => r.key === 'state')?.value as PersistedState)
  : null;

describe.skipIf(!real)('against the real fixture', () => {
  it('lays out every real thread: a position for every branch, none overlapping, every edge ends at a node', () => {
    let nodes = 0;
    for (const [tid, t] of Object.entries(real!.threads)) {
      const rows = branchRowsForThread(t);
      const l = canvasLayout(rows);
      nodes += rows.length;
      expect(Object.keys(l.positions).sort(), tid).toEqual(['doc', ...rows.map(r => r.id)].sort());
      const seen = new Set<string>();
      for (const [id, p] of Object.entries(l.positions)) {
        const key = `${p.x},${p.y}`;
        expect(seen.has(key), `${tid}: ${id} overlaps another node at ${key}`).toBe(false);
        seen.add(key);
      }
    }
    expect(nodes).toBeGreaterThan(100);
  });
});
