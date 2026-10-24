import { useState } from 'react';
import { Download, X } from 'lucide-react';
import { useUiStore } from '../state/ui-store';
import { ESC_PRIORITY, useEscLayer } from '../lib/keyboard';
import { saveTextFile } from '../lib/save-file';
import { fileNameFor } from '../chat/artifact-buttons';

/**
 * An html or svg file from a reply, shown as it will actually look. The same rule as the artifact
 * viewer: model output never touches the app's DOM. The frame has no allow-same-origin, so even
 * with scripts on it is an opaque origin with no reach into the app or its storage.
 */
export function FilePreview() {
  const file = useUiStore(s => s.filePreview);
  const close = useUiStore(s => s.setFilePreview);
  const [scripts, setScripts] = useState(false);
  useEscLayer('filePreview', ESC_PRIORITY.filePreview, !!file, () => close(null));
  if (!file) return null;
  const btn = 'flex h-[30px] items-center gap-1.5 rounded-full border border-rule bg-surface px-3 text-xs text-text-2 hover:text-text';
  return (
    <div role="dialog" aria-label="File preview" data-testid="file-preview" className="fixed inset-0 z-[9999] flex items-center justify-center bg-scrim p-6" onClick={() => close(null)}>
      <div className="flex max-h-[90vh] w-full max-w-[1000px] flex-col overflow-hidden rounded-xl border border-rule bg-bg shadow-lg" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 border-b border-rule px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-text">{file.title}</div>
            <div className="font-mono text-xs text-text-3">{fileNameFor(file.kind, file.title)}</div>
          </div>
          {file.kind === 'html' && (
            <label className="flex items-center gap-1.5 text-xs text-text-3"><input type="checkbox" checked={scripts} onChange={e => setScripts(e.target.checked)} />Run scripts</label>
          )}
          <button type="button" className={btn} onClick={() => { void saveTextFile(fileNameFor(file.kind, file.title), file.content, file.kind); }}>
            <Download size={13} aria-hidden />Download
          </button>
          <button type="button" aria-label="Close preview" className={btn} onClick={() => close(null)}><X size={13} aria-hidden /></button>
        </div>
        {file.kind === 'svg' ? (
          // An <img> never runs script, whatever the SVG contains.
          <img alt="" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(file.content)}`} className="h-[76vh] w-full bg-white object-contain p-4" />
        ) : (
          <iframe title="File preview" data-testid="file-preview-frame" sandbox={scripts ? 'allow-scripts' : ''} srcDoc={file.content} className="h-[76vh] w-full bg-white" />
        )}
      </div>
    </div>
  );
}
