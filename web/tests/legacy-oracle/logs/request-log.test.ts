import * as legacy from '../../../../frontend/core/api-client.js';
import * as port from '../../../src/lib/request-log';

// Both modules keep their buffer on window.notlinearRequestLog (that is how legacy
// survives module re-evaluation), so in one jsdom window they share ONE array. That is
// convenient here: each side is run in turn, its entries read out, and the buffer cleared.
const SECRET = 'sk-ant-TESTONLY-do-not-log-me-0123456789';
const VOLATILE = new Set(['timestamp', 'startedAt', 'endedAt', 'durationMs']);
const stripVolatile = (e: Record<string, unknown>) => Object.fromEntries(Object.entries(e).filter(([k]) => !VOLATILE.has(k)));
const drain = () => { const out = port.requestLog.map(e => stripVolatile(e)); port.clearRequestLog(); return out; };

beforeEach(() => { port.clearRequestLog(); vi.spyOn(console, 'log').mockImplementation(() => {}); vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('shared buffer sanity (so the differential below means something)', () => {
  it('legacy and port write into the same array', () => {
    expect(legacy.requestLog).toBe(port.requestLog);
  });
});

describe('helpers: port vs legacy', () => {
  const values: unknown[] = [null, undefined, 'plain', '{"a":1}', '{"a":', 'x'.repeat(2000), { a: [1, 2, { b: 'c' }] }, 42, true, ['x'.repeat(900)], { deep: 'y'.repeat(800) }];

  it('safeJsonForLog', () => {
    for (const v of values) for (const max of [undefined, 10, 100, 700]) {
      expect(port.safeJsonForLog(v, max as number), JSON.stringify(v)?.slice(0, 40)).toEqual(legacy.safeJsonForLog(v, max));
    }
  });
  it('safeJsonForLog survives a circular structure', () => {
    const a: Record<string, unknown> = {}; a.self = a;
    expect(port.safeJsonForLog(a)).toEqual(legacy.safeJsonForLog(a));
  });
  it('summarizeMessagesForLog', () => {
    const msgs = [{ role: 'user', content: 'hello' }, { role: 'assistant', content: [{ type: 'text' }, { type: 'image' }] }, { content: null }, { role: 'x', content: 5 }, {}];
    expect(port.summarizeMessagesForLog(msgs)).toEqual(legacy.summarizeMessagesForLog(msgs));
    expect(port.summarizeMessagesForLog(null)).toEqual(legacy.summarizeMessagesForLog(null as never));
    expect(port.summarizeMessagesForLog()).toEqual(legacy.summarizeMessagesForLog());
  });
});

describe('loggedFetch: the same events as legacy for the same request', () => {
  const cases: Array<[string, string, RequestInit, { provider?: string; label?: string; timeoutMs?: number }]> = [
    ['a provider call with a credential header and a large body', 'https://api.anthropic.com/v1/messages',
      { method: 'POST', headers: { 'x-api-key': SECRET, 'content-type': 'application/json', 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'm', messages: [{}, {}, {}], system: 'abc', tools: [1, 2], max_tokens: 5 }) },
      { provider: 'anthropic', label: 'Claude turn', timeoutMs: 70000 }],
    ['a bearer token', 'https://api.openai.com/v1/chat', { method: 'POST', headers: { Authorization: `Bearer ${SECRET}` }, body: '{"a":1}' }, { provider: 'openai' }],
    ['a plain GET', 'https://example.com/x', {}, {}],
    ['a non-JSON body', 'https://example.com/y', { method: 'POST', body: 'z'.repeat(900) }, {}],
    ['this server\'s own endpoint', '/__notlinear_feedback_list', { method: 'POST', body: '{}' }, {}],
  ];

  for (const [name, url, init, meta] of cases) {
    it(`start and end events match: ${name}`, async () => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{}', { status: 200, statusText: 'OK' }));
      await legacy.loggedFetch(url, init, meta);
      const theirs = drain();
      await port.loggedFetch(url, init, meta);
      const mine = drain();
      expect(mine).toEqual(theirs);
      expect(mine).toHaveLength(2);
    });
  }

  it('an error is logged identically and rethrown', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(legacy.loggedFetch('https://e.com', {}, { label: 'Probe' })).rejects.toThrow('Failed to fetch');
    const theirs = drain();
    await expect(port.loggedFetch('https://e.com', {}, { label: 'Probe' })).rejects.toThrow('Failed to fetch');
    expect(drain()).toEqual(theirs);
  });

  it('a timeout throws RequestTimeoutError with the same message and logs it', async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch').mockImplementation((_u, init) => new Promise((_res, rej) => {
      (init!.signal as AbortSignal).addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
    }));
    const a = legacy.loggedFetch('https://slow.com', {}, { label: 'Slow call', timeoutMs: 2000 }).catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(2000);
    const theirErr = await a;
    const theirs = drain();
    const b = port.loggedFetch('https://slow.com', {}, { label: 'Slow call', timeoutMs: 2000 }).catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(2000);
    const myErr = await b as port.RequestTimeoutError;
    expect(myErr).toBeInstanceOf(port.RequestTimeoutError);
    expect(myErr.message).toBe((theirErr as Error).message);
    expect(myErr.message).toBe('Slow call timed out after 2s.');
    expect(myErr.isTimeout).toBe(true);
    expect(drain()).toEqual(theirs);
  });

  it('adds X-Notlinear-Local to this server\'s endpoints and nowhere else', async () => {
    const seen: Array<Record<string, string>> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_u, init) => { seen.push(init!.headers as Record<string, string>); return new Response('{}'); });
    await port.loggedFetch('/__notlinear_pick_folder', { method: 'POST' });
    await port.loggedFetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': SECRET } });
    expect(seen[0]).toMatchObject({ 'X-Notlinear-Local': '1' });
    expect(seen[1]).not.toHaveProperty('X-Notlinear-Local');
  });
});

describe('API keys are never logged (AGENTS.md hard rule)', () => {
  const HEADER_NAMES = ['Authorization', 'authorization', 'AUTHORIZATION', 'x-api-key', 'X-API-KEY', 'X-Api-Key', 'api-key', 'api_key', 'apikey', 'anthropic-api-key', 'x-goog-api-key', 'Proxy-Authorization'];

  it.each(HEADER_NAMES)('redacts the value of a "%s" header', async name => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{}'));
    await port.loggedFetch('https://p.example/v1', { method: 'POST', headers: { [name]: SECRET, 'content-type': 'application/json' } });
    const dump = JSON.stringify(port.requestLog);
    expect(dump).not.toContain(SECRET);
    expect(dump).not.toContain('TESTONLY');
    expect(port.requestLog[0]!.headers).toMatchObject({ [name]: '[redacted]', 'content-type': 'application/json' });
  });

  it('keeps ordinary headers readable, so the log is still useful', () => {
    expect(port.redactHeaders({ 'content-type': 'x', 'anthropic-version': '1', Accept: 'a' })).toEqual({ 'content-type': 'x', 'anthropic-version': '1', Accept: 'a' });
  });

  it('the redaction rule is exactly legacy\'s (a header name that legacy would not redact is not redacted here either)', async () => {
    const names = ['Authorization', 'x-api-key', 'api-key', 'apikey', 'Cookie', 'x-token', 'x-auth', 'bearer', 'secret', 'X-Notlinear-Local', 'content-type'];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{}'));
    const headers = Object.fromEntries(names.map(n => [n, 'v']));
    await legacy.loggedFetch('https://a.b', { headers });
    const theirs = drain();
    await port.loggedFetch('https://a.b', { headers });
    // Request ids come from per-module counters that earlier tests advanced unevenly; the ids are not what is compared.
    const noId = (es: Array<Record<string, unknown>>) => es.map(({ id: _id, ...rest }) => rest);
    expect(noId(drain())).toEqual(noId(theirs));
  });

  it('prompt content never lands in the log: messages, system and tools collapse to sizes', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{}'));
    await port.loggedFetch('https://p.example', { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'MY PRIVATE QUESTION' }], system: 'PRIVATE SYSTEM PROMPT', tools: [{ name: 't' }] }) });
    const dump = JSON.stringify(port.requestLog);
    expect(dump).not.toContain('PRIVATE');
    expect(port.requestLog[0]!.body).toMatchObject({ messages: '[1 messages]', system: '[21 chars]', tools: '[1 tools]' });
  });
});

describe('ring buffer', () => {
  it('keeps the newest 300 events in order and drops the oldest', () => {
    for (let i = 0; i < 350; i++) port.logBackendEvent({ i });
    expect(port.requestLog).toHaveLength(300);
    expect(port.requestLog[0]!.i).toBe(50);
    expect(port.requestLog.at(-1)!.i).toBe(349);
  });
  it('stamps a timestamp, fires the log event, and warns for errors and 4xx+ only', () => {
    const fired = vi.fn();
    window.addEventListener(port.LOG_EVENT, fired);
    port.logBackendEvent({ ok: 1 });
    port.logBackendEvent({ status: 404 });
    port.logBackendEvent({ error: 'x' });
    port.logBackendEvent({ status: 200 });
    window.removeEventListener(port.LOG_EVENT, fired);
    expect(fired).toHaveBeenCalledTimes(4);
    expect(typeof port.requestLog[0]!.timestamp).toBe('string');
    expect((console.warn as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
    expect((console.log as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });
});

describe('traces', () => {
  it('begin/end pair up under one id, end is idempotent, and a falsy trace is ignored', () => {
    const t = port.beginBackendTrace('tool', { name: 'wiki' });
    port.endBackendTrace(t, 'end', { ok: true });
    port.endBackendTrace(t, 'end', { ok: true }); // second call: no-op
    port.endBackendTrace(null);
    expect(port.requestLog).toHaveLength(2);
    expect(port.requestLog[0]).toMatchObject({ id: t.id, kind: 'tool', phase: 'start', name: 'wiki' });
    expect(port.requestLog[1]).toMatchObject({ id: t.id, phase: 'end', ok: true });
    expect(typeof port.requestLog[1]!.durationMs).toBe('number');
  });
  it('produces the same event shape as legacy', () => {
    const lt = legacy.beginBackendTrace('turn', { m: 1 });
    legacy.endBackendTrace(lt, 'error', { e: 'x' });
    const theirs = drain();
    const pt = port.beginBackendTrace('turn', { m: 1 });
    port.endBackendTrace(pt, 'error', { e: 'x' });
    const strip = (es: Array<Record<string, unknown>>) => es.map(({ id: _id, ...rest }) => rest);
    expect(strip(drain())).toEqual(strip(theirs));
  });
});
