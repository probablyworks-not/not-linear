import type { Anchor, AnchorStatus, CanvasDoc, CanvasMessage, HighlightTone, SourceSnapshot, TextAnchor } from './types';
import { hashText } from './ids';

// Resolving a frozen excerpt back onto a source that may have moved on. The contract (AC-05) is
// that a historical answer stays interpretable: report `changed` or `missing` and show the frozen
// copy. Never silently relink to different text, and never regenerate.

export interface Resolution {
  status: AnchorStatus;
  /** The frozen copy. Always present — it is what the model actually saw. */
  frozen: string;
  /** The text at the anchor today, when it could be found at all. */
  current?: string;
  /** Where in the current part the quote now sits, when it moved but is still there. */
  offset?: { start: number; end: number };
}

const partTextOf = (m: CanvasMessage, partId: string): string | null => {
  const p = m.parts.find(x => x.id === partId);
  if (!p) return null;
  if (p.kind === 'text' || p.kind === 'code' || p.kind === 'report') return p.text;
  if (p.kind === 'html') return p.html;
  if (p.kind === 'tool_result') return p.markdown;
  return null;
};

export const messageText = (m: CanvasMessage): string =>
  m.parts.map(p => partTextOf(m, p.id) ?? '').join('\n\n');

export interface TextHighlight {
  /** The snapshot this highlight was frozen from — tags the rendered `<mark>` so an edge can
   * leave from its exact position (see `useHighlightAnchors`). */
  id: string;
  partId: string;
  quote: string;
  tone: HighlightTone;
}

/** Every frozen quote, grouped by the message and then the part it was taken from — the one shape
 * `ThreadNode`, `ReadingView` and `OutputDetailView` all build from so a branched/synthesized
 * quote shows the same mark everywhere its source text is rendered (`apply-highlights.ts`
 * actually paints it in). Pure/cheap enough to call per-render; callers that render many threads
 * at once (`CanvasWorkspace`) still do their own per-thread/per-message narrowing on top of it. */
export function highlightsByMessage(doc: CanvasDoc): Record<string, Record<string, TextHighlight[]>> {
  const out: Record<string, Record<string, TextHighlight[]>> = {};
  for (const s of doc.snapshots) {
    if (s.anchor.kind !== 'text') continue;
    const byPart = (out[s.anchor.messageId] ??= {});
    (byPart[s.anchor.partId] ??= []).push({ id: s.id, partId: s.anchor.partId, quote: s.anchor.quote, tone: s.highlightTone ?? 'blue' });
  }
  return out;
}

/** Every thread ever frozen whole (`anchor.kind === 'whole'`), by thread id — the "whole card"
 * counterpart to `highlightsByMessage` above, since there's no single part to mark a `<mark>`
 * into; `ThreadNode` tints its entire body instead (`view/ThreadNode.tsx`). */
export function wholeHighlightsByThread(doc: CanvasDoc): Record<string, HighlightTone> {
  const out: Record<string, HighlightTone> = {};
  for (const s of doc.snapshots) {
    if (s.anchor.kind !== 'whole') continue;
    out[s.anchor.threadId] = s.highlightTone ?? 'blue';
  }
  return out;
}

function resolveText(anchor: TextAnchor, snapshot: SourceSnapshot, doc: CanvasDoc): Resolution {
  const frozen = snapshot.content;
  const msg = doc.messages.find(m => m.id === anchor.messageId);
  if (!msg) return { status: 'missing', frozen };
  const text = partTextOf(msg, anchor.partId);
  if (text === null) return { status: 'missing', frozen };

  // The offsets are only trustworthy while the revision is the one we froze.
  const atOffsets = text.slice(anchor.start, anchor.end);
  if (msg.rev === snapshot.sourceRev && atOffsets === anchor.quote) {
    return { status: 'ok', frozen, current: atOffsets, offset: { start: anchor.start, end: anchor.end } };
  }

  // The source moved on. The quote may still be present, just elsewhere: that is `changed`, not
  // `missing` — the excerpt is still findable and the user can be shown where it went.
  const found = text.indexOf(anchor.quote);
  if (found >= 0) {
    return { status: 'changed', frozen, current: anchor.quote, offset: { start: found, end: found + anchor.quote.length } };
  }
  return { status: 'missing', frozen };
}

/** Every message belonging to `threadId`, in the doc's own order, joined the same way a single
 * message's parts are — this is what `freezeWholeThread` hashed, so resolving has to rebuild it
 * identically to compare. */
export const threadText = (doc: CanvasDoc, threadId: string): string =>
  doc.messages.filter(m => m.threadId === threadId).sort((a, b) => a.seq - b.seq).map(messageText).join('\n\n');

export function resolveAnchor(snapshot: SourceSnapshot, doc: CanvasDoc): Resolution {
  const anchor: Anchor = snapshot.anchor;
  if (anchor.kind === 'text') return resolveText(anchor, snapshot, doc);

  if (anchor.kind === 'whole') {
    if (!doc.threads.some(t => t.id === anchor.threadId)) return { status: 'missing', frozen: snapshot.content };
    const current = threadText(doc, anchor.threadId);
    return { status: hashText(current) === snapshot.hash ? 'ok' : 'changed', frozen: snapshot.content, current };
  }

  // `media` resolves to the message's existence and whether its text still hashes the same. A
  // media region needs the asset to compare properly; that is C5.
  const msg = doc.messages.find(m => m.id === anchor.messageId);
  if (!msg) return { status: 'missing', frozen: snapshot.content };
  const current = messageText(msg);
  return { status: hashText(current) === snapshot.hash ? 'ok' : 'changed', frozen: snapshot.content, current };
}

/** Every snapshot a thread depends on, with its status. What the provenance UI reads. */
export function resolveThreadSources(doc: CanvasDoc, threadId: string): { snapshot: SourceSnapshot; resolution: Resolution }[] {
  const ids = new Set(doc.relations.filter(r => r.toThreadId === threadId && r.snapshotId).map(r => r.snapshotId));
  return doc.snapshots
    .filter(s => ids.has(s.id))
    .map(snapshot => ({ snapshot, resolution: resolveAnchor(snapshot, doc) }));
}
