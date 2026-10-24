import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { Sparkles, X } from 'lucide-react';
import { flags } from '../flags';
import { resolvedSkills, useSkillsStore } from './skills-store';
import type { ResolvedSkill } from './types';

// The "/" picker shared by the main and branch composers. Typing "/" (or "/skills", "/pre…") opens a
// list; choosing one adds a chip that applies to THIS message only (it is cleared on send). Picked
// skills bypass the automatic selector's score, limit and budget.
//
// The list stays open after a pick ("sticky"), so several skills can be added in one go: ↑↓ browse,
// Enter/Tab adds, typing filters again, Escape closes. Typing in the textarea leaves sticky mode so
// the message itself is never filtered against the list.

export interface SkillPicker {
  picked: string[];
  /** Chips for the picked skills, to render above the textarea. */
  chips: ReactNode;
  /** The dropdown, to render inside a `position: relative` parent. */
  menu: ReactNode;
  /** Call first in the textarea's onKeyDown; true means the key was handled. */
  onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>, text: string): boolean;
  /** Call from the textarea's onChange. */
  onTextChange(): void;
  reset(): void;
  placeholder: string;
}

export function useSkillPicker(text: string, setText: (t: string) => void, input: RefObject<HTMLTextAreaElement | null>, basePlaceholder: string): SkillPicker {
  const [picked, setPicked] = useState<string[]>([]);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  // Held open after a pick, with no "/" token in the text, to add more skills.
  const [sticky, setSticky] = useState(false);
  const store = useSkillsStore();
  // A `/token` at the END of the text, at the start or after whitespace: works mid-message too ("…use this /skills").
  const slash = flags.skills ? /(?:^|\s)\/(\S*)$/.exec(text) : null;
  const query = slash?.[1];

  useEffect(() => { if (query !== undefined) void useSkillsStore.getState().load(); }, [query !== undefined]); // eslint-disable-line react-hooks/exhaustive-deps -- external sync with IndexedDB

  const matches = useMemo<ResolvedSkill[]>(() => {
    if (query === undefined && !sticky) return [];
    const raw = (query ?? '').toLowerCase();
    const needle = raw === 'skills' ? '' : raw;
    return resolvedSkills(store)
      .filter(s => !picked.includes(s.name) && `${s.name} ${s.description} ${s.keywords.join(' ')}`.toLowerCase().includes(needle))
      .sort((a, b) => Number(b.name.startsWith(needle)) - Number(a.name.startsWith(needle)))
  }, [query, sticky, store.overrides, store.custom, store.meta, picked]); // eslint-disable-line react-hooks/exhaustive-deps -- `store` itself changes every render
  // Sticky mode belongs to a focused composer: if focus leaves, the list should not hang around.
  useEffect(() => {
    const el = input.current;
    if (!el || !sticky) return;
    const onBlur = (): void => setSticky(false);
    el.addEventListener('blur', onBlur);
    return () => el.removeEventListener('blur', onBlur);
  }, [sticky]); // eslint-disable-line react-hooks/exhaustive-deps -- external sync with the DOM node
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => { listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [active, query]);
  const open = (query !== undefined || sticky) && !dismissed && matches.length > 0;

  const pick = (name: string): void => {
    setPicked(p => [...p, name]);
    // Drop only the trailing /token; whatever was typed before it stays.
    setText(text.replace(/(?:^|\s)\/\S*$/, '').replace(/\s+$/, ''));
    setActive(0);
    // Keep the list up for the next pick instead of making the user type "/" again.
    setSticky(true);
    setDismissed(false);
    input.current?.focus();
  };

  const chips = picked.length > 0 && (
    <div className="flex flex-wrap gap-1" data-testid="picked-skills">
      {picked.map(n => (
        <span key={n} className="flex items-center gap-1 rounded-md border border-rule-2 bg-bg-2 py-0.5 pl-1.5 pr-1 text-xs text-text-2">
          <Sparkles size={11} aria-hidden />{n}
          <button type="button" aria-label={`Remove skill ${n}`} onClick={() => setPicked(p => p.filter(x => x !== n))} className="grid h-4 w-4 place-items-center rounded hover:bg-bg-3"><X size={10} /></button>
        </span>
      ))}
    </div>
  );

  const menu = open && (
    <div ref={listRef} role="listbox" aria-label="Skills" className="absolute bottom-full left-0 right-0 z-20 mb-1.5 max-h-[55vh] overflow-y-auto rounded-lg border border-rule-2 bg-surface-2 p-1 shadow-lg">
      <div className="sticky top-0 bg-surface-2 px-2.5 pb-1 pt-1 text-xs text-text-3">{matches.length} skill{matches.length === 1 ? '' : 's'}{picked.length ? ` · ${picked.length} added` : ''} · ↑↓ to browse · Enter to add{picked.length ? ' another' : ''} · type to filter · Esc to close</div>
      {matches.map((s, i) => (
        <button
          key={s.name} type="button" role="option" aria-selected={i === active} data-skill-option={s.name}
          onMouseEnter={() => setActive(i)} onMouseDown={e => { e.preventDefault(); pick(s.name); }}
          className={`flex w-full flex-col rounded-sm px-2.5 py-1.5 text-left text-sm text-text ${i === active ? 'bg-bg-3' : ''}`}
        >
          <span>{s.name}<span className="ml-2 text-xs text-text-3">{s.layer}</span></span>
          <span className="truncate text-xs text-text-3">{s.description}</span>
        </button>
      ))}
    </div>
  );

  return {
    picked, chips, menu,
    placeholder: flags.skills ? `${basePlaceholder.replace(/…$/, '')}… (type / for skills)` : basePlaceholder,
    // Any edit of the textarea itself ends sticky mode: from here the "/" token rules again.
    onTextChange() { setActive(0); setDismissed(false); setSticky(false); },
    reset() { setPicked([]); setSticky(false); setDismissed(false); },
    onKeyDown(e, current) {
      if (open) {
        if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => (a + 1) % matches.length); return true; }
        if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => (a - 1 + matches.length) % matches.length); return true; }
        if ((e.key === 'Enter' || e.key === 'Tab') && !e.nativeEvent.isComposing) { e.preventDefault(); pick(matches[active]!.name); return true; }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setDismissed(true); setSticky(false); return true; }
        // Sticky mode has no "/" token, so re-create one from the first character typed: filtering
        // then works exactly as it does the first time round.
        if (sticky && query === undefined && e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
          if (e.key === ' ') { setSticky(false); return false; }
          e.preventDefault();
          setText(current ? `${current} /${e.key}` : `/${e.key}`);
          setSticky(false);
          return true;
        }
      }
      if (e.key === 'Backspace' && !current && picked.length) { setPicked(p => p.slice(0, -1)); return true; }
      return false;
    },
  };
}
