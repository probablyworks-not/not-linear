// View registry — tracks registered views and manages the active one.
// A view is { id, label, icon, mount, unmount }.
// Adding a new feature: drop a module in frontend/views/, call registerView(),
// then mountView(id) to activate it.

const views = new Map();
let activeViewId = null;
// notlinear Redesign TASK-RD09: tab strip needs to know when the active view
// changes, no matter which of the ~10 existing mountView() call sites
// triggered it (sidebar, breadcrumb, back buttons, etc.) — a subscription
// here means none of those call sites need to change.
const listeners = new Set();

export function registerView(view){
  views.set(view.id, view);
}

export function mountView(id){
  if (activeViewId && views.has(activeViewId)){
    views.get(activeViewId).unmount?.();
  }
  activeViewId = id;
  views.get(id)?.mount?.();
  listeners.forEach(fn => fn(id));
}

export function onViewChange(fn){
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getRegisteredViews(){
  return [...views.values()];
}

export function getActiveViewId(){
  return activeViewId;
}

// Bridge for feature modules (e.g. Notes @-mentions) that need to open a chat
// thread as a tab but can't import app.js's still-un-modularized tab-strip
// closures directly. app.js registers its real opener once at init.
let chatOpener = null;
export function registerChatOpener(fn){
  chatOpener = fn;
}
export function openChatTab(id){
  chatOpener?.(id);
}

let noteOpener = null;
export function registerNoteOpener(fn){
  noteOpener = fn;
}
export function openNoteTab(id){
  if (!noteOpener) return false;
  noteOpener(id);
  return true;
}

let tabRefresher = null;
export function registerTabRefresher(fn){
  tabRefresher = fn;
}
export function refreshOpenTabs(){
  tabRefresher?.();
}
