import fc from 'fast-check';
import { escapeAttr, escapeText } from '../../src/notes/inline';

// Generates legacy-shaped inline HTML and blocks, including the awkward cases real
// data has: unknown markup, nested wrappers, duplicate ids, absent fields, junk.

const word = fc.string({ minLength: 0, maxLength: 8, unit: fc.constantFrom('a', 'b', ' ', '&', '<', '>', '"', ' ', 'é', '😀', '\n', 'x') });
const ident = fc.stringMatching(/^[a-z0-9_]{1,8}$/);
const color = fc.constantFrom('red', 'blue', 'green');

const text = word.map(escapeText);

type Node = string;
const inline = fc.letrec<{ node: Node; nodes: Node }>((tie) => ({
  nodes: fc.array(tie('node'), { maxLength: 4 }).map((a) => a.join('')),
  node: fc.oneof(
    { weight: 6, arbitrary: text },
    { weight: 2, arbitrary: fc.tuple(fc.constantFrom('b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'code', 'mark'), tie('nodes')).map(([t, c]) => `<${t}>${c}</${t}>`) },
    { weight: 1, arbitrary: fc.tuple(color, tie('nodes')).map(([c, x]) => `<span data-color="${c}">${x}</span>`) },
    { weight: 1, arbitrary: fc.tuple(fc.constantFrom('pink', 'blue'), tie('nodes')).map(([c, x]) => `<mark data-c="${c}">${x}</mark>`) },
    { weight: 2, arbitrary: fc.tuple(ident, tie('nodes')).map(([id, x]) => `<span class="nt-br-anchor" data-bid="${id}">${x}</span>`) },
    { weight: 1, arbitrary: fc.tuple(ident, tie('nodes')).map(([id, x]) => `<span class="nt-cmt" data-cid="${id}">${x}</span>`) },
    { weight: 1, arbitrary: fc.tuple(word, tie('nodes')).map(([h, x]) => `<a href="${escapeAttr(h)}">${x}</a>`) },
    { weight: 1, arbitrary: fc.tuple(word, word).map(([tex, inner]) => `<span class="nt-eq-inline" contenteditable="false" data-tex="${escapeAttr(tex)}">${escapeText(inner)}</span>`) },
    { weight: 1, arbitrary: fc.tuple(fc.constantFrom('note', 'chat'), ident, word).map(([k, id, l]) => `<span class="nt-mention" contenteditable="false" data-kind="${k}" data-id="${id}">${escapeText(l)}</span>`) },
    { weight: 1, arbitrary: fc.constant('<br>') },
    {
      weight: 1,
      arbitrary: fc.constantFrom(
        '<div>line</div>', '<div><br></div>', '<p>para</p>', '<img src="x.png">', '<!-- c -->',
        '<font color="red">f</font>', '<span style="color:red">s</span>', '<span class="other">o</span>',
        '<a href="u" onclick="x()">k</a>', '<b class="z">z</b>',
      ),
    },
  ),
}));
export const inlineHtml = inline.nodes;

const textual = ['text', 'h1', 'h2', 'h3', 'h4', 'bullet', 'numbered', 'todo', 'quote', 'callout', 'toggle'] as const;
const maybe = <T,>(a: fc.Arbitrary<T>) => fc.option(a, { nil: undefined });
const extras = fc.record({ comments: maybe(fc.array(fc.record({ cid: ident, items: fc.array(fc.record({ id: ident, text: word })) }), { maxLength: 2 })), collapsed: maybe(fc.boolean()), flavour: maybe(word) }, { requiredKeys: [] });

function strip<T extends Record<string, unknown>>(o: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out as T;
}

export type GenBlock = Record<string, unknown>;

export const legacyBlock: fc.Arbitrary<GenBlock> = fc.letrec<{ block: GenBlock; blocks: GenBlock[] }>((tie) => {
  const kids = fc.array(tie('block'), { maxLength: 2 });
  const withKids = (b: GenBlock, c: GenBlock[] | undefined) => (c ? { ...b, children: c } : b);
  const base = fc.record({ id: ident, extras, kids: maybe(kids) });
  return {
    blocks: fc.array(tie('block'), { maxLength: 3 }),
    block: fc.oneof(
      { weight: 6, arbitrary: fc.tuple(base, fc.constantFrom(...textual), maybe(inlineHtml), maybe(fc.boolean()), maybe(fc.integer({ min: 1, max: 4 })), maybe(fc.boolean()), maybe(word))
        .map(([b, type, txt, done, hl, open, emoji]) => withKids(strip({ id: b.id, type, text: txt, ...(type === 'todo' ? { done } : {}), ...(type === 'toggle' ? { headingLevel: hl, open } : {}), ...(type === 'callout' ? { emoji } : {}), ...b.extras }), b.kids)) },
      { weight: 1, arbitrary: fc.tuple(base, maybe(word), maybe(fc.constantFrom('js', 'plain'))).map(([b, t, lang]) => withKids(strip({ id: b.id, type: 'code', text: t, lang, ...b.extras }), b.kids)) },
      { weight: 1, arbitrary: fc.tuple(base, maybe(word)).map(([b, t]) => strip({ id: b.id, type: 'eq', text: t, ...b.extras })) },
      { weight: 1, arbitrary: fc.tuple(base, maybe(word), maybe(inlineHtml), maybe(fc.integer({ min: 120, max: 900 }))).map(([b, src, cap, w]) => strip({ id: b.id, type: 'image', src, caption: cap, width: w, ...b.extras })) },
      { weight: 1, arbitrary: fc.tuple(base, maybe(word), maybe(ident)).map(([b, t, target]) => strip({ id: b.id, type: 'page-link', text: t, target, ...b.extras })) },
      { weight: 1, arbitrary: fc.tuple(base, fc.constantFrom('divider', 'toc', 'media', 'file', 'bookmark', 'embed'), word, fc.boolean()).map(([b, type, u, f]) => strip({ id: b.id, type, url: u, fetchFailed: f, ...b.extras })) },
      { weight: 1, arbitrary: fc.tuple(base, maybe(fc.array(fc.array(inlineHtml, { minLength: 1, maxLength: 3 }), { minLength: 1, maxLength: 3 }))).map(([b, rows]) => strip({ id: b.id, type: 'table', rows, ...b.extras })) },
      { weight: 1, arbitrary: fc.tuple(base, maybe(fc.array(tie('blocks'), { minLength: 1, maxLength: 3 }))).map(([b, cols]) => withKids(strip({ id: b.id, type: 'cols', cols, ...b.extras }), b.kids)) },
      { weight: 1, arbitrary: fc.tuple(base, word).map(([b, type]) => strip({ id: b.id, type: `weird-${type}`, text: 'kept', ...b.extras })) },
      { weight: 1, arbitrary: fc.tuple(base, fc.constantFrom('text', 'todo', 'image', 'toggle')).map(([b, type]) => ({ id: b.id, type, text: 42, done: 'yes', src: null })) },
      { weight: 1, arbitrary: fc.constantFrom<unknown>(null, 7, 'str', [], { type: 5 }, {}).map((v) => v as GenBlock) },
    ),
  };
}).block;
