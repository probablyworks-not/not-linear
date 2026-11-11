import { useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { FileText, Search } from 'lucide-react';
import { clsx } from 'clsx';
import { useAppStore } from '../state/app-store';
import { useUiStore } from '../state/ui-store';
import { selectThread } from '../state/actions';
import { ESC_PRIORITY, useEscLayer } from '../lib/keyboard';
import { MAIN_THREAD_ID, visibleThreads } from '../db/thread-ops';
import {
  EMPTY_NO_ITEMS, SEARCH_PLACEHOLDER, emptyForQuery, enterTarget, filterItems, moveActive, splitHighlight,
  type SearchItem,
} from './palette';

/**
 * Quick-open over threads (⌘K / Ctrl+K), ported from the legacy palette.
 * Branch results arrive with the branch system in P5b; this list is where
 * they will be merged in.
 */
export function SearchPalette() {
  const open = useUiStore(s => s.searchOpen);
  const setOpen = useUiStore(s => s.setSearchOpen);
  const close = (): void => setOpen(false);
  useEscLayer('search', ESC_PRIORITY.searchPalette, open, close);

  return (
    <Dialog.Root open={open} onOpenChange={o => { if (!o) close(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[200] bg-scrim" />
        <Dialog.Content
          aria-label="Search" aria-describedby={undefined}
          onEscapeKeyDown={e => e.preventDefault()}
          className="fixed left-1/2 top-[18vh] z-[201] w-[min(560px,92vw)] -translate-x-1/2 overflow-hidden rounded-xl border border-rule bg-bg shadow-lg"
        >
          <Dialog.Title className="sr-only">Search</Dialog.Title>
          <PaletteBody onPick={tid => { close(); void selectThread(tid); }} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Mounted only while open, so the query and highlight reset on every open (as legacy's openSearch does). */
function PaletteBody({ onPick }: { onPick(tid: string): void }) {
  const threadState = useAppStore(s => s.threadState);
  const dynamic = useAppStore(s => s.dynamicThreads);
  const deleted = useAppStore(s => s.deletedThreadIds);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const listRef = useRef<HTMLDivElement>(null);

  const all = useMemo<SearchItem[]>(
    () => visibleThreads({
      threads: threadState, dynamic, deletedThreads: deleted,
      current: MAIN_THREAD_ID, chatCount: 1, projects: {}, projectCount: 1, prefs: {},
    }).map(r => ({ kind: 'thread', tid: r.id, title: r.title })),
    [threadState, dynamic, deleted],
  );
  const items = useMemo(() => filterItems(all, query), [all, query]);

  // Keep the highlighted row in view while arrowing. Syncs with the DOM, which is what an effect is for.
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setActive(a => moveActive(a, e.key as 'ArrowDown' | 'ArrowUp', items.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = enterTarget(items, active);
      if (target) onPick(target.tid);
    }
  };

  const q = query.trim();
  return (
    <>
      <div className="flex items-center gap-2.5 border-b border-rule px-3.5 py-3">
        <Search size={16} className="flex-none text-text-3" aria-hidden />
        <input
          autoFocus autoComplete="off" spellCheck={false} role="combobox" aria-expanded aria-controls="search-results"
          aria-label="Search threads" aria-activedescendant={active >= 0 ? `search-opt-${active}` : undefined}
          placeholder={SEARCH_PLACEHOLDER} value={query}
          onChange={e => { setQuery(e.target.value); setActive(-1); }}
          onKeyDown={onKeyDown}
          className="flex-1 border-none bg-transparent text-base leading-snug text-text outline-none placeholder:text-text-3"
        />
      </div>
      <div id="search-results" ref={listRef} role="listbox" className="max-h-[min(360px,55vh)] overflow-y-auto">
        {items.length === 0 ? (
          <div className="px-4 py-5 text-center text-sm text-text-3">{q ? emptyForQuery(q) : EMPTY_NO_ITEMS}</div>
        ) : (
          <>
            <div className="px-3.5 pb-1 pt-2 font-mono text-xs uppercase tracking-widest text-text-3">Threads</div>
            {items.map((item, i) => {
              const h = splitHighlight(item.title, q);
              return (
                <div
                  key={item.tid} id={`search-opt-${i}`} role="option" aria-selected={i === active} data-tid={item.tid}
                  onClick={() => onPick(item.tid)} onMouseEnter={() => setActive(i)}
                  className={clsx(
                    'flex cursor-pointer items-center gap-2.5 px-3.5 py-2 text-sm leading-tight',
                    i === active ? 'bg-bg-2 text-text' : 'text-text-2',
                  )}
                >
                  <FileText size={14} className="flex-none" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">
                    {h.before}{h.match && <mark className="bg-transparent font-semibold text-accent">{h.match}</mark>}{h.after}
                  </span>
                </div>
              );
            })}
          </>
        )}
      </div>
    </>
  );
}
