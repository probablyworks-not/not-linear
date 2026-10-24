import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openChatDb, writeState } from '../../src/db/chat';
import { loadChatState, resetChatRepoForTests, updateChatState } from '../../src/db/chat-repo';
import { useAppStore } from '../../src/state/app-store';
import { deleteMode, getModes, resetMode, saveMode } from '../../src/settings/modes';
import type { PersistedState } from '../../src/db/types';

const FIXTURE = resolve(__dirname, '../fixtures/notlinear.kv.v1.json');
const real: PersistedState | null = existsSync(FIXTURE)
  ? ((JSON.parse(readFileSync(FIXTURE, 'utf8')) as { rows: Array<{ key: string; value: unknown }> })
      .rows.find(r => r.key === 'state')?.value as PersistedState)
  : null;
const stable = (v: unknown): string => JSON.stringify(v, (_k, x) =>
  x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x);

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

describe('editModes', () => {
  it('creates a custom mode: memory at once, then the database', async () => {
    const id = await useAppStore.getState().editModes(p => saveMode(p, { id: '', label: 'Teacher', desc: 'd', instructions: 'Teach.' }));
    expect(getModes(useAppStore.getState().prefs).some(m => m.id === id && m.label === 'Teacher')).toBe(true);
    expect((await loadChatState()).prefs.customModes).toEqual([{ id, label: 'Teacher', desc: 'd', instructions: 'Teach.' }]);
  });

  it('writes only the mode-owned keys that changed, so a concurrent legacy edit to another pref survives', async () => {
    await useAppStore.getState().setPref('tone', 'formal');
    // The "other app" changes a different pref directly in the database after we last looked.
    await updateChatState(s => { s.prefs.name = 'Written by legacy'; });
    await useAppStore.getState().editModes(p => saveMode(p, { id: 'coding', label: 'Coding', desc: 'edited', instructions: '' }));
    const p = (await loadChatState()).prefs;
    expect(p.name).toBe('Written by legacy'); // not clobbered by our stale in-memory prefs
    expect(p.tone).toBe('formal');
    expect(p.modeOverrides).toEqual({ coding: { desc: 'edited', instructions: '' } });
  });

  it('deleting the active custom mode persists the fall-back to General', async () => {
    const id = await useAppStore.getState().editModes(p => saveMode(p, { id: '', label: 'T', desc: '', instructions: '' }));
    await useAppStore.getState().setPref('mode', id);
    await useAppStore.getState().editModes(p => deleteMode(p, id));
    expect((await loadChatState()).prefs.mode).toBe('general');
    expect((await loadChatState()).prefs.customModes).toEqual([]);
  });

  it('a no-op edit writes nothing', async () => {
    await useAppStore.getState().editModes(p => resetMode(p, 'research')); // nothing to reset
    expect((await loadChatState()).prefs.modeOverrides).toBeUndefined();
  });

  it('a throwing edit changes nothing', async () => {
    await expect(useAppStore.getState().editModes(() => { throw new Error('nope'); })).rejects.toThrow('nope');
    expect(useAppStore.getState().prefs.customModes).toBeUndefined();
  });
});

describe.skipIf(!real)('against the real-data fixture', () => {
  it('existing custom modes and overrides survive editing a different mode', async () => {
    const mine = { id: 'custom-keepme', label: 'Keep me', desc: 'd', instructions: 'Stay.' };
    await reset({ ...real!, prefs: { ...real!.prefs, customModes: [mine], modeOverrides: { pm: { desc: 'kept' } } } });
    await useAppStore.getState().editModes(p => saveMode(p, { id: '', label: 'Another', desc: '', instructions: '' }));
    await useAppStore.getState().editModes(p => saveMode(p, { id: 'coding', label: 'Coding', desc: 'x', instructions: '' }));
    const after = (await loadChatState()).prefs;
    expect(after.customModes).toHaveLength(2);
    expect(after.customModes![0]).toEqual(mine);
    expect(after.modeOverrides).toMatchObject({ pm: { desc: 'kept' }, coding: { desc: 'x' } });
  });

  it('a full create/edit/reset/delete cycle leaves every other part of the row byte-identical', async () => {
    await reset(real!);
    const { editModes } = useAppStore.getState();
    const id = await editModes(p => saveMode(p, { id: '', label: 'Round trip', desc: 'x', instructions: 'y' }));
    await editModes(p => saveMode(p, { id: 'critic', label: 'Critic', desc: 'changed', instructions: 'changed' }));
    await editModes(p => resetMode(p, 'critic'));
    await editModes(p => deleteMode(p, id));

    const after = await loadChatState();
    expect(stable({ ...after, prefs: null })).toBe(stable({ ...real!, prefs: null }));
    const { modeOverrides: _o, customModes: _c, ...otherAfter } = after.prefs;
    const { modeOverrides: _ro, customModes: _rc, ...otherReal } = real!.prefs;
    expect(stable(otherAfter)).toBe(stable(otherReal));
    // The fixture predates modes, so these two keys did not exist. After a cycle they
    // exist and are empty - exactly what legacy's own delete/reset leaves behind.
    expect(after.prefs.customModes).toEqual([]);
    expect(after.prefs.modeOverrides).toEqual({});
  });
});
