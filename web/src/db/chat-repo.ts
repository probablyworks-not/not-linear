import { openChatDb, readState, STATE_KEY } from './chat';
import { emptyState } from './thread-ops';
import type { PersistedState } from './types';

// The only module in web/ that performs chat-database I/O (CLAUDE.md: DB
// writes go through the repo layer, never from a component or a store action).
//
// Both apps share one `state` row in one IndexedDB database, and the legacy
// app rewrites the whole row from its in-memory copy on every persistAll().
// So this layer's contract is deliberately narrow:
//
//   * every write is a read-modify-write inside ONE rw transaction. IndexedDB
//     serialises overlapping rw transactions across tabs, so web can never
//     clobber a write that landed between its read and its put;
//   * it only ever changes the fields a mutator touches. Unknown thread fields
//     (`stream` is rendered HTML) ride through untouched.
//
// What it cannot prevent: a legacy tab holding a STALE in-memory copy will
// overwrite web's change the next time it saves. That is inherent to running
// two writers over a whole-row schema we are not allowed to change; see ADR-039.

let db: ReturnType<typeof openChatDb> | null = null;
function chatDb(): ReturnType<typeof openChatDb> {
  return (db ??= openChatDb());
}

/** Test seam: drop the cached connection so a fresh database can be opened. */
export async function resetChatRepoForTests(): Promise<void> {
  if (db) { db.close(); db = null; }
}

export async function loadChatState(): Promise<PersistedState> {
  return (await readState(chatDb())) ?? emptyState();
}

/**
 * Legacy imports `localStorage.nl_state_v2` into Dexie exactly once, on first
 * load, when the row is absent (store.js:97-107). If web created a blank row
 * first, that import would never run and the user's old data would be
 * shadowed. Refuse to write instead.
 */
function legacyMigrationPending(): boolean {
  try { return localStorage.getItem('nl_state_v2') !== null; } catch { return false; }
}

export class ChatStateUnavailableError extends Error {}

/** Applies `mutate` atomically and returns the state that was written. */
export async function updateChatState<T>(
  mutate: (state: PersistedState) => T,
): Promise<{ state: PersistedState; result: T }> {
  const d = chatDb();
  return d.transaction('rw', d.kv, async () => {
    const row = await d.kv.get(STATE_KEY);
    if (!row && legacyMigrationPending()) {
      throw new ChatStateUnavailableError(
        'The legacy app has saved data it has not imported yet. Open the legacy app once, then reload.',
      );
    }
    const state = row ? row.value : emptyState();
    const result = mutate(state);
    await d.kv.put({ key: STATE_KEY, value: state });
    return { state, result };
  });
}
