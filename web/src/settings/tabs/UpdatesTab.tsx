import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, RefreshCw, Sparkles } from 'lucide-react';
import { clsx } from 'clsx';
import { loadChangelogText } from '../../changelog/load';
import { parseStoryChapters, type Chapter, type Tag } from '../../changelog/parse';
import { HeaderActions } from '../header-slot';
import { BTN, EmptyState, PageBody } from '../ui';

const QUERY_KEY = ['changelog'] as const;

// CHANGELOG.md tags map onto the three groups the page shows. Same mechanical tagging as before; nothing is rewritten.
const GROUPS: ReadonlyArray<{ tag: Tag; label: string; chip: string }> = [
  { tag: 'Feature', label: 'New', chip: 'bg-branch-soft text-branch' },
  { tag: 'Improvement', label: 'Improved', chip: 'bg-highlight-soft text-text' },
  { tag: 'Fix', label: 'Fixed', chip: 'bg-bg-3 text-text-2' },
];

/**
 * Product updates, moved out of the old Settings dialog. Backend-derived and fetched, so it goes
 * through TanStack Query (ADR-041); loaded when the tab opens and again only on refresh.
 */
export function UpdatesTab() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: QUERY_KEY, queryFn: () => loadChangelogText(), staleTime: Infinity });
  const chapters: Chapter[] = q.data ? parseStoryChapters(q.data.text) : [];

  return (
    <>
      <HeaderActions>
        <button type="button" aria-label="Reload changelog" className={BTN} onClick={() => { void qc.invalidateQueries({ queryKey: QUERY_KEY }); }}>
          <RefreshCw size={14} aria-hidden className={clsx(q.isFetching && 'animate-spin')} />Refresh
        </button>
      </HeaderActions>
      <PageBody max={760}>
        {q.isFetching && !q.data ? (
          <p className="m-0 py-10 text-center text-sm text-text-3">Loading changelog...</p>
        ) : chapters.length === 0 ? (
          <EmptyState icon={<Sparkles size={18} />} title="No updates yet">No changelog entries found. They appear here when CHANGELOG.md has dated sections.</EmptyState>
        ) : (
          <div className="flex flex-col gap-[18px]">
            {chapters.map((c, i) => <ReleaseCard key={`${c.date}-${i}`} chapter={c} latest={i === 0} />)}
          </div>
        )}
        <p data-testid="changelog-source" className="m-0 mt-[18px] flex items-center gap-2 px-1 text-xs text-text-3">
          <FileText size={14} aria-hidden />
          {q.data?.source === 'Bundled copy'
            ? 'Showing the copy bundled with the app: CHANGELOG.md could not be read.'
            : 'Reads from CHANGELOG.md when the app can access the local file.'}
        </p>
      </PageBody>
    </>
  );
}

function ReleaseCard({ chapter: c, latest }: { chapter: Chapter; latest: boolean }) {
  return (
    <article data-testid="release-card" data-latest={latest} className={clsx('overflow-hidden rounded-2xl border bg-surface', latest ? 'border-branch-strong' : 'border-rule')}>
      <div className={clsx('flex items-center gap-3.5 px-[22px] py-[18px]', latest ? 'bg-branch-soft' : 'bg-surface-2')}>
        <span aria-hidden className="grid h-11 w-11 flex-none place-items-center rounded-xl bg-surface text-text-2"><Sparkles size={20} /></span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5">
            <span data-testid="release-date" className="text-base font-semibold text-text">{c.date}</span>
            {latest && <span className="rounded-full bg-branch-soft px-2.5 py-0.5 text-xs text-branch">Latest</span>}
          </div>
        </div>
      </div>
      <p data-testid="release-summary" className="m-0 px-[22px] pb-1.5 pt-[18px] text-base leading-relaxed text-text-2">{c.narrative}</p>
      <div className="flex flex-col px-[22px] pb-5 pt-2">
        {GROUPS.map(g => {
          const items = c.items.filter(it => it.tag === g.tag);
          if (!items.length) return null; // empty groups stay hidden
          return (
            <div key={g.tag} className="grid grid-cols-[92px_minmax(0,1fr)] gap-4 border-t border-rule py-3.5 first:border-t-0">
              <div><span className={clsx('inline-block rounded-full px-2.5 py-0.5 font-mono text-xs uppercase tracking-widest', g.chip)}>{g.label}</span></div>
              <div className="flex flex-col gap-2">
                {items.map((it, i) => <div key={i} data-testid="release-item" className="text-sm leading-relaxed text-text-2">{it.text}</div>)}
              </div>
            </div>
          );
        })}
      </div>
    </article>
  );
}
