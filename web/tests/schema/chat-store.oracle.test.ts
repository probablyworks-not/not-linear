import { describe, it, expect, beforeEach, vi } from 'vitest';
import { openChatDb, readState, writeState, PERSISTED_PREFS_KEYS } from '../../src/db/chat';
import type { PersistedState } from '../../src/db/types';

// The differential oracle.
//
// The risk this guards against is subtle: a TypeScript persistence layer that
// looks right, typechecks, and silently drops a field the legacy app depends
// on. Comparing it against a hand-written spec would only prove the spec and
// the code agree. So instead the REAL frontend/core/store.js is imported and
// used as the source of truth — if the two layers ever disagree about what is
// written or read, that is a failure here rather than data loss later.
//
// store.js writes to the hardcoded database name 'notlinear', so these tests
// use that name and clear it between cases.

type LegacyStore = typeof import('../../../frontend/core/store.js');
type LegacyState = typeof import('../../../frontend/core/state.js');

/**
 * A typed view of the legacy appState. frontend/core/state.js is plain JS, so
 * TypeScript infers `{}` for its maps and every index read is an error under
 * `strict`. This describes only the fields these tests touch.
 */
interface LegacyAppState {
  threadState: Record<string, Record<string, unknown> | undefined>;
  projects: Record<string, unknown>;
  prefs: Record<string, unknown>;
  currentThreadId: string;
  newChatCount: number;
  projectCount: number;
}

const asAppState = (s: LegacyState['appState']): LegacyAppState =>
  s as unknown as LegacyAppState;

/**
 * Resets the legacy appState to its documented defaults (frontend/core/state.js).
 *
 * appState is a single module-level object shared by every legacy module, so
 * without this the seeds contaminate each other — a project written by one
 * case is still there for the next, and the oracle reports a mismatch that is
 * an artefact of the test rather than a real drift.
 */
function resetAppState(appState: LegacyAppState): void {
  for (const k of Object.keys(appState.threadState)) delete appState.threadState[k];
  for (const k of Object.keys(appState.projects)) delete appState.projects[k];
  for (const k of Object.keys(appState.prefs)) delete appState.prefs[k];
  Object.assign(appState.prefs, {
    name: 'Alex', tone: 'concise', context: '', model: 'sonnet',
    mode: 'general', folderName: 'Workspace', searxngUrl: '',
    thinking: false, theme: 'dark', rankingLlm: 'none',
    customModes: [], modeOverrides: {},
  });
  appState.currentThreadId = 'doc-main';
  appState.newChatCount = 1;
  appState.projectCount = 1;
}

/** Builds the sidebar DOM persistAll() reads its `dynamic` list from. */
function renderSidebar(threads: Array<{ id: string; title: string }>): void {
  document.body.innerHTML = `<div class="sidebar">${threads
    .map(t => `<button data-thread="${t.id}" data-title="${t.title}"></button>`)
    .join('')}</div>`;
}

/** The six DOM callbacks loadPersistedState injects its mutations through. */
function stubCallbacks() {
  return {
    renderPrefsUI: vi.fn(),
    resolveThreadTitle: vi.fn((state: { title?: string } | undefined, fallback: string) => state?.title || fallback),
    addThreadButton: vi.fn((id: string, title: string) => {
      document.querySelector('.sidebar')?.insertAdjacentHTML(
        'beforeend', `<button data-thread="${id}" data-title="${title}"></button>`);
    }),
    updateThreadButtonTitle: vi.fn(),
    refreshThreadUnreadIndicators: vi.fn(),
    renderProjects: vi.fn(),
  };
}

/** Eight states covering the field combinations that actually vary. */
const SEEDS: Array<{ name: string; state: PersistedState }> = [
  {
    name: 'empty',
    state: { threads: {}, current: 'doc-main', dynamic: [], deletedThreads: [], chatCount: 0, projects: {}, projectCount: 0, prefs: {} },
  },
  {
    name: 'one thread with rendered stream HTML',
    state: {
      threads: { 'chat-1': { title: 'First', stream: '<p>hello <span class="highlighted" data-hid="h1">world</span></p>' } },
      current: 'chat-1', dynamic: [{ id: 'chat-1', title: 'First' }], deletedThreads: [],
      chatCount: 1, projects: {}, projectCount: 0, prefs: { theme: 'dark-mono' },
    },
  },
  {
    // Shape taken from a real database via the key-path golden, NOT invented.
    // An earlier version of this seed used a `branches: []` array, which does
    // not exist in practice — branches persist as two id-keyed maps.
    name: 'branches and highlights (real shape)',
    state: {
      threads: {
        'chat-1': {
          title: 'Branched', stream: '<p>a <span class="branched" data-bid="b1">b</span></p>',
          branchSnapshots: {
            b1778130159563: { id: 'b1778130159563', bodyHTML: '<p>branch body</p>', parentBid: null, depth: 0 },
          } as never, // deliberately partial: legacy snapshots predate several fields
          branchRecents: {
            b1778130159563: {
              id: 'b1778130159563', anchorBid: 'b1', createdAt: 1778130159563,
              touchedAt: 1778130159999, depth: 0, parentBid: null, quote: 'b',
              mainTurnId: null, mainTurnPrompt: 'why?',
            },
          },
          highlights: [{ id: 'h1', text: 'b', source: 'assistant' }] as never, // deliberately off-spec: unknown values must survive
          mainMessages: [{ role: 'user', content: 'hi' }],
          model: 'sonnet', provider: 'claude',
          tokenIn: 10, tokenOut: 20, cost: 0.0003, unread: false,
        },
      },
      current: 'chat-1', dynamic: [{ id: 'chat-1', title: 'Branched' }], deletedThreads: [],
      chatCount: 1, projects: {}, projectCount: 0, prefs: {},
    },
  },
  {
    name: 'deleted threads',
    state: {
      threads: { 'chat-2': { title: 'Kept' } }, current: 'chat-2',
      dynamic: [{ id: 'chat-2', title: 'Kept' }], deletedThreads: ['chat-9', 'chat-8'],
      chatCount: 3, projects: {}, projectCount: 0, prefs: {},
    },
  },
  {
    name: 'projects (object keyed by id, not an array)',
    state: {
      threads: {}, current: 'doc-main', dynamic: [], deletedThreads: [], chatCount: 0,
      projects: {
        p1: { id: 'p1', name: 'Alpha', rules: 'be terse', files: ['a.md'], path: '/tmp/alpha', updatedAt: 1730000000000 },
        p2: { id: 'p2', name: 'Beta', rules: '', files: [], path: '', updatedAt: 0 },
      },
      projectCount: 2, prefs: {},
    },
  },
  {
    name: 'full prefs',
    state: {
      threads: {}, current: 'doc-main', dynamic: [], deletedThreads: [], chatCount: 0,
      projects: {}, projectCount: 0,
      prefs: {
        name: 'Yash', tone: 'direct', context: 'research', model: 'claude', mode: 'general',
        folderName: '/tmp/x', searxngUrl: 'http://127.0.0.1:8888', thinking: true,
        theme: 'light', rankingLlm: 'deepseek',
        customModes: [{ id: 'custom-1', label: 'Mine', system: 'be brief' }],
        modeOverrides: { general: { system: 'overridden' } },
      },
    },
  },
  {
    name: 'legacy save with no additive fields',
    state: {
      threads: { 'chat-1': { title: 'Old' } }, current: 'chat-1',
      dynamic: [{ id: 'chat-1', title: 'Old' }], deletedThreads: [], chatCount: 1,
      projects: {}, projectCount: 0,
      prefs: { name: 'Old', theme: 'grey' },
    },
  },
  {
    name: 'thread carrying unknown future fields',
    state: {
      threads: { 'chat-1': { title: 'Future', stream: '<p>x</p>', modelPref: 'sonnet-5', someFieldAddedLater: { nested: true } } },
      current: 'chat-1', dynamic: [{ id: 'chat-1', title: 'Future' }], deletedThreads: [],
      chatCount: 1, projects: {}, projectCount: 0, prefs: {},
    },
  },
];

describe('chat store: TypeScript layer vs the real frontend/core/store.js', () => {
  let store: LegacyStore;
  let legacyState: LegacyState;

  beforeEach(async () => {
    store = await import('../../../frontend/core/store.js');
    legacyState = await import('../../../frontend/core/state.js');
    const db = openChatDb();
    await db.kv.clear();
    db.close();
    store.deletedThreadIds.clear();
    resetAppState(asAppState(legacyState.appState));
    document.body.innerHTML = '';
  });

  describe.each(SEEDS)('seed: $name', ({ state }) => {
    it('legacy writes it, the TS layer reads it back identically', async () => {
      // Drive the legacy writer by putting its inputs where it looks for them.
      const live = asAppState(legacyState.appState);
      Object.assign(live.threadState, state.threads);
      live.currentThreadId = state.current;
      live.newChatCount = state.chatCount;
      Object.assign(live.projects, state.projects);
      live.projectCount = state.projectCount;
      Object.assign(live.prefs, state.prefs);
      state.deletedThreads.forEach(id => store.deletedThreadIds.add(id));
      renderSidebar(state.dynamic);

      store.persistAll();
      await new Promise(r => setTimeout(r, 20)); // persistAll is fire-and-forget

      const db = openChatDb();
      const read = await readState(db);
      db.close();

      expect(read).not.toBeNull();
      expect(read!.threads).toEqual(state.threads);
      expect(read!.current).toBe(state.current);
      expect(read!.dynamic).toEqual(state.dynamic);
      expect(new Set(read!.deletedThreads)).toEqual(new Set(state.deletedThreads));
      expect(read!.chatCount).toBe(state.chatCount);
      expect(read!.projects).toEqual(state.projects);
      expect(read!.projectCount).toBe(state.projectCount);
      // persistAll writes exactly its fixed key list, so unset prefs come back
      // as undefined rather than absent — compare only what the seed set.
      const readPrefs = read!.prefs as Record<string, unknown>;
      for (const [k, v] of Object.entries(state.prefs)) {
        expect(readPrefs[k]).toEqual(v);
      }
    });

    it('the TS layer writes it, legacy reads it back without loss', async () => {
      const db = openChatDb();
      await writeState(db, state);
      db.close();

      // Reset the legacy in-memory state so the read is observable.
      resetAppState(asAppState(legacyState.appState));
      renderSidebar([]);

      const cb = stubCallbacks();
      const ok = await store.loadPersistedState(cb);
      expect(ok).toBe(true);

      const live = asAppState(legacyState.appState);
      // Threads survive, including unknown future fields and stream HTML.
      for (const [id, thread] of Object.entries(state.threads)) {
        if (state.deletedThreads.includes(id)) continue;
        expect(live.threadState[id]).toMatchObject(thread);
      }
      // Deleted threads are dropped, not resurrected.
      for (const id of state.deletedThreads) {
        expect(live.threadState[id]).toBeUndefined();
      }
      // Projects are normalised, not dropped.
      for (const [pid, project] of Object.entries(state.projects)) {
        expect(live.projects[pid]).toEqual(project);
      }
      expect(cb.renderProjects).toHaveBeenCalled();
      expect(cb.refreshThreadUnreadIndicators).toHaveBeenCalled();
    });
  });

  it('persistAll writes exactly the documented prefs keys and no others', async () => {
    Object.assign(asAppState(legacyState.appState).prefs, { theme: 'light', somethingNotPersisted: 'should not appear' });
    renderSidebar([]);
    store.persistAll();
    await new Promise(r => setTimeout(r, 20));

    const db = openChatDb();
    const read = await readState(db);
    db.close();
    expect(Object.keys(read!.prefs).sort()).toEqual([...PERSISTED_PREFS_KEYS].sort());
  });

  it('loadPersistedState always forces thinking off, however it was saved', async () => {
    const db = openChatDb();
    await writeState(db, { ...SEEDS[0]!.state, prefs: { thinking: true, theme: 'light' } });
    db.close();
    renderSidebar([]);
    await store.loadPersistedState(stubCallbacks());
    expect(asAppState(legacyState.appState).prefs.thinking).toBe(false);
  });
});
