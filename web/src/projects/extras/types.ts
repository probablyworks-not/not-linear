// Shapes for the project screen's two sections that have no backend yet: AI artifacts and Memory.
// They follow the design handoff's data shapes. The UI is complete against these; what is missing is a
// real ArtifactSource / MemorySource (see sources.ts), which is the only thing to write when the backend lands.

export type ArtifactType = 'SVG' | 'MD' | 'TSX' | 'HTML';
export type ArtifactKind = 'document' | 'diagram' | 'code';

export interface ProjectArtifact {
  id: string;
  projectId: string;
  title: string;
  type: ArtifactType;
  version: number;
  /** The chat that produced it; empty for a note the user saved by hand. */
  chatId: string;
  /** The Notes page it came from, when it came from one. */
  noteId?: string;
  updatedAt: number;
  /** Optional rendered thumbnail (data URL or http URL). Without it the card shows the striped placeholder. */
  previewUrl?: string;
}

/** What the artifacts db keeps: the list shape plus the content and its version history. */
export interface StoredArtifact extends ProjectArtifact {
  content: string;
  /** Where it came from: the AI's create_note tool, a code block saved from a reply, or a note the user saved. */
  source: 'ai-note' | 'ai-block' | 'note-save';
  /** Same key in the same project = same artifact, new version. */
  dedupeKey: string;
  versions: { v: number; content: string; at: number }[];
}

export interface ProjectMemoryItem {
  id: string;
  projectId: string;
  /** A decision or preference the AI keeps across this project's chats and branches. */
  text: string;
  /** The chat it was learned in, when known. */
  chatId?: string;
  createdAt: number;
}

export const ARTIFACT_KIND: Record<ArtifactType, ArtifactKind> = { MD: 'document', HTML: 'document', SVG: 'diagram', TSX: 'code' };
