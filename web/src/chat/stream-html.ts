import { esc, markdownTextFromRendered, renderMarkdown } from '../lib/markdown';
import { responseMetaHTML, type ResponseMeta } from './response-meta';
import { cleanThreadTitle } from '../db/thread-ops';
import type { ChatMessage } from '../providers/types';

// ADR-038: the legacy app persists a thread as rendered HTML in `stream`, so
// React writes that HTML too. These functions emit the exact markup legacy's
// runMainTurn builds (app.js:2075-2090, makeAiMessageEl, streamHTMLForSave) and
// read back what either app wrote. Nothing here touches the live page.
//
// Legacy-written turns are never regenerated. A thread's stream is edited by
// upserting ONE turn into whatever HTML is already there (as legacy's own
// mergeTurnIntoSavedStream does), so attachments, branch anchors and anything
// else this code does not understand ride through byte for byte.

export function makeTurnId(): string {
  return 'turn-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
}

/**
 * The user's bubble. `bubbleInnerHTML` replaces the default text-plus-attachments body for the
 * one case legacy does the same (the popover's Ask, whose bubble reads `About: "…"` while the
 * model is sent a fuller prompt).
 */
export function userTurnHTML(turnId: string, text: string, bubbleInnerHTML?: string): string {
  const inner = bubbleInnerHTML ?? `<div style="margin-bottom:0">${esc(text)}</div><div style="display:flex;flex-wrap:wrap;gap:4px"></div>`;
  return `<div class="msg user" data-turn-id="${turnId}"><div class="bub">${inner}</div></div>`;
}

export interface AiTurnContent {
  text: string;
  thinking: string;
  /** Shown above the answer when the reply was cut short (legacy's showPartialStop). */
  stopNote?: string;
  /** The whole bubble when nothing streamed (legacy's showError). */
  error?: string;
  /** The collapsible model/tokens/cost line, written once the reply has finished. */
  meta?: ResponseMeta;
  /** Project-folder files the answer drew on, shown as chips under it. */
  sources?: { names: string[]; label: string; icon: 'brain' | 'files' };
}

export function aiContentHTML(c: AiTurnContent): string {
  if (c.error && !c.text.trim()) {
    return `<div class="err-block"><span class="err-msg"><i class="ti ti-alert-circle"></i>${esc(c.error)}</span></div>`;
  }
  return c.text ? renderMarkdown(c.text) : '';
}

/** app.js:2100 addSourcesBar's markup. */
function sourcesBarHTML(s: NonNullable<AiTurnContent['sources']>): string {
  return `<div class="msg-sources"><i class="ti ${s.icon === 'brain' ? 'ti-brain' : 'ti-files'}"></i><span class="msg-sources-label">${esc(s.label)}</span>${s.names.map(n => `<span class="msg-source-chip">${esc(n)}</span>`).join('')}</div>`;
}

export function aiTurnHTML(turnId: string, c: AiTurnContent): string {
  const status = c.stopNote ? `<span class="err-msg"><i class="ti ti-alert-circle"></i>${esc(c.stopNote)}</span>` : '';
  const thinking = c.thinking
    ? `<div class="ai-thinking active"><button class="thinking-toggle"><span class="thinking-live-spinner" style="display: none;"></span><span class="thinking-label">View reasoning</span><i class="ti ti-chevron-down"></i></button><div class="thinking-body">${esc(c.thinking)}</div></div>`
    : '<div class="ai-thinking"><button class="thinking-toggle"><span class="thinking-live-spinner"></span><span class="thinking-label">Reasoning…</span><i class="ti ti-chevron-down"></i></button><div class="thinking-body"></div></div>';
  return `<div class="msg ai" data-turn-id="${turnId}"><div class="ai-status">${status}</div>${thinking}<div class="ai-content">${aiContentHTML(c)}</div>${c.sources?.names.length ? sourcesBarHTML(c.sources) : ''}${c.meta ? responseMetaHTML(c.meta) : ''}</div>`;
}

function parse(html: string): HTMLTemplateElement {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  return tpl;
}

function replaceOrAppend(root: DocumentFragment, role: 'user' | 'ai', turnId: string, html: string | null): void {
  const existing = [...root.querySelectorAll(`.msg.${role}`)].find(el => (el as HTMLElement).dataset.turnId === turnId);
  if (html === null) { existing?.remove(); return; }
  const fresh = parse(html).content.firstElementChild!;
  if (existing) existing.replaceWith(fresh);
  else root.appendChild(fresh);
}

/**
 * Puts one turn into `streamHTML`: replaces its user and assistant elements if
 * they are there, appends them if not, and removes the assistant element when
 * `ai` is null (a stopped reply with nothing in it). Empty-state placeholder is
 * dropped, as streamHTMLForSave does.
 */
export function upsertTurn(streamHTML: string, turnId: string, user: string, ai: string | null): string {
  const tpl = parse(streamHTML);
  tpl.content.querySelectorAll('.empty-chat-state, .msg-actions').forEach(el => el.remove());
  replaceOrAppend(tpl.content, 'user', turnId, user);
  replaceOrAppend(tpl.content, 'ai', turnId, ai);
  return tpl.innerHTML;
}

export interface StoredTurn {
  /** `data-turn-id`, or a synthetic one for a turn legacy wrote before turn ids existed. */
  id: string;
  role: 'user' | 'ai';
  /** The element's inner HTML, ready for dangerouslySetInnerHTML. */
  html: string;
}

export function parseStream(streamHTML: string): StoredTurn[] {
  const out: StoredTurn[] = [];
  parse(streamHTML).content.querySelectorAll('.msg').forEach((el, i) => {
    const role = el.classList.contains('user') ? 'user' : el.classList.contains('ai') ? 'ai' : null;
    if (!role) return;
    el.querySelectorAll('.msg-actions').forEach(a => a.remove());
    out.push({ id: (el as HTMLElement).dataset.turnId || `legacy-${i}`, role, html: el.innerHTML });
  });
  return out;
}

function normalizeTitleText(text: string): string {
  return cleanThreadTitle(text, '');
}

/**
 * app.js:887 renderedStreamMessages: the model history, recovered from the page.
 * One departure: an assistant element holding only an error block is skipped. Legacy
 * reads its text back as if the model had said it, which sends "Claude is overloaded"
 * to the model as its own previous answer.
 */
export function messagesFromStream(streamHTML: string): ChatMessage[] {
  const msgs: ChatMessage[] = [];
  parse(streamHTML).content.querySelectorAll('.msg').forEach(el => {
    if (el.classList.contains('user')) {
      msgs.push({ role: 'user', content: normalizeTitleText(el.querySelector('.bub')?.textContent || '') });
    } else if (el.classList.contains('ai')) {
      const content = el.querySelector('.ai-content');
      if (content?.querySelector('.err-block') && !content.querySelector('p')) return;
      const text = normalizeTitleText(markdownTextFromRendered(content || el));
      if (text) msgs.push({ role: 'assistant', content: text });
    }
  });
  return msgs;
}

/** The question asked in `turnId`, and the conversation before it; what a retry re-sends. */
export function turnContext(streamHTML: string, turnId: string): { userText: string; history: ChatMessage[] } | null {
  const tpl = parse(streamHTML);
  const user = [...tpl.content.querySelectorAll('.msg.user')].find(el => (el as HTMLElement).dataset.turnId === turnId);
  if (!user) return null;
  const userText = normalizeTitleText(user.querySelector('.bub')?.textContent || '');
  const before = document.createElement('div');
  for (const el of [...tpl.content.children]) {
    if (el === user) break;
    before.appendChild(el.cloneNode(true));
  }
  return { userText, history: messagesFromStream(before.innerHTML) };
}

export interface MessageRef {
  role: 'user' | 'ai';
  /** `data-turn-id`, or `legacy-<n>` for a message saved without one. */
  turnId: string;
}

/**
 * Replaces the CONTENT of one message element in saved HTML (the element itself, with
 * whatever attributes it was saved with, stays). The message is found by turn id or, for a
 * `legacy-<n>` id, by its position among the `.msg` elements, which must still be the same
 * role. Used when a mark has just been wrapped inside a message that is already saved.
 * Returns null when the message is not there any more, so a caller can say so rather than
 * write over something else.
 */
export function replaceMessage(streamHTML: string, ref: MessageRef, innerHTML: string): string | null {
  const tpl = parse(streamHTML);
  const all = [...tpl.content.querySelectorAll('.msg')];
  const legacy = /^legacy-(\d+)$/.exec(ref.turnId);
  const target = legacy
    ? all[Number(legacy[1])]
    : all.find(el => el.classList.contains(ref.role) && (el as HTMLElement).dataset.turnId === ref.turnId);
  if (!target || !target.classList.contains(ref.role)) return null;
  target.innerHTML = innerHTML;
  return tpl.innerHTML;
}
