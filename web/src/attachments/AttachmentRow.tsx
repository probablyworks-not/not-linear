import { File as FileIcon, FileText, Folder, GitBranch, Image as ImageIcon, X } from 'lucide-react';
import { fileIconKind, fmtSize } from './file-kinds';
import type { Attachment } from './read-files';

type Chip = Pick<Attachment, 'name' | 'size' | 'kind' | 'type'> & { base64?: string; quote?: string; messageCount?: number };

/**
 * The chips under a composer or in a project's Files card (app.js:4912 renderAttachRow). An image
 * shows its own thumbnail and opens a preview when clicked; an attached branch shows its turn
 * count where a file shows its size.
 */
export function AttachmentRow({ files, onRemove, onPreview }: {
  files: readonly Chip[]; onRemove(index: number): void; onPreview?(src: string, name: string): void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" data-testid="attach-row">
      {files.map((f, i) => {
        const kind = fileIconKind(f);
        const Icon = kind === 'folder' ? Folder : kind === 'pdf' ? FileText : kind === 'image' ? ImageIcon : FileIcon;
        const base = f.name.split('/').pop() ?? f.name;
        const src = f.kind === 'image' && f.base64 ? `data:${f.type};base64,${f.base64}` : null;
        return (
          <span
            key={`${f.name}-${i}`} data-testid="file-chip"
            onClick={src && onPreview ? e => { if (!(e.target as HTMLElement).closest('button')) onPreview(src, f.name); } : undefined}
            className={`inline-flex max-w-[160px] items-center gap-[5px] rounded-[5px] border border-rule-2 bg-bg-2 py-[3px] pl-[7px] pr-1.5 text-xs text-text-2${src ? ' cursor-pointer' : ''}`}
          >
            {f.kind === 'branch' ? <GitBranch size={12} aria-hidden className="flex-none text-text-3" />
              : src ? <img src={src} alt="" className="h-4 w-4 flex-none rounded-[2px] object-cover" />
              : <Icon size={12} aria-hidden className="flex-none text-text-3" />}
            <span className="min-w-0 flex-1 truncate" title={f.kind === 'branch' ? (f.quote || f.name) : f.name}>{base}</span>
            <span className="ml-0.5 flex-none text-xs text-text-3">
              {f.kind === 'branch' ? `${f.messageCount ?? 0} turn${f.messageCount === 1 ? '' : 's'}` : fmtSize(f.size)}
            </span>
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
