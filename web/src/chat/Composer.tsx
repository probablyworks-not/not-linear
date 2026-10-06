import { useRef, useState } from 'react';
import { clsx } from 'clsx';
import { ArrowUp, Square } from 'lucide-react';
import { useSkillPicker } from '../skills/SkillPicker';
import { SkillsUsedLine } from '../skills/SkillsUsedLine';
import { ModelChip, ModeChip } from './ComposerMenus';
import { AttachChip } from './AttachMenu';
import { AttachmentRow } from '../attachments/AttachmentRow';
import { addPastedFiles, imagesFromClipboard } from '../attachments/attach-actions';
import { useAttachments } from '../attachments/attachments-store';
import { useUiStore } from '../state/ui-store';
import { useEdgeReveal } from '../lib/edge-reveal';

interface ComposerProps {
  disabled?: boolean;
  /** Keep the composer showing even when idle (an empty chat has nowhere else to type). */
  alwaysShow?: boolean;
  /** Why it is disabled, shown in place of the placeholder. */
  disabledReason?: string;
  streaming: boolean;
  /** Names this composer's attached files in the attachments store. */
  attachKey: string;
  /** Key of this composer's turns in the chat store (thread id), for the "skills used" line. */
  skillsKey: string;
  onSend(text: string, skills?: string[]): void;
  onStop(): void;
}

/** Enter sends, Shift+Enter adds a line. The draft is not persisted: legacy does not either. */
export function Composer({ disabled, alwaysShow, disabledReason, streaming, attachKey, skillsKey, onSend, onStop }: ComposerProps) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  const files = useAttachments(s => s.files[attachKey]) ?? [];
  const skills = useSkillPicker(text, setText, ref, 'Ask anything…');
  const barRef = useRef<HTMLDivElement>(null);
  const bar = useEdgeReveal(barRef, 'bottom', !!alwaysShow || text.length > 0 || files.length > 0);
  const canSend = !disabled && !streaming && (text.trim().length > 0 || files.length > 0);

  const send = (): void => {
    if (!canSend) return;
    onSend(text, skills.picked.length ? skills.picked : undefined);
    setText('');
    skills.reset();
    if (ref.current) ref.current.style.height = 'auto';
  };

  return (
    // A zero-height sticky anchor: the composer floats over the page instead of taking room from it.
    <div className="pointer-events-none sticky bottom-0 z-10 h-0">
      <div
        ref={barRef} data-shown={bar.visible} {...bar.focusProps}
        className={clsx(
          'absolute inset-x-0 bottom-0 flex justify-center bg-gradient-to-t from-bg from-60% to-transparent px-8 pb-3.5 pt-6 transition-[transform,opacity] duration-150 ease-out',
          !bar.visible && 'translate-y-full opacity-0',
        )}
      >
      <div className="pointer-events-auto relative flex w-full max-w-[780px] flex-col gap-2 rounded-[14px] border border-rule-2 bg-surface px-3 py-2.5 shadow-md focus-within:border-text-3">
        {files.length > 0 && (
          <AttachmentRow
            files={files}
            onRemove={i => useAttachments.getState().remove(attachKey, i)}
            onPreview={(src, name) => useUiStore.getState().setImagePreview({ src, name })}
          />
        )}
        <SkillsUsedLine skillsKey={skillsKey} />
        {skills.chips}
        {skills.menu}
        <textarea
          ref={ref}
          value={text}
          rows={1}
          disabled={disabled}
          aria-label="Message"
          placeholder={disabled ? disabledReason : skills.placeholder}
          onChange={e => {
            setText(e.target.value);
            skills.onTextChange();
            e.target.style.height = 'auto';
            e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
          }}
          onKeyDown={e => {
            if (skills.onKeyDown(e, text)) return;
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
    </div>
  );
}
