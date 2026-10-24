import { openaiProvider, geminiProvider } from '../../src/providers/openai';
import { planModel, modelLabelFromId } from '../../src/chat/models';
import { responseCost } from '../../src/chat/usage';
import { clearRequestLog } from '../../src/lib/request-log';
import type { ChatRequest, ProviderEvent } from '../../src/providers/types';

const SECRET = 'sk-test-SECRET-1234567890';

function sse(lines: string[], chunkSize = 7): Response {
  const enc = new TextEncoder().encode(lines.map(l => `data: ${l}\n\n`).join(''));
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
const chunk = (o: unknown) => JSON.stringify(o);

beforeEach(() => {
  clearRequestLog();
  localStorage.setItem('nl_api_keys', JSON.stringify({ openai: SECRET, gemini: SECRET }));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear(); });

describe('model plan', () => {
  it('maps the persisted pref ids to the wire ids', () => {
    expect(planModel('gpt-4o', false)).toMatchObject({ supported: true, provider: 'openai', modelId: 'gpt-5.6-terra', usageProvider: 'openai' });
    expect(planModel('gpt-4o-mini', true)).toMatchObject({ provider: 'openai', modelId: 'gpt-5.6-luna', thinking: false });
    expect(planModel('gpt-5', false)).toMatchObject({ modelId: 'gpt-5-2025-08-07' });
    expect(planModel('gemini-flash', false)).toMatchObject({ supported: true, provider: 'gemini', modelId: 'gemini-2.0-flash', usageProvider: 'gemini' });
    expect(planModel('gemini-pro', false)).toMatchObject({ modelId: 'gemini-2.5-pro-preview-05-06' });
  });
  it('still refuses an id it does not know, and labels and prices the new models', () => {
    expect(planModel('gpt-unknown', false)).toMatchObject({ supported: false });
    expect(modelLabelFromId('gpt-5.6-terra')).toBe('GPT-5.6 Terra');
    expect(modelLabelFromId('gemini-2.5-pro-preview-05-06')).toBe('Gemini 2.5 Pro');
    expect(responseCost({ provider: 'openai', model: 'gpt-5.6-terra', inputTokens: 1e6, outputTokens: 1e6 })).toBeCloseTo(17.5);
    expect(responseCost({ provider: 'gemini', model: 'gemini-2.0-flash', inputTokens: 1e6, outputTokens: 1e6 })).toBeCloseTo(0.5);
    expect(responseCost({ provider: 'gemini', model: 'gemini-2.5-pro-preview-05-06', inputTokens: 1e6, outputTokens: 1e6 })).toBeCloseTo(11.25);
  });
});

describe('openai / gemini', () => {
  it('streams text and reports usage, with the right endpoint, key and token parameter', async () => {
    const fn = vi.fn(async () => sse([
      chunk({ choices: [{ delta: { content: 'Hel' } }] }),
      chunk({ choices: [{ delta: { content: 'lo' }, finish_reason: 'stop' }] }),
      chunk({ usage: { prompt_tokens: 11, completion_tokens: 4 }, choices: [] }),
      '[DONE]',
    ]));
    vi.stubGlobal('fetch', fn);
    const ev = await collect(openaiProvider.stream(req({ model: 'gpt-5.6-terra' })));
    expect(ev.filter(e => e.t === 'delta').map(e => (e as { text: string }).text).join('')).toBe('Hello');
    expect(ev.at(-1)).toMatchObject({ t: 'done', text: 'Hello', usage: { inputTokens: 11, outputTokens: 4, stopReason: 'stop' } });
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${SECRET}`);
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ max_completion_tokens: 8192, stream_options: { include_usage: true } });
    expect(body.tools).toBeUndefined();

    const g = vi.fn(async () => sse([chunk({ choices: [{ delta: { content: 'ok' }, finish_reason: 'length' }] })]));
    vi.stubGlobal('fetch', g);
    const gev = await collect(geminiProvider.stream(req({ model: 'gemini-2.0-flash' })));
    expect(gev.at(-1)).toMatchObject({ t: 'done', usage: { stopReason: 'max_tokens' } });
    const [gurl, ginit] = g.mock.calls[0] as unknown as [string, RequestInit];
    expect(gurl).toBe('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
    const gbody = JSON.parse(ginit.body as string);
    expect(gbody.max_tokens).toBe(8192);
    expect(gbody.stream_options).toBeUndefined();
  });

  it('runs a tool call and sends its result back', async () => {
    let n = 0;
    const fn = vi.fn(async () => (n++ === 0
      ? sse([
        chunk({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'wikipedia_search', arguments: '{"query":' } }] } }] }),
        chunk({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"cats"}' } }] }, finish_reason: 'tool_calls' }] }),
      ])
      : sse([chunk({ choices: [{ delta: { content: 'Cats are great.' }, finish_reason: 'stop' }] })])));
    vi.stubGlobal('fetch', fn);
    const runner = vi.fn(async () => 'cat facts');
    const tools = [{ name: 'wikipedia_search' as const, description: 'd', jsonSchema: { type: 'object' } }];
    const ev = await collect(openaiProvider.stream(req({ tools, toolRunner: runner })));
    expect(runner).toHaveBeenCalledWith('wikipedia_search', { query: 'cats' }, expect.anything());
    expect(ev.some(e => e.t === 'status' && /cats/.test(e.label))).toBe(true);
    expect(ev.at(-1)).toMatchObject({ t: 'done', text: 'Cats are great.', usage: { requestCount: 2 } });
    const second = JSON.parse((fn.mock.calls[1] as unknown as [string, RequestInit])[1].body as string);
    expect(second.messages.at(-1)).toEqual({ role: 'tool', tool_call_id: 'c1', content: 'cat facts' });
  });

  it('reports a missing key as a config error, and never echoes the key', async () => {
    localStorage.setItem('nl_api_keys', '{}');
    const ev = await collect(geminiProvider.stream(req()));
    expect(ev).toEqual([{ t: 'error', kind: 'config', message: 'No Gemini API key — add it in Settings (⚙).' }]);
  });

  it('maps 401 to config and 429 to rate_limit', async () => {
    for (const [status, kind] of [[401, 'config'], [429, 'rate_limit'], [500, 'other']] as const) {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { message: 'nope' } }), { status })));
      const ev = await collect(openaiProvider.stream(req()));
      expect(ev).toHaveLength(1);
      expect(ev[0]).toMatchObject({ t: 'error', kind });
      expect(JSON.stringify(ev)).not.toContain(SECRET);
    }
  });
});
