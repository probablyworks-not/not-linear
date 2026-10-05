import { runTurn, FALLBACK_STATUS, type RunTurnDeps, type SupportedPlan, type TurnEvent } from '../../src/chat/run-turn';
import { planModel } from '../../src/chat/models';
import type { ChatProvider, ProviderEvent } from '../../src/providers/types';

const fake = (id: 'claude' | 'deepseek', events: ProviderEvent[]): ChatProvider & { calls: number } => {
  const p = {
    id, calls: 0, caps: { thinking: false, nativeToolUse: false, maxToolRounds: 0 },
    async *stream() { p.calls += 1; for (const e of events) yield e; },
  };
  return p;
};
const rateLimit: ProviderEvent = { t: 'error', kind: 'rate_limit', message: 'Claude rate limit hit — wait a moment' };
const done = (text: string): ProviderEvent => ({ t: 'done', text, usage: { inputTokens: 1, outputTokens: 1 } });
const plan = planModel('sonnet', false) as SupportedPlan;
async function run(deps: RunTurnDeps, p: SupportedPlan = plan): Promise<TurnEvent[]> {
  const out: TurnEvent[] = [];
  for await (const e of runTurn({ messagesFor: () => [], systemPrompt: '', plan: p, signal: new AbortController().signal }, deps)) out.push(e);
  return out;
}

describe('Claude→DeepSeek fallback (bug #023)', () => {
  it('a rate limit before any text switches to DeepSeek, says so, and reports the plan that answered', async () => {
    const claude = fake('claude', [rateLimit]);
    const deepseek = fake('deepseek', [{ t: 'delta', text: 'ok' }, done('ok')]);
    const events = await run({ providers: { claude, deepseek }, canFallBackToDeepSeek: true });
    expect(events.map(e => e.ev.t)).toEqual(['status', 'delta', 'done']);
    expect(events[0]!.ev).toEqual({ t: 'status', label: FALLBACK_STATUS });
    expect(events.at(-1)!.plan).toMatchObject({ provider: 'deepseek', modelId: 'deepseek-v4-flash', usageProvider: 'deepseek' });
    expect(claude.calls).toBe(1);
    expect(deepseek.calls).toBe(1);
  });

  it('without a DeepSeek key the rate limit is surfaced', async () => {
    const claude = fake('claude', [rateLimit]);
    const deepseek = fake('deepseek', [done('never')]);
    const events = await run({ providers: { claude, deepseek }, canFallBackToDeepSeek: false });
    expect(events.map(e => e.ev)).toEqual([rateLimit]);
    expect(deepseek.calls).toBe(0);
  });

  it('a rate limit AFTER text has streamed keeps the partial answer instead of switching', async () => {
    const claude = fake('claude', [{ t: 'delta', text: 'half' }, rateLimit]);
    const deepseek = fake('deepseek', [done('never')]);
    const events = await run({ providers: { claude, deepseek }, canFallBackToDeepSeek: true });
    expect(events.map(e => e.ev.t)).toEqual(['delta', 'error']);
    expect(deepseek.calls).toBe(0);
  });

  it('switches at most once: DeepSeek rate limiting is surfaced', async () => {
    const claude = fake('claude', [rateLimit]);
    const deepseek = fake('deepseek', [{ t: 'error', kind: 'rate_limit', message: 'DeepSeek rate limit hit' }]);
    const events = await run({ providers: { claude, deepseek }, canFallBackToDeepSeek: true });
    expect(events.map(e => e.ev.t)).toEqual(['status', 'error']);
    expect(deepseek.calls).toBe(1);
  });

  it('a DeepSeek-first turn never falls back', async () => {
    const claude = fake('claude', [done('never')]);
    const deepseek = fake('deepseek', [{ t: 'error', kind: 'rate_limit', message: 'x' }]);
    const events = await run({ providers: { claude, deepseek }, canFallBackToDeepSeek: true }, planModel('deepseek', false) as SupportedPlan);
    expect(events.map(e => e.ev.t)).toEqual(['error']);
    expect(claude.calls).toBe(0);
  });

  it('a non-rate-limit error is not retried', async () => {
    const claude = fake('claude', [{ t: 'error', kind: 'other', message: 'boom' }]);
    const deepseek = fake('deepseek', [done('never')]);
    const events = await run({ providers: { claude, deepseek }, canFallBackToDeepSeek: true });
    expect(events.map(e => e.ev.t)).toEqual(['error']);
    expect(deepseek.calls).toBe(0);
  });
});

describe('planModel', () => {
  it('maps the persisted pref ids exactly as legacy does', () => {
    expect(planModel('opus', false)).toMatchObject({ modelId: 'claude-opus-5', provider: 'claude' });
    expect(planModel('haiku', true)).toMatchObject({ modelId: 'claude-haiku-4-5-20251001', thinking: false });
    expect(planModel('sonnet', true)).toMatchObject({ modelId: 'claude-sonnet-5', thinking: true });
    expect(planModel(undefined, false)).toMatchObject({ modelId: 'claude-sonnet-5' });
    expect(planModel('deepseek-r1', false)).toMatchObject({ provider: 'deepseek', thinking: true });
    expect(planModel('gpt-4o', false)).toMatchObject({ supported: false });
    expect(planModel('gemini-pro', false)).toMatchObject({ supported: false });
  });
});
