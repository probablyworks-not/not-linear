import { describe, expect, it } from 'vitest';
import { BlockNoteEditor } from '@blocknote/core';
import { notesSchema } from '../../src/notes/schema';
import { anchorIds, unwrapBranch, wrapSelectionInBranch, type TransactEditor } from '../../src/notes/editor-anchors';
import { loadNoteBlocks, saveNoteBlocks, captureBaseline, type EditorBlock } from '../../src/notes/adapter';

// Real headless editors. The text range is found by searching the document, then selected.

function make(blocks: unknown[]) {
  const loaded = loadNoteBlocks(blocks);
  const editor = BlockNoteEditor.create({ schema: notesSchema, initialContent: loaded.editorBlocks as never });
  captureBaseline(loaded.session, editor.document as unknown as EditorBlock[]);
  const tx = editor as unknown as TransactEditor;
  const select = (needle: string) => editor.transact(tr => {
    let from = -1;
    tr.doc.descendants((n, pos) => { if (from < 0 && n.isText && (n.text ?? '').includes(needle)) from = pos + (n.text ?? '').indexOf(needle); });
    if (from < 0) throw new Error(`no text ${needle}`);
    // The current selection is a TextSelection, so its class can build the one we want.
    const Sel = tr.selection.constructor as unknown as { create(doc: unknown, a: number, b: number): typeof tr.selection };
    tr.setSelection(Sel.create(tr.doc, from, from + needle.length));
  });
  const legacy = () => saveNoteBlocks(editor.document as unknown as EditorBlock[], loaded.session) as { id: string; text?: string }[];
  return { editor, tx, select, legacy };
}

describe('wrapSelectionInBranch', () => {
  it('wraps the selected words and saves the legacy anchor span', () => {
    const { tx, select, legacy } = make([{ id: 'b1', type: 'text', text: 'before quoted words after' }]);
    select('quoted words');
    expect(wrapSelectionInBranch(tx, 'nb_1')).toEqual({ ok: true, quote: 'quoted words', blockId: 'b1' });
    expect(legacy()[0]!.text).toBe('before <span class="nt-br-anchor" data-bid="nb_1">quoted words</span> after');
    expect(anchorIds(tx)).toEqual(['nb_1']);
  });

  it('keeps bold inside the anchor', () => {
    const { tx, select, legacy } = make([{ id: 'b1', type: 'text', text: 'one <b>two</b> three' }]);
    select('two');
    expect(wrapSelectionInBranch(tx, 'x').ok).toBe(true);
    expect(legacy()[0]!.text).toContain('<span class="nt-br-anchor" data-bid="x"><b>two</b></span>');
  });

  it('works in headings, list items, to-dos, quotes, callouts and toggles', () => {
    for (const type of ['h2', 'bullet', 'numbered', 'todo', 'quote', 'callout', 'toggle']) {
      const { tx, select } = make([{ id: 'b', type, text: 'some text here' }]);
      select('text');
      expect(wrapSelectionInBranch(tx, 'x').ok, type).toBe(true);
    }
  });

  it('refuses nothing selected, code blocks, and selections across blocks, and changes nothing', () => {
    const a = make([{ id: 'b', type: 'text', text: 'abc' }]);
    expect(wrapSelectionInBranch(a.tx, 'x')).toEqual({ ok: false, reason: 'empty' });
    const c = make([{ id: 'b', type: 'code', text: 'let x = 1', lang: 'js' }]);
    c.select('x = 1');
    expect(wrapSelectionInBranch(c.tx, 'x')).toEqual({ ok: false, reason: 'unsupported-block' });
    expect(c.legacy()[0]).toMatchObject({ id: 'b', type: 'code', text: 'let x = 1', lang: 'js' });
    expect(anchorIds(c.tx)).toEqual([]);
  });

  it('refuses a selection that holds a link or an equation, so nothing is half-kept', () => {
    const l = make([{ id: 'b', type: 'text', text: 'see <a href="https://x.test">the link</a> now' }]);
    l.select('the link');
    expect(wrapSelectionInBranch(l.tx, 'x')).toEqual({ ok: false, reason: 'contains-link-or-atom' });
    expect(l.legacy()[0]!.text).toBe('see <a href="https://x.test">the link</a> now');
  });
});

describe('unwrapBranch', () => {
  it('puts the text back and leaves other anchors', () => {
    const { tx, legacy } = make([{ id: 'b', type: 'text', text: 'a <span class="nt-br-anchor" data-bid="one">B</span> c <span class="nt-br-anchor" data-bid="two">D</span>' }]);
    expect(unwrapBranch(tx, 'one')).toBe(true);
    expect(legacy()[0]!.text).toBe('a B c <span class="nt-br-anchor" data-bid="two">D</span>');
    expect(unwrapBranch(tx, 'nope')).toBe(false);
  });
});
