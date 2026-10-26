import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { ArrowUp, Mic, Paperclip, X } from 'lucide-react';
import { clsx } from 'clsx';
import { clearDraft, getDrafts, putDraft } from '../canvas-repo';
import { createDebouncedWriter } from '../../lib/debounced-writer';
import { addFilesTo, addPastedFiles, imagesFromClipboard } from '../../attachments/attach-actions';
import { useAttachments } from '../../attachments/attachments-store';
import { AttachmentRow } from '../../attachments/AttachmentRow';
import { useUiStore } from '../../state/ui-store';
import { useVoiceInput } from '../../lib/voice';
import { toast } from '../../ui/toast';
import { useSkillPicker } from '../../skills/SkillPicker';
import { SkillsUsedLine } from '../../skills/SkillsUsedLine';
import { ModelChip, ModeChip } from '../../chat/ComposerMenus';
import type { Attachment } from '../../attachments/read-files';
import type { Draft, HighlightTone, SourceSnapshot } from '../types';

/** The chip buttons (model/mode) read the always-dark `--ask-*` tokens, not the app's regular
 * light/dark theme tokens their shared `.chip` class uses — same override the mic/attach buttons
 * below already need. */
const ASK_CHIP = 'chip !text-ask-hint hover:!bg-ask-chip hover:!text-ask-fg';

/** C6. Same six tones as the in-card source citation (ThreadNode.tsx), so a chip here and the
 * excerpt it points at read as the same source. */
const TONE_BG: Record<HighlightTone, string> = {
  blue: 'bg-cv-hl-blue', pink: 'bg-cv-hl-pink', brown: 'bg-cv-hl-brown',
  green: 'bg-cv-hl-green', yellow: 'bg-cv-hl-yellow', orange: 'bg-cv-hl-orange',
};

// The Ink composer. Screen-space: it sits outside the pan/zoom transform so it never scales with
// the world, and it is clamped into the viewport so Send is always reachable (AC-08).
//
// Its draft is persisted per canvas AND per target. That is the whole of FR-05/AC09: switching
// canvases, or switching between asking a new question and replying to a thread, must never carry
// text, sources or model choice across. The chat composer keeps its draft in component state; this
// one cannot.

const draftWriter = createDebouncedWriter<string>(250);

export interface ComposerTarget {
  /** `new` | `thread:<id>` | `synthesis` */
  key: string;
  label: string;
  /** Screen-space anchor, when the composer is scoped to a card. */
  anchor?: { x: number; y: number };
}

interface Props {
  canvasId: string;
  target: ComposerTarget;
  sources: SourceSnapshot[];
  onRemoveSource(id: string): void;
  onSend(text: string, skills?: string[]): void | Promise<void>;
  busy?: boolean;
  onStop?(): void;
  /** C9. Names this target's attachments in the shared `useAttachments` store — the same store
   * and primitives (`pickFiles`/`readFiles`/`AttachmentRow`) the chat composer uses. */
  attachKey: string;
  files: Attachment[];
  /** Key into the chat store's `skillsUsed` map, for the "last reply used" line. */
  skillsKey: string;
}

const W = 340, H = 92, PAD = 12;

export function InkComposer({ canvasId, target, sources, onRemoveSource, onSend, busy, onStop, attachKey, files, skillsKey }: Props) {
  const [text, setText] = useState('');
  const [loaded, setLoaded] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const skills = useSkillPicker(text, setText, ref, sources.length ? 'Ask about the selected source…' : 'Ask anything…');

  // The idle, collapsed "Ask" launcher only stands in for the default, un-anchored "new question"
  // composer — one that's scoped to a selected source or a reply thread is already an answer to
  // "what are you doing", so it opens straight into the full bar. Once expanded this mount stays
  // expanded: there is no auto-collapse-on-blur, which would race every click on its own buttons
  // (attach, mic, send) that also move focus off the textarea.
  const isIdleAsk = target.key === 'new' && !target.anchor && sources.length === 0 && files.length === 0;
  const [focused, setFocused] = useState(false);
  const wantsFocusRef = useRef(false);
  const expanded = !isIdleAsk || focused || text.trim().length > 0;
  const openLauncher = (): void => { wantsFocusRef.current = true; setFocused(true); };
  useEffect(() => {
    if (expanded && wantsFocusRef.current) { ref.current?.focus(); wantsFocusRef.current = false; }
  }, [expanded]);

  // Hovering the collapsed launcher previews the mic/attach affordances inline (no state change,
  // just a wider pill) — it reverts the instant the pointer leaves, since nothing has committed yet.
  // Typing while that preview is showing commits straight through to the full composer, carrying
  // the keystroke, so "hover, then just start typing" never needs an intermediate click.
  //
  // flushSync forces the text/focused state to commit synchronously, so ref.current is the real,
  // correctly-valued textarea before this call stack returns (not racy, but needed — without it the
  // next keydown can land before React has mounted the textarea at all). Separately, `.focus()` on
  // a textarea whose value was just set programmatically (not by typing) places the caret at
  // position 0, not at the end of that value — every following native keystroke then inserts
  // *before* this handler's character instead of after it (bug found 2026-10-26: hovering then
  // typing "testing123" produced "esting123t", the leading `t` dragged to the very end as each
  // subsequent letter inserted ahead of it). `setSelectionRange` after focusing fixes the caret.
  const [hovered, setHovered] = useState(false);
  const preview = isIdleAsk && !expanded && hovered;
  useEffect(() => {
    if (!preview) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.key.length !== 1) return;
      e.preventDefault();
      flushSync(() => {
        setFocused(true);
        setText(t => t + e.key);
      });
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [preview]);

  // C9. Same pattern as the chat composer (Composer.tsx): dictated text replaces what came before
  // it in this utterance, typed text is untouched.
  const voiceBaseRef = useRef('');
  const voice = useVoiceInput({
    onPartial: t => setText(voiceBaseRef.current + t),
    onFinal: t => { voiceBaseRef.current = voiceBaseRef.current + t + ' '; setText(voiceBaseRef.current); },
    onError: message => toast(message),
  });
  const toggleVoice = (): void => {
    if (!voice.recording) voiceBaseRef.current = text ? text.replace(/\s*$/, ' ') : '';
    voice.toggle();
  };

  // Restore this target's draft. Reading persisted state is an external system. The composer is
  // keyed by target upstream, so a target switch is a fresh mount and there is nothing to reset
  // here — resetting would be the cascading render the lint rule is about.
  //
  // This load is async against IndexedDB, and the hover-then-type path above can land a keystroke
  // into `text` before it resolves (bug found 2026-10-26) — only apply the stored draft if nothing
  // has been typed into this fresh mount yet, so a live keystroke always wins over a stale restore.
  useEffect(() => {
    let live = true;
    void getDrafts(canvasId).then(all => {
      if (!live) return;
      setText(current => current === '' ? (all[target.key]?.text ?? '') : current);
      setLoaded(true);
    });
    return () => { live = false; };
  }, [canvasId, target.key]);

  // Persist on a debounce, keyed by canvas+target so two targets never cancel each other.
  useEffect(() => {
    if (!loaded) return;
    const draft: Draft = {
      target: target.key, text, snapshotIds: sources.map(s => s.id),
      attachmentAssetIds: [], updatedAt: Date.now(),
    };
    const key = `${canvasId}:${target.key}`;
    if (!text.trim() && sources.length === 0) draftWriter.schedule(key, () => clearDraft(canvasId, target.key));
    else draftWriter.schedule(key, () => putDraft(canvasId, draft));
  }, [canvasId, target.key, text, sources, loaded]);

  // Leaving the composer — switching target, closing the canvas — must not lose what was typed.
  // The debounce is an optimisation, not the contract, so flush it on the way out. A page unload
  // is a separate matter: React cleanup does not run reliably then, which is exactly why the
  // debounce is short rather than why this is the only path.
  useEffect(() => () => { void draftWriter.flushAll(); }, []);

  // Auto-grow: the textarea's own scrollHeight is DOM state React doesn't track, so syncing it
  // on every text change is an external-system sync, not derived state.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  const canSend = !busy && (text.trim().length > 0 || files.length > 0);
  const send = (): void => {
    if (!canSend) return;
    const value = text;
    setText('');
    void clearDraft(canvasId, target.key);
    void onSend(value, skills.picked.length ? skills.picked : undefined);
    skills.reset();
    // A sent question is answered on the canvas itself — the idle "Ask" launcher collapses back
    // rather than sitting open, same as it never auto-expanded until you typed into it.
    if (isIdleAsk) { setFocused(false); ref.current?.blur(); }
  };

  const style = target.anchor
    ? {
        left: Math.max(PAD, Math.min(target.anchor.x, window.innerWidth - W - PAD)),
        top: Math.max(PAD, Math.min(target.anchor.y + PAD, window.innerHeight - H - PAD)),
      }
    : { left: '50%', bottom: 22, transform: 'translateX(-50%)' };

  if (!expanded) {
    return (
      <button
        type="button" data-testid="ink-launcher" onClick={openLauncher}
        onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
        aria-label="Ask" title="Ask — or just start typing"
        className="fixed z-[60] flex h-[52px] items-center gap-0 overflow-hidden rounded-[18px] bg-ask px-[9px] text-ask-fg shadow-lg"
        style={style}
      >
        <span aria-hidden className="grid h-[34px] w-[34px] flex-none place-items-center">
          <svg width="22" height="22" viewBox="11 8.25 18 18" fill="none" stroke="currentColor" strokeWidth={1.5}>
            <path className="nl-ask-draw" pathLength={1} d="M21.75 14.6252L13.7442 21.7451" />
            <line className="nl-ask-draw" pathLength={1} y1="-0.75" x2="13.1029" y2="-0.75" style={{ animationDelay: '0.25s' }} transform="matrix(0.973066 0.230525 -0.111169 0.993801 13.5 22.5002)" />
            <line className="nl-ask-draw" pathLength={1} y1="-0.75" x2="9.53419" y2="-0.75" style={{ animationDelay: '0.5s' }} transform="matrix(-0.808595 -0.588365 0.324933 -0.945737 21.96 14.6089)" />
          </svg>
        </span>
        <span className="font-sans text-[15px] font-semibold tracking-[-0.01em]">Ask</span>
        <span className="ml-2 flex items-center whitespace-nowrap font-mono text-xs text-ask-hint">
          type anything<span aria-hidden className="nl-ask-cursor ml-[3px] inline-block h-[13px] w-[1.5px] bg-ask-hint" />
        </span>
        <span
          aria-hidden
          className={clsx(
            'flex items-center gap-1 overflow-hidden transition-[width,opacity] duration-150 ease-out',
            preview ? 'ml-1.5 w-[60px] opacity-100' : 'w-0 opacity-0',
          )}
        >
          <span className="grid h-[28px] w-[28px] flex-none place-items-center rounded-full text-ask-hint">
            <Mic size={14} />
          </span>
          <span className="grid h-[28px] w-[28px] flex-none place-items-center rounded-full text-ask-hint">
            <Paperclip size={14} />
          </span>
        </span>
      </button>
    );
  }

  return (
    <div
      data-testid="ink-composer" data-target={target.key}
      className="fixed z-[60] w-[460px] rounded-[18px] bg-ask p-3 text-ask-fg shadow-lg"
      style={style}
    >
      {target.label !== 'New question' && (
        // What `target` actually resolved to — "Combine 2 sources" vs. "Branch from the selected
        // source" is the only thing that tells a user with 2+ picks that Send means synthesize,
        // not branch, before they commit to it. The chip row below shows *what*; this shows *how*.
        <div className="mb-1 font-mono text-xs uppercase tracking-widest text-ask-hint">{target.label}</div>
      )}
      {sources.length > 0 && (
        // The chips are what "what the model will see" means before you send (FR-04). Each removes
        // on its own; removing one never clears the rest.
        <div data-testid="context-chips" className="mb-1.5 flex max-h-[98px] flex-wrap gap-1 overflow-auto">
          {sources.map(s => (
            <span
              key={s.id} data-chip={s.id} data-tone={s.highlightTone ?? 'blue'}
              className={`flex max-w-full items-center gap-1 rounded-sm px-1.5 py-px text-xs text-text ${TONE_BG[s.highlightTone ?? 'blue']}`}
            >
              <span className="min-w-0 truncate">{s.label}</span>
              <button
                type="button" aria-label={`Remove ${s.label} from context`}
                onClick={() => onRemoveSource(s.id)} className="flex-none text-text-3 hover:text-text"
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
      {files.length > 0 && (
        <div className="mb-1.5">
          <AttachmentRow
            files={files}
            onRemove={i => useAttachments.getState().remove(attachKey, i)}
            onPreview={(src, name) => useUiStore.getState().setImagePreview({ src, name })}
          />
        </div>
      )}
      {skills.chips}
      {skills.menu}
      <textarea
        ref={ref} value={text} rows={1} aria-label="Ask about this canvas"
        placeholder={voice.recording ? 'Listening…' : skills.placeholder}
        onChange={e => { setText(e.target.value); skills.onTextChange(); }}
        onKeyDown={e => {
          if (skills.onKeyDown(e, text)) return;
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
          // Escape belongs to the Esc ladder, not to a bare listener here.
        }}
        // A pasted image is attached rather than lost (same behaviour as the chat composer).
        onPaste={e => {
          const images = imagesFromClipboard(e.clipboardData);
          if (!images.length) return;
          e.preventDefault();
          void addPastedFiles(attachKey, images);
        }}
        className="max-h-[200px] min-h-[64px] w-full resize-none border-0 bg-transparent px-1 py-1 text-sm text-ask-fg placeholder:text-ask-hint focus:outline-none"
      />
      <SkillsUsedLine skillsKey={skillsKey} />
      <div className="mt-2 flex items-center gap-1">
        <div className="flex flex-1 gap-0.5 overflow-hidden">
          <ModelChip branchId={null} className={ASK_CHIP} />
          <ModeChip className={ASK_CHIP} />
        </div>
        <button
          type="button" aria-label="Add files" title="Add files"
          onClick={() => { void addFilesTo(attachKey, false); }}
          className="grid h-[28px] w-[28px] flex-none place-items-center rounded-full text-ask-hint hover:bg-ask-chip hover:text-ask-fg"
        >
          <Paperclip size={14} />
        </button>
        <button
          type="button" aria-label={voice.recording ? 'Stop voice input' : 'Voice input'} title="Voice input"
          onClick={toggleVoice}
          className={clsx(
            'mic-chip grid h-[28px] w-[28px] flex-none place-items-center rounded-full text-ask-hint hover:bg-ask-chip hover:text-ask-fg',
            voice.recording && 'recording',
          )}
        >
          <Mic size={14} />
        </button>
        {busy ? (
          <button type="button" onClick={onStop} aria-label="Stop" className="grid h-[28px] w-[28px] flex-none place-items-center rounded-full bg-ask-chip text-ask-fg">
            <span className="h-2.5 w-2.5 rounded-[2px] bg-ask-fg" />
          </button>
        ) : (
          <button
            type="button" onClick={send} disabled={!canSend} aria-label="Send"
            className="grid h-[28px] w-[28px] flex-none place-items-center rounded-full bg-ask-cta text-ask-cta-fg disabled:opacity-40"
          >
            <ArrowUp size={15} />
          </button>
        )}
      </div>
    </div>
  );
}
