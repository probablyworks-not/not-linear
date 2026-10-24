// DeepSeek sometimes writes its tool call as MARKUP in the visible text instead of a proper
// tool_calls delta (bug #018): XML/DSML tags with full- or half-width pipes. That markup must
// never reach the user. Ported from providers/deepseek.js (the helpers above callDeepSeek).

export const DEEPSEEK_TOOL_MARKUP_HOLD_CHARS = 180;

const START_PATTERNS: Array<{ kind: 'tool_calls' | 'invoke'; re: RegExp }> = [
  { kind: 'tool_calls', re: /<\s*(?:[｜|]\s*){0,3}(?:DSML\s*(?:[｜|]\s*){0,3})?(?:(?:tool|function)[_▁ ]?)?calls\s*(?:[｜|]\s*){0,3}>/i },
  { kind: 'invoke', re: /<\s*(?:[｜|]\s*){0,3}(?:DSML\s*(?:[｜|]\s*){0,3})?invoke\b[^>]*>/i },
];
const END_PATTERNS: Record<'tool_calls' | 'invoke', RegExp> = {
  tool_calls: /<\s*\/\s*(?:[｜|]\s*){0,3}(?:DSML\s*(?:[｜|]\s*){0,3})?(?:(?:tool|function)[_▁ ]?)?calls\s*(?:[｜|]\s*){0,3}>/i,
  invoke: /<\s*\/\s*(?:[｜|]\s*){0,3}(?:DSML\s*(?:[｜|]\s*){0,3})?invoke\s*(?:[｜|]\s*){0,3}>/i,
};

/** The earliest pseudo-tool-call start in `text`, or null. */
function pseudoToolStart(text: string): { index: number; kind: 'tool_calls' | 'invoke' } | null {
  let best: { index: number; kind: 'tool_calls' | 'invoke' } | null = null;
  for (const p of START_PATTERNS) {
    const m = p.re.exec(text);
    if (m && (!best || m.index < best.index)) best = { index: m.index, kind: p.kind };
  }
  return best;
}

/** Offset just past the matching closing tag, or -1 if it has not streamed in yet. */
function pseudoToolEnd(text: string, kind: 'tool_calls' | 'invoke'): number {
  const m = END_PATTERNS[kind].exec(text);
  return m ? m.index + m[0].length : -1;
}

export interface Consumed { visible: string; rest: string; suppressed: boolean }

/**
 * Filters pseudo-tool-call markup out of streamed text before it is shown. A tag can be split
 * across chunks, so text is HELD back (the last HOLD_CHARS) in case it is the start of one;
 * `force` (at the end of the stream) flushes everything, including an unterminated tag.
 * Returns what is safe to show, what must be held for the next call, and whether markup was cut.
 */
export function consumeDeepSeekVisibleContent(buffer: string, force = false): Consumed {
  let rest = buffer || '';
  let visible = '';
  let suppressed = false;
  while (rest) {
    const start = pseudoToolStart(rest);
    if (!start) {
      if (force) {
        visible += rest;
        rest = '';
      } else {
        const emitLen = Math.max(0, rest.length - DEEPSEEK_TOOL_MARKUP_HOLD_CHARS);
        visible += rest.slice(0, emitLen);
        rest = rest.slice(emitLen);
      }
      break;
    }
    visible += rest.slice(0, start.index);
    const markup = rest.slice(start.index);
    const end = pseudoToolEnd(markup, start.kind);
    suppressed = true;
    if (end >= 0) {
      rest = markup.slice(end);
    } else {
      rest = force ? '' : markup;
      break;
    }
  }
  return { visible, rest, suppressed };
}

/** Appended once the tool budget is spent: answer from what is already in the conversation (bug #015). */
export function synthesisOnlyMessages<T extends { role: string; content: unknown }>(messages: readonly T[]): Array<T | { role: 'user'; content: string }> {
  return [...messages, {
    role: 'user' as const,
    content: 'Use the retrieved tool results already in this conversation to write the final answer now. Do not call tools. Do not output XML, DSML, tool-call markup, or code blocks for tool calls. Do not say you are going to look anything up.',
  }];
}

/** Retry after a tool attempt that did not parse: answer now, from knowledge. */
export function noToolsMessages<T extends { role: string; content: unknown }>(messages: readonly T[]): Array<T | { role: 'user'; content: string }> {
  return [...messages, {
    role: 'user' as const,
    content: 'You cannot call tools or open links here. Answer now from your own knowledge, and say plainly which linked pages you could not read. Do not output XML, DSML, or tool-call markup.',
  }];
}
