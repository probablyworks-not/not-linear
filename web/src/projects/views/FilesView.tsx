import { File as FileIcon, FileText, Files, FolderOpen, Image as ImageIcon, X } from 'lucide-react';
import { fileIconKind, fmtSize } from '../../attachments/file-kinds';
import type { Attachment } from '../../attachments/read-files';
import { addFilesToProject, linkProjectFolder, unlinkProjectFolder } from '../../state/actions';
import { useAppStore } from '../../state/app-store';
import { headerGhost, headerPrimary, ViewHeader } from './ViewHeader';

/**
 * The Files drill-in: uploaded files as rows, and the linked folder as a banner. The folder is scanned when a message is
 * sent, not here, so the banner shows its path but no synced count, and there is no per-file "used in N chats".
 */
export function FilesView({ pid, projectName, files, path }: { pid: string; projectName: string; files: Attachment[]; path: string }) {
  const removeFile = useAppStore(s => s.removeProjectFile);
  return (
    <div data-testid="files-view">
      <ViewHeader
        projectName={projectName} icon={<Files size={22} aria-hidden className="text-sec-files" />}
        title="Files" count={files.length} subtitle="Shared knowledge available to every chat in this project"
        actions={(
          <>
            <button type="button" className={headerGhost} onClick={() => { void linkProjectFolder(pid); }}>Link folder…</button>
            <button type="button" className={headerPrimary} onClick={() => { void addFilesToProject(pid); }}>+ Add files</button>
          </>
        )}
      />
      {path && (
        <div className="mb-4 flex flex-wrap items-center gap-3.5 rounded-xl border border-sec-files-line bg-sec-files-soft px-4 py-3.5">
          <FolderOpen size={20} aria-hidden className="flex-none text-sec-files" />
          <div className="min-w-[200px] flex-1">
            <div data-testid="project-folder" className="break-all text-base font-medium text-text">{path}</div>
            <div className="text-xs text-text-2">Linked folder · matching files are added as context automatically</div>
          </div>
          <button type="button" onClick={() => { void unlinkProjectFolder(pid); }} className="text-xs text-text-3 hover:text-text">Unlink</button>
        </div>
      )}
      {files.length === 0 ? (
        <div className="rounded-[14px] border border-dashed border-rule-2 p-8 text-center text-sm text-text-3">No uploaded files yet.</div>
      ) : (
        <div className="overflow-hidden rounded-[14px] border border-rule bg-surface">
          {files.map((f, i) => {
            const kind = fileIconKind(f);
            const Icon = kind === 'pdf' ? FileText : kind === 'image' ? ImageIcon : FileIcon;
            return (
              <div key={`${f.name}-${i}`} data-testid="file-row" className="group flex items-center gap-3.5 border-t border-rule px-4 py-3 first:border-t-0 hover:bg-bg-2">
                <span className="grid h-[34px] w-[34px] flex-none place-items-center rounded-[9px] bg-sec-files-soft text-sec-files"><Icon size={17} aria-hidden /></span>
                <div className="min-w-0 flex-1 truncate text-base font-medium text-text">{f.name}</div>
                <span className="flex-none rounded-full bg-bg-2 px-2 py-0.5 font-mono text-xs uppercase tracking-wider text-sec-files">Uploaded</span>
                <span className="w-[60px] flex-none text-right font-mono text-xs text-text-3">{fmtSize(f.size)}</span>
                <button type="button" aria-label={`Remove ${f.name}`} title="Remove" onClick={() => { void removeFile(pid, i); }} className="grid h-6 w-6 flex-none place-items-center rounded-[5px] text-text-3 opacity-0 hover:bg-bg-3 hover:text-text focus-visible:opacity-100 group-hover:opacity-100"><X size={13} /></button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
