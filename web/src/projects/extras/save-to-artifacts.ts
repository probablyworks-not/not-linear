import { toast } from 'sonner';
import { saveArtifact, type SaveArtifactInput } from '../../db/artifacts-repo';
import { useExtrasStore } from './extras-store';

/** Saves to the project's artifacts, refreshes its card, and says what happened. Never throws. */
export async function saveToArtifacts(input: SaveArtifactInput, opts: { quiet?: boolean } = {}): Promise<boolean> {
  try {
    const { artifact, created, changed } = await saveArtifact(input);
    await useExtrasStore.getState().load(input.projectId);
    if (!opts.quiet) toast(!changed ? 'Already in artifacts, no changes' : created ? 'Saved to artifacts' : `Saved to artifacts as v${artifact.version}`);
    return true;
  } catch (e) {
    toast.error(`Could not save to artifacts: ${e instanceof Error ? e.message : String(e)}`);
    return false;
  }
}
