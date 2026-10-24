import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';

type Repo = typeof import('../../src/notes/notes-repo');

const note = (id: string, text: string, extra: object = {}) => ({
  id, title: id, emoji: '📄', tags: [], parent: null, blocks: [{ id: `${id}-b`, type: 'text', text }], updatedAt: 1, ...extra,
});

async function freshRepo(notes: unknown[]): Promise<Repo> {
  vi.resetModules();
  globalThis.indexedDB = new IDBFactory();
  const { openNotesDb, NOTES_KEY, NOTES_OPEN_KEY, NOTES_SELECTED_KEY } = await import('../../src/db/notes');
  const seed = openNotesDb();
  await seed.kv.bulkPut([
    { key: NOTES_KEY, value: notes },
    { key: NOTES_SELECTED_KEY, value: 'a' },
    { key: NOTES_OPEN_KEY, value: ['a'] },
  ]);
  seed.close();
  return import('../../src/notes/notes-repo');
}

const grantBackup = () => localStorage.setItem('nl_notes_v2_backed_up', JSON.stringify({ at: 'x', path: '/p', bytes: 1 }));

beforeEach(() => localStorage.clear());

describe('Notes stay locked until a backup is verified', () => {
  it('refuses every write with no backup flag, and changes nothing', async () => {
    const repo = await freshRepo([note('a', 'one')]);
    await expect(repo.saveNoteBlocksTo('a', [])).rejects.toThrow(/backed up/);
    await expect(repo.saveNoteTitle('a', 'new')).rejects.toThrow(/backed up/);
    expect((await repo.readNotes())[0]!.blocks).toHaveLength(1);
  });

  it('sets the flag only from a confirmed server answer', async () => {
    const repo = await freshRepo([note('a', 'one')]);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: false, error: 'disk full' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, path: '/b/x.json', bytes: 0 }), { status: 200 }))
      .mockResolvedValueOnce(new Response('nope', { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, path: '/b/x.json', bytes: 321 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(repo.backUpNotes()).rejects.toThrow('disk full');
    await expect(repo.backUpNotes()).rejects.toThrow();
    await expect(repo.backUpNotes()).rejects.toThrow();
    expect(repo.backupRecord()).toBeNull();
    const rec = await repo.backUpNotes();
    expect(rec).toMatchObject({ path: '/b/x.json', bytes: 321 });
    expect(repo.backupRecord()?.path).toBe('/b/x.json');
    vi.unstubAllGlobals();
  });

  it('sends the whole database in the restorable backup format, with no localStorage', async () => {
    const repo = await freshRepo([note('a', 'one'), note('b', 'two')]);
    localStorage.setItem('nl_api_keys', 'secret');
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, path: '/p', bytes: 9 }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await repo.backUpNotes();
    const sent = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string) as { backup: Record<string, any> }; // reason: test reads an untyped payload
    const b = sent.backup;
    expect(b.format).toBe('notlinear-backup/v1');
    expect(b.localStorage).toEqual({});
    expect(JSON.stringify(b)).not.toContain('secret');
    const records = b.databases['notlinear-notes'].stores.kv.records as { key: string; value: { key: string; value: unknown } }[];
    expect(records.map((r) => r.key).sort()).toEqual(['nl_notes_open_v1', 'nl_notes_selected_v1', 'nl_notes_v1']);
    expect(records.every((r) => r.value.key === r.key)).toBe(true);
    vi.unstubAllGlobals();
  });
});

describe('writes touch only what they own', () => {
  it('changes one note\'s blocks and updatedAt, nothing else', async () => {
    const repo = await freshRepo([note('a', 'one', { branches: [{ bid: 'nb1' }] }), note('b', 'two')]);
    grantBackup();
    const before = await repo.readNotes();
    expect(await repo.saveNoteBlocksTo('a', [{ id: 'a-b', type: 'text', text: 'changed' }])).toBe(true);
    const after = await repo.readNotes();
    expect(after[0]!.blocks).toEqual([{ id: 'a-b', type: 'text', text: 'changed' }]);
    expect(after[0]!.updatedAt).toBeGreaterThan(1);
    expect(after[0]!.branches).toEqual([{ bid: 'nb1' }]);
    expect(after[1]).toEqual(before[1]);
    const { openNotesDb, NOTES_OPEN_KEY, NOTES_SELECTED_KEY } = await import('../../src/db/notes');
    const d = openNotesDb();
    expect((await d.kv.get(NOTES_SELECTED_KEY))?.value).toBe('a');
    expect((await d.kv.get(NOTES_OPEN_KEY))?.value).toEqual(['a']);
    d.close();
  });

  it('does not write, or bump updatedAt, when nothing changed', async () => {
    const repo = await freshRepo([note('a', 'one')]);
    grantBackup();
    expect(await repo.saveNoteBlocksTo('a', [{ id: 'a-b', type: 'text', text: 'one' }])).toBe(false);
    expect((await repo.readNotes())[0]!.updatedAt).toBe(1);
  });

  it('ignores a note that no longer exists', async () => {
    const repo = await freshRepo([note('a', 'one')]);
    grantBackup();
    expect(await repo.saveNoteBlocksTo('gone', [])).toBe(false);
    expect(await repo.saveNoteTitle('gone', 'x')).toBe(false);
  });

  it('renames a note', async () => {
    const repo = await freshRepo([note('a', 'one')]);
    grantBackup();
    expect(await repo.saveNoteTitle('a', 'Renamed')).toBe(true);
    expect((await repo.readNotes())[0]!.title).toBe('Renamed');
  });
});

describe('page operations', () => {
  const family = () => [note('a', 'A', { cover: { src: 'c', posY: 5 } }), note('b', 'B', { parent: 'a' }), note('c', 'C', { parent: 'b' }), note('d', 'D')];
  const keys = async () => {
    const { openNotesDb, NOTES_OPEN_KEY, NOTES_SELECTED_KEY } = await import('../../src/db/notes');
    const d = openNotesDb();
    const out = { open: (await d.kv.get(NOTES_OPEN_KEY))?.value, selected: (await d.kv.get(NOTES_SELECTED_KEY))?.value };
    d.close();
    return out;
  };

  it('refuses every structural write while locked', async () => {
    const repo = await freshRepo(family());
    await expect(repo.createNote(null)).rejects.toThrow(/backed up/);
    await expect(repo.deleteNotes(['a'])).rejects.toThrow(/backed up/);
    await expect(repo.duplicateNote('a')).rejects.toThrow(/backed up/);
    await expect(repo.reparentNote('d', 'a')).rejects.toThrow(/backed up/);
    await expect(repo.setExpanded('a', true)).rejects.toThrow(/backed up/);
    await expect(repo.patchNote('a', { tags: ['x'] })).rejects.toThrow(/backed up/);
    expect(await repo.readNotes()).toHaveLength(4);
  });

  it('creates a page with the legacy shape and expands its parent, leaving other pages alone', async () => {
    const repo = await freshRepo(family());
    grantBackup();
    const before = await repo.readNotes();
    const made = await repo.createNote('d');
    const after = await repo.readNotes();
    expect(after).toHaveLength(5);
    expect(after.slice(0, 4)).toEqual(before);
    expect(after[4]).toEqual(made);
    expect(made).toMatchObject({ parent: 'd', title: '', emoji: '📄' });
    expect((await keys()).open).toEqual(['a', 'd']);
  });

  it('deletes a whole subtree, tidies the open list and moves the selection', async () => {
    const repo = await freshRepo(family());
    grantBackup();
    await repo.setExpanded('b', true);
    expect(await repo.deleteNotes(repo.collectIds(await repo.readNotes(), 'a'))).toBe(true);
    expect((await repo.readNotes()).map(n => n.id)).toEqual(['d']);
    expect(await keys()).toEqual({ open: [], selected: 'd' });
  });

  it('duplicates a subtree after the original and leaves the cover and branches behind', async () => {
    const repo = await freshRepo(family());
    grantBackup();
    const top = await repo.duplicateNote('a');
    const notes = await repo.readNotes();
    expect(notes).toHaveLength(7);
    expect(notes[1]!.id).toBe(top);
    expect(notes[1]).not.toHaveProperty('cover');
    expect(notes.find(n => n.id === 'a')).toHaveProperty('cover');
  });

  it('moves a page, and refuses a cycle', async () => {
    const repo = await freshRepo(family());
    grantBackup();
    expect(await repo.reparentNote('d', 'c')).toBe(true);
    expect((await repo.readNotes()).find(n => n.id === 'd')!.parent).toBe('c');
    expect(await repo.reparentNote('a', 'c')).toBe(false);
    expect(await repo.reparentNote('c', null)).toBe(true);
  });

  it('patches the icon, tags and cover; null removes the cover', async () => {
    const repo = await freshRepo(family());
    grantBackup();
    await repo.patchNote('a', { emoji: 'icon:star:#fff', tags: ['x', 'y'] });
    let a = (await repo.readNotes())[0]!;
    expect(a).toMatchObject({ emoji: 'icon:star:#fff', tags: ['x', 'y'] });
    expect(a.cover).toEqual({ src: 'c', posY: 5 });
    await repo.patchNote('a', { cover: null });
    a = (await repo.readNotes())[0]!;
    expect(a).not.toHaveProperty('cover');
    await repo.patchNote('a', { cover: { src: 'n', posY: 20 } });
    expect((await repo.readNotes())[0]!.cover).toEqual({ src: 'n', posY: 20 });
  });
});

describe('Ask-AI branch records', () => {
  const br = (bid: string, extra: object = {}) => ({ bid, quote: 'q', blockId: 'a-b', messages: [], createdAt: 1, touchedAt: 1, ...extra });

  it('are locked with the rest of Notes', async () => {
    const repo = await freshRepo([note('a', 'one')]);
    await expect(repo.addBranch('a', br('x'))).rejects.toThrow(/backed up/);
  });

  it('add, append a message (bumping updatedAt), change geometry (not bumping), and remove', async () => {
    const repo = await freshRepo([note('a', 'one'), note('b', 'two')]);
    grantBackup();
    expect(await repo.addBranch('a', br('x'))).toBe(true);
    let a = (await repo.readNotes())[0]!;
    expect(repo.branchesOf(a)).toEqual([br('x')]);
    const afterAdd = a.updatedAt as number;
    expect(afterAdd).toBeGreaterThan(1);

    await repo.patchBranch('a', 'x', b => { b.messages.push({ role: 'user', content: 'hi' }); b.touchedAt = 5; }, true);
    a = (await repo.readNotes())[0]!;
    expect(repo.branchesOf(a)[0]!.messages).toEqual([{ role: 'user', content: 'hi' }]);

    const before = a.updatedAt;
    await new Promise(r => setTimeout(r, 5));
    await repo.patchBranch('a', 'x', b => { b.collapsed = true; b.width = 420; });
    a = (await repo.readNotes())[0]!;
    expect(repo.branchesOf(a)[0]).toMatchObject({ collapsed: true, width: 420 });
    expect(a.updatedAt).toBe(before);

    expect(await repo.patchBranch('a', 'nope', () => {})).toBe(false);
    expect(await repo.removeBranch('a', 'x')).toBe(true);
    a = (await repo.readNotes())[0]!;
    expect(a).not.toHaveProperty('branches');
    expect((await repo.readNotes())[1]).toEqual(note('b', 'two'));
  });

  it('leave a note\'s blocks and its other branches alone', async () => {
    const repo = await freshRepo([note('a', 'one', { branches: [br('keep')] })]);
    grantBackup();
    await repo.addBranch('a', br('new'));
    await repo.removeBranch('a', 'new');
    const a = (await repo.readNotes())[0]!;
    expect(repo.branchesOf(a).map(b => b.bid)).toEqual(['keep']);
    expect(a.blocks).toEqual(note('a', 'one').blocks);
  });
});
