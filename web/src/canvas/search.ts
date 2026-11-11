// Canvas results for the search palette (UI-08). Pure logic, kept separate from the chat
// palette's `SearchItem` (web/src/search/palette.ts) because a canvas result points at a thread
// *or* a specific reply within it, not a chat thread id — but it reuses that module's generic
// filter/move/highlight helpers, which only care about `title`/`sub`.

import type { CanvasDoc, CanvasMessage, ThreadKind } from './types';

export interface CanvasSearchItem {
  kind: 'thread' | 'message';
  threadId: string;
  /** Set only for kind 'message': the specific reply this result opens in the output-detail view. */
  messageId?: string;
  title: string;
  sub?: string;
  /** C8. The owning thread's kind, so the palette can offer a Threads/Branches/Replies filter
   * without a second query over the doc. */
  threadKind: ThreadKind;
}

const PREVIEW_LEN = 140;

function previewOf(m: CanvasMessage): string | undefined {
  for (const p of m.parts) {
    const text = p.kind === 'text' || p.kind === 'report' ? p.text
      : p.kind === 'code' ? p.text
      : p.kind === 'tool_result' ? p.markdown
      : undefined;
    if (text) return text.length > PREVIEW_LEN ? `${text.slice(0, PREVIEW_LEN - 1).trimEnd()}…` : text;
  }
  return undefined;
}

/**
 * One item per thread (so you can jump straight to it) plus one item per finished model reply
 * (so you can jump straight into that reply's full text via the output-detail view). A provisional
 * (still-streaming) reply has nothing settled to preview, so it is left out.
 */
export function canvasSearchItems(doc: CanvasDoc): CanvasSearchItem[] {
  const threadItems: CanvasSearchItem[] = doc.threads.map(t => ({ kind: 'thread', threadId: t.id, title: t.title, threadKind: t.kind }));
  const messageItems: CanvasSearchItem[] = doc.messages
    .filter(m => m.author.kind === 'model' && !m.provisional)
    .map(m => {
      const thread = doc.threads.find(t => t.id === m.threadId);
      return {
        kind: 'message',
        threadId: m.threadId,
        messageId: m.id,
        title: thread?.title ?? 'Reply',
        sub: previewOf(m),
        threadKind: thread?.kind ?? 'root',
      };
    });
  return [...threadItems, ...messageItems];
}
