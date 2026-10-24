import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowUp, ChevronUp, GitBranch, Maximize2, Minimize2, MoreHorizontal, Square, X } from 'lucide-react';
import { toast } from 'sonner';
import { useAppStore } from '../state/app-store';
import { claudeProvider } from '../providers/claude';
import { deepseekProvider } from '../providers/deepseek';
import { planModel } from '../chat/models';
import { ModelChip } from '../chat/ComposerMenus';
import { friendlyError, highlightCodeIn, renderMarkdown } from '../lib/markdown';
import { nameLinksIn } from '../lib/name-links';
import { applySize, branchRail, clamp, resizeBounds, resizeDelta, type ResizeEdge, type ResizeStart } from '../branch/layout';
import { apiMessages, buildNoteSystemPrompt, titleFromNoteQuote, truncate } from './note-branches';
import { patchBranch, type BranchGeometry, type BranchMessage, type NoteBranch } from './notes-repo';
import { useNotesStore } from './notes-store';
import type { LegacyNote } from './types';

// One Ask-AI branch panel. Same DOM and classes as chat's panel (ADR-028, so chat.css styles it), but
// its data is the note's own `branches[]` record and nothing nests. The reply streams through the
// same providers chat uses; a failed send leaves no half-turn behind.

const EDGES: Array<{ edge: ResizeEdge; title: string }> = [
  { edge: 'top', title: 'Resize upward' }, { edge: 'bottom', title: 'Resize downward' }, { edge: 'left', title: 'Resize sideways' },
  { edge: 'top-left', title: 'Resize upward and sideways' }, { edge: 'bottom-left', title: 'Resize downward and sideways' },
];

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

interface Live { text: string }

async function runReply(note: LegacyNote, br: NoteBranch, signal: AbortSignal, onDelta: (t: string) => void): Promise<{ text: string; error?: string }> {
  const app = useAppStore.getState();
  const plan = planModel(app.prefs.model, !!app.prefs.thinking);
  if (!plan.supported || (plan.provider !== 'claude' && plan.provider !== 'deepseek')) {
    return { text: '', error: 'Notes branches support Claude and DeepSeek models for now — pick one from the model menu.' };
  }
  const provider = plan.provider === 'claude' ? claudeProvider : deepseekProvider;
  let text = '';
  for await (const ev of provider.stream({
    messages: apiMessages(br.quote, br.messages), tools: [], thinking: plan.thinking, signal, model: plan.modelId,
    systemPrompt: buildNoteSystemPrompt(useNotesStore.getState().notes, note, br.quote, app.prefs),
  })) {
    if (ev.t === 'delta') { text += ev.text; onDelta(text); }
    else if (ev.t === 'done') return { text: ev.text || text };
    else if (ev.t === 'error') return { text, error: ev.kind === 'aborted' ? undefined : ev.message };
  }
  return { text };
}

export function NoteBranchPanel({ note, branch, getAnchorTop, initialMessage, onClose, onDelete }: {
  note: LegacyNote;
  branch: NoteBranch;
  /** The anchor's top in the viewport, or null for a note-wide branch. Called whenever the panel is placed. */
  getAnchorTop(): number | null;
  /** Sent once on open (the page-bottom "Ask AI about this note" box). */
  initialMessage?: string;
  onClose(): void;
  onDelete(): void;
}) {
  const refresh = useNotesStore(s => s.load);
  const elRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const drag = useRef<ResizeStart | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [menu, setMenu] = useState(false);
  const [geo, setGeo] = useState<BranchGeometry>({
    collapsed: branch.collapsed, reader: branch.reader, width: branch.width, height: branch.height, top: branch.top, userSized: branch.userSized,
  });
  // The stack's width and the note page's right margin both read --nt-drawer-w (notes' own var, ADR-028),
  // so a resized or expanded panel widens leftwards and pushes the page over instead of running off-screen.
  useEffect(() => {
    const gap = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--drawer-gap')) || 16;
    const w = geo.reader ? Math.min(680, window.innerWidth - gap * 2) : geo.width;
    if (w) document.documentElement.style.setProperty('--nt-drawer-w', `${Math.round(w)}px`);
  }, [geo.reader, geo.width]);
  const streaming = live !== null;
  const empty = branch.messages.length === 0 && !live;

  const saveGeo = (next: BranchGeometry): void => { setGeo(next); void patchBranch(note.id, branch.bid, b => Object.assign(b, next)).then(() => refresh()); };

  // Sit beside the anchor, kept inside the rail, unless the user has placed it. The panel's own box is
  // measured, so this writes the DOM directly rather than going through state.
  const place = useCallback(() => {
    const el = elRef.current;
    if (!el) return;
    const rail = branchRail(document.querySelector('[data-topbar]')?.getBoundingClientRect().bottom, window.innerHeight);
    if (geo.userSized && Number.isFinite(geo.top)) { el.style.top = `${Math.round(geo.top as number)}px`; return; }
    const top = clamp(getAnchorTop() ?? rail.top, rail.top, Math.max(rail.top, rail.bottom - el.offsetHeight));
    el.style.top = `${Math.round(top)}px`;
  }, [geo.userSized, geo.top, getAnchorTop]);

  useLayoutEffect(() => { place(); }, [place, geo.collapsed, branch.messages.length, live?.text.length]);
  useEffect(() => {
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); };
  }, [place]);

  useEffect(() => () => ctrl.current?.abort(), []);
  useEffect(() => { const b = bodyRef.current; if (b) b.scrollTop = b.scrollHeight; }, [branch.messages.length, live?.text]);
  useEffect(() => { if (!live && bodyRef.current) { void highlightCodeIn(bodyRef.current); void nameLinksIn(bodyRef.current); } }, [branch.messages.length, live]);

  const send = async (raw: string): Promise<void> => {
    const text = raw.trim();
    if (!text || streaming) return;
    setError(null);
    const abort = new AbortController();
    ctrl.current = abort;
    setLive({ text: '' });
    const userMsg: BranchMessage = { role: 'user', content: text };
    // The question is saved first so it is not lost; it is taken back if nothing answers it.
    await patchBranch(note.id, branch.bid, b => { b.messages.push(userMsg); b.touchedAt = Date.now(); }, true);
    await refresh();
    const current = useNotesStore.getState().notes.find(n => n.id === note.id);
    const saved = (current?.branches as NoteBranch[] | undefined)?.find(b => b.bid === branch.bid) ?? { ...branch, messages: [...branch.messages, userMsg] };
    let result: { text: string; error?: string };
    try {
      result = await runReply(current ?? note, saved, abort.signal, t => setLive({ text: t }));
    } catch (err) {
      result = { text: '', error: message(err) };
    }
    ctrl.current = null;
    if (result.text && !result.error) {
      await patchBranch(note.id, branch.bid, b => { b.messages.push({ role: 'assistant', content: result.text }); b.touchedAt = Date.now(); }, true);
    } else if (result.text) {
      // Stopped part-way: keep what arrived.
      await patchBranch(note.id, branch.bid, b => { b.messages.push({ role: 'assistant', content: result.text }); }, true);
    } else {
      await patchBranch(note.id, branch.bid, b => { if (b.messages[b.messages.length - 1]?.role === 'user') b.messages.pop(); }, true);
      if (result.error) setError(result.error);
    }
    if (result.error && result.text) setError(result.error);
    setLive(null);
    await refresh();
    taRef.current?.focus();
  };

  const sentInitial = useRef(false);
  useEffect(() => {
    if (initialMessage && !sentInitial.current) { sentInitial.current = true; void send(initialMessage); }
    // Once, on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onResizeDown = (e: React.PointerEvent<HTMLDivElement>, edge: ResizeEdge): void => {
    if (e.button !== 0 || !elRef.current) return;
    e.preventDefault(); e.stopPropagation();
    const r = elRef.current.getBoundingClientRect();
    drag.current = { edge, startX: e.clientX, startY: e.clientY, startW: r.width, startH: r.height, startTop: r.top, startBottom: r.bottom };
    e.currentTarget.setPointerCapture(e.pointerId);
    document.body.classList.add('resizing-branch');
  };
  const onResizeMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const start = drag.current; const el = elRef.current;
    if (!start || !el) return;
    const rail = branchRail(document.querySelector('[data-topbar]')?.getBoundingClientRect().bottom, window.innerHeight);
    const bounds = resizeBounds(rail, window.innerWidth, window.innerHeight, parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--drawer-gap')) || 16);
    const change = resizeDelta(start, e.clientX, e.clientY, bounds);
    const next = applySize({ width: geo.width, height: geo.height, top: geo.top, measuredTop: el.getBoundingClientRect().top }, change, bounds);
    setGeo(g => ({ ...g, ...next, userSized: true, collapsed: false }));
  };
  const onResizeEnd = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (!drag.current) return;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    drag.current = null;
    document.body.classList.remove('resizing-branch');
    saveGeo(geo);
  };

  const cls = ['branch', geo.collapsed ? 'collapsed' : 'expanded', empty ? 'empty' : '', geo.reader ? 'reader' : '', geo.userSized ? 'user-sized' : ''].filter(Boolean).join(' ');
  const style: React.CSSProperties = {};
  if (geo.width) style.width = Math.round(geo.width);
  if (geo.userSized && geo.height && !geo.collapsed) style.height = Math.round(geo.height);

  return (
    <div ref={elRef} className={cls} data-bid={branch.bid} data-testid={`note-branch-${branch.bid}`} style={style}>
      <div className="branch-head" onClick={e => { if (!(e.target as HTMLElement).closest('.actions')) saveGeo({ ...geo, collapsed: !geo.collapsed }); }}>
        <div className="ico logo-ico"><GitBranch size={16} /></div>
        <div className="title"><span className="ttl">{titleFromNoteQuote(branch.quote)}</span></div>
        <div className="actions" onClick={e => e.stopPropagation()}>
          <button type="button" data-h="reader" className={geo.reader ? 'on' : ''} title={geo.reader ? 'Shrink branch' : 'Expand branch'} aria-label={geo.reader ? 'Shrink branch' : 'Expand branch'} onClick={() => saveGeo({ ...geo, reader: !geo.reader, collapsed: false })}>
            {geo.reader ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
          </button>
          <button type="button" data-h="collapse" title="Collapse/expand" aria-label="Collapse or expand panel" onClick={() => saveGeo({ ...geo, collapsed: !geo.collapsed })}><ChevronUp size={14} /></button>
          <span className="relative">
            <button type="button" data-h="menu" title="Branch actions" aria-label="Branch actions" onClick={() => setMenu(m => !m)}><MoreHorizontal size={14} /></button>
            {menu && (
              <div role="menu" aria-label="Branch actions" className="absolute right-0 top-full z-10 mt-1 min-w-[170px] rounded-lg border border-rule-2 bg-surface-2 p-1 shadow-lg">
                <button type="button" role="menuitem" className="flex w-full rounded-sm px-2.5 py-1.5 text-left text-sm text-text hover:bg-bg-3" disabled={!branch.quote}
                  onClick={() => { setMenu(false); void navigator.clipboard?.writeText(branch.quote ?? '').then(() => toast('Copied source quote')).catch(() => {}); }}>Copy as quote</button>
                <button type="button" role="menuitem" className="flex w-full rounded-sm px-2.5 py-1.5 text-left text-sm text-text hover:bg-bg-3" onClick={() => { setMenu(false); onClose(); }}>Close branch</button>
                <button type="button" role="menuitem" className="flex w-full rounded-sm px-2.5 py-1.5 text-left text-sm text-danger hover:bg-bg-3" onClick={() => { setMenu(false); onDelete(); }}>Delete branch</button>
              </div>
            )}
          </span>
          <button type="button" data-h="close" title="Close branch" aria-label="Close branch" onClick={onClose}><X size={14} /></button>
        </div>
      </div>
      {branch.quote && <div className="branch-quote"><span className="lab">Branched from note</span>&quot;{truncate(branch.quote, 140)}&quot;</div>}
      <div ref={bodyRef} className="branch-body" data-testid="note-branch-body">
        {branch.messages.map((m, i) => (m.role === 'user'
          ? <div key={i} className="msg user"><div className="bub">{m.content}</div></div>
          : <div key={i} className="msg ai" dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }} />))}
        {live && (live.text
          ? <div className="msg ai streaming" dangerouslySetInnerHTML={{ __html: renderMarkdown(live.text) }} />
          : <div className="msg ai streaming"><span className="text-text-3">&hellip;</span></div>)}
        {error && <div role="alert" className="msg ai text-sm text-danger" data-testid="note-branch-error">{friendlyError(error)}</div>}
      </div>
      <div className="branch-compose">
        <div className="composer">
          <textarea
            ref={taRef} rows={1} value={draft} disabled={streaming} aria-label="Ask about this" placeholder={branch.quote ? 'Ask about this passage…' : 'Ask about this note…'}
            onChange={e => { setDraft(e.target.value); e.target.style.height = 'auto'; e.target.style.height = `${Math.min(120, e.target.scrollHeight)}px`; }}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); const t = draft; setDraft(''); void send(t); } }}
          />
          <div className="compose-row">
            <div className="left"><ModelChip branchId={null} className="branch-model-chip" /></div>
            <button
              type="button" className="send-btn" aria-label={streaming ? 'Stop' : 'Send'} disabled={!streaming && !draft.trim()}
              onClick={() => { if (streaming) ctrl.current?.abort(); else { const t = draft; setDraft(''); void send(t); } }}
            >
              {streaming ? <Square size={12} /> : <ArrowUp size={14} />}
            </button>
          </div>
        </div>
      </div>
      {EDGES.map(({ edge, title }) => (
        <div key={edge} className="branch-resize" data-edge={edge} title={title} aria-hidden="true"
          onPointerDown={e => onResizeDown(e, edge)} onPointerMove={onResizeMove} onPointerUp={onResizeEnd} onPointerCancel={onResizeEnd} />
      ))}
    </div>
  );
}
