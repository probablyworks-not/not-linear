import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  branchChain, branchDeleteTargets, branchRowsForThread, buildBranchContext, recentBranchRows,
  type ChainNode,
} from '../../../src/chat/branch-model';
import { deriveMarksV2 } from '../../../src/chat/marks-v2';
import type { PersistedState, PersistedThread } from '../../../src/db/types';

const APP_JS = readFileSync(resolve(__dirname, '../../../../frontend/app.js'), 'utf8');
const FIXTURE = resolve(__dirname, '../fixtures/notlinear.kv.v1.json');
const real: PersistedState | null = existsSync(FIXTURE)
  ? ((JSON.parse(readFileSync(FIXTURE, 'utf8')) as { rows: Array<{ key: string; value: unknown }> }).rows.find(r => r.key === 'state')?.value as PersistedState)
  : null;

/** The real legacy buildBranchContext, cut out of app.js and bound to the two variables it closes over. */
function legacyBuildBranchContext(branches: Record<string, unknown>, mainMessages: unknown[]) {
  const start = APP_JS.indexOf('function buildBranchContext(');
  const end = APP_JS.indexOf('\n  }\n', start) + 4;
  const src = APP_JS.slice(start, end);
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function('branches', 'mainMessages', `${src}; return buildBranchContext;`)(branches, mainMessages) as
    (id: string, msg: string, wrap?: (t: string) => unknown) => unknown;
}

describe('buildBranchContext matches the legacy function', () => {
  const main = [{ role: 'user', content: 'main q' }, { role: 'assistant', content: 'main a' }];
  const m = (s: string) => [{ role: 'user', content: `${s} q` }, { role: 'assistant', content: `${s} a` }];
  // A three-deep chain, all "open", the only case legacy handles.
  const legacyBranches = {
    b1: { quote: 'one', parentBid: null, messages: m('b1') },
    b2: { quote: 'two', parentBid: 'b1', messages: m('b2') },
    b3: { quote: 'three', parentBid: 'b2', messages: [] },
    b4: { quote: 'four', parentBid: 'b2', messages: m('b4') },
  };
  const lookup = (id: string): ChainNode | undefined => {
    const b = (legacyBranches as Record<string, { quote: string; parentBid: string | null; messages: Array<{ role: string; content: string }> }>)[id];
    return b && { id, quote: b.quote, parentBid: b.parentBid, messages: b.messages as ChainNode['messages'] };
  };
  const wrap = (t: string) => `WRAPPED(${t})`;

  it.each(['b1', 'b2', 'b3', 'b4'])('branch %s, fresh and continuing, with and without a content wrapper', id => {
    const legacy = legacyBuildBranchContext(legacyBranches, main);
    const chain = branchChain(id, lookup);
    expect(buildBranchContext(main as never, chain, 'next?')).toEqual(legacy(id, 'next?'));
    expect(buildBranchContext(main as never, chain, 'next?', wrap)).toEqual(legacy(id, 'next?', wrap));
  });

  it('with no main history, the chain still starts with the first ancestor', () => {
    const legacy = legacyBuildBranchContext(legacyBranches, []);
    expect(buildBranchContext([], branchChain('b3', lookup), 'x')).toEqual(legacy('b3', 'x'));
  });

  it('a closed ancestor is still in the context (the one deliberate difference, ADR-051)', () => {
    // Legacy sees only open branches: with b1 closed, b2's context has no mention of b1.
    const openOnly = { b2: legacyBranches.b2 };
    const legacy = legacyBuildBranchContext(openOnly, main)('b2', 'x') as Array<{ content: string }>;
    expect(legacy.some(msg => String(msg.content).includes('"one"'))).toBe(false);
    const saved = buildBranchContext(main as never, branchChain('b2', lookup), 'x') as Array<{ content: string }>;
    expect(saved.some(msg => String(msg.content).includes('"one"'))).toBe(true);
  });

  it('a cycle in parent ids ends the walk instead of looping', () => {
    const cyc = (id: string): ChainNode | undefined =>
      ({ a: { id: 'a', quote: 'a', parentBid: 'b', messages: [] }, b: { id: 'b', quote: 'b', parentBid: 'a', messages: [] } } as Record<string, ChainNode>)[id];
    expect(branchChain('a', cyc).map(n => n.id)).toEqual(['b', 'a']);
  });
});

describe('delete closure', () => {
  const rows = [
    { id: 'a', parentBid: null }, { id: 'b', parentBid: 'a' }, { id: 'c', parentBid: 'b' }, { id: 'd', parentBid: 'a' }, { id: 'x', parentBid: null },
  ] as never[];
  it('takes a branch and every descendant, and nothing else', () => {
    expect([...branchDeleteTargets(rows, 'b')].sort()).toEqual(['b', 'c']);
    expect([...branchDeleteTargets(rows, 'a')].sort()).toEqual(['a', 'b', 'c', 'd']);
    expect([...branchDeleteTargets(rows, 'x')]).toEqual(['x']);
  });
});

describe('branchRowsForThread', () => {
  const thread = (over: Partial<PersistedThread>): PersistedThread => ({ kind: 'chat', stream: '', ...over } as PersistedThread);

  it('finds anchors on the page, joining a multi-span quote, with saved rows layered on', () => {
    const t = thread({
      stream: '<p><span class="branched" data-bid="b1">alpha</span> and <span class="branched" data-bid="b1">beta</span></p>',
      branchRecents: { b1: { id: 'b1', quote: 'alpha beta', parentBid: null, anchorBid: 'b1', depth: 1, createdAt: 5, touchedAt: 9, mainTurnId: 't1', mainTurnPrompt: 'why' } },
    });
    expect(branchRowsForThread(t)).toEqual([expect.objectContaining({ id: 'b1', quote: 'alpha beta', touchedAt: 9, mainTurnId: 't1', open: false })]);
  });

  it('resolves depth through parents, and marks open panels', () => {
    const t = thread({
      branchRecents: {
        p: { id: 'p', quote: 'p', parentBid: null, anchorBid: 'p', depth: 1, createdAt: 1, touchedAt: 1, mainTurnId: null, mainTurnPrompt: '' },
        c: { id: 'c', quote: 'c', parentBid: 'p', anchorBid: 'c', depth: 1, createdAt: 2, touchedAt: 2, mainTurnId: null, mainTurnPrompt: '' },
      },
    });
    const rows = branchRowsForThread(t, [{ id: 'c' }]);
    expect(rows.find(r => r.id === 'c')).toMatchObject({ depth: 2, open: true });
    expect(rows.find(r => r.id === 'p')).toMatchObject({ depth: 1, open: false });
  });

  it('recentBranchRows: newest first, capped, open ones kept even without a timestamp', () => {
    const mk = (id: string, touchedAt: number) => ({ id, quote: id, parentBid: null, anchorBid: id, depth: 1, createdAt: 1, touchedAt, mainTurnId: null, mainTurnPrompt: '' });
    const t1 = thread({ branchRecents: { a: mk('a', 10), b: mk('b', 30) } });
    const t2 = thread({ branchRecents: { c: mk('c', 20) } });
    const rows = recentBranchRows(
      [{ tid: 't1', title: 'One', thread: t1 }, { tid: 't2', title: 'Two', thread: t2 }, { tid: 't3', title: 'Gone', thread: undefined }],
      { t2: [{ id: 'live' }] }, 3,
    );
    expect(rows.map(r => `${r.tid}:${r.row.id}`)).toEqual(['t1:b', 't2:c', 't1:a']);
    expect(recentBranchRows([{ tid: 't2', title: 'Two', thread: t2 }], { t2: [{ id: 'live' }] }).map(r => r.row.id)).toContain('live');
  });
});

describe.skipIf(!real)('against the real fixture', () => {
  const threads = Object.entries(real?.threads ?? {});

  it('every saved snapshot has a row, with a resolved depth, and a parent that is a row (or is missing, as legacy allows)', () => {
    let snapshots = 0;
    for (const [tid, t] of threads) {
      const rows = branchRowsForThread(t);
      const ids = new Set(rows.map(r => r.id));
      for (const id of Object.keys(t.branchSnapshots ?? {})) {
        snapshots += 1;
        expect(ids.has(id), `${tid} ${id}`).toBe(true);
      }
      for (const r of rows) expect(r.depth, `${tid} ${r.id}`).toBeGreaterThanOrEqual(1);
    }
    expect(snapshots).toBeGreaterThan(100);
  });

  it('deleting any root removes exactly its own subtree, in every real thread', () => {
    for (const [tid, t] of threads) {
      const rows = branchRowsForThread(t);
      for (const root of rows.filter(r => !r.parentBid)) {
        const gone = branchDeleteTargets(rows, root.id);
        for (const r of rows) {
          if (gone.has(r.id)) continue;
          // a survivor's whole ancestry must be outside the deleted set
          let cursor = r.parentBid ? rows.find(x => x.id === r.parentBid) : undefined;
          const seen = new Set<string>();
          while (cursor && !seen.has(cursor.id)) {
            seen.add(cursor.id);
            expect(gone.has(cursor.id), `${tid}: ${r.id} survives but its ancestor ${cursor.id} goes`).toBe(false);
            cursor = cursor.parentBid ? rows.find(x => x.id === cursor!.parentBid) : undefined;
          }
        }
      }
    }
  });

  it('highlightsV2 derives for every real thread and agrees with the spans it indexes', () => {
    let marks = 0;
    for (const [tid, t] of threads) {
      const v2 = deriveMarksV2(t);
      marks += v2.length;
      const holder = [t.stream, t.docContent, ...Object.values(t.branchSnapshots ?? {}).map(s => s.bodyHTML)].filter(Boolean).join('\n');
      const parsed = document.createElement('div');
      parsed.innerHTML = holder;
      const ids = new Set([...parsed.querySelectorAll<HTMLElement>('[data-hid],[data-bid]')].map(e => e.dataset.hid || e.dataset.bid));
      for (const m of v2) {
        expect(ids.has(m.id), `${tid} ${m.id}`).toBe(true);
        expect(m.runs.length, `${tid} ${m.id}`).toBeGreaterThan(0);
        for (const r of m.runs) expect(r.text.length).toBe(r.end - r.start);
      }
    }
    expect(marks).toBeGreaterThan(50);
  });
});
