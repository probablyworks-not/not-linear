import { Brain, X } from 'lucide-react';
import { flags } from '../../flags';
import type { ProjectMemoryItem } from '../extras/types';
import { EmptyBody, SectionCard } from './SectionCard';

/** Memory: decisions and preferences the AI keeps across a project's chats. Shows "Soon" until `flags.projectMemory` is on. */
export function MemoryCard({ items, error, onRemove }: { items: ProjectMemoryItem[]; error?: string; onRemove?(id: string): void }) {
  const soon = !flags.projectMemory;
  return (
    <SectionCard
      accent="artifacts" icon={<Brain size={16} aria-hidden />} label="Memory" count={soon ? undefined : items.length}
      empty={!soon && items.length === 0} tinted={soon} span="col-span-2" testId="card-memory"
      action={soon ? <span className="rounded-full bg-sec-artifacts-line px-[7px] py-0.5 font-mono text-xs uppercase tracking-wider text-sec-artifacts">Soon</span> : undefined}
    >
      {soon ? (
        <div className="text-xs leading-normal text-text-2">Decisions and preferences the AI keeps across chats and branches.</div>
      ) : error ? (
        <div role="alert" className="rounded-lg border border-danger-border bg-danger-soft p-2.5 text-xs text-danger">Could not load memory: {error}</div>
      ) : items.length === 0 ? (
        <EmptyBody accent="artifacts" icon={<Brain size={24} aria-hidden />} title="Nothing remembered yet" hint="Decisions and preferences the AI picks up will be kept here." />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {items.slice(0, 4).map(m => (
            <li key={m.id} data-memory={m.id} className="group flex items-start gap-1.5 text-xs leading-normal text-text-2">
              <span className="min-w-0 flex-1">{m.text}</span>
              {onRemove && (
                <button type="button" aria-label="Forget this" title="Forget this" onClick={() => onRemove(m.id)} className="grid h-5 w-5 flex-none place-items-center rounded text-text-3 opacity-0 hover:bg-bg-3 focus-visible:opacity-100 group-hover:opacity-100"><X size={12} /></button>
              )}
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
