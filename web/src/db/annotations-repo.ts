import { readCanvasAnnotations, writeCanvasAnnotations, deleteCanvasAnnotations } from '../canvas/canvas-repo';
import { openChatDb } from './chat';

export interface AnnotationStroke {
  anchor: { scope: string; text: string; occurrence: number };
  points: [number, number][];
  /** Stroke width relative to its block, so Canvas zoom scales the ink with the text. */
  width?: number;
}
interface AnnotationRow { key: string; value: { version: 1; strokes: AnnotationStroke[] } }
// Separate v1 rows, with the same key format as the original annotation implementation.
// No change to the chat state row, table declaration, database version, or Notes database.
const db = openChatDb();
const table = db.table<AnnotationRow, string>('kv');
const prefix = (tid: string): string => `annotations:v1:${encodeURIComponent(tid)}:`;
const key = (tid: string, bid = ''): string => prefix(tid) + encodeURIComponent(bid);
let writes: Promise<unknown> = Promise.resolve();
function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const next = writes.then(operation);
  writes = next.catch(() => {});
  return next;
}
export async function readAnnotations(tid: string, bid = ''): Promise<AnnotationStroke[]> {
  await writes;
  if (tid.startsWith('canvas:')) return readCanvasAnnotations(tid.slice(7), bid);
  const row = await table.get(key(tid, bid));
  return row?.value?.version === 1 && Array.isArray(row.value.strokes) ? row.value.strokes : [];
}
export function writeAnnotations(tid: string, bid: string, strokes: AnnotationStroke[]): Promise<string> {
  const value = structuredClone({ version: 1 as const, strokes });
  return enqueue(() => tid.startsWith('canvas:') ? writeCanvasAnnotations(tid.slice(7), bid, value.strokes) : table.put({ key: key(tid, bid), value }));
}
export async function deleteAnnotations(tid: string, bids?: ReadonlySet<string>): Promise<void> {
  // Cancel any in-progress stroke and clear the UI cache before queuing the delete,
  // so a late pointer-up cannot re-create the removed marks.
  window.dispatchEvent(new CustomEvent('notlinear-annotations-deleted', { detail: { threadId: tid, branchIds: bids ? [...bids] : undefined } }));
  await enqueue(async () => {
    if (tid.startsWith('canvas:')) { await deleteCanvasAnnotations(tid.slice(7), bids); return; }
    if (bids) await table.bulkDelete([...bids].map(bid => key(tid, bid)));
    else await table.where('key').startsWith(prefix(tid)).delete();
  });
}
