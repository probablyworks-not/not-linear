import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { blocksToMarkdown, collectSubpageIds, exportFilename, noteToMarkdown, slugifyHeading } from '../../../src/notes/export-markdown';
import { notesFns } from '../helpers/legacy-notes-source';
import type { LegacyBlock, LegacyNote } from '../../../src/notes/types';

// The export is checked against the REAL legacy functions, cut out of notes.js, on generated pages
// (page trees, page-links, nesting, columns, tables). The one intended difference is the equation block.

type Legacy = { noteToMarkdown(n: unknown): string; slugifyHeading(s: unknown): string };
const legacyFor = (notes: LegacyNote[]): Legacy => notesFns<Legacy>(
  ['getNote', 'kidsOf', 'stripHtml', 'slugifyHeading', 'collectSubpageIds', 'blocksToMarkdown', 'noteToMarkdown'],
  { state: { notes } },
  '{ noteToMarkdown, slugifyHeading }',
);

const word = fc.string({ maxLength: 12, unit: fc.constantFrom('a', 'b', ' ', '|', '#', '*', '<', '>', '&', '\n', 'é', '-') });
const html = fc.oneof(word, word.map(w => `<b>${w}</b> and <a href="u">${w}</a>`));
const id = fc.constantFrom('n1', 'n2', 'n3', 'n4', 'ghost');

const block: fc.Arbitrary<LegacyBlock> = fc.letrec<{ b: LegacyBlock; list: LegacyBlock[] }>(tie => ({
  list: fc.array(tie('b'), { maxLength: 3 }),
  b: fc.oneof(
    { weight: 6, arbitrary: fc.record({ id: fc.constant('x'), type: fc.constantFrom('text', 'h1', 'h2', 'h3', 'h4', 'bullet', 'numbered', 'todo', 'quote', 'callout', 'toggle', 'divider', 'toc', 'mystery'), text: html, done: fc.boolean(), emoji: fc.constantFrom('', '🔥', '💡') }, { requiredKeys: ['id', 'type'] }) },
    { weight: 1, arbitrary: fc.record({ id: fc.constant('x'), type: fc.constant('code'), text: word, lang: fc.constantFrom('plain', 'js', undefined) }, { requiredKeys: ['id', 'type'] }) },
    { weight: 1, arbitrary: fc.record({ id: fc.constant('x'), type: fc.constant('image'), src: fc.constantFrom('data:image/png;base64,AA', 'https://x.test/i.png', ''), caption: html }, { requiredKeys: ['id', 'type'] }) },
    { weight: 1, arbitrary: fc.record({ id: fc.constant('x'), type: fc.constant('table'), rows: fc.array(fc.array(word, { minLength: 2, maxLength: 2 }), { maxLength: 3 }) }) },
    { weight: 1, arbitrary: fc.record({ id: fc.constant('x'), type: fc.constant('page-link'), target: id, text: word }, { requiredKeys: ['id', 'type'] }) },
    { weight: 1, arbitrary: fc.record({ id: fc.constant('x'), type: fc.constantFrom('media', 'file', 'bookmark', 'embed'), url: fc.constantFrom('https://v.test/a', ''), kind: fc.constant('youtube'), name: word, src: fc.constantFrom('data:x', ''), title: word }, { requiredKeys: ['id', 'type'] }) },
    { weight: 1, arbitrary: fc.record({ id: fc.constant('x'), type: fc.constant('cols'), cols: fc.array(tie('list'), { minLength: 1, maxLength: 2 }) }) },
    { weight: 2, arbitrary: fc.record({ id: fc.constant('x'), type: fc.constantFrom('text', 'bullet'), text: html, children: tie('list') }) },
  ),
})).b;

const notesArb = fc.array(fc.record({ title: fc.constantFrom('', 'Alpha', 'Béta Gamma!', 'Delta'), blocks: fc.array(block, { maxLength: 5 }) }), { minLength: 4, maxLength: 4 })
  .chain(rows => fc.array(fc.constantFrom(null, 'n1', 'n2', 'n3'), { minLength: 4, maxLength: 4 }).map(parents => rows.map((r, i): LegacyNote => ({
    id: `n${i + 1}`, title: r.title, blocks: r.blocks, parent: parents[i] === `n${i + 1}` ? null : parents[i],
  }))));

describe('against the legacy functions', () => {
  it('exports every generated page tree identically', () => {
    fc.assert(fc.property(notesArb, fc.constantFrom('n1', 'n2', 'n3', 'n4'), (notes, root) => {
      const legacy = legacyFor(notes);
      expect(noteToMarkdown(notes, root)).toBe(legacy.noteToMarkdown(notes.find(n => n.id === root)));
    }), { numRuns: 600 });
  });

  it('slugifies the same', () => {
    fc.assert(fc.property(fc.string({ maxLength: 20 }), s => {
      expect(slugifyHeading(s)).toBe(legacyFor([]).slugifyHeading(s));
    }), { numRuns: 300 });
  });
});

describe('what it produces', () => {
  const notes: LegacyNote[] = [
    {
      id: 'a', title: 'Alpha', blocks: [
        { id: '1', type: 'h2', text: 'Head' },
        { id: '2', type: 'numbered', text: 'one' }, { id: '3', type: 'numbered', text: 'two' },
        { id: '4', type: 'todo', text: 'done', done: true },
        { id: '5', type: 'code', text: 'x = 1', lang: 'js' },
        { id: '6', type: 'table', rows: [['a|b', 'c'], ['1', '2']] },
        { id: '7', type: 'page-link', target: 'b' },
        { id: '8', type: 'text', text: 'parent', children: [{ id: '9', type: 'bullet', text: 'kid' }] },
      ],
    },
    { id: 'b', title: 'Beta Page', parent: 'a', blocks: [{ id: 'b1', type: 'text', text: 'in beta' }] },
  ];
  const md = noteToMarkdown(notes, 'a');

  it('puts the page first and each subpage once as a section, separated by rules', () => {
    // Title, body, subpage title and subpage body are each a section, as in legacy.
    expect(md.split('\n\n---\n\n')).toHaveLength(4);
    expect(md.startsWith('# Alpha\n\n---\n\n## Head')).toBe(true);
    expect(md.match(/## Beta Page/g)).toHaveLength(1);
    expect(md.endsWith('in beta\n')).toBe(true);
  });
  it('writes real Markdown for the structure', () => {
    expect(md).toContain('1. one\n\n2. two');
    expect(md).toContain('- [x] done');
    expect(md).toContain('```js\nx = 1\n```');
    expect(md).toContain('| a\\|b | c |\n| --- | --- |\n| 1 | 2 |');
    expect(md).toContain('\u{1F4C4} [Beta Page](#beta-page)');
    expect(md).toContain('parent\n\n  - kid');
  });
  it('visits a page once even when linked in a cycle', () => {
    const cyc: LegacyNote[] = [
      { id: 'a', title: 'A', blocks: [{ id: '1', type: 'page-link', target: 'b' }] },
      { id: 'b', title: 'B', blocks: [{ id: '2', type: 'page-link', target: 'a' }] },
    ];
    expect(noteToMarkdown(cyc, 'a').match(/^## B$/gm)).toHaveLength(1);
    expect(noteToMarkdown(cyc, 'a').match(/^# A$/gm)).toHaveLength(1);
  });
  it('exports an equation as $$ TeX $$ (legacy printed it bare: the one deliberate difference)', () => {
    expect(blocksToMarkdown([{ id: 'e', type: 'eq', text: 'x^2' }], () => undefined)).toBe('$$x^2$$');
  });
  it('collects page-link targets through children and columns', () => {
    expect(collectSubpageIds([{ id: '1', type: 'cols', cols: [[{ id: '2', type: 'page-link', target: 'p' }]] }, { id: '3', type: 'text', children: [{ id: '4', type: 'page-link', target: 'q' }] }])).toEqual(['p', 'q']);
  });
  it('names the file after the page, without characters a file system rejects', () => {
    expect(exportFilename({ id: 'x', title: 'a/b: "c"?', blocks: [] })).toBe('ab c.md');
    expect(exportFilename({ id: 'x', title: '', blocks: [] })).toBe('Untitled.md');
  });
});
