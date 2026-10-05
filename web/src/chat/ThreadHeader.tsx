import { useEffect, useLayoutEffect, useRef } from 'react';
import { Coins, GitBranch, Highlighter, Map as MapIcon, MessageSquare, Network, Smile } from 'lucide-react';
import { clsx } from 'clsx';
import { useAppStore } from '../state/app-store';
import { useUiStore } from '../state/ui-store';
import { createDebouncedWriter } from '../lib/debounced-writer';
import { esc } from '../lib/markdown';
import { cleanThreadTitle } from '../db/thread-ops';
import { formatUsage } from './usage';
import { RankingButton } from './RankingPopover';
import { GlyphButton } from '../ui/GlyphButton';
import { setThreadGlyph } from '../state/actions';

// The page title and its meta row (app.js: the `#doc` h1, `#meta-dynamic`, `.meta-actions`).
// The title is editable in place; typing coalesces to one write per 200ms (CLAUDE.md), and
// leaving the field writes at once. A promoted branch's heading belongs to the branch, so
// while a thread is promoted the thread's own name is left alone, as in legacy.

const titleWriter = createDebouncedWriter<string>();
const ICON_BTN = 'grid h-[26px] w-[26px] place-items-center rounded-md text-text-2 hover:bg-bg-2 hover:text-text';

async function saveTitle(threadId: string, el: HTMLElement): Promise<void> {
  const html = el.innerHTML;
  const text = cleanThreadTitle(el.textContent, '');
  await useAppStore.getState().updateThreads(state => {
    const t = state.threads[threadId];
    if (!t) return;
    t.h1 = html;
    const promoted = Array.isArray(t.mainHistory) && t.mainHistory.length > 0;
    if (t.kind !== 'doc' && !promoted && text) {
      t.title = text;
      const entry = state.dynamic.find(d => d.id === threadId);
      if (entry) entry.title = text;
    }
  });
}

function EditableTitle({ threadId, html }: { threadId: string; html: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  // Take the saved HTML in, but never while it is being typed into: that would move the caret.
  useLayoutEffect(() => {
    const el = ref.current;
    if (el && document.activeElement !== el && el.innerHTML !== html) el.innerHTML = html;
  }, [html]);
  useEffect(() => () => { void titleWriter.flush(threadId); }, [threadId]);

  return (
    <h1
      ref={ref} contentEditable suppressContentEditableWarning spellCheck={false} data-testid="thread-title" aria-label="Chat title"
      className="m-0 min-w-0 flex-1 text-[36px] font-semibold leading-[1.1] tracking-[-0.025em] outline-none [&_.accent]:font-medium [&_.accent]:text-accent"
      dangerouslySetInnerHTML={{ __html: html }}
      onInput={e => { const el = e.currentTarget; titleWriter.schedule(threadId, () => saveTitle(threadId, el)); }}
      onBlur={() => { void titleWriter.flush(threadId); }}
      // A title is one line: Enter commits it rather than starting a second paragraph.
      onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}
    />
  );
}

export function ThreadHeader({ threadId, fallbackTitle }: { threadId: string; fallbackTitle: string }) {
  const thread = useAppStore(s => s.threadState[threadId]);
  const highlightsOpen = useUiStore(s => s.highlightsOpen);
  const setHighlightsOpen = useUiStore(s => s.setHighlightsOpen);
  const threadMapOpen = useUiStore(s => s.threadMapOpen);
  const setThreadMapOpen = useUiStore(s => s.setThreadMapOpen);
  const setCanvasOpen = useUiStore(s => s.setCanvasOpen);
  const ctxOpen = useUiStore(s => s.ctxOpen);
  const setCtxOpen = useUiStore(s => s.setCtxOpen);
  if (!thread) return <div className="h-20" />;

  const isDoc = thread.kind === 'doc';
  const title = cleanThreadTitle(thread.title, fallbackTitle);
  const h1 = isDoc ? String(thread.h1 ?? esc(title)) : (typeof thread.h1 === 'string' && thread.h1 ? thread.h1 : esc(title));
  const promoted = Array.isArray(thread.mainHistory) && thread.mainHistory.length > 0;
  const eyebrow = isDoc || promoted ? String(thread.eyebrow ?? '') : '';
  const branches = Object.keys(thread.branchSnapshots ?? {}).length;
  const usage = formatUsage(thread) ?? '—';
  const item = 'inline-flex items-center gap-1.5';

  return (
    <header className="mb-2">
      {eyebrow && <p className="m-0 mb-3 font-mono text-xs uppercase tracking-[0.14em] text-text-3" data-testid="thread-eyebrow">{eyebrow}</p>}
      <div className="my-2 mb-3.5 flex items-center gap-3">
        {/* The same field as the sidebar glyph: pick it here and it changes there. No default icon: an empty title glyph is a smile. */}
        <GlyphButton
          value={thread.emoji} cycle={[]} index={0} size={38} fallback={<Smile size={34} aria-hidden />}
          onPick={token => { void setThreadGlyph(threadId, token); }}
          className="grid h-11 w-11 flex-none cursor-pointer select-none place-items-center rounded-[9px] text-text-3 hover:bg-bg-2 hover:text-text"
        />
        <EditableTitle threadId={threadId} html={h1} />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-text-3" data-testid="thread-meta">
        {isDoc && typeof thread.meta === 'string' && thread.meta ? (
          <div className="flex items-center gap-4" dangerouslySetInnerHTML={{ __html: thread.meta }} />
        ) : (
          <>
            <span className={item}><MessageSquare size={14} />Chat</span>
            <span className={item} data-testid="branch-count"><GitBranch size={14} className="text-accent" />{branches === 1 ? '1 branch' : `${branches} branches`}</span>
            <span className={item} data-testid="thread-usage"><Coins size={14} />{usage}</span>
          </>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          <RankingButton threadId={threadId} buttonClass={ICON_BTN} />
          <button
            type="button" title="Context & files" aria-label="Context and files" aria-pressed={ctxOpen}
            onClick={() => setCtxOpen(!ctxOpen)}
            className={clsx(ICON_BTN, ctxOpen && 'bg-bg-3 text-text')}
          >
            <Network size={14} />
          </button>
          <button
            type="button" title="Highlights" aria-label="Highlights" aria-pressed={highlightsOpen}
            onClick={() => setHighlightsOpen(!highlightsOpen)}
            className={clsx(ICON_BTN, highlightsOpen && 'bg-bg-3 text-text')}
          >
            <Highlighter size={14} />
          </button>
          <button type="button" title="Branches — canvas view" aria-label="Branches — canvas view" onClick={() => setCanvasOpen(true)} className={ICON_BTN}>
            <GitBranch size={14} />
          </button>
          <button
            type="button" title="Thread map" aria-label="Thread map" aria-pressed={threadMapOpen}
            onClick={() => setThreadMapOpen(!threadMapOpen)}
            className={clsx(ICON_BTN, threadMapOpen && 'bg-bg-3 text-text')}
          >
            <MapIcon size={14} />
          </button>
        </div>
      </div>
    </header>
  );
}
