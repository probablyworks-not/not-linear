import { useState } from 'react';
import { Check, Copy, Download, Play } from 'lucide-react';
import { detectMdFilename, saveMarkdownFile, slugifyTitle } from '../lib/save-file';

export const MAX_CONTINUES = 3;

export interface ContinueProps { count: number; onContinue(): void }

/**
 * The row under a finished reply (app.js addCopyAction, addDownloadMdAction, showContinueAction).
 * It is not part of the saved HTML (legacy strips it on save and rebuilds it on load), so it is
 * React's own. When a reply was cut off the row is just Continue, or a note once it has been
 * continued as far as it will go.
 */
export function MsgActions({ markdown, title, cont, className, style }: {
  markdown: string; title: string; cont?: ContinueProps; className?: string; style?: React.CSSProperties;
}) {
  const [copied, setCopied] = useState(false);

  if (cont) {
    return (
      <div className={`msg-actions ${className ?? ''}`} style={style} data-testid="msg-actions">
        {cont.count >= MAX_CONTINUES ? (
          <span className="msg-action-note">Max continuations reached ({MAX_CONTINUES}/{MAX_CONTINUES}) — start a new message to go further.</span>
        ) : (
          <button type="button" className="msg-action" title="Continue from where the response stopped" onClick={cont.onContinue}>
            <Play size={13} /><span>{cont.count > 0 ? `Continue (${cont.count}/${MAX_CONTINUES})` : 'Continue'}</span>
          </button>
        )}
      </div>
    );
  }
  if (!markdown.trim()) return null;

  return (
    <div className={`msg-actions ${className ?? ''}`} style={style} data-testid="msg-actions">
      <button
        type="button" className="msg-action copy-response-btn" title="Copy response to clipboard"
        onClick={() => { void navigator.clipboard?.writeText(markdown).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {}); }}
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}<span>{copied ? 'Copied!' : 'Copy'}</span>
      </button>
      <button
        type="button" className="msg-action download-md-btn" title="Download response as a Markdown file"
        onClick={() => { void saveMarkdownFile(detectMdFilename(markdown) || slugifyTitle(title || 'response') + '.md', markdown); }}
      >
        <Download size={13} /><span>Download .md</span>
      </button>
    </div>
  );
}
