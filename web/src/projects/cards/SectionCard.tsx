import type { ReactNode } from 'react';

export type Accent = 'neutral' | 'notes' | 'artifacts' | 'files' | 'canvas';

const TEXT: Record<Accent, string> = { neutral: 'text-text-2', notes: 'text-sec-notes', artifacts: 'text-sec-artifacts', files: 'text-sec-files', canvas: 'text-sec-canvas' };

/**
 * The frame every overview card shares: a mono header (icon, label, count, optional right-hand action) and a body.
 * Filled cards are solid; empty ones are transparent with a dashed border, as in the handoff. A `onHeader` makes
 * the header a button that drills into the section.
 */
export function SectionCard({ accent, icon, label, count, empty, tinted, span, testId, onHeader, action, children }: {
  accent: Accent; icon: ReactNode; label: string; count?: number; empty?: boolean; tinted?: boolean;
  span: string; testId: string; onHeader?(): void; action?: ReactNode; children: ReactNode;
}) {
  const frame = tinted ? 'border border-dashed border-sec-artifacts-line bg-sec-artifacts-soft'
    : empty ? 'border border-dashed border-rule-2 bg-transparent' : 'border border-rule bg-surface';
  const head = (
    <>
      <span className={`grid place-items-center ${TEXT[accent]}`}>{icon}</span>
      <span className="font-mono text-xs uppercase tracking-widest text-text-3">{label}{count !== undefined ? ` · ${count}` : ''}</span>
    </>
  );
  return (
    <section data-testid={testId} data-empty={empty ? 'true' : 'false'} className={`${span} rounded-[14px] p-4 ${frame}`}>
      <div className="mb-2.5 flex items-center gap-2">
        {onHeader
          ? <button type="button" onClick={onHeader} aria-label={`Open ${label}`} className="flex items-center gap-2 text-left">{head}</button>
          : <div className="flex items-center gap-2">{head}</div>}
        <span className="flex-1" />
        {action}
      </div>
      {children}
    </section>
  );
}

/** The centred "nothing here yet" body the empty cards share. */
export function EmptyBody({ accent, icon, title, hint, children }: { accent: Accent; icon: ReactNode; title: string; hint: string; children?: ReactNode }) {
  const wash = accent === 'notes' ? 'bg-sec-notes-soft' : accent === 'artifacts' ? 'bg-sec-artifacts-soft'
    : accent === 'files' ? 'bg-sec-files-soft' : accent === 'canvas' ? 'bg-sec-canvas-soft' : 'bg-bg-2';
  return (
    <div className="flex flex-col items-center gap-1 px-2 pb-1.5 pt-3.5 text-center">
      <span className={`mb-1 grid h-11 w-11 place-items-center rounded-xl ${wash} ${TEXT[accent]}`}>{icon}</span>
      <div className="text-base font-semibold text-text">{title}</div>
      <div className="max-w-[260px] text-xs leading-normal text-text-3">{hint}</div>
      {children && <div className="mt-2.5 flex gap-1.5">{children}</div>}
    </div>
  );
}
