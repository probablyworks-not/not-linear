import { EDITABLE_FIELDS, type ResolvedSkill, type Skill, type SkillOverride, type SkillsMeta } from './types';

// The modes pattern (settings/modes.ts): built-ins live in code, user edits are per-field
// OVERRIDES holding only what differs, custom skills are stored whole. Merged at read time, so a
// better built-in still reaches users who never edited it, and "reset" is deleting the override.

export function resolveSkills(builtins: Skill[], overrides: Record<string, SkillOverride>, custom: Skill[], meta: SkillsMeta): ResolvedSkill[] {
  const mk = (s: Skill, builtin: boolean, edited: boolean): ResolvedSkill => ({
    ...s, builtin, edited, enabled: !meta.disabled.includes(s.name), pinned: meta.pinned.includes(s.name),
  });
  const own = new Set(builtins.map(b => b.name));
  return [
    ...builtins.map(b => {
      const o = overrides[b.name];
      return mk({ ...b, ...(o ?? {}) }, true, !!o && Object.keys(o).length > 0);
    }),
    // A custom skill may not shadow a built-in name.
    ...custom.filter(c => !own.has(c.name)).map(c => mk(c, false, false)),
  ];
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The override for `next` against the built-in `base`: only differing editable fields, or null if none. */
export function diffOverride(base: Skill, next: Partial<Skill>): SkillOverride | null {
  const out: Record<string, unknown> = {};
  for (const f of EDITABLE_FIELDS) {
    if (next[f] !== undefined && !same(next[f], base[f])) out[f] = next[f];
  }
  return Object.keys(out).length ? (out as SkillOverride) : null;
}
