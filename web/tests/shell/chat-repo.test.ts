import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openChatDb, readState, writeState } from '../../src/db/chat';
import { ChatStateUnavailableError, loadChatState, resetChatRepoForTests, updateChatState } from '../../src/db/chat-repo';
import { createThreadIn, deleteThreadIn } from '../../src/db/thread-ops';
import type { PersistedState } from '../../src/db/types';

const FIXTURE = resolve(__dirname, '../fixtures/notlinear.kv.v1.json');
const real: PersistedState | null = existsSync(FIXTURE)
  ? ((JSON.parse(readFileSync(FIXTURE, 'utf8')) as { rows: Array<{ key: string; value: unknown }> })
      .rows.find(r => r.key === 'state')?.value as PersistedState)
  : null;

const stable = (v: unknown): string => JSON.stringify(v, (_k, x) =>
  x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x);

async function wipe(): Promise<void> {
  await resetChatRepoForTests();
  const d = openChatDb();
  await d.kv.clear();
  d.close();
  localStorage.clear();
}
async function seed(state: PersistedState): Promise<void> {
  const d = openChatDb();
  await writeState(d, state);
  d.close();
}

beforeEach(wipe);

describe('chat-repo', () => {
  it('reads an empty database as the legacy defaults', async () => {
    const s = await loadChatState();
    expect(s.current).toBe('doc-main');
    expect(s.chatCount).toBe(1);
  });

  it('refuses to shadow a pending legacy localStorage import', async () => {
    localStorage.setItem('nl_state_v2', '{"threads":{}}');
    await expect(updateChatState(s => createThreadIn(s, 1))).rejects.toBeInstanceOf(ChatStateUnavailableError);
    const d = openChatDb();
    expect(await readState(d)).toBeNull(); // nothing was written
    d.close();
  });

  it('persists a created thread and returns its id', async () => {
    const { result } = await updateChatState(s => createThreadIn(s, 42));
    expect(result).toBe('chat-42');
    expect((await loadChatState()).threads['chat-42']?.title).toBe('Untitled chat');
  });

  it('does not lose concurrent writes: ten parallel creates all land', async () => {
    await Promise.all(Array.from({ length: 10 }, (_v, i) => updateChatState(s => createThreadIn(s, i + 1))));
    const s = await loadChatState();
    expect(Object.keys(s.threads)).toHaveLength(10);
    expect(s.chatCount).toBe(11);
  });

  it('a failing mutator writes nothing', async () => {
    await seed({ ...(await loadChatState()), chatCount: 5 });
    await expect(updateChatState(s => { s.chatCount = 99; throw new Error('boom'); })).rejects.toThrow('boom');
    expect((await loadChatState()).chatCount).toBe(5);
  });

  describe.skipIf(!real)('against the real-data fixture', () => {
    it('create then delete leaves every pre-existing thread byte-identical', async () => {
      await seed(structuredClone(real!));
      const before = stable((await loadChatState()).threads);
      const { result: id } = await updateChatState(s => createThreadIn(s, 9_999_999));
      await updateChatState(s => deleteThreadIn(s, id));
      const after = await loadChatState();
      expect(stable(after.threads)).toBe(before);
      // Everything outside the fields these ops own is untouched.
      expect(stable(after.prefs)).toBe(stable(real!.prefs));
      expect(stable(after.projects)).toBe(stable(real!.projects));
      expect(after.chatCount).toBe(real!.chatCount + 1);
      expect(after.deletedThreads).toContain(id);
    });
  });
});
