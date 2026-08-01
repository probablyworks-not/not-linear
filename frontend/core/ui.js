// UI primitives — toast and confirm dialog.
// No app state dependencies; safe to import early.
// DOM queries run at module evaluation time (ES modules load after DOM is ready).

// ---------- toast ----------
const toastEl = document.querySelector('#toast');
const toastText = document.querySelector('#toast-text');
let toastT;
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
const deleteConfirm = document.querySelector('#delete-confirm');
const deleteConfirmTitle = document.querySelector('#delete-confirm-title');
const deleteConfirmDesc = document.querySelector('#delete-confirm-desc');
const deleteConfirmName = document.querySelector('#delete-confirm-name');
const deleteConfirmCancel = document.querySelector('#delete-confirm-cancel');
const deleteConfirmDelete = document.querySelector('#delete-confirm-delete');
let pendingDeleteConfirm = null;
let lastConfirmFocus = null;

function closeDeleteConfirm(result = false){
  if (!pendingDeleteConfirm) return;
  const resolve = pendingDeleteConfirm;
  pendingDeleteConfirm = null;
  deleteConfirm.classList.remove('show');
  deleteConfirm.setAttribute('aria-hidden', 'true');
  if (lastConfirmFocus?.focus) lastConfirmFocus.focus();
  resolve(result);
}

export function isDeleteConfirmOpen(){ return !!pendingDeleteConfirm; }
export function isDeleteConfirmDeleteFocused(){ return document.activeElement === deleteConfirmDelete; }
export function cancelDeleteConfirm(){ closeDeleteConfirm(false); }
export function acceptDeleteConfirm(){ closeDeleteConfirm(true); }

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
