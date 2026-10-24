import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ESC_PRIORITY, useEscLayer } from '../lib/keyboard';

export interface PopMenuItem { label: string; icon?: ReactNode; danger?: boolean; onSelect(): void }

/** A small dropdown for the project header's `+` and `…` buttons. Closes on pick, Esc or an outside click. */
export function PopMenu({ label, trigger, items }: { label: string; trigger: ReactNode; items: PopMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEscLayer(`popmenu-${label}`, ESC_PRIORITY.glyphPicker, open, () => setOpen(false));

  useEffect(() => {
    if (!open) return undefined;
    const down = (e: MouseEvent): void => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', down);
    return () => document.removeEventListener('mousedown', down);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}
        className="grid h-10 w-10 place-items-center rounded-[10px] border border-rule-2 bg-surface text-text-2 hover:border-text-3 hover:text-text"
      >
        {trigger}
      </button>
      {open && (
        <div role="menu" aria-label={label} className="absolute right-0 z-20 mt-1.5 min-w-[190px] rounded-lg border border-rule-2 bg-surface p-1 shadow-md">
          {items.map(it => (
            <button
              key={it.label} type="button" role="menuitem" onClick={() => { setOpen(false); it.onSelect(); }}
              className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-bg-2 ${it.danger ? 'text-danger' : 'text-text-2 hover:text-text'}`}
            >
              {it.icon}<span>{it.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
