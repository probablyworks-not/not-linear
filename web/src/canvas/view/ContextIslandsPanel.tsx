import { useState } from 'react';
import { clsx } from 'clsx';
import { Download, FilePlus, Plus, Trash2, X } from 'lucide-react';
import { ESC_PRIORITY, useEscLayer } from '../../lib/keyboard';
import { addFilesTo } from '../../attachments/attach-actions';
import { useAttachments } from '../../attachments/attachments-store';
import { useUiStore } from '../../state/ui-store';
import { addFileRef, addMemoryItem, editMemoryItem, removeFileRef, removeMemoryItem } from '../domain/commands';
import type { CanvasDoc } from '../types';
import type { PersistedProject } from '../../db/types';

// C10. The four context islands from the design reference, as one panel with tabs rather than
// four draggable world-space cards — same scrim/panel pattern as the chat ContextPanel.tsx, same
// "what you see here is what the model saw" rule as the OutputDetailView and the manifest: Memory
// and Files render the exact `doc.memory`/`doc.files` that `canvasContextBlock()` (context/resolve.ts)
// folds into the prompt, and Rules shows the project text that already reaches the system prompt.

type Tab = 'memory' | 'rules' | 'files' | 'outputs';
const TABS: { id: Tab; label: string; accent: string }[] = [
  { id: 'memory', label: 'Memory', accent: 'border-t-cv-island-memory' },
  { id: 'rules', label: 'Rules', accent: 'border-t-cv-island-rules' },
  { id: 'files', label: 'Files', accent: 'border-t-cv-island-files' },
  { id: 'outputs', label: 'Outputs', accent: 'border-t-cv-island-outputs' },
];

const ATTACH_KEY_SUFFIX = ':context-files';

export function ContextIslandsPanel({ canvasId, doc, project, apply, onViewOutput, onClose }: {
  canvasId: string;
  doc: CanvasDoc;
  project: PersistedProject | undefined;
  apply<T>(fn: (doc: CanvasDoc) => T): Promise<T | null>;
  onViewOutput(messageId: string): void;
  onClose(): void;
}) {
  const [tab, setTab] = useState<Tab>('memory');
  useEscLayer('canvasContext', ESC_PRIORITY.canvasContext, true, onClose);

  const memory = doc.memory ?? [];
  const files = doc.files ?? [];
  const attachKey = `canvas:${canvasId}${ATTACH_KEY_SUFFIX}`;
  const pickedFiles = useAttachments(s => s.files[attachKey]) ?? [];

  // A file picked for this island lands in `doc.files` immediately, not in the ephemeral
  // attachments store — Files here is a standing part of the canvas, not a per-send draft. Read
  // fresh from the store rather than the reactive `pickedFiles` above: this runs from a `.then()`
  // after `addFilesTo` resolves, by which point a stale render's closure would still see `[]`.
  const commitPickedFiles = async (): Promise<void> => {
    const picked = useAttachments.getState().files[attachKey] ?? [];
    if (!picked.length) return;
    await apply(d => { for (const f of picked) addFileRef(d, { name: f.name, size: f.size, mime: f.type, content: f.content }, { now: Date.now() }); });
    useAttachments.getState().clear(attachKey);
  };

  return (
    <>
      <div onClick={onClose} aria-hidden="true" className="fixed inset-0 z-[150] bg-scrim" />
      <aside
        role="dialog" aria-label="Canvas context" data-testid="context-islands-panel"
        className="fixed bottom-4 right-4 top-16 z-[160] flex w-[min(400px,92vw)] flex-col overflow-hidden rounded-xl border border-cv-edge bg-cv-card shadow-lg"
      >
        <div className="flex flex-none items-center gap-2.5 border-b border-cv-divider px-4 py-3">
          <h3 className="m-0 flex-1 text-sm font-medium text-text">Canvas context</h3>
          <button type="button" aria-label="Close context" onClick={onClose} className="grid h-6 w-6 place-items-center rounded-md text-text-3 hover:bg-cv-card-inset hover:text-text">
            <X size={14} />
          </button>
        </div>
        <div className="flex flex-none border-b border-cv-divider px-2">
          {TABS.map(t => (
            <button
              key={t.id} type="button" aria-pressed={tab === t.id} onClick={() => setTab(t.id)}
              className={clsx(
                'border-t-[3px] px-2.5 py-2 font-mono text-xs uppercase tracking-widest',
                tab === t.id ? `${t.accent} text-text` : 'border-t-transparent text-text-3 hover:text-text-2',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3.5">
          {tab === 'memory' && (
            <MemoryTab
              items={memory}
              onAdd={text => void apply(d => addMemoryItem(d, text, { now: Date.now() }))}
              onEdit={(id, text) => void apply(d => editMemoryItem(d, id, text))}
              onRemove={id => void apply(d => removeMemoryItem(d, id))}
            />
          )}
          {tab === 'rules' && <RulesTab project={project} />}
          {tab === 'files' && (
            <FilesTab
              files={files}
              pickedCount={pickedFiles.length}
              onAddFiles={() => { void addFilesTo(attachKey, false).then(commitPickedFiles); }}
              onRemove={id => void apply(d => removeFileRef(d, id))}
            />
          )}
          {tab === 'outputs' && <OutputsTab doc={doc} onViewOutput={onViewOutput} onClose={onClose} />}
        </div>
      </aside>
    </>
  );
}

function MemoryTab({ items, onAdd, onEdit, onRemove }: {
  items: { id: string; text: string }[];
  onAdd(text: string): void;
  onEdit(id: string, text: string): void;
  onRemove(id: string): void;
}) {
  const [draft, setDraft] = useState('');
  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-1.5">
        <input
          value={draft} onChange={e => setDraft(e.target.value)} placeholder="Keep something AI should remember…"
          onKeyDown={e => { if (e.key === 'Enter' && draft.trim()) { onAdd(draft.trim()); setDraft(''); } }}
          className="flex-1 rounded-md border border-cv-edge bg-cv-card-inset px-2.5 py-1.5 text-sm text-text outline-none placeholder:text-text-3"
        />
        <button
          type="button" aria-label="Add memory" disabled={!draft.trim()}
          onClick={() => { if (draft.trim()) { onAdd(draft.trim()); setDraft(''); } }}
          className="grid h-8 w-8 flex-none place-items-center rounded-md border border-cv-edge text-text-2 hover:text-text disabled:opacity-40"
        >
          <Plus size={14} />
        </button>
      </div>
      {items.length === 0 ? (
        <div className="text-sm text-text-3">Nothing remembered yet for this canvas.</div>
      ) : items.map(m => (
        <div key={m.id} data-testid="memory-item" className="flex items-start gap-2 rounded-lg border border-cv-edge bg-cv-card-inset px-2.5 py-2">
          <textarea
            value={m.text} rows={2} onChange={e => onEdit(m.id, e.target.value)}
            className="min-w-0 flex-1 resize-none border-0 bg-transparent text-sm text-text outline-none"
          />
          <button type="button" aria-label="Forget" onClick={() => onRemove(m.id)} className="flex-none text-text-3 hover:text-danger">
            <Trash2 size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

function RulesTab({ project }: { project: PersistedProject | undefined }) {
  const setView = useUiStore(s => s.setProjectView);
  const setActiveProject = useUiStore(s => s.setActiveProject);
  const rules = project?.rules?.trim();
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-text-3">
        Inherited from this canvas&rsquo;s project. Edited from the project, not here, so there is one place rules live.
      </p>
      {rules ? (
        <div className="whitespace-pre-wrap rounded-lg border border-cv-edge bg-cv-card-inset px-2.5 py-2 text-sm text-text">{rules}</div>
      ) : (
        <div className="text-sm text-text-3">This project has no rules set yet.</div>
      )}
      {project && (
        <button
          type="button"
          onClick={() => { setActiveProject(project.id); setView('overview'); }}
          className="self-start rounded-md border border-cv-edge px-2.5 py-1.5 text-xs text-text-2 hover:text-text"
        >
          Edit in the project
        </button>
      )}
    </div>
  );
}

function FilesTab({ files, pickedCount, onAddFiles, onRemove }: {
  files: { id: string; name: string; size: number }[];
  pickedCount: number;
  onAddFiles(): void;
  onRemove(id: string): void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <button
        type="button" onClick={onAddFiles} disabled={pickedCount > 0}
        className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-cv-edge px-3 py-3 text-sm text-text-2 hover:text-text disabled:opacity-60"
      >
        <FilePlus size={14} aria-hidden /> {pickedCount > 0 ? 'Adding…' : 'Add files to this canvas'}
      </button>
      {files.length === 0 ? (
        <div className="text-sm text-text-3">No files yet. Added here, a file is context for every question on this canvas.</div>
      ) : files.map(f => (
        <div key={f.id} data-testid="context-file" className="flex items-center gap-2.5 rounded-lg border border-cv-edge bg-cv-card-inset px-2.5 py-2">
          <span className="min-w-0 flex-1 truncate text-sm text-text">{f.name}</span>
          <span className="flex-none font-mono text-xs text-text-3">{Math.max(1, Math.round(f.size / 1024))}kB</span>
          <button type="button" aria-label={`Remove ${f.name}`} onClick={() => onRemove(f.id)} className="flex-none text-text-3 hover:text-danger">
            <Trash2 size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

function OutputsTab({ doc, onViewOutput, onClose }: { doc: CanvasDoc; onViewOutput(messageId: string): void; onClose(): void }) {
  const outputs = doc.outputs;
  if (outputs.length === 0) return <div className="text-sm text-text-3">Nothing saved to Artifacts from this canvas yet.</div>;
  return (
    <div className="flex flex-col gap-2">
      {outputs.map(o => {
        const message = doc.messages.find(m => m.producedByRunId && o.producedByRunId === m.producedByRunId) ?? doc.messages.find(m => m.outputFamilyId === o.familyId);
        const thread = message ? doc.threads.find(t => t.id === message.threadId) : undefined;
        return (
          <button
            key={o.id} type="button"
            onClick={() => { if (message) { onViewOutput(message.id); onClose(); } }}
            disabled={!message}
            className="flex items-center gap-2.5 rounded-lg border border-cv-edge bg-cv-card-inset px-2.5 py-2 text-left hover:border-cv-island-outputs disabled:opacity-60"
          >
            <Download size={13} aria-hidden className="flex-none text-text-3" />
            <span className="min-w-0 flex-1 truncate text-sm text-text">{thread?.title ?? 'Output'}</span>
            <span className="flex-none font-mono text-xs text-text-3">v{o.version}</span>
          </button>
        );
      })}
    </div>
  );
}
