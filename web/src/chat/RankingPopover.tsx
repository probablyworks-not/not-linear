import { useState } from 'react';
import { Brain, X } from 'lucide-react';
import { clsx } from 'clsx';
import { useAppStore } from '../state/app-store';
import { ESC_PRIORITY, useEscLayer } from '../lib/keyboard';

const OPTIONS: Array<{ id: string; label: string }> = [
  { id: 'inherit', label: 'Global setting' },
  { id: 'none', label: 'Off' },
  { id: 'keywords', label: 'Keywords only' },
  { id: 'deepseek', label: 'DeepSeek (smart)' },
];

/**
 * "Context Ranking" for one chat (app.js:4646): how a project's linked folder is searched for
 * this chat's messages, overriding the global setting. Only shown when the chat belongs to a
 * project that has a folder linked; the choice is saved on the thread.
 */
export function RankingButton({ threadId, buttonClass }: { threadId: string; buttonClass: string }) {
  const thread = useAppStore(s => s.threadState[threadId]);
  const projects = useAppStore(s => s.projects);
  const [open, setOpen] = useState(false);
  useEscLayer('ctxRankingPopover', ESC_PRIORITY.ctxRankingPopover, open, () => setOpen(false));

  const pid = typeof thread?.projectId === 'string' ? thread.projectId : undefined;
  if (!pid || !projects[pid]?.path) return null;
  const mode = (thread?.rankingMode as string | undefined) || 'inherit';

  return (
    <>
      <button type="button" title="Context ranking" aria-label="Context ranking" aria-expanded={open} onClick={() => setOpen(o => !o)} className={buttonClass}>
        <Brain size={14} />
      </button>
      {open && (
        <div role="dialog" aria-label="Context Ranking" className="fixed right-5 top-[50px] z-[100] min-w-[200px] rounded-lg border border-rule-2 bg-bg-2 shadow-lg" data-testid="ranking-popover">
          <div className="flex items-center justify-between border-b border-rule px-3 py-2.5">
            <h4 className="m-0 text-sm font-semibold">Context Ranking</h4>
            <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="grid h-6 w-6 place-items-center rounded-md text-text-3 hover:bg-bg-3 hover:text-text"><X size={14} /></button>
          </div>
          <div className="p-3">
            <select
              aria-label="Context ranking mode" value={mode} className={clsx('w-full rounded-md border border-rule-2 bg-surface px-2 py-1.5 text-sm text-text')}
              onChange={e => {
                const value = e.target.value;
                void useAppStore.getState().updateThreads(s => { const t = s.threads[threadId]; if (t) t.rankingMode = value; });
              }}
            >
              {OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
            <p className="mt-2 text-xs text-text-3">Override for this chat only.</p>
          </div>
        </div>
      )}
    </>
  );
}
