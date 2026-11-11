import type { CanvasDoc, CanvasThread, CanvasMessage, SourceSnapshot } from '../types';
import { messageText } from '../anchors';

/** A display forest, never a replacement for the provenance graph. References may be cyclic;
 * synthesis has several parents. Show each card once and keep all source links for navigation. */
export function canvasHierarchy(doc: CanvasDoc) {
  const ordered = [...doc.threads].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const byId = new Map(ordered.map(t => [t.id, t]));
  const parents = new Map<string, string>();
  const sources = new Map<string, string[]>();
  for (const relation of doc.relations) {
    if (relation.kind === 'reference' || !byId.has(relation.fromThreadId) || !byId.has(relation.toThreadId)) continue;
    const list = sources.get(relation.toThreadId) ?? [];
    if (!list.includes(relation.fromThreadId)) list.push(relation.fromThreadId);
    sources.set(relation.toThreadId, list);
    if (parents.has(relation.toThreadId) || byId.get(relation.toThreadId)?.kind === 'root') continue;
    let cursor: string | undefined = relation.fromThreadId;
    while (cursor && cursor !== relation.toThreadId) cursor = parents.get(cursor);
    if (!cursor) parents.set(relation.toThreadId, relation.fromThreadId);
  }
  const children = new Map<string, CanvasThread[]>();
  const roots: CanvasThread[] = [];
  for (const thread of ordered) {
    const parent = parents.get(thread.id);
    if (!parent) roots.push(thread);
    else { const list = children.get(parent) ?? []; list.push(thread); children.set(parent, list); }
  }
  const counts = new Map<string, number>();
  for (const message of doc.messages) counts.set(message.threadId, (counts.get(message.threadId) ?? 0) + 1);
  const firstQuestions = new Map<string, CanvasMessage>();
  for (const message of doc.messages) {
    const previous = firstQuestions.get(message.threadId);
    if (message.author.kind === 'human' && (!previous || message.seq < previous.seq)) firstQuestions.set(message.threadId, message);
  }
  const questions = new Map([...firstQuestions].map(([id, message]) => [id, messageText(message).replace(/\s+/g, ' ').trim()]));
  const snapshots = new Map(doc.snapshots.map(snapshot => [snapshot.id, snapshot]));
  const highlights = new Map<string, SourceSnapshot[]>();
  for (const relation of doc.relations) {
    if (relation.kind === 'reference' || !relation.snapshotId) continue;
    const snapshot = snapshots.get(relation.snapshotId);
    if (!snapshot) continue;
    const list = highlights.get(relation.toThreadId) ?? [];
    if (!list.some(item => item.id === snapshot.id)) list.push(snapshot);
    highlights.set(relation.toThreadId, list);
  }
  return { roots, children, byId, sources, parents, counts, questions, highlights };
}
