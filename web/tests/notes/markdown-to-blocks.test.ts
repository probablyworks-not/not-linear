import { describe, expect, it } from 'vitest';
import { markdownToBlocks } from '../../src/notes/markdown-to-blocks';
import { blocksToMarkdown } from '../../src/notes/export-markdown';
import { legacyToBlockNote, blockNoteToLegacy } from '../../src/notes/convert';

const types = (md: string): string[] => markdownToBlocks(md).map(b => String(b.type));

describe('markdownToBlocks', () => {
  it('maps the structures a long reply contains', () => {
    const md = [
      '## Plan', '', 'First paragraph with **bold** and `code`.', '',
      '- one', '- two', '', '1. first', '2. second', '', '- [ ] todo', '- [x] done', '',
      '> quoted', '', '---', '', '```ts', 'const a = 1;', '```',
    ].join('\n');
    expect(types(md)).toEqual(['h2', 'text', 'bullet', 'bullet', 'numbered', 'numbered', 'todo', 'todo', 'quote', 'divider', 'code']);
  });

  it('keeps inline formatting as HTML and escapes the rest', () => {
    const [b] = markdownToBlocks('a **b** <script>x</script>');
    expect(b!.text).toBe('a <strong>b</strong> &lt;script&gt;x&lt;/script&gt;');
  });

  it('records to-do state', () => {
    const [a, b] = markdownToBlocks('- [ ] open\n- [x] shut');
    expect([a!.done, b!.done]).toEqual([false, true]);
  });

  it('nests indented list items under their parent', () => {
    const blocks = markdownToBlocks('- top\n  - child\n    - grandchild\n- next');
    expect(blocks).toHaveLength(2);
    const kids = blocks[0]!.children as Array<Record<string, unknown>>;
    expect(kids).toHaveLength(1);
    expect((kids[0]!.children as unknown[]).length).toBe(1);
  });

  it('keeps code verbatim, with its language, and survives an unclosed fence', () => {
    const [c] = markdownToBlocks('```python\nprint("<hi>")\n  indented\n```');
    expect(c).toMatchObject({ type: 'code', lang: 'python', text: 'print("<hi>")\n  indented' });
    const [cut] = markdownToBlocks('```\nunfinished');
    expect(cut).toMatchObject({ type: 'code', text: 'unfinished' });
  });

  it('reads a table, padding short rows', () => {
    const [t] = markdownToBlocks('| A | B |\n| --- | --- |\n| 1 | 2 |\n| 3 |');
    expect(t!.type).toBe('table');
    expect(t!.rows).toEqual([['A', 'B'], ['1', '2'], ['3', '']]);
  });

  it('caps headings at h4 and returns one empty text block for empty input', () => {
    expect(types('###### deep')).toEqual(['h4']);
    expect(markdownToBlocks('')).toMatchObject([{ type: 'text', text: '' }]);
  });

  it('gives every block a distinct id', () => {
    const ids = markdownToBlocks('# a\n\nb\n\n- c\n- d').map(b => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('produces blocks the Notes editor model accepts and returns unchanged', () => {
    const blocks = markdownToBlocks('## Title\n\nBody with **bold**.\n\n- a\n  - b\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\n```js\nx\n```');
    const { blocks: bn, sidecar } = legacyToBlockNote(blocks);
    const back = blockNoteToLegacy(bn, sidecar);
    expect(back.map(b => b.type)).toEqual(blocks.map(b => b.type));
  });

  it('exports back to equivalent markdown for the simple structures', () => {
    const md = '# Head\n\n- a\n\n1. one\n\n> q';
    const out = blocksToMarkdown(markdownToBlocks(md), () => undefined);
    expect(out).toBe(md);
  });
});
