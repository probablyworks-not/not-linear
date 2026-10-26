import {
  CANVAS_INDEX_KEY, CANVAS_OPS_KEY, canvasIdOfDocKey, docKey, draftKey, isDocKey, openCanvasDb, viewKey,
} from '../db/canvas';
import { newId } from './ids';
import {
  emptyDoc, type CanvasDoc, type CanvasOperation, type CanvasSummary, type CanvasViewState, type Draft,
} from './types';

// The only place `web/` reads or writes the canvas db (ADR-066). Every write is one
// read-modify-write inside an `rw` transaction spanning both rows it touches — the index entry and
// the canvas document — so the counts a list shows can never drift from the document's contents.
//
// Drafts and view state are separate rows on purpose and are written without touching either of
// those: a keystroke must not re-serialise a canvas full of replies, and a pan must not either.

let db: ReturnType<typeof openCanvasDb> | null = null;
const canvasDb = () => (db ??= openCanvasDb());

/** Tests point the repo at a fresh database. */
export function resetCanvasDbForTests(name?: string): void { db = name ? openCanvasDb(name) : null; }

const asIndex = (v: unknown): CanvasSummary[] => (Array.isArray(v) ? (v as CanvasSummary[]) : []);
const asOps = (v: unknown): CanvasOperation[] => (Array.isArray(v) ? (v as CanvasOperation[]) : []);

export class CanvasMissingError extends Error {
  constructor(canvasId: string) { super(`canvas ${canvasId} is not in the database`); }
}

/**
 * Thrown instead of overwriting. Two tabs can hold the same canvas; the second writer is handed
 * the version it did not see rather than silently clobbering it (AC-12). The caller decides what
 * to do with `current` — nothing here guesses.
 */
export class CanvasConflictError extends Error {
  readonly current: CanvasDoc;
  readonly expectedRev: number;
  constructor(canvasId: string, expectedRev: number, current: CanvasDoc) {
    super(`canvas ${canvasId} changed under you: expected rev ${expectedRev}, found ${current.summary.rev}`);
    this.current = current;
    this.expectedRev = expectedRev;
  }
}

export interface CreateCanvasInput {
  projectId: string | null;
  title: string;
}

export async function createCanvas(input: CreateCanvasInput, now = Date.now()): Promise<CanvasDoc> {
  const summary: CanvasSummary = {
    id: newId('cv'),
    projectId: input.projectId,
    title: input.title,
    counts: { threads: 0, messages: 0, outputs: 0 },
    createdAt: now,
    updatedAt: now,
    rev: 1,
  };
  const doc = emptyDoc(summary);
  const d = canvasDb();
  await d.transaction('rw', d.kv, async () => {
    const index = asIndex((await d.kv.get(CANVAS_INDEX_KEY))?.value);
    await d.kv.put({ key: docKey(summary.id), value: doc });
    await d.kv.put({ key: CANVAS_INDEX_KEY, value: [...index, summary] });
  });
  return doc;
}

/** Newest first, which is the order the Canvas library shows. `null` lists the Unassigned ones. */
export async function listCanvases(projectId: string | null): Promise<CanvasSummary[]> {
  const index = asIndex((await canvasDb().kv.get(CANVAS_INDEX_KEY))?.value);
  return index.filter(c => c.projectId === projectId).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function listAllCanvases(): Promise<CanvasSummary[]> {
  const index = asIndex((await canvasDb().kv.get(CANVAS_INDEX_KEY))?.value);
  return [...index].sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getCanvas(canvasId: string): Promise<CanvasDoc | null> {
  const row = await canvasDb().kv.get(docKey(canvasId));
  return (row?.value as CanvasDoc | undefined) ?? null;
}

/**
 * Applies `mutate` to the document atomically and re-derives the index entry from it. Pass
 * `expectedRev` to make the write conditional — without it the write is last-one-wins, which is
 * right for a single-tab edit and wrong for anything that read the document earlier.
 */
export async function updateCanvas<T>(
  canvasId: string,
  mutate: (doc: CanvasDoc) => T,
  opts: { expectedRev?: number; now?: number } = {},
): Promise<{ doc: CanvasDoc; result: T }> {
  const d = canvasDb();
  return d.transaction('rw', d.kv, async () => {
    const row = await d.kv.get(docKey(canvasId));
    if (!row) throw new CanvasMissingError(canvasId);
    const doc = row.value as CanvasDoc;
    if (opts.expectedRev !== undefined && opts.expectedRev !== doc.summary.rev) {
      throw new CanvasConflictError(canvasId, opts.expectedRev, doc);
    }
    const result = mutate(doc);
    doc.summary.rev += 1;
    doc.summary.updatedAt = opts.now ?? Date.now();
    doc.summary.counts = {
      threads: doc.threads.length,
      messages: doc.messages.length,
      outputs: doc.outputs.length,
    };
    const index = asIndex((await d.kv.get(CANVAS_INDEX_KEY))?.value);
    const i = index.findIndex(c => c.id === canvasId);
    const next = index.slice();
    if (i < 0) next.push(doc.summary); else next[i] = doc.summary;
    await d.kv.put({ key: docKey(canvasId), value: doc });
    await d.kv.put({ key: CANVAS_INDEX_KEY, value: next });
    return { doc, result };
  });
}

export async function renameCanvas(canvasId: string, title: string): Promise<void> {
  await updateCanvas(canvasId, doc => { doc.summary.title = title; });
}

/** C11. Same shape as `setThreadGlyph`/`setProjectGlyph` (state/actions.ts) — a Mind Garden token on the summary. */
export async function setCanvasGlyph(canvasId: string, token: string): Promise<void> {
  await updateCanvas(canvasId, doc => { doc.summary.emoji = token; });
}

/**
 * Deleting a project does not delete its canvases: they move to the Unassigned listing so no work
 * becomes unreachable (§4.3, AC-17). This is the same call the project-delete path makes.
 */
export async function unassignCanvasesOfProject(projectId: string): Promise<string[]> {
  const index = asIndex((await canvasDb().kv.get(CANVAS_INDEX_KEY))?.value);
  const ids = index.filter(c => c.projectId === projectId).map(c => c.id);
  for (const id of ids) await updateCanvas(id, doc => { doc.summary.projectId = null; });
  return ids;
}

export async function deleteCanvas(canvasId: string): Promise<void> {
  const d = canvasDb();
  await d.transaction('rw', d.kv, async () => {
    const index = asIndex((await d.kv.get(CANVAS_INDEX_KEY))?.value);
    await d.kv.delete(docKey(canvasId));
    await d.kv.delete(draftKey(canvasId));
    await d.kv.delete(viewKey(canvasId));
    await d.kv.put({ key: CANVAS_INDEX_KEY, value: index.filter(c => c.id !== canvasId) });
  });
}

// ---------- drafts: their own row, written on every debounce ----------

const asDrafts = (v: unknown): Record<string, Draft> => (v && typeof v === 'object' ? v as Record<string, Draft> : {});

export async function getDrafts(canvasId: string): Promise<Record<string, Draft>> {
  return asDrafts((await canvasDb().kv.get(draftKey(canvasId)))?.value);
}

/** Drafts are keyed by canvas *and* target, which is what keeps two canvases from leaking (FR-05). */
export async function putDraft(canvasId: string, draft: Draft): Promise<void> {
  const d = canvasDb();
  await d.transaction('rw', d.kv, async () => {
    const all = asDrafts((await d.kv.get(draftKey(canvasId)))?.value);
    await d.kv.put({ key: draftKey(canvasId), value: { ...all, [draft.target]: draft } });
  });
}

export async function clearDraft(canvasId: string, target: string): Promise<void> {
  const d = canvasDb();
  await d.transaction('rw', d.kv, async () => {
    const all = asDrafts((await d.kv.get(draftKey(canvasId)))?.value);
    delete all[target];
    await d.kv.put({ key: draftKey(canvasId), value: all });
  });
}

// ---------- view state: device-local, never exported ----------

export async function getViewState(canvasId: string): Promise<CanvasViewState | null> {
  return ((await canvasDb().kv.get(viewKey(canvasId)))?.value as CanvasViewState | undefined) ?? null;
}

export async function putViewState(canvasId: string, view: CanvasViewState): Promise<void> {
  await canvasDb().kv.put({ key: viewKey(canvasId), value: view });
}

// ---------- operations: the cross-database save protocol ----------

/**
 * Record intent before doing anything outside this database. `dedupeKey` is deterministic, so a
 * retry of the same logical save finds the pending record instead of starting a second one — the
 * reason a failed artifact save cannot leave two artifacts behind (§4.3).
 */
export async function beginOperation(input: Omit<CanvasOperation, 'id' | 'status' | 'createdAt' | 'updatedAt'>, now = Date.now()): Promise<{ op: CanvasOperation; resumed: boolean }> {
  const d = canvasDb();
  return d.transaction('rw', d.kv, async () => {
    const ops = asOps((await d.kv.get(CANVAS_OPS_KEY))?.value);
    const existing = ops.find(o => o.dedupeKey === input.dedupeKey && o.status !== 'failed');
    if (existing) return { op: existing, resumed: true };
    const op: CanvasOperation = { ...input, id: newId('op'), status: 'pending', createdAt: now, updatedAt: now };
    await d.kv.put({ key: CANVAS_OPS_KEY, value: [...ops, op] });
    return { op, resumed: false };
  });
}

export async function completeOperation(opId: string, result: string, now = Date.now()): Promise<void> {
  const d = canvasDb();
  await d.transaction('rw', d.kv, async () => {
    const ops = asOps((await d.kv.get(CANVAS_OPS_KEY))?.value);
    await d.kv.put({ key: CANVAS_OPS_KEY, value: ops.map(o => o.id === opId ? { ...o, status: 'done' as const, result, updatedAt: now } : o) });
  });
}

export async function failOperation(opId: string, error: string, now = Date.now()): Promise<void> {
  const d = canvasDb();
  await d.transaction('rw', d.kv, async () => {
    const ops = asOps((await d.kv.get(CANVAS_OPS_KEY))?.value);
    await d.kv.put({ key: CANVAS_OPS_KEY, value: ops.map(o => o.id === opId ? { ...o, status: 'failed' as const, error, updatedAt: now } : o) });
  });
}

/** What a reconciliation pass on startup reads. */
export async function pendingOperations(): Promise<CanvasOperation[]> {
  return asOps((await canvasDb().kv.get(CANVAS_OPS_KEY))?.value).filter(o => o.status === 'pending');
}

/** Every canvas document, for export. Reads the rows directly rather than the index. */
export async function allDocs(): Promise<CanvasDoc[]> {
  const rows = await canvasDb().kv.toArray();
  return rows.filter(r => isDocKey(r.key) && canvasIdOfDocKey(r.key)).map(r => r.value as CanvasDoc);
}

/** Used by import. Writes a whole document and its index entry, replacing any existing one. */
export async function putDoc(doc: CanvasDoc): Promise<void> {
  const d = canvasDb();
  await d.transaction('rw', d.kv, async () => {
    const index = asIndex((await d.kv.get(CANVAS_INDEX_KEY))?.value);
    const next = index.filter(c => c.id !== doc.summary.id);
    next.push(doc.summary);
    await d.kv.put({ key: docKey(doc.summary.id), value: doc });
    await d.kv.put({ key: CANVAS_INDEX_KEY, value: next });
  });
}
