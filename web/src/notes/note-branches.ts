import { modeSystemPromptParts } from '../settings/modes';
import { pathOf } from './notes-ops';
import type { LegacyBlock, LegacyNote } from './types';
import type { ContentBlock } from '../providers/types';

// The pieces of an Ask-AI branch that need no DOM or editor: what may be branched, how it is titled,
// and the system prompt (notes.js buildNoteSystemPrompt, kept word for word).

/** BlockNote types a branch can anchor in: the legacy BRANCHABLE set (text, headings, lists, todo, toggle, quote, callout). */
export const BRANCHABLE_TYPES: ReadonlySet<string> = new Set([
  'paragraph', 'heading', 'bulletListItem', 'numberedListItem', 'checkListItem', 'toggle', 'quote', 'callout',
]);

export const truncate = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1).trim()}…` : s);

export const titleFromNoteQuote = (quote: string | null): string => truncate(quote || 'Untitled branch', 36);

/** The page's text, tags stripped, depth first through children and columns. */
export function pageText(blocks: readonly LegacyBlock[]): string {
  const out: string[] = [];
  const walk = (list: readonly LegacyBlock[]) => {
    for (const b of list) {
      if (typeof b.text === 'string' && b.text) out.push(b.text.replace(/<[^>]+>/g, ''));
      if (Array.isArray(b.children)) walk(b.children as LegacyBlock[]);
      if (Array.isArray(b.cols)) for (const c of b.cols as LegacyBlock[][]) walk(c);
    }
  };
  walk(blocks);
  return out.join('\n');
}

export function buildNoteSystemPrompt(
  notes: readonly LegacyNote[], note: LegacyNote, quote: string | null, prefs: Parameters<typeof modeSystemPromptParts>[0],
  extraContext?: string,
): string {
  const path = pathOf(notes, note.id).map(n => (typeof n.title === 'string' && n.title ? n.title : 'Untitled')).join(' › ');
  const content = pageText(note.blocks).slice(0, 3000);
  let prompt = `You are a research assistant helping the user think through their notes. Be concise and insightful.\n\nNote: ${path}`;
  if (content) prompt += `\n\nContent:\n${content}`;
  if (quote) prompt += `\n\nSelected passage:\n“${quote}”`;
  const mode = modeSystemPromptParts(prefs);
  if (mode.length) prompt += `\n\n${mode.join('\n')}`;
  if (extraContext) prompt += `\n\n${extraContext}`;
  return prompt;
}

/** The first message of an anchored branch carries the quote, as legacy sends it. Returns the
 * (possibly quote-prefixed) text of each message, unchanged otherwise — attachments for the
 * current turn are folded in separately by the caller (see `withAttachments` below). */
export function apiMessages(quote: string | null, messages: readonly { role: 'user' | 'assistant'; content: string }[]): { role: 'user' | 'assistant'; content: string }[] {
  const out = messages.map(m => ({ role: m.role, content: m.content }));
  if (quote && out.length === 1) out[0] = { role: 'user', content: `“${quote}”\n\n${out[0]!.content}` };
  return out;
}

/** Replaces the last message's content with its richer, provider-shaped form (text + attachments),
 * keeping the quote-prefixed text `apiMessages` already produced. */
export function withAttachments<T extends { role: 'user' | 'assistant'; content: string }>(
  msgs: readonly T[],
  toContent: (text: string) => string | ContentBlock[],
): { role: 'user' | 'assistant'; content: string | ContentBlock[] }[] {
  if (!msgs.length) return [];
  const out: { role: 'user' | 'assistant'; content: string | ContentBlock[] }[] = msgs.map(m => ({ role: m.role, content: m.content }));
  const last = msgs[msgs.length - 1]!;
  out[out.length - 1] = { role: last.role, content: toContent(last.content) };
  return out;
}
