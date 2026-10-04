import { File as FileIcon, FileText, Folder, Image as ImageIcon, X } from 'lucide-react';
import { fileIconKind, fmtSize } from './file-kinds';
import type { Attachment } from './read-files';

/** The chips under a composer or in a project's Files card (app.js:4912 renderAttachRow). */
export function AttachmentRow({ files, onRemove }: { files: readonly Pick<Attachment, 'name' | 'size' | 'kind' | 'type'>[]; onRemove(index: number): void }) {
  return (
    <div className="flex flex-wrap gap-1.5" data-testid="attach-row">
      {files.map((f, i) => {
        const kind = fileIconKind(f);
        const Icon = kind === 'folder' ? Folder : kind === 'pdf' ? FileText : kind === 'image' ? ImageIcon : FileIcon;
        const base = f.name.split('/').pop() ?? f.name;
        return (
          <span
            key={`${f.name}-${i}`} data-testid="file-chip"
            className="inline-flex max-w-[160px] items-center gap-[5px] rounded-[5px] border border-rule-2 bg-bg-2 py-[3px] pl-[7px] pr-1.5 text-xs text-text-2"
          >
            <Icon size={12} aria-hidden className="flex-none text-text-3" />
            <span className="min-w-0 flex-1 truncate" title={f.name}>{base}</span>
            <span className="ml-0.5 flex-none text-xs text-text-3">{fmtSize(f.size)}</span>
            <button
              type="button" title="Remove" aria-label={`Remove ${base}`} onClick={() => onRemove(i)}
              className="flex-none pl-0.5 text-text-3 hover:text-text"
            >
              <X size={11} />
            </button>
          </span>
        );
      })}
    </div>
  );
}
