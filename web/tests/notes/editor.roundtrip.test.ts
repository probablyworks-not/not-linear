import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import fc from 'fast-check';
import { BlockNoteEditor } from '@blocknote/core';
import { notesSchema } from '../../src/notes/schema';
import { captureBaseline, loadNoteBlocks, saveNoteBlocks, type EditorBlock } from '../../src/notes/adapter';
import { annotate } from './annotate';
import { legacyBlock } from './generators';

// P6a proved the converter on its own. This is the proof that matters: the same documents
// pushed through a REAL BlockNote editor (its schema, its parse, its normalisation) and read
// back. If BlockNote drops a branch anchor, this fails.

const HTML_TEXT = new Set(['text', 'h1', 'h2', 'h3', 'h4', 'bullet', 'numbered', 'todo', 'quote', 'callout', 'toggle']);

function norm(b: unknown): unknown {
  const ann = (h: string) => annotate(h, { newlineIsBr: true });
  if (Array.isArray(b)) return b.map(norm);
  if (typeof b !== 'object' || b === null) return b;
  const o = { ...(b as Record<string, unknown>) };
  if (HTML_TEXT.has(o.type as string) && typeof o.text === 'string') o.text = ann(o.text);
  if (o.type === 'table' && Array.isArray(o.rows)) {
    o.rows = (o.rows as unknown[]).map((r) => (Array.isArray(r) ? r.map((c) => (typeof c === 'string' ? ann(c) : c)) : r));
  }
  if (Array.isArray(o.children)) o.children = (o.children as unknown[]).map(norm);
  if (Array.isArray(o.cols)) o.cols = (o.cols as unknown[]).map((c) => (Array.isArray(c) ? c.map(norm) : c));
  return o;
}

/** `untouched`: the baseline is captured, as the real editor does. Otherwise every block is re-serialised. */
function viaEditor(legacy: unknown[], untouched = false, edit?: (e: BlockNoteEditor<never, never, never>) => void): unknown[] {
  const loaded = loadNoteBlocks(legacy);
  const editor = BlockNoteEditor.create({ schema: notesSchema });
  editor.replaceBlocks(editor.document, loaded.editorBlocks as never);
  if (untouched) captureBaseline(loaded.session, editor.document as unknown as EditorBlock[]);
  edit?.(editor as never);
  return saveNoteBlocks(editor.document as unknown as EditorBlock[], loaded.session);
}

const anchor = (bid: string, inner: string) => `<span class="nt-br-anchor" data-bid="${bid}">${inner}</span>`;

describe('through a real BlockNote editor', () => {
  it('keeps a branch anchor, a comment span, an equation and a mention', () => {
    const text =
      `before ${anchor('nb_1', 'quoted <b>bold</b>')} mid <span class="nt-cmt" data-cid="c1">cmt</span> ` +
      `<span class="nt-eq-inline" contenteditable="false" data-tex="x^2">x2</span> ` +
      `<span class="nt-mention" contenteditable="false" data-kind="note" data-id="n1">T</span> after`;
    const blocks = [{ id: 'b1', type: 'text', text }];
    const out = viaEditor(blocks) as { text: string }[];
    expect(norm(out)).toEqual(norm(blocks));
    expect(out[0]!.text).toContain('data-bid="nb_1"');
    expect(out[0]!.text).toContain('data-cid="c1"');
    expect(out[0]!.text).toContain('data-tex="x^2"');
  });

  it('keeps unknown markup, unknown blocks and unmodelled fields', () => {
    const blocks = [
      { id: 'a', type: 'text', text: 'x <font color="red">y</font> <img src="p.png"> z', comments: [{ cid: 'c' }] },
      { id: 'b', type: 'weird', text: 'kept', extra: 1 },
      { id: 'c', type: 'media', url: 'https://example.test/v', kind: 'video' },
      { id: 'd', type: 'cols', cols: [[{ id: 'e', type: 'text', text: 'col' }], []] },
    ];
    expect(norm(viaEditor(blocks))).toEqual(norm(blocks));
  });

  it('writes an untouched note back byte for byte, literal newlines included', () => {
    const blocks = [
      { id: 'a', type: 'text', text: '<b></b>one\n\n---\n\n<font color="red">two</font><br>' },
      { id: 'b', type: 'code', text: 'l1\nl2\n', lang: 'js' },
    ];
    expect(viaEditor(blocks, true)).toEqual(blocks);
  });

  it('re-serialises only the block that was edited', () => {
    const blocks = [
      { id: 'a', type: 'text', text: `keep\n\nthis ${anchor('nb_1', 'anchor')}` },
      { id: 'b', type: 'text', text: 'old' },
    ];
    const out = viaEditor(blocks, true, (e) => { e.updateBlock('b', { content: [{ type: 'text', text: 'new', styles: {} }] } as never); }) as { id: string; text: string }[];
    expect(out[0]).toEqual(blocks[0]);
    expect(out[1]).toEqual({ id: 'b', type: 'text', text: 'new' });
  });

  it('does not grow a note: the trailing empty paragraph BlockNote adds is dropped', () => {
    const blocks = [{ id: 'a', type: 'text', text: 'only' }];
    expect(viaEditor(blocks)).toHaveLength(1);
  });

  it('is the identity on generated documents', () => {
    fc.assert(
      fc.property(fc.array(legacyBlock, { minLength: 1, maxLength: 4 }), (blocks) => {
        expect(norm(viaEditor(blocks))).toEqual(norm(blocks));
        expect(viaEditor(blocks, true)).toEqual(blocks);
      }),
      { numRuns: 150 },
    );
  });

  it('round-trips every real-data note', () => {
    const fx = JSON.parse(readFileSync(resolve(__dirname, '../fixtures/notlinear-notes.kv.v1.json'), 'utf8')) as { rows: { key: string; value: unknown }[] };
    const notes = (fx.rows.find((r) => r.key === 'nl_notes_v1')?.value ?? []) as { id: string; blocks: unknown[] }[];
    for (const n of notes) {
      expect(norm(viaEditor(n.blocks)), n.id).toEqual(norm(n.blocks));
      expect(viaEditor(n.blocks, true), n.id).toEqual(n.blocks);
    }
  });
});
