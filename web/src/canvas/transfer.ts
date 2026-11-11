import { checksum, kindOf, newId, type IdKind } from './ids';
import { CANVAS_SCHEMA_VERSION, type CanvasDoc } from './types';
import { allDocs, getCanvas, putDoc } from './canvas-repo';

// Export and import. The format carries its own version and a checksum per canvas, so a file that
// was truncated or hand-edited is rejected rather than half-imported.
//
// Import always remaps ids. Two consequences, both wanted: re-importing the same file produces a
// second, independent canvas instead of overwriting the first, and a canvas can be duplicated by
// exporting and importing it. The remap must cover every id *reference*, not just the id fields —
// a relation pointing at a thread that no longer exists is the failure mode this guards against.

export const CANVAS_TRANSFER_FORMAT = 1;

export interface CanvasExport {
  format: number;
  schemaVersion: number;
  exportedAt: number;
  canvases: { doc: CanvasDoc; checksum: string }[];
  /** Asset bytes are not inlined in v1 — nothing produces an asset until C5. */
  assets: [];
}

export async function exportCanvases(ids?: string[], now = Date.now()): Promise<CanvasExport> {
  const docs = ids
    ? (await Promise.all(ids.map(id => getCanvas(id)))).filter((d): d is CanvasDoc => !!d)
    : await allDocs();
  return {
    format: CANVAS_TRANSFER_FORMAT,
    schemaVersion: CANVAS_SCHEMA_VERSION,
    exportedAt: now,
    canvases: docs.map(doc => ({ doc, checksum: checksum(doc) })),
    assets: [],
  };
}

export class TransferFormatError extends Error {}

export interface ImportReport {
  imported: { oldId: string; newId: string; title: string }[];
  skipped: { oldId: string; reason: string }[];
}

const ID_FIELDS = new Set([
  'id', 'threadId', 'messageId', 'partId', 'snapshotId', 'runId', 'familyId', 'entityId',
  'fromThreadId', 'toThreadId', 'producedByRunId', 'outputVersionId', 'assetId', 'sourceId',
  'canvasId', 'toolCallId',
]);

/** Every id in the document, whatever field it sits in, so nothing is remapped by half. */
function collectIds(value: unknown, into: Set<string>): void {
  if (Array.isArray(value)) { for (const v of value) collectIds(v, into); return; }
  if (!value || typeof value !== 'object') return;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'string' && ID_FIELDS.has(k) && v.includes('_')) into.add(v);
    else collectIds(v, into);
  }
}

function rewriteIds(value: unknown, map: ReadonlyMap<string, string>): unknown {
  if (Array.isArray(value)) return value.map(v => rewriteIds(v, map));
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'string' && ID_FIELDS.has(k)) out[k] = map.get(v) ?? v;
    else out[k] = rewriteIds(v, map);
  }
  return out;
}

/**
 * `layouts[].entries` is keyed by entity id, so its *keys* need remapping too — the one place in
 * the document where an id is a property name rather than a value.
 */
function rewriteLayoutKeys(doc: CanvasDoc, map: ReadonlyMap<string, string>): void {
  for (const layout of doc.layouts) {
    const next: CanvasDoc['layouts'][number]['entries'] = {};
    for (const [k, v] of Object.entries(layout.entries)) next[map.get(k) ?? k] = v;
    layout.entries = next;
  }
}

/** Drafts are keyed `thread:<id>`; a target that names a thread has to follow the remap. */
export function remapDraftTarget(target: string, map: ReadonlyMap<string, string>): string {
  if (!target.startsWith('thread:')) return target;
  const id = target.slice('thread:'.length);
  return `thread:${map.get(id) ?? id}`;
}

export function remapDoc(doc: CanvasDoc): { doc: CanvasDoc; map: Map<string, string> } {
  const ids = new Set<string>();
  collectIds(doc, ids);
  const map = new Map<string, string>();
  for (const id of ids) {
    const kind = kindOf(id);
    map.set(id, kind ? newId(kind as IdKind) : newId('cv'));
  }
  const next = rewriteIds(doc, map) as CanvasDoc;
  rewriteLayoutKeys(next, map);
  return { doc: next, map };
}

function validate(payload: unknown): CanvasExport {
  if (!payload || typeof payload !== 'object') throw new TransferFormatError('not a canvas export');
  const p = payload as Partial<CanvasExport>;
  if (p.format !== CANVAS_TRANSFER_FORMAT) throw new TransferFormatError(`unsupported format ${String(p.format)}; this build reads ${CANVAS_TRANSFER_FORMAT}`);
  if (typeof p.schemaVersion !== 'number' || p.schemaVersion > CANVAS_SCHEMA_VERSION) {
    throw new TransferFormatError(`export was written by a newer build (schema ${String(p.schemaVersion)} > ${CANVAS_SCHEMA_VERSION})`);
  }
  if (!Array.isArray(p.canvases)) throw new TransferFormatError('export has no canvases');
  return p as CanvasExport;
}

export async function importCanvases(payload: unknown, now = Date.now()): Promise<ImportReport> {
  const parsed = validate(payload);
  const report: ImportReport = { imported: [], skipped: [] };
  for (const entry of parsed.canvases) {
    const oldId = entry.doc?.summary?.id ?? '(unknown)';
    if (checksum(entry.doc) !== entry.checksum) {
      report.skipped.push({ oldId, reason: 'checksum mismatch — the export is damaged or was edited' });
      continue;
    }
    const { doc } = remapDoc(entry.doc);
    doc.summary.createdAt = now;
    doc.summary.updatedAt = now;
    doc.summary.rev = 1;
    doc.schemaVersion = CANVAS_SCHEMA_VERSION;
    await putDoc(doc);
    report.imported.push({ oldId, newId: doc.summary.id, title: doc.summary.title });
  }
  return report;
}

/** Duplicate is export-and-import of one canvas: the same id remap, so provenance stays internal. */
export async function duplicateCanvas(canvasId: string, title?: string, now = Date.now()): Promise<CanvasDoc | null> {
  const src = await getCanvas(canvasId);
  if (!src) return null;
  const { doc } = remapDoc(src);
  doc.summary.title = title ?? `${src.summary.title} copy`;
  doc.summary.createdAt = now;
  doc.summary.updatedAt = now;
  doc.summary.rev = 1;
  await putDoc(doc);
  return doc;
}
