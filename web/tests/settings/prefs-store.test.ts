import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openChatDb, writeState } from '../../src/db/chat';
import { loadChatState, resetChatRepoForTests } from '../../src/db/chat-repo';
import { useAppStore } from '../../src/state/app-store';
import type { PersistedState } from '../../src/db/types';

const FIXTURE = resolve(__dirname, '../fixtures/notlinear.kv.v1.json');
const real: PersistedState | null = existsSync(FIXTURE)
  ? ((JSON.parse(readFileSync(FIXTURE, 'utf8')) as { rows: Array<{ key: string; value: unknown }> })
      .rows.find(r => r.key === 'state')?.value as PersistedState)
  : null;

const stable = (v: unknown): string => JSON.stringify(v, (_k, x) =>
  x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function reset(seed?: PersistedState): Promise<void> {
  await resetChatRepoForTests();
  const d = openChatDb();
  await d.kv.clear();
  if (seed) await writeState(d, structuredClone(seed));
  d.close();
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  await useAppStore.getState().hydrate();
}

beforeEach(async () => { await reset(); });

describe('setPref', () => {
  it('a discrete choice reaches the database before the promise resolves', async () => {
    await useAppStore.getState().setPref('tone', 'socratic');
    expect((await loadChatState()).prefs.tone).toBe('socratic');
    expect(useAppStore.getState().prefs.tone).toBe('socratic');
  });

  it('typed text updates memory instantly but coalesces into ONE write after the debounce', async () => {
    const { setPref } = useAppStore.getState();
    for (const v of ['A', 'Al', 'Ale', 'Alex']) void setPref('name', v, { debounce: true });
    expect(useAppStore.getState().prefs.name).toBe('Alex'); // memory is immediate
    expect((await loadChatState()).prefs.name).toBeUndefined(); // disk is not
    await sleep(350);
    expect((await loadChatState()).prefs.name).toBe('Alex');
  });

  it('flushPrefs writes pending typing now, e.g. on blur or close', async () => {
    void useAppStore.getState().setPref('context', 'Researching tides', { debounce: true });
    await useAppStore.getState().flushPrefs();
    expect((await loadChatState()).prefs.context).toBe('Researching tides');
  });

  it('a discrete write cancels a pending debounced one for the same key (no stale overwrite)', async () => {
    void useAppStore.getState().setPref('name', 'typed', { debounce: true });
    await useAppStore.getState().setPref('name', 'final');
    await sleep(350);
    expect((await loadChatState()).prefs.name).toBe('final');
  });

  it('touches only its own key and leaves the rest of the row alone', async () => {
    await useAppStore.getState().createThread();
    const before = await loadChatState();
    await useAppStore.getState().setPref('model', 'haiku');
    const after = await loadChatState();
    expect(stable({ ...after, prefs: null })).toBe(stable({ ...before, prefs: null }));
    expect(after.prefs.model).toBe('haiku');
  });

  it('creating a thread while a pref is mid-typing does not roll the typed text back', async () => {
    void useAppStore.getState().setPref('name', 'Ya', { debounce: true });
    await useAppStore.getState().createThread();
    expect(useAppStore.getState().prefs.name).toBe('Ya');
    await useAppStore.getState().flushPrefs();
    expect((await loadChatState()).prefs.name).toBe('Ya');
  });
});

describe('setTheme', () => {
  it('persists prefs.theme AND applies it, so legacy (which re-applies prefs.theme) agrees', async () => {
    await useAppStore.getState().setTheme('grey');
    expect((await loadChatState()).prefs.theme).toBe('grey');
    expect(document.documentElement.getAttribute('data-theme')).toBe('grey');
    expect(localStorage.getItem('nl_theme')).toBe('grey');
  });

  it('hydrate applies a stored theme, but with none stored leaves the pre-paint choice alone', async () => {
    localStorage.setItem('nl_theme', 'grey');
    document.documentElement.setAttribute('data-theme', 'grey');
    await useAppStore.getState().hydrate();
    expect(document.documentElement.getAttribute('data-theme')).toBe('grey');

    await reset({ ...(await loadChatState()), prefs: { theme: 'light' } });
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });
});

describe('API keys in the store', () => {
  it('connect and disconnect go through nl_api_keys and are masked nowhere but the UI', () => {
    useAppStore.getState().connectApiKey('serper', 'serper-TESTONLY-1234567890');
    expect(JSON.parse(localStorage.getItem('nl_api_keys')!)).toEqual({ serper: 'serper-TESTONLY-1234567890' });
    expect(useAppStore.getState().apiKeys.serper).toBeDefined();
    useAppStore.getState().disconnectApiKey('serper');
    expect(useAppStore.getState().apiKeys).toEqual({});
  });

  it('refreshApiKeys picks up a key the other app added', () => {
    localStorage.setItem('nl_api_keys', JSON.stringify({ openai: 'sk-TESTONLY-zzzzzzzzzz' }));
    useAppStore.getState().refreshApiKeys();
    expect(Object.keys(useAppStore.getState().apiKeys)).toEqual(['openai']);
  });

  it('keys are never written to IndexedDB', async () => {
    useAppStore.getState().connectApiKey('anthropic', 'sk-ant-TESTONLY-needle-needle');
    await useAppStore.getState().setPref('name', 'x');
    expect(JSON.stringify(await loadChatState())).not.toContain('needle');
  });
});

describe.skipIf(!real)('against the real-data fixture', () => {
  it('editing every Settings pref preserves everything else byte-for-byte', async () => {
    await reset(real!);
    const s = useAppStore.getState();
    await s.setPref('folderName', 'Lab');
    await s.setPref('name', 'Sam');
    await s.setPref('tone', 'formal');
    await s.setPref('context', 'ctx');
    await s.setPref('model', 'haiku');
    await s.setPref('searxngUrl', 'http://localhost:8888');
    await s.setPref('rankingLlm', 'deepseek');
    await s.setTheme('light');

    const after = await loadChatState();
    expect(stable({ ...after, prefs: null })).toBe(stable({ ...real!, prefs: null }));
    // Prefs fields Settings does not edit survive, including the additive ones.
    expect(stable(after.prefs.customModes)).toBe(stable(real!.prefs.customModes));
    expect(stable(after.prefs.modeOverrides)).toBe(stable(real!.prefs.modeOverrides));
    expect(after.prefs).toMatchObject({ folderName: 'Lab', name: 'Sam', tone: 'formal', context: 'ctx', model: 'haiku', theme: 'light', rankingLlm: 'deepseek' });
  });
});
