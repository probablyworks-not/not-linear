import { describe, expect, it } from 'vitest';
import { schemaPaths } from '../../src/db/keypaths';
import { CHAT_DB_NAME, CHAT_DB_VERSION, openChatDb } from '../../src/db/chat';
import { DESIGNS_DB_NAME, DESIGNS_DB_VERSION, DESIGNS_INDEX_KEY, isRunKey, openDesignsDb, runKey } from '../../src/db/designs';
import type { SpecRunDoc } from '../../src/designs/types';

// Same deal as the chat and notes goldens: a renamed or removed field breaks this test, a genuinely
// new one shows up as a reviewable snapshot diff. The sample is deliberately FULL — every optional
// field is present — because an absent field leaves no path to snapshot.
const sample = (): SpecRunDoc => ({
  run: {
    id: 'dr_1', projectId: 'p1', title: 'Project details v2', stage: 'frozen', status: 'done',
    counts: { screens: 6, flows: 4, requirements: 38, pending: 0 },
    visionUsed: true, createdAt: 1, updatedAt: 2, frozenAt: 3, specArtifactId: 'art_1', parentRunId: 'dr_0',
  },
  bundle: {
    files: [{ name: 'active.dc.html', size: 36031, kind: 'dc', content: '<x-dc></x-dc>', base64: '' }],
    skipped: [{ name: 'support.js', reason: 'runtime support file, not a design' }],
  },
  spec: {
    source_file: 'active.dc.html', combined_from: ['active.dc.html'], extracted_at: '2026-10-23T00:00:00.000Z',
    screens: [{
      id: 'sActive', display_name: 'Active project', parent_state: null, fidelity_tier: 'standard',
      boundary_confidence: 'low', boundary_note: 'wraps two elements',
      elements: [{ kind: 'button', label_text: 'New chat', placeholder_text: null, action_binding: 'onNewChat', required: null, expected_condition: null }],
      repeated_structures: [{ list_binding: 'chats', item_alias: 'c', item_fields: [{ field: 'title', inferred_meaning: 'chat title' }] }],
    }],
    design_tokens: { components: [{ component: 'button', variants: [{ context: 'primary', values: { background: '#1A1A1A' }, is_majority_pattern: true }] }] },
    unresolved_style_bindings: [{ binding_name: 'o.bg', screen_id: 'sActive', property: 'background', note: 'state-dependent' }],
    flagged_unreferenced_bindings: [{ binding_name: 'unused', found_near: 'sActive', note: 'never rendered' }],
  },
  flows: [{
    id: 'F1', title: 'Open a project\'s notes', trigger: 'click the Notes card header',
    steps: [{ screenId: 'sActive', action: 'click', result: 'notes drill-in opens' }],
    successState: 'notes list visible', failureStates: ['no notes yet'],
    evidence: [{ kind: 'readme', ref: 'Drill-in views' }], status: 'accepted', originalTitle: 'Notes', editedAt: 4,
  }],
  requirements: [{
    id: 'R-001', title: 'Notes card opens the notes view', statement: 'Clicking the card header navigates.',
    acceptanceCriteria: ['the view shows every note in the project'], priority: 'must',
    flowIds: ['F1'], screenIds: ['sActive'], evidence: [{ kind: 'dc', ref: 'notes.dc.html' }],
    source: 'model', status: 'edited', originalStatement: 'Clicking navigates.', editedAt: 5,
  }],
  questions: [{ id: 'q1', question: 'Is Memory shipping?', options: [{ label: 'No', hint: 'placeholder only' }], multi: false }],
  answers: [{ id: 'q1', question: 'Is Memory shipping?', answer: 'No' }],
  log: [{ at: 6, stage: 'flows', level: 'warn', message: 'one flow dropped', raw: '{"flows":' }],
});

describe('designs run document schema', () => {
  it('matches the golden set of key paths', () => {
    expect(schemaPaths(sample())).toMatchSnapshot();
  });

  it('is keyed by run id in the row key, so no ID_KEYED_MAPS entry is needed', () => {
    // If the index row ever becomes a map keyed by run id, `keypaths.ts` needs an entry for it or
    // this golden churns on every run created.
    const paths = schemaPaths(sample());
    expect(paths.some(p => p.includes('.*.'))).toBe(false);
  });
});

describe('designs database schema is separate (ADR-007 → 043 → 058 → 065)', () => {
  it('is a different database from the chat one', () => {
    expect(DESIGNS_DB_NAME).toBe('notlinear-designs');
    expect(DESIGNS_DB_NAME).not.toBe(CHAT_DB_NAME);
  });

  it('is version 1 with exactly one "kv" store keyed by "key"', async () => {
    expect(DESIGNS_DB_VERSION).toBe(1);
    const db = openDesignsDb(`designs-schema-${Math.random()}`);
    await db.open();
    expect(db.verno).toBe(1);
    expect(db.tables.map(t => t.name)).toEqual(['kv']);
    expect(db.table('kv').schema.primKey.keyPath).toBe('key');
    expect(db.table('kv').schema.indexes).toEqual([]);
    db.close();
  });

  it('separates the index row from the run rows by key prefix', () => {
    expect(isRunKey(runKey('dr_1'))).toBe(true);
    expect(isRunKey(DESIGNS_INDEX_KEY)).toBe(false);
  });

  it('writing a design run does not touch the chat database', async () => {
    const { createRun, resetDesignsDbForTests } = await import('../../src/designs/designs-repo');
    const chat = openChatDb();
    await chat.kv.clear();
    resetDesignsDbForTests(`designs-isolation-${Math.random()}`);
    await createRun({ projectId: 'p1', title: 't', bundle: { files: [], skipped: [] } });
    expect(await chat.kv.count()).toBe(0);
    expect(chat.verno).toBe(CHAT_DB_VERSION);
    chat.close();
  });
});
