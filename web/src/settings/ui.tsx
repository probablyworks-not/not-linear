import { clsx } from 'clsx';
import type { ReactNode } from 'react';

// Small pieces shared by the Settings tabs. Token classes only.

const BASE_BTN = 'inline-flex h-[34px] flex-none items-center gap-1.5 whitespace-nowrap rounded-[9px] border text-sm disabled:cursor-default disabled:opacity-40';
export const BTN = `${BASE_BTN} border-rule-2 bg-surface px-3 text-text-2 hover:bg-bg-2 hover:text-text`;
export const BTN_PRIMARY = `${BASE_BTN} border-text bg-text px-3.5 text-bg hover:opacity-90`;
export const BTN_DANGER = `${BASE_BTN} border-danger-border bg-surface px-3 text-danger hover:bg-danger-soft`;
export const ICON_BTN = 'grid h-8 w-8 flex-none place-items-center rounded-lg border border-rule-2 bg-surface text-text-2 hover:bg-bg-2 hover:text-text';

/** 34x20 switch. `label` is the accessible name. */
export function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange(next: boolean): void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled}
      onClick={e => { e.stopPropagation(); onChange(!on); }}
      className={clsx(
        'relative h-5 w-[34px] flex-none rounded-full border border-rule-2 transition-colors duration-150 disabled:opacity-40',
        on ? 'border-text bg-text' : 'bg-bg-3',
      )}
    >
      <span className={clsx('absolute left-px top-px h-4 w-4 rounded-full bg-bg shadow-md transition-transform duration-150', on && 'translate-x-3.5')} />
    </button>
  );
}

export function Pill({ on, children }: { on: boolean; children: ReactNode }) {
  return (
    <span className={clsx('inline-flex flex-none items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs', on ? 'bg-bg-3 text-success' : 'bg-bg-2 text-text-3')}>
      <span aria-hidden className={clsx('h-1.5 w-1.5 rounded-full', on ? 'bg-success' : 'bg-text-3')} />
      {children}
    </span>
  );
}

/** Marks a surface whose controls work locally but are not wired to anything yet. */
export function PreviewBadge() {
  return <span className="flex-none rounded-md border border-rule-2 px-1.5 py-px font-mono text-xs uppercase tracking-widest text-text-3">Preview</span>;
}

export function EmptyState({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-rule-2 px-6 py-10 text-center" data-testid="empty-state">
      <div className="grid h-10 w-10 place-items-center rounded-xl bg-bg-2 text-text-3" aria-hidden>{icon}</div>
      <div className="text-base font-semibold text-text">{title}</div>
      {children && <p className="m-0 max-w-sm text-sm leading-normal text-text-3">{children}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

/** Segmented sub-tabs with a count, used for Integrations and the log filter. */
export function SubTabs<T extends string>({ value, items, onChange, label }: {
  value: T; items: ReadonlyArray<{ id: T; label: string; count?: number }>; onChange(id: T): void; label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 rounded-[11px] bg-bg-2 p-1">
      {items.map(it => (
        <button
          key={it.id} type="button" role="tab" aria-selected={it.id === value} onClick={() => onChange(it.id)}
          className={clsx('h-8 rounded-lg px-3.5 text-sm font-medium', it.id === value ? 'bg-surface text-text shadow-md' : 'text-text-2 hover:text-text')}
        >
          {it.label}
          {it.count !== undefined && <span className="ml-2 font-mono text-xs opacity-60">{it.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function PageBody({ children, max = 1000 }: { children: ReactNode; max?: 760 | 1000 }) {
  return <div className={clsx('mx-auto w-full px-9 pb-10 pt-7', max === 760 ? 'max-w-[760px]' : 'max-w-[1000px]')}>{children}</div>;
}
