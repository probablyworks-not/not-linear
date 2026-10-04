import { useEffect, useReducer, useState, useSyncExternalStore } from 'react';
import { ChevronDown, Copy, RefreshCw, TerminalSquare, Trash2 } from 'lucide-react';
import { clsx } from 'clsx';
import { LOG_EVENT, clearRequestLog, requestLog } from '../lib/request-log';
import { getSyncStatus, subscribeSyncStatus } from '../lib/runtime-log-sync';
import { toast } from '../ui/toast';
import { Section } from './fields';

const format = (entry: unknown): string => JSON.stringify(entry, null, 2);

/** Settings → Runtime logs → "View request logs" (index.html #logs-toggle, app.js:4529). */
export function RuntimeLogs() {
  const [open, setOpen] = useState(false);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const syncStatus = useSyncExternalStore(subscribeSyncStatus, getSyncStatus);

  // Live while open: re-render whenever an event is logged. The log is an external, mutable buffer.
  useEffect(() => {
    if (!open) return undefined;
    window.addEventListener(LOG_EVENT, rerender);
    return () => window.removeEventListener(LOG_EVENT, rerender);
  }, [open]);

  const n = requestLog.length;
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(requestLog.map(format).join('\n\n'));
      toast('Logs copied');
    } catch {
      toast('Could not copy logs');
    }
  };
  const tool = 'grid h-6 w-6 place-items-center rounded-[5px] text-text-3 hover:bg-bg-3 hover:text-text';

  return (
    <Section label="Runtime logs">
      <button
        type="button" aria-expanded={open} aria-controls="logs-view" onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-[9px] rounded-[7px] border border-rule-2 bg-surface px-[11px] py-[9px] text-left text-sm text-text-2 hover:border-text-2 hover:bg-bg-2 hover:text-text"
      >
        <TerminalSquare size={14} aria-hidden className="flex-none" />
        <span className="min-w-0 flex-1 truncate">View request logs</span>
        <ChevronDown size={14} aria-hidden className={clsx('text-text-3 transition-transform duration-150', open && 'rotate-180')} />
      </button>

      {open && (
        <div id="logs-view" className="mt-2 overflow-hidden rounded-lg border border-rule bg-surface">
          <div className="flex items-center gap-2 border-b border-rule bg-surface-tint px-[9px] py-[7px]">
            <span data-testid="logs-summary" className="font-mono text-xs uppercase tracking-widest text-text-3">{n} event{n === 1 ? '' : 's'}</span>
            <span data-testid="logs-file-status" className="min-w-0 flex-1 truncate text-right font-mono text-xs text-text-3">{syncStatus}</span>
            <button type="button" title="Refresh logs" aria-label="Refresh logs" className={tool} onClick={rerender}><RefreshCw size={13} /></button>
            <button type="button" title="Copy logs" aria-label="Copy logs" className={tool} onClick={() => { void copy(); }}><Copy size={13} /></button>
            <button
              type="button" title="Clear logs" aria-label="Clear logs" className={tool}
              onClick={() => { clearRequestLog(); rerender(); toast('Logs cleared'); }}
            >
              <Trash2 size={13} />
            </button>
          </div>
          <pre data-testid="logs-content" className="m-0 max-h-[300px] overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-xs leading-normal text-text-2">
            {n ? requestLog.slice().reverse().map(format).join('\n\n') : 'No log events yet.'}
          </pre>
        </div>
      )}
    </Section>
  );
}
