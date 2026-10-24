import { saveArtifact } from '../db/artifacts-repo';
import type { ArtifactType } from '../projects/extras/types';
import { beginOperation, completeOperation, failOperation } from './canvas-repo';
import type { CanvasDoc, CanvasPart, OutputVersion } from './types';

// Saving a Canvas output into project Artifacts crosses two databases, so it cannot be one Dexie
// transaction. The protocol is: record the intent, do the save, record the completion. A retry
// finds the pending record by its deterministic key and resumes it rather than starting a second
// one — which is what stops a failed save leaving two artifacts behind (§4.3 of the plan).
//
// The saved artifact is pinned to one output *version*. Later Canvas edits make new versions and
// never rewrite what was already saved.

const textOf = (parts: readonly CanvasPart[]): string =>
  parts
    .map(p => {
      if (p.kind === 'text' || p.kind === 'report') return p.text;
      if (p.kind === 'code') return `\`\`\`${p.language}\n${p.text}\n\`\`\``;
      if (p.kind === 'html') return p.html;
      return '';
    })
    .filter(Boolean)
    .join('\n\n');

const typeOf = (parts: readonly CanvasPart[]): ArtifactType => {
  if (parts.some(p => p.kind === 'html')) return 'HTML';
  if (parts.every(p => p.kind === 'code')) return 'TSX';
  return 'MD';
};

export interface SaveOutputResult {
  status: 'saved' | 'unchanged' | 'resumed' | 'failed';
  artifactId?: string;
  version?: number;
  error?: string;
}

/**
 * Two keys, deliberately different.
 *
 * The *artifact* key identifies the artifact, so saving a later version of the same output adds a
 * version rather than making a second artifact.
 *
 * The *operation* key identifies one save attempt, and so must name the exact output version.
 * Keying the operation by family instead made a genuinely new version look like a duplicate save
 * and silently skip it — caught by a test, not by review.
 */
export const artifactKeyFor = (canvasId: string, output: OutputVersion): string =>
  `canvas:${canvasId}:${output.familyId}`;

export const saveKeyFor = (canvasId: string, output: OutputVersion): string =>
  `canvas:${canvasId}:${output.familyId}:v${output.version}`;

export async function saveOutputToArtifacts(
  doc: CanvasDoc,
  output: OutputVersion,
  title: string,
): Promise<SaveOutputResult> {
  const projectId = doc.summary.projectId;
  if (!projectId) {
    return { status: 'failed', error: 'This canvas is not in a project, so there is nowhere to save it yet.' };
  }
  const canvasId = doc.summary.id;
  const dedupeKey = saveKeyFor(canvasId, output);

  const { op, resumed } = await beginOperation({
    kind: 'save-artifact',
    canvasId,
    dedupeKey,
    payload: { outputVersionId: output.id, title },
  });

  // Already finished on an earlier attempt: report it rather than saving again.
  if (resumed && op.status === 'done' && op.result) {
    return { status: 'resumed', artifactId: op.result };
  }

  try {
    const saved = await saveArtifact({
      projectId,
      title,
      type: typeOf(output.parts),
      content: textOf(output.parts),
      chatId: '',
      source: 'canvas',
      dedupeKey: artifactKeyFor(canvasId, output),
      canvasId,
      canvasOutputVersionId: output.id,
    });
    await completeOperation(op.id, saved.artifact.id);
    return {
      status: saved.changed ? 'saved' : 'unchanged',
      artifactId: saved.artifact.id,
      version: saved.artifact.version,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await failOperation(op.id, message);
    return { status: 'failed', error: message };
  }
}
