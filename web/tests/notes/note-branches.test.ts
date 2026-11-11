import { describe, expect, it } from 'vitest';
import { apiMessages, buildNoteSystemPrompt, BRANCHABLE_TYPES, pageText, titleFromNoteQuote } from '../../src/notes/note-branches';
import type { LegacyNote } from '../../src/notes/types';

const notes: LegacyNote[] = [
  { id: 'p', title: 'Parent', blocks: [] },
  {
    id: 'c', title: 'Child', parent: 'p',
    blocks: [
      { id: '1', type: 'text', text: 'Hello <b>world</b>', children: [{ id: '2', type: 'bullet', text: 'nested' }] },
      { id: '3', type: 'cols', cols: [[{ id: '4', type: 'text', text: 'in a column' }], []] },
    ],
  },
];

describe('system prompt (legacy buildNoteSystemPrompt)', () => {
  it('names the page path, includes the text with tags stripped, and the quote', () => {
    const p = buildNoteSystemPrompt(notes, notes[1]!, 'world', {});
    expect(p).toContain('Note: Parent › Child');
    expect(p).toContain('Content:\nHello world\nnested\nin a column');
    expect(p).toContain('Selected passage:\n“world”');
    expect(p.startsWith('You are a research assistant helping the user think through their notes.')).toBe(true);
  });
  it('omits content and quote when there are none, and caps the page text at 3000 chars', () => {
    const p = buildNoteSystemPrompt(notes, notes[0]!, null, {});
    expect(p).not.toContain('Content:');
    expect(p).not.toContain('Selected passage');
    const long: LegacyNote = { id: 'l', title: 'L', blocks: [{ id: 'x', type: 'text', text: 'a'.repeat(5000) }] };
    expect(buildNoteSystemPrompt([long], long, null, {}).split('Content:\n')[1]!.length).toBe(3000);
  });
  it('adds the active mode', () => {
    expect(buildNoteSystemPrompt(notes, notes[1]!, null, { mode: 'research' })).toMatch(/\n\n.+/);
  });
});

describe('helpers', () => {
  it('pageText walks children and columns', () => expect(pageText(notes[1]!.blocks)).toBe('Hello world\nnested\nin a column'));
  it('titles are cut at 36', () => {
    expect(titleFromNoteQuote(null)).toBe('Untitled branch');
    expect(titleFromNoteQuote('x'.repeat(50))).toHaveLength(36);
  });
  it('the quote rides on the first message only', () => {
    expect(apiMessages('q', [{ role: 'user', content: 'why' }])).toEqual([{ role: 'user', content: '“q”\n\nwhy' }]);
    expect(apiMessages('q', [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }])[0]!.content).toBe('a');
    expect(apiMessages(null, [{ role: 'user', content: 'why' }])[0]!.content).toBe('why');
  });
  it('branchable types are the legacy set', () => {
    for (const t of ['paragraph', 'heading', 'bulletListItem', 'numberedListItem', 'checkListItem', 'toggle', 'quote', 'callout']) expect(BRANCHABLE_TYPES.has(t)).toBe(true);
    for (const t of ['codeBlock', 'table', 'image', 'equation']) expect(BRANCHABLE_TYPES.has(t)).toBe(false);
  });
});
