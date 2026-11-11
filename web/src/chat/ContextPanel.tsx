import { useMemo, useState } from 'react';
import { CheckCircle2, ChevronRight, FilePlus, FileText, Folder, FolderOpen, GitBranch, MessageSquare, Trash2, X } from 'lucide-react';
import { clsx } from 'clsx';
import { useAppStore } from '../state/app-store';
import { useUiStore } from '../state/ui-store';
import { useBranchStore } from '../branch/branch-store';
import { deleteBranch, titleFromQuote } from '../branch/actions';
import { openBranchRow } from '../branch/open-from';
import { branchRowsForThread, type BranchRow } from './branch-model';
import { AttachmentRow } from '../attachments/AttachmentRow';
import { addFilesTo, branchToAttachment } from '../attachments/attach-actions';
import { threadAttachKey, useAttachments } from '../attachments/attachments-store';
import { resolveThreadTitle } from '../db/thread-ops';
import { ESC_PRIORITY, useEscLayer } from '../lib/keyboard';

/** app.js:5993 turnTimestamp: a turn id carries its creation time, so turns sort without a stored one. */
function turnTimestamp(mainTurnId: string | null): number {
  const m = /^turn-([0-9a-z]+)-/.exec(mainTurnId || '');
  return m ? parseInt(m[1]!, 36) : 0;
}

const previewText = (content: unknown): string =>
  typeof content === 'string' ? content : Array.isArray(content) ? content.filter(c => c?.type === 'text').map(c => c.text).join(' ') : '';

/**
 * "Context & files" (app.js:6017 renderCtxPanel): where this chat's branches sit under the main
 * thread, grouped by the turn each was started from, and the files attached to the page. It is
 * also where "Attach branch" happens: with the picker on, clicking a branch adds its transcript
 * to the next message instead of opening it, and clicking again removes it.
 */
export function ContextPanel({ threadId }: { threadId: string }) {
  const open = useUiStore(s => s.ctxOpen);
  const setOpen = useUiStore(s => s.setCtxOpen);
  const setActiveProject = useUiStore(s => s.setActiveProject);
  const thread = useAppStore(s => s.threadState[threadId]);
  const projects = useAppStore(s => s.projects);
  const folder = useAppStore(s => s.prefs.folderName) || 'Workspace';
  const openPanels = useBranchStore(s => s.open);
  const picker = useAttachments(s => s.picker);
  const files = useAttachments(s => s.files);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [previewing, setPreviewing] = useState<ReadonlySet<string>>(new Set());

  const close = (): void => { setOpen(false); useAttachments.getState().setPicker(null); };
  useEscLayer('ctxPanel', ESC_PRIORITY.ctxPanel, open, close);

  const rows = useMemo(
    () => branchRowsForThread(thread, Object.values(openPanels).filter(b => b.threadId === threadId)),
    [thread, openPanels, threadId],
  );
  const topLevel = rows.filter(r => !r.parentBid || !rows.some(p => p.id === r.parentBid));
  const groups = useMemo(() => {
    const m = new Map<string, { prompt: string; rows: BranchRow[] }>();
    for (const r of topLevel) {
      const g = m.get(r.mainTurnId || '') ?? { prompt: '', rows: [] };
      if (!g.prompt && r.mainTurnPrompt) g.prompt = r.mainTurnPrompt;
      g.rows.push(r);
      m.set(r.mainTurnId || '', g);
    }
    return [...m.entries()].sort(([a], [b]) => turnTimestamp(b) - turnTimestamp(a));
  }, [topLevel]);

  const project = typeof thread?.projectId === 'string' ? projects[thread.projectId] : undefined;
  const pickerKey = picker?.key;
  const pickerFiles = pickerKey ? files[pickerKey] ?? [] : [];
  const attachedIds = new Set(pickerFiles.filter(f => f.kind === 'branch').map(f => (f as { branchId?: string }).branchId));
  const pageFiles = files[threadAttachKey(threadId)] ?? [];
  const messagesOf = (id: string): Array<{ role: string; content: unknown }> => (thread?.branchSnapshots?.[id]?.messages ?? []) as Array<{ role: string; content: unknown }>;

  const toggleSet = (set: ReadonlySet<string>, id: string, write: (s: ReadonlySet<string>) => void): void => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    write(next);
  };

  const renderBranch = (row: BranchRow): JSX.Element => {
    const kids = rows.filter(r => r.parentBid === row.id).sort((a, b) => (b.touchedAt || 0) - (a.touchedAt || 0));
    const messages = messagesOf(row.id);
    const attached = !!pickerKey && attachedIds.has(row.id);
    const isCollapsed = collapsed.has(row.id);
    const title = titleFromQuote(row.quote || 'Untitled branch');
    return (
      <div key={row.id}>
        <div
          role="button" tabIndex={0} data-ctx-branch={row.id} aria-pressed={pickerKey ? attached : undefined}
          onClick={e => {
            if ((e.target as HTMLElement).closest('[data-ctx-control]')) return;
            if (pickerKey) {
              const store = useAttachments.getState();
              const idx = (store.files[pickerKey] ?? []).findIndex(f => f.kind === 'branch' && (f as { branchId?: string }).branchId === row.id);
              if (idx >= 0) store.remove(pickerKey, idx); else store.add(pickerKey, [branchToAttachment(thread, row)]);
              return;
            }
            openBranchRow(threadId, row);
          }}
          onKeyDown={e => { if (e.key === 'Enter') (e.currentTarget as HTMLElement).click(); }}
          className={clsx(
            'group relative ml-4 flex cursor-pointer items-center gap-[7px] rounded-md px-2 py-[5px] text-xs text-text-3 hover:bg-bg-2 hover:text-text-2',
            row.open && 'bg-bg-2 text-text', attached && 'bg-accent-soft text-text',
          )}
        >
          {kids.length ? (
            <button
              type="button" data-ctx-control title="Expand/collapse sub-branches" aria-label="Toggle sub-branches"
              onClick={() => toggleSet(collapsed, row.id, setCollapsed)}
              className="grid h-3.5 w-3.5 flex-none place-items-center text-text-3 hover:text-text"
            >
              <ChevronRight size={10} className={clsx('transition-transform duration-150', !isCollapsed && 'rotate-90')} />
            </button>
          ) : <span className="h-3.5 w-3.5 flex-none" />}
          {attached ? <CheckCircle2 size={11} className="flex-none text-accent" /> : <GitBranch size={11} className="flex-none" />}
          <span className="min-w-0 flex-1 truncate" title={row.quote}>{title}</span>
          {messages.length > 0 && (
            <button
              type="button" data-ctx-control title="Preview recent turns"
              onClick={() => toggleSet(previewing, row.id, setPreviewing)}
              className="ml-auto flex-none rounded-sm bg-bg-2 px-[5px] py-px font-mono text-xs text-text-3 hover:bg-bg-3 hover:text-text"
            >
              {messages.length} turn{messages.length === 1 ? '' : 's'}
            </button>
          )}
          <button
            type="button" data-ctx-control title="Delete branch" aria-label={`Delete ${title}`}
            onClick={() => { void deleteBranch(row.id, threadId); }}
            className="grid h-[21px] w-[21px] flex-none place-items-center rounded-[5px] text-text-3 opacity-0 hover:bg-bg-3 hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
          >
            <Trash2 size={11} />
          </button>
        </div>
        {previewing.has(row.id) && messages.length > 0 && (
          <div className="ml-[26px] flex flex-col gap-[3px] border-l border-rule-2 py-1.5 pl-[18px] pr-2">
            {messages.slice(-4).map((m, i) => {
              const text = previewText(m.content).trim();
              return (
                <div key={i} className="text-xs leading-snug text-text-3">
                  <span className="mr-[5px] font-semibold text-text-2">{m.role === 'assistant' ? 'Assistant' : 'You'}</span>
                  <span>{(text.length > 200 ? text.slice(0, 200).trimEnd() + '…' : text) || '(no text)'}</span>
                </div>
              );
            })}
          </div>
        )}
        {kids.length > 0 && !isCollapsed && <div className="ml-[26px] border-l border-rule-2 pl-2.5">{kids.map(renderBranch)}</div>}
      </div>
    );
  };

  return (
    <>
      <div onClick={close} aria-hidden="true" className={clsx('fixed inset-0 z-[150] bg-scrim transition-opacity duration-200', open ? 'opacity-100' : 'pointer-events-none opacity-0')} />
      <aside
        aria-label="Context and files" aria-hidden={!open} data-testid="ctx-panel"
        className={clsx(
          'fixed bottom-4 right-4 top-16 z-[160] flex w-[min(340px,92vw)] flex-col overflow-hidden rounded-xl border border-rule bg-surface shadow-lg transition-transform duration-200 ease-out',
          open ? 'translate-x-0' : 'invisible translate-x-[calc(100%+24px)]',
        )}
      >
        <div className="flex shrink-0 items-center gap-2.5 border-b border-rule px-4 py-3.5">
          <h3 className="m-0 flex-1 text-base font-semibold text-text">Context</h3>
          <button type="button" aria-label="Close context" onClick={close} className="grid h-6 w-6 place-items-center rounded-md text-text-3 hover:bg-bg-3 hover:text-text"><X size={14} /></button>
        </div>
        {pickerKey && (
          <div className="border-b border-rule bg-accent-soft px-4 py-2 text-xs text-text-2" data-testid="ctx-picker-note">
            Click a branch to add it as context for your next message. Click again to remove it.
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-4 py-3.5">
          <section className="mb-5">
            <div className="mb-2 font-mono text-xs uppercase tracking-widest text-text-3">Hierarchy</div>
            <div data-testid="ctx-tree">
              <div className="mb-1.5 flex items-center gap-2 text-sm font-semibold text-text"><FolderOpen size={14} className="text-text-3" />{folder}</div>
              {project && (
                <div role="button" tabIndex={0} onClick={() => { setActiveProject(project.id); close(); }} className="ml-4 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm text-text-2 hover:bg-bg-2 hover:text-text">
                  <Folder size={12} className="text-text-3" /><span className="min-w-0 flex-1 truncate">{project.name || 'Project'}</span>
                </div>
              )}
              <div className={clsx('relative flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-text', project ? 'ml-8' : 'ml-4')}>
                <FileText size={12} className="text-text-3" />
                <span className="min-w-0 flex-1 truncate">{resolveThreadTitle(thread, 'Untitled chat')}</span>
                {rows.length > 0 && <span className="ml-auto font-mono text-xs text-text-3">{rows.length}</span>}
              </div>
              {groups.map(([turnId, group]) => (
                <div key={turnId || 'none'}>
                  {turnId && (
                    <div className="ml-4 flex items-center gap-[7px] px-2 py-1 text-xs font-semibold tracking-tight text-text-3">
                      <MessageSquare size={11} /><span className="min-w-0 flex-1 truncate" title={group.prompt}>{titleFromQuote(group.prompt || 'Turn')}</span>
                    </div>
                  )}
                  <div className={turnId ? 'mb-1.5 ml-4 mt-0.5 border-l border-rule-2 pl-2.5' : ''}>
                    {[...group.rows].sort((a, b) => (b.touchedAt || 0) - (a.touchedAt || 0)).map(renderBranch)}
                  </div>
                </div>
              ))}
            </div>
          </section>
          <section className="mb-5">
            <div className="mb-2 flex items-center justify-between font-mono text-xs uppercase tracking-widest text-text-3">
              <span>Page files</span>
              <button
                type="button" title="Add files to this page" aria-label="Add files to this page"
                onClick={() => { void addFilesTo(threadAttachKey(threadId), false); }}
                className="rounded-sm px-1 py-0.5 text-text-3 hover:bg-bg-2 hover:text-text"
              >
                <FilePlus size={13} />
              </button>
            </div>
            {pageFiles.length === 0
              ? <div className="text-sm text-text-3">No files attached to this page.</div>
              : <AttachmentRow files={pageFiles} onRemove={i => useAttachments.getState().remove(threadAttachKey(threadId), i)} onPreview={(src, name) => useUiStore.getState().setImagePreview({ src, name })} />}
          </section>
        </div>
      </aside>
    </>
  );
}

