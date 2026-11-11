import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

// create_note: the model files a document in Notes. Notes has its own db behind a backup lock
// (ADR-007), so these run against a fresh fake database and cover the lock, the project, and the card.

type Tool = typeof import('../../src/chat/note-tool');

async function fresh(projectId?: string): Promise<{ tool: Tool; repo: typeof import('../../src/notes/notes-repo') }> {
  vi.resetModules();
  globalThis.indexedDB = new IDBFactory();
  // Dexie is not reset with the other modules, so a database can outlive the factory: seed it empty.
  const { openNotesDb, NOTES_KEY } = await import('../../src/db/notes');
  const seed = openNotesDb();
  await seed.kv.put({ key: NOTES_KEY, value: [] });
  seed.close();
  const { useAppStore } = await import('../../src/state/app-store');
  useAppStore.setState({ threadState: { t1: projectId ? { projectId } : {} } } as never);
  return { tool: await import('../../src/chat/note-tool'), repo: await import('../../src/notes/notes-repo') };
}

const grantBackup = () => localStorage.setItem('nl_notes_v2_backed_up', JSON.stringify({ at: 'x', path: '/p', bytes: 1 }));

beforeEach(() => localStorage.clear());

describe('create_note', () => {
  it('saves nothing and says why while Notes are locked', async () => {
    const { tool, repo } = await fresh();
    const created = vi.fn();
    const out = await tool.runCreateNote({ title: 'T', content: '# x' }, { threadId: 't1', onCreated: created });
    expect(out).toMatch(/locked/);
    expect(created).not.toHaveBeenCalled();
    expect(await repo.readNotes()).toEqual([]);
  });

  it('files the document at top level, in the chat\'s project, and reports the card', async () => {
    grantBackup();
    const { tool, repo } = await fresh('p1');
    const created = vi.fn();
    const out = await tool.runCreateNote({ title: '  Market   report ', content: '## Summary\n\nText **here**.\n\n- a\n- b' }, { threadId: 't1', onCreated: created });
    expect(out).toMatch(/Saved as a note titled "Market report"/);
    const [note] = await repo.readNotes();
    expect(note).toMatchObject({ title: 'Market report', parent: null, projectId: 'p1' });
    expect(note!.blocks.map(b => b.type)).toEqual(['h2', 'text', 'bullet', 'bullet']);
    expect(created).toHaveBeenCalledWith({ id: note!.id, title: 'Market report' });
  });

  it('leaves a chat outside any project unfiled', async () => {
    grantBackup();
    const { tool, repo } = await fresh();
    await tool.runCreateNote({ title: 'T', content: 'body' }, { threadId: 't1', onCreated: () => {} });
    const [note] = await repo.readNotes();
    expect('projectId' in note!).toBe(false);
  });

  it('refuses empty content and falls back to a default title', async () => {
    grantBackup();
    const { tool, repo } = await fresh();
    expect(await tool.runCreateNote({ title: 'T', content: '   ' }, { threadId: 't1', onCreated: () => {} })).toMatch(/empty/);
    await tool.runCreateNote({ content: 'body' }, { threadId: 't1', onCreated: () => {} });
    expect((await repo.readNotes())[0]!.title).toBe('Untitled note');
  });
});
