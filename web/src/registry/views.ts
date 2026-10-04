import { useSyncExternalStore } from 'react';

// Port of frontend/core/registry.js — same semantics, so P7's plugin seam can
// register views exactly the way legacy modules do. A view is
// { id, label, mount?, unmount? }.
//
// Deliberately dropped: registerChatOpener / registerNoteOpener /
// registerTabRefresher. Those exist only because a feature module could not
// import app.js's un-modularised tab strip. In React they are store actions
// (useUiStore.activateTab), so the indirection has nothing left to bridge.

export interface ViewDescriptor {
  id: string;
  label: string;
  mount?(): void;
  unmount?(): void;
}

const views = new Map<string, ViewDescriptor>();
let activeViewId: string | null = null;
const listeners = new Set<(id: string) => void>();

/** Views are additive for the life of the page; there is no unregister. */
export function registerView(view: ViewDescriptor): void {
  views.set(view.id, view);
}

/** Unmounts the active view, activates `id`, mounts it, then notifies. */
export function mountView(id: string): void {
  if (activeViewId) views.get(activeViewId)?.unmount?.();
  activeViewId = id;
  views.get(id)?.mount?.();
  listeners.forEach(fn => fn(id));
}

/** Fires on every mountView(), whichever call site triggered it. */
export function onViewChange(fn: (id: string) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function getRegisteredViews(): ViewDescriptor[] {
  return [...views.values()];
}

export function getActiveViewId(): string | null {
  return activeViewId;
}

/** React binding: re-renders when the active view changes. */
export function useActiveViewId(): string | null {
  return useSyncExternalStore(
    cb => onViewChange(cb),
    getActiveViewId,
  );
}

/** Test seam. */
export function resetRegistryForTests(): void {
  views.clear();
  listeners.clear();
  activeViewId = null;
}
