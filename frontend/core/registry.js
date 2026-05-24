// View registry — tracks registered views and manages the active one.
// A view is { id, label, icon, mount, unmount }.
// Adding a new feature: drop a module in frontend/views/, call registerView(),
// then mountView(id) to activate it.

const views = new Map();
let activeViewId = null;

export function registerView(view){
  views.set(view.id, view);
}

export function mountView(id){
  if (activeViewId && views.has(activeViewId)){
    views.get(activeViewId).unmount?.();
  }
  activeViewId = id;
  views.get(id)?.mount?.();
}

export function getRegisteredViews(){
  return [...views.values()];
}

export function getActiveViewId(){
  return activeViewId;
}
