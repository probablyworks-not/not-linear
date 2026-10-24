import type { PersistedState } from '../../src/db/types';
import { createProjectIn, projectChatIds, setChatProjectIn } from '../../src/db/project-ops';
import { emptyState } from '../../src/db/thread-ops';
import { projectNotes, withNoteProject } from '../../src/notes/notes-ops';
import type { LegacyNote } from '../../src/notes/types';

const note = (id: string, parent: string | null = null, extra: Partial<LegacyNote> = {}): LegacyNote => ({ id, parent, blocks: [], ...extra });

describe('chat move', () => {
  it('files, moves between projects, and ungroups; one project at a time', () => {
    const s = emptyState();
    const a = createProjectIn(s, 1);
    const b = createProjectIn(s, 2);
    s.threads['chat-1'] = { kind: 'chat', title: 'x' } as unknown as PersistedState['threads'][string];
    expect(setChatProjectIn(s, 'chat-1', a)).toBe(true);
    expect(setChatProjectIn(s, 'chat-1', b)).toBe(true);
    expect(projectChatIds(s, a)).toEqual([]);
    expect(projectChatIds(s, b)).toEqual(['chat-1']);
    expect(setChatProjectIn(s, 'chat-1', null)).toBe(true);
    expect(s.threads['chat-1']?.projectId).toBeUndefined();
  });
  it('refuses unknown projects, unknown chats and the main thread', () => {
    const s = emptyState();
    s.threads['chat-1'] = { kind: 'chat', title: 'x' } as unknown as PersistedState['threads'][string];
    expect(setChatProjectIn(s, 'chat-1', 'proj-nope')).toBe(false);
    expect(setChatProjectIn(s, 'chat-zzz', null)).toBe(false);
  });
});

describe('note move', () => {
  it('files a page with its subpages and lifts a subpage to the top level', () => {
    const notes = [note('a'), note('a1', 'a'), note('b')];
    const filed = withNoteProject(notes, 'a', 'proj-1')!;
    expect(filed.map(n => n.projectId)).toEqual(['proj-1', 'proj-1', undefined]);
    expect(projectNotes(filed, 'proj-1').map(n => n.id)).toEqual(['a']);
    const lifted = withNoteProject(notes, 'a1', 'proj-2')!;
    expect(lifted.find(n => n.id === 'a1')).toMatchObject({ parent: null, projectId: 'proj-2' });
  });
  it('moves between projects, ungroups, and reports no-ops as null', () => {
    const notes = [note('a', null, { projectId: 'proj-1' })];
    expect(withNoteProject(notes, 'a', 'proj-1')).toBeNull();
    expect(withNoteProject(notes, 'a', 'proj-2')![0]?.projectId).toBe('proj-2');
    expect('projectId' in withNoteProject(notes, 'a', null)![0]!).toBe(false);
    expect(withNoteProject([note('b')], 'b', null)).toBeNull();
    expect(withNoteProject(notes, 'zzz', 'proj-1')).toBeNull();
  });
});
