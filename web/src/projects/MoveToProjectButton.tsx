import { useEffect, useRef, useState } from 'react';
import { Check, FolderInput } from 'lucide-react';
import { useAppStore } from '../state/app-store';
import { projectList } from '../db/project-ops';

const ICON_BTN = 'grid h-6 w-6 flex-none place-items-center rounded-[5px] text-text-3 hover:bg-bg-3 hover:text-text';

/** A folder button that lists the projects (and "No project") to file a chat or note in. */
export function MoveToProjectButton({ label, current, onMove, className = ICON_BTN }: {
  label: string;
  current: string | undefined;
  onMove: (pid: string | null) => void;
  className?: string;
}) {
  const projects = useAppStore(s => s.projects);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const list = projectList({ projects });

  // Closing on an outside click is syncing with the document, which is what an effect is for.
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc, true);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc, true); };
  }, [open]);

  const item = 'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-text-2 hover:bg-bg-2 hover:text-text';
  const pick = (pid: string | null) => { setOpen(false); if ((current ?? null) !== pid) onMove(pid); };

  return (
    <span ref={ref} className="relative flex-none">
      <button type="button" title="Move to project" aria-label={label} aria-expanded={open} className={className} onClick={e => { e.stopPropagation(); setOpen(o => !o); }}>
        <FolderInput size={13} />
      </button>
      {open && (
        <div role="menu" aria-label="Move to project" className="absolute right-0 top-full z-50 mt-1 max-h-60 w-48 overflow-y-auto rounded-lg border border-rule bg-surface p-1 shadow-md">
          {list.length === 0 && <div className="px-2 py-1.5 text-sm text-text-3">No projects yet.</div>}
          {list.map(p => (
            <button key={p.id} type="button" role="menuitem" data-project-option={p.id} className={item} onClick={() => pick(p.id)}>
              <span className="min-w-0 flex-1 truncate">{p.name || 'Untitled project'}</span>
              {current === p.id && <Check size={12} aria-hidden />}
            </button>
          ))}
          {current && projects[current] && (
            <button type="button" role="menuitem" data-project-option="none" className={`${item} mt-1 border-t border-rule`} onClick={() => pick(null)}>No project</button>
          )}
        </div>
      )}
    </span>
  );
}
