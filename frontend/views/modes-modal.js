// Modes manager modal — list, create, edit, reset and delete conversation
// modes (system-prompt instructions). Data lives in core/modes.js; this file is
// presentation only. app.js wires it up via initModesModal() and supplies the
// onChange callback (persist + re-render chips) and the shared delete-confirm.
import { esc } from '../core/markdown.js';
import { toast } from '../core/ui.js';
import { appState } from '../core/state.js';
import { getModes, getMode, saveMode, resetMode, deleteMode } from '../core/modes.js';

const NEW_ID = '__new__';
let modal, listEl, onChange, confirmDelete;
let openId = null;   // id of the row whose editor is expanded (NEW_ID for a draft)

export function isModesModalOpen(){ return !!modal?.classList.contains('show'); }

export function openModesModal(){
  openId = null;
  render();
  modal.classList.add('show');
  modal.setAttribute('aria-hidden', 'false');
}

export function closeModesModal(){
  modal.classList.remove('show');
  modal.setAttribute('aria-hidden', 'true');
  openId = null;
}

export function initModesModal({ onChange: change, confirmDeleteItem }){
  modal = document.querySelector('#modes-modal');
  listEl = document.querySelector('#modes-list');
  onChange = change;
  confirmDelete = confirmDeleteItem;
  if (!modal) return;
  modal.addEventListener('click', e => { if (e.target === modal) closeModesModal(); });
  document.querySelector('#modes-close').addEventListener('click', closeModesModal);
  document.querySelector('#modes-new').addEventListener('click', () => { openId = NEW_ID; render(); focusName(); });
  listEl.addEventListener('click', onListClick);
}

function focusName(){ setTimeout(() => listEl.querySelector('.mode-name')?.focus(), 0); }

function rowHtml(m){
  const badge = m.builtin ? (m.edited ? 'Edited' : 'Built-in') : 'Custom';
  const active = m.id === appState.prefs.mode ? '<span class="mode-badge on">Active</span>' : '';
  return `<div class="mode-row${openId === m.id ? ' open' : ''}" data-id="${esc(m.id)}">
    <button class="mode-row-head" data-act="toggle">
      <i class="ti ${esc(m.icon)}"></i>
      <span class="mode-row-copy"><span class="mode-row-label">${esc(m.label)}</span>${m.desc ? `<span class="desc">${esc(m.desc)}</span>` : ''}</span>
      ${active}<span class="mode-badge">${badge}</span>
      <i class="ti ti-chevron-down mode-chev"></i>
    </button>
    ${openId === m.id ? editorHtml(m) : ''}
  </div>`;
}

function editorHtml(m){
  const isNew = m.id === NEW_ID;
  return `<div class="mode-editor">
    <label>Name<input class="mode-name" maxlength="30" value="${esc(m.label)}" placeholder="e.g. Teacher"></label>
    <label>Short description<input class="mode-desc" maxlength="50" value="${esc(m.desc)}" placeholder="Shown under the name in the menu"></label>
    <label>Instructions<textarea class="mode-instr" rows="8" placeholder="How should Claude respond in this mode? Added to the system prompt.">${esc(m.instructions)}</textarea></label>
    <div class="mode-actions">
      ${m.builtin && m.edited ? '<button data-act="reset" class="mode-btn">Reset to default</button>' : ''}
      ${!isNew && !m.builtin ? '<button data-act="delete" class="mode-btn danger">Delete</button>' : ''}
      <span class="mode-spacer"></span>
      <button data-act="cancel" class="mode-btn">Cancel</button>
      <button data-act="save" class="mode-btn primary">${isNew ? 'Create' : 'Save'}</button>
    </div>
  </div>`;
}

function render(){
  const modes = getModes();
  if (openId === NEW_ID) modes.unshift({ id:NEW_ID, label:'', desc:'', instructions:'', icon:'ti-sparkles', builtin:false, edited:false });
  listEl.innerHTML = modes.map(rowHtml).join('');
}

async function onListClick(e){
  const actEl = e.target.closest('[data-act]');
  const row = e.target.closest('.mode-row');
  if (!actEl || !row) return;
  const id = row.dataset.id;
  const act = actEl.dataset.act;
  if (act === 'toggle'){ openId = openId === id ? null : id; render(); if (openId) focusName(); return; }
  if (act === 'cancel'){ openId = null; render(); return; }
  if (act === 'save'){
    const label = row.querySelector('.mode-name').value.trim();
    if (!label){ toast('Give the mode a name'); row.querySelector('.mode-name').focus(); return; }
    const desc = row.querySelector('.mode-desc').value.trim();
    const instructions = row.querySelector('.mode-instr').value.trim();
    saveMode({ id:id === NEW_ID ? '' : id, label, desc, instructions });
    openId = null;
    render(); onChange();
    toast(id === NEW_ID ? `Created "${label}"` : `Saved "${label}"`);
    return;
  }
  if (act === 'reset'){
    resetMode(id); openId = null; render(); onChange();
    toast('Reset to default');
    return;
  }
  if (act === 'delete'){
    const m = getMode(id);
    const ok = await confirmDelete({ heading:'Delete mode?', name:m.label, before:'This removes the mode', after:'. Chats using it fall back to General.', actionLabel:'Delete mode' });
    if (!ok) return;
    deleteMode(id); openId = null; render(); onChange();
    toast('Mode deleted');
  }
}
