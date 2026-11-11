import { deleteArtifact, getArtifact, listArtifacts } from '../../db/artifacts-repo';
import type { ArtifactSource } from './sources';
import type { ProjectArtifact, StoredArtifact } from './types';

// The real ArtifactSource, backed by the notlinear-artifacts db. Installed once in main.tsx.

const svgPreview = (svg: string): string => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

/** The list shape: no content or history, just a thumbnail where one is cheap (SVG). */
function toListItem(a: StoredArtifact): ProjectArtifact {
  const item: ProjectArtifact = { id: a.id, projectId: a.projectId, title: a.title, type: a.type, version: a.version, chatId: a.chatId, updatedAt: a.updatedAt };
  if (a.noteId) item.noteId = a.noteId;
  if (a.type === 'SVG' && !/<script/i.test(a.content)) item.previewUrl = svgPreview(a.content);
  return item;
}

export function downloadText(filename: string, text: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export const artifactSource: ArtifactSource = {
  async list(pid) { return (await listArtifacts(pid)).map(toListItem); },
  get: getArtifact,
  remove: deleteArtifact,
  async exportAll(pid) {
    const all = await listArtifacts(pid);
    downloadText(`artifacts-${pid}.json`, JSON.stringify({ format: 'notlinear-artifacts/v1', projectId: pid, artifacts: all }, null, 2), 'application/json');
  },
};
