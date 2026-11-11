import { openChatDb } from '../../src/db/chat';
import { loadChatState, resetChatRepoForTests } from '../../src/db/chat-repo';
import { useAppStore } from '../../src/state/app-store';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function reset(): Promise<void> {
  await resetChatRepoForTests();
  const d = openChatDb();
  await d.kv.clear();
  d.close();
  localStorage.clear();
  await useAppStore.getState().hydrate();
}
beforeEach(reset);

describe('project actions through the store', () => {
  it('createProject persists the legacy shape and stamps updatedAt as opening the panel does', async () => {
    const pid = (await useAppStore.getState().createProject())!;
    const p = (await loadChatState()).projects[pid]!;
    expect(p).toMatchObject({ id: pid, name: 'New project', rules: '', files: [], path: '' });
    expect(p.updatedAt).toBeGreaterThan(0);
    expect(useAppStore.getState().projects[pid]).toEqual(p);
  });

  it('touchProjectOnOpen does not write when already stamped', async () => {
    const pid = (await useAppStore.getState().createProject())!;
    const before = (await loadChatState()).projects[pid]!.updatedAt;
    await sleep(5);
    await useAppStore.getState().touchProjectOnOpen(pid);
    expect((await loadChatState()).projects[pid]!.updatedAt).toBe(before);
  });

  it('a typed name updates memory at once and is written ONCE after the debounce', async () => {
    const pid = (await useAppStore.getState().createProject())!;
    const { renameProject } = useAppStore.getState();
    for (const v of ['A', 'Al', 'Alp', 'Alpha']) void renameProject(pid, v);
    expect(useAppStore.getState().projects[pid]!.name).toBe('Alpha');
    expect((await loadChatState()).projects[pid]!.name).toBe('New project');
    await sleep(350);
    expect((await loadChatState()).projects[pid]!.name).toBe('Alpha');
  });

  it('flushPrefs writes a pending project name now (leaving the panel, creating a chat)', async () => {
    const pid = (await useAppStore.getState().createProject())!;
    void useAppStore.getState().renameProject(pid, 'Flushed');
    await useAppStore.getState().flushPrefs();
    expect((await loadChatState()).projects[pid]!.name).toBe('Flushed');
  });

  it('creating a chat in the project while the name is mid-typing does not roll the name back', async () => {
    const pid = (await useAppStore.getState().createProject())!;
    void useAppStore.getState().renameProject(pid, 'Typing…');
    const tid = (await useAppStore.getState().newChatInProject(pid))!;
    expect(useAppStore.getState().projects[pid]!.name).toBe('Typing…'); // not the older DB copy
    expect(useAppStore.getState().threadState[tid]!.projectId).toBe(pid);
    await useAppStore.getState().flushPrefs();
    expect((await loadChatState()).projects[pid]!.name).toBe('Typing…');
  });

  it('deleting a project cancels its pending name write instead of resurrecting it', async () => {
    const pid = (await useAppStore.getState().createProject())!;
    void useAppStore.getState().renameProject(pid, 'doomed');
    await useAppStore.getState().deleteProject(pid);
    await sleep(350);
    expect((await loadChatState()).projects[pid]).toBeUndefined();
  });

  it('link, unlink and delete keep the chat', async () => {
    const s = useAppStore.getState();
    const pid = (await s.createProject())!;
    const tid = (await s.createThread())!;
    expect(await s.addChatToProject(pid, tid)).toBe(true);
    expect((await loadChatState()).threads[tid]!.projectId).toBe(pid);
    expect(await s.removeChatFromProject(tid)).toBe(true);
    expect((await loadChatState()).threads[tid]).not.toHaveProperty('projectId');
    await s.addChatToProject(pid, tid);
    expect(await s.deleteProject(pid)).toBe(true);
    const after = await loadChatState();
    expect(after.projects[pid]).toBeUndefined();
    expect(after.threads[tid]).toBeDefined();
    expect(after.threads[tid]).not.toHaveProperty('projectId');
  });

  it('does not touch prefs, rules, files or folder path', async () => {
    const s = useAppStore.getState();
    await s.setPref('tone', 'formal');
    const pid = (await s.createProject())!;
    await s.renameProject(pid, 'x');
    await s.flushPrefs();
    const after = await loadChatState();
    expect(after.prefs.tone).toBe('formal');
    expect(after.projects[pid]).toMatchObject({ rules: '', files: [], path: '' });
  });
});
