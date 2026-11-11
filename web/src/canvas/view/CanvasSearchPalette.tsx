import { useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { FileText, GitBranch, Search } from 'lucide-react';
import { clsx } from 'clsx';
import { useUiStore } from '../../state/ui-store';
import { ESC_PRIORITY, useEscLayer } from '../../lib/keyboard';
import { enterTarget, filterItems, moveActive, splitHighlight } from '../../search/palette';
import { useCanvasDoc } from '../canvas-doc-store';
import { canvasSearchItems, type CanvasSearchItem } from '../search';
import { focusCanvasThread, openCanvasOutputDetail } from './canvas-bridge';

/**
 * UI-08. The chat palette (`search/SearchPalette.tsx`) only ever searched threads; it has no
 * concept of a canvas thread or a reply inside one. Rather than teach it a second content model,
 * this is the canvas's own palette, mounted in its place while a canvas tab is active (AppShell) —
 * same `⌘K`, same shell conventions, canvas-shaped results.
 */
export function CanvasSearchPalette({ canvasId }: { canvasId: string }) {
  const open = useUiStore(s => s.searchOpen);
  const setOpen = useUiStore(s => s.setSearchOpen);
  const close = (): void => setOpen(false);
  useEscLayer('search', ESC_PRIORITY.searchPalette, open, close);

  return (
    <Dialog.Root open={open} onOpenChange={o => { if (!o) close(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[200] bg-scrim" />
        <Dialog.Content
          aria-label="Search this canvas" aria-describedby={undefined}
          onEscapeKeyDown={e => e.preventDefault()}
          className="fixed left-1/2 top-[18vh] z-[201] w-[min(560px,92vw)] -translate-x-1/2 overflow-hidden rounded-xl border border-rule bg-bg shadow-lg"
        >
          <Dialog.Title className="sr-only">Search this canvas</Dialog.Title>
          <PaletteBody
            canvasId={canvasId}
            onPick={item => {
              close();
              if (item.kind === 'message' && item.messageId) openCanvasOutputDetail(canvasId, item.messageId);
              else focusCanvasThread(canvasId, item.threadId);
            }}
          />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** C8. 'all' shows everything; the others narrow by what the item actually is — a root
 * conversation, a branch/synthesis thread, or a reply within either. */
type ResultFilter = 'all' | 'threads' | 'branches' | 'replies';
const FILTERS: { id: ResultFilter; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'threads', label: 'Threads' },
  { id: 'branches', label: 'Branches' }, { id: 'replies', label: 'Replies' },
];
function matchesFilter(item: CanvasSearchItem, f: ResultFilter): boolean {
  if (f === 'all') return true;
  if (f === 'replies') return item.kind === 'message';
  if (item.kind !== 'thread') return false;
  return f === 'threads' ? item.threadKind === 'root' : item.threadKind !== 'root';
}

function PaletteBody({ canvasId, onPick }: { canvasId: string; onPick(item: CanvasSearchItem): void }) {
  const doc = useCanvasDoc(s => (s.canvasId === canvasId ? s.doc : null));
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const [filter, setFilter] = useState<ResultFilter>('all');
  const listRef = useRef<HTMLDivElement>(null);

  const all = useMemo(() => (doc ? canvasSearchItems(doc) : []), [doc]);
  const filtered = useMemo(() => all.filter(i => matchesFilter(i, filter)), [all, filter]);
  const items = useMemo(() => filterItems(filtered, query), [filtered, query]);

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
      if (target) onPick(target);
    }
  };

  const q = query.trim();
  const threadResults = items.filter(i => i.kind === 'thread');
  const messageResults = items.filter(i => i.kind === 'message');

  return (
    <>
      <div className="flex items-center gap-2.5 border-b border-rule px-3.5 py-3">
        <Search size={16} className="flex-none text-text-3" aria-hidden />
        <input
          autoFocus autoComplete="off" spellCheck={false} role="combobox" aria-expanded aria-controls="canvas-search-results"
          aria-label="Search threads and replies" aria-activedescendant={active >= 0 ? `canvas-search-opt-${active}` : undefined}
          placeholder="Search threads and replies…" value={query}
          onChange={e => { setQuery(e.target.value); setActive(-1); }}
          onKeyDown={onKeyDown}
          className="flex-1 border-none bg-transparent text-base leading-snug text-text outline-none placeholder:text-text-3"
        />
      </div>
      <div data-testid="canvas-search-filters" className="flex gap-1.5 border-b border-rule px-3.5 py-2">
        {FILTERS.map(f => (
          <button
            key={f.id} type="button" aria-pressed={filter === f.id}
            onClick={() => { setFilter(f.id); setActive(-1); }}
            className={clsx(
              'rounded-full border px-2.5 py-1 font-mono text-xs',
              filter === f.id ? 'border-accent bg-bg-2 text-text' : 'border-rule-2 text-text-3 hover:text-text-2',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div id="canvas-search-results" ref={listRef} role="listbox" className="max-h-[min(360px,55vh)] overflow-y-auto">
        {items.length === 0 ? (
          <div className="px-4 py-5 text-center text-sm text-text-3">{q ? `No results for "${q}"` : 'No threads or replies yet'}</div>
        ) : (
          <>
            {threadResults.length > 0 && (
              <ResultGroup label="Threads" items={threadResults} items0={items} active={active} q={q} onPick={onPick} setActive={setActive} Icon={FileText} />
            )}
            {messageResults.length > 0 && (
              <ResultGroup label="Replies" items={messageResults} items0={items} active={active} q={q} onPick={onPick} setActive={setActive} Icon={GitBranch} />
            )}
          </>
        )}
      </div>
    </>
  );
}

function ResultGroup({ label, items, items0, active, q, onPick, setActive, Icon }: {
  label: string;
  items: CanvasSearchItem[];
  items0: CanvasSearchItem[];
  active: number;
  q: string;
  onPick(item: CanvasSearchItem): void;
  setActive(fn: (a: number) => number): void;
  Icon: typeof FileText;
}) {
  return (
    <>
      <div className="px-3.5 pb-1 pt-2 font-mono text-xs uppercase tracking-widest text-text-3">{label}</div>
      {items.map(item => {
        const i = items0.indexOf(item);
        const h = splitHighlight(item.title, q);
        return (
          <div
            key={`${item.kind}-${item.messageId ?? item.threadId}`} id={`canvas-search-opt-${i}`} role="option" aria-selected={i === active}
            onClick={() => onPick(item)} onMouseEnter={() => setActive(() => i)}
            className={clsx(
              'flex cursor-pointer items-start gap-2.5 px-3.5 py-2 text-sm leading-tight',
              i === active ? 'bg-bg-2 text-text' : 'text-text-2',
            )}
          >
            <Icon size={14} className="mt-0.5 flex-none" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="truncate">
                {h.before}{h.match && <mark className="bg-transparent font-semibold text-accent">{h.match}</mark>}{h.after}
              </div>
              {item.sub && <div className="truncate text-xs text-text-3">{item.sub}</div>}
            </div>
          </div>
        );
      })}
    </>
  );
}
