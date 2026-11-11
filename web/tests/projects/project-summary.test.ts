import { ago, chatRows, filterArtifacts, filterNotes, itemCount, metaLine, notePreview, shortTime } from '../../src/projects/project-summary';
import type { ProjectArtifact } from '../../src/projects/extras/types';

const NOW = new Date('2026-10-22T12:00:00').getTime();
const h = (n: number) => NOW - n * 3_600_000;
const d = (n: number) => NOW - n * 86_400_000;

describe('shortTime (chat rows)', () => {
  it('uses minutes, hours, weekday, then date', () => {
    expect(shortTime(NOW - 5_000, NOW)).toBe('now');
    expect(shortTime(NOW - 12 * 60_000, NOW)).toBe('12m');
    expect(shortTime(h(2), NOW)).toBe('2h');
    expect(shortTime(d(3), NOW)).toBe('Mon'); // 19 Oct 2026 is a Monday
    expect(shortTime(d(8), NOW)).toBe('Oct 14');
    expect(shortTime(new Date('2025-03-02T10:00:00').getTime(), NOW)).toBe('Mar 2, 2025');
    expect(shortTime(undefined, NOW)).toBe('');
  });
});

describe('ago (meta line and cards)', () => {
  it('counts up through minutes, hours, days, weeks', () => {
    expect(ago(NOW - 1000, NOW)).toBe('just now');
    expect(ago(h(2), NOW)).toBe('2h ago');
    expect(ago(d(1), NOW)).toBe('1d ago');
    expect(ago(d(14), NOW)).toBe('2w ago');
    expect(ago(d(200), NOW)).toBe('Apr 5');
    expect(ago(0, NOW)).toBe('');
  });
});

describe('metaLine and itemCount', () => {
  it('is the brand-new line when nothing is in the project', () => {
    expect(metaLine({ chats: 0, notes: 0, artifacts: 0, files: 0 }, { updatedAt: NOW }, NOW)).toBe('Just created · nothing here yet');
  });
  it('sums chats, notes, artifacts and files', () => {
    const c = { chats: 18, notes: 14, artifacts: 9, files: 14 };
    expect(itemCount(c)).toBe(55);
    expect(metaLine(c, { updatedAt: h(2) }, NOW)).toBe('55 items · active 2h ago');
    expect(metaLine({ chats: 1, notes: 0, artifacts: 0, files: 0 }, { updatedAt: undefined }, NOW)).toBe('1 item');
  });
});

describe('chatRows', () => {
  it('sorts by latest activity, counts branches, and takes the last assistant text as the subtitle', () => {
    const rows = chatRows({
      a: { title: 'Old', updatedAt: d(5), mainMessages: [{ role: 'user', content: 'q' }, { role: 'assistant', content: 'first  answer\nhere' }] },
      b: { title: 'New', updatedAt: h(1), branchSnapshots: { x: {} as never, y: {} as never } },
      c: { title: 'Branched later', updatedAt: d(9), branchRecents: { z: { touchedAt: h(0.5) } as never } },
      d: {},
    }, ['a', 'b', 'c', 'd']);
    expect(rows.map(r => r.id)).toEqual(['c', 'b', 'a', 'd']);
    expect(rows.find(r => r.id === 'a')!.subtitle).toBe('first answer here');
    expect(rows.find(r => r.id === 'b')!.branchCount).toBe(2);
    expect(rows.find(r => r.id === 'd')!.title).toBe('Untitled chat');
  });
});

describe('notes', () => {
  const notes = [
    { id: '1', blocks: [], title: 'Plain', updatedAt: 5 },
    { id: '2', blocks: [], title: 'Pinned old', pinned: true, updatedAt: 1 },
    { id: '3', blocks: [], title: 'Newest', updatedAt: 9 },
  ];
  it('puts pinned first, then newest; Pinned filter keeps only pinned', () => {
    expect(filterNotes(notes, 'all').map(n => n.id)).toEqual(['2', '3', '1']);
    expect(filterNotes(notes, 'pinned').map(n => n.id)).toEqual(['2']);
  });
  it('previews the first non-empty text, looking into children', () => {
    expect(notePreview({ id: 'x', blocks: [{ text: '  ' }, { children: [{ text: 'Deep   line' }] }] })).toBe('Deep line');
    expect(notePreview({ id: 'y', blocks: [] })).toBe('');
  });
});

describe('filterArtifacts', () => {
  const mk = (id: string, type: ProjectArtifact['type'], updatedAt: number): ProjectArtifact =>
    ({ id, projectId: 'p', title: id, type, version: 1, chatId: 'c', updatedAt });
  const list = [mk('a', 'SVG', 1), mk('b', 'MD', 3), mk('c', 'TSX', 2), mk('d', 'HTML', 4)];
  it('maps types to Documents / Diagrams / Code and sorts newest first', () => {
    expect(filterArtifacts(list, 'all').map(a => a.id)).toEqual(['d', 'b', 'c', 'a']);
    expect(filterArtifacts(list, 'document').map(a => a.id)).toEqual(['d', 'b']);
    expect(filterArtifacts(list, 'diagram').map(a => a.id)).toEqual(['a']);
    expect(filterArtifacts(list, 'code').map(a => a.id)).toEqual(['c']);
  });
});
