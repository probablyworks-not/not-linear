import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../state/app-store';
import { useUiStore } from '../state/ui-store';
import { useChatStore } from './chat-store';
import { askAbout, continueMain, isStreaming, retryTurn, sendMessage, stopStreaming } from './send';
import { parseStream } from './stream-html';
import { LiveAiTurn } from './LiveAiTurn';
import { ClarifyCard } from './ClarifyCard';
import { ClarifySummary } from './ClarifySummary';
import { resolveClarify, type ClarifyAnswer } from './clarify';
import { MessageList } from './MessageList';
import { Composer } from './Composer';
import { ThreadHeader } from './ThreadHeader';
import { SelectionPopover } from './SelectionPopover';
import { HighlightsPanel } from './HighlightsPanel';
import { ContextPanel } from './ContextPanel';
import { BranchStack } from '../branch/BranchStack';
import { ThreadMap } from '../branch/ThreadMap';
import { BranchCanvas } from '../branch/BranchCanvas';
import { useBranchStore } from '../branch/branch-store';
import { dropAllBranches, crumbTitleOf } from '../branch/actions';
import { openBranchFromAnchor } from '../branch/open-from';
import { consumePending } from '../branch/pending';
import { highlightCodeIn, renderMermaidIn } from '../lib/markdown';
import { MAIN_THREAD_ID, STATIC_THREADS } from '../db/thread-ops';
import { threadAttachKey } from '../attachments/attachments-store';
import { paneLayout } from '../notes/pane-width';
import { flags } from '../flags';

// The note pane carries the Notes editor, so chat only loads it when a note is opened.
const NotePane = lazy(() => import('../notes/NotePane').then(m => ({ default: m.NotePane })));

/** How far from the bottom still counts as "following along" while text streams. */
const FOLLOW_SLACK_PX = 120;
/** Legacy's breakpoint: below this the branch drawer is hidden and the page does not make room for it. */
const DRAWER_MIN_WIDTH = 1100;

function useWindowWidth(): number {
  const [w, setW] = useState(window.innerWidth);
  useEffect(() => {
    const on = (): void => setW(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return w;
}

export function ChatView({ threadId }: { threadId: string }) {
  const thread = useAppStore(s => s.threadState[threadId]);
  const live = useChatStore(s => s.live[threadId]);
  const failed = useChatStore(s => s.failed[threadId]);
  const offer = useChatStore(s => s.cont[threadId]);
  const setSettingsOpen = useUiStore(s => s.setSettingsOpen);
  const notePaneId = useUiStore(s => (flags.chatNotes ? s.notePaneId : null));
  const notePaneWidth = useUiStore(s => s.notePaneWidth);
  const openHere = useBranchStore(s => Object.values(s.open).some(b => b.threadId === threadId));
  const width = useWindowWidth();
  const box = useRef<HTMLDivElement>(null);
  const following = useRef(true);

  const fallbackTitle = STATIC_THREADS.find(t => t.id === threadId)?.title ?? 'Untitled chat';
  const stream = typeof thread?.stream === 'string' ? thread.stream : '';
  const liveTurnId = live?.turnId;
  // The reply being written is drawn live, so its saved copy (debounced, a beat behind) is skipped.
  const turns = useMemo(
    () => parseStream(stream).filter(t => !liveTurnId || t.id !== liveTurnId),
    [stream, liveTurnId],
  );
  const assistantMarkdown = useMemo(
    () => ((thread?.mainMessages ?? []) as Array<{ role: string; content: unknown }>).filter(m => m.role === 'assistant').map(m => (typeof m.content === 'string' ? m.content : '')),
    [thread?.mainMessages],
  );
  const unavailable = !thread && threadId === MAIN_THREAD_ID;
  const empty = turns.length === 0 && !live;
  const makeRoom = openHere && width > DRAWER_MIN_WIDTH;
  // The chat column gives up the width the note pane takes (and the branch drawer's, when both are open).
  const pane = notePaneId ? paneLayout(notePaneWidth, width) : null;
  const noteRoom = pane?.beside ? pane.width : 0;
  const drawerRoom = makeRoom ? 'var(--drawer-w) + var(--drawer-gap) * 2' : '0px';

  // Leaving a thread snapshots and closes its panels; arriving may have a branch waiting to open.
  useEffect(() => {
    const t = requestAnimationFrame(() => consumePending(threadId));
    return () => { cancelAnimationFrame(t); void dropAllBranches(); useUiStore.getState().closeNotePane(); };
  }, [threadId]);

  // Syncing with the window's scroll position, an external system.
  useEffect(() => {
    const onScroll = (): void => {
      following.current = document.documentElement.scrollHeight - window.scrollY - window.innerHeight < FOLLOW_SLACK_PX;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (following.current) window.scrollTo({ top: document.documentElement.scrollHeight });
  }, [live?.text, live?.thinking, liveTurnId, live?.clarify]);

  // Mermaid and highlight.js are DOM libraries: they run on the settled markup, not mid-stream.
  const settled = !live;
  useEffect(() => {
    if (!settled || !box.current) return;
    renderMermaidIn(box.current);
    void highlightCodeIn(box.current);
  }, [stream, settled]);

  const onClick = (e: React.MouseEvent<HTMLDivElement>): void => {
    const target = e.target as HTMLElement;
    const noteCard = target.closest<HTMLElement>('.note-ref');
    if (noteCard?.dataset.noteId && flags.chatNotes) { useUiStore.getState().openNotePane(noteCard.dataset.noteId); return; }
    const anchor = target.closest<HTMLElement>('.branched');
    if (anchor) { openBranchFromAnchor(threadId, anchor, null); return; }
    const pic = target.closest<HTMLImageElement>('.msg-image');
    if (pic) { useUiStore.getState().setImagePreview({ src: pic.src, name: pic.dataset.name ?? '' }); return; }
    const copy = target.closest<HTMLElement>('.code-copy-btn');
    if (copy) {
      const code = copy.closest('.code-block')?.querySelector('pre code')?.textContent ?? '';
      void navigator.clipboard?.writeText(code).then(() => {
        copy.classList.add('copied');
        setTimeout(() => copy.classList.remove('copied'), 1200);
      });
      return;
    }
    const toggle = target.closest('.thinking-toggle');
    if (toggle) toggle.closest('.ai-thinking')?.classList.toggle('open');
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const card = (e.target as HTMLElement).closest<HTMLElement>('.note-ref');
    if (!card?.dataset.noteId || !flags.chatNotes) return;
    e.preventDefault();
    useUiStore.getState().openNotePane(card.dataset.noteId);
  };

  return (
    <>
      <div
        // No `w-full`: a full-width box plus a right margin overflows instead of making room for the drawer.
        className="flex min-w-0 flex-1 flex-col transition-[margin] duration-[240ms] ease-out"
        style={{ marginRight: makeRoom || noteRoom ? `calc(${drawerRoom} + ${noteRoom}px)` : 0 }}
      >
        <div ref={box} onClick={onClick} onKeyDown={onKeyDown} className="mx-auto w-full max-w-[780px] flex-1 px-8 pb-48 pt-6" data-chat-stream data-testid="chat-stream">
          <ThreadHeader threadId={threadId} fallbackTitle={fallbackTitle} />
          {empty ? (
            <div className="mt-24 text-center" data-testid="chat-empty">
              <p className="text-sm text-text-2">Ask a question to start.</p>
              <p className="mt-1 text-xs text-text-3">Replies stream in as they are written. Highlight any passage to branch from it.</p>
            </div>
          ) : (
            <div className="chat-stream">
              <MessageList
                turns={turns} assistantMarkdown={assistantMarkdown} clarifications={thread?.clarifications as Record<string, ClarifyAnswer[]> | undefined} title={crumbTitleOf(thread, fallbackTitle)}
                offer={offer} busy={!!live} actionGap={10} onContinue={count => { void continueMain(threadId, count); }}
              />
              {live && (
                <>
                  <div className="msg user" data-turn-id={live.turnId} data-live>
                    <div className="bub">{live.bubbleHTML ? <div dangerouslySetInnerHTML={{ __html: live.bubbleHTML }} /> : <div>{live.userText}</div>}</div>
                  </div>
                  {live.clarify
                    ? <ClarifyCard questions={live.clarify} onSubmit={answers => resolveClarify(threadId, answers)} onSkip={() => resolveClarify(threadId, null)} />
                    : (
                      <>
                        {!!live.clarified?.length && <ClarifySummary answers={live.clarified} />}
                        <LiveAiTurn turn={live} />
                      </>
                    )}
                </>
              )}
            </div>
          )}
          {failed && !live && (
            <div className="mt-2 flex gap-2" data-testid="turn-actions">
              {failed.config
                ? <button type="button" className="err-btn" onClick={() => setSettingsOpen(true)}>Open settings</button>
                : <button type="button" className="err-btn primary" onClick={() => { void retryTurn(threadId); }}>↺ Try again</button>}
            </div>
          )}
        </div>
        <Composer
          disabled={unavailable}
          alwaysShow={empty}
          disabledReason="Open this thread in the classic app once to continue it here."
          streaming={!!live && isStreaming(threadId)}
          attachKey={threadAttachKey(threadId)}
          skillsKey={threadId}
          onSend={(text, skills) => { void sendMessage(threadId, text, skills); }}
          onStop={() => stopStreaming(threadId)}
        />
      </div>
      {notePaneId && (
        <Suspense fallback={null}><NotePane key={notePaneId} noteId={notePaneId} /></Suspense>
      )}
      <BranchStack threadId={threadId} fallbackTitle={crumbTitleOf(thread, fallbackTitle)} />
      <SelectionPopover threadId={threadId} threadTitle={crumbTitleOf(thread, fallbackTitle)} onAsk={text => { void askAbout(threadId, text); }} />
      <HighlightsPanel threadId={threadId} />
      <ContextPanel threadId={threadId} />
      <ThreadMap currentThreadId={threadId} />
      <BranchCanvas threadId={threadId} />
    </>
  );
}
