import type { PersistedPrefs, PersistedState } from './types';

// The twelve prefs persistAll() writes (store.js:67-80) — and no others. A
// `setPref` for anything else would put a field in the row that legacy neither
// reads nor round-trips, so the type forbids it. `thinking` is deliberately
// absent from what Settings edits: legacy forces it false on every load.
export type PrefKey = keyof PersistedPrefs;

export function setPrefIn<K extends PrefKey>(state: PersistedState, key: K, value: PersistedPrefs[K]): void {
  state.prefs[key] = value;
}
