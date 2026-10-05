import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Square } from 'lucide-react';
import { ModelChip, ModeChip } from '../chat/ComposerMenus';
import { AttachChip } from '../chat/AttachMenu';
import { AttachmentRow } from '../attachments/AttachmentRow';
import { addPastedFiles, imagesFromClipboard } from '../attachments/attach-actions';
import { branchAttachKey, useAttachments } from '../attachments/attachments-store';
import { useUiStore } from '../state/ui-store';

interface Props {
  branchId: string;
  streaming: boolean;
  onSend(text: string): void;
  onStop(): void;
}

/**
 * The input at the foot of a branch panel. Same rules as the main composer: Enter sends,
 * Shift+Enter adds a line, Send becomes Stop while streaming. Styled by chat.css's
 * `.composer` family, which is what a panel's composer looks like in legacy.
 */
export function BranchComposer({ branchId, streaming, onSend, onStop }: Props) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  const key = branchAttachKey(branchId);
  const files = useAttachments(s => s.files[key]) ?? [];
  const canSend = text.trim().length > 0 || files.length > 0;

  // Focus once the panel has slid in (legacy waits 280ms), an effect because focus is the DOM's.
  useEffect(() => {
    const t = setTimeout(() => ref.current?.focus(), 280);
    return () => clearTimeout(t);
  }, []);

  const send = (): void => {
    if (!canSend || streaming) return;
    onSend(text);
    setText('');
    if (ref.current) ref.current.style.height = 'auto';
  };

  return (
    <div className="branch-compose">
      <div className="composer">
        {files.length > 0 && (
          <div className="attach-row">
            <AttachmentRow files={files} onRemove={i => useAttachments.getState().remove(key, i)} onPreview={(src, name) => useUiStore.getState().setImagePreview({ src, name })} />
          </div>
        )}
        <textarea
          ref={ref} rows={1} value={text} aria-label="Ask about this passage" placeholder="Ask about this passage…"
          onChange={e => {
            setText(e.target.value);
            e.target.style.height = 'auto';
            e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
          }}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
          }}
          onPaste={e => {
            const images = imagesFromClipboard(e.clipboardData);
            if (!images.length) return;
            e.preventDefault();
            void addPastedFiles(key, images);
          }}
        />
        <div className="compose-row">
          <div className="left">
            <AttachChip attachKey={key} />
            <ModelChip branchId={branchId} className="branch-model-chip" />
            <ModeChip className="branch-mode-chip" />
          </div>
          {streaming ? (
            <button type="button" className="send-btn" title="Stop generation" aria-label="Stop" onClick={onStop}>
              <Square size={11} fill="currentColor" />
            </button>
          ) : (
            <button type="button" className="send-btn" aria-label="Send" disabled={!canSend} onClick={send}>
              <ArrowUp size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
