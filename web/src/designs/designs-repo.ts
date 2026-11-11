import { DESIGNS_INDEX_KEY, openDesignsDb, runKey } from '../db/designs';
import { emptySpec, type DesignBundle, type RunCounts, type SpecRun, type SpecRunDoc } from './types';

// The only place `web/` reads or writes the designs db. Every write is one read-modify-write in an
// `rw` transaction spanning BOTH rows it touches — the index entry and the run document — so the
// counts shown in the list can never drift from the contents of the run.

let db: ReturnType<typeof openDesignsDb> | null = null;
const designsDb = () => (db ??= openDesignsDb());

/** Tests point the repo at a fresh database. */
export function resetDesignsDbForTests(name?: string): void { db = name ? openDesignsDb(name) : null; }

const asIndex = (v: unknown): SpecRun[] => (Array.isArray(v) ? (v as SpecRun[]) : []);

/** The index entry is derived from the document, never maintained by hand. */
export function deriveCounts(doc: SpecRunDoc): RunCounts {
  const live = <T extends { status: string }>(xs: readonly T[]) => xs.filter(x => x.status !== 'rejected' && x.status !== 'stale');
  const pending = [...doc.flows, ...doc.requirements].filter(x => x.status === 'pending');
  return {
    screens: doc.spec.screens.length,
    flows: live(doc.flows).length,
    requirements: live(doc.requirements).length,
    pending: pending.length,
  };
}

export interface CreateRunInput {
  projectId: string;
  title: string;
  bundle: DesignBundle;
  parentRunId?: string;
}

const newRunId = () => `dr_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export async function createRun(input: CreateRunInput): Promise<SpecRunDoc> {
  const now = Date.now();
  const run: SpecRun = {
    id: newRunId(),
    projectId: input.projectId,
    title: input.title,
    stage: 'parsed',
    status: 'idle',
    counts: { screens: 0, flows: 0, requirements: 0, pending: 0 },
    visionUsed: false,
    createdAt: now,
    updatedAt: now,
    ...(input.parentRunId ? { parentRunId: input.parentRunId } : {}),
  };
  const doc: SpecRunDoc = {
    run, bundle: input.bundle, spec: emptySpec(), flows: [], requirements: [], questions: [], answers: [], log: [],
  };
  doc.run.counts = deriveCounts(doc);
  const d = designsDb();
  await d.transaction('rw', d.kv, async () => {
    const index = asIndex((await d.kv.get(DESIGNS_INDEX_KEY))?.value);
    await d.kv.put({ key: runKey(doc.run.id), value: doc });
    await d.kv.put({ key: DESIGNS_INDEX_KEY, value: [...index, doc.run] });
  });
  return doc;
}

/** Newest first, which is the order the Designs view shows. */
export async function listRuns(projectId: string): Promise<SpecRun[]> {
  const index = asIndex((await designsDb().kv.get(DESIGNS_INDEX_KEY))?.value);
  return index.filter(r => r.projectId === projectId).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getRun(runId: string): Promise<SpecRunDoc | null> {
  const row = await designsDb().kv.get(runKey(runId));
  return (row?.value as SpecRunDoc | undefined) ?? null;
}

export class RunMissingError extends Error {
  constructor(runId: string) { super(`design run ${runId} is not in the database`); }
}

/**
 * Applies `mutate` to the run document atomically, then re-derives the index entry from it.
 * The mutator edits the document in place, like `updateChatState`.
 */
export async function updateRun<T>(runId: string, mutate: (doc: SpecRunDoc) => T): Promise<{ doc: SpecRunDoc; result: T }> {
  const d = designsDb();
  return d.transaction('rw', d.kv, async () => {
    const row = await d.kv.get(runKey(runId));
    if (!row) throw new RunMissingError(runId);
    const doc = row.value as SpecRunDoc;
    const result = mutate(doc);
    doc.run.counts = deriveCounts(doc);
    doc.run.updatedAt = Date.now();
    const index = asIndex((await d.kv.get(DESIGNS_INDEX_KEY))?.value);
    const i = index.findIndex(r => r.id === runId);
    const next = index.slice();
    if (i < 0) next.push(doc.run); else next[i] = doc.run;
    await d.kv.put({ key: runKey(runId), value: doc });
    await d.kv.put({ key: DESIGNS_INDEX_KEY, value: next });
    return { doc, result };
  });
}

export async function deleteRun(runId: string): Promise<void> {
  const d = designsDb();
  await d.transaction('rw', d.kv, async () => {
    const index = asIndex((await d.kv.get(DESIGNS_INDEX_KEY))?.value);
    await d.kv.delete(runKey(runId));
    await d.kv.put({ key: DESIGNS_INDEX_KEY, value: index.filter(r => r.id !== runId) });
  });
}
