import { useRef, useState } from 'react';
import { ArrowUp, Square } from 'lucide-react';
import { ModelChip, ModeChip } from './ComposerMenus';
import { AttachChip } from './AttachMenu';
import { AttachmentRow } from '../attachments/AttachmentRow';
import { addPastedFiles, imagesFromClipboard } from '../attachments/attach-actions';
import { useAttachments } from '../attachments/attachments-store';
import { useUiStore } from '../state/ui-store';

interface ComposerProps {
  disabled?: boolean;
  /** Why it is disabled, shown in place of the placeholder. */
  disabledReason?: string;
  streaming: boolean;
  /** Names this composer's attached files in the attachments store. */
  attachKey: string;
  onSend(text: string): void;
  onStop(): void;
}

/** Enter sends, Shift+Enter adds a line. The draft is not persisted: legacy does not either. */
export function Composer({ disabled, disabledReason, streaming, attachKey, onSend, onStop }: ComposerProps) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  const files = useAttachments(s => s.files[attachKey]) ?? [];
  const canSend = !disabled && !streaming && (text.trim().length > 0 || files.length > 0);

  const send = (): void => {
    if (!canSend) return;
    onSend(text);
    setText('');
    if (ref.current) ref.current.style.height = 'auto';
  };

  return (
    <div className="pointer-events-none sticky bottom-0 z-10 flex justify-center bg-gradient-to-t from-bg from-60% to-transparent px-8 pb-3.5 pt-2.5">
      <div className="pointer-events-auto flex w-full max-w-[780px] flex-col gap-2 rounded-[14px] border border-rule-2 bg-surface px-3 py-2.5 shadow-md focus-within:border-text-3">
        {files.length > 0 && (
          <AttachmentRow
            files={files}
            onRemove={i => useAttachments.getState().remove(attachKey, i)}
            onPreview={(src, name) => useUiStore.getState().setImagePreview({ src, name })}
          />
        )}
        <textarea
          ref={ref}
          value={text}
          rows={1}
          disabled={disabled}
          aria-label="Message"
          placeholder={disabled ? disabledReason : 'Ask anything…'}
          onChange={e => {
            setText(e.target.value);
            e.target.style.height = 'auto';
            e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
          }}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
          }}
          // A pasted image is attached rather than lost.
          onPaste={e => {
            const images = imagesFromClipboard(e.clipboardData);
            if (!images.length) return;
            e.preventDefault();
            void addPastedFiles(attachKey, images);
          }}
          className="max-h-40 min-h-6 w-full resize-none bg-transparent px-1 py-1 text-sm text-text outline-none placeholder:text-text-3"
        />
        <div className="flex items-center gap-1.5">
          <div className="flex flex-1 gap-0.5">
            <AttachChip attachKey={attachKey} />
            <ModelChip branchId={null} className="model-chip" />
            <ModeChip className="mode-chip" />
          </div>
          {streaming ? (
            <button
              type="button" aria-label="Stop" title="Stop" onClick={onStop}
              className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full bg-bg-3 text-text hover:bg-rule-2"
            >
              <Square size={12} fill="currentColor" />
            </button>
          ) : (
            <button
              type="button" aria-label="Send" title="Send" disabled={!canSend} onClick={send}
              className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full bg-accent text-bg hover:bg-accent-2 disabled:cursor-not-allowed disabled:bg-bg-3 disabled:text-text-3"
            >
              <ArrowUp size={15} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
