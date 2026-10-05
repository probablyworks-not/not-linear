import { selectedTextSegments } from './anchor';
import type { MessageRef } from './stream-html';

// Reading the user's text selection into what marking needs. Legacy only offers the popover
// for a selection inside the document or a branch's body (app.js:3011); here that is the chat
// stream (`[data-chat-stream]`) or a `.branch-body`. A reply still being written is never
// selectable for marking: it is not saved yet, so there is nothing to attach a mark to.

export interface SelectionInfo {
  text: string;
  range: Range;
  scope: 'stream' | 'branch';
  branchId?: string;
  /** The `.msg` elements the selection touches, in document order. */
  messages: HTMLElement[];
}

const elementOf = (node: Node): Element | null => (node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement);

export function messageRefOf(el: HTMLElement): MessageRef {
  return { role: el.classList.contains('ai') ? 'ai' : 'user', turnId: el.dataset.turnId || '' };
}

export function readSelection(sel: Selection | null = window.getSelection()): SelectionInfo | null {
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  const el = elementOf(range.commonAncestorContainer);
  if (!el) return null;
  const body = el.closest('.branch-body');
  const root = body ?? el.closest('[data-chat-stream]');
  if (!root) return null;
  const text = sel.toString().trim();
  if (!text) return null;

  const messages = new Set<HTMLElement>();
  for (const { node } of selectedTextSegments(range)) {
    const holder = node.parentElement;
    if (holder?.closest('[data-live]')) return null;
    const msg = holder?.closest<HTMLElement>('.msg');
    if (msg && root.contains(msg)) messages.add(msg);
  }
  if (!messages.size) return null;

  const branchEl = body ? body.closest<HTMLElement>('.branch') : null;
  return {
    text,
    range: range.cloneRange(),
    scope: branchEl ? 'branch' : 'stream',
    branchId: branchEl?.dataset.bid,
    messages: [...messages],
  };
}
