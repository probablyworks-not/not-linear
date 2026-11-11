import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { clsx } from 'clsx';

// A sidebar section whose header folds it away (app.js wireSidebarCollapse). Which sections are
// folded is kept in `localStorage.nl_side_collapsed_v1` as { <section>: true }, a key BOTH apps
// read and write, so it is merged with what is stored rather than written from a stale copy.

const KEY = 'nl_side_collapsed_v1';

function readFolded(): Record<string, boolean> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, boolean> : {};
  } catch { return {}; }
}

function writeFolded(section: string, folded: boolean): void {
  const all = readFolded();
  all[section] = folded;
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* storage blocked: it just will not be remembered */ }
}

export function SidebarSection({ section, label, actions, children }: {
  /** The key legacy uses for this section: 'projects', 'threads', 'recent'. */
  section: string;
  label: string;
  /** Buttons at the right of the header, which do not fold it. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  const [folded, setFolded] = useState(() => !!readFolded()[section]);
  return (
    <>
      <div className="mx-2 mb-1 mt-3.5 flex items-center justify-between font-mono text-xs uppercase tracking-widest text-text-3">
        <button
          type="button" aria-expanded={!folded} data-section={section}
          onClick={() => { const next = !folded; writeFolded(section, next); setFolded(next); }}
          className="inline-flex flex-1 select-none items-center text-left uppercase tracking-widest hover:text-text-2"
        >
          <ChevronDown size={11} className={clsx('mr-1 transition-transform duration-[140ms]', folded && '-rotate-90')} aria-hidden />
          {label}
        </button>
        {actions && <span className="flex gap-0.5">{actions}</span>}
      </div>
      <div hidden={folded}>{children}</div>
    </>
  );
}
