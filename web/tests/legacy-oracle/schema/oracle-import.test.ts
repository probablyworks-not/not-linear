import { describe, it, expect } from 'vitest';

// The whole schema-safety design rests on being able to import the REAL
// frontend/core/store.js and use it as the oracle, rather than reimplementing
// its shape in TypeScript and hoping the two agree. This file proves that is
// possible; if it fails, the oracle strategy has to be replaced, not patched.
describe('legacy frontend/core/store.js is importable under test', () => {
  it('imports and exposes its public surface', async () => {
    const store = await import('../../../../frontend/core/store.js');
    expect(typeof store.persistAll).toBe('function');
    expect(typeof store.loadPersistedState).toBe('function');
    expect(store.STATIC_THREAD_IDS).toBeInstanceOf(Set);
    expect(store.deletedThreadIds).toBeInstanceOf(Set);
  });

  it('imports the modules store.js depends on', async () => {
    const state = await import('../../../../frontend/core/state.js');
    const modes = await import('../../../../frontend/core/modes.js');
    expect(state.appState).toBeTypeOf('object');
    expect(typeof modes.hasMode).toBe('function');
  });
});
