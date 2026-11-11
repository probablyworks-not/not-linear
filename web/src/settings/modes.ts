import type { PersistedPrefs } from '../db/types';
import { CUSTOM_MODE_ICON, DEFAULT_MODE_ID, DEFAULT_MODES, type ModeDef } from './default-modes';

// Port of frontend/core/modes.js (ADR-046): a mode is only a system prompt.
// Built-ins live in code; user edits are stored as per-field OVERRIDES in
// prefs.modeOverrides and user-created modes in prefs.customModes, merged at
// read time, so improvements to a built-in still reach users who never edited
// it and "Reset to default" is just deleting the override.
//
// Same behaviour, different plumbing: legacy reads a global `appState`; these
// take the prefs object. They mutate only the three keys modes own —
// modeOverrides, customModes, and `mode` (when the active mode is deleted) —
// and always by REASSIGNING, never mutating nested values, so a shallow copy
// of prefs is a safe working copy. tests/settings/modes-differential.test.ts
// runs random operation sequences through both implementations.

export { DEFAULT_MODE_ID, CUSTOM_MODE_ICON, DEFAULT_MODES };
export type { ModeDef };

export interface Mode extends ModeDef { builtin: boolean; edited: boolean }

type ModePrefs = Pick<PersistedPrefs, 'mode' | 'modeOverrides' | 'customModes'>;
type Override = Partial<Pick<ModeDef, 'label' | 'desc' | 'instructions'>>;

/** The prefs keys a mode edit may change. The store persists exactly these. */
export const MODE_PREF_KEYS = ['modeOverrides', 'customModes', 'mode'] as const;

/** Built-ins with overrides applied, then custom modes. */
export function getModes(prefs: ModePrefs): Mode[] {
  const overrides = (prefs.modeOverrides ?? {}) as Record<string, Override | undefined>;
  const builtins = DEFAULT_MODES.map(m => {
    const o = overrides[m.id];
    return { ...m, ...(o ?? {}), builtin: true, edited: !!o };
  });
  const custom = ((prefs.customModes ?? []) as Array<Partial<ModeDef> & { id: string }>).map(m => ({
    icon: CUSTOM_MODE_ICON, desc: '', instructions: '', label: '', ...m, builtin: false, edited: false,
  }));
  return [...builtins, ...custom];
}

/** Resolves an id, falling back to the first mode (General) for unknown or deleted ids. */
export function getMode(prefs: ModePrefs, id: string | undefined = prefs.mode): Mode {
  const all = getModes(prefs);
  return all.find(m => m.id === id) ?? all[0]!;
}

export function hasMode(prefs: ModePrefs, id: string): boolean {
  return getModes(prefs).some(m => m.id === id);
}

export function newModeId(): string {
  return 'custom-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/**
 * Creates (id matches nothing) or updates. A built-in stores an override
 * holding only the fields that differ from its default — and none at all if
 * nothing differs. A custom mode is replaced wholesale. Returns the saved id.
 */
export function saveMode(
  prefs: ModePrefs,
  { id, label, desc, instructions }: { id: string; label: string; desc: string; instructions: string },
  makeId: () => string = newModeId,
): string {
  const builtin = DEFAULT_MODES.find(m => m.id === id);
  if (builtin) {
    const o: Override = {};
    if (label !== builtin.label) o.label = label;
    if (desc !== builtin.desc) o.desc = desc;
    if (instructions !== builtin.instructions) o.instructions = instructions;
    const next = { ...((prefs.modeOverrides ?? {}) as Record<string, Override>) };
    if (Object.keys(o).length) next[id] = o;
    else delete next[id];
    prefs.modeOverrides = next;
    return id;
  }
  const list = [...((prefs.customModes ?? []) as Array<{ id: string }>)];
  const i = list.findIndex(m => m.id === id);
  if (i >= 0) {
    list[i] = { id, label, desc, instructions } as { id: string };
    prefs.customModes = list;
    return id;
  }
  const nid = makeId();
  prefs.customModes = [...list, { id: nid, label, desc, instructions }];
  return nid;
}

export function resetMode(prefs: ModePrefs, id: string): void {
  const overrides = prefs.modeOverrides as Record<string, unknown> | undefined;
  if (!overrides || !(id in overrides)) return;
  const next = { ...overrides };
  delete next[id];
  prefs.modeOverrides = next;
}

/** Custom modes only (a built-in can only be reset). Deleting the active mode falls back to General. */
export function deleteMode(prefs: ModePrefs, id: string): void {
  if (DEFAULT_MODES.some(m => m.id === id)) return;
  prefs.customModes = ((prefs.customModes ?? []) as Array<{ id: string }>).filter(m => m.id !== id);
  if (prefs.mode === id) prefs.mode = DEFAULT_MODE_ID;
}

/** System-prompt paragraphs for a mode; empty instructions add nothing. */
export function modeSystemPromptParts(prefs: ModePrefs, id?: string): string[] {
  const text = (getMode(prefs, id).instructions || '').trim();
  return text ? text.split(/\n{2,}/).map(s => s.trim()).filter(Boolean) : [];
}
