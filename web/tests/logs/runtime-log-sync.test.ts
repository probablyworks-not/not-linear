import { clearRequestLog, logBackendEvent, requestLog, RUNTIME_LOG_SYNC_DEBOUNCE_MS } from '../../src/lib/request-log';
import {
  canSyncRuntimeLogFile, getSyncStatus, installRuntimeLogSync, resetRuntimeLogSyncForTests, scheduleRuntimeLogFileSync,
} from '../../src/lib/runtime-log-sync';

const SECRET = 'sk-TESTONLY-sync-secret-9999';
type Sent = { url: string; headers: Record<string, string>; body: { events: Array<Record<string, unknown>> } };
let sent: Sent[] = [];
function server(respond: () => Promise<Response> | Response) {
  sent = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    sent.push({ url: String(url), headers: init!.headers as Record<string, string>, body: JSON.parse(String(init!.body)) });
    return respond();
  });
}
const ok = () => new Response('{"ok":true}', { status: 200 });

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  clearRequestLog();
  resetRuntimeLogSyncForTests();
  installRuntimeLogSync();
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('runtime-log sync to logs.md', () => {
  it('debounces a burst of events into ONE write, 1200ms after the last one', async () => {
    server(ok);
    for (let i = 0; i < 5; i++) { logBackendEvent({ i }); await vi.advanceTimersByTimeAsync(300); }
    expect(sent).toHaveLength(0);
    expect(getSyncStatus()).toBe('logs.md sync pending');
    // The last event was logged 300ms ago, so 900ms of its 1200ms debounce remain.
    await vi.advanceTimersByTimeAsync(RUNTIME_LOG_SYNC_DEBOUNCE_MS - 300 - 1);
    expect(sent).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body.events.map(e => e.i)).toEqual([0, 1, 2, 3, 4]);
    expect(getSyncStatus()).toBe('logs.md synced');
  });

  it('sends X-Notlinear-Local - the server answers 403 without it (BUGS.md #055)', async () => {
    server(ok);
    logBackendEvent({ a: 1 });
    await vi.advanceTimersByTimeAsync(RUNTIME_LOG_SYNC_DEBOUNCE_MS);
    expect(sent[0]!.url).toBe('/__notlinear_runtime_logs');
    expect(sent[0]!.headers['X-Notlinear-Local']).toBe('1');
    expect(sent[0]!.headers['content-type']).toBe('application/json');
  });

  it('what reaches logs.md has no credentials in it', async () => {
    server(ok);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      if (String(url) === '/__notlinear_runtime_logs') { sent.push({ url: String(url), headers: init!.headers as Record<string, string>, body: JSON.parse(String(init!.body)) }); return ok(); }
      return new Response('{}');
    });
    const { loggedFetch } = await import('../../src/lib/request-log');
    await loggedFetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers: { 'x-api-key': SECRET, authorization: `Bearer ${SECRET}` }, body: '{"messages":[{"content":"private"}]}' });
    await vi.advanceTimersByTimeAsync(RUNTIME_LOG_SYNC_DEBOUNCE_MS);
    expect(sent).toHaveLength(1);
    const wire = JSON.stringify(sent[0]!.body);
    expect(wire).not.toContain(SECRET);
    expect(wire).not.toContain('private');
    expect(wire).toContain('[redacted]');
  });

  it('only one request is in flight; events during it queue exactly one follow-up', async () => {
    let release!: () => void;
    server(() => new Promise<Response>(res => { release = () => res(ok()); }));
    logBackendEvent({ n: 1 });
    await vi.advanceTimersByTimeAsync(RUNTIME_LOG_SYNC_DEBOUNCE_MS);
    expect(sent).toHaveLength(1);
    logBackendEvent({ n: 2 });
    await vi.advanceTimersByTimeAsync(RUNTIME_LOG_SYNC_DEBOUNCE_MS); // fires while #1 is still pending
    expect(sent).toHaveLength(1);
    release();
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(RUNTIME_LOG_SYNC_DEBOUNCE_MS);
    expect(sent).toHaveLength(2);
    expect(sent[1]!.body.events).toHaveLength(2);
  });

  it('a refused request (e.g. 403) disables the sync for good and says so', async () => {
    server(() => new Response('{"ok":false}', { status: 403 }));
    logBackendEvent({ a: 1 });
    await vi.advanceTimersByTimeAsync(RUNTIME_LOG_SYNC_DEBOUNCE_MS);
    expect(getSyncStatus()).toBe('logs.md sync unavailable');
    logBackendEvent({ a: 2 });
    await vi.advanceTimersByTimeAsync(RUNTIME_LOG_SYNC_DEBOUNCE_MS * 3);
    expect(sent).toHaveLength(1); // never retried
  });

  it('an unreachable server disables it too', async () => {
    server(() => { throw new TypeError('Failed to fetch'); });
    logBackendEvent({ a: 1 });
    await vi.advanceTimersByTimeAsync(RUNTIME_LOG_SYNC_DEBOUNCE_MS);
    expect(getSyncStatus()).toBe('logs.md sync unavailable');
  });

  it('syncs the whole buffer, newest included, each time', async () => {
    server(ok);
    logBackendEvent({ k: 'first' });
    await vi.advanceTimersByTimeAsync(RUNTIME_LOG_SYNC_DEBOUNCE_MS);
    logBackendEvent({ k: 'second' });
    await vi.advanceTimersByTimeAsync(RUNTIME_LOG_SYNC_DEBOUNCE_MS);
    expect(sent.map(s => s.body.events.map(e => e.k))).toEqual([['first'], ['first', 'second']]);
    expect(requestLog).toHaveLength(2);
  });
});

describe('where syncing is allowed', () => {
  it.each([
    [{ protocol: 'http:', hostname: '127.0.0.1' }, true],
    [{ protocol: 'http:', hostname: 'localhost' }, true],
    [{ protocol: 'https:', hostname: '127.0.0.1' }, false],
    [{ protocol: 'http:', hostname: 'example.com' }, false],
    [{ protocol: 'http:', hostname: '127.0.0.1.evil.com' }, false],
    [{ protocol: 'file:', hostname: '' }, false],
  ])('%j -> %s', (loc, allowed) => { expect(canSyncRuntimeLogFile(loc)).toBe(allowed); });
});

describe('scheduling when syncing is not possible', () => {
  it('reports unavailable and sends nothing', async () => {
    server(ok);
    const orig = window.location;
    Object.defineProperty(window, 'location', { value: { protocol: 'https:', hostname: 'example.com' }, configurable: true });
    try {
      scheduleRuntimeLogFileSync();
      await vi.advanceTimersByTimeAsync(RUNTIME_LOG_SYNC_DEBOUNCE_MS * 2);
      expect(getSyncStatus()).toBe('logs.md sync unavailable');
      expect(sent).toHaveLength(0);
    } finally {
      Object.defineProperty(window, 'location', { value: orig, configurable: true });
    }
  });
});
