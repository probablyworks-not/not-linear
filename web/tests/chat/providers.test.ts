import { claudeProvider } from '../../src/providers/claude';
import { deepseekProvider } from '../../src/providers/deepseek';
import { clearRequestLog, requestLog } from '../../src/lib/request-log';
import type { ChatRequest, ProviderEvent } from '../../src/providers/types';

const SECRET = 'sk-test-SECRET-1234567890';

function sse(lines: string[], chunkSize = 7): Response {
  const body = lines.map(l => `data: ${l}\n\n`).join('');
  const enc = new TextEncoder().encode(body);
  // Tiny chunks, so partial lines straddle chunk boundaries.
  const stream = new ReadableStream<Uint8Array>({
    start(c) { for (let i = 0; i < enc.length; i += chunkSize) c.enqueue(enc.slice(i, i + chunkSize)); c.close(); },
  });
  return new Response(stream, { status: 200 });
}
const req = (over: Partial<ChatRequest> = {}): ChatRequest => ({
  messages: [{ role: 'user', content: 'hi' }], systemPrompt: 'sys', tools: [], model: 'm', thinking: false,
  signal: new AbortController().signal, ...over,
});
async function collect(it: AsyncIterable<ProviderEvent>): Promise<ProviderEvent[]> {
  const out: ProviderEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}
function mockFetch(res: Response | (() => Response)): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () => (typeof res === 'function' ? res() : res));
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(() => {
  clearRequestLog();
  localStorage.setItem('nl_api_keys', JSON.stringify({ anthropic: SECRET, deepseek: SECRET }));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear(); });

describe('claude', () => {
  // A real Anthropic stream opens each block before filling it.
  const anthropicStream = [
    JSON.stringify({ type: 'message_start', message: { usage: { input_tokens: 11 } } }),
    JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'thinking' } }),
    JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'hmm' } }),
    JSON.stringify({ type: 'content_block_start', index: 1, content_block: { type: 'text' } }),
    JSON.stringify({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Hel' } }),
    JSON.stringify({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'lo' } }),
    JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } }),
  ];

  it('streams thinking and text deltas, then done with usage', async () => {
    mockFetch(sse(anthropicStream));
    const events = await collect(claudeProvider.stream(req({ model: 'claude-sonnet-5' })));
    expect(events.slice(0, 3)).toEqual([
      { t: 'thinking', text: 'hmm' },
      { t: 'delta', text: 'Hel' },
      { t: 'delta', text: 'lo' },
    ]);
    expect(events[3]).toMatchObject({ t: 'done', text: 'Hello', usage: { inputTokens: 11, outputTokens: 5, stopReason: 'end_turn', requestCount: 1, context: { system: 'sys', tools: [] } } });
  });

  it('sends the key as a header and never writes it to the request log', async () => {
    const fetchFn = mockFetch(sse(anthropicStream));
    await collect(claudeProvider.stream(req()));
    const init = fetchFn.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>)['x-api-key']).toBe(SECRET);
    expect(JSON.stringify(requestLog)).not.toContain(SECRET);
    expect(requestLog.length).toBeGreaterThan(0);
  });

  it('omits `tools` when there are none, and sets adaptive thinking only when asked', async () => {
    const fetchFn = mockFetch(() => sse(anthropicStream));
    await collect(claudeProvider.stream(req()));
    await collect(claudeProvider.stream(req({ thinking: true })));
    const a = JSON.parse((fetchFn.mock.calls[0]![1] as RequestInit).body as string);
    const b = JSON.parse((fetchFn.mock.calls[1]![1] as RequestInit).body as string);
    expect(a).not.toHaveProperty('tools');
    expect(a).not.toHaveProperty('thinking');
    expect(a.max_tokens).toBe(8192);
    expect(b.thinking).toEqual({ type: 'adaptive' });
    expect(b.max_tokens).toBe(16000);
  });

  it('429 is a rate_limit whose text the legacy fallback regex matches', async () => {
    mockFetch(new Response('{}', { status: 429 }));
    const [e] = await collect(claudeProvider.stream(req()));
    expect(e).toMatchObject({ t: 'error', kind: 'rate_limit' });
    expect((e as { message: string }).message).toMatch(/claude.*rate limit/i);
  });

  it.each([[401, 'config', /Invalid API key/], [402, 'config', /Out of credits/], [529, 'other', /overloaded/], [500, 'other', /Error 500/]])(
    'HTTP %i → %s', async (status, kind, msg) => {
      mockFetch(new Response('{}', { status }));
      const [e] = await collect(claudeProvider.stream(req()));
      expect(e).toMatchObject({ t: 'error', kind });
      expect((e as { message: string }).message).toMatch(msg);
    });

  it('a missing key is a config error and makes no request', async () => {
    localStorage.clear();
    const fetchFn = mockFetch(sse([]));
    const [e] = await collect(claudeProvider.stream(req()));
    expect(e).toMatchObject({ t: 'error', kind: 'config' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('a network failure is an error, not a throw', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const [e] = await collect(claudeProvider.stream(req()));
    expect(e).toMatchObject({ t: 'error', kind: 'other', message: 'Failed to fetch' });
  });

  it('aborting mid-stream ends with an aborted error and keeps the text already emitted', async () => {
    const ctrl = new AbortController();
    mockFetch(sse(anthropicStream, 20));
    const events: ProviderEvent[] = [];
    for await (const e of claudeProvider.stream(req({ signal: ctrl.signal }))) {
      events.push(e);
      if (e.t === 'delta') ctrl.abort();
    }
    expect(events.at(-1)).toMatchObject({ t: 'error', kind: 'aborted' });
    expect(events.some(e => e.t === 'delta')).toBe(true);
  });
});

describe('deepseek', () => {
  const chunk = (delta: object, finish: string | null = null, usage?: object) =>
    JSON.stringify({ choices: [{ delta, finish_reason: finish }], ...(usage ? { usage } : {}) });

  it('streams reasoning and content, and reports cache-hit tokens', async () => {
    mockFetch(sse([
      chunk({ reasoning_content: 'think' }),
      chunk({ content: 'Hi' }),
      chunk({ content: '!' }, 'stop', { prompt_tokens: 20, prompt_cache_hit_tokens: 8, completion_tokens: 3 }),
      '[DONE]',
    ]));
    const events = await collect(deepseekProvider.stream(req({ model: 'deepseek-v4-flash' })));
    expect(events.slice(0, 2)).toEqual([
      { t: 'thinking', text: 'think' },
      // The markup filter holds the last 180 characters back until the stream ends (as legacy does), so a short reply is one chunk.
      { t: 'delta', text: 'Hi!' },
    ]);
    expect(events[2]).toMatchObject({ t: 'done', text: 'Hi!', usage: { inputTokens: 20, outputTokens: 3, cacheHitTokens: 8, stopReason: 'stop' } });
  });

  it('prepends the system prompt, and maps thinking onto the request parameter (bug #044)', async () => {
    const fetchFn = mockFetch(() => sse([chunk({ content: 'x' }, 'stop')]));
    await collect(deepseekProvider.stream(req()));
    await collect(deepseekProvider.stream(req({ thinking: true })));
    const a = JSON.parse((fetchFn.mock.calls[0]![1] as RequestInit).body as string);
    const b = JSON.parse((fetchFn.mock.calls[1]![1] as RequestInit).body as string);
    expect(a.messages[0]).toEqual({ role: 'system', content: 'sys' });
    expect(a.thinking).toEqual({ type: 'disabled' });
    expect(b.thinking).toEqual({ type: 'enabled' });
    expect(b.reasoning_effort).toBe('high');
  });

  it('length becomes max_tokens, which is what offers Continue', async () => {
    mockFetch(sse([chunk({ content: 'cut' }, 'length')]));
    const events = await collect(deepseekProvider.stream(req()));
    expect(events.at(-1)).toMatchObject({ t: 'done', usage: { stopReason: 'max_tokens' } });
  });

  it('never logs the bearer token', async () => {
    mockFetch(sse([chunk({ content: 'x' }, 'stop')]));
    await collect(deepseekProvider.stream(req()));
    expect(JSON.stringify(requestLog)).not.toContain(SECRET);
  });

  it.each([[401, 'config'], [402, 'config'], [429, 'rate_limit'], [500, 'other']])('HTTP %i → %s', async (status, kind) => {
    mockFetch(new Response('{}', { status }));
    const [e] = await collect(deepseekProvider.stream(req()));
    expect(e).toMatchObject({ t: 'error', kind });
  });
});
