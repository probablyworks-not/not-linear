import { useMemo } from 'react';
import { LiveReply } from './LiveReply';
import { ArrowLeft, GitBranch, Layers, MessageSquare } from 'lucide-react';
import type { CanvasDoc } from '../types';
import { ancestorChain } from '../domain/commands';
import { highlightsByMessage, resolveAnchor } from '../anchors';
import { PartView, type BlockPickHandler } from './PartView';

// The same threads and messages, linear. Not a copy: it reads the same document, renders the same
// parts through the same renderer, and hands navigation back to the canvas. UI-06 is explicit that
// there must be no second representation of the content.

const KIND_ICON = { root: MessageSquare, branch: GitBranch, synthesis: Layers } as const;

export function ReadingView({ doc, onBack, onShowOnCanvas, onBlockPick, activeBranch, onSelectBranch }: {
  doc: CanvasDoc;
  onBack(): void;
  onShowOnCanvas(threadId: string): void;
  onBlockPick?: BlockPickHandler;
  activeBranch: string | null;
  onSelectBranch(id: string | null): void;
}) {
  // Same per-message/per-part marks the canvas cards show (`anchors.ts`'s `highlightsByMessage`,
  // painted in by `apply-highlights.ts`) — Reading View renders the identical `PartView` content,
  // so a branched-from quote should look the same way here, not just on the card it came from.
  const highlights = useMemo(() => highlightsByMessage(doc), [doc]);

  // Thread order: roots in creation order, each followed by what branched from it.
  const ordered = [...doc.threads].sort((a, b) => {
    const da = ancestorChain(doc, a.id).length;
    const db = ancestorChain(doc, b.id).length;
    return da - db || a.createdAt - b.createdAt;
  });

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
    <div data-testid="canvas-reading" className="mx-auto min-h-0 w-full max-w-[720px] flex-1 overflow-auto px-7 py-6">
      <button type="button" onClick={onBack} className="mb-5 flex items-center gap-1.5 text-sm text-text-3 hover:text-text">
        <ArrowLeft size={13} aria-hidden /> Back to the canvas
      </button>
      {ordered.length === 0 && <p className="text-sm text-text-3">This canvas is empty.</p>}
      {ordered.filter(thread => thread.kind === 'root').map(thread => {
        const Icon = KIND_ICON[thread.kind];
        const depth = ancestorChain(doc, thread.id).length - 1;
        const messages = doc.messages.filter(m => m.threadId === thread.id).sort((a, b) => a.seq - b.seq);
        return (
          <section key={thread.id} data-thread={thread.id} className="mb-8" style={{ marginLeft: Math.min(depth, 4) * 16 }}>
            <div className="mb-2 flex items-center gap-2">
              <Icon size={13} aria-hidden className="flex-none text-text-3" />
              <h2 className="m-0 min-w-0 flex-1 truncate text-base font-medium text-text">{thread.title}</h2>
              <button
                type="button" onClick={() => onShowOnCanvas(thread.id)}
                className="flex-none rounded-md border border-rule-2 px-2 py-0.5 text-xs text-text-2 hover:text-text"
              >
                Show on canvas
              </button>
            </div>
            {messages.map(m => (
              <div key={m.id} data-message={m.id} className="mb-3">
                <div className="mb-1 font-mono text-xs uppercase tracking-widest text-text-3">
                  {m.author.kind === 'human' ? 'You' : m.author.kind === 'model' ? m.author.model : m.author.agentId}
                </div>
                {m.provisional ? <LiveReply messageId={m.id} /> : m.parts.map(p => <PartView key={p.id} part={p} messageId={m.id} highlightsByPart={highlights[m.id]} onBlockPick={onBlockPick} />)}
              </div>
            ))}
          </section>
        );
      })}
    </div>
    <aside className="flex min-h-0 w-[min(420px,45vw)] flex-none flex-col border-l border-rule-2 bg-bg" style={{ resize: 'horizontal', overflow: 'auto', minWidth: 260, maxWidth: '65vw' }} aria-label="Branches">
      <div className="flex flex-wrap gap-1 border-b border-rule-2 p-2">
        {ordered.filter(t => t.kind !== 'root').map(t => <button key={t.id} type="button" onClick={() => onSelectBranch(t.id)} aria-pressed={activeBranch === t.id} className="rounded border border-rule-2 px-2 py-1 text-xs text-text">{t.title}</button>)}
      </div>
      {activeBranch && <div className="min-h-0 flex-1 overflow-auto p-4" data-testid="reading-branch">
        <button type="button" onClick={() => onSelectBranch(null)} className="float-right text-xs text-text-3">Minimize</button>
        <h2 className="mb-3 text-base text-text">{doc.threads.find(t => t.id === activeBranch)?.title}</h2>
        {doc.relations.filter(r => r.toThreadId === activeBranch && r.snapshotId).map(r => { const source = doc.snapshots.find(s => s.id === r.snapshotId); return source ? <blockquote key={r.id} className="mb-3 border-l border-rule-2 pl-2 text-xs text-text-3">{source.content}{resolveAnchor(source, doc).status !== 'ok' && <span role="status" className="block">Original source changed or is unavailable; showing the saved excerpt.</span>}</blockquote> : null; })}
        {doc.messages.filter(m => m.threadId === activeBranch).sort((a,b) => a.seq-b.seq).map(m => <div key={m.id} data-message={m.id} className="mb-3">
          <div className="text-xs text-text-3">{m.author.kind === 'human' ? 'You' : 'Assistant'}</div>
          {m.provisional ? <LiveReply messageId={m.id} /> : m.parts.map(p => <PartView key={p.id} part={p} messageId={m.id} highlightsByPart={highlights[m.id]} onBlockPick={onBlockPick} />)}
        </div>)}
      </div>}
    </aside>
    </div>
  );
}
