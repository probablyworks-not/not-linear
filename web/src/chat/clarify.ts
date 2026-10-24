import type { ChatMessage } from '../providers/types';
import { runTurn, type RunTurnDeps, type SupportedPlan } from './run-turn';

// "Clarify intent first": before the real answer, ask the model whether the request is ambiguous
// and, if so, for a few multiple-choice questions. The answers become an anchor in the system
// prompt of the real request (see clarify-prompt.ts). It goes through runTurn with no tools and
// asks for plain JSON, so it works on every provider with no provider edits. Anything that goes
// wrong (bad JSON, an error, a timeout) means "no questions": the user's message is never blocked.
//
// This pass replaces the app's system prompt with its own, so it is blind to everything the real
// reply knows. `input.brief` (clarify-brief.ts) hands it a short digest of the project, and the
// rules below tell it never to ask what that digest already answers — without it, a message sent
// inside a well-described project still drew generic "what kind of product is this?" questions.

export interface ClarifyOption { label: string; hint?: string }
export interface ClarifyQuestion {
  id: string;
  question: string;
  options: ClarifyOption[];
  multi: boolean;
}
/** One answered question. `answer` is the chosen labels and any typed text, joined. */
export interface ClarifyAnswer { id: string; question: string; answer: string }

const MAX_QUESTIONS = 4;
const MAX_OPTIONS = 4;
const MIN_WORDS = 4;
const CLARIFY_TIMEOUT_MS = 15_000;
const HISTORY_MESSAGES = 4;
const HISTORY_CHARS = 600;

export const CLARIFY_SYSTEM_PROMPT = `You decide whether a user's message needs clarification before it can be answered well.

Reply with ONE JSON object and nothing else (no prose, no code fences):
{"questions":[{"question":"...","options":[{"label":"...","hint":"..."}],"multi":false}]}

Rules:
- If the message is clear, specific, simple, or a follow-up whose intent is obvious from the conversation, reply {"questions":[]}.
- A project context block may come first. It is settled fact. Never ask about anything it already states or strongly implies — the product, its users, the platform, the stack, the goal. Assume it.
- Count only the decisions the project context and the conversation leave genuinely open. If there are none, reply {"questions":[]} — that is the common case for a message sent inside a well-described project.
- Otherwise ask at most ${MAX_QUESTIONS} questions that would genuinely change the answer: goal, audience, scope, constraints, format, or depth. Never ask what you could reasonably assume.
- Each question has 2 to ${MAX_OPTIONS} short, mutually distinct options (labels under 8 words; "hint" is optional and under 12 words). Do not add an "Other" option; the interface adds one.
- Set "multi" to true only when several options can apply together.
- Write in the language of the user's message. Do not answer the message.`;

export interface ShouldClarifyInput {
  enabled: boolean;
  userText: string;
  continueCount?: number;
  /** Set for a one-off ask (the popover's Ask), which has no retry and no room for a card. */
  noRetry?: boolean;
  /** Already decided for this turn (answered, skipped, or a retry replaying them). */
  alreadyClarified: boolean;
}

export function shouldClarify(i: ShouldClarifyInput): boolean {
  if (!i.enabled || i.alreadyClarified || i.noRetry || (i.continueCount ?? 0) > 0) return false;
  const words = i.userText.trim().split(/\s+/).filter(Boolean);
  return words.length >= MIN_WORDS;
}

function stringOf(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** Tolerant: strips fences and prose around the object, drops anything malformed, caps the counts. */
export function parseQuestions(raw: string): ClarifyQuestion[] {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  let data: unknown;
  try { data = JSON.parse(raw.slice(start, end + 1)); } catch { return []; }
  const list = (data as { questions?: unknown } | null)?.questions;
  if (!Array.isArray(list)) return [];
  const out: ClarifyQuestion[] = [];
  for (const q of list) {
    if (out.length >= MAX_QUESTIONS) break;
    const rec = q as { question?: unknown; options?: unknown; multi?: unknown } | null;
    const question = stringOf(rec?.question);
    if (!question || !Array.isArray(rec?.options)) continue;
    const options: ClarifyOption[] = [];
    for (const o of rec.options as unknown[]) {
      if (options.length >= MAX_OPTIONS) break;
      const label = typeof o === 'string' ? o.trim() : stringOf((o as { label?: unknown } | null)?.label);
      if (!label) continue;
      const hint = typeof o === 'string' ? '' : stringOf((o as { hint?: unknown } | null)?.hint);
      options.push(hint ? { label, hint } : { label });
    }
    if (options.length < 2) continue;
    out.push({ id: `q${out.length + 1}`, question, options, multi: rec?.multi === true });
  }
  return out;
}

function recentContext(history: readonly ChatMessage[]): string {
  const lines = history
    .filter(m => typeof m.content === 'string')
    .slice(-HISTORY_MESSAGES)
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${(m.content as string).slice(0, HISTORY_CHARS)}`);
  return lines.length ? `Recent conversation:\n${lines.join('\n')}\n\n` : '';
}

export interface RunClarifyInput {
  plan: SupportedPlan;
  userText: string;
  history: readonly ChatMessage[];
  /** A short project digest (clarify-brief.ts), prefixed to the request. Absent outside a project. */
  brief?: string;
  signal: AbortSignal;
}

/** Asks the model for questions. Never throws: failure is an empty list. */
export async function runClarify(input: RunClarifyInput, deps: RunTurnDeps): Promise<ClarifyQuestion[]> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), CLARIFY_TIMEOUT_MS);
  const onAbort = (): void => timeout.abort();
  input.signal.addEventListener('abort', onAbort);
  try {
    const content = [input.brief, recentContext(input.history).trim(), `New message to assess:\n${input.userText}`]
      .filter(Boolean)
      .join('\n\n');
    const messages: ChatMessage[] = [{ role: 'user', content }];
    const turn = runTurn(
      { messagesFor: () => messages, systemPrompt: CLARIFY_SYSTEM_PROMPT, plan: { ...input.plan, thinking: false }, signal: timeout.signal },
      deps,
    );
    for await (const { ev } of turn) {
      if (ev.t === 'done') return parseQuestions(ev.text);
      if (ev.t === 'error') return [];
    }
    return [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
    input.signal.removeEventListener('abort', onAbort);
  }
}

// The UI answers through this bridge: runAndPersist awaits `awaitAnswers`, the card calls
// `resolveClarify`. Keyed like the chat store's live map (thread id, or `branch:<id>`).
const waiting = new Map<string, (answers: ClarifyAnswer[] | null) => void>();

/** Resolves with the answers, or null when skipped or the turn is stopped. */
export function awaitAnswers(key: string, signal: AbortSignal): Promise<ClarifyAnswer[] | null> {
  return new Promise(resolve => {
    const done = (answers: ClarifyAnswer[] | null): void => {
      waiting.delete(key);
      signal.removeEventListener('abort', onAbort);
      resolve(answers);
    };
    const onAbort = (): void => done(null);
    if (signal.aborted) { resolve(null); return; }
    signal.addEventListener('abort', onAbort);
    waiting.set(key, done);
  });
}

/** Called by the card: answers to continue, or null to skip. */
export function resolveClarify(key: string, answers: ClarifyAnswer[] | null): void {
  waiting.get(key)?.(answers);
}

/** The anchor handed to the real request, appended to its system prompt. Empty when nothing was answered. */
export function renderClarifyBlock(answers: readonly ClarifyAnswer[]): string {
  const given = answers.filter(a => a.answer.trim());
  if (!given.length) return '';
  const lines = given.map(a => `- ${a.question} → ${a.answer}`);
  return `The user answered clarifying questions about their request. Treat these answers as binding context for what they want, and tailor the reply to them without restating them:\n${lines.join('\n')}`;
}
