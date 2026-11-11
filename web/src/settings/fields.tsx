import { clsx } from 'clsx';
import type { ReactNode } from 'react';
import type { Choice } from './options';

// Small presentational pieces shared by the Settings sections. Styling is
// Tailwind token classes only.

export const INPUT = 'w-full rounded-md border border-rule-2 bg-surface px-2.5 py-2 text-sm text-text placeholder:text-text-3 focus:border-text-2 focus:outline-none';

export function Section({ label, help, children }: { label: string; help?: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-[22px]">
      <div className="mb-2 font-mono text-xs uppercase tracking-widest text-text-3">{label}</div>
      {children}
      {help && <p className="mt-1.5 text-xs leading-normal text-text-3">{help}</p>}
    </section>
  );
}

/** A single-choice group of titled buttons. `columns` is the grid width. */
export function Segmented({ value, choices, onChange, label, columns = 3 }: {
  value: string; choices: readonly Choice[]; onChange(id: string): void; label: string; columns?: 2 | 3;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={clsx('grid gap-1.5', columns === 3 ? 'grid-cols-3' : 'grid-cols-2')}>
      {choices.map(c => {
        const on = c.id === value;
        return (
          <button
            key={c.id} type="button" role="radio" aria-checked={on} onClick={() => onChange(c.id)}
            className={clsx(
              'rounded-lg border px-2.5 py-2 text-left text-xs leading-snug',
              on ? 'border-text-2 bg-bg-2 text-text' : 'border-rule-2 text-text-3 hover:border-text-3 hover:text-text-2',
            )}
          >
            <span className="block text-sm font-medium text-text">{c.label}</span>
            {c.blurb}
          </button>
        );
      })}
    </div>
  );
}
