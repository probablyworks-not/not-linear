import { openChatDb } from '../../src/db/chat';
import { loadChatState, resetChatRepoForTests } from '../../src/db/chat-repo';
import { useAppStore } from '../../src/state/app-store';
import { useChatStore } from '../../src/chat/chat-store';
import { sendMessage, setRunTurnDepsForTests, stopStreaming } from '../../src/chat/send';
import {
  CLARIFY_SYSTEM_PROMPT, awaitAnswers, parseQuestions, renderClarifyBlock, resolveClarify, shouldClarify,
} from '../../src/chat/clarify';
import type { RunTurnDeps } from '../../src/chat/run-turn';
import type { ChatProvider, ChatRequest, ProviderEvent } from '../../src/providers/types';

const QUESTIONS = JSON.stringify({ questions: [
  { question: 'Who is it for?', options: [{ label: 'Beginners' }, { label: 'Experts', hint: 'assumes background' }] },
  { question: 'How long?', options: ['Short', 'Detailed'], multi: false },
] });

describe('parseQuestions', () => {
  it('reads plain JSON, adds ids, accepts string or object options', () => {
    const qs = parseQuestions(QUESTIONS);
    expect(qs.map(q => q.id)).toEqual(['q1', 'q2']);
    expect(qs[0]!.options).toEqual([{ label: 'Beginners' }, { label: 'Experts', hint: 'assumes background' }]);
    expect(qs[1]!.options).toEqual([{ label: 'Short' }, { label: 'Detailed' }]);
  });
  it('survives code fences and prose around the object', () => {
    expect(parseQuestions('Sure!\n```json\n' + QUESTIONS + '\n```')).toHaveLength(2);
  });
  it('treats junk, empty and malformed as no questions', () => {
    expect(parseQuestions('')).toEqual([]);
    expect(parseQuestions('not json {')).toEqual([]);
    expect(parseQuestions('{"questions":[]}')).toEqual([]);
    expect(parseQuestions('{"questions":[{"question":"x","options":["only one"]}]}')).toEqual([]);
    expect(parseQuestions('{"questions":"nope"}')).toEqual([]);
  });
  it('caps at 4 questions and 4 options', () => {
    const many = { questions: Array.from({ length: 7 }, (_, i) => ({ question: `q${i}`, options: ['a', 'b', 'c', 'd', 'e', 'f'] })) };
    const qs = parseQuestions(JSON.stringify(many));
    expect(qs).toHaveLength(4);
    expect(qs[0]!.options).toHaveLength(4);
  });
});

describe('shouldClarify', () => {
  const base = { enabled: true, userText: 'Help me plan a launch for the app', alreadyClarified: false };
  it('asks for a fresh, wordy message', () => expect(shouldClarify(base)).toBe(true));
  it('does not when off, already decided, one-off, continuing, or too short', () => {
    expect(shouldClarify({ ...base, enabled: false })).toBe(false);
    expect(shouldClarify({ ...base, alreadyClarified: true })).toBe(false);
    expect(shouldClarify({ ...base, noRetry: true })).toBe(false);
    expect(shouldClarify({ ...base, continueCount: 1 })).toBe(false);
    expect(shouldClarify({ ...base, userText: 'hi there' })).toBe(false);
  });
});

describe('renderClarifyBlock', () => {
  it('lists answered questions and is empty when nothing was answered', () => {
    const block = renderClarifyBlock([{ id: 'q1', question: 'Who is it for?', answer: 'Beginners' }, { id: 'q2', question: 'Skipped?', answer: ' ' }]);
    expect(block).toContain('Who is it for? → Beginners');
    expect(block).not.toContain('Skipped?');
    expect(renderClarifyBlock([])).toBe('');
  });
});

describe('awaitAnswers', () => {
  it('resolves with the answers, with null on skip, and with null when stopped', async () => {
    const c = new AbortController();
    const p = awaitAnswers('k', c.signal);
    resolveClarify('k', [{ id: 'q1', question: 'Q', answer: 'A' }]);
    expect(await p).toEqual([{ id: 'q1', question: 'Q', answer: 'A' }]);

    const p2 = awaitAnswers('k', c.signal);
    resolveClarify('k', null);
    expect(await p2).toBeNull();

    const p3 = awaitAnswers('k', c.signal);
    c.abort();
    expect(await p3).toBeNull();
  });
});

// The whole flow through sendMessage with fake providers: first call is the questions, then the reply.
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const seen: ChatRequest[] = [];
const isClarify = (req: ChatRequest): boolean => req.systemPrompt === CLARIFY_SYSTEM_PROMPT;
function fakeDeps(questionsJson: string): RunTurnDeps {
  const claude: ChatProvider = {
    id: 'claude', caps: { thinking: false, nativeToolUse: false, maxToolRounds: 0 },
    stream: (req): AsyncGenerator<ProviderEvent> => {
      seen.push(req);
      return (async function* () {
        yield { t: 'done', text: isClarify(req) ? questionsJson : 'Here is your tailored answer.' };
      })();
    },
  };
  const deepseek: ChatProvider = { ...claude, id: 'deepseek' };
  return { providers: { claude, deepseek }, canFallBackToDeepSeek: false };
}
async function untilAsking(id: string): Promise<void> {
  for (let i = 0; i < 100 && !useChatStore.getState().live[id]?.clarify; i++) await sleep(10);
}

describe('clarify flow', () => {
  let id: string;
  beforeEach(async () => {
    seen.length = 0;
    await resetChatRepoForTests();
    const d = openChatDb();
    await d.kv.clear();
    d.close();
    localStorage.clear();
    useChatStore.setState({ live: {}, failed: {} });
    await useAppStore.getState().hydrate();
    id = (await useAppStore.getState().createThread())!;
  });
  afterEach(() => setRunTurnDepsForTests(null));

  it('asks, waits, then anchors the reply on the answers without touching the saved user text', async () => {
    setRunTurnDepsForTests(() => fakeDeps(QUESTIONS));
    const sending = sendMessage(id, 'Write me an explainer about tides');
    await untilAsking(id);
    expect(useChatStore.getState().live[id]!.clarify).toHaveLength(2);
    expect(seen).toHaveLength(1); // only the questions call so far: the reply waits

    resolveClarify(id, [{ id: 'q1', question: 'Who is it for?', answer: 'Beginners' }]);
    await sending;

    const reply = seen[1]!;
    expect(isClarify(reply)).toBe(false);
    expect(reply.systemPrompt).toContain('Who is it for? → Beginners');
    expect(reply.messages).toEqual([{ role: 'user', content: 'Write me an explainer about tides' }]);

    const t = (await loadChatState()).threads[id]!;
    expect(t.mainMessages).toEqual([
      { role: 'user', content: 'Write me an explainer about tides' }, { role: 'assistant', content: 'Here is your tailored answer.' },
    ]);
    expect(Object.values(t.clarifications as Record<string, unknown[]>)[0]).toEqual([{ id: 'q1', question: 'Who is it for?', answer: 'Beginners' }]);
  });

  it('skip answers straight away with no anchor', async () => {
    setRunTurnDepsForTests(() => fakeDeps(QUESTIONS));
    const sending = sendMessage(id, 'Write me an explainer about tides');
    await untilAsking(id);
    resolveClarify(id, null);
    await sending;
    expect(seen[1]!.systemPrompt).not.toContain('clarifying questions');
    expect((await loadChatState()).threads[id]!.clarifications).toBeUndefined();
  });

  it('goes straight to the reply when the model has no questions', async () => {
    setRunTurnDepsForTests(() => fakeDeps('{"questions":[]}'));
    await sendMessage(id, 'Write me an explainer about tides');
    expect(seen).toHaveLength(2);
    expect(isClarify(seen[0]!)).toBe(true);
    expect(useChatStore.getState().live[id]).toBeUndefined();
  });

  it('is off when the setting is off: one request only', async () => {
    localStorage.setItem('nl_clarify_first', '0');
    setRunTurnDepsForTests(() => fakeDeps(QUESTIONS));
    await sendMessage(id, 'Write me an explainer about tides');
    expect(seen).toHaveLength(1);
    expect(isClarify(seen[0]!)).toBe(false);
  });

  it('stopping while the card is open ends the turn without a reply', async () => {
    setRunTurnDepsForTests(() => fakeDeps(QUESTIONS));
    const sending = sendMessage(id, 'Write me an explainer about tides');
    await untilAsking(id);
    stopStreaming(id);
    await sending;
    expect(seen.filter(r => !isClarify(r))).toHaveLength(0);
    expect(useChatStore.getState().live[id]).toBeUndefined();
  });
});
