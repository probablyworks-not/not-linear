import { useMemo } from 'react';
import { FileText, GitBranch, MessageSquare, X } from 'lucide-react';
import { clsx } from 'clsx';
import { useAppStore } from '../state/app-store';
import { useUiStore } from '../state/ui-store';
import { goToHighlight } from '../branch/open-from';
import { removeHighlight } from './marking';
import { titleFromQuote } from '../branch/actions';
import type { PersistedHighlight } from '../db/types';

/** app.js:2377 highlightSourceLabel / :2388 highlightSourceIcon. */
function sourceLabel(h: PersistedHighlight): string {
  if (h.source === 'branch') {
    const depth = h.depth && h.depth > 1 ? ` ↳ ${h.depth}` : '';
    return `Branch${depth} · ${titleFromQuote(h.branchQuote || h.text || 'Untitled branch')}`;
  }
  return h.source === 'main-chat' ? 'Main chat' : 'Document';
}
const SourceIcon = ({ source }: { source: PersistedHighlight['source'] }) =>
  source === 'branch' ? <GitBranch size={12} /> : source === 'main-chat' ? <MessageSquare size={12} /> : <FileText size={12} />;

/** The right-edge drawer listing this chat's saved highlights (app.js:2392). Closes by its button or the scrim, not Esc, as in legacy. */
export function HighlightsPanel({ threadId }: { threadId: string }) {
  const open = useUiStore(s => s.highlightsOpen);
  const setOpen = useUiStore(s => s.setHighlightsOpen);
  const highlights = useAppStore(s => s.threadState[threadId]?.highlights);
  const items = useMemo(() => [...(highlights ?? [])].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)), [highlights]);

  return (
    <>
      <div
        onClick={() => setOpen(false)} aria-hidden="true"
        className={clsx('fixed inset-0 z-[150] bg-scrim transition-opacity duration-200', open ? 'opacity-100' : 'pointer-events-none opacity-0')}
      />
      <aside
        aria-label="Highlights" aria-hidden={!open} data-testid="highlights-panel"
        className={clsx(
          'fixed bottom-4 right-4 top-16 z-[160] flex w-[min(380px,92vw)] flex-col overflow-hidden rounded-xl border border-rule bg-surface shadow-lg',
          'transition-transform duration-200 ease-out', open ? 'translate-x-0' : 'invisible translate-x-[calc(100%+24px)]',
        )}
      >
        <div className="flex shrink-0 items-center gap-2.5 border-b border-rule px-4 py-3.5">
          <h3 className="m-0 flex-1 text-base font-semibold text-text">Highlights</h3>
          <span className="rounded-full border border-rule px-2 font-mono text-xs text-text-3" data-testid="highlight-count">{items.length}</span>
          <button type="button" aria-label="Close highlights" onClick={() => setOpen(false)} className="grid h-6 w-6 place-items-center rounded-md text-text-3 hover:bg-bg-3 hover:text-text">
            <X size={14} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {items.length === 0 ? (
            <div className="px-0.5 py-2 text-sm text-text-3">No highlights saved in this chat yet.</div>
          ) : (
            <div className="flex flex-col gap-2">
              {items.map(item => (
                <div
                  key={item.id} role="button" tabIndex={0} aria-label={`Go to highlight: ${item.text}`}
                  onClick={e => { if (!(e.target as HTMLElement).closest('[data-remove]')) goToHighlight(item.id); }}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goToHighlight(item.id); } }}
                  className="flex w-full cursor-pointer items-start gap-2 rounded-lg border border-highlight-soft border-l-2 border-l-highlight bg-highlight-soft p-2.5 text-left hover:bg-highlight-strong"
                >
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-center gap-1.5 font-mono text-xs uppercase tracking-wide text-text-3">
                      <span className="text-highlight"><SourceIcon source={item.source} /></span>
                      <span>{sourceLabel(item)}</span>
                    </div>
                    <div className="line-clamp-4 text-sm leading-normal text-text">{item.text}</div>
                  </div>
                  <button
                    type="button" data-remove title="Remove highlight" aria-label="Remove highlight"
                    onClick={e => { e.preventDefault(); e.stopPropagation(); void removeHighlight(threadId, item.id); }}
                    className="grid h-[22px] w-[22px] shrink-0 place-items-center rounded-md text-text-3 hover:bg-bg-3 hover:text-text"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
