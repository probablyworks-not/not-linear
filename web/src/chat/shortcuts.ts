import { useChatStore } from './chat-store';
import { branchFromSelection } from './marking';
import { readSelection } from './selection';
import { historyFor, retryTurn } from './send';
import { toast } from '../ui/toast';

/** ⌘⇧B: branch from whatever is selected in the thread, the keyboard twin of the popover's Branch. */
export async function branchCurrentSelection(threadId: string): Promise<void> {
  const info = readSelection();
  if (!info) { toast('Select some text in a reply to branch from it'); return; }
  await branchFromSelection(threadId, info);
}

/** ⌘⇧C: copies the newest assistant reply as the model wrote it (the same text the Copy button copies). */
export async function copyLastReply(threadId: string): Promise<void> {
  const last = [...historyFor(threadId)].reverse().find(m => m.role === 'assistant');
  const text = typeof last?.content === 'string'
    ? last.content
    : (last?.content ?? []).map(b => (b.type === 'text' && typeof b.text === 'string' ? b.text : '')).join('');
  if (!text.trim()) { toast('No reply to copy yet'); return; }
  try { await navigator.clipboard.writeText(text); toast('Reply copied'); }
  catch { toast('Could not copy to the clipboard'); }
}

/** ⌘⇧R: re-runs a turn that failed. A finished reply is not regenerated (see CHANGES.md). */
export async function retryFailedTurn(threadId: string): Promise<void> {
  if (!useChatStore.getState().failed[threadId]) { toast('Nothing to retry: the last reply finished'); return; }
  await retryTurn(threadId);
}
