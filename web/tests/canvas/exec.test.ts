import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCanvasTurn, setCanvasDepsForTests } from '../../src/canvas/exec/run-canvas-turn';
import { createCanvas, getCanvas, resetCanvasDbForTests, updateCanvas } from '../../src/canvas/canvas-repo';
import { createRootThread } from '../../src/canvas/domain/commands';
import type { ChatProvider, ChatRequest, ProviderEvent } from '../../src/providers/types';
import type { CanvasDoc, PartState } from '../../src/canvas/types';
import type { PersistedPrefs } from '../../src/db/types';

// Execution semantics. Deterministic fake providers, never a real one: a test that depends on a
// network call tells you about the network.

const prefs = { model: 'opus' } as unknown as PersistedPrefs;

function fakeProvider(events: ProviderEvent[], opts: { hang?: boolean } = {}): ChatProvider {
  return {
    id: 'claude',
    async *stream(req: ChatRequest) {
      for (const ev of events) {
        if (req.signal?.aborted) { yield { t: 'error', message: 'Aborted', kind: 'aborted' }; return; }
        yield ev;
      }
      if (opts.hang) {
        await new Promise<void>(resolve => {
          if (req.signal?.aborted) { resolve(); return; }
          req.signal?.addEventListener('abort', () => resolve());
        });
        yield { t: 'error', message: 'Aborted', kind: 'aborted' };
      }
    },
  } as unknown as ChatProvider;
}

const useProvider = (p: ChatProvider): void => {
  setCanvasDepsForTests(() => ({
    providers: { claude: p, deepseek: p, openai: p, gemini: p },
    canFallBackToDeepSeek: false,
  }));
};

async function seedCanvas(): Promise<{ canvasId: string; threadId: string }> {
  const c = await createCanvas({ projectId: 'p1', title: 'T' });
  const { result } = await updateCanvas(c.summary.id, d => createRootThread(d, 'the question', { now: 1 }).thread.id);
  return { canvasId: c.summary.id, threadId: result };
}

const hooksFor = (canvasId: string, seen: string[] = []) => ({
  apply: <T,>(fn: (d: CanvasDoc) => T) => updateCanvas(canvasId, fn).then(r => r.result),
  onDelta: (_id: string, text: string) => { seen.push(text); },
  onStatus: () => {},
  register: () => {},
});

describe('a canvas turn', () => {
  beforeEach(() => { resetCanvasDbForTests(`canvas-${Math.random()}`); });
  afterEach(() => { setCanvasDepsForTests(null); });

  it('streams a reply into the thread and records a completed run with usage', async () => {
    useProvider(fakeProvider([
      { t: 'delta', text: 'Hello ' },
      { t: 'delta', text: 'world' },
      { t: 'done', text: 'Hello world', usage: { inputTokens: 11, outputTokens: 4 } },
    ] as ProviderEvent[]));
    const { canvasId, threadId } = await seedCanvas();
    const seen: string[] = [];

    const res = await runCanvasTurn(
      { threadId, submissionId: 'sub-1', modelPref: 'opus', prefs },
      hooksFor(canvasId, seen),
    );

    expect(res.status).toBe('completed');
    expect(res.text).toBe('Hello world');
    expect(res.usage).toMatchObject({ inputTokens: 11, outputTokens: 4 });
    expect(seen).toEqual(['Hello ', 'Hello world']);

    const doc = (await getCanvas(canvasId))!;
    const reply = doc.messages.find(m => m.author.kind === 'model')!;
    expect(reply.parts[0]).toMatchObject({ kind: 'text', text: 'Hello world', state: 'ready' satisfies PartState });
    expect(reply.provisional).toBeUndefined();
    expect(doc.runs[0]).toMatchObject({ status: 'completed', submissionId: 'sub-1', attempt: 1 });
  });

  it('writes the reply message before the first token, so a reload mid-stream finds it', async () => {
    useProvider(fakeProvider([{ t: 'delta', text: 'partial' }], { hang: true }));
    const { canvasId, threadId } = await seedCanvas();
    const controllers: AbortController[] = [];

    const run = runCanvasTurn({ threadId, submissionId: 'sub-1', modelPref: 'opus', prefs }, {
      ...hooksFor(canvasId),
      register: c => controllers.push(c),
    });
    // give the turn a tick to create the message and start streaming
    await new Promise(r => setTimeout(r, 20));
    const during = (await getCanvas(canvasId))!;
    expect(during.messages.some(m => m.provisional)).toBe(true);
    expect(during.runs[0]!.status).toBe('streaming');

    controllers[0]!.abort();
    await run;
  });

  it('a cancelled run keeps the text that arrived and is not a failure', async () => {
    useProvider(fakeProvider([{ t: 'delta', text: 'half an answer' }], { hang: true }));
    const { canvasId, threadId } = await seedCanvas();
    const controllers: AbortController[] = [];

    const run = runCanvasTurn({ threadId, submissionId: 'sub-1', modelPref: 'opus', prefs }, {
      ...hooksFor(canvasId),
      register: c => controllers.push(c),
    });
    await new Promise(r => setTimeout(r, 20));
    controllers[0]!.abort();
    const res = await run;

    expect(res.status).toBe('cancelled');
    expect(res.text).toBe('half an answer');
    const doc = (await getCanvas(canvasId))!;
    const reply = doc.messages.find(m => m.author.kind === 'model')!;
    expect(reply.parts[0]).toMatchObject({ text: 'half an answer', state: 'ready' });
    expect(doc.runs[0]!.status).toBe('cancelled');
    expect(doc.runs[0]!.endedAt).toBeDefined();
  });

  it('a provider error with nothing streamed marks the part failed, with readable text', async () => {
    useProvider(fakeProvider([{ t: 'error', message: 'rate limited by the provider', kind: 'rate_limit' }] as ProviderEvent[]));
    const { canvasId, threadId } = await seedCanvas();

    const res = await runCanvasTurn({ threadId, submissionId: 'sub-1', modelPref: 'opus', prefs }, hooksFor(canvasId));
    expect(res.status).toBe('failed');

    const doc = (await getCanvas(canvasId))!;
    const reply = doc.messages.find(m => m.author.kind === 'model')!;
    expect(reply.parts[0]!.state).toBe('failed');
    expect(reply.parts[0]!.error).toBeTruthy();
    expect(doc.runs[0]!.error).toContain('rate limited');
  });

  it('a provider that ends without done or error is reported, not left hanging', async () => {
    useProvider(fakeProvider([{ t: 'delta', text: 'x' }] as ProviderEvent[]));
    const { canvasId, threadId } = await seedCanvas();
    const res = await runCanvasTurn({ threadId, submissionId: 'sub-1', modelPref: 'opus', prefs }, hooksFor(canvasId));
    expect(res.status).toBe('unknown');
    expect((await getCanvas(canvasId))!.runs[0]!.status).toBe('unknown');
  });

  it('the same submission twice does not produce a second run', async () => {
    useProvider(fakeProvider([{ t: 'done', text: 'once', usage: { inputTokens: 1, outputTokens: 1 } }] as ProviderEvent[]));
    const { canvasId, threadId } = await seedCanvas();

    const first = await runCanvasTurn({ threadId, submissionId: 'same', modelPref: 'opus', prefs }, hooksFor(canvasId));
    const second = await runCanvasTurn({ threadId, submissionId: 'same', modelPref: 'opus', prefs }, hooksFor(canvasId));

    expect(first.duplicate).toBeUndefined();
    expect(second.duplicate).toBe(true);
    const doc = (await getCanvas(canvasId))!;
    expect(doc.runs).toHaveLength(1);
    expect(doc.messages.filter(m => m.author.kind === 'model')).toHaveLength(1);
  });

  it('an unsupported model fails the run with the reason, and asks nothing of the provider', async () => {
    let asked = false;
    useProvider({ id: 'claude', async *stream() { asked = true; } } as unknown as ChatProvider);
    const { canvasId, threadId } = await seedCanvas();

    // `planModel` only rejects gpt-*/gemini-* ids it does not know; anything else falls back to
    // Claude, so this is what "unsupported" actually looks like.
    const res = await runCanvasTurn({ threadId, submissionId: 'sub-1', modelPref: 'gpt-9-imaginary', prefs }, hooksFor(canvasId));
    expect(res.status).toBe('failed');
    expect(res.error).toBeTruthy();
    expect(asked).toBe(false);
    expect((await getCanvas(canvasId))!.runs[0]!.status).toBe('failed');
  });

  it('records a context manifest against the run', async () => {
    useProvider(fakeProvider([{ t: 'done', text: 'ok', usage: { inputTokens: 1, outputTokens: 1 } }] as ProviderEvent[]));
    const { canvasId, threadId } = await seedCanvas();
    const res = await runCanvasTurn({ threadId, submissionId: 'sub-1', modelPref: 'opus', prefs }, hooksFor(canvasId));

    const doc = (await getCanvas(canvasId))!;
    const manifest = doc.manifests.find(m => m.runId === res.runId);
    expect(manifest).toBeDefined();
    expect(manifest!.snapshotIds).toEqual([]);
  });
});

describe('the canvas uses the same execution path as chat', () => {
  beforeEach(() => { resetCanvasDbForTests(`canvas-${Math.random()}`); });
  afterEach(() => { setCanvasDepsForTests(null); });

  it('plans the model exactly as the chat composer does', async () => {
    // Regression guard for "canvas does not answer while chat does". Both call planModel with the
    // same pref, so a model that works in a chat must work on a canvas.
    const seen: string[] = [];
    useProvider({
      id: 'openai',
      async *stream(req: ChatRequest) {
        seen.push(req.model ?? '(none)');
        yield { t: 'done', text: 'ok', usage: { inputTokens: 1, outputTokens: 1 } } as ProviderEvent;
      },
    } as unknown as ChatProvider);
    const { canvasId, threadId } = await seedCanvas();

    const res = await runCanvasTurn(
      { threadId, submissionId: 'sub-1', modelPref: 'gpt-5.6-sol', prefs },
      hooksFor(canvasId),
    );
    expect(res.status).toBe('completed');
    expect(seen).toEqual(['gpt-5.6-sol']);
    const doc = (await getCanvas(canvasId))!;
    expect(doc.runs[0]).toMatchObject({ provider: 'openai', model: 'gpt-5.6-sol' });
  });

  it('falls back to the default model when no preference is set, like chat', async () => {
    useProvider(fakeProvider([{ t: 'done', text: 'ok', usage: { inputTokens: 1, outputTokens: 1 } }] as ProviderEvent[]));
    const { canvasId, threadId } = await seedCanvas();
    const res = await runCanvasTurn({ threadId, submissionId: 's', modelPref: undefined, prefs: {} as typeof prefs }, hooksFor(canvasId));
    expect(res.status).toBe('completed');
    expect((await getCanvas(canvasId))!.runs[0]!.provider).toBe('claude');
  });
});
