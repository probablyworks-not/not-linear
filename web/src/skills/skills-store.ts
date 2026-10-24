import { create } from 'zustand';
import { createDebouncedWriter } from '../lib/debounced-writer';
import { BUILTIN_SKILLS } from './builtin';
import { diffOverride, resolveSkills } from './merge-skills';
import { slugify } from './parse-skill';
import { loadSkillsData, saveCustom, saveMeta, saveOverrides, type SkillsData } from './skills-repo';
import { selectSkills, type Selection } from './select-skills';
import { DEFAULT_SKILLS_META, type ResolvedSkill, type Skill } from './types';

// A small feature store, flat (CLAUDE.md). It owns the notlinear-skills db; the app/chat stores are untouched.

interface SkillsState extends SkillsData {
  loaded: boolean;
  load(): Promise<void>;
  /** Edits a built-in (stores an override) or replaces a custom skill. Debounced: this is typed text. */
  save(name: string, patch: Partial<Skill>): void;
  create(skill: Partial<Skill>): string;
  /** Renames a custom skill to a slug of `next`. Built-ins keep their name. Returns the new name, or null if refused (blank, taken, built-in). */
  rename(name: string, next: string): string | null;
  /** Clears a built-in's override; deletes a custom skill. */
  remove(name: string): void;
  setEnabled(name: string, on: boolean): void;
  setPinned(name: string, on: boolean): void;
  setAuto(on: boolean): void;
}

const writer = createDebouncedWriter<'overrides' | 'custom'>();

export const useSkillsStore = create<SkillsState>((set, get) => ({
  overrides: {}, custom: [], meta: DEFAULT_SKILLS_META, loaded: false,

  async load() {
    if (get().loaded) return;
    try {
      set({ ...(await loadSkillsData()), loaded: true });
    } catch {
      // IndexedDB can be unavailable (private window). Built-ins still work, edits just won't persist.
      set({ loaded: true });
    }
  },

  save(name, patch) {
    const base = BUILTIN_SKILLS.find(b => b.name === name);
    if (base) {
      const next = { ...get().overrides };
      const o = diffOverride(base, patch);
      if (o) next[name] = o; else delete next[name];
      set({ overrides: next });
      writer.schedule('overrides', () => saveOverrides(get().overrides));
    } else {
      set({ custom: get().custom.map(c => (c.name === name ? { ...c, ...patch, name: c.name } : c)) });
      writer.schedule('custom', () => saveCustom(get().custom));
    }
  },

  create(partial) {
    const taken = new Set([...BUILTIN_SKILLS, ...get().custom].map(s => s.name));
    const base = slugify(partial.name ?? '') || 'new-skill';
    let name = base;
    for (let i = 2; taken.has(name); i++) name = `${base}-${i}`;
    const skill: Skill = {
      description: '', layer: 'custom', whenToUse: '', keywords: [], priority: 0, always: false, auto: true, tools: [], body: '',
      ...partial, name,
    };
    set({ custom: [...get().custom, skill] });
    void saveCustom(get().custom);
    return name;
  },

  rename(name, next) {
    const slug = slugify(next);
    const { custom, meta } = get();
    if (!slug || slug === name || !custom.some(c => c.name === name)) return null;
    if ([...BUILTIN_SKILLS, ...custom].some(s => s.name === slug)) return null;
    const swap = (list: string[]): string[] => list.map(n => (n === name ? slug : n));
    const nextMeta = { ...meta, disabled: swap(meta.disabled), pinned: swap(meta.pinned) };
    set({ custom: custom.map(c => (c.name === name ? { ...c, name: slug } : c)), meta: nextMeta });
    void saveCustom(get().custom);
    void saveMeta(nextMeta);
    return slug;
  },

  remove(name) {
    if (BUILTIN_SKILLS.some(b => b.name === name)) {
      const rest = { ...get().overrides };
      delete rest[name];
      set({ overrides: rest });
      void saveOverrides(rest);
    } else {
      set({ custom: get().custom.filter(c => c.name !== name) });
      void saveCustom(get().custom);
    }
    const meta = { ...get().meta, disabled: get().meta.disabled.filter(n => n !== name), pinned: get().meta.pinned.filter(n => n !== name) };
    set({ meta });
    void saveMeta(meta);
  },

  setEnabled(name, on) {
    const disabled = get().meta.disabled.filter(n => n !== name);
    if (!on) disabled.push(name);
    const meta = { ...get().meta, disabled };
    set({ meta });
    void saveMeta(meta);
  },

  setPinned(name, on) {
    const pinned = get().meta.pinned.filter(n => n !== name);
    if (on) pinned.push(name);
    const meta = { ...get().meta, pinned };
    set({ meta });
    void saveMeta(meta);
  },

  setAuto(on) {
    const meta = { ...get().meta, auto: on };
    set({ meta });
    void saveMeta(meta);
  },
}));

export function resolvedSkills(s: Pick<SkillsData, 'overrides' | 'custom' | 'meta'>): ResolvedSkill[] {
  return resolveSkills(BUILTIN_SKILLS, s.overrides, s.custom, s.meta);
}

/** Flushes pending edits (call before reading from the db, e.g. on dialog close). */
export const flushSkillWrites = (): Promise<void> => writer.flushAll();

/** Selection for one outgoing turn, from the live store. Loads the db on first use. */
export async function selectForTurn(query: string, context?: string, forced?: string[]): Promise<Selection[]> {
  await useSkillsStore.getState().load();
  const s = useSkillsStore.getState();
  return selectSkills({ skills: resolvedSkills(s), meta: s.meta, query, context, forced });
}
