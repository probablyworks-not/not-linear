import { useMemo } from 'react';
import { X } from 'lucide-react';
import { clsx } from 'clsx';
import { useAppStore } from '../state/app-store';
import { useUiStore } from '../state/ui-store';
import { resolveThreadTitle } from '../db/thread-ops';
import { parseSummary, summarizeThread, useSummaryStore } from './thread-summary';

/**
 * The thread map drawer (app.js:2650): a card per chat that has messages, the current one
 * first, each with a one-click DeepSeek summary. Read-only apart from that summary, which is
 * kept for the session. Like legacy it closes by its own button, not Esc.
 */
export function ThreadMap({ currentThreadId }: { currentThreadId: string }) {
  const open = useUiStore(s => s.threadMapOpen);
  const setOpen = useUiStore(s => s.setThreadMapOpen);
  const threads = useAppStore(s => s.threadState);
  const summaries = useSummaryStore(s => s.text);
  const busy = useSummaryStore(s => s.busy);
  const errors = useSummaryStore(s => s.error);

  const cards = useMemo(() => {
    const entries = Object.entries(threads).filter(([, t]) => ((t?.mainMessages ?? []) as Array<{ role: string }>).some(m => m.role === 'user'));
    return [...entries.filter(([id]) => id === currentThreadId), ...entries.filter(([id]) => id !== currentThreadId)];
  }, [threads, currentThreadId]);

  return (
    <aside
      aria-label="Thread Map" aria-hidden={!open} data-testid="thread-map"
      className={clsx(
        'fixed bottom-0 right-0 top-0 z-[100] flex w-[min(420px,92vw)] flex-col border-l border-rule bg-bg shadow-lg',
        'transition-transform duration-[240ms] ease-out', open ? 'translate-x-0' : 'invisible translate-x-full',
      )}
    >
      <div className="flex shrink-0 items-center gap-2.5 border-b border-rule px-4 py-3.5">
        <h3 className="m-0 flex-1 text-base font-semibold text-text">Thread Map</h3>
        <button type="button" aria-label="Close thread map" onClick={() => setOpen(false)} className="grid h-6 w-6 place-items-center rounded-md text-text-3 hover:bg-bg-3 hover:text-text">
          <X size={14} />
        </button>
      </div>
      <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto p-4">
        {cards.length === 0 && <div className="px-0.5 py-2 text-sm leading-normal text-text-3">No threads with messages yet.</div>}
        {cards.map(([id, thread]) => {
          const userCount = ((thread?.mainMessages ?? []) as Array<{ role: string }>).filter(m => m.role === 'user').length;
          const branchCount = Object.keys(thread?.branchSnapshots ?? {}).length;
          const meta = [`${userCount} message${userCount !== 1 ? 's' : ''}`, branchCount ? `${branchCount} branch${branchCount !== 1 ? 'es' : ''}` : ''].filter(Boolean).join(' · ');
          const text = summaries[id];
          const parsed = text ? parseSummary(text) : null;
          return (
            <div key={id} data-tid={id} className={clsx('flex flex-col gap-2 rounded-[10px] border bg-bg-2 p-3.5', id === currentThreadId ? 'border-accent' : 'border-rule')}>
              <div className="truncate text-sm font-semibold leading-snug text-text">{resolveThreadTitle(thread, 'Untitled chat')}</div>
              <div className="font-mono text-xs uppercase tracking-wide text-text-3">{meta}</div>
              {errors[id] && <div className="text-xs leading-normal text-danger">{errors[id]}</div>}
              {parsed ? (
                <div className="flex flex-col gap-1.5">
                  {parsed.about && <div className="text-sm leading-relaxed text-text">{parsed.about}</div>}
                  {parsed.ideas.length > 0 && (
                    <ul className="m-0 flex list-none flex-col gap-1 p-0">
                      {parsed.ideas.map((idea, i) => (
                        <li key={i} className="relative pl-3.5 text-sm leading-normal text-text-2"><span className="absolute left-[3px] text-accent">·</span>{idea}</li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : !busy[id] || !text ? (
                <button
                  type="button" disabled={!!busy[id]}
                  onClick={() => { void summarizeThread(id, thread!); }}
                  className="self-start rounded-md border border-accent bg-accent-soft px-2.5 py-1 text-xs text-accent hover:bg-bg-3 disabled:opacity-50"
                >
                  {busy[id] ? 'Summarizing…' : errors[id] ? 'Retry' : 'Summarize'}
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
