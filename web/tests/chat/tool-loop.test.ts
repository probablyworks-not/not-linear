import { claudeProvider } from '../../src/providers/claude';
import { deepseekProvider } from '../../src/providers/deepseek';
import { consumeDeepSeekVisibleContent, DEEPSEEK_TOOL_MARKUP_HOLD_CHARS, synthesisOnlyMessages } from '../../src/providers/deepseek-markup';
import { TOOL_SPECS } from '../../src/providers/tool-specs';
import { ToolFatalError } from '../../src/tools/tool-runners';
import { clearRequestLog } from '../../src/lib/request-log';
import type { ChatRequest, ProviderEvent, ToolRunnerLike } from '../../src/providers/types';

const enc = new TextEncoder();
function sse(lines: string[], chunk = 11): Response {
  const bytes = enc.encode(lines.map(l => `data: ${l}\n\n`).join(''));
  const body = new ReadableStream<Uint8Array>({ start(c) { for (let i = 0; i < bytes.length; i += chunk) c.enqueue(bytes.slice(i, i + chunk)); c.close(); } });
  return new Response(body, { status: 200 });
}
const j = (o: unknown): string => JSON.stringify(o);

// ---- Claude stream builders ----
const claudeStart = (n = 10): string => j({ type: 'message_start', message: { usage: { input_tokens: n } } });
const claudeText = (idx: number, text: string): string[] => [
  j({ type: 'content_block_start', index: idx, content_block: { type: 'text' } }),
  j({ type: 'content_block_delta', index: idx, delta: { type: 'text_delta', text } }),
];
const claudeToolUse = (idx: number, id: string, name: string, input: unknown): string[] => [
  j({ type: 'content_block_start', index: idx, content_block: { type: 'tool_use', id, name } }),
  j({ type: 'content_block_delta', index: idx, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input).slice(0, 7) } }),
  j({ type: 'content_block_delta', index: idx, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input).slice(7) } }),
];
const claudeEnd = (reason: string, out = 5): string => j({ type: 'message_delta', delta: { stop_reason: reason }, usage: { output_tokens: out } });

// ---- DeepSeek stream builders ----
const dsContent = (content: string): string => j({ choices: [{ delta: { content }, finish_reason: null }] });
const dsToolCall = (index: number, id: string, name: string, args: unknown): string[] => [
  j({ choices: [{ delta: { tool_calls: [{ index, id, function: { name, arguments: '' } }] }, finish_reason: null }] }),
  j({ choices: [{ delta: { tool_calls: [{ index, function: { arguments: JSON.stringify(args) } }] }, finish_reason: null }] }),
];
const dsFinish = (reason: string, usage = { prompt_tokens: 10, completion_tokens: 4, prompt_cache_hit_tokens: 2 }): string[] =>
  [j({ choices: [{ delta: {}, finish_reason: reason }], usage }), '[DONE]'];

const tools = TOOL_SPECS.filter(t => t.name === 'wikipedia_search' || t.name === 'fetch_url');
const base = (over: Partial<ChatRequest> = {}): ChatRequest => ({
  messages: [{ role: 'user', content: 'tell me about tides' }], systemPrompt: 'sys', tools, model: 'm', thinking: false,
  signal: new AbortController().signal, ...over,
});
async function collect(it: AsyncIterable<ProviderEvent>): Promise<ProviderEvent[]> {
  const out: ProviderEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

let responses: Array<Response | (() => Response)> = [];
let bodies: Array<Record<string, unknown>> = [];
beforeEach(() => {
  clearRequestLog();
  bodies = [];
  localStorage.setItem('nl_api_keys', JSON.stringify({ anthropic: 'sk-ant-TESTONLY-x', deepseek: 'sk-ds-TESTONLY-y' }));
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    const next = responses.shift();
    if (!next) throw new Error('unexpected extra request');
    return typeof next === 'function' ? next() : next;
  }));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); localStorage.clear(); });

const echoRunner = (calls: Array<{ name: string; input: Record<string, unknown> }> = []): ToolRunnerLike => async (name, input) => {
  calls.push({ name, input });
  return `RESULT(${name}:${JSON.stringify(input)})`;
};

describe('Claude tool loop', () => {
  it('a tool_use turn runs the tool, sends the result back, and carries on to the answer', async () => {
    const calls: Array<{ name: string; input: Record<string, unknown> }> = [];
    responses = [
      sse([claudeStart(10), ...claudeToolUse(0, 'tu_1', 'wikipedia_search', { query: 'tides' }), claudeEnd('tool_use', 3)]),
      sse([claudeStart(20), ...claudeText(0, 'Tides are caused by the moon.'), claudeEnd('end_turn', 9)]),
    ];
    const events = await collect(claudeProvider.stream(base({ toolRunner: echoRunner(calls) })));

    expect(calls).toEqual([{ name: 'wikipedia_search', input: { query: 'tides' } }]);
    expect(events.map(e => e.t)).toEqual(['status', 'status', 'delta', 'done']);
    expect(events[0]).toEqual({ t: 'status', label: 'Searching Wikipedia for "tides"…' });
    expect(events[1]).toEqual({ t: 'status', label: 'Thinking…' });
    expect(events.at(-1)).toMatchObject({ t: 'done', text: 'Tides are caused by the moon.', usage: { inputTokens: 30, outputTokens: 12, stopReason: 'end_turn', requestCount: 2 } });
    // the context shown under the reply is the FINAL request's messages, including the tool round, and the tools offered
    const ctx = (events.at(-1) as { usage: { context: { tools: string[]; messages: unknown[] } } }).usage.context;
    expect(ctx.tools).toEqual(['wikipedia_search', 'fetch_url']);
    expect(ctx.messages).toHaveLength(3);

    // the tools were offered on both requests, in Anthropic's shape
    expect((bodies[0]!.tools as Array<{ name: string; input_schema: unknown }>).map(t => t.name)).toEqual(['wikipedia_search', 'fetch_url']);
    expect(bodies[1]!.tools).toBeDefined();
    // and the second request carries the assistant's tool_use and the user's tool_result, exactly as Anthropic requires
    const msgs = bodies[1]!.messages as Array<{ role: string; content: unknown }>;
    expect(msgs.map(m => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(msgs[1]!.content).toEqual([{ type: 'tool_use', id: 'tu_1', name: 'wikipedia_search', input: { query: 'tides' } }]);
    expect(msgs[2]!.content).toEqual([{ type: 'tool_result', tool_use_id: 'tu_1', content: 'RESULT(wikipedia_search:{"query":"tides"})' }]);
  });

  it('several tool calls in one turn run together, say so, and answer in order', async () => {
    const order: string[] = [];
    const runner: ToolRunnerLike = async name => { order.push(`start ${name}`); await new Promise(r => setTimeout(r, name === 'fetch_url' ? 15 : 1)); order.push(`end ${name}`); return `r-${name}`; };
    responses = [
      sse([claudeStart(), ...claudeToolUse(0, 'a', 'fetch_url', { url: 'https://x' }), ...claudeToolUse(1, 'b', 'wikipedia_search', { query: 'q' }), claudeEnd('tool_use')]),
      sse([claudeStart(), ...claudeText(0, 'done'), claudeEnd('end_turn')]),
    ];
    const events = await collect(claudeProvider.stream(base({ toolRunner: runner })));
    expect(events[0]).toEqual({ t: 'status', label: 'Running 2 searches in parallel…' });
    expect(order.slice(0, 2)).toEqual(['start fetch_url', 'start wikipedia_search']); // both begin before either ends
    const results = (bodies[1]!.messages as Array<{ content: Array<{ tool_use_id: string }> }>)[2]!.content;
    expect(results.map(r => r.tool_use_id)).toEqual(['a', 'b']); // in the order asked, not the order finished
  });

  it('an ordinary tool failure is given to the model as text so it can react', async () => {
    responses = [
      sse([claudeStart(), ...claudeToolUse(0, 'a', 'fetch_url', { url: 'https://x' }), claudeEnd('tool_use')]),
      sse([claudeStart(), ...claudeText(0, 'sorry'), claudeEnd('end_turn')]),
    ];
    const runner: ToolRunnerLike = async () => { throw new Error('boom'); };
    const events = await collect(claudeProvider.stream(base({ toolRunner: runner })));
    expect(events.at(-1)).toMatchObject({ t: 'done', text: 'sorry' });
    const results = (bodies[1]!.messages as Array<{ content: Array<{ content: string }> }>)[2]!.content;
    expect(results[0]!.content).toBe('Tool error (fetch_url): boom');
  });

  it('a FATAL tool failure ends the turn with its message and makes no further request', async () => {
    responses = [sse([claudeStart(), ...claudeToolUse(0, 'a', 'serper_search', { query: 'q' }), claudeEnd('tool_use')])];
    const runner: ToolRunnerLike = async () => { throw new ToolFatalError('Serper search key was rejected. Check the Serper key in Settings.'); };
    const events = await collect(claudeProvider.stream(base({ toolRunner: runner })));
    expect(events.at(-1)).toEqual({ t: 'error', kind: 'other', message: 'Serper search key was rejected. Check the Serper key in Settings.' });
    expect(events.some(e => e.t === 'status' && e.label === '')).toBe(true); // the status line is cleared first
    expect(bodies).toHaveLength(1);
  });

  it('text from before a tool call and after it is separated by a paragraph break', async () => {
    responses = [
      sse([claudeStart(), ...claudeText(0, 'Let me look that up.'), ...claudeToolUse(1, 'a', 'wikipedia_search', { query: 'q' }), claudeEnd('tool_use')]),
      sse([claudeStart(), ...claudeText(0, 'Here is what I found.'), claudeEnd('end_turn')]),
    ];
    const events = await collect(claudeProvider.stream(base({ toolRunner: echoRunner() })));
    const text = events.filter(e => e.t === 'delta').map(e => (e as { text: string }).text).join('');
    expect(text).toBe('Let me look that up.\n\nHere is what I found.');
    expect(events.at(-1)).toMatchObject({ t: 'done', text });
  });

  it('gives up after ten requests rather than looping forever', async () => {
    responses = Array.from({ length: 10 }, () => sse([claudeStart(), ...claudeToolUse(0, 'a', 'wikipedia_search', { query: 'q' }), claudeEnd('tool_use')]));
    const events = await collect(claudeProvider.stream(base({ toolRunner: echoRunner() })));
    expect(events.at(-1)).toEqual({ t: 'error', kind: 'other', message: 'Reached the 10-turn tool use limit — try a more specific question.' });
    expect(bodies).toHaveLength(10);
  });

  it('stopping while a tool runs ends with an aborted error, and the tool is told', async () => {
    const ctrl = new AbortController();
    responses = [sse([claudeStart(), ...claudeToolUse(0, 'a', 'wikipedia_search', { query: 'q' }), claudeEnd('tool_use')])];
    const runner: ToolRunnerLike = async (_n, _i, signal) => {
      ctrl.abort();
      expect(signal.aborted).toBe(true);
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    };
    const events = await collect(claudeProvider.stream(base({ toolRunner: runner, signal: ctrl.signal })));
    expect(events.at(-1)).toMatchObject({ t: 'error', kind: 'aborted' });
  });

  it('no runner, no tools: the request carries none and a tool_use reply is just the end', async () => {
    responses = [sse([claudeStart(), ...claudeText(0, 'plain'), claudeEnd('end_turn')])];
    const events = await collect(claudeProvider.stream(base()));
    expect(bodies[0]).not.toHaveProperty('tools');
    expect(events.at(-1)).toMatchObject({ t: 'done', text: 'plain' });
  });
});

describe('DeepSeek tool loop', () => {
  it('a tool_calls turn runs the tool, appends the result, and answers', async () => {
    const calls: Array<{ name: string; input: Record<string, unknown> }> = [];
    responses = [
      sse([...dsToolCall(0, 'call_1', 'wikipedia_search', { query: 'tides' }), ...dsFinish('tool_calls')]),
      sse([dsContent('Tides are caused by the moon.'), ...dsFinish('stop')]),
    ];
    const events = await collect(deepseekProvider.stream(base({ toolRunner: echoRunner(calls) })));
    expect(calls).toEqual([{ name: 'wikipedia_search', input: { query: 'tides' } }]);
    expect(events.map(e => e.t)).toEqual(['status', 'status', 'delta', 'done']);
    expect(events[0]).toEqual({ t: 'status', label: 'Searching Wikipedia for "tides"…' });
    expect(events[1]).toEqual({ t: 'status', label: 'Synthesizing tool results…' });
    expect(events.at(-1)).toMatchObject({ t: 'done', text: 'Tides are caused by the moon.', usage: { inputTokens: 20, outputTokens: 8, cacheHitTokens: 4 } });

    // tools in OpenAI's shape on the first request; the second carries the assistant's call and the tool message
    expect((bodies[0]!.tools as Array<{ type: string; function: { name: string } }>).map(t => `${t.type}:${t.function.name}`)).toEqual(['function:wikipedia_search', 'function:fetch_url']);
    expect(bodies[0]!.tool_choice).toBe('auto');
    const msgs = bodies[1]!.messages as Array<{ role: string; content: unknown; tool_calls?: unknown; tool_call_id?: string }>;
    expect(msgs.map(m => m.role)).toEqual(['system', 'user', 'assistant', 'tool']);
    expect(msgs[2]!.tool_calls).toEqual([{ id: 'call_1', type: 'function', function: { name: 'wikipedia_search', arguments: '{"query":"tides"}' } }]);
    expect(msgs[3]).toEqual({ role: 'tool', tool_call_id: 'call_1', content: 'RESULT(wikipedia_search:{"query":"tides"})' });
  });

  it('runs several calls one at a time, in order', async () => {
    const order: string[] = [];
    const runner: ToolRunnerLike = async name => { order.push(`start ${name}`); await new Promise(r => setTimeout(r, 5)); order.push(`end ${name}`); return 'r'; };
    responses = [
      sse([...dsToolCall(0, 'a', 'fetch_url', { url: 'https://x' }), ...dsToolCall(1, 'b', 'wikipedia_search', { query: 'q' }), ...dsFinish('tool_calls')]),
      sse([dsContent('ok'), ...dsFinish('stop')]),
    ];
    await collect(deepseekProvider.stream(base({ toolRunner: runner })));
    expect(order).toEqual(['start fetch_url', 'end fetch_url', 'start wikipedia_search', 'end wikipedia_search']);
  });

  it('after two tool rounds it is made to answer: no tools offered, a synthesis instruction added (bug #015)', async () => {
    responses = [
      sse([...dsToolCall(0, 'a', 'wikipedia_search', { query: 'one' }), ...dsFinish('tool_calls')]),
      sse([...dsToolCall(0, 'b', 'wikipedia_search', { query: 'two' }), ...dsFinish('tool_calls')]),
      sse([dsContent('final answer'), ...dsFinish('stop')]),
    ];
    const events = await collect(deepseekProvider.stream(base({ toolRunner: echoRunner() })));
    expect(bodies[0]).toHaveProperty('tools');
    expect(bodies[1]).toHaveProperty('tools');
    expect(bodies[2]).not.toHaveProperty('tools');
    const last = (bodies[2]!.messages as Array<{ role: string; content: string }>).at(-1)!;
    expect(last.role).toBe('user');
    expect(last.content).toMatch(/^Use the retrieved tool results already in this conversation/);
    expect(events.some(e => e.t === 'status' && e.label === 'Synthesizing answer from retrieved sources…')).toBe(true);
    expect(events.at(-1)).toMatchObject({ t: 'done', text: 'final answer' });
  });

  it('thinking mode offers tools, and sends each tool round\'s reasoning back with it', async () => {
    const reason = (t: string): string => j({ choices: [{ delta: { reasoning_content: t }, finish_reason: null }] });
    responses = [
      sse([reason('need a lookup'), ...dsToolCall(0, 'a', 'wikipedia_search', { query: 'tides' }), ...dsFinish('tool_calls')]),
      sse([dsContent('final answer'), ...dsFinish('stop')]),
    ];
    const events = await collect(deepseekProvider.stream(base({ toolRunner: echoRunner(), thinking: true })));
    expect(bodies[0]).toHaveProperty('tools');
    expect(bodies[0]!.thinking).toEqual({ type: 'enabled' });
    const second = bodies[1]!.messages as Array<{ role: string; reasoning_content?: string }>;
    expect(second.find(m => m.role === 'assistant')?.reasoning_content).toBe('need a lookup');
    expect(events.at(-1)).toMatchObject({ t: 'done', text: 'final answer' });
  });

  it('a fatal tool failure ends the turn with its message', async () => {
    responses = [sse([...dsToolCall(0, 'a', 'serper_search', { query: 'q' }), ...dsFinish('tool_calls')])];
    const runner: ToolRunnerLike = async () => { throw new ToolFatalError('Serper API key not set. Add it in Settings, or configure SearXNG for web search.'); };
    const events = await collect(deepseekProvider.stream(base({ toolRunner: runner })));
    expect(events.at(-1)).toEqual({ t: 'error', kind: 'other', message: 'Serper API key not set. Add it in Settings, or configure SearXNG for web search.' });
    expect(bodies).toHaveLength(1);
  });

  it('a tool call with no usable request is an error, not a hang', async () => {
    responses = [sse([j({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }), '[DONE]'])];
    const events = await collect(deepseekProvider.stream(base({ toolRunner: echoRunner() })));
    expect(events.at(-1)).toEqual({ t: 'error', kind: 'other', message: 'DeepSeek requested a tool call but did not send a usable tool request.' });
  });

  describe('when the answer does not come (#012, #017, #018)', () => {
    const roundOne = (): Response => sse([...dsToolCall(0, 'a', 'wikipedia_search', { query: 'tides' }), ...dsFinish('tool_calls')]);

    it('the synthesis stream fails before any text: the search results are shown instead of nothing', async () => {
      // The connection is fine; the stream breaks while the answer is being read.
      const broken = (): Response => new Response(new ReadableStream<Uint8Array>({ start(c) { c.error(new TypeError('connection reset')); } }), { status: 200 });
      responses = [roundOne(), broken];
      const events = await collect(deepseekProvider.stream(base({ toolRunner: echoRunner() })));
      const done = events.at(-1) as { t: string; text: string; usage?: { stopReason?: string } };
      expect(done.t).toBe('done');
      expect(done.text).toContain('Search completed, but the model stalled while turning the results into a final answer.');
      expect(done.text).toContain('### 1. Wikipedia: tides');
      expect(done.text).toContain('RESULT(wikipedia_search:{"query":"tides"})');
      expect(done.usage?.stopReason).toBe('tool_synthesis_timeout');
    });

    it('stopped after the results arrived: they are kept as the answer, not thrown away', async () => {
      const ctrl = new AbortController();
      responses = [roundOne(), () => { ctrl.abort(); throw Object.assign(new Error('aborted'), { name: 'AbortError' }); }];
      const events = await collect(deepseekProvider.stream(base({ toolRunner: echoRunner(), signal: ctrl.signal })));
      expect(events.at(-1)).toMatchObject({ t: 'done', usage: { stopReason: 'aborted_after_tool_results' } });
      expect((events.at(-1) as { text: string }).text).toContain('### 1. Wikipedia: tides');
    });

    it('stopped with no results yet: just an aborted error', async () => {
      const ctrl = new AbortController();
      responses = [() => { ctrl.abort(); throw Object.assign(new Error('aborted'), { name: 'AbortError' }); }];
      const events = await collect(deepseekProvider.stream(base({ toolRunner: echoRunner(), signal: ctrl.signal })));
      expect(events.at(-1)).toMatchObject({ t: 'error', kind: 'aborted' });
    });

    it('tool-call markup written into the text is never shown, and a too-short remainder falls back to the results', async () => {
      const markup = '<｜DSML｜tool_calls><｜DSML｜invoke name="wikipedia_search">x</｜DSML｜invoke></｜DSML｜tool_calls>';
      responses = [roundOne(), sse([dsContent(markup), ...dsFinish('stop')])];
      const events = await collect(deepseekProvider.stream(base({ toolRunner: echoRunner() })));
      const shown = events.filter(e => e.t === 'delta').map(e => (e as { text: string }).text).join('');
      expect(shown).not.toContain('DSML');
      expect(shown).not.toContain('invoke');
      expect(shown).toContain('### 1. Wikipedia: tides');
      expect(events.at(-1)).toMatchObject({ t: 'done', usage: { stopReason: 'pseudo_tool_call_filtered' } });
    });

    it('thinking mode: a tool attempt written as markup triggers one no-tools retry that yields a real answer', async () => {
      responses = [
        sse([dsContent('Let me start with parallel reconnaissance.\n\n<｜｜DSML｜｜calls></｜｜DSML｜｜calls>'), ...dsFinish('stop')]),
        sse([dsContent('I cannot open those links, but from what I know: agents are loops of model + tools.'), ...dsFinish('stop')]),
      ];
      const events = await collect(deepseekProvider.stream(base({ toolRunner: echoRunner(), thinking: true })));
      const shown = events.filter(e => e.t === 'delta').map(e => (e as { text: string }).text).join('');
      expect(shown).not.toContain('DSML');
      expect(shown).toContain('agents are loops');
      expect(bodies).toHaveLength(2);
      expect(bodies[1]).not.toHaveProperty('tools');
      expect(events.at(-1)).toMatchObject({ t: 'done' });
    });

    it('thinking mode: markup again after the retry is an error, not a silent dead end', async () => {
      const bad = (): Response => sse([dsContent('Looking.<｜｜DSML｜｜calls></｜｜DSML｜｜calls>'), ...dsFinish('stop')]);
      responses = [bad, bad];
      const events = await collect(deepseekProvider.stream(base({ toolRunner: echoRunner(), thinking: true })));
      expect(events.at(-1)).toMatchObject({ t: 'error', kind: 'other' });
    });

    it('markup in the middle of a real answer is cut out and the answer is kept', async () => {
      const answer = 'Tides are caused by the moon. '.repeat(30);
      responses = [sse([dsContent(answer + '<tool_calls><invoke name="x">y</invoke></tool_calls>' + ' And that is the end.'), ...dsFinish('stop')])];
      const events = await collect(deepseekProvider.stream(base({ toolRunner: echoRunner() })));
      const text = (events.at(-1) as { text: string }).text;
      expect(text).toContain('Tides are caused by the moon.');
      expect(text).toContain('And that is the end.');
      expect(text).not.toContain('tool_calls');
    });
  });
});

describe('the markup filter', () => {
  const START = '<｜DSML｜tool_calls>';
  const END = '</｜DSML｜tool_calls>';

  it('plain text is held back by the hold size until the stream ends, then flushed', () => {
    const text = 'a'.repeat(DEEPSEEK_TOOL_MARKUP_HOLD_CHARS + 50);
    const first = consumeDeepSeekVisibleContent(text);
    expect(first.visible).toHaveLength(50);
    expect(first.rest).toHaveLength(DEEPSEEK_TOOL_MARKUP_HOLD_CHARS);
    expect(consumeDeepSeekVisibleContent(first.rest, true)).toEqual({ visible: first.rest, rest: '', suppressed: false });
  });

  it('a complete block is removed and what is around it kept', () => {
    const r = consumeDeepSeekVisibleContent(`before ${START}stuff${END} after`, true);
    expect(r).toEqual({ visible: 'before  after', rest: '', suppressed: true });
  });

  it('a block split across chunks is not shown while it is still arriving', () => {
    const a = consumeDeepSeekVisibleContent(`before ${START}half of the bl`);
    expect(a.visible).toBe('before ');
    expect(a.suppressed).toBe(true);
    const b = consumeDeepSeekVisibleContent(a.rest + `ock${END} after`, true);
    expect(b.visible).toBe(' after');
  });

  it('an unterminated block at the very end is dropped, not shown', () => {
    expect(consumeDeepSeekVisibleContent(`ok ${START}never closed`, true)).toEqual({ visible: 'ok ', rest: '', suppressed: true });
  });

  it('recognises half-width pipes, the invoke form, and spacing', () => {
    expect(consumeDeepSeekVisibleContent('x <|DSML|tool_calls>y</|DSML|tool_calls> z', true).visible).toBe('x  z');
    expect(consumeDeepSeekVisibleContent('x <invoke name="a">y</invoke> z', true).visible).toBe('x  z');
    expect(consumeDeepSeekVisibleContent('x < tool_calls > y < / tool_calls > z', true).visible).toBe('x  z');
    // No tool_ prefix, doubled pipes (seen in thinking mode)
    expect(consumeDeepSeekVisibleContent('x <｜｜DSML｜｜calls></｜｜DSML｜｜calls> z', true)).toEqual({ visible: 'x  z', rest: '', suppressed: true });
    expect(consumeDeepSeekVisibleContent('x <||DSML||function_calls>y</||DSML||function_calls> z', true).visible).toBe('x  z');
  });

  it('ordinary angle brackets are left alone', () => {
    expect(consumeDeepSeekVisibleContent('use <div> and <b>bold</b> and a < b', true)).toEqual({ visible: 'use <div> and <b>bold</b> and a < b', rest: '', suppressed: false });
  });

  it('the synthesis instruction goes on the end and leaves the conversation intact', () => {
    const msgs = [{ role: 'user', content: 'q' }];
    const out = synthesisOnlyMessages(msgs);
    expect(out).toHaveLength(2);
    expect(out[0]).toBe(msgs[0]);
    expect(out[1]).toMatchObject({ role: 'user' });
  });
});
