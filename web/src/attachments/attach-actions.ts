import { pickFiles } from './pick-files';
import { readFiles, type Attachment } from './read-files';
import { useAttachments } from './attachments-store';
import { titleFromQuote } from '../branch/actions';
import type { BranchRow } from '../chat/branch-model';
import type { PersistedThread } from '../db/types';

/** "Add files" / "Add folder": pick, read, and attach to a composer. Call straight from the click (see pick-files.ts). */
export async function addFilesTo(key: string, folder: boolean): Promise<void> {
  const picked = await pickFiles({ folder });
  if (!picked.length) return;
  useAttachments.getState().add(key, await readFiles(picked));
}

/** Pasting images into the composer attaches them instead of pasting nothing (app.js:3466). */
export async function addPastedFiles(key: string, files: File[]): Promise<void> {
  if (!files.length) return;
  useAttachments.getState().add(key, await readFiles(files));
}

/** The image files on a clipboard, if any. */
export function imagesFromClipboard(data: DataTransfer | null): File[] {
  const items = data?.items ? [...data.items] : [];
  return items.filter(i => i.kind === 'file' && i.type.startsWith('image/')).map(i => i.getAsFile()).filter((f): f is File => !!f);
}

/** A branch's saved messages, as plain text lines (app.js branchMessagesFor / branchToAttachment). */
export function branchToAttachment(thread: PersistedThread | undefined, row: BranchRow): Attachment & { branchId: string; messageCount: number } {
  const messages = (thread?.branchSnapshots?.[row.id]?.messages ?? []) as Array<{ role: string; content: unknown }>;
  const transcript = messages.map(m => `[${m.role}] ${typeof m.content === 'string' ? m.content : ''}`).join('\n\n');
  return {
    name: titleFromQuote(row.quote || 'Untitled branch'),
    kind: 'branch',
    size: 0,
    type: '',
    branchId: row.id,
    quote: row.quote || '',
    messageCount: messages.length,
    content: `Quote explored: "${row.quote || ''}"\n\n${transcript}`,
  };
}
