import * as legacy from '../../../frontend/core/modes.js';
import { appState } from '../../../frontend/core/state.js';
import * as port from '../../src/settings/modes';
import { DEFAULT_MODES as GENERATED } from '../../src/settings/default-modes';
import type { PersistedPrefs } from '../../src/db/types';

// Differential oracle for the modes port. The legacy module is imported and run
// for real against its own global appState; the port runs the same operations
// against a plain prefs object. After EVERY step the three mode-owned keys and
// every read function must agree. Random sequences are seeded, so a failure is
// reproducible and the seed is in the test name.
//
// Drop the legacy half at the P6 cutover, when frontend/core/modes.js goes.

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const owned = (p: Record<string, unknown>) => JSON.parse(JSON.stringify({ mode: p.mode, modeOverrides: p.modeOverrides, customModes: p.customModes }));

describe('built-in mode definitions', () => {
  it('the generated copy equals the legacy source exactly', () => {
    expect(GENERATED).toEqual(legacy.DEFAULT_MODES);
    expect(port.DEFAULT_MODE_ID).toBe(legacy.DEFAULT_MODE_ID);
    expect(port.CUSTOM_MODE_ICON).toBe(legacy.CUSTOM_MODE_ICON);
  });
});

describe('modes: port vs legacy, random operation sequences', () => {
  for (const seed of [1, 2, 3, 7, 42, 99, 2026, 31337]) {
    it(`seed ${seed}`, () => {
      const r = rng(seed);
      const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
      const words = ['Teacher', 'Editor', '  spaced  ', 'Léa', 'x'.repeat(30), '', 'Q&A <b>'];
      const texts = ['', 'One paragraph.', 'Para one.\n\nPara two.\n\n\n\nPara three.', '  padded  '];

      // Both sides start from identical prefs, including pre-existing data of the shape real databases hold.
      const start: Record<string, unknown> = {
        mode: 'general',
        modeOverrides: { coding: { label: 'Code', desc: 'terse' } },
        customModes: [{ id: 'custom-seed', label: 'Seeded', desc: 'd', instructions: 'Be seeded.' }],
      };
      appState.prefs = structuredClone(start) as typeof appState.prefs;
      const mine = structuredClone(start) as PersistedPrefs;

      for (let step = 0; step < 60; step++) {
        const ids = [...port.getModes(mine).map(m => m.id), 'unknown-id', ''];
        const id = pick(ids);
        const op = pick(['save', 'saveBuiltinUnchanged', 'create', 'reset', 'delete', 'activate'] as const);

        if (op === 'save') {
          const args = { id, label: pick(words), desc: pick(words), instructions: pick(texts) };
          const a = legacy.saveMode(args);
          const b = port.saveMode(mine, args, () => a); // an unknown id creates; share the id legacy minted
          expect(b).toBe(a);
        } else if (op === 'saveBuiltinUnchanged') {
          const d = pick(port.DEFAULT_MODES);
          const args = { id: d.id, label: d.label, desc: d.desc, instructions: d.instructions };
          legacy.saveMode(args);
          port.saveMode(mine, args);
        } else if (op === 'create') {
          const args = { id: '', label: pick(words), desc: pick(words), instructions: pick(texts) };
          const a = legacy.saveMode(args);
          expect(port.saveMode(mine, args, () => a)).toBe(a);
        } else if (op === 'reset') {
          legacy.resetMode(id);
          port.resetMode(mine, id);
        } else if (op === 'delete') {
          legacy.deleteMode(id);
          port.deleteMode(mine, id);
        } else {
          appState.prefs.mode = id;
          mine.mode = id;
        }

        const where = `seed ${seed} step ${step} op ${op} id ${JSON.stringify(id)}`;
        expect(owned(mine as Record<string, unknown>), where).toEqual(owned(appState.prefs as Record<string, unknown>));
        expect(port.getModes(mine), where).toEqual(legacy.getModes());
        const probe = pick(ids);
        expect(port.getMode(mine, probe), where).toEqual(legacy.getMode(probe));
        expect(port.hasMode(mine, probe), where).toBe(legacy.hasMode(probe));
        expect(port.modeSystemPromptParts(mine, probe), where).toEqual(legacy.modeSystemPromptParts(probe));
      }
    });
  }

  it('the oracle can fail: a one-field divergence is detected', () => {
    appState.prefs = { mode: 'general' } as typeof appState.prefs;
    const mine: PersistedPrefs = { mode: 'general' };
    legacy.saveMode({ id: 'coding', label: 'Code', desc: 'd', instructions: 'i' });
    port.saveMode(mine, { id: 'coding', label: 'Code', desc: 'DIFFERENT', instructions: 'i' });
    expect(owned(mine as Record<string, unknown>)).not.toEqual(owned(appState.prefs as Record<string, unknown>));
  });
});

describe('modes: behaviours worth pinning by name', () => {
  const fresh = (): PersistedPrefs => ({ mode: 'general' });

  it('editing a built-in stores only the fields that differ, and nothing if none do', () => {
    const p = fresh();
    port.saveMode(p, { id: 'research', label: 'Research', desc: 'Mine', instructions: port.DEFAULT_MODES.find(m => m.id === 'research')!.instructions });
    expect(p.modeOverrides).toEqual({ research: { desc: 'Mine' } });
    port.saveMode(p, { id: 'research', label: 'Research', desc: 'Search-heavy, cited', instructions: port.DEFAULT_MODES.find(m => m.id === 'research')!.instructions });
    expect(p.modeOverrides).toEqual({});
  });

  it('reset removes the override and a later default change would reach the user', () => {
    const p = fresh();
    port.saveMode(p, { id: 'critic', label: 'Critic', desc: 'x', instructions: 'y' });
    expect(port.getMode(p, 'critic')).toMatchObject({ edited: true, instructions: 'y' });
    port.resetMode(p, 'critic');
    expect(port.getMode(p, 'critic')).toMatchObject({ edited: false });
  });

  it('a built-in cannot be deleted, only reset', () => {
    const p = fresh();
    port.deleteMode(p, 'coding');
    expect(port.hasMode(p, 'coding')).toBe(true);
  });

  it('deleting the active custom mode falls back to General; deleting another leaves the selection', () => {
    const p = fresh();
    const a = port.saveMode(p, { id: '', label: 'A', desc: '', instructions: '' });
    const b = port.saveMode(p, { id: '', label: 'B', desc: '', instructions: '' }, () => 'custom-b');
    p.mode = a;
    port.deleteMode(p, b);
    expect(p.mode).toBe(a);
    port.deleteMode(p, a);
    expect(p.mode).toBe('general');
  });

  it('an unknown or deleted id resolves to General', () => {
    expect(port.getMode(fresh(), 'nope').id).toBe('general');
  });

  it('system-prompt parts split on blank lines; General adds nothing', () => {
    const p = fresh();
    expect(port.modeSystemPromptParts(p, 'general')).toEqual([]);
    const id = port.saveMode(p, { id: '', label: 'T', desc: '', instructions: 'a\n\n\n b \n\nc' });
    expect(port.modeSystemPromptParts(p, id)).toEqual(['a', 'b', 'c']);
  });
});
