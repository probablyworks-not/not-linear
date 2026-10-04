import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bug, ChevronDown, Image as ImageIcon, RefreshCw, Video } from 'lucide-react';
import { clsx } from 'clsx';
import { Section } from '../settings/fields';
import { post, useFeedbackStore } from './feedback-store';

interface Entry {
  id: string; type: 'bug' | 'idea'; date: string; status: string; text: string;
  media: string[]; view?: string; thread?: string;
}
interface ListOut { ok?: boolean; error?: string; entries: Entry[] }

const KEY = ['feedback-list'] as const;

/** Settings → Feedback → "View bugs & ideas" (index.html #fb-log-toggle). Backend-derived, so TanStack Query (ADR-041). */
export function FeedbackLog() {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const version = useFeedbackStore(s => s.logVersion);
  // Legacy refetches the next time it is opened after a save (logLoaded = false); the version in the key does the same.
  const q = useQuery({
    queryKey: [...KEY, version],
    queryFn: async () => {
      const out = await post<ListOut>('/__notlinear_feedback_list');
      if (!out.ok) throw new Error(out.error || 'list failed');
      return out.entries;
    },
    enabled: open,
    staleTime: Infinity,
  });

  const entries = q.data ?? [];
  const bugs = entries.filter(e => e.type === 'bug').length;
  const ideas = entries.length - bugs;
  const label = q.isFetching && !q.data ? 'Loading…'
    : q.isError ? 'Unavailable'
    : q.data ? (entries.length ? `${bugs} bug${bugs === 1 ? '' : 's'} · ${ideas} idea${ideas === 1 ? '' : 's'}` : 'Empty')
    : 'Not loaded';

  return (
    <Section label="Feedback" help={<>Logged anywhere with ⌘⇧B. Saved to <code>feedback/FEEDBACK.md</code> for the coding agent.</>}>
      <button
        type="button" aria-expanded={open} aria-controls="fb-log-view" onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-[9px] rounded-[7px] border border-rule-2 bg-surface px-[11px] py-[9px] text-left text-sm text-text-2 hover:border-text-2 hover:bg-bg-2 hover:text-text"
      >
        <Bug size={14} aria-hidden className="flex-none" />
        <span className="min-w-0 flex-1 truncate">View bugs &amp; ideas</span>
        <ChevronDown size={14} aria-hidden className={clsx('text-text-3 transition-transform duration-150', open && 'rotate-180')} />
      </button>

      {open && (
        <div id="fb-log-view" className="mt-2 overflow-hidden rounded-lg border border-rule bg-surface">
          <div className="flex items-center gap-2 border-b border-rule bg-surface-tint px-[9px] py-[7px]">
            <span data-testid="fb-log-count" className="min-w-0 flex-1 truncate font-mono text-xs uppercase tracking-widest text-text-3">{label}</span>
            <button
              type="button" title="Reload feedback" aria-label="Reload feedback" onClick={() => { void qc.invalidateQueries({ queryKey: KEY }); }}
              className="grid h-6 w-6 place-items-center rounded-[5px] text-text-3 hover:bg-bg-3 hover:text-text"
            >
              <RefreshCw size={13} />
            </button>
          </div>
          <div className="max-h-[330px] overflow-auto" data-testid="fb-log-list">
            {q.isError && <div className="p-4 text-center text-sm text-text-3">Could not load — is the server running with the latest code?</div>}
            {q.data && entries.length === 0 && <div className="p-4 text-center text-sm text-text-3">No feedback yet — press ⌘⇧B anywhere to log a bug or idea.</div>}
            {entries.map(en => (
              <div key={en.id} data-entry={en.id} className="border-b border-rule px-3 py-2.5 last:border-b-0">
                <div className="mb-1 flex items-center gap-2">
                  <span className={clsx('rounded px-1.5 py-px font-mono text-xs', en.type === 'bug' ? 'bg-annotate-soft text-annotate' : 'bg-branch-soft text-branch')}>
                    {en.type === 'bug' ? 'Bug' : 'Idea'}
                  </span>
                  <span className="font-mono text-xs text-text-2">{en.id}</span>
                  <span className="flex-1 text-xs text-text-3">{en.date}</span>
                  <span className={clsx('font-mono text-xs', en.status === 'fixed' ? 'text-success' : 'text-text-3')}>{en.status}</span>
                </div>
                <div className="line-clamp-3 whitespace-pre-wrap text-sm leading-normal text-text-2">{en.text}</div>
                {(en.media.length > 0 || en.view) && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-2.5 font-mono text-xs text-text-3">
                    {en.view && <span>{en.view}{en.thread ? ` · ${en.thread}` : ''}</span>}
                    {en.media.map(m => (
                      <a key={m} href={`/${m}`} target="_blank" rel="noopener" className="inline-flex items-center gap-1 text-text-2 no-underline hover:text-text">
                        {m.endsWith('.mov') ? <Video size={11} aria-hidden /> : <ImageIcon size={11} aria-hidden />}
                        {m.split('/').pop()}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </Section>
  );
}
