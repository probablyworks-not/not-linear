import { useMemo, useState } from 'react';
import { BookOpen, ChevronRight, GitBranch, Layers, MessageSquare, X } from 'lucide-react';
import type { CanvasDoc, CanvasThread } from '../types';
import { canvasHierarchy } from './hierarchy';
import { TONE_BG } from './ThreadNode';

const ICONS = { root: MessageSquare, branch: GitBranch, synthesis: Layers } as const;

export function CanvasHierarchy({ doc, selectedId, onLocate, onRead, onClose }: {
  doc: CanvasDoc;
  selectedId: string | null;
  onLocate(id: string): void;
  onRead(id: string): void;
  onClose(): void;
}) {
  const tree = useMemo(() => canvasHierarchy(doc), [doc]);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  function renderThread(thread: CanvasThread, depth: number): JSX.Element {
    const children = tree.children.get(thread.id) ?? [];
    const closed = collapsed.has(thread.id);
    const Icon = ICONS[thread.kind];
    const count = tree.counts.get(thread.id) ?? 0;
    const question = tree.questions.get(thread.id) || thread.title || 'Untitled thread';
    const words = question.split(' ');
    const shortQuestion = words.length > 12 ? `${words.slice(0, 12).join(' ')}…` : question;
    const highlights = tree.highlights.get(thread.id) ?? [];
    const otherSources = (tree.sources.get(thread.id) ?? []).filter(id => id !== tree.parents.get(thread.id));
    return (
      <li key={thread.id} data-hierarchy-thread={thread.id}>
        <div className={`my-0.5 flex items-center gap-1 rounded-md px-1 py-1 ${selectedId === thread.id ? 'bg-branch-soft text-branch' : 'text-text-2 hover:bg-cv-card-inset'}`}>
          {children.length ? <button type="button" aria-label={`Toggle branches of ${thread.title}`} aria-expanded={!closed}
            className="grid h-6 w-5 flex-none place-items-center rounded hover:bg-cv-card-inset"
            onClick={() => setCollapsed(previous => { const next = new Set(previous); if (next.has(thread.id)) next.delete(thread.id); else next.add(thread.id); return next; })}>
            <ChevronRight size={12} aria-hidden className={closed ? '' : 'rotate-90'} />
          </button> : <span className="w-5 flex-none" />}
          <Icon size={13} aria-hidden className="flex-none" />
          <button type="button" aria-label={`Locate ${thread.title}`} aria-pressed={selectedId === thread.id} title={question}
            onClick={() => onLocate(thread.id)} className="min-w-0 flex-1 rounded px-1 text-left focus-visible:outline focus-visible:outline-branch">
            {highlights.map(source => <span key={source.id} data-testid="hierarchy-source" data-highlight-tone={source.highlightTone ?? 'blue'}
              title={source.content || source.label}
              className={`mb-1 block truncate rounded px-1.5 py-0.5 text-xs text-text ${TONE_BG[source.highlightTone ?? 'blue']}`}>
              {source.content.replace(/\s+/g, ' ').trim() || source.label}
            </span>)}
            <span data-testid="hierarchy-question" className="block truncate text-sm font-medium text-text">{shortQuestion}</span>
            <span className="mt-0.5 block truncate text-xs text-text-3">{thread.kind === 'root' ? 'Main thread' : thread.kind === 'synthesis' ? 'Synthesis' : depth > 1 ? `Sub-branch · level ${depth}` : 'Branch'} · {count} message{count === 1 ? '' : 's'}</span>
          </button>
          <button type="button" aria-label={`Read ${thread.title}`} title="Open in reading view" onClick={() => onRead(thread.id)}
            className="grid h-7 w-6 flex-none place-items-center rounded text-text-3 hover:bg-cv-card-inset hover:text-text"><BookOpen size={13} aria-hidden /></button>
        </div>
        {otherSources.length > 0 && <div className="mb-1 ml-7 text-xs text-text-3">Also from {otherSources.map((id, index) => <span key={id}>
          {index > 0 && ', '}<button type="button" className="max-w-full truncate text-branch hover:underline" onClick={() => onLocate(id)}>{tree.byId.get(id)?.title}</button>
        </span>)}</div>}
        {children.length > 0 && !closed && <ul className="ml-3 list-none border-l border-cv-divider pl-1">{children.map(child => renderThread(child, depth + 1))}</ul>}
      </li>
    );
  }
  return <aside aria-label="Canvas hierarchy" data-testid="canvas-hierarchy"
    className="relative z-10 flex w-[440px] max-w-[55%] flex-none flex-col border-l border-cv-divider bg-transparent">
    <div className="flex items-center gap-2 border-b border-cv-divider px-3 py-3">
      <GitBranch size={14} aria-hidden className="text-text-3" />
      <h2 className="m-0 flex-1 text-sm font-medium text-text">Hierarchy</h2>
      <span className="font-mono text-xs text-text-3">{doc.threads.length}</span>
      <button type="button" aria-label="Hide hierarchy" onClick={onClose} className="rounded p-1 text-text-3 hover:bg-cv-card-inset hover:text-text"><X size={14} aria-hidden /></button>
    </div>
    <div className="min-h-0 flex-1 overflow-auto px-2 pb-6">
      <p className="px-2 text-xs text-text-3">Highlight → your question · Select to locate</p>
      {tree.roots.length ? <ul className="m-0 list-none p-0">{tree.roots.map(thread => renderThread(thread, 0))}</ul> : <p className="px-2 text-sm text-text-3">Ask a question to start a main thread. Its branches will appear here.</p>}
    </div>
  </aside>;
}
