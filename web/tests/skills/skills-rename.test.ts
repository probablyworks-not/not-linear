import { beforeEach, describe, expect, it } from 'vitest';
import { useSkillsStore } from '../../src/skills/skills-store';
import { BUILTIN_SKILLS } from '../../src/skills/builtin';
import { DEFAULT_SKILLS_META } from '../../src/skills/types';

describe('renaming a custom skill', () => {
  beforeEach(() => { useSkillsStore.setState({ overrides: {}, custom: [], meta: DEFAULT_SKILLS_META, loaded: true }); });

  it('slugifies, moves its enabled/pinned state with it, and keeps the body', () => {
    const name = useSkillsStore.getState().create({ name: 'pre mortem', body: 'x' });
    useSkillsStore.getState().setEnabled(name, false);
    useSkillsStore.getState().setPinned(name, true);
    expect(useSkillsStore.getState().rename(name, '  Post Mortem  ')).toBe('post-mortem');
    const s = useSkillsStore.getState();
    expect(s.custom.map(c => c.name)).toEqual(['post-mortem']);
    expect(s.custom[0]!.body).toBe('x');
    expect(s.meta.disabled).toEqual(['post-mortem']);
    expect(s.meta.pinned).toEqual(['post-mortem']);
  });

  it('refuses blank, duplicate and built-in names, and leaves everything untouched', () => {
    const a = useSkillsStore.getState().create({ name: 'alpha' });
    const b = useSkillsStore.getState().create({ name: 'beta' });
    const before = useSkillsStore.getState().custom;
    expect(useSkillsStore.getState().rename(b, '   ')).toBeNull();
    expect(useSkillsStore.getState().rename(b, a)).toBeNull();
    expect(useSkillsStore.getState().rename(b, BUILTIN_SKILLS[0]!.name)).toBeNull();
    expect(useSkillsStore.getState().rename(BUILTIN_SKILLS[0]!.name, 'mine')).toBeNull(); // built-ins keep their name
    expect(useSkillsStore.getState().custom).toEqual(before);
  });
});
