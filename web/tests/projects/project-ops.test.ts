import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  addChatToProjectIn, chatCount, createProjectIn, deleteProjectIn, gridProjects, newChatInProjectIn,
  projectChatIds, removeChatFromProjectIn, renameProjectIn, touchOnOpen, ungroupedChatIds,
} from '../../src/db/project-ops';
import { createThreadIn, emptyState, visibleThreads } from '../../src/db/thread-ops';
import { timeAgoShort } from '../../src/lib/time-ago';
import type { PersistedState } from '../../src/db/types';

const FIXTURE = resolve(__dirname, '../fixtures/notlinear.kv.v1.json');
const real: PersistedState | null = existsSync(FIXTURE)
  ? ((JSON.parse(readFileSync(FIXTURE, 'utf8')) as { rows: Array<{ key: string; value: unknown }> }).rows.find(r => r.key === 'state')?.value as PersistedState)
  : null;
const stable = (v: unknown): string => JSON.stringify(v, (_k, x) =>
  x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x);

describe('createProjectIn (app.js:5382)', () => {
  it('builds the exact legacy shape, with no updatedAt until the panel opens', () => {
    const s = emptyState();
    const a = createProjectIn(s, 111);
    const b = createProjectIn(s, 222);
    expect(s.projects[a]).toEqual({ id: 'proj-111', name: 'New project', rules: '', files: [], path: '' });
    expect(s.projects[a]).not.toHaveProperty('updatedAt');
    expect(s.projects[b]!.name).toBe('New project 2');
    expect(s.projectCount).toBe(3);
  });
  it('touchOnOpen stamps once and never overwrites', () => {
    const s = emptyState();
    const id = createProjectIn(s, 1);
    touchOnOpen(s, id, 500);
    touchOnOpen(s, id, 900);
    expect(s.projects[id]!.updatedAt).toBe(500);
  });
});

describe('rename', () => {
  it('sets the name verbatim (no trim, no default) and touches updatedAt', () => {
    const s = emptyState();
    const id = createProjectIn(s, 1);
    expect(renameProjectIn(s, id, '  spaced  ', 77)).toBe(true);
    expect(s.projects[id]).toMatchObject({ name: '  spaced  ', updatedAt: 77 });
    expect(renameProjectIn(s, id, '', 78)).toBe(true);
    expect(s.projects[id]!.name).toBe('');
  });
  it('an unknown project is a no-op', () => {
    expect(renameProjectIn(emptyState(), 'nope', 'x', 1)).toBe(false);
  });
});

describe('chat linking', () => {
  function seeded() {
    const s = emptyState();
    const pid = createProjectIn(s, 1);
    const t1 = createThreadIn(s, 10);
    const t2 = createThreadIn(s, 20);
    return { s, pid, t1, t2 };
  }

  it('adds and removes by setting/deleting threads[id].projectId, and does NOT touch updatedAt on add (legacy does not)', () => {
    const { s, pid, t1 } = seeded();
    expect(addChatToProjectIn(s, pid, t1)).toBe(true);
    expect(s.threads[t1]!.projectId).toBe(pid);
    expect(s.projects[pid]).not.toHaveProperty('updatedAt');
    expect(projectChatIds(s, pid)).toEqual([t1]);
    expect(removeChatFromProjectIn(s, t1)).toBe(true);
    expect(s.threads[t1]).not.toHaveProperty('projectId');
  });

  it('refuses unknown projects or threads', () => {
    const { s, pid } = seeded();
    expect(addChatToProjectIn(s, 'nope', 'chat-10')).toBe(false);
    expect(addChatToProjectIn(s, pid, 'ghost')).toBe(false);
    expect(removeChatFromProjectIn(s, 'ghost')).toBe(false);
  });

  it('ungrouped = real chats with state, not doc-main, not kind doc, not filed, still in the sidebar', () => {
    const { s, pid, t1, t2 } = seeded();
    s.threads['doc-main'] = { kind: 'doc', title: 'x' };
    s.threads.pricing = { kind: 'doc', title: 'Pricing' };
    s.threads.planning = { kind: 'chat', title: 'Planning' };
    addChatToProjectIn(s, pid, t1);
    expect(ungroupedChatIds(s).sort()).toEqual([t2, 'planning'].sort());
    s.deletedThreads.push(t2);
    expect(ungroupedChatIds(s)).toEqual(['planning']);
  });

  it('a seed thread with no persisted state cannot be filed (legacy iterates threadState)', () => {
    const { s } = seeded();
    expect(ungroupedChatIds(s)).not.toContain('onboarding');
  });
});

describe('newChatInProjectIn (app.js:5576)', () => {
  it('builds the startNewChat object plus projectId, touches the project and becomes current', () => {
    const s = emptyState();
    const pid = createProjectIn(s, 1);
    const id = newChatInProjectIn(s, pid, 9000)!;
    expect(s.threads[id]).toEqual({
      kind: 'chat', title: 'Untitled chat', stream: '', docContent: '<p><br></p>', tokenIn: 0, tokenCacheHit: 0, tokenOut: 0, cost: 0,
      highlights: [], branchSnapshots: {}, branchRecents: {}, projectId: pid,
    });
    expect(s.dynamic).toEqual([{ id, title: 'Untitled chat' }]);
    expect(s.current).toBe(id);
    expect(s.chatCount).toBe(2);
    expect(s.projects[pid]!.updatedAt).toBe(9000);
  });
  it('an unknown project creates nothing', () => {
    const s = emptyState();
    expect(newChatInProjectIn(s, 'nope', 1)).toBeNull();
    expect(Object.keys(s.threads)).toEqual([]);
    expect(s.chatCount).toBe(1);
  });
});

describe('deleteProjectIn (app.js:5632)', () => {
  it('keeps the chats, un-files them, and removes only the project', () => {
    const s = emptyState();
    const a = createProjectIn(s, 1);
    const b = createProjectIn(s, 2);
    const t = newChatInProjectIn(s, a, 5)!;
    const other = newChatInProjectIn(s, b, 6)!;
    expect(deleteProjectIn(s, a)).toBe(true);
    expect(s.projects[a]).toBeUndefined();
    expect(s.threads[t]).toBeDefined();
    expect(s.threads[t]).not.toHaveProperty('projectId');
    expect(s.threads[other]!.projectId).toBe(b);
    expect(visibleThreads(s).map(r => r.id)).toContain(t);
    expect(deleteProjectIn(s, a)).toBe(false);
  });
});

describe('grid (app.js:5449)', () => {
  function withProjects(): PersistedState {
    const s = emptyState();
    s.projects = {
      a: { id: 'a', name: 'Zebra', rules: '', files: [], path: '', updatedAt: 100 },
      b: { id: 'b', name: 'apple', rules: '', files: [], path: '', updatedAt: 300 },
      c: { id: 'c', name: 'Mango', rules: '', files: [], path: '' },
      d: { id: 'd', name: '', rules: '', files: [], path: '', updatedAt: 200 },
    };
    return s;
  }
  it('sorts by updatedAt descending, missing counting as 0', () => {
    expect(gridProjects(withProjects(), '', 'updated').map(p => p.id)).toEqual(['b', 'd', 'a', 'c']);
  });
  it('sorts by name with localeCompare (case-insensitive order, empty first)', () => {
    expect(gridProjects(withProjects(), '', 'name').map(p => p.name)).toEqual(['', 'apple', 'Mango', 'Zebra']);
  });
  it('filters by case-insensitive name substring, trimmed', () => {
    expect(gridProjects(withProjects(), '  AN ', 'updated').map(p => p.id)).toEqual(['c']);
  });
  it("counts a card's threads from thread.projectId", () => {
    const s = withProjects();
    s.threads = { t1: { projectId: 'a' }, t2: { projectId: 'a' }, t3: {} };
    expect(chatCount(s, 'a')).toBe(2);
    expect(chatCount(s, 'b')).toBe(0);
  });
});

describe('timeAgoShort (app.js:5426)', () => {
  const now = 1_000_000_000_000;
  it.each([
    [undefined, '—'], [0, '—'], [now - 5_000, 'just now'], [now - 59_000, 'just now'],
    [now - 60_000, '1m ago'], [now - 59 * 60_000, '59m ago'], [now - 60 * 60_000, '1h ago'],
    [now - 23 * 3600_000, '23h ago'], [now - 24 * 3600_000, '1d ago'], [now - 29 * 86400_000, '29d ago'],
    [now - 30 * 86400_000, '1mo ago'], [now - 360 * 86400_000 + 1, '11mo ago'], [now - 365 * 86400_000, '1y ago'], [now - 800 * 86400_000, '2y ago'],
  ])('%s -> %s', (ts, out) => { expect(timeAgoShort(ts as number | undefined, now)).toBe(out); });
});

describe.skipIf(!real)('against the real-data fixture', () => {
  it('has real projects to work with', () => {
    expect(Object.keys(real!.projects).length).toBeGreaterThan(5);
  });

  it('lists, sorts and counts every real project', () => {
    const byUpdated = gridProjects(real!, '', 'updated');
    expect(byUpdated).toHaveLength(Object.keys(real!.projects).length);
    for (let i = 1; i < byUpdated.length; i++) expect((byUpdated[i - 1]!.updatedAt || 0) >= (byUpdated[i]!.updatedAt || 0)).toBe(true);
    // Card counts add up to the threads filed in a project that exists.
    const counted = Object.keys(real!.projects).reduce((n, pid) => n + chatCount(real!, pid), 0);
    const filed = Object.values(real!.threads).filter(t => typeof t.projectId === 'string' && real!.projects[t.projectId]).length;
    expect(counted).toBe(filed);
  });

  it('create, link, rename, un-link, delete leaves every pre-existing project and thread byte-identical', () => {
    const s = structuredClone(real!);
    const before = stable({ projects: s.projects, threads: s.threads });
    const pid = createProjectIn(s, 9_999_999_999);
    const t = newChatInProjectIn(s, pid, 9_999_999_998)!;
    renameProjectIn(s, pid, 'tmp', 9_999_999_997);
    removeChatFromProjectIn(s, t);
    addChatToProjectIn(s, pid, t);
    deleteProjectIn(s, pid);
    delete s.threads[t];
    expect(stable({ projects: s.projects, threads: s.threads })).toBe(before);
  });

  it('filing a real chat and un-filing it restores that thread exactly', () => {
    const s = structuredClone(real!);
    const pid = Object.keys(s.projects)[0]!;
    const free = ungroupedChatIds(s)[0];
    expect(free).toBeDefined();
    const before = stable(s.threads[free!]);
    addChatToProjectIn(s, pid, free!);
    expect(s.threads[free!]!.projectId).toBe(pid);
    removeChatFromProjectIn(s, free!);
    expect(stable(s.threads[free!])).toBe(before);
  });

  it('deleting a real project un-files exactly its chats and nothing else', () => {
    const s = structuredClone(real!);
    // The redacted fixture has no project that already holds a chat, so file a real one first.
    const pid = Object.keys(s.projects)[0]!;
    const free = ungroupedChatIds(s)[0]!;
    expect(free).toBeDefined();
    addChatToProjectIn(s, pid, free);
    const members = projectChatIds(s, pid);
    expect(members).toEqual([free]);
    const others = (state: PersistedState) => stable(Object.fromEntries(Object.entries(state.threads).filter(([id]) => !members.includes(id))));
    const before = others(s);
    const projectsBefore = Object.keys(s.projects).filter(id => id !== pid);
    deleteProjectIn(s, pid);
    expect(projectChatIds(s, pid)).toEqual([]);
    expect(s.threads[free]).toBeDefined();
    expect(s.threads[free]).not.toHaveProperty('projectId');
    expect(others(s)).toBe(before);
    expect(Object.keys(s.projects)).toEqual(projectsBefore);
  });
});
