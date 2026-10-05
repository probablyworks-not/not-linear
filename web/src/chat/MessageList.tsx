import { Fragment } from 'react';
import { MsgActions } from './MsgActions';
import { markdownTextFromRendered } from '../lib/markdown';
import type { StoredTurn } from './stream-html';

/** app.js:893 looksIncompleteResponse: a reply that stops mid-sentence, as one cut off by a limit does. */
export function looksIncompleteResponse(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim();
  return !!t && /(?:[=(:,;+\-–—]|\b(?:and|or|but|because|with|for|to|of|in|as|is|are|means|include|including))$/i.test(t);
}

/** An assistant element that holds only an error block has no reply to copy, and no assistant message. */
const isErrorOnly = (html: string): boolean => /class="err-block"/.test(html) && !/<p[ >]/.test(html);

export interface ContinueOffer { turnId: string; count: number }

/**
 * The saved turns of a conversation (the main stream or a branch panel's body), each message
 * as saved, with the Copy/Download row under every reply. A reply's markdown is the
 * assistant message the model produced, matched to its element in order (legacy matches by index);
 * an error-only element has none, so it is skipped when counting.
 */
export function MessageList({ turns, assistantMarkdown, title, offer, busy, onContinue, actionGap }: {
  turns: readonly StoredTurn[];
  /** The conversation's assistant messages, oldest first. */
  assistantMarkdown: readonly string[];
  title: string;
  /** Set when the last reply was cut short in this session. */
  offer?: ContinueOffer;
  /** A reply is being written: no Continue. */
  busy: boolean;
  onContinue(count: number): void;
  /** How far to pull the row up into the flex gap so it sits just under its reply. */
  actionGap: number;
}) {
  const replies = turns.filter(t => t.role === 'ai' && !isErrorOnly(t.html));
  const lastReply = replies[replies.length - 1];
  const mdOf = new Map<string, string>();
  replies.forEach((t, i) => {
    if (assistantMarkdown[i] !== undefined) { mdOf.set(t.id, assistantMarkdown[i]!); return; }
    const holder = document.createElement('div');
    holder.innerHTML = t.html;
    mdOf.set(t.id, markdownTextFromRendered(holder.querySelector('.ai-content') ?? holder));
  });

  return (
    <>
      {turns.map(t => {
        const md = t.role === 'ai' ? mdOf.get(t.id) : undefined;
        const isLast = lastReply?.id === t.id && t.role === 'ai';
        const showContinue = !busy && isLast && md !== undefined && (offer?.turnId === t.id || (!offer && looksIncompleteResponse(md)));
        return (
          <Fragment key={`${t.id}-${t.role}`}>
            <div className={`msg ${t.role}`} data-turn-id={t.id} dangerouslySetInnerHTML={{ __html: t.html }} />
            {md !== undefined && (
              <MsgActions
                markdown={md} title={title} style={{ marginTop: -actionGap }}
                cont={showContinue ? { count: offer?.count ?? 0, onContinue: () => onContinue(offer?.count ?? 0) } : undefined}
              />
            )}
          </Fragment>
        );
      })}
    </>
  );
}
