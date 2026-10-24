import { useState } from 'react';
import { FileText, MessageSquare, Shapes } from 'lucide-react';
import { openNote } from '../../notes/open-note';
import { toast } from 'sonner';
import { getProjectSources } from '../extras/sources';
import { ARTIFACT_KIND, type ProjectArtifact } from '../extras/types';
import { ArtifactThumb } from '../ArtifactThumb';
import { filterArtifacts, shortTime, type ArtifactFilter } from '../project-summary';
import { openProjectChat } from '../../state/actions';
import { useAppStore } from '../../state/app-store';
import { EmptyBody } from '../cards/SectionCard';
import { FilterPills, headerGhost, ViewHeader } from './ViewHeader';
import { ArtifactDetail } from './ArtifactDetail';

/** The AI artifacts drill-in. Renders whatever the ArtifactSource returns; with the default empty source it is the empty state. */
export function ArtifactsView({ pid, projectName, artifacts }: { pid: string; projectName: string; artifacts: ProjectArtifact[] }) {
  const [filter, setFilter] = useState<ArtifactFilter>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const threads = useAppStore(s => s.threadState);
  const shown = filterArtifacts(artifacts, filter);
  const n = (k: ArtifactFilter): number => (k === 'all' ? artifacts.length : artifacts.filter(a => ARTIFACT_KIND[a.type] === k).length);
  const exportAll = async (): Promise<void> => {
    const fn = getProjectSources().artifacts.exportAll;
    if (!fn) { toast('Export is not available yet'); return; }
    try { await fn(pid); } catch (e) { toast.error(`Could not export: ${e instanceof Error ? e.message : String(e)}`); }
  };
  if (openId) return <ArtifactDetail pid={pid} id={openId} onBack={() => setOpenId(null)} />;
  return (
    <div data-testid="artifacts-view">
      <ViewHeader
        projectName={projectName} icon={<Shapes size={22} aria-hidden className="text-sec-artifacts" />}
        title="AI artifacts" count={artifacts.length} subtitle="Everything the AI generated in this project, versioned and linked to its chat"
        actions={<button type="button" className={`${headerGhost} disabled:opacity-50`} disabled={artifacts.length === 0} onClick={() => { void exportAll(); }}>Export all</button>}
      />
      {artifacts.length > 0 && (
        <FilterPills<ArtifactFilter> value={filter} onChange={setFilter} options={[
          { id: 'all', label: 'All', count: n('all') }, { id: 'document', label: 'Documents', count: n('document') },
          { id: 'diagram', label: 'Diagrams', count: n('diagram') }, { id: 'code', label: 'Code', count: n('code') },
        ]} />
      )}
      {artifacts.length === 0 ? (
        <div className="rounded-[14px] border border-dashed border-rule-2 px-6 py-10">
          <EmptyBody accent="artifacts" icon={<Shapes size={24} aria-hidden />} title="Nothing generated yet" hint="Documents, diagrams and code the AI creates in your chats will be collected here." />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {shown.map(a => (
            <div key={a.id} data-artifact={a.id} className="overflow-hidden rounded-[14px] border border-rule bg-surface hover:border-rule-2">
              <div className="relative">
                <button type="button" aria-label={`Open ${a.title}`} data-testid="artifact-open" onClick={() => setOpenId(a.id)} className="block w-full text-left">
                  <ArtifactThumb artifact={a} className="h-[130px] rounded-none border-0 border-b" />
                </button>
                <span className="absolute left-2.5 top-2.5 rounded-full border border-sec-artifacts-line bg-surface px-[7px] py-0.5 font-mono text-xs text-sec-artifacts">{a.type}</span>
                <span className="absolute right-2.5 top-2.5 font-mono text-xs text-sec-artifacts">v{a.version}</span>
              </div>
              <div className="px-3.5 py-3">
                <button type="button" onClick={() => setOpenId(a.id)} className="mb-1.5 block w-full truncate text-left text-base font-medium text-text hover:underline">{a.title}</button>
                {a.chatId ? <button type="button" onClick={() => { void openProjectChat(a.chatId); }} className="flex w-full items-center gap-1.5 text-xs text-text-3 hover:text-text">
                  <MessageSquare size={13} aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-left">{(threads[a.chatId]?.title as string | undefined) || 'Untitled chat'}</span>
                  <span className="font-mono">{shortTime(a.updatedAt)}</span>
                </button> : a.noteId ? (
                  <button type="button" onClick={() => openNote(a.noteId!)} className="flex w-full items-center gap-1.5 text-xs text-text-3 hover:text-text">
                    <FileText size={13} aria-hidden /><span className="min-w-0 flex-1 truncate text-left">Saved from a note</span><span className="font-mono">{shortTime(a.updatedAt)}</span>
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
