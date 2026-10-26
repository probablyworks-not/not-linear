import { runTurn, type RunTurnDeps } from '../../chat/run-turn';
import { planModel } from '../../chat/models';
import { buildSystemPrompt } from '../../chat/system-prompt';
import { userContentFor } from '../../chat/user-content';
import { friendlyError } from '../../lib/markdown';
import { claudeProvider } from '../../providers/claude';
import { deepseekProvider } from '../../providers/deepseek';
import { openaiProvider, geminiProvider } from '../../providers/openai';
import { readApiKeys } from '../../lib/api-keys';
import type { Attachment } from '../../attachments/read-files';
import type { PersistedPrefs, PersistedProject } from '../../db/types';
import { newId } from '../ids';
import { resolveContext, manifestFor } from '../context/resolve';
import { acceptRun, addMessage, setRunStatus, textPart } from '../domain/commands';
import { extractHtmlDoc } from './html-trigger';
import type { CanvasDoc, CanvasPart, RunStatus, RunUsage } from '../types';

// Canvas execution. Calls `runTurn` directly rather than going through `run-and-persist`, which
// dual-writes rendered HTML for the legacy app to re-read (ADR-038) and drives `useChatStore`'s
// live maps. Canvas has no legacy counterpart and its own document, so it reuses the parts that
// matter — the provider event stream, the Claude→DeepSeek rate-limit fallback, the tool loop's
// semantics, abort-based cancellation and usage accounting — and none of the parts that do not.
// That is the precedent ADR-065 set for the designs pipeline.

const defaultDeps = (): RunTurnDeps => ({
  providers: { claude: claudeProvider, deepseek: deepseekProvider, openai: openaiProvider, gemini: geminiProvider },
  canFallBackToDeepSeek: !!readApiKeys().deepseek,
});

/** Swapped by tests; production always uses the real providers. */
let depsFactory: () => RunTurnDeps = defaultDeps;
export function setCanvasDepsForTests(factory: (() => RunTurnDeps) | null): void {
  depsFactory = factory ?? defaultDeps;
}

/** The same provider deps a canvas turn streams with — for callers (the clarify pre-flight)
 * that need to run a turn-shaped request outside `runCanvasTurn` itself. */
export function canvasTurnDeps(): RunTurnDeps {
  return depsFactory();
}

export interface CanvasTurnInput {
  threadId: string;
  /** Stable per send. The same id twice is the same submission, not a second one. */
  submissionId: string;
  modelPref: string | undefined;
  prefs: PersistedPrefs;
  project?: PersistedProject;
  extraContext?: string;
  /** Opt-in only, set by an explicit phrase in the prompt (html-trigger.ts) — never inferred. */
  wantsHtml?: boolean;
  /**
   * C9. Files picked in the Ink composer for *this* send. Native PDF/image blocks for a provider
   * that supports them (today: Claude), text content inline for the rest — same `userContentFor`
   * chat already uses. These are display-only on the canvas document itself (the attachment part
   * carries no asset, since Canvas has no asset store yet — C5); the bytes only ever go to the
   * model for this one turn.
   */
  attachments?: Attachment[];
}

export interface CanvasTurnHooks {
  /** Applies a change to the document and persists it. */
  apply<T>(fn: (doc: CanvasDoc) => T): Promise<T | null>;
  /** Called with the text so far, often. The caller decides how to coalesce. */
  onDelta(messageId: string, text: string): void;
  onStatus(label: string | null): void;
  register(controller: AbortController): void;
}

export interface CanvasTurnResult {
  status: RunStatus;
  runId: string;
  messageId: string | null;
  text: string;
  usage?: RunUsage;
  error?: string;
  duplicate?: boolean;
}

/**
 * One submission. Accepts it (or recognises it as already accepted), resolves the context, streams
 * the reply into a message, and records a terminal status.
 *
 * Whatever happens, text that arrived is kept: a cancel, a timeout or a refresh leaves an
 * interrupted message with its partial content, never an empty one (AC-08).
 */
export async function runCanvasTurn(input: CanvasTurnInput, hooks: CanvasTurnHooks): Promise<CanvasTurnResult> {
  const now = Date.now();
  const plan = planModel(input.modelPref, !!input.prefs.thinking);

  // Accept first, so a double-click or a replayed send finds the existing run and stops here.
  const accepted = await hooks.apply(d => acceptRun(d, {
    submissionId: input.submissionId, threadId: input.threadId,
    provider: plan.supported ? plan.provider : 'none', model: plan.supported ? plan.modelId : 'none',
  }, { now }));
  if (!accepted) return { status: 'failed', runId: '', messageId: null, text: '', error: 'This canvas is no longer open.' };
  if (accepted.duplicate) {
    return { status: accepted.run.status, runId: accepted.run.id, messageId: null, text: '', duplicate: true };
  }
  const runId = accepted.run.id;

  if (!plan.supported) {
    // An unusable model is told plainly, in the card, and the run is terminal.
    await hooks.apply(d => setRunStatus(d, runId, 'failed', { now: Date.now() }, { error: plan.reason }));
    return { status: 'failed', runId, messageId: null, text: '', error: plan.reason };
  }

  const controller = new AbortController();
  hooks.register(controller);

  // The reply's message exists before the first token, so a reload mid-stream finds it rather than
  // losing the fact that a question was asked at all.
  const created = await hooks.apply(d => {
    // C10. Disclosure only — the rules' *text* already reaches the model through the system
    // prompt (`buildSystemPrompt` below takes `input.project` directly); this is what makes the
    // Context Islands' Rules tab say "inherited" truthfully instead of always reading empty.
    const inheritedRules = input.project?.rules?.trim() ? ['project-rules'] : [];
    const context = resolveContext(d, input.threadId, { inheritedRules });
    d.manifests.push(manifestFor(runId, context.manifest, now));
    const msg = addMessage(d, {
      threadId: input.threadId,
      author: { kind: 'model', provider: plan.provider, model: plan.modelId },
      parts: [{ id: newId('pt'), kind: 'text', state: 'pending', text: '' }],
      producedByRunId: runId,
      provisional: true,
    }, { now });
    setRunStatus(d, runId, 'streaming', { now });
    return { messageId: msg.id, partId: msg.parts[0]!.id, messages: context.messages };
  });
  if (!created) return { status: 'failed', runId, messageId: null, text: '', error: 'This canvas is no longer open.' };

  const { messageId, partId, messages } = created;
  // The attachments belong to the question that was just sent — always the last message
  // `resolveContext` produced, since it walks the ancestor chain ending at this thread's own,
  // newest-first-by-seq turn. Swapping its `content` here (rather than threading attachments
  // through `resolveContext` itself) keeps attachments a per-send, per-provider concern: a native
  // image/PDF block only ever makes sense for the provider that is about to see it.
  if (input.attachments?.length) {
    const last = messages[messages.length - 1];
    if (last?.role === 'user' && typeof last.content === 'string') {
      last.content = userContentFor(plan.provider, last.content, input.attachments);
    }
  }
  let text = '';

  const settle = async (status: RunStatus, extra: { error?: string; usage?: RunUsage } = {}): Promise<CanvasTurnResult> => {
    await hooks.apply(d => {
      const m = d.messages.find(x => x.id === messageId);
      if (m) {
        const idx = m.parts.findIndex(p => p.id === partId);
        const part = idx >= 0 ? m.parts[idx] : undefined;
        if (part && part.kind === 'text') {
          // Partial text is a real answer that stopped, not a failure to show. Only a run that
          // produced nothing at all is marked failed on the part itself.
          const ready = status === 'completed' || !!text.trim();
          if (input.wantsHtml && text.trim()) {
            // Swap the whole part: the model's reply is the HTML document itself, not markdown.
            m.parts[idx!] = {
              id: partId, kind: 'html', state: ready ? 'ready' : 'failed', html: extractHtmlDoc(text),
              ...(!ready && extra.error ? { error: friendlyError(extra.error) } : {}),
            };
          } else {
            part.text = text;
            part.state = ready ? 'ready' : 'failed';
            if (part.state === 'failed' && extra.error) part.error = friendlyError(extra.error);
          }
        }
        m.updatedAt = Date.now();
      }
      setRunStatus(d, runId, status, { now: Date.now() }, extra);
    });
    hooks.onStatus(null);
    return { status, runId, messageId, text, ...(extra.usage ? { usage: extra.usage } : {}), ...(extra.error ? { error: extra.error } : {}) };
  };

  try {
    const systemPrompt = buildSystemPrompt({
      prefs: input.prefs, project: input.project, apiKeys: readApiKeys(), extraContext: input.extraContext ?? '',
    });
    const turnInput = {
      messagesFor: () => messages,
      systemPrompt,
      plan,
      signal: controller.signal,
    };

    for await (const { ev, plan: used } of runTurn(turnInput, depsFactory())) {
      if (ev.t === 'delta') {
        text += ev.text;
        hooks.onDelta(messageId, text);
      } else if (ev.t === 'status') {
        hooks.onStatus(ev.label || null);
      } else if (ev.t === 'done') {
        text = ev.text || text;
        const usage: RunUsage | undefined = ev.usage && {
          inputTokens: ev.usage.inputTokens,
          outputTokens: ev.usage.outputTokens,
          ...(ev.usage.cacheHitTokens !== undefined ? { cacheHitTokens: ev.usage.cacheHitTokens } : {}),
        };
        void used;
        return await settle('completed', usage ? { usage } : {});
      } else if (ev.t === 'error') {
        // Aborted is not a failure: the user asked it to stop, and what arrived is theirs.
        return await settle(ev.kind === 'aborted' ? 'cancelled' : 'failed', { error: ev.message });
      }
    }
    // A provider that ends without `done` or `error` is a bug in the provider. Say so.
    return await settle('unknown', { error: 'The response ended unexpectedly. Retry to get a fresh answer.' });
  } catch (e) {
    return await settle('failed', { error: e instanceof Error ? e.message : String(e) });
  }
}

/** A fresh submission id. One per Send, reused across retries of that same send. */
export const newSubmissionId = (): string => newId('sb');

export const partsOfText = (text: string): CanvasPart[] => [textPart(text)];
