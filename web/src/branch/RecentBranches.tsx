import { useMemo } from 'react';
import { clsx } from 'clsx';
import { GitBranch, Trash2 } from 'lucide-react';
import { useAppStore } from '../state/app-store';
import { useBranchStore } from './branch-store';
import { deleteBranch, titleFromQuote } from './actions';
import { openBranchRow } from './open-from';
import { recentBranchRows, type OpenBranchSeed } from '../chat/branch-model';
import { visibleThreads, MAIN_THREAD_ID } from '../db/thread-ops';
import { SidebarSection } from '../shell/SidebarSection';

/**
 * Sidebar "Recent branches" (app.js:5833): the eight most recently touched branches across
 * every chat, open ones included. Click opens it (switching chat first if it is in another);
 * the bin deletes it with the usual confirmation.
 */
export function RecentBranches() {
  const threadState = useAppStore(s => s.threadState);
  const dynamic = useAppStore(s => s.dynamicThreads);
  const deleted = useAppStore(s => s.deletedThreadIds);
  const open = useBranchStore(s => s.open);

  const rows = useMemo(() => {
    const threads = visibleThreads({
      threads: threadState, dynamic, deletedThreads: deleted,
      current: MAIN_THREAD_ID, chatCount: 1, projects: {}, projectCount: 1, prefs: {},
    }).map(r => ({ tid: r.id, title: r.title, thread: threadState[r.id] }));
    const byThread: Record<string, OpenBranchSeed[]> = {};
    for (const b of Object.values(open)) (byThread[b.threadId] ??= []).push(b);
    return recentBranchRows(threads, byThread, 8);
  }, [threadState, dynamic, deleted, open]);

  return (
    <SidebarSection section="recent" label="Recent branches">
      <div className="flex flex-col gap-px" data-testid="recent-branches">
        {rows.length === 0 && <div className="px-2 py-1.5 text-sm leading-snug text-text-3">No recent branches</div>}
        {rows.map(({ tid, threadTitle, row, isOpen }) => {
          const title = titleFromQuote(row.quote || 'Untitled branch');
          return (
            <div
              key={`${tid}:${row.id}`} data-recent-branch={row.id} title={`${title} - ${threadTitle}`}
              className={clsx('group relative flex w-full items-center rounded-md p-0 text-sm leading-tight text-text-2 hover:bg-bg-2 hover:text-text', isOpen && 'bg-bg-2 text-text')}
            >
              <button type="button" onClick={() => openBranchRow(tid, row)} className="flex min-w-0 flex-1 items-center gap-[9px] rounded-md px-2 py-1.5 text-left">
                <GitBranch size={15} aria-hidden className="flex-none text-branch" />
                <span className="truncate">{title}</span>
                <span className="ml-auto max-w-[72px] flex-none truncate font-mono text-xs text-text-3">{threadTitle}</span>
              </button>
              <button
                type="button" title="Delete branch" aria-label={`Delete ${titleFromQuote(row.quote || 'branch')}`}
                onClick={e => { e.preventDefault(); e.stopPropagation(); void deleteBranch(row.id, tid); }}
                className="mr-1 grid h-6 w-6 flex-none place-items-center rounded-[5px] text-text-3 opacity-0 hover:bg-bg-3 hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
              >
                <Trash2 size={13} />
              </button>
            </div>
          );
        })}
      </div>
    </SidebarSection>
  );
}
