import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { aiTurnHTML, messagesFromStream, parseStream, upsertTurn, userTurnHTML } from '../../src/chat/stream-html';
import { applyTurnSnapshot, type TurnSnapshot } from '../../src/db/turn-ops';
import { emptyState } from '../../src/db/thread-ops';
import type { PersistedState } from '../../src/db/types';

const FIXTURE = resolve(__dirname, '../fixtures/notlinear.kv.v1.json');
const real: PersistedState | null = existsSync(FIXTURE)
  ? ((JSON.parse(readFileSync(FIXTURE, 'utf8')) as { rows: Array<{ key: string; value: unknown }> }).rows.find(r => r.key === 'state')?.value as PersistedState)
  : null;

const count = (html: string, re: RegExp): number => (html.match(re) ?? []).length;

describe('markup', () => {
  it('a user turn escapes the text and carries the turn id', () => {
    const html = userTurnHTML('turn-1', '<b>x</b> & y');
    expect(html).toContain('data-turn-id="turn-1"');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt; &amp; y');
    expect(html).not.toContain('<b>');
  });

  it('an error with no text becomes a calm err-block; with text, the note sits in the status line', () => {
    expect(aiTurnHTML('t', { text: '', thinking: '', error: 'Went wrong' })).toContain('<div class="err-block"><span class="err-msg">');
    const partial = aiTurnHTML('t', { text: 'half', thinking: '', stopNote: 'Stopped' });
    expect(partial).toContain('<div class="ai-status"><span class="err-msg"><i class="ti ti-alert-circle"></i>Stopped</span></div>');
    expect(partial).toContain('<p>half</p>');
  });

  it('reasoning is saved collapsed, the way legacy leaves it', () => {
    const html = aiTurnHTML('t', { text: 'a', thinking: 'because' });
    expect(html).toContain('class="ai-thinking active"');
    expect(html).toContain('View reasoning');
    expect(html).toContain('because');
  });
});

describe('upsertTurn', () => {
  const u = userTurnHTML('t1', 'q');
  it('appends a new turn, then replaces it in place rather than duplicating', () => {
    let s = upsertTurn('', 't1', u, aiTurnHTML('t1', { text: 'one', thinking: '' }));
    s = upsertTurn(s, 't1', u, aiTurnHTML('t1', { text: 'one two', thinking: '' }));
    expect(count(s, /class="msg user"/g)).toBe(1);
    expect(count(s, /class="msg ai"/g)).toBe(1);
    expect(s).toContain('one two');
  });

  it('leaves other turns byte for byte, including branch anchors and highlights', () => {
    const prior = '<div class="msg user" data-turn-id="a"><div class="bub"><div>q</div></div></div>'
      + '<div class="msg ai" data-turn-id="a"><div class="ai-content"><p>see <span class="branched" data-bid="b1">this</span> and <span class="highlighted" data-hid="h1">that</span></p></div></div>';
    const s = upsertTurn(prior, 't2', userTurnHTML('t2', 'next'), aiTurnHTML('t2', { text: 'r', thinking: '' }));
    expect(s.startsWith(prior)).toBe(true);
    expect(count(s, /data-bid="b1"/g)).toBe(1);
    expect(count(s, /data-hid="h1"/g)).toBe(1);
  });

  it('removes the assistant element for a stopped, empty reply but keeps the question', () => {
    const s0 = upsertTurn('', 't1', u, aiTurnHTML('t1', { text: '', thinking: '' }));
    const s1 = upsertTurn(s0, 't1', u, null);
    expect(count(s1, /class="msg user"/g)).toBe(1);
    expect(count(s1, /class="msg ai"/g)).toBe(0);
  });

  it('drops the empty-chat placeholder and any saved action rows', () => {
    const s = upsertTurn('<div class="empty-chat-state">hi</div>', 't1', u, aiTurnHTML('t1', { text: 'x', thinking: '' }));
    expect(s).not.toContain('empty-chat-state');
  });
});

describe('reading', () => {
  it('parseStream gives role, id and inner html; a turn with no id gets a stable synthetic one', () => {
    const turns = parseStream('<div class="msg user"><div class="bub">q</div></div><div class="msg ai" data-turn-id="z"><div class="ai-content"><p>a</p></div></div>');
    expect(turns.map(t => [t.id, t.role])).toEqual([['legacy-0', 'user'], ['z', 'ai']]);
    expect(turns[1]!.html).toContain('<p>a</p>');
  });

  it('messagesFromStream recovers the model history from rendered HTML', () => {
    const s = upsertTurn('', 't1', userTurnHTML('t1', 'What is X?'), aiTurnHTML('t1', { text: 'X is **a thing**.', thinking: '' }));
    expect(messagesFromStream(s)).toEqual([
      { role: 'user', content: 'What is X?' },
      { role: 'assistant', content: 'X is a thing.' },
    ]);
  });
});

describe('applyTurnSnapshot', () => {
  const snap = (over: Partial<TurnSnapshot> = {}): TurnSnapshot => ({
    turnId: 't1', userHTML: userTurnHTML('t1', 'hello there'), aiHTML: aiTurnHTML('t1', { text: 'hi', thinking: '' }),
    history: [], userText: 'hello there', assistantText: 'hi', ...over,
  });
  const withThread = (extra: object = {}): PersistedState => {
    const s = emptyState();
    s.threads['chat-1'] = { kind: 'chat', title: 'Untitled chat', stream: '', highlights: [{ id: 'h' }] as never, branchSnapshots: { b: {} } as never, branchRecents: {}, ...extra };
    s.dynamic.push({ id: 'chat-1', title: 'Untitled chat' });
    return s;
  };

  it('writes stream and mainMessages and touches no branch or highlight data', () => {
    const s = withThread();
    expect(applyTurnSnapshot(s, 'chat-1', snap())).toBe(true);
    expect(s.threads['chat-1']!.mainMessages).toEqual([{ role: 'user', content: 'hello there' }, { role: 'assistant', content: 'hi' }]);
    expect(s.threads['chat-1']!.highlights).toEqual([{ id: 'h' }]);
    expect(s.threads['chat-1']!.branchSnapshots).toEqual({ b: {} });
  });

  it('names an untitled chat from the first prompt, in the thread, its h1 and the sidebar entry', () => {
    const s = withThread();
    applyTurnSnapshot(s, 'chat-1', snap({ titleSeed: 'I want to understand how tides work.' }));
    expect(s.threads['chat-1']!.title).toBe('how tides work');
    expect(s.threads['chat-1']!.h1).toBe('how tides work');
    expect(s.dynamic[0]!.title).toBe('how tides work');
  });

  it('never renames a chat that already has a title', () => {
    const s = withThread({ title: 'Mine' });
    applyTurnSnapshot(s, 'chat-1', snap({ titleSeed: 'something' }));
    expect(s.threads['chat-1']!.title).toBe('Mine');
  });

  it('a failed or stopped-empty turn keeps the prior history (legacy removes both entries)', () => {
    const prior = [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }];
    const s = withThread({ mainMessages: prior });
    applyTurnSnapshot(s, 'chat-1', snap({ assistantText: null, history: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }] }));
    expect(s.threads['chat-1']!.mainMessages).toHaveLength(2);
  });

  it('adds usage once and marks unread only when asked', () => {
    const s = withThread();
    applyTurnSnapshot(s, 'chat-1', snap({ usage: { inputTokens: 1000, outputTokens: 500, provider: 'anthropic', model: 'claude-sonnet-5' }, markUnread: true }));
    const t = s.threads['chat-1']!;
    expect(t).toMatchObject({ tokenIn: 1000, tokenOut: 500, provider: 'anthropic', model: 'claude-sonnet-5', unread: true });
    expect(t.cost).toBeCloseTo(1000 * 3e-6 + 500 * 15e-6);
  });

  it('does not resurrect a deleted or missing thread', () => {
    const s = withThread();
    s.deletedThreads.push('chat-1');
    expect(applyTurnSnapshot(s, 'chat-1', snap())).toBe(false);
    expect(applyTurnSnapshot(s, 'nope', snap())).toBe(false);
    expect(s.threads['nope']).toBeUndefined();
  });
});

describe.skipIf(!real)('against the real fixture (ADR-038)', () => {
  const threads = Object.entries(real?.threads ?? {}).filter(([, t]) => typeof t.stream === 'string' && t.stream);

  it('has anchors to lose, so the checks below mean something', () => {
    expect(threads.reduce((n, [, t]) => n + count(t.stream as string, /data-bid=/g), 0)).toBeGreaterThan(10);
  });

  // Legacy loads a thread with `stream.innerHTML = state.stream`, so what an HTML parser makes of the
  // saved string IS the page. One fixture thread holds a malformed fragment (`</sp<span class="branched"…`)
  // that the parser swallows along with an anchor; that loss is legacy's own on every load, so the
  // oracle is the parsed form, not the raw string.
  const parsed = (html: string): string => { const t = document.createElement('template'); t.innerHTML = html; return t.innerHTML; };

  it('appending a turn to every real thread keeps every data-hid and data-bid that legacy would load, and every prior turn', () => {
    for (const [id, t] of threads) {
      const before = parsed(t.stream as string);
      const after = upsertTurn(t.stream as string, 'turn-new', userTurnHTML('turn-new', 'q'), aiTurnHTML('turn-new', { text: 'a', thinking: '' }));
      for (const re of [/data-bid="[^"]+"/g, /data-hid="[^"]+"/g]) {
        expect(after.match(re) ?? [], `${id} ${re}`).toEqual(before.match(re) ?? []);
      }
      expect(after.startsWith(before), id).toBe(true);
      expect(parseStream(after).length, id).toBe(parseStream(before).length + 2);
    }
  });

  it('upserting a different turn leaves every real turn present', () => {
    for (const [id, t] of threads) {
      const turns = parseStream(t.stream as string).filter(x => !x.id.startsWith('legacy-'));
      for (const turn of turns) {
        const out = upsertTurn(t.stream as string, '__none__', '<div class="msg user" data-turn-id="__none__"></div>', null);
        expect(parseStream(out).some(x => x.id === turn.id), `${id} ${turn.id}`).toBe(true);
      }
    }
  });
});
