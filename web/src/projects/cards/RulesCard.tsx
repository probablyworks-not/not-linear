import { ScrollText } from 'lucide-react';
import { SectionCard } from './SectionCard';

export function RulesCard({ rules, editing, onEdit, onDraft, onFlush }: {
  rules: string; editing: boolean; onEdit(on: boolean): void; onDraft(v: string): void; onFlush(): void;
}) {
  const empty = !rules.trim() && !editing;
  return (
    <SectionCard
      accent="neutral" icon={<ScrollText size={16} aria-hidden />} label="Rules" empty={empty} span="col-span-2" testId="card-rules"
      action={!empty && !editing ? <button type="button" onClick={() => onEdit(true)} className="text-xs text-branch hover:underline">Edit</button> : undefined}
    >
      {editing ? (
        <>
          <textarea
            autoFocus rows={5} aria-label="Project rules" value={rules}
            placeholder="Custom instructions the AI follows for every chat in this project, e.g. 'Answer in British English. Always cite sources. Prefer TypeScript examples.'"
            onChange={e => onDraft(e.target.value)}
            onBlur={onFlush}
            className="w-full resize-y rounded-md border border-rule-2 bg-surface px-2.5 py-2 text-sm text-text placeholder:text-text-3 focus:border-text-2 focus:outline-none"
          />
          <div className="mt-1.5 flex items-center gap-2">
            <p className="flex-1 text-xs leading-normal text-text-3">Applied to every chat here, including branches.</p>
            <button type="button" onClick={() => { onFlush(); onEdit(false); }} className="text-xs text-branch hover:underline">Done</button>
          </div>
        </>
      ) : empty ? (
        <>
          <div className="text-xs leading-normal text-text-3">Instructions the AI follows in every chat here, e.g. “Always cite sources.”</div>
          <button type="button" onClick={() => onEdit(true)} className="mt-2 text-xs text-branch hover:underline">+ Add rules</button>
        </>
      ) : (
        <div data-testid="rules-text" className="line-clamp-6 whitespace-pre-wrap text-sm leading-normal text-text-2">{rules}</div>
      )}
    </SectionCard>
  );
}
