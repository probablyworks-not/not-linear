import { describe, expect, it } from 'vitest';
import { parseSkill, serializeSkill } from '../../src/skills/parse-skill';
import { bm25, tokenize } from '../../src/skills/bm25';
import { selectSkills } from '../../src/skills/select-skills';
import { renderSkillsBlock } from '../../src/skills/skills-prompt';
import { diffOverride, resolveSkills } from '../../src/skills/merge-skills';
import { loadBuiltinSkills, BUILTIN_SKILLS } from '../../src/skills/builtin';
import { DEFAULT_SKILLS_META, type Skill } from '../../src/skills/types';

const mk = (o: Partial<Skill>): Skill => ({
  name: 'x', description: '', layer: 'custom', whenToUse: '', keywords: [], priority: 0, always: false, auto: true, tools: [], body: 'body', ...o,
});
const resolve = (skills: Skill[], meta = DEFAULT_SKILLS_META) => resolveSkills(skills, {}, [], meta);
const names = (q: string, meta = DEFAULT_SKILLS_META) => selectSkills({ skills: resolve(BUILTIN_SKILLS, meta), meta, query: q }).map(s => s.skill.name);

describe('parse-skill', () => {
  it('round-trips and reads new metadata', () => {
    const s = mk({ name: 'a', description: 'd', whenToUse: 'w', keywords: ['k1', 'k2'], priority: 2, always: true, auto: false, tools: ['t'], body: '# Hi\n\ntext' });
    expect(parseSkill(serializeSkill(s))).toEqual(s);
  });
  it('defaults missing keys and rejects frontmatter-less or nameless input', () => {
    expect(parseSkill('---\nname: z\ndescription: d\n---\nbody', 'moves')).toMatchObject({ layer: 'moves', keywords: [], auto: true, always: false });
    expect(parseSkill('no frontmatter')).toBeNull();
    expect(parseSkill('---\ndescription: d\n---\nb')).toBeNull();
  });
});

describe('library', () => {
  it('bundles all 57 skills with unique names', () => {
    expect(BUILTIN_SKILLS.length).toBe(57);
    expect(new Set(BUILTIN_SKILLS.map(s => s.name)).size).toBe(57);
    expect(loadBuiltinSkills({})).toEqual([]);
  });
  it('mode skills are not auto-selectable', () => {
    expect(BUILTIN_SKILLS.filter(s => s.layer === 'modes').every(s => !s.auto)).toBe(true);
  });
});

describe('bm25', () => {
  it('stems and drops stopwords', () => {
    expect(tokenize('The decisions are comparing')).toEqual(tokenize('decision compare'));
  });
  it('ranks the matching doc first', () => {
    const r = bm25([{ id: 'a', fields: [{ text: 'pre mortem failure story', weight: 1 }] }, { id: 'b', fields: [{ text: 'pricing tiers', weight: 1 }] }], 'run a pre-mortem');
    expect(r[0]!.score).toBeGreaterThan(r[1]!.score);
  });
});

describe('selectSkills on the real library', () => {
  it('picks pre-mortem for a pre-mortem request', () => expect(names('Run a pre-mortem on our launch: imagine it failed')).toContain('pre-mortem'));
  it('picks steelman', () => expect(names('steelman the opposing argument')).toContain('steelman'));
  it('adds nothing for chit-chat', () => expect(names('hello there')).toEqual([]));
  it('respects the limit', () => expect(selectSkills({ skills: resolve(BUILTIN_SKILLS), meta: DEFAULT_SKILLS_META, query: 'compare options decision matrix pre-mortem steelman red team', limit: 2 }).filter(s => s.reason === 'match').length).toBeLessThanOrEqual(2));
});

describe('selectSkills rules', () => {
  const skills = [mk({ name: 'a', keywords: ['alpha'], body: 'A' }), mk({ name: 'b', keywords: ['beta'], body: 'B' }), mk({ name: 'f', always: true, body: 'F' })];
  it('always-on first; pinned bypass matching; disabled never', () => {
    const meta = { ...DEFAULT_SKILLS_META, pinned: ['b'], disabled: ['a'] };
    const out = selectSkills({ skills: resolve(skills, meta), meta, query: 'alpha alpha' });
    expect(out.map(o => [o.skill.name, o.reason])).toEqual([['f', 'always'], ['b', 'pinned']]);
  });
  it('picked skills are honoured even when disabled, first, and bypass the budget', () => {
    const big = [mk({ name: 'big', body: 'x'.repeat(8000) }), mk({ name: 'a', keywords: ['alpha'] })];
    const meta = { ...DEFAULT_SKILLS_META, disabled: ['big'] };
    const out = selectSkills({ skills: resolve(big, meta), meta, query: 'alpha', forced: ['big'], tokenBudget: 10 });
    expect(out.map(o => [o.skill.name, o.reason])).toEqual([['big', 'picked']]);
  });
  it('auto off keeps only forced skills', () => {
    const meta = { ...DEFAULT_SKILLS_META, auto: false };
    expect(selectSkills({ skills: resolve(skills, meta), meta, query: 'alpha' }).map(o => o.skill.name)).toEqual(['f']);
  });
  it('token budget drops over-budget matches', () => {
    const big = [mk({ name: 'big', keywords: ['zeta'], body: 'x'.repeat(4000) })];
    expect(selectSkills({ skills: resolve(big), meta: DEFAULT_SKILLS_META, query: 'zeta', tokenBudget: 100 })).toEqual([]);
  });
});

describe('prompt + merge', () => {
  it('renders nothing when nothing is selected', () => expect(renderSkillsBlock([])).toBe(''));
  it('overrides store only differing fields; no diff clears', () => {
    const base = mk({ name: 'a', description: 'd', body: 'b' });
    expect(diffOverride(base, { description: 'd', body: 'new' })).toEqual({ body: 'new' });
    expect(diffOverride(base, { body: 'b' })).toBeNull();
    const [r] = resolveSkills([base], { a: { body: 'new' } }, [], DEFAULT_SKILLS_META);
    expect(r).toMatchObject({ body: 'new', edited: true, description: 'd' });
  });
  it('custom skills cannot shadow built-ins', () => {
    expect(resolveSkills([mk({ name: 'a' })], {}, [mk({ name: 'a', body: 'evil' })], DEFAULT_SKILLS_META)).toHaveLength(1);
  });
});
