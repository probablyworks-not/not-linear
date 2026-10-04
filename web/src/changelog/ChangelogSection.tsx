import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, ChevronDown, History, RefreshCw } from 'lucide-react';
import { clsx } from 'clsx';
import { Section } from '../settings/fields';
import { loadChangelogText } from './load';
import { parseStoryChapters, STORY_TAG_HUES, type Chapter } from './parse';
import { StoryIcon } from './StoryIcon';

const QUERY_KEY = ['changelog'] as const;
const fade = (color: string, pct: number): string => `color-mix(in srgb, ${color} ${pct}%, transparent)`;

/**
 * Settings → Changelog (index.html #changelog-toggle). Backend-derived and
 * fetched, so it goes through TanStack Query (ADR-041). Legacy loads once per
 * page and again only on the refresh button, hence staleTime Infinity.
 *
 * The fullscreen "Product story" player and its sidebar entry are deliberately
 * not part of this port.
 */
export function ChangelogSection() {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => loadChangelogText(),
    enabled: open, // legacy fetches on first expand, not on page load
    staleTime: Infinity,
  });

  const chapters: Chapter[] = q.data ? parseStoryChapters(q.data.text) : [];
  const refresh = async (): Promise<void> => {
    setIndex(0);
    await qc.invalidateQueries({ queryKey: QUERY_KEY });
  };

  const source = q.isFetching ? 'Loading' : q.data ? q.data.source : 'Not loaded';

  return (
    <Section label="Changelog" help={<>Reads from <code>CHANGELOG.md</code> when the app can access the local file.</>}>
      <button
        type="button" aria-expanded={open} aria-controls="changelog-view" onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-[9px] rounded-[7px] border border-rule-2 bg-surface px-[11px] py-[9px] text-left text-sm text-text-2 hover:border-text-2 hover:bg-bg-2 hover:text-text"
      >
        <History size={14} aria-hidden className="flex-none" />
        <span className="min-w-0 flex-1 truncate">View changelog</span>
        <ChevronDown size={14} aria-hidden className={clsx('text-text-3 transition-transform duration-150', open && 'rotate-180')} />
      </button>

      {open && (
        <div id="changelog-view" className="mt-2 overflow-hidden rounded-lg border border-rule bg-surface">
          <div className="flex items-center gap-2 border-b border-rule bg-surface-tint px-[9px] py-[7px]">
            <span data-testid="changelog-source" className="min-w-0 flex-1 truncate font-mono text-xs uppercase tracking-widest text-text-3">{source}</span>
            <button
              type="button" title="Reload changelog" aria-label="Reload changelog" onClick={() => { void refresh(); }}
              className="grid h-6 w-6 place-items-center rounded-[5px] text-text-3 hover:bg-bg-3 hover:text-text"
            >
              <RefreshCw size={13} />
            </button>
          </div>
          {q.isFetching && !q.data
            ? <div className="p-3 text-sm text-text-2"><p>Loading changelog...</p></div>
            : <Cards chapters={chapters} index={index} onIndex={setIndex} />}
        </div>
      )}
    </Section>
  );
}

function Cards({ chapters, index, onIndex }: { chapters: Chapter[]; index: number; onIndex(i: number): void }) {
  const ch = chapters[index];
  if (!ch) return <div className="p-3"><p className="m-0 py-5 text-center text-text-3">No changelog entries found.</p></div>;
  const pager = 'flex flex-none items-center gap-[5px] rounded-full border border-rule-2 bg-surface px-3 py-1.5 text-xs text-text-2 enabled:hover:border-text-2 enabled:hover:text-text disabled:opacity-40';
  // Deliberate difference from legacy, where the pager sits inside the scrolling box:
  // a chapter with many items pushes it below the fold. Here only the card scrolls and
  // the pager stays in view.
  return (
    <>
      <div className="max-h-[360px] overflow-auto p-3 text-sm leading-normal text-text-2">
      <div className="flex flex-col items-center gap-2 px-2.5 pb-1.5 pt-1 text-center">
        <div className="grid h-12 w-12 flex-none place-items-center rounded-[13px]" style={{ background: fade(ch.hue, 13) }}>
          <StoryIcon id={ch.heroIcon} size={26} color={ch.hue} />
        </div>
        <div data-testid="chapter-date" className="font-mono text-xs uppercase tracking-widest text-text-3">{ch.date}</div>
        <p data-testid="chapter-narrative" className="m-0 max-w-[420px] text-sm leading-relaxed text-text">{ch.narrative}</p>
        <div className="mt-0.5 flex flex-wrap justify-center gap-1.5">
          {ch.items.map((it, i) => {
            const h = STORY_TAG_HUES[it.tag];
            return (
              <div key={i} data-testid="chapter-item" className="flex items-center gap-1.5 rounded-full border border-rule bg-surface-tint px-[9px] py-[5px]">
                <span className="grid h-4 w-4 flex-none place-items-center rounded-[5px]" style={{ background: fade(h.color, 13) }}>
                  <StoryIcon id={h.id} size={11} color={h.color} />
                </span>
                <span className="text-xs text-text">{it.text}</span>
                <span className="font-mono text-xs uppercase" style={{ color: h.color }}>{it.tag}</span>
              </div>
            );
          })}
        </div>
      </div>
      </div>
      <div className="flex items-center justify-center gap-3 border-t border-rule px-3 py-2.5">
        {/* One dot per chapter; the real changelog has dozens, so they wrap rather than push the buttons out of reach. */}
        <button type="button" className={pager} disabled={index >= chapters.length - 1} onClick={() => onIndex(Math.min(chapters.length - 1, index + 1))}>
          <ArrowLeft size={12} aria-hidden />Older
        </button>
        <div className="flex min-w-0 flex-1 flex-wrap justify-center gap-[5px]" aria-hidden>
          {chapters.map((_, i) => <span key={i} data-on={i === index} className={clsx('h-[5px] w-[5px] rounded-full', i === index ? 'bg-accent' : 'bg-rule-2')} />)}
        </div>
        <button type="button" className={pager} disabled={index <= 0} onClick={() => onIndex(Math.max(0, index - 1))}>
          Newer<ArrowRight size={12} aria-hidden />
        </button>
      </div>
    </>
  );
}
