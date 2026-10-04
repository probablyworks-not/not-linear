// View registry — tracks registered views and manages the active one.
// A view is { id, label, icon, mount, unmount }.
// Adding a new feature: drop a module in frontend/views/, call registerView(),
// then mountView(id) to activate it.
//
// This is the self-registering-views pattern referenced in AGENTS.md: each
// feature module (frontend/views/notes.js)
// imports this file and calls registerView() at load time instead of
// app.js knowing about every view up front. app.js is still the one that
// decides *when* to call mountView() (e.g. sidebar clicks, tab clicks), and
// it is also the only module that calls registerChatOpener/registerNoteOpener/
// registerTabRefresher to install its own DOM-manipulating callbacks here —
// see the "Bridge" section below for why that indirection exists.
//
// Relationship to other core/ modules: this file has no dependency on
// core/state.js or core/store.js — it only tracks the { id -> view } map and
// which id is active, plus a few cross-module callback hooks. Persisting
// which view/thread is open is handled separately by core/store.js.

const views = new Map();
let activeViewId = null;
// notlinear Redesign TASK-RD09: tab strip needs to know when the active view
// changes, no matter which of the ~10 existing mountView() call sites
// triggered it (sidebar, breadcrumb, back buttons, etc.) — a subscription
// here means none of those call sites need to change.
const listeners = new Set();

// Register a view descriptor ({ id, label, icon, mount, unmount }) so it can
// later be activated with mountView(id). Called once per feature module at
// module-evaluation time (self-registration) — see app.js, frontend/views/notes.js
// for the call sites. Views are additive;
// there is no unregisterView, since features are expected to live for the
// lifetime of the page.
export function registerView(view){
  views.set(view.id, view);
}

// Switch the active view: unmounts whatever view is currently active (if any),
// marks `id` active, mounts it, then notifies any onViewChange() subscribers.
// Called from app.js at roughly a dozen sites (sidebar clicks, breadcrumb/back
// navigation, tab clicks, etc.) and from frontend/views/notes.js
// when that feature needs to switch back to
// the chat view or to themselves. `mount`/`unmount` on the view descriptor are
// optional — views that don't need setup/teardown can omit them.
export function mountView(id){
  if (activeViewId && views.has(activeViewId)){
    views.get(activeViewId).unmount?.();
  }
  activeViewId = id;
  views.get(id)?.mount?.();
  listeners.forEach(fn => fn(id));
}

// Subscribe to active-view changes; `fn(id)` fires on every mountView() call,
// regardless of which of the many call sites triggered it (see TASK-RD09 note
// above). Returns an unsubscribe function. Currently only app.js uses this,
// to keep its tab-strip UI in sync without every mountView() caller having to
// remember to update the tab strip itself.
export function onViewChange(fn){
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Return all registered view descriptors as an array snapshot. Exported for
// any UI that needs to enumerate views (e.g. a view switcher); no current
// caller in frontend/ uses it, but it's kept as the read-side counterpart to
// registerView().
export function getRegisteredViews(){
  return [...views.values()];
}

// Return the id of the currently mounted view (or null before the first
// mountView() call). Used by app.js and by core/feedback.js, which tags each
// saved feedback entry with the view it was filed from.
export function getActiveViewId(){
  return activeViewId;
}

// Bridge for feature modules (e.g. Notes @-mentions) that need to open a chat
// thread as a tab but can't import app.js's still-un-modularized tab-strip
// closures directly. app.js registers its real opener once at init.
// registerChatOpener: called once by app.js at startup to install its real
// "open this thread id as a tab" implementation.
let chatOpener = null;
export function registerChatOpener(fn){
  chatOpener = fn;
}
// openChatTab: called by frontend/views/notes.js (e.g. an @-mention linking to
// a chat thread) to open a chat tab without importing app.js directly. A
// no-op if app.js hasn't registered an opener yet.
export function openChatTab(id){
  chatOpener?.(id);
}

// registerNoteOpener: called once by app.js at startup to install its
// "open this note id as a tab" implementation (mirrors registerChatOpener).
let noteOpener = null;
export function registerNoteOpener(fn){
  noteOpener = fn;
}
// openNoteTab: called by frontend/views/notes.js to open a note as a tab via
// app.js's tab strip. Returns false (instead of silently no-op'ing) when no
// opener has been registered yet, so the caller can decide how to handle it.
export function openNoteTab(id){
  if (!noteOpener) return false;
  noteOpener(id);
  return true;
}

// registerTabRefresher: called once by app.js at startup to install the
// callback that re-renders its open-tabs UI.
let tabRefresher = null;
export function registerTabRefresher(fn){
  tabRefresher = fn;
}
// refreshOpenTabs: called by frontend/views/notes.js after it changes
// something that affects tab labels (e.g. a note is renamed/deleted) so the
// tab strip in app.js reflects it without notes.js reaching into app.js's DOM.
export function refreshOpenTabs(){
  tabRefresher?.();
}
