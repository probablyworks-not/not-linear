/// <reference types="vite/client" />
import { parseSkill } from './parse-skill';
import type { Skill } from './types';

// The shipped library, bundled at build time from notlinear-skills/. Adding a skill there is all
// it takes to ship it; the app needs no manifest. (vite.config server.fs.allow includes ".." so the dev server can read it)
const files = import.meta.glob('../../../notlinear-skills/skills/*/*/SKILL.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

export function loadBuiltinSkills(sources: Record<string, string> = files): Skill[] {
  const out: Skill[] = [];
  for (const [path, src] of Object.entries(sources)) {
    const layer = /skills\/([^/]+)\/[^/]+\/SKILL\.md$/.exec(path)?.[1];
    const skill = parseSkill(src, layer);
    if (skill) out.push(skill);
  }
  return out.sort((a, b) => a.layer.localeCompare(b.layer) || a.name.localeCompare(b.name));
}

export const BUILTIN_SKILLS: Skill[] = loadBuiltinSkills();
