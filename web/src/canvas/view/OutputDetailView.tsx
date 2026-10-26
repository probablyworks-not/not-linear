import { useMemo } from 'react';
import { X } from 'lucide-react';
import { ESC_PRIORITY, useEscLayer } from '../../lib/keyboard';
import type { CanvasDoc } from '../types';
import { highlightsByMessage } from '../anchors';
import { PartView } from './PartView';

// UI-09. Before this, a reply saved straight to Artifacts and was read there — there was no way to
// read the full, unclipped text of a reply without leaving the canvas. This is not a second
// representation of it (UI-06): it reads the same message out of the same document and renders it
// through the same `PartView` the card and Reading view already use, just without the card's
// scroll clipping.

export function OutputDetailView({ doc, messageId, onClose, onSaveOutput }: {
  doc: CanvasDoc;
  messageId: string;
  onClose(): void;
  onSaveOutput(messageId: string): void;
}) {
  useEscLayer('canvasOutputDetail', ESC_PRIORITY.canvasOutputDetail, true, onClose);
  // Same per-message/per-part marks the canvas cards show — this is the same `PartView` content
  // as the card and Reading View, just unclipped, so a branched-from quote should read the same.
  const highlights = useMemo(() => highlightsByMessage(doc), [doc]);

  const message = doc.messages.find(m => m.id === messageId);
  if (!message) return null;
  const thread = doc.threads.find(t => t.id === message.threadId);

  return (
    <div
      role="dialog" aria-label="Full reply" data-testid="canvas-output-detail"
      className="fixed inset-0 z-[150] flex items-center justify-center bg-scrim p-6"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-[min(720px,92vw)] flex-col overflow-hidden rounded-xl border border-cv-edge bg-cv-card shadow-lg"
        onClick={e => e.stopPropagation()}
      >
        <header className="flex flex-none items-center gap-2 border-b border-cv-divider px-4 py-3">
          <h2 className="m-0 min-w-0 flex-1 truncate text-sm font-medium text-text">{thread?.title ?? 'Reply'}</h2>
          <button
            type="button" onClick={() => onSaveOutput(messageId)} data-testid="output-detail-save"
            className="flex-none rounded-md border border-rule-2 px-2 py-1 text-xs text-text-2 hover:text-text"
          >
            Save to Artifacts
          </button>
          <button
            type="button" onClick={onClose} aria-label="Close" data-testid="output-detail-close"
            className="flex-none rounded-md p-1 text-text-3 hover:text-text"
          >
            <X size={15} aria-hidden />
          </button>
        </header>
        <div className="min-h-0 flex-1 select-text overflow-auto px-4 py-3.5 [-webkit-user-select:text]">
          {message.parts.map(p => <PartView key={p.id} part={p} messageId={message.id} highlightsByPart={highlights[message.id]} />)}
        </div>
      </div>
    </div>
  );
}
