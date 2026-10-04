import { describe, it, expect } from 'vitest';
import { openChatDb, CHAT_DB_NAME, CHAT_DB_VERSION } from '../../src/db/chat';
import { openNotesDb, NOTES_DB_NAME, NOTES_DB_VERSION, NOTES_KEYS } from '../../src/db/notes';

// Guards the schema declaration itself, not the data flowing through it.
//
// Added after a mutation test showed the differential oracle did NOT catch a
// Dexie version bump: changing `version(1)` to `version(2)` left all 24 oracle
// tests green, because a fresh test database happily opens at any version.
// Against a REAL user database that bump runs an upgrade — the single change
// AGENTS.md calls sacred, and the one that cannot be undone. Hence these
// assertions on the declaration rather than on behaviour.
describe('chat database schema is frozen', () => {
  it('is named "notlinear"', () => {
    expect(CHAT_DB_NAME).toBe('notlinear');
  });

  it('is version 1 — a bump requires a written migration, never a silent edit', async () => {
    expect(CHAT_DB_VERSION).toBe(1);
    const db = openChatDb();
    await db.open();
    expect(db.verno).toBe(1);
    db.close();
  });

  it('declares exactly one store, "kv", keyed by "key"', async () => {
    const db = openChatDb();
    await db.open();
    expect(db.tables.map(t => t.name)).toEqual(['kv']);
    expect(db.table('kv').schema.primKey.keyPath).toBe('key');
    expect(db.table('kv').schema.indexes).toEqual([]);
    db.close();
  });
});

describe('notes database schema is frozen and separate (ADR-007)', () => {
  it('is a different database from the chat one', () => {
    expect(NOTES_DB_NAME).toBe('notlinear-notes');
    expect(NOTES_DB_NAME).not.toBe(CHAT_DB_NAME);
  });

  it('is version 1 with exactly one "kv" store keyed by "key"', async () => {
    expect(NOTES_DB_VERSION).toBe(1);
    const db = openNotesDb();
    await db.open();
    expect(db.verno).toBe(1);
    expect(db.tables.map(t => t.name)).toEqual(['kv']);
    expect(db.table('kv').schema.primKey.keyPath).toBe('key');
    db.close();
  });

  it('uses the three documented keys', () => {
    expect([...NOTES_KEYS]).toEqual(['nl_notes_v1', 'nl_notes_selected_v1', 'nl_notes_open_v1']);
  });
});

describe('the two databases stay independent', () => {
  it('writing notes does not touch the chat database', async () => {
    const chat = openChatDb();
    await chat.kv.clear();
    const notes = openNotesDb();
    await notes.kv.put({ key: 'nl_notes_v1', value: [{ id: 'n1', blocks: [] }] });
    expect(await chat.kv.count()).toBe(0);
    chat.close();
    notes.close();
  });
});
