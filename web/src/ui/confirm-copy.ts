import type { ConfirmRequest } from '../state/ui-store';

// Exact wording from frontend/core/ui.js:116-137. User-visible, and asserted
// in smoke step 3 — change it in neither place without the other.
export function confirmDeleteChat(title: string): ConfirmRequest {
  return {
    heading: 'Delete chat?',
    name: title,
    before: 'This removes',
    after: ' from the left panel and clears its saved messages.',
    actionLabel: 'Delete chat',
  };
}

export function confirmDeleteBranch(title: string, count = 1): ConfirmRequest {
  const childCount = Math.max(0, count - 1);
  return {
    heading: count > 1 ? 'Delete branches?' : 'Delete branch?',
    name: title,
    before: 'This removes',
    after: count > 1
      ? ` and ${childCount} child branch${childCount === 1 ? '' : 'es'} from this chat.`
      : ' from this chat and clears its saved messages.',
    actionLabel: count > 1 ? 'Delete branches' : 'Delete branch',
  };
}

/** app.js:5677. */
export function confirmDeleteProject(name: string): ConfirmRequest {
  return {
    heading: 'Delete project?',
    name,
    before: 'This removes the project',
    after: '. Its chats are kept and moved back to Threads.',
    actionLabel: 'Delete project',
  };
}

/** Canvas (C2). Unlike a chat or a project, a deleted canvas is really gone — say so. */
export function confirmDeleteCanvas(title: string): ConfirmRequest {
  return {
    heading: 'Delete canvas?',
    name: title,
    before: 'This removes',
    after: ' and everything in it. This cannot be undone.',
    actionLabel: 'Delete canvas',
  };
}
