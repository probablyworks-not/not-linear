import { useEffect, useMemo, useRef } from 'react';
import { ChevronUp, GitBranch, Maximize2, Minimize2, MoreHorizontal, Undo2, X } from 'lucide-react';
import { useAppStore } from '../state/app-store';
import { useChatStore } from '../chat/chat-store';
import { useBranchStore, openList, type OpenBranch } from './branch-store';
import { closeBranch, contentOf, titleFromQuote, toggleCollapse, toggleReader } from './actions';
import { branchKey, continueBranchTurn, isBranchStreaming, retryBranchTurn, sendBranchMessage, stopBranch } from './branch-send';
import { openBranchFromAnchor, openParentBranch } from './open-from';
import { useUiStore } from '../state/ui-store';
import { BranchComposer } from './BranchComposer';
import { LiveAiTurn } from '../chat/LiveAiTurn';
import { MessageList } from '../chat/MessageList';
import { parseStream } from '../chat/stream-html';
import { branchRowsForThread } from '../chat/branch-model';
import { formatUsage } from '../chat/usage';
import { branchRail, resizeBounds, resizeDelta, applySize, type ResizeEdge, type ResizeStart } from './layout';
import { highlightCodeIn, renderMermaidIn } from '../lib/markdown';

const EDGES: Array<{ edge: ResizeEdge; title: string }> = [
  { edge: 'top', title: 'Resize upward' },
  { edge: 'bottom', title: 'Resize downward' },
  { edge: 'left', title: 'Resize sideways' },
  { edge: 'top-left', title: 'Resize upward and sideways' },
  { edge: 'bottom-left', title: 'Resize downward and sideways' },
];

/** app.js:104 truncate. */
const truncate = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1).trim() + '…' : s);

export interface PanelFlags {
  behindActive: boolean;
  sourceOut: boolean;
  readerEclipsed: boolean;
  zIndex: number;
}

interface Props {
  branch: OpenBranch;
  flags: PanelFlags;
  registerEl(id: string, el: HTMLElement | null): void;
  onLayout(): void;
  onMenu(anchor: HTMLElement, id: string): void;
}

/** Cursor class the page takes on while an edge is being dragged (chat.css `body.resizing-branch`). */
const RESIZE_CLASSES = ['resizing-branch', 'resize-x', 'resize-y', 'resize-ne-sw', 'resize-nw-se'];

export function BranchPanel({ branch: b, flags, registerEl, onLayout, onMenu }: Props) {
  const thread = useAppStore(s => s.threadState[b.threadId]);
  const live = useChatStore(s => s.live[branchKey(b.id)]);
  const failed = useChatStore(s => s.failed[branchKey(b.id)]);
  const offer = useChatStore(s => s.cont[branchKey(b.id)]);
  const elRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const drag = useRef<ResizeStart | null>(null);

  const content = thread ? contentOf(thread, b.id) : null;
  const liveTurnId = live?.turnId;
  const turns = useMemo(
    () => parseStream(content?.bodyHTML ?? '').filter(t => !liveTurnId || t.id !== liveTurnId),
    [content?.bodyHTML, liveTurnId],
  );
  const empty = turns.length === 0 && !live;
  const usage = content ? formatUsage(content) : null;
  const hasParent = useMemo(() => {
    if (!b.parentBid) return false;
    const open = openList().filter(o => o.threadId === b.threadId);
    return branchRowsForThread(thread, open).some(r => r.id === b.parentBid);
  }, [b.parentBid, b.threadId, thread]);
  const streaming = !!live && isBranchStreaming(b.id);

  useEffect(() => {
    registerEl(b.id, elRef.current);
    return () => registerEl(b.id, null);
  }, [b.id, registerEl]);

  // Follow the reply as it is written, like legacy's `body.scrollTop = body.scrollHeight`.
  useEffect(() => {
    const body = bodyRef.current;
    if (body && live) body.scrollTop = body.scrollHeight;
  }, [live?.text, live?.thinking, live?.turnId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mermaid and highlight.js run on settled markup, not mid-stream.
  useEffect(() => {
    if (live || !bodyRef.current) return;
    renderMermaidIn(bodyRef.current);
    void highlightCodeIn(bodyRef.current);
  }, [content?.bodyHTML, live]);

  // Pulse when jumped to or reopened (legacy's `flash`, an inline box-shadow for 700ms).
  const flash = useBranchStore(s => s.flash);
  useEffect(() => {
    const el = elRef.current;
    if (!el || flash?.id !== b.id) return undefined;
    const prev = el.style.boxShadow;
    el.style.boxShadow = `0 0 0 2px var(--accent), ${getComputedStyle(el).boxShadow}`;
    const t = setTimeout(() => { el.style.boxShadow = prev; }, 700);
    return () => clearTimeout(t);
  }, [flash, b.id]);

  const patch = useBranchStore.getState().patch;

  const onBodyClick = (e: React.MouseEvent): void => {
    const target = e.target as HTMLElement;
    // A branch marker inside a panel opens (or re-focuses) that branch as this one's child.
    const anchor = target.closest<HTMLElement>('.branched');
    if (anchor) { openBranchFromAnchor(b.threadId, anchor, b.id); return; }
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

  // ---------- resize (app.js:3711) ----------
  const onResizeDown = (e: React.PointerEvent<HTMLDivElement>, edge: ResizeEdge): void => {
    if (e.button !== 0 || !elRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    patch(b.id, { collapsed: false });
    const r = elRef.current.getBoundingClientRect();
    drag.current = { edge, startX: e.clientX, startY: e.clientY, startW: r.width, startH: r.height, startTop: r.top, startBottom: r.bottom };
    e.currentTarget.setPointerCapture(e.pointerId);
    document.body.classList.add(RESIZE_CLASSES[0]!);
    document.body.classList.toggle('resize-x', edge === 'left');
    document.body.classList.toggle('resize-y', edge === 'top' || edge === 'bottom');
    document.body.classList.toggle('resize-ne-sw', edge === 'bottom-left');
    document.body.classList.toggle('resize-nw-se', edge === 'top-left');
  };
  const onResizeMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const start = drag.current;
    const el = elRef.current;
    if (!start || !el) return;
    const rail = branchRail(document.querySelector('[data-topbar]')?.getBoundingClientRect().bottom, window.innerHeight);
    const gap = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--drawer-gap')) || 16;
    const bounds = resizeBounds(rail, window.innerWidth, window.innerHeight, gap);
    const change = resizeDelta(start, e.clientX, e.clientY, bounds);
    const cur = useBranchStore.getState().open[b.id] ?? b;
    const next = applySize({ width: cur.width, height: cur.height, top: cur.top, measuredTop: el.getBoundingClientRect().top }, change, bounds);
    patch(b.id, { ...next, userSized: true, collapsed: false });
    onLayout();
  };
  const onResizeEnd = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!drag.current) return;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    drag.current = null;
    document.body.classList.remove(...RESIZE_CLASSES);
  };

  const cls = [
    'branch', b.entering ? 'entering' : '', b.collapsed ? 'collapsed' : 'expanded', empty ? 'empty' : '',
    b.reader ? 'reader' : '', b.userSized ? 'user-sized' : '', flags.behindActive ? 'behind-active' : '',
    flags.sourceOut ? 'source-out' : '', flags.readerEclipsed ? 'reader-eclipsed' : '',
  ].filter(Boolean).join(' ');

  const style: React.CSSProperties = { zIndex: flags.zIndex };
  if (b.width) style.width = Math.round(b.width);
  if (b.height && !b.collapsed) style.height = Math.round(b.height);
  if (b.closing) Object.assign(style, { transition: 'opacity 180ms, transform 180ms', opacity: 0, transform: 'translateX(20px)' });

  return (
    <div ref={elRef} className={cls} data-bid={b.id} data-testid={`branch-${b.id}`} style={style}>
      <div
        className="branch-head"
        onClick={e => { if (!(e.target as HTMLElement).closest('.actions')) toggleCollapse(b.id); }}
      >
        <div className="ico logo-ico"><GitBranch size={16} /></div>
        <div className="title">
          <span className="depth">↳ {b.depth}</span>
          <span className="ttl">{titleFromQuote(b.quote || 'Untitled branch')}</span>
          <span className="branch-usage">{usage ?? ''}</span>
        </div>
        {/* Action clicks must never reach the head's collapse toggle (legacy comment on app.js:3406). */}
        <div className="actions" onClick={e => e.stopPropagation()}>
          {hasParent && (
            <button type="button" data-h="parent" title="Back to parent branch" aria-label="Back to parent branch" onClick={() => openParentBranch(b.threadId, b.id)}>
              <Undo2 size={14} />
            </button>
          )}
          <button
            type="button" data-h="reader" className={b.reader ? 'on' : ''}
            title={b.reader ? 'Shrink branch' : 'Expand branch'} aria-label={b.reader ? 'Shrink branch' : 'Expand branch'}
            onClick={() => { const r = elRef.current?.getBoundingClientRect(); toggleReader(b.id, r && { width: r.width, height: r.height }); }}
          >
            {b.reader ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button type="button" data-h="collapse" title="Collapse/expand" aria-label="Collapse or expand panel" onClick={() => toggleCollapse(b.id)}>
            <ChevronUp size={14} />
          </button>
          <button type="button" data-h="menu" title="Branch actions" aria-label="Branch actions" onClick={e => onMenu(e.currentTarget, b.id)}>
            <MoreHorizontal size={14} />
          </button>
          <button type="button" data-h="close" title="Close branch" aria-label="Close branch" onClick={() => { void closeBranch(b.id); }}>
            <X size={14} />
          </button>
        </div>
      </div>
      <div className="branch-quote">
        <span className="lab">{b.parentBid ? 'Branched from branch' : 'Branched from doc'}</span>
        &quot;{truncate(b.quote || 'Untitled branch', 140)}&quot;
      </div>
      <div ref={bodyRef} className="branch-body" onClick={onBodyClick} onScroll={onLayout} data-testid={`branch-body-${b.id}`}>
        <MessageList
          turns={turns}
          assistantMarkdown={(content?.messages ?? []).filter(m => m.role === 'assistant').map(m => (typeof m.content === 'string' ? m.content : ''))}
          title={titleFromQuote(b.quote || 'branch')} offer={offer} busy={!!live} actionGap={2}
          onContinue={count => { void continueBranchTurn(b.threadId, b.id, count); }}
        />
        {live && (
          <>
            <div className="msg user" data-turn-id={live.turnId} data-live>
              <div className="bub"><div>{live.userText}</div></div>
            </div>
            <LiveAiTurn turn={live} />
          </>
        )}
        {failed && !live && (
          <div className="flex gap-2">
            {failed.config
              ? <button type="button" className="err-btn" onClick={() => useUiStore.getState().setSettingsOpen(true)}>Open settings</button>
              : <button type="button" className="err-btn primary" onClick={() => { void retryBranchTurn(b.threadId, b.id); }}>↺ Try again</button>}
          </div>
        )}
      </div>
      <BranchComposer
        branchId={b.id}
        streaming={streaming}
        onSend={text => { void sendBranchMessage(b.threadId, b.id, text); }}
        onStop={() => stopBranch(b.id)}
      />
      {EDGES.map(({ edge, title }) => (
        <div
          key={edge} className="branch-resize" data-edge={edge} title={title} aria-hidden="true"
          onPointerDown={e => onResizeDown(e, edge)} onPointerMove={onResizeMove} onPointerUp={onResizeEnd} onPointerCancel={onResizeEnd}
        />
      ))}
    </div>
  );
}
