import { describe, it, expect } from 'vitest';
import { openChatDb, readState, writeState } from '../../src/db/chat';

// Proves the test environment itself before any test relies on it: that
// IndexedDB exists, that Dexie is reachable as a global the way the legacy
// modules expect, and that a real read/write round-trip through Dexie works.
// If this file fails, every other schema test's result is meaningless.
describe('test harness', () => {
  it('exposes a working IndexedDB', () => {
    expect(typeof indexedDB).toBe('object');
  });

  it('exposes Dexie as a global, as frontend/core/store.js expects', () => {
    expect((globalThis as unknown as { Dexie?: unknown }).Dexie).toBeDefined();
  });

  it('round-trips the state row through the typed layer', async () => {
    const db = openChatDb('harness-check');
    const state = {
      threads: {}, current: 'doc-main', dynamic: [], deletedThreads: [],
      chatCount: 0, projects: {}, projectCount: 0, prefs: {},
    };
    await writeState(db, state);
    expect(await readState(db)).toEqual(state);
    db.close();
  });

  it('provides a DOM, which persistAll() needs for its sidebar query', () => {
    document.body.innerHTML = '<div class="sidebar"><button data-thread="t1" data-title="One"></button></div>';
    expect(document.querySelectorAll('.sidebar [data-thread]')).toHaveLength(1);
  });
});
