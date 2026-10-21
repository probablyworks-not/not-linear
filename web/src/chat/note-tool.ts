import { useAppStore } from '../state/app-store';
import { backupRecord, createNoteFrom } from '../notes/notes-repo';
import { useNotesStore } from '../notes/notes-store';
import { markdownToBlocks } from '../notes/markdown-to-blocks';

// The create_note tool's runner. A document the model wrote for keeping is filed in Notes (own db,
// ADR-007), under the chat's project, and the model is told it worked so it answers in a sentence
// instead of repeating the document. Failure comes back as text the model can act on: with Notes
// still locked behind the backup, it should say so and give the document in the reply instead.

export interface NoteRef { id: string; title: string }

const DEFAULT_ICON = '\u{1F4C4}';
const MAX_TITLE = 120;

const cleanTitle = (t: unknown): string => {
  const s = typeof t === 'string' ? t.replace(/\s+/g, ' ').trim() : '';
  return (s || 'Untitled note').slice(0, MAX_TITLE);
};

export async function runCreateNote(
  input: Record<string, unknown>,
  ctx: { threadId: string; onCreated(ref: NoteRef): void },
): Promise<string> {
  const content = typeof input.content === 'string' ? input.content.trim() : '';
  if (!content) return 'Tool error (create_note): content is empty. Nothing was saved.';
  if (!backupRecord()) {
    return 'Tool error (create_note): Notes are locked until the user backs them up (Notes > back up). Nothing was saved. Give the document in your reply, and mention they can back up Notes to enable saving.';
  }
  const title = cleanTitle(input.title);
  const pid = useAppStore.getState().threadState[ctx.threadId]?.projectId;
  try {
    const note = await createNoteFrom({ title, blocks: markdownToBlocks(content), emoji: DEFAULT_ICON, projectId: typeof pid === 'string' ? pid : null });
    await useNotesStore.getState().load();
    ctx.onCreated({ id: note.id, title });
    return `Saved as a note titled "${title}". The user can open it from the card shown under your reply. Reply in one to three sentences about what it covers; do not repeat its content.`;
  } catch (e) {
    return `Tool error (create_note): ${e instanceof Error ? e.message : String(e)}. Nothing was saved. Give the document in your reply instead.`;
  }
}
