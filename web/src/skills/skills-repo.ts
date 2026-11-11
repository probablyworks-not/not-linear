import {
  openSkillsDb, readSkillsKey, writeSkillsKey, SKILLS_CUSTOM_KEY, SKILLS_META_KEY, SKILLS_OVERRIDES_KEY,
} from '../db/skills';
import { DEFAULT_SKILLS_META, type Skill, type SkillOverride, type SkillsMeta } from './types';

// The only place that talks to the skills database (CLAUDE.md: DB writes go through a repo).

export interface SkillsData {
  overrides: Record<string, SkillOverride>;
  custom: Skill[];
  meta: SkillsMeta;
}

let db: ReturnType<typeof openSkillsDb> | null = null;
const get = (): ReturnType<typeof openSkillsDb> => (db ??= openSkillsDb());

export async function loadSkillsData(): Promise<SkillsData> {
  const d = get();
  const [overrides, custom, meta] = await Promise.all([
    readSkillsKey<Record<string, SkillOverride>>(d, SKILLS_OVERRIDES_KEY),
    readSkillsKey<Skill[]>(d, SKILLS_CUSTOM_KEY),
    readSkillsKey<SkillsMeta>(d, SKILLS_META_KEY),
  ]);
  return { overrides: overrides ?? {}, custom: custom ?? [], meta: { ...DEFAULT_SKILLS_META, ...(meta ?? {}) } };
}

export const saveOverrides = (v: SkillsData['overrides']): Promise<void> => writeSkillsKey(get(), SKILLS_OVERRIDES_KEY, v);
export const saveCustom = (v: Skill[]): Promise<void> => writeSkillsKey(get(), SKILLS_CUSTOM_KEY, v);
export const saveMeta = (v: SkillsMeta): Promise<void> => writeSkillsKey(get(), SKILLS_META_KEY, v);
