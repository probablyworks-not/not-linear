import { useEffect, useRef, useState } from 'react';
import { clsx } from 'clsx';
import { ArrowUp, Mic, Square } from 'lucide-react';
import { ModelChip, ModeChip } from '../chat/ComposerMenus';
import { AttachChip } from '../chat/AttachMenu';
import { AttachmentRow } from '../attachments/AttachmentRow';
import { addPastedFiles, imagesFromClipboard } from '../attachments/attach-actions';
import { branchAttachKey, useAttachments } from '../attachments/attachments-store';
import { useUiStore } from '../state/ui-store';
import { useSkillPicker } from '../skills/SkillPicker';
import { SkillsUsedLine } from '../skills/SkillsUsedLine';
import { useVoiceInput } from '../lib/voice';
import { toast } from '../ui/toast';

interface Props {
  branchId: string;
  /** Key of this branch's turns in the chat store, for the "skills used" line. */
  skillsKey: string;
  streaming: boolean;
  /** Overrides the default "Ask about this passage…" base placeholder (e.g. a quote-less branch). */
  placeholder?: string;
  onSend(text: string, skills?: string[]): void;
  onStop(): void;
}

/**
 * The input at the foot of a branch panel. Same rules as the main composer: Enter sends,
 * Shift+Enter adds a line, Send becomes Stop while streaming. Styled by chat.css's
 * `.composer` family, which is what a panel's composer looks like in legacy.
 */
export function BranchComposer({ branchId, skillsKey, streaming, placeholder, onSend, onStop }: Props) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  const key = branchAttachKey(branchId);
  const files = useAttachments(s => s.files[key]) ?? [];
  const skills = useSkillPicker(text, setText, ref, placeholder ?? 'Ask about this passage…');
  const canSend = text.trim().length > 0 || files.length > 0;

  const voiceBaseRef = useRef('');
  const voice = useVoiceInput({
    onPartial: (t) => setText(voiceBaseRef.current + t),
    onFinal: (t) => { voiceBaseRef.current = voiceBaseRef.current + t + ' '; setText(voiceBaseRef.current); },
    onError: (message) => toast(message),
  });
  const toggleVoice = (): void => {
    if (!voice.recording) voiceBaseRef.current = text ? text.replace(/\s*$/, ' ') : '';
    voice.toggle();
  };

  // Voice input sets `text` directly (no native input event), which the resize logic in the
  // textarea's onChange never sees — so the box stayed a fixed height while dictated text kept
  // growing. Driving the resize off `text` itself covers both typed and dictated input.
  useEffect(() => {
    if (!ref.current) return;
    ref.current.style.height = 'auto';
    ref.current.style.height = `${Math.min(ref.current.scrollHeight, 120)}px`;
  }, [text]);

  // Focus once the panel has slid in (legacy waits 280ms), an effect because focus is the DOM's.
  useEffect(() => {
    const t = setTimeout(() => ref.current?.focus(), 280);
    return () => clearTimeout(t);
  }, []);

  const send = (): void => {
    if (!canSend || streaming) return;
    onSend(text, skills.picked.length ? skills.picked : undefined);
    setText('');
    skills.reset();
    if (ref.current) ref.current.style.height = 'auto';
  };

  return (
    <div className="branch-compose">
      <div className="composer" style={{ position: 'relative' }}>
        {files.length > 0 && (
          <div className="attach-row">
            <AttachmentRow files={files} onRemove={i => useAttachments.getState().remove(key, i)} onPreview={(src, name) => useUiStore.getState().setImagePreview({ src, name })} />
          </div>
        )}
        <SkillsUsedLine skillsKey={skillsKey} />
        {skills.chips}
        {skills.menu}
        <textarea
          ref={ref} rows={1} value={text} aria-label="Ask about this passage" placeholder={skills.placeholder}
          onChange={e => {
            setText(e.target.value);
            skills.onTextChange();
          }}
          onKeyDown={e => {
            if (skills.onKeyDown(e, text)) return;
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
          <button
            type="button" className={clsx('chip', 'mic-chip', voice.recording && 'recording')}
            aria-label={voice.recording ? 'Stop voice input' : 'Voice input'} title="Voice input" onClick={toggleVoice}
          >
            <Mic size={13} />
          </button>
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
