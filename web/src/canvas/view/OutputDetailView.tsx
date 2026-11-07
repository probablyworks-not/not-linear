import { useEffect, useMemo, useRef } from 'react';
import { ArrowLeft, Download } from 'lucide-react';
import { ESC_PRIORITY, useEscLayer } from '../../lib/keyboard';
import type { CanvasDoc } from '../types';
import { highlightsByMessage } from '../anchors';
import { PartView, type BlockPickHandler } from './PartView';

/** A reading projection of the stored reply, never a second saved representation. */
export function OutputDetailView({ doc, messageId, onClose, onSaveOutput, onBlockPick }: {
  doc: CanvasDoc;
  messageId: string;
  onClose(): void;
  onSaveOutput(messageId: string): void;
  onBlockPick?: BlockPickHandler;
}) {
  useEscLayer('canvasOutputDetail', ESC_PRIORITY.canvasOutputDetail, true, onClose);
  const highlights = useMemo(() => highlightsByMessage(doc), [doc]);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    closeRef.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  const message = doc.messages.find(m => m.id === messageId);
  if (!message) return null;
  const thread = doc.threads.find(t => t.id === message.threadId);
  const htmlOnly = message.parts.length === 1 && message.parts[0]?.kind === 'html';
  return (
    <div role="dialog" aria-label="Full reply" aria-modal="true" data-testid="canvas-output-detail"
      className="fixed inset-0 z-[150] flex min-h-0 flex-col bg-cv-card">
      <header className="flex min-h-[56px] flex-none items-center gap-3 border-b border-cv-divider px-4 py-3">
        <button ref={closeRef} type="button" onClick={onClose} aria-label="Back to canvas" data-testid="output-detail-close"
          className="flex flex-none items-center gap-1.5 rounded-md border border-rule-2 px-2.5 py-1.5 text-xs text-text-2 hover:bg-bg-3">
          <ArrowLeft size={14} aria-hidden /> Back to canvas
        </button>
        <div data-testid="canvas-annotation-controls" className="flex-none" />
        <h2 className="m-0 min-w-0 flex-1 truncate text-sm font-medium text-text">{thread?.title ?? 'Reply'}</h2>
        <button type="button" onClick={() => onSaveOutput(messageId)} data-testid="output-detail-save"
          className="flex flex-none items-center gap-1.5 rounded-md border border-rule-2 px-2.5 py-1.5 text-xs text-text-2 hover:bg-bg-3">
          <Download size={13} aria-hidden /> Save to Artifacts
        </button>
      </header>
      <div data-message={message.id} className={htmlOnly ? 'min-h-0 flex-1' : 'min-h-0 flex-1 overflow-auto'}>
        {message.parts.map(p => (
          <div key={p.id} className={htmlOnly ? 'h-full min-h-0' : 'mx-auto w-full max-w-[880px] px-7 py-6 select-text [-webkit-user-select:text]'}>
            <PartView part={p} messageId={message.id} highlightsByPart={highlights[message.id]} fullPage={htmlOnly} onBlockPick={onBlockPick} />
          </div>
        ))}
      </div>
    </div>
  );
}
