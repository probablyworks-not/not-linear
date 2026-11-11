import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useUiStore } from '../../state/ui-store';

/** The top of a drill-in: back link to the overview, section icon + title + count + subtitle, and the section's actions. */
export function ViewHeader({ projectName, icon, title, count, subtitle, actions }: {
  projectName: string; icon: ReactNode; title: string; count: number; subtitle: string; actions?: ReactNode;
}) {
  const setView = useUiStore(s => s.setProjectView);
  return (
    <>
      <button type="button" onClick={() => setView('overview')} className="mb-4 flex w-fit items-center gap-1.5 text-sm text-text-3 hover:text-text">
        <ArrowLeft size={13} aria-hidden />{projectName || 'Project'}
      </button>
      <div className="mb-5 flex flex-wrap items-center gap-3.5">
        <span className="grid h-12 w-12 flex-none place-items-center rounded-[13px] border border-rule bg-surface">{icon}</span>
        <div className="min-w-[200px] flex-1">
          <h2 className="m-0 text-[26px] font-semibold leading-tight tracking-tight text-text">{title} <span className="font-medium text-text-3">{count}</span></h2>
          <div className="text-sm text-text-3">{subtitle}</div>
        </div>
        {actions}
      </div>
    </>
  );
}

export function FilterPills<T extends string>({ value, options, onChange }: {
  value: T; options: ReadonlyArray<{ id: T; label: string; count: number }>; onChange(v: T): void;
}) {
  return (
    <div className="mb-4 flex flex-wrap gap-1.5" role="tablist">
      {options.map(o => (
        <button
          key={o.id} type="button" role="tab" aria-selected={value === o.id} onClick={() => onChange(o.id)}
          className={`flex h-[30px] items-center rounded-full border px-3 text-xs ${value === o.id ? 'border-text bg-text text-bg' : 'border-rule bg-surface text-text-2 hover:text-text'}`}
        >
          {o.label} {o.count}
        </button>
      ))}
    </div>
  );
}

export const headerBtn = 'h-[38px] rounded-[10px] border px-3.5 text-sm whitespace-nowrap';
export const headerGhost = `${headerBtn} border-rule-2 bg-surface text-text-2 hover:text-text`;
export const headerPrimary = `${headerBtn} border-text bg-text text-bg`;
