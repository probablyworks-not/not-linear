// UI primitives — toast and confirm dialog.
// No app state dependencies; safe to import early.
// DOM queries run at module evaluation time (ES modules load after DOM is ready).
//
// This module holds small, reusable UI helpers shared across app.js and the
// feature views (frontend/views/notes.js)
// and core/feedback.js — anything that needs to show a toast, a delete
// confirmation dialog, or wire up Tab-inserts-a-tab behavior on a textarea
// imports from here instead of duplicating DOM wiring per feature. It does
// not import core/state.js or core/store.js — it's presentation-only and
// takes whatever data it needs as function arguments.

// ---------- toast ----------
// #toast / #toast-text are expected to exist in the page's static HTML shell
// (see frontend/index.html) — this module assumes they're already in the DOM
// when it's imported.
const toastEl = document.querySelector('#toast');
const toastText = document.querySelector('#toast-text');
let toastT;
// toast: show a brief, auto-dismissing status message. Used all over app.js,
// core/feedback.js and the feature views for lightweight, non-blocking
// feedback (e.g. "Saved", "Screenshot failed"). Re-calling it while a toast is
// already showing resets the dismiss timer via clearTimeout/setTimeout so
// rapid-fire calls don't stack or flicker.
export function toast(msg){
  toastText.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => toastEl.classList.remove('show'), 1800);
}

// ---------- Tab-inserts-a-tab for free-text composers ----------
// Browsers default Tab inside a <textarea> to shifting focus to the next
// focusable element, which reads as "Tab does nothing" in a chat/comment
// composer where the user is typing prose and expects a tab character on
// the current line, not to be bounced out of the field.
// wireTabInsertsTab: attach a keydown listener to `textarea` that makes a
// plain Tab keypress insert a literal tab character at the cursor instead of
// moving focus (Shift/Cmd/Ctrl/Alt+Tab are left alone so accessibility/OS
// shortcuts still work). Called by app.js, core/feedback.js and the feature
// views on their respective composer/text-entry elements. Dispatches a
// synthetic 'input' event afterward so any input listener (autosize,
// debounced-save, etc.) still fires.
export function wireTabInsertsTab(textarea){
  textarea.addEventListener('keydown', e => {
    if (e.key !== 'Tab' || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
    e.preventDefault();
    const start = textarea.selectionStart, end = textarea.selectionEnd;
    textarea.value = textarea.value.slice(0, start) + '\t' + textarea.value.slice(end);
    textarea.selectionStart = textarea.selectionEnd = start + 1;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

// ---------- confirm dialog ----------
// Single shared modal in the static HTML shell (#delete-confirm and its
// children); only one confirmation can be pending at a time (pendingDeleteConfirm).
const deleteConfirm = document.querySelector('#delete-confirm');
const deleteConfirmTitle = document.querySelector('#delete-confirm-title');
const deleteConfirmDesc = document.querySelector('#delete-confirm-desc');
const deleteConfirmName = document.querySelector('#delete-confirm-name');
const deleteConfirmCancel = document.querySelector('#delete-confirm-cancel');
const deleteConfirmDelete = document.querySelector('#delete-confirm-delete');
let pendingDeleteConfirm = null;
let lastConfirmFocus = null;

// closeDeleteConfirm: internal helper that hides the dialog, restores focus to
// whatever had it before the dialog opened, and resolves the Promise returned
// by confirmDeleteItem() with `result` (true = confirmed, false = cancelled).
// A no-op if no confirmation is currently pending.
function closeDeleteConfirm(result = false){
  if (!pendingDeleteConfirm) return;
  const resolve = pendingDeleteConfirm;
  pendingDeleteConfirm = null;
  deleteConfirm.classList.remove('show');
  deleteConfirm.setAttribute('aria-hidden', 'true');
  if (lastConfirmFocus?.focus) lastConfirmFocus.focus();
  resolve(result);
}

// isDeleteConfirmOpen / isDeleteConfirmDeleteFocused / cancelDeleteConfirm /
// acceptDeleteConfirm: small query/action helpers used by app.js's global
// keydown handling (e.g. so Escape/Enter can drive the dialog even though the
// dialog's own state is private to this module).
export function isDeleteConfirmOpen(){ return !!pendingDeleteConfirm; }
export function isDeleteConfirmDeleteFocused(){ return document.activeElement === deleteConfirmDelete; }
export function cancelDeleteConfirm(){ closeDeleteConfirm(false); }
export function acceptDeleteConfirm(){ closeDeleteConfirm(true); }

// confirmDeleteItem: show the shared confirm dialog populated with the given
// copy and return a Promise<boolean> that resolves true if the user clicks
// "delete" (or presses Enter with it focused) and false on cancel/outside
// click/Escape. If a confirmation is already pending, it's cancelled first —
// only one can be shown at a time. Called directly by
// frontend/views/notes.js, and indirectly by confirmDeleteChat/
// confirmDeleteBranch below for the two chat-specific cases used by app.js.
export function confirmDeleteItem({ heading, name, before, after, actionLabel }){
  if (pendingDeleteConfirm) closeDeleteConfirm(false);
  lastConfirmFocus = document.activeElement;
  deleteConfirmTitle.textContent = heading;
  deleteConfirmDesc.textContent = before + ' ';
  deleteConfirmName.textContent = `"${name}"`;
  deleteConfirmDesc.appendChild(deleteConfirmName);
  deleteConfirmDesc.appendChild(document.createTextNode(after));
  deleteConfirmDelete.textContent = actionLabel;
  deleteConfirm.classList.add('show');
  deleteConfirm.setAttribute('aria-hidden', 'false');
  setTimeout(() => deleteConfirmCancel.focus(), 0);
  return new Promise(resolve => { pendingDeleteConfirm = resolve; });
}

// confirmDeleteChat / confirmDeleteBranch: thin wrappers around
// confirmDeleteItem() with the copy for the two chat-deletion cases app.js
// needs (a top-level chat thread vs. a branch, which may take child branches
// with it). Both return the same Promise<boolean> contract as confirmDeleteItem.
export function confirmDeleteChat(title){
  return confirmDeleteItem({
    heading:'Delete chat?',
    name:title,
    before:'This removes',
    after:' from the left panel and clears its saved messages.',
    actionLabel:'Delete chat',
  });
}

export function confirmDeleteBranch(title, count = 1){
  const childCount = Math.max(0, count - 1);
  return confirmDeleteItem({
    heading:count > 1 ? 'Delete branches?' : 'Delete branch?',
    name:title,
    before:'This removes',
    after:count > 1 ? ` and ${childCount} child branch${childCount === 1 ? '' : 'es'} from this chat.` : ' from this chat and clears its saved messages.',
    actionLabel:count > 1 ? 'Delete branches' : 'Delete branch',
  });
}

deleteConfirmCancel.addEventListener('click', () => closeDeleteConfirm(false));
deleteConfirmDelete.addEventListener('click', () => closeDeleteConfirm(true));
deleteConfirm.addEventListener('click', e => {
  if (e.target === deleteConfirm) closeDeleteConfirm(false);
});
