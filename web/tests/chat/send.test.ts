import { openChatDb } from '../../src/db/chat';
import { loadChatState, resetChatRepoForTests } from '../../src/db/chat-repo';
import { useAppStore } from '../../src/state/app-store';
import { useChatStore } from '../../src/chat/chat-store';
import { CONTINUE_PROMPT, continueMain, retryTurn, sendMessage, setRunTurnDepsForTests, stopStreaming } from '../../src/chat/send';
import type { RunTurnDeps } from '../../src/chat/run-turn';
import type { ChatProvider, ChatRequest, ProviderEvent } from '../../src/providers/types';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function reset(): Promise<void> {
  await resetChatRepoForTests();
  const d = openChatDb();
  await d.kv.clear();
  d.close();
  localStorage.clear();
  // These tests are about the send pipeline; clarify.test.ts covers the questions step.
  localStorage.setItem('nl_clarify_first', '0');
  useChatStore.setState({ live: {}, failed: {} });
  await useAppStore.getState().hydrate();
}

const seen: ChatRequest[] = [];
function provider(id: 'claude' | 'deepseek', script: (req: ChatRequest) => AsyncGenerator<ProviderEvent>): ChatProvider {
  return { id, caps: { thinking: false, nativeToolUse: false, maxToolRounds: 0 }, stream: req => { seen.push(req); return script(req); } };
}
const deps = (claude: ChatProvider, deepseek?: ChatProvider, canFallBack = false): RunTurnDeps => ({
  providers: { claude, deepseek: deepseek ?? provider('deepseek', async function* () { yield { t: 'done', text: '' }; }) },
  canFallBackToDeepSeek: canFallBack,
});
const saved = async (id: string) => (await loadChatState()).threads[id]!;
const gate = (): { wait: Promise<void>; release: () => void } => {
  let release!: () => void;
  const wait = new Promise<void>(r => { release = r; });
  return { wait, release };
};

beforeEach(async () => { seen.length = 0; await reset(); });
afterEach(() => setRunTurnDepsForTests(null));

describe('sendMessage', () => {
  it('streams into live state, then persists stream, mainMessages, title and usage', async () => {
    setRunTurnDepsForTests(() => deps(provider('claude', async function* () {
      yield { t: 'delta', text: 'Tides are ' };
      yield { t: 'delta', text: '**gravity**.' };
      yield { t: 'done', text: 'Tides are **gravity**.', usage: { inputTokens: 100, outputTokens: 40 } };
    })));
    const id = (await useAppStore.getState().createThread())!;
    await sendMessage(id, '  How do tides work?  ');

    const t = await saved(id);
    expect(t.mainMessages).toEqual([{ role: 'user', content: 'How do tides work?' }, { role: 'assistant', content: 'Tides are **gravity**.' }]);
    expect(t.stream).toContain('<strong>gravity</strong>');
    expect(t.stream).toContain('How do tides work?');
    expect(t.title).toBe('How do tides work');
    expect(t).toMatchObject({ tokenIn: 100, tokenOut: 40, provider: 'anthropic', model: 'claude-sonnet-5' });
    expect(useChatStore.getState().live[id]).toBeUndefined();
    expect(useAppStore.getState().threadState[id]!.stream).toBe(t.stream);
    expect(seen[0]!.messages).toEqual([{ role: 'user', content: 'How do tides work?' }]);
    expect(seen[0]!.systemPrompt).toContain('Notlinear');
  });

  it('the second message is sent with the whole prior conversation (the product)', async () => {
    setRunTurnDepsForTests(() => deps(provider('claude', async function* (req) {
      yield { t: 'done', text: `reply ${req.messages.length}` };
    })));
    const id = (await useAppStore.getState().createThread())!;
    await sendMessage(id, 'one');
    await sendMessage(id, 'two');
    expect(seen[1]!.messages).toEqual([
      { role: 'user', content: 'one' }, { role: 'assistant', content: 'reply 1' }, { role: 'user', content: 'two' },
    ]);
    expect((await saved(id)).mainMessages).toHaveLength(4);
  });

  it('writes the question before the reply arrives, and shows streamed text live', async () => {
    const g = gate();
    setRunTurnDepsForTests(() => deps(provider('claude', async function* () {
      for (let i = 0; i < 40; i++) yield { t: 'delta', text: 'x' };
      await g.wait;
      yield { t: 'done', text: 'x'.repeat(40) };
    })));
    const id = (await useAppStore.getState().createThread())!;
    const sending = sendMessage(id, 'hello');
    await sleep(60);
    expect((await saved(id)).stream).toContain('hello');
    expect(useChatStore.getState().live[id]!.text).toBe('x'.repeat(40));
    g.release();
    await sending;
    expect((await saved(id)).stream).toContain('x'.repeat(40));
  });

  it('a stream that errors with no text leaves the question, an error block, and a retry', async () => {
    let attempt = 0;
    setRunTurnDepsForTests(() => deps(provider('claude', async function* () {
      attempt += 1;
      if (attempt === 1) yield { t: 'error', kind: 'other', message: 'Claude is overloaded right now — try again in a moment.' };
      else yield { t: 'done', text: 'recovered' };
    })));
    const id = (await useAppStore.getState().createThread())!;
    await sendMessage(id, 'q');
    let t = await saved(id);
    expect(t.stream).toContain('err-block');
    expect(t.stream).toContain('The server is overloaded right now');
    expect(t.mainMessages).toEqual([]);
    expect(useChatStore.getState().failed[id]).toMatchObject({ config: false });

    await retryTurn(id);
    t = await saved(id);
    expect(t.mainMessages).toEqual([{ role: 'user', content: 'q' }, { role: 'assistant', content: 'recovered' }]);
    expect((t.stream as string).match(/class="msg user"/g)).toHaveLength(1);
    expect(t.stream).not.toContain('err-block');
    expect(useChatStore.getState().failed[id]).toBeUndefined();
  });

  it('a config error offers settings rather than retry', async () => {
    setRunTurnDepsForTests(() => deps(provider('claude', async function* () {
      yield { t: 'error', kind: 'config', message: 'No API key — add your Anthropic key in Settings (⚙).' };
    })));
    const id = (await useAppStore.getState().createThread())!;
    await sendMessage(id, 'q');
    expect(useChatStore.getState().failed[id]).toMatchObject({ config: true });
  });

  it('an error after some text keeps the partial answer and notes the stop', async () => {
    setRunTurnDepsForTests(() => deps(provider('claude', async function* () {
      yield { t: 'delta', text: 'partial answer' };
      yield { t: 'error', kind: 'other', message: 'Stream interrupted — partial response preserved.' };
    })));
    const id = (await useAppStore.getState().createThread())!;
    await sendMessage(id, 'q');
    const t = await saved(id);
    expect(t.stream).toContain('partial answer');
    expect(t.stream).toContain('Stream interrupted');
    expect(t.mainMessages).toEqual([{ role: 'user', content: 'q' }, { role: 'assistant', content: 'partial answer' }]);
    expect(useChatStore.getState().failed[id]).toBeUndefined();
  });

  it('Stop with nothing streamed removes the reply but keeps the question, and records no error', async () => {
    setRunTurnDepsForTests(() => deps(provider('claude', async function* (req) {
      await new Promise<void>(res => req.signal.addEventListener('abort', () => res()));
      yield { t: 'error', kind: 'aborted', message: 'Response stopped before completion.' };
    })));
    const id = (await useAppStore.getState().createThread())!;
    const sending = sendMessage(id, 'q');
    await sleep(30);
    stopStreaming(id);
    await sending;
    const t = await saved(id);
    expect(t.stream).toContain('class="msg user"');
    expect(t.stream).not.toContain('class="msg ai"');
    expect(t.mainMessages).toEqual([]);
    expect(useChatStore.getState().failed[id]).toBeUndefined();
  });

  it('ignores a second send while one is streaming, and blank input', async () => {
    const g = gate();
    setRunTurnDepsForTests(() => deps(provider('claude', async function* () { await g.wait; yield { t: 'done', text: 'ok' }; })));
    const id = (await useAppStore.getState().createThread())!;
    const first = sendMessage(id, 'one');
    await sleep(20);
    await sendMessage(id, 'two');
    await sendMessage(id, '   ');
    g.release();
    await first;
    expect(seen).toHaveLength(1);
  });

  it('falls back to DeepSeek on a Claude rate limit and bills the model that answered', async () => {
    useAppStore.setState({ prefs: { model: 'sonnet' } });
    setRunTurnDepsForTests(() => deps(
      provider('claude', async function* () { yield { t: 'error', kind: 'rate_limit', message: 'Claude rate limit hit' }; }),
      provider('deepseek', async function* () { yield { t: 'done', text: 'from deepseek', usage: { inputTokens: 10, outputTokens: 5, cacheHitTokens: 4 } }; }),
      true,
    ));
    const id = (await useAppStore.getState().createThread())!;
    await sendMessage(id, 'q');
    const t = await saved(id);
    expect(t.stream).toContain('from deepseek');
    expect(t).toMatchObject({ provider: 'deepseek', model: 'deepseek-v4-flash', tokenCacheHit: 4 });
  });

  it('an unsupported model is explained, not silently swapped', async () => {
    await useAppStore.getState().setPref('model', 'gpt-unknown');
    const id = (await useAppStore.getState().createThread())!;
    await sendMessage(id, 'q');
    expect(await saved(id)).toMatchObject({ mainMessages: [] });
    expect((await saved(id)).stream).toContain('not available');
    expect(useChatStore.getState().failed[id]).toMatchObject({ config: true });
    expect(seen).toHaveLength(0);
  });

  it('does not touch other threads or prefs', async () => {
    setRunTurnDepsForTests(() => deps(provider('claude', async function* () { yield { t: 'done', text: 'ok' }; })));
    await useAppStore.getState().setPref('tone', 'formal');
    const other = (await useAppStore.getState().createThread())!;
    await sleep(3); // thread ids are chat-<Date.now()>, as in legacy: two in one millisecond are the same thread
    const id = (await useAppStore.getState().createThread())!;
    const before = await saved(other);
    await sendMessage(id, 'q');
    const after = await loadChatState();
    expect(after.threads[other]).toEqual(before);
    expect(after.prefs.tone).toBe('formal');
  });

  it('materialises a never-opened seed thread as a chat row, but refuses doc-main until legacy has saved it', async () => {
    setRunTurnDepsForTests(() => deps(provider('claude', async function* () { yield { t: 'done', text: 'ok' }; })));
    await sendMessage('pricing', 'q');
    expect((await saved('pricing')).kind).toBe('chat');
    await sendMessage('doc-main', 'q');
    expect((await loadChatState()).threads['doc-main']).toBeUndefined();
  });

  it('a thread deleted mid-stream is not resurrected by the finishing write', async () => {
    const g = gate();
    setRunTurnDepsForTests(() => deps(provider('claude', async function* () { await g.wait; yield { t: 'done', text: 'ok' }; })));
    const id = (await useAppStore.getState().createThread())!;
    const sending = sendMessage(id, 'q');
    await sleep(20);
    await useAppStore.getState().deleteThread(id);
    g.release();
    await sending;
    expect((await loadChatState()).threads[id]).toBeUndefined();
  });
});

describe('the saved usage block and Continue', () => {
  it('a finished reply is saved with its collapsible model/tokens/cost line, context included', async () => {
    setRunTurnDepsForTests(() => deps(provider('claude', async function* () {
      yield { t: 'delta', text: 'Done.' };
      yield { t: 'done', text: 'Done.', usage: { inputTokens: 1000, outputTokens: 500, requestCount: 1, context: { system: 'THE SYSTEM PROMPT', tools: ['wikipedia_search'], messages: [{ role: 'user', content: 'q' }] } } };
    })));
    const id = (await useAppStore.getState().createThread())!;
    await sendMessage(id, 'q');
    const html = (await saved(id)).stream as string;
    expect(html).toContain('<details class="llm-meta">');
    expect(html).toContain('Claude Sonnet 5 · 1.5k tokens');
    expect(html).toContain('THE SYSTEM PROMPT');
    expect(html).toContain('TOOLS\nwikipedia_search');
    // not on the question, and not on a reply that failed
    expect((html.match(/llm-meta"/g) ?? []).length).toBe(1);
  });

  it('a reply cut off by the token limit offers Continue; Continue sends the fixed prompt as a "Continue" bubble, with the cut-off reply behind it', async () => {
    let n = 0;
    setRunTurnDepsForTests(() => deps(provider('claude', async function* () {
      n += 1;
      yield { t: 'delta', text: n === 1 ? 'Half of an ans' : ' and the rest.' };
      yield { t: 'done', text: n === 1 ? 'Half of an ans' : ' and the rest.', usage: { inputTokens: 1, outputTokens: 1, stopReason: n === 1 ? 'max_tokens' : 'end_turn' } };
    })));
    const id = (await useAppStore.getState().createThread())!;
    await sendMessage(id, 'long question');
    expect(useChatStore.getState().cont[id]).toEqual({ turnId: expect.any(String), count: 0 });

    await continueMain(id, 0);
    expect(seen[1]!.messages).toEqual([
      { role: 'user', content: 'long question' }, { role: 'assistant', content: 'Half of an ans' },
      { role: 'user', content: CONTINUE_PROMPT },
    ]);
    const t = await saved(id);
    expect(t.stream).toContain('<div class="bub"><div style="margin-bottom:0">Continue</div>');
    expect(t.mainMessages).toHaveLength(4);
    expect(t.mainMessages![2]).toEqual({ role: 'user', content: CONTINUE_PROMPT });
    expect(useChatStore.getState().cont[id]).toBeUndefined(); // ended normally this time
  });

  it('continuing keeps counting, and a continued reply that is cut off again offers the next one', async () => {
    setRunTurnDepsForTests(() => deps(provider('claude', async function* () {
      yield { t: 'delta', text: 'more ' };
      yield { t: 'done', text: 'more ', usage: { inputTokens: 1, outputTokens: 1, stopReason: 'max_tokens' } };
    })));
    const id = (await useAppStore.getState().createThread())!;
    await sendMessage(id, 'q');
    await continueMain(id, 0);
    expect(useChatStore.getState().cont[id]!.count).toBe(1);
    await continueMain(id, 1);
    expect(useChatStore.getState().cont[id]!.count).toBe(2);
  });

  it('a reply cut short by an error also offers Continue, with its count', async () => {
    setRunTurnDepsForTests(() => deps(provider('claude', async function* () {
      yield { t: 'delta', text: 'partial' };
      yield { t: 'error', kind: 'other', message: 'Stream interrupted — partial response preserved.' };
    })));
    const id = (await useAppStore.getState().createThread())!;
    await sendMessage(id, 'q');
    expect(useChatStore.getState().cont[id]).toMatchObject({ count: 0 });
  });

  it('a failed Continue is retried AS a Continue, not as the words "Continue"', async () => {
    let n = 0;
    setRunTurnDepsForTests(() => deps(provider('claude', async function* () {
      n += 1;
      if (n === 2) { yield { t: 'error', kind: 'other', message: 'Claude is overloaded right now — try again in a moment.' }; return; }
      yield { t: 'done', text: n === 1 ? 'cut' : 'rest', usage: { inputTokens: 1, outputTokens: 1, stopReason: n === 1 ? 'max_tokens' : 'end_turn' } };
    })));
    const id = (await useAppStore.getState().createThread())!;
    await sendMessage(id, 'q');
    await continueMain(id, 0);
    expect(useChatStore.getState().failed[id]).toBeDefined();
    await retryTurn(id);
    expect(seen.at(-1)!.messages.at(-1)).toEqual({ role: 'user', content: CONTINUE_PROMPT });
    expect((await saved(id)).mainMessages!.at(-1)).toEqual({ role: 'assistant', content: 'rest' });
  });

  it('a new message clears any pending Continue offer', async () => {
    let n = 0;
    setRunTurnDepsForTests(() => deps(provider('claude', async function* () {
      n += 1;
      yield { t: 'done', text: 'x', usage: { inputTokens: 1, outputTokens: 1, stopReason: n === 1 ? 'max_tokens' : 'end_turn' } };
    })));
    const id = (await useAppStore.getState().createThread())!;
    await sendMessage(id, 'one');
    expect(useChatStore.getState().cont[id]).toBeDefined();
    await sendMessage(id, 'two');
    expect(useChatStore.getState().cont[id]).toBeUndefined();
  });
});
