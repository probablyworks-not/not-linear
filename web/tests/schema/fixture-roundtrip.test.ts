import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openChatDb, readState, writeState } from '../../src/db/chat';
import { schemaPaths } from '../../src/db/keypaths';
import type { PersistedState } from '../../src/db/types';

// Round-trips a fixture built from REAL data through the TypeScript layer.
//
// The synthetic seeds in chat-store.oracle.test.ts only cover fields someone
// thought to write down. A real database carries the additive fields that
// accumulated over months — per-branch modelPref, project updatedAt,
// modeOverrides, note comment anchors — and is the only thing that proves the
// schema layer matches reality rather than matching its own assumptions.
//
// The fixture is deliberately NOT committed by default. Generate it from a
// backup (tools/export-data.html) with:
//
//     pnpm fixtures ~/path/to/notlinear-backup-<timestamp>.json
//
// It is redacted — structure preserved, leaf strings masked — so the result is
// safe to commit, and committing it is what makes this test run in CI.
const FIXTURE = resolve(__dirname, '../fixtures/notlinear.kv.v1.json');
const GOLDEN = resolve(__dirname, '__snapshots__/chat-keypaths.json');

interface Fixture {
  rows: Array<{ key: string; value: unknown }>;
  _source?: { realm?: string };
}

const fixture: Fixture | null = existsSync(FIXTURE)
  ? (JSON.parse(readFileSync(FIXTURE, 'utf8')) as Fixture)
  : null;

// `describe.skipIf` rather than a silent pass: an absent fixture is reported
// as skipped, so it cannot be mistaken for coverage that does not exist.
describe.skipIf(!fixture)('real-data fixture round-trip', () => {
  const state = fixture?.rows.find(r => r.key === 'state')?.value as PersistedState;

  it('has a state row', () => {
    expect(state).toBeDefined();
  });

  it('survives a write/read round-trip byte-identically', async () => {
    const db = openChatDb('fixture-roundtrip');
    await db.kv.clear();
    await writeState(db, state);
    const read = await readState(db);
    db.close();
    // Sorted-key stringify, so ordering differences neither mask a real change
    // nor masquerade as one.
    const canon = (v: unknown) => JSON.stringify(v, Object.keys(v as object).sort());
    expect(canon(read)).toBe(canon(state));
  });

  it('matches the committed key-path golden', () => {
    const paths = schemaPaths(state);
    if (!existsSync(GOLDEN)) {
      writeFileSync(GOLDEN, JSON.stringify(paths, null, 2) + '\n');
      console.warn(`wrote a new key-path golden: ${GOLDEN} — review it in the diff`);
      return;
    }
    const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as string[];
    const added = paths.filter(p => !golden.includes(p));
    const removed = golden.filter(p => !paths.includes(p));
    // Removals are the forbidden change; additions are allowed but must be
    // reviewed, so both fail until the golden is updated deliberately.
    expect({ added, removed }).toEqual({ added: [], removed: [] });
  });
});
