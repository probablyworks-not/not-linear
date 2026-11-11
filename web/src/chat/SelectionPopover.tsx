import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { GitBranch, Highlighter, Sparkles } from 'lucide-react';
import { readSelection, type SelectionInfo } from './selection';
import { branchFromSelection, saveHighlight } from './marking';
import { ESC_PRIORITY, useEscLayer } from '../lib/keyboard';

interface Props {
  threadId: string;
  threadTitle: string;
  /** "Ask" from the popover: an inline question about the selected passage. */
  onAsk(text: string): void;
}

const EDGE = 8;

/**
 * The floating Branch / Highlight / Ask toolbar over a text selection (app.js:2962). It
 * follows the selection, flips below it if there is no room above, and B is the keyboard
 * shortcut for Branch while it is showing. Legacy also draws bold, italic and link buttons
 * that do nothing; they are not drawn here.
 */
export function SelectionPopover({ threadId, threadTitle, onAsk }: Props) {
  const [sel, setSel] = useState<SelectionInfo | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  const hide = useCallback(() => setSel(null), []);

  // Syncing with the browser's selection, an external system.
  useEffect(() => {
    const onChange = (): void => {
      const info = readSelection();
      if (!info) { setSel(null); return; }
      const r = info.range.getBoundingClientRect();
      setSel(r.width === 0 && r.height === 0 ? null : info);
    };
    document.addEventListener('selectionchange', onChange);
    return () => document.removeEventListener('selectionchange', onChange);
  }, []);

  // Placement needs the popover's own size, so it runs after layout, before paint.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!sel || !el) return;
    const r = sel.range.getBoundingClientRect();
    const pw = el.offsetWidth;
    const ph = el.offsetHeight;
    const left = Math.max(EDGE, Math.min(r.left + r.width / 2 - pw / 2, window.innerWidth - pw - EDGE));
    let top = r.top - ph - 10;
    if (top < EDGE) top = r.bottom + 10;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  }, [sel]);

  const branch = useCallback((): void => {
    if (sel) void branchFromSelection(threadId, sel);
    setSel(null);
  }, [sel, threadId]);

  useEffect(() => {
    if (!sel) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'b' || e.metaKey || e.ctrlKey || e.altKey) return;
      // As in legacy there is no focus check for the composer: a selection that makes the popover show
      // has already taken the selection (and, with a real drag, the focus) out of any text field. The
      // title is the one editable thing a B should still type into.
      if ((e.target as HTMLElement | null)?.isContentEditable) return;
      e.preventDefault();
      branch();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [sel, branch]);

  useEscLayer('selectionPopover', ESC_PRIORITY.selectionPopover, !!sel, hide);

  if (!sel) return null;
  const btn = 'inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-sm text-text hover:bg-bg-3';
  return (
    <div
      ref={ref} role="toolbar" aria-label="Selection actions" data-testid="selection-popover"
      // Keep the selection: a mousedown on a button would otherwise clear it before the click lands.
      onMouseDown={e => e.preventDefault()}
      className="fixed z-[200] inline-flex items-center gap-px rounded-lg border border-rule-2 bg-surface-2 p-1 shadow-lg"
    >
      <button type="button" onClick={branch} className="inline-flex items-center gap-1.5 rounded-sm bg-accent px-2.5 py-1.5 text-sm font-medium text-bg hover:bg-accent-2">
        <GitBranch size={14} /> Branch <kbd className="ml-1 rounded-sm bg-kbd-bg px-1.5 font-mono text-xs text-kbd-fg">B</kbd>
      </button>
      <span className="mx-0.5 h-[18px] w-px bg-rule-2" />
      <button
        type="button" title="Save highlight" aria-label="Save highlight" className={btn}
        onClick={() => { void saveHighlight(threadId, threadTitle, sel); setSel(null); }}
      >
        <Highlighter size={14} />
      </button>
      <span className="mx-0.5 h-[18px] w-px bg-rule-2" />
      <button
        type="button" title="Ask AI inline" aria-label="Ask AI inline" className={btn}
        onClick={() => { const text = sel.text; window.getSelection()?.removeAllRanges(); setSel(null); onAsk(text); }}
      >
        <Sparkles size={14} />
      </button>
    </div>
  );
}
