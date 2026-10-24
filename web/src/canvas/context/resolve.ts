import type { ChatMessage } from '../../providers/types';
import { ancestorChain } from '../domain/commands';
import { newId } from '../ids';
import type { CanvasDoc, CanvasMessage, ContextManifest, SourceSnapshot } from '../types';

// What the model is given, and the record of it.
//
// Two rules decide everything here. The sources are *frozen copies*, so what a run saw survives the
// original being edited or deleted. And the manifest is written from the same data that built the
// messages — not reconstructed afterwards — so "what the AI saw" cannot drift from what it saw.
//
// Layout is not an input. Moving, resizing or hiding a card must produce a byte-identical manifest
// (FR-06, AC-06), which is why nothing in this file reads `doc.layouts`.

const textOf = (m: CanvasMessage): string =>
  m.parts
    .map(p => {
      if (p.kind === 'text' || p.kind === 'report') return p.text;
      if (p.kind === 'code') return `\`\`\`${p.language}\n${p.text}\n\`\`\``;
      if (p.kind === 'tool_result') return p.markdown;
      if (p.kind === 'attachment') return `[attached: ${p.name}]`;
      return '';
    })
    .filter(Boolean)
    .join('\n\n');

/** The excerpt block that precedes a branch or synthesis question. */
export function quoteBlock(snapshots: readonly SourceSnapshot[]): string {
  if (snapshots.length === 0) return '';
  return snapshots
    .map(s => s.content.split('\n').map(line => `> ${line}`).join('\n'))
    .join('\n>\n');
}

export interface ResolvedContext {
  messages: ChatMessage[];
  snapshots: SourceSnapshot[];
  manifest: Omit<ContextManifest, 'id' | 'runId' | 'createdAt'>;
}

/**
 * The messages for one thread: every ancestor's exchange in order, then this thread's own, with the
 * frozen excerpts in front of the question that cited them.
 *
 * `pendingText` is the message being sent right now, when it is not yet in the document.
 */
export function resolveContext(doc: CanvasDoc, threadId: string, opts: {
  inheritedRules?: string[];
  budgetTokens?: number;
} = {}): ResolvedContext {
  const chain = ancestorChain(doc, threadId);
  const messages: ChatMessage[] = [];
  const used: SourceSnapshot[] = [];

  for (const id of chain) {
    const threadSnaps = doc.relations
      .filter(r => r.toThreadId === id && r.snapshotId)
      .map(r => doc.snapshots.find(s => s.id === r.snapshotId))
      .filter((s): s is SourceSnapshot => !!s);

    const msgs = doc.messages.filter(m => m.threadId === id).sort((a, b) => a.seq - b.seq);
    for (const [i, m] of msgs.entries()) {
      const body = textOf(m);
      if (!body.trim()) continue;
      if (m.author.kind === 'human') {
        // The excerpts belong to the first question of the thread that cited them, which is the
        // one the user asked while looking at them.
        const prefix = i === 0 && threadSnaps.length ? `${quoteBlock(threadSnaps)}\n\n` : '';
        if (i === 0) used.push(...threadSnaps);
        messages.push({ role: 'user', content: prefix + body });
      } else {
        messages.push({ role: 'assistant', content: body });
      }
    }
  }

  return {
    messages,
    snapshots: used,
    manifest: {
      snapshotIds: used.map(s => s.id),
      inherited: opts.inheritedRules ?? [],
      ...(opts.budgetTokens ? { budgetTokens: opts.budgetTokens } : {}),
    },
  };
}

/** Records the manifest against a run, so the disclosure is durable rather than recomputed. */
export function manifestFor(runId: string, manifest: ResolvedContext['manifest'], now: number): ContextManifest {
  return { id: newId('cm'), runId, createdAt: now, ...manifest };
}
