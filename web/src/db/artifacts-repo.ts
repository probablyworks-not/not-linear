import { ARTIFACTS_KEY, openArtifactsDb } from './artifacts';
import type { ArtifactType, StoredArtifact } from '../projects/extras/types';

// The only place `web/` reads or writes artifacts. Every write is one read-modify-write in an `rw`
// transaction on a single kv row, so two quick saves cannot drop each other.

let db: ReturnType<typeof openArtifactsDb> | null = null;
const artifactsDb = () => (db ??= openArtifactsDb());

/** Tests point the repo at a fresh database. */
export function resetArtifactsDbForTests(name?: string): void { db = name ? openArtifactsDb(name) : null; }

const asList = (v: unknown): StoredArtifact[] => (Array.isArray(v) ? (v as StoredArtifact[]) : []);

async function mutate<T>(fn: (all: StoredArtifact[]) => { next: StoredArtifact[]; result: T }): Promise<T> {
  const d = artifactsDb();
  return d.transaction('rw', d.kv, async () => {
    const { next, result } = fn(asList((await d.kv.get(ARTIFACTS_KEY))?.value));
    await d.kv.put({ key: ARTIFACTS_KEY, value: next });
    return result;
  });
}

export async function listArtifacts(projectId: string): Promise<StoredArtifact[]> {
  const all = asList((await artifactsDb().kv.get(ARTIFACTS_KEY))?.value);
  return all.filter(a => a.projectId === projectId);
}

export async function getArtifact(id: string): Promise<StoredArtifact | null> {
  return asList((await artifactsDb().kv.get(ARTIFACTS_KEY))?.value).find(a => a.id === id) ?? null;
}

export interface SaveArtifactInput {
  projectId: string;
  title: string;
  type: ArtifactType;
  content: string;
  chatId: string;
  source: StoredArtifact['source'];
  /** Saving the same key again makes a new version instead of a second artifact. */
  dedupeKey: string;
  noteId?: string;
}

/** Creates the artifact (v1) or, when `dedupeKey` already exists in the project, adds a version. Identical content is a no-op. */
export interface SaveResult { artifact: StoredArtifact; created: boolean; changed: boolean }

export async function saveArtifact(input: SaveArtifactInput): Promise<SaveResult> {
  return mutate<SaveResult>(all => {
    const now = Date.now();
    const i = all.findIndex(a => a.projectId === input.projectId && a.dedupeKey === input.dedupeKey);
    if (i < 0) {
      const artifact: StoredArtifact = {
        id: `art_${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`,
        projectId: input.projectId, title: input.title, type: input.type, version: 1, chatId: input.chatId, updatedAt: now,
        content: input.content, source: input.source, dedupeKey: input.dedupeKey, ...(input.noteId ? { noteId: input.noteId } : {}),
        versions: [{ v: 1, content: input.content, at: now }],
      };
      return { next: [...all, artifact], result: { artifact, created: true, changed: true } };
    }
    const prev = all[i]!;
    if (prev.content === input.content && prev.title === input.title) return { next: all, result: { artifact: prev, created: false, changed: false } };
    const version = prev.version + 1;
    const artifact: StoredArtifact = {
      ...prev, title: input.title, content: input.content, version, updatedAt: now,
      versions: [...prev.versions, { v: version, content: input.content, at: now }],
    };
    const next = all.slice();
    next[i] = artifact;
    return { next, result: { artifact, created: false, changed: true } };
  });
}

export async function deleteArtifact(id: string): Promise<void> {
  await mutate(all => ({ next: all.filter(a => a.id !== id), result: undefined }));
}
