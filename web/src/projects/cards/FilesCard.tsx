import { Files } from 'lucide-react';
import { addFilesToProject, linkProjectFolder, unlinkProjectFolder } from '../../state/actions';
import { useUiStore } from '../../state/ui-store';
import { SectionCard } from './SectionCard';

export function FilesCard({ pid, names, path }: { pid: string; names: string[]; path: string }) {
  const setView = useUiStore(s => s.setProjectView);
  const empty = names.length === 0 && !path;
  const link = 'cursor-pointer text-xs text-branch hover:underline';
  return (
    <SectionCard
      accent="files" icon={<Files size={16} aria-hidden />} label="Files" count={names.length} empty={empty} span="col-span-2" testId="card-files"
      onHeader={empty ? undefined : () => setView('files')}
    >
      {empty ? (
        <div className="text-xs leading-normal text-text-3">Shared knowledge for every chat — upload files or link a folder.</div>
      ) : (
        <div className="flex flex-col gap-1">
          {path && (
            <div className="flex items-center gap-2 text-xs text-text-2">
              <span data-testid="project-folder" className="min-w-0 break-all">{path}</span>
              <span aria-hidden className="h-1.5 w-1.5 flex-none rounded-full bg-success" />
              <button type="button" className={link} onClick={() => { void unlinkProjectFolder(pid); }}>Unlink</button>
            </div>
          )}
          {names.length > 0 && (
            <div className="truncate text-xs text-text-3">
              {names.slice(0, 2).join(', ')}{names.length > 2 ? ` + ${names.length - 2} more` : ''}
            </div>
          )}
        </div>
      )}
      <div className="mt-2 flex gap-2.5">
        <button type="button" className={link} onClick={() => { void addFilesToProject(pid); }}>+ Add files</button>
        <button type="button" className={link} onClick={() => { void linkProjectFolder(pid); }}>{path ? 'Change folder' : 'Link folder'}</button>
      </div>
    </SectionCard>
  );
}
