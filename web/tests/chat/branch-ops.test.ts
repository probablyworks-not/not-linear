import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  addHighlightIn, captureSnapshotIn, commitMarkedMessage, ensureBranchState, hasPersistableContent, rememberRecentIn,
  removeBranchRecordsIn, removeHighlightIn, type BranchContent, type BranchSpec,
} from '../../src/db/branch-ops';
import { branchRowsForThread, branchDeleteTargets } from '../../src/chat/branch-model';
import { aiTurnHTML, upsertTurn, userTurnHTML } from '../../src/chat/stream-html';
import type { PersistedHighlight, PersistedState, PersistedThread } from '../../src/db/types';

const spec = (over: Partial<BranchSpec> = {}): BranchSpec => ({
  id: 'b1', parentBid: null, anchorBid: 'b1', quote: 'the quoted words', depth: 1, createdAt: 100, touchedAt: 100,
  mainTurnId: 't1', mainTurnPrompt: 'why?', modelPref: 'sonnet', ...over,
});
const content = (over: Partial<BranchContent> = {}): BranchContent => ({
  bodyHTML: '', messages: [], tokenIn: 0, tokenCacheHit: 0, tokenOut: 0, cost: 0, ...over,
});
const thread = (over: Partial<PersistedThread> = {}): PersistedThread => ({ kind: 'chat', title: 'T', stream: '', ...over } as PersistedThread);
const hl = (over: Partial<PersistedHighlight> = {}): PersistedHighlight => ({
  id: 'hl-1', threadId: 'chat-1', threadTitle: 'T', text: 'words', createdAt: 5, source: 'main-chat', ...over,
});

describe('recents', () => {
  it('writes the row legacy writes, keeps createdAt on later touches, and never drops the first quote', () => {
    const t = thread();
    const first = rememberRecentIn(t, spec(), 500);
    expect(first).toEqual({ id: 'b1', quote: 'the quoted words', parentBid: null, anchorBid: 'b1', depth: 1, createdAt: 100, touchedAt: 500, mainTurnId: 't1', mainTurnPrompt: 'why?' });
    const again = rememberRecentIn(t, spec({ quote: '', createdAt: 999 }), 900);
    expect(again).toMatchObject({ quote: 'the quoted words', createdAt: 100, touchedAt: 900 });
  });
});

describe('captureSnapshotIn', () => {
  it('an empty, unhighlighted branch is remembered but NOT snapshotted (legacy leaves no snapshot behind)', () => {
    const t = thread();
    expect(captureSnapshotIn(t, spec(), content(), { now: 1 })).toBe(false);
    expect(t.branchSnapshots).toEqual({});
    expect(t.branchRecents!.b1).toBeDefined();
  });

  it('force writes it anyway', () => {
    const t = thread();
    expect(captureSnapshotIn(t, spec(), content(), { force: true, now: 1 })).toBe(true);
    expect(t.branchSnapshots!.b1).toMatchObject({ id: 'b1', anchorBid: 'b1', quote: 'the quoted words', modelPref: 'sonnet', messages: [] });
  });

  it('content earns a snapshot with every legacy field', () => {
    const t = thread();
    captureSnapshotIn(t, spec(), content({
      bodyHTML: userTurnHTML('x', 'hi'), messages: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }],
      tokenIn: 3, tokenOut: 4, cost: 0.5, provider: 'anthropic', model: 'claude-sonnet-5',
    }), { now: 7 });
    expect(Object.keys(t.branchSnapshots!.b1!).sort()).toEqual([
      'anchorBid', 'bodyHTML', 'cost', 'createdAt', 'depth', 'id', 'mainTurnId', 'mainTurnPrompt', 'messages', 'model',
      'modelPref', 'parentBid', 'provider', 'quote', 'tokenCacheHit', 'tokenIn', 'tokenOut', 'touchedAt',
    ]);
  });

  it('never replaces a snapshot that has content with an empty one (bug #009)', () => {
    const t = thread();
    captureSnapshotIn(t, spec(), content({ messages: [{ role: 'user', content: 'kept' }], bodyHTML: userTurnHTML('x', 'kept') }), { now: 1 });
    expect(captureSnapshotIn(t, spec(), content(), { force: true, now: 2 })).toBe(false);
    expect(t.branchSnapshots!.b1!.messages).toEqual([{ role: 'user', content: 'kept' }]);
  });

  it('a highlighted branch is snapshotted even when empty', () => {
    const t = thread();
    ensureBranchState(t);
    t.highlights!.push(hl({ source: 'branch', branchId: 'b1' }));
    expect(captureSnapshotIn(t, spec(), content(), { now: 1 })).toBe(true);
  });

  it('refreshes highlightsV2 from the body it just saved', () => {
    const t = thread();
    const body = '<div class="msg ai" data-turn-id="a"><div class="ai-content"><p>see <span class="highlighted" data-hid="h9">this</span></p></div></div>';
    captureSnapshotIn(t, spec(), content({ bodyHTML: body, messages: [{ role: 'assistant', content: 'see this' }] }), { now: 1 });
    expect(t.highlightsV2).toEqual([{ id: 'h9', kind: 'highlight', scope: 'branch', branchId: 'b1', turnId: 'a', part: 'ai', runs: [{ start: 4, end: 8, text: 'this' }] }]);
  });

  it('hasPersistableContent counts text in the body or any non-blank message', () => {
    expect(hasPersistableContent([], '')).toBe(false);
    expect(hasPersistableContent([{ content: '   ' }], '<p> </p>')).toBe(false);
    expect(hasPersistableContent([{ content: 'x' }], '')).toBe(true);
    expect(hasPersistableContent([], '<p>x</p>')).toBe(true);
  });
});

describe('commitMarkedMessage', () => {
  const stream = upsertTurn('', 't1', userTurnHTML('t1', 'q'), aiTurnHTML('t1', { text: 'alpha beta', thinking: '' }));

  it('replaces only the marked message, and records the mark in highlightsV2', () => {
    const t = thread({ stream });
    const marked = '<div class="ai-content"><p><span class="branched" data-bid="b1">alpha</span> beta</p></div>';
    expect(commitMarkedMessage(t, { scope: 'stream', message: { role: 'ai', turnId: 't1' } }, marked)).toBe(true);
    expect(t.stream).toContain('data-bid="b1"');
    expect(t.stream).toContain(userTurnHTML('t1', 'q'));
    expect(t.stream).toContain('<div class="msg ai" data-turn-id="t1">'); // the element keeps its own attributes
    expect(t.highlightsV2).toMatchObject([{ id: 'b1', kind: 'branch', scope: 'stream', turnId: 't1', part: 'ai', runs: [{ start: 0, end: 5, text: 'alpha' }] }]);
  });

  it('refuses when the message is gone, rather than writing over something else', () => {
    const t = thread({ stream });
    expect(commitMarkedMessage(t, { scope: 'stream', message: { role: 'ai', turnId: 'nope' } }, '')).toBe(false);
    expect(t.stream).toBe(stream);
  });

  it('finds a legacy message with no turn id by position, but only if it is still the same role', () => {
    const legacy = '<div class="msg user"><div class="bub">q</div></div><div class="msg ai"><div class="ai-content"><p>a b</p></div></div>';
    const t = thread({ stream: legacy });
    expect(commitMarkedMessage(t, { scope: 'stream', message: { role: 'user', turnId: 'legacy-1' } }, '')).toBe(false);
    expect(commitMarkedMessage(t, { scope: 'stream', message: { role: 'ai', turnId: 'legacy-1' } },
      '<div class="ai-content"><p><span class="highlighted" data-hid="h">a</span> b</p></div>')).toBe(true);
    expect(t.stream).toContain('data-hid="h"');
  });

  it('writes into a branch panel body', () => {
    const t = thread();
    captureSnapshotIn(t, spec(), content({ bodyHTML: stream, messages: [{ role: 'user', content: 'q' }] }), { now: 1 });
    const marked = '<div class="ai-content"><p>alpha <span class="highlighted" data-hid="h1">beta</span></p></div>';
    expect(commitMarkedMessage(t, { scope: 'branch', branchId: 'b1', message: { role: 'ai', turnId: 't1' } }, marked)).toBe(true);
    expect(t.branchSnapshots!.b1!.bodyHTML).toContain('data-hid="h1"');
    expect(commitMarkedMessage(t, { scope: 'branch', branchId: 'missing', message: { role: 'ai', turnId: 't1' } }, marked)).toBe(false);
  });
});

describe('removeHighlightIn', () => {
  const body = '<div class="msg ai" data-turn-id="a"><div class="ai-content"><p>one <span class="highlighted" data-hid="h1">two</span> three</p></div></div>';

  it('unwraps the span everywhere it appears and drops the record, leaving the words', () => {
    const t = thread({ stream: body });
    ensureBranchState(t);
    t.highlights!.push(hl({ id: 'h1' }));
    expect(removeHighlightIn(t, 'h1')).toMatchObject({ id: 'h1' });
    expect(t.stream).toContain('<p>one two three</p>');
    expect(t.highlights).toEqual([]);
    expect(t.highlightsV2).toBeUndefined();
  });

  it('returns null for an unknown id and changes nothing', () => {
    const t = thread({ stream: body });
    expect(removeHighlightIn(t, 'zzz')).toBeNull();
    expect(t.stream).toBe(body);
  });

  it('drops a branch snapshot whose only reason to exist was that highlight, unless it is in recents', () => {
    const t = thread();
    captureSnapshotIn(t, spec(), content({ bodyHTML: body.replace('h1', 'h2') }), { force: true, now: 1 });
    t.highlights!.push(hl({ id: 'h2', source: 'branch', branchId: 'b1' }));
    delete t.branchRecents!.b1;
    removeHighlightIn(t, 'h2');
    expect(t.branchSnapshots!.b1).toBeUndefined();

    const t2 = thread();
    captureSnapshotIn(t2, spec(), content({ bodyHTML: body.replace('h1', 'h2') }), { force: true, now: 1 });
    t2.highlights!.push(hl({ id: 'h2', source: 'branch', branchId: 'b1' }));
    removeHighlightIn(t2, 'h2');
    expect(t2.branchSnapshots!.b1).toBeDefined(); // still in recents
  });
});

describe('removeBranchRecordsIn', () => {
  it('removes the branches, their anchors, their highlights, snapshots and recents; others are untouched', () => {
    const stream = '<div class="msg ai" data-turn-id="a"><div class="ai-content"><p><span class="branched" data-bid="b1">one</span> <span class="branched" data-bid="b2">two</span></p></div></div>';
    const t = thread({ stream });
    captureSnapshotIn(t, spec({ id: 'b1' }), content({ messages: [{ role: 'user', content: 'x' }], bodyHTML: '<p>x</p>' }), { now: 1 });
    captureSnapshotIn(t, spec({ id: 'b2', anchorBid: 'b2' }), content({ messages: [{ role: 'user', content: 'y' }], bodyHTML: '<p>y</p>' }), { now: 1 });
    t.highlights!.push(hl({ id: 'hX', source: 'branch', branchId: 'b1' }), hl({ id: 'hY', source: 'main-chat' }));

    removeBranchRecordsIn(t, new Set(['b1']));
    expect(t.stream).toContain('<p>one <span class="branched" data-bid="b2">two</span></p>');
    expect(Object.keys(t.branchSnapshots!)).toEqual(['b2']);
    expect(Object.keys(t.branchRecents!)).toEqual(['b2']);
    expect(t.highlights!.map(h => h.id)).toEqual(['hY']);
    expect(t.highlightsV2!.map(m => m.id)).toEqual(['b2']);
  });

  it('addHighlightIn keeps `highlights` an array and refreshes the index', () => {
    const t = thread({ stream: '<div class="msg ai" data-turn-id="a"><div class="ai-content"><p><span class="highlighted" data-hid="hl-1">words</span></p></div></div>' });
    addHighlightIn(t, hl());
    expect(t.highlights).toHaveLength(1);
    expect(t.highlightsV2!.map(m => m.id)).toEqual(['hl-1']);
  });
});

const FIXTURE = resolve(__dirname, '../fixtures/notlinear.kv.v1.json');
const real: PersistedState | null = existsSync(FIXTURE)
  ? ((JSON.parse(readFileSync(FIXTURE, 'utf8')) as { rows: Array<{ key: string; value: unknown }> }).rows.find(r => r.key === 'state')?.value as PersistedState)
  : null;

describe.skipIf(!real)('against the real fixture', () => {
  it('deleting any branch removes its anchors and snapshots, and never touches another branch\'s', () => {
    for (const [tid, original] of Object.entries(real!.threads)) {
      const rows = branchRowsForThread(original);
      for (const root of rows.filter(r => !r.parentBid).slice(0, 3)) {
        const t = structuredClone(original);
        const gone = branchDeleteTargets(rows, root.id);
        const keep = Object.keys(t.branchSnapshots ?? {}).filter(id => !gone.has(id));
        removeBranchRecordsIn(t, gone);
        for (const id of gone) {
          expect(t.branchSnapshots![id], `${tid} ${id}`).toBeUndefined();
          const holder = document.createElement('div');
          holder.innerHTML = `${t.stream}${t.docContent ?? ''}${Object.values(t.branchSnapshots!).map(s => s.bodyHTML).join('')}`;
          // a real anchor, by selector (the fixture holds a few redaction-garbled spans that merely mention an id)
          expect(holder.querySelectorAll(`.branched[data-bid="${id}"]`), `${tid} ${id}`).toHaveLength(0);
        }
        expect(Object.keys(t.branchSnapshots!).sort(), tid).toEqual(keep.sort());
      }
    }
  });
});
