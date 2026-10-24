import type { ProjectArtifact } from './extras/types';

/** An artifact's preview: its real thumbnail when the source provides one, otherwise a striped placeholder labelled with its type. */
export function ArtifactThumb({ artifact, className }: { artifact: ProjectArtifact; className?: string }) {
  if (artifact.previewUrl) return <img src={artifact.previewUrl} alt="" className={`w-full border border-sec-artifacts-line object-cover ${className ?? ''}`} />;
  return (
    <div className={`nl-stripe grid place-items-center border border-sec-artifacts-line font-mono text-xs text-sec-artifacts ${className ?? ''}`}>{artifact.type}</div>
  );
}
