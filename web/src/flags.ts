import { useSyncExternalStore } from 'react';
import defaults from '../../backend/cloud/features.json';
export type FeatureId = keyof typeof defaults;
export type FeatureFlags = Record<FeatureId, boolean>;
export const featureDefaults: FeatureFlags = { ...defaults };
const dependencies: Partial<Record<FeatureId, FeatureId[]>> = {
  chatNotes: ['notesV2', 'chat'],
  contextRanking: ['attachments'], linkedFolders: ['attachments'],
};
export function resolveFlags(input: Partial<FeatureFlags>): FeatureFlags {
  const result = { ...featureDefaults, ...input };
  for (const [key, parents] of Object.entries(dependencies)) {
    result[key as FeatureId] = result[key as FeatureId] && parents.every(p => result[p]);
  }
  return result;
}
// Stable identity preserves existing non-React callers; subscribers rerender after each change.
export const flags: FeatureFlags = resolveFlags({});
let version = 0;
const listeners = new Set<() => void>();
export function applyFlags(input: Partial<FeatureFlags>): void {
  const next=resolveFlags(input);
  const changed=(Object.keys(next) as FeatureId[]).filter(key=>next[key]!==flags[key]);
  if(!changed.length)return;
  Object.assign(flags,next); version++; listeners.forEach(fn => fn());
  window.dispatchEvent(new CustomEvent('notlinear:flags',{detail:{disabled:changed.filter(key=>!next[key])}}));
}
export function subscribeFlags(fn: () => void): () => void { listeners.add(fn); return () => listeners.delete(fn); }
export function useFeatureFlags(): FeatureFlags {
  useSyncExternalStore(subscribeFlags, () => version);
  return flags;
}
export function requireFeature(id: FeatureId): void {
  if (!flags[id]) throw new Error('This feature is currently unavailable. Your saved work is preserved.');
}
export function featureForView(view: string): FeatureId | null {
  return ({ chat:'chat', notes:'notesV2', canvas:'canvas', sketch:'sketch' } as Record<string, FeatureId>)[view] ?? null;
}
