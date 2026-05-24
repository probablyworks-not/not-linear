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
