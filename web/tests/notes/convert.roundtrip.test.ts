import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import fc from 'fast-check';
import { legacyToBlockNote, blockNoteToLegacy } from '../../src/notes/convert';
import { FALLBACK_LANGUAGE } from '../../src/notes/code-languages';
import { annotate } from './annotate';
import { legacyBlock } from './generators';

// Contract: legacy -> BlockNote -> legacy is the identity, with HTML-valued fields
// compared by per-character annotation (see annotate.ts). Any lossy field fails here.

const HTML_TEXT = new Set(['text', 'h1', 'h2', 'h3', 'h4', 'bullet', 'numbered', 'todo', 'quote', 'callout', 'toggle']);

// Replaces every HTML-valued field by its annotation so deep-equal compares meaning.
function norm(b: unknown): unknown {
  if (Array.isArray(b)) return b.map(norm);
  if (typeof b !== 'object' || b === null) return b;
  const o = { ...(b as Record<string, unknown>) };
  if (HTML_TEXT.has(o.type as string) && typeof o.text === 'string') o.text = annotate(o.text);
  if (o.type === 'table' && Array.isArray(o.rows)) {
    o.rows = (o.rows as unknown[]).map((r) => (Array.isArray(r) ? r.map((c) => (typeof c === 'string' ? annotate(c) : c)) : r));
  }
  if (Array.isArray(o.children)) o.children = (o.children as unknown[]).map(norm);
  if (Array.isArray(o.cols)) o.cols = (o.cols as unknown[]).map((c) => (Array.isArray(c) ? c.map(norm) : c));
  return o;
}

function roundTrip(blocks: unknown[]) {
  const { blocks: bn, sidecar } = legacyToBlockNote(blocks);
  return blockNoteToLegacy(bn, sidecar);
}

function allIds(blocks: unknown): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (typeof v === 'object' && v !== null) {
      for (const [k, x] of Object.entries(v)) {
        if ((k === 'text' || k === 'caption') && typeof x === 'string') out.push(...annotate(x).ids);
        else if (k === 'rows' && Array.isArray(x)) x.flat().forEach((c) => typeof c === 'string' && out.push(...annotate(c).ids));
        else walk(x);
      }
    }
  };
  walk(blocks);
  return out.sort();
}

describe('legacy -> BlockNote -> legacy', () => {
  it('is the identity on generated documents', () => {
    fc.assert(
      fc.property(fc.array(legacyBlock, { maxLength: 6 }), (blocks) => {
        const back = roundTrip(blocks);
        expect(norm(back)).toEqual(norm(blocks));
      }),
      { numRuns: 800 },
    );
  });

  it('is a fixed point: a second pass changes nothing, byte for byte', () => {
    fc.assert(
      fc.property(fc.array(legacyBlock, { maxLength: 6 }), (blocks) => {
        const once = roundTrip(blocks);
        expect(JSON.stringify(roundTrip(once))).toBe(JSON.stringify(once));
      }),
      { numRuns: 400 },
    );
  });

  it('never loses a branch anchor, comment id or equation source', () => {
    fc.assert(
      fc.property(fc.array(legacyBlock, { maxLength: 6 }), (blocks) => {
        expect(allIds(roundTrip(blocks))).toEqual(allIds(blocks));
      }),
      { numRuns: 400 },
    );
  });

  // A `lang` the editor cannot highlight throws while the code block renders — outside any
  // try/catch, so it blanks the app. It is shown as plain text, and the language still round-trips.
  it('shows a code block in an unhighlightable language as plain text, keeping the language', () => {
    const blocks = [{ id: 'c1', type: 'code', lang: 'mermaid', text: 'graph TD; A-->B;' }];
    const { blocks: bn, sidecar } = legacyToBlockNote(blocks);
    expect(bn[0]!.props.language).toBe(FALLBACK_LANGUAGE);
    expect(blockNoteToLegacy(bn, sidecar)).toEqual(blocks);
  });

  it('leaves a language the editor knows alone', () => {
    const blocks = [{ id: 'c1', type: 'code', lang: 'ts', text: 'const x = 1;' }];
    const { blocks: bn, sidecar } = legacyToBlockNote(blocks);
    expect(bn[0]!.props.language).toBe('ts');
    expect(blockNoteToLegacy(bn, sidecar)).toEqual(blocks);
  });

  it('does not mutate its input', () => {
    fc.assert(
      fc.property(fc.array(legacyBlock, { maxLength: 4 }), (blocks) => {
        const before = JSON.stringify(blocks);
        roundTrip(blocks);
        expect(JSON.stringify(blocks)).toBe(before);
      }),
      { numRuns: 200 },
    );
  });

  describe('real-data fixture', () => {
    const fx = JSON.parse(readFileSync(resolve(__dirname, '../fixtures/notlinear-notes.kv.v1.json'), 'utf8')) as {
      rows: { key: string; value: unknown }[];
    };
    const notes = (fx.rows.find((r) => r.key === 'nl_notes_v1')?.value ?? []) as { id: string; blocks: unknown[] }[];

    it('has notes to test', () => expect(notes.length).toBeGreaterThan(0));

    it('round-trips every note exactly', () => {
      for (const n of notes) {
        expect(norm(roundTrip(n.blocks)), n.id).toEqual(norm(n.blocks));
        expect(allIds(roundTrip(n.blocks)), n.id).toEqual(allIds(n.blocks));
      }
    });

    it('leaves plain fields byte-identical (only inline HTML may be re-serialised)', () => {
      for (const n of notes) {
        const strip = (v: unknown): unknown => JSON.parse(JSON.stringify(v, (k, x) => (k === 'text' || k === 'rows' ? undefined : x)));
        expect(strip(roundTrip(n.blocks)), n.id).toEqual(strip(n.blocks));
      }
    });
  });
});
