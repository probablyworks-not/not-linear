import { readMarks } from './anchor';
import type { MarkRecord, PersistedThread } from '../db/types';

// `highlightsV2` is DERIVED from the saved HTML, never the other way round. Legacy
// reads only the spans, and a legacy save can add or remove one without knowing this
// field exists, so the spans are the record and this is the structured index over them
// (ADR-051). It is recomputed whenever a React write touches marks, which is what keeps
// it from drifting; a reader that finds it stale can recompute it the same way.

function parse(html: string): DocumentFragment {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  return tpl.content;
}

function marksOfMessages(html: string, scope: 'stream' | 'branch', branchId?: string): MarkRecord[] {
  const out: MarkRecord[] = [];
  parse(html).querySelectorAll('.msg').forEach((el, i) => {
    const part = el.classList.contains('ai') ? 'ai' : el.classList.contains('user') ? 'user' : null;
    if (!part) return;
    const container = (part === 'ai' ? el.querySelector('.ai-content') : el.querySelector('.bub')) ?? el;
    const turnId = (el as HTMLElement).dataset.turnId || `legacy-${i}`;
    for (const m of readMarks(container)) {
      out.push({ id: m.id, kind: m.kind, scope, ...(branchId ? { branchId } : {}), turnId, part, runs: m.runs });
    }
  });
  return out;
}

export function deriveMarksV2(thread: PersistedThread): MarkRecord[] {
  const out: MarkRecord[] = [];
  if (thread.kind === 'doc' && typeof thread.docContent === 'string' && thread.docContent) {
    const holder = document.createElement('div');
    holder.innerHTML = thread.docContent;
    for (const m of readMarks(holder)) out.push({ id: m.id, kind: m.kind, scope: 'doc', turnId: 'doc', part: 'doc', runs: m.runs });
  }
  if (typeof thread.stream === 'string' && thread.stream) out.push(...marksOfMessages(thread.stream, 'stream'));
  for (const [branchId, snap] of Object.entries(thread.branchSnapshots ?? {})) {
    if (typeof snap?.bodyHTML === 'string' && snap.bodyHTML) out.push(...marksOfMessages(snap.bodyHTML, 'branch', branchId));
  }
  return out;
}

/** Sets `thread.highlightsV2` from its HTML; call at the end of any mutation that can change a mark. */
export function refreshMarksV2(thread: PersistedThread): void {
  const marks = deriveMarksV2(thread);
  if (marks.length) thread.highlightsV2 = marks;
  else delete thread.highlightsV2;
}
