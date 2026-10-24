import { Shapes } from 'lucide-react';
import { useUiStore } from '../../state/ui-store';
import { ArtifactThumb } from '../ArtifactThumb';
import type { ProjectArtifact } from '../extras/types';
import { filterArtifacts } from '../project-summary';
import { EmptyBody, SectionCard } from './SectionCard';

export function ArtifactsCard({ artifacts, error }: { artifacts: ProjectArtifact[]; error?: string }) {
  const setView = useUiStore(s => s.setProjectView);
  const empty = artifacts.length === 0;
  return (
    <SectionCard
      accent="artifacts" icon={<Shapes size={16} aria-hidden />} label="AI artifacts" count={artifacts.length} empty={empty} span="col-span-3" testId="card-artifacts"
      onHeader={() => setView('artifacts')}
    >
      {error ? (
        <div role="alert" className="rounded-lg border border-danger-border bg-danger-soft p-2.5 text-xs text-danger">Could not load artifacts: {error}</div>
      ) : empty ? (
        <EmptyBody accent="artifacts" icon={<Shapes size={24} aria-hidden />} title="Nothing generated yet" hint="Documents, diagrams and code the AI creates in your chats will be collected here." />
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {filterArtifacts(artifacts, 'all').slice(0, 3).map(a => (
            <button key={a.id} type="button" data-artifact={a.id} onClick={() => setView('artifacts')} className="text-left">
              <ArtifactThumb artifact={a} className="h-[78px] rounded-[9px]" />
              <div className="mt-1.5 truncate text-xs text-text">{a.title}{a.version > 1 ? ` v${a.version}` : ''}</div>
            </button>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
