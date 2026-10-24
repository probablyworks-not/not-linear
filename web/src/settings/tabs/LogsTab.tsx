import { useEffect, useReducer, useState, useSyncExternalStore } from 'react';
import { Brain, ChevronDown, ChevronRight, Copy, RefreshCw, TerminalSquare, Trash2, Wrench, AlertTriangle } from 'lucide-react';
import { clsx } from 'clsx';
import { LOG_EVENT, clearRequestLog, requestLog, type LogEntry } from '../../lib/request-log';
import { getSyncStatus, scheduleRuntimeLogFileSync, subscribeSyncStatus } from '../../lib/runtime-log-sync';
import { useUiStore } from '../../state/ui-store';
import { toast } from '../../ui/toast';
import { classify, clockOf, countByKind, metaOf, titleOf, type LogFilter, type LogKind } from '../log-view';
import { EmptyState, ICON_BTN, PageBody, SubTabs } from '../ui';

export const LOGS_CLEARED_EVENT = 'notlinear:logs-cleared';

/** Re-renders whenever an event is logged or the buffer is cleared. The log is an external, mutable buffer. */
export function useLogCount(): number {
  return useSyncExternalStore(
    cb => {
      window.addEventListener(LOG_EVENT, cb);
      window.addEventListener(LOGS_CLEARED_EVENT, cb);
      return () => { window.removeEventListener(LOG_EVENT, cb); window.removeEventListener(LOGS_CLEARED_EVENT, cb); };
    },
    () => requestLog.length,
  );
}

const KIND: Record<LogKind, { icon: typeof Brain; chip: string }> = {
  llm: { icon: Brain, chip: 'bg-branch-soft text-branch' },
  tool: { icon: Wrench, chip: 'bg-bg-3 text-text-2' },
  error: { icon: AlertTriangle, chip: 'bg-danger-soft text-danger' },
};

const format = (entry: unknown): string => JSON.stringify(entry, null, 2);

export function LogsTab() {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const syncStatus = useSyncExternalStore(subscribeSyncStatus, getSyncStatus);
  const askConfirm = useUiStore(s => s.askConfirm);
  const [filter, setFilter] = useState<LogFilter>('all');
  const [openEntry, setOpenEntry] = useState<LogEntry | null>(null);

  useEffect(() => {
    window.addEventListener(LOG_EVENT, rerender);
    return () => window.removeEventListener(LOG_EVENT, rerender);
  }, []);

  const counts = countByKind(requestLog);
  const visible = requestLog.filter(e => filter === 'all' || classify(e) === filter).reverse(); // newest first

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(visible.map(format).join('\n\n'));
      toast('Logs copied');
    } catch {
      toast('Could not copy logs');
    }
  };
  const clear = async (): Promise<void> => {
    if (!requestLog.length) { toast('No logs to clear'); return; }
    const ok = await askConfirm({
      heading: 'Clear runtime logs?', name: 'logs.md', before: 'This empties the log here and in',
      after: '. It cannot be undone.', actionLabel: 'Clear logs',
    });
    if (!ok) return;
    clearRequestLog();
    window.dispatchEvent(new Event(LOGS_CLEARED_EVENT));
    scheduleRuntimeLogFileSync(); // so logs.md follows the buffer instead of keeping the old events
    setOpenEntry(null);
    rerender();
    toast('Logs cleared');
  };

  return (
    <PageBody>
      <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
        <SubTabs<LogFilter>
          label="Log filter" value={filter} onChange={setFilter}
          items={[
            { id: 'all', label: 'All', count: counts.all }, { id: 'llm', label: 'LLM', count: counts.llm },
            { id: 'tool', label: 'Tool', count: counts.tool }, { id: 'error', label: 'Error', count: counts.error },
          ]}
        />
        <div className="flex-1" />
        <span data-testid="logs-file-status" className="flex items-center gap-1.5 font-mono text-xs text-text-2">
          <span aria-hidden className={clsx('h-1.5 w-1.5 rounded-full', syncStatus === 'logs.md synced' ? 'bg-success' : syncStatus === 'logs.md sync unavailable' ? 'bg-danger' : 'bg-text-3')} />
          {syncStatus}
        </span>
        <button type="button" title="Refresh logs" aria-label="Refresh logs" className={ICON_BTN} onClick={rerender}><RefreshCw size={14} /></button>
        <button type="button" title="Copy logs" aria-label="Copy logs" className={ICON_BTN} disabled={!visible.length} onClick={() => { void copy(); }}><Copy size={14} /></button>
        <button type="button" title="Clear logs" aria-label="Clear logs" className={clsx(ICON_BTN, 'border-danger-border text-danger hover:bg-danger-soft hover:text-danger')} onClick={() => { void clear(); }}><Trash2 size={14} /></button>
      </div>

      {visible.length === 0 ? (
        <EmptyState icon={<TerminalSquare size={18} />} title={counts.all === 0 ? 'No events.' : `No ${filter} events.`}>
          {counts.all === 0 ? 'Every model and tool request shows up here as it happens.' : 'Switch the filter to see the others.'}
        </EmptyState>
      ) : (
        <ul className="m-0 list-none divide-y divide-rule overflow-hidden rounded-[14px] border border-rule p-0" aria-label="Log events">
          {visible.map((e, i) => {
            const kind = classify(e);
            const { icon: Icon, chip } = KIND[kind];
            const open = openEntry === e;
            return (
              <li key={`${i}-${e.timestamp}`} data-log-kind={kind}>
                <button
                  type="button" aria-expanded={open} onClick={() => setOpenEntry(open ? null : e)}
                  className={clsx('flex w-full items-center gap-3 px-4 py-3 text-left', open ? 'bg-surface-2' : 'bg-surface hover:bg-bg-2')}
                >
                  {open ? <ChevronDown size={14} className="flex-none text-text-3" aria-hidden /> : <ChevronRight size={14} className="flex-none text-text-3" aria-hidden />}
                  <span className="w-16 flex-none font-mono text-xs text-text-3">{clockOf(e.timestamp)}</span>
                  <span className={clsx('inline-flex w-16 flex-none items-center justify-center gap-1 rounded-md py-0.5 font-mono text-xs uppercase', chip)}><Icon size={12} aria-hidden />{kind}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-text">{titleOf(e)}</span>
                  <span className="whitespace-nowrap font-mono text-xs text-text-3">{metaOf(e)}</span>
                </button>
                {open && <pre data-testid="log-json" className="m-0 overflow-x-auto border-t border-rule bg-surface-2 py-3.5 pl-[46px] pr-[18px] font-mono text-xs leading-relaxed text-text-2">{format(e)}</pre>}
              </li>
            );
          })}
        </ul>
      )}
    </PageBody>
  );
}
