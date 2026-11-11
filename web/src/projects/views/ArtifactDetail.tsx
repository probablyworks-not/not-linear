import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Copy, Download, FileText, MessageSquare, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { renderMarkdown, renderMermaidIn, highlightCodeIn } from '../../lib/markdown';
import { nameLinksIn } from '../../lib/name-links';
import { downloadText } from '../extras/artifact-source';
import { getProjectSources } from '../extras/sources';
import { useExtrasStore } from '../extras/extras-store';
import type { ArtifactType, StoredArtifact } from '../extras/types';
import { openProjectChat } from '../../state/actions';
import { openNote } from '../../notes/open-note';

const FILE: Record<ArtifactType, { ext: string; mime: string }> = {
  HTML: { ext: 'html', mime: 'text/html' }, SVG: { ext: 'svg', mime: 'image/svg+xml' },
  MD: { ext: 'md', mime: 'text/markdown' }, TSX: { ext: 'tsx', mime: 'text/plain' },
};

const fileName = (a: StoredArtifact): string => `${a.title.replace(/[\\/:*?"<>|]/g, '').trim() || 'artifact'}.${FILE[a.type].ext}`;

/** The artifact's content, rendered. HTML and SVG are untrusted model output, so neither touches the app's DOM. */
function Body({ type, content, scripts }: { type: ArtifactType; content: string; scripts: boolean }) {
  const md = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (type !== 'MD' || !md.current) return;
    renderMermaidIn(md.current);
    void highlightCodeIn(md.current);
    void nameLinksIn(md.current);
  }, [type, content]);
  if (type === 'HTML') {
    // No allow-same-origin: even with scripts on, the page is an opaque origin with no reach into the app or its storage.
    return <iframe title="Artifact preview" data-testid="artifact-frame" sandbox={scripts ? 'allow-scripts' : ''} srcDoc={content} className="h-[70vh] w-full rounded-[10px] border border-rule bg-white" />;
  }
  if (type === 'SVG') {
    // An <img> never runs script, whatever the SVG contains.
    return <img data-testid="artifact-svg" alt="" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(content)}`} className="max-h-[70vh] w-full rounded-[10px] border border-rule bg-white object-contain p-4" />;
  }
  if (type === 'MD') return <div ref={md} data-testid="artifact-md" className="msg ai ai-content rounded-[10px] border border-rule bg-surface px-6 py-5" dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />;
  return <pre className="overflow-auto rounded-[10px] border border-rule bg-surface p-4 font-mono text-sm"><code>{content}</code></pre>;
}

export function ArtifactDetail({ pid, id, onBack }: { pid: string; id: string; onBack(): void }) {
  const removeArtifact = useExtrasStore(s => s.removeArtifact);
  const [artifact, setArtifact] = useState<StoredArtifact | null | undefined>(undefined);
  const [version, setVersion] = useState<number | null>(null);
  const [scripts, setScripts] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Loads the content from the source: an external system.
  useEffect(() => {
    let live = true;
    getProjectSources().artifacts.get?.(id).then(a => { if (live) setArtifact(a); }).catch(() => { if (live) setArtifact(null); });
    return () => { live = false; };
  }, [id]);

  if (artifact === undefined) return <p className="text-sm text-text-3">Loading&hellip;</p>;
  if (artifact === null) {
    return (
      <div data-testid="artifact-detail">
        <button type="button" onClick={onBack} className="mb-4 flex items-center gap-1.5 text-sm text-text-3 hover:text-text"><ArrowLeft size={13} aria-hidden />Artifacts</button>
        <p role="alert" className="text-sm text-text-2">This artifact could not be found. It may have been deleted.</p>
      </div>
    );
  }
  const shown = artifact.versions.find(v => v.v === (version ?? artifact.version)) ?? artifact.versions[artifact.versions.length - 1]!;
  const btn = 'flex h-[30px] items-center gap-1.5 rounded-full border border-rule bg-surface px-3 text-xs text-text-2 hover:text-text';
  return (
    <div data-testid="artifact-detail">
      <button type="button" onClick={onBack} className="mb-4 flex items-center gap-1.5 text-sm text-text-3 hover:text-text"><ArrowLeft size={13} aria-hidden />Artifacts</button>
      <div className="mb-4 flex flex-wrap items-center gap-2.5">
        <div className="min-w-[200px] flex-1">
          <h2 className="m-0 text-[22px] font-semibold leading-tight text-text" data-testid="artifact-title">{artifact.title}</h2>
          <div className="mt-0.5 font-mono text-xs text-sec-artifacts">{artifact.type} &middot; v{shown.v}{shown.v !== artifact.version ? ` (latest v${artifact.version})` : ''}</div>
        </div>
        {artifact.versions.length > 1 && (
          <select aria-label="Version" value={shown.v} onChange={e => setVersion(Number(e.target.value))} className="h-[30px] rounded-full border border-rule bg-surface px-2.5 text-xs text-text-2">
            {artifact.versions.map(v => <option key={v.v} value={v.v}>v{v.v}</option>).reverse()}
          </select>
        )}
        {artifact.type === 'HTML' && (
          <label className="flex items-center gap-1.5 text-xs text-text-3"><input type="checkbox" checked={scripts} onChange={e => setScripts(e.target.checked)} />Run scripts</label>
        )}
        <button type="button" className={btn} onClick={() => { void navigator.clipboard?.writeText(shown.content).then(() => toast('Copied')); }}><Copy size={13} aria-hidden />Copy</button>
        <button type="button" className={btn} data-testid="artifact-download" onClick={() => downloadText(fileName(artifact), shown.content, FILE[artifact.type].mime)}><Download size={13} aria-hidden />Download</button>
        {artifact.chatId && <button type="button" className={btn} onClick={() => { void openProjectChat(artifact.chatId); }}><MessageSquare size={13} aria-hidden />Source chat</button>}
        {artifact.noteId && <button type="button" className={btn} onClick={() => openNote(artifact.noteId!)}><FileText size={13} aria-hidden />Source note</button>}
        {confirmDelete ? (
          <button type="button" data-testid="artifact-delete-confirm" className={`${btn} border-danger text-danger`} onClick={() => { void removeArtifact(pid, artifact.id).then(onBack); }}>Delete all versions?</button>
        ) : (
          <button type="button" data-testid="artifact-delete" className={btn} onClick={() => setConfirmDelete(true)} onBlur={() => setConfirmDelete(false)}><Trash2 size={13} aria-hidden />Delete</button>
        )}
      </div>
      <Body type={artifact.type} content={shown.content} scripts={scripts} />
    </div>
  );
}
