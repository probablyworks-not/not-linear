import { memo, useSyncExternalStore } from 'react';
import { HtmlFrame } from './PartView';
import { liveText } from './live-text';
import { renderMarkdown } from '../../lib/markdown';

export const LiveReply = memo(function LiveText({ messageId }: { messageId: string }) {
  const text = useSyncExternalStore(liveText.subscribeTo(messageId), liveText.getOf(messageId));
  const html = useSyncExternalStore(liveText.subscribeTo(messageId), liveText.getHtmlOf(messageId));
  if (html !== undefined) return <div data-testid="live-html">
    <HtmlFrame part={{ id: `${messageId}-stream`, kind: 'html', state: 'ready', html: '<!doctype html><html><head></head><body></body></html>' }} messageId={messageId} paginated streamHtml={html} />
    <div className="nl-html-pending mt-6" role="status" aria-busy="true"><span>Building your next section…</span></div>
  </div>;
  if (text === undefined) return null;
  // Same renderer as the finished part (PartView/Markdownish), so a reply reads the same mid-stream
  // as it does once PartView takes over — only highlight.js/mermaid wait for the DOM to settle.
  return <div data-testid="live-text" className="nl-md" dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />;
});
