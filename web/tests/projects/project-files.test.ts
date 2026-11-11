import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openChatDb, writeState } from '../../src/db/chat';
import { loadChatState, resetChatRepoForTests } from '../../src/db/chat-repo';
import {
  addProjectFilesIn, createProjectIn, removeProjectFileIn, setProjectPathIn, setProjectRulesIn,
} from '../../src/db/project-ops';
import { emptyState } from '../../src/db/thread-ops';
import { useAppStore } from '../../src/state/app-store';
import type { PersistedState } from '../../src/db/types';

const FIXTURE = resolve(__dirname, '../fixtures/notlinear.kv.v1.json');
const real: PersistedState | null = existsSync(FIXTURE)
  ? ((JSON.parse(readFileSync(FIXTURE, 'utf8')) as { rows: Array<{ key: string; value: unknown }> }).rows.find(r => r.key === 'state')?.value as PersistedState)
  : null;
const stable = (v: unknown): string => JSON.stringify(v, (_k, x) =>
  x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('rules', () => {
  it('sets the text verbatim and touches updatedAt', () => {
    const s = emptyState();
    const id = createProjectIn(s, 1);
    expect(setProjectRulesIn(s, id, '  Answer in British English.\n', 50)).toBe(true);
    expect(s.projects[id]).toMatchObject({ rules: '  Answer in British English.\n', updatedAt: 50 });
    expect(setProjectRulesIn(s, 'nope', 'x', 1)).toBe(false);
  });
});

describe('files', () => {
  const picked = [
    { name: 'a.txt', size: 5, type: 'text/plain', kind: 'file', content: 'hello', base64: 'SHOULD-NOT-BE-STORED' },
    { name: 'p.pdf', size: 9, type: 'application/pdf', kind: 'pdf', content: 'pdf text', base64: 'ALSO-DROPPED', parseError: null },
  ];

  it('stores text only: base64 is dropped, everything else is kept', () => {
    const s = emptyState();
    const id = createProjectIn(s, 1);
    expect(addProjectFilesIn(s, id, picked, 99)).toBe(true);
    expect(s.projects[id]!.files).toEqual([
      { name: 'a.txt', size: 5, type: 'text/plain', kind: 'file', content: 'hello' },
      { name: 'p.pdf', size: 9, type: 'application/pdf', kind: 'pdf', content: 'pdf text', parseError: null },
    ]);
    expect(JSON.stringify(s)).not.toContain('SHOULD-NOT-BE-STORED');
    expect(s.projects[id]!.updatedAt).toBe(99);
  });

  it('does not mutate the caller\'s array or objects', () => {
    const s = emptyState();
    const id = createProjectIn(s, 1);
    const before = structuredClone(picked);
    addProjectFilesIn(s, id, picked, 1);
    expect(picked).toEqual(before);
  });

  it('appends to existing files and an empty pick changes nothing', () => {
    const s = emptyState();
    const id = createProjectIn(s, 1);
    addProjectFilesIn(s, id, [picked[0]!], 1);
    addProjectFilesIn(s, id, [picked[1]!], 2);
    expect(s.projects[id]!.files.map(f => (f as { name: string }).name)).toEqual(['a.txt', 'p.pdf']);
    expect(addProjectFilesIn(s, id, [], 3)).toBe(false);
    expect(s.projects[id]!.updatedAt).toBe(2);
  });

  it('remove takes out exactly one by index, in range only, and does NOT touch updatedAt (legacy does not)', () => {
    const s = emptyState();
    const id = createProjectIn(s, 1);
    addProjectFilesIn(s, id, picked, 10);
    expect(removeProjectFileIn(s, id, 0)).toBe(true);
    expect(s.projects[id]!.files.map(f => (f as { name: string }).name)).toEqual(['p.pdf']);
    expect(s.projects[id]!.updatedAt).toBe(10);
    expect(removeProjectFileIn(s, id, 5)).toBe(false);
    expect(removeProjectFileIn(s, id, -1)).toBe(false);
  });
});

describe('linked folder', () => {
  it('links and unlinks without touching updatedAt, and leaves rules/files alone', () => {
    const s = emptyState();
    const id = createProjectIn(s, 1);
    addProjectFilesIn(s, id, [{ name: 'a', size: 1, type: 't', kind: 'file', content: 'c' }], 5);
    expect(setProjectPathIn(s, id, '/Users/me/code/app')).toBe(true);
    expect(s.projects[id]).toMatchObject({ path: '/Users/me/code/app', updatedAt: 5, rules: '' });
    expect(s.projects[id]!.files).toHaveLength(1);
    setProjectPathIn(s, id, '');
    expect(s.projects[id]!.path).toBe('');
    expect(setProjectPathIn(s, 'nope', '/x')).toBe(false);
  });
});

describe('through the store', () => {
  async function reset(seed?: PersistedState): Promise<void> {
    await resetChatRepoForTests();
    const d = openChatDb();
    await d.kv.clear();
    if (seed) await writeState(d, structuredClone(seed));
    d.close();
    localStorage.clear();
    await useAppStore.getState().hydrate();
  }
  beforeEach(async () => { await reset(); });

  it('typed rules update memory at once and are written once after the debounce', async () => {
    const pid = (await useAppStore.getState().createProject())!;
    for (const v of ['B', 'Br', 'Brit']) void useAppStore.getState().setProjectRules(pid, v);
    expect(useAppStore.getState().projects[pid]!.rules).toBe('Brit');
    expect((await loadChatState()).projects[pid]!.rules).toBe('');
    await sleep(350);
    expect((await loadChatState()).projects[pid]!.rules).toBe('Brit');
  });

  it('a chat created while rules are mid-typing does not roll them back', async () => {
    const pid = (await useAppStore.getState().createProject())!;
    void useAppStore.getState().setProjectRules(pid, 'half-typed rul');
    await useAppStore.getState().newChatInProject(pid);
    expect(useAppStore.getState().projects[pid]!.rules).toBe('half-typed rul');
    await useAppStore.getState().flushPrefs();
    expect((await loadChatState()).projects[pid]!.rules).toBe('half-typed rul');
  });

  it('deleting a project cancels its pending rules write instead of resurrecting it', async () => {
    const pid = (await useAppStore.getState().createProject())!;
    void useAppStore.getState().setProjectRules(pid, 'doomed');
    await useAppStore.getState().deleteProject(pid);
    await sleep(350);
    expect((await loadChatState()).projects[pid]).toBeUndefined();
  });

  it('adds files without base64, removes one, and persists', async () => {
    const pid = (await useAppStore.getState().createProject())!;
    await useAppStore.getState().addProjectFiles(pid, [{ name: 'k.md', size: 3, type: 'text/markdown', kind: 'file', content: 'abc', base64: 'XX' }]);
    const stored = (await loadChatState()).projects[pid]!;
    expect(stored.files).toEqual([{ name: 'k.md', size: 3, type: 'text/markdown', kind: 'file', content: 'abc' }]);
    await useAppStore.getState().removeProjectFile(pid, 0);
    expect((await loadChatState()).projects[pid]!.files).toEqual([]);
  });

  it('links the folder path', async () => {
    const pid = (await useAppStore.getState().createProject())!;
    await useAppStore.getState().setProjectPath(pid, '/tmp/work');
    expect((await loadChatState()).projects[pid]!.path).toBe('/tmp/work');
    expect(useAppStore.getState().projects[pid]!.path).toBe('/tmp/work');
  });

  it.skipIf(!real)('against the real data: rules, files and folder edits leave every other project and thread byte-identical', async () => {
    await reset(real!);
    const other = Object.keys(real!.projects)[0]!;
    const pid = (await useAppStore.getState().createProject())!;
    await useAppStore.getState().setProjectRules(pid, 'r');
    await useAppStore.getState().flushPrefs();
    await useAppStore.getState().addProjectFiles(pid, [{ name: 'f', size: 1, type: 't', kind: 'file', content: 'c' }]);
    await useAppStore.getState().setProjectPath(pid, '/p');
    const after = await loadChatState();
    expect(stable(after.projects[other])).toBe(stable(real!.projects[other]));
    expect(stable(after.threads)).toBe(stable(real!.threads));
    expect(stable(after.prefs)).toBe(stable(real!.prefs));
  });
});
