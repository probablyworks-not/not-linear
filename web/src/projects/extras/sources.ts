import type { ProjectArtifact, ProjectMemoryItem, StoredArtifact } from './types';

/**
 * Where artifacts and memory come from. The project screen only talks to these two interfaces, so the
 * backend work is: implement them and call setProjectSources() once at startup. Until then both are empty.
 */
export interface ArtifactSource {
  list(projectId: string): Promise<ProjectArtifact[]>;
  /** "Export all". When absent the button says it is not available yet. */
  exportAll?(projectId: string): Promise<void>;
  /** One artifact with its content, for the viewer. */
  get?(id: string): Promise<StoredArtifact | null>;
  remove?(id: string): Promise<void>;
}

export interface MemorySource {
  list(projectId: string): Promise<ProjectMemoryItem[]>;
  remove?(projectId: string, id: string): Promise<void>;
}

export interface ProjectSources { artifacts: ArtifactSource; memory: MemorySource }

const empty: ProjectSources = {
  artifacts: { list: async () => [] },
  memory: { list: async () => [] },
};

let current: ProjectSources = empty;

export const getProjectSources = (): ProjectSources => current;
export function setProjectSources(next: Partial<ProjectSources>): void { current = { ...empty, ...next }; }
