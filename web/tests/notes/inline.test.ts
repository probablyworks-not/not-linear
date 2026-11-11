import { describe, it, expect } from 'vitest';
import { htmlToInline, inlineToHtml } from '../../src/notes/inline';

const types = (html: string) => htmlToInline(html).map((n) => n.type);

describe('inline mapping keeps the data-bearing spans modelled, not raw', () => {
  it('branch anchor (ADR-028)', () => {
    const n = htmlToInline('a <span class="nt-br-anchor" data-bid="nb_1">quoted <b>bold</b></span> z');
    expect(n.map((x) => x.type)).toEqual(['text', 'branchAnchor', 'text']);
    expect(n[1]).toMatchObject({ type: 'branchAnchor', bid: 'nb_1' });
  });
  it('comment span (ADR-009)', () => {
    expect(htmlToInline('<span class="nt-cmt" data-cid="c1">x</span>')[0]).toMatchObject({ type: 'comment', cid: 'c1' });
  });
  it('inline equation and mention', () => {
    expect(types('<span class="nt-eq-inline" contenteditable="false" data-tex="x^2">x2</span>')).toEqual(['inlineEq']);
    expect(types('<span class="nt-mention" contenteditable="false" data-kind="note" data-id="n1">📄 T</span>')).toEqual(['mention']);
  });
  it('styles, colour, highlight and links', () => {
    const n = htmlToInline('<b><i>x</i></b><span data-color="red">r</span><mark data-c="pink">p</mark><a href="u">l</a>');
    expect(n.map((x) => x.type)).toEqual(['text', 'text', 'text', 'link']);
    expect(n[0]).toMatchObject({ styles: { bold: true, italic: true } });
  });
});

describe('anything unmappable is kept verbatim', () => {
  it.each([
    '<div>x</div>',
    '<img src="a.png">',
    '<font color="red">x</font>',
    '<a href="u" onclick="x()">x</a>',
    '<b>text <div>inner</div></b>',
    '<span data-color="red"><span data-color="blue">x</span></span>',
    '<b><span class="nt-eq-inline" contenteditable="false" data-tex="a">a</span></b>',
    '<span class="nt-br-anchor" data-bid="b"><a href="u">x</a></span>',
  ])('%s -> raw', (html) => {
    expect(types(html)).toEqual(['raw']);
    expect(inlineToHtml(htmlToInline(html))).toBe(html);
  });
});

describe('re-serialisation', () => {
  it('escapes text and attributes', () => {
    const html = inlineToHtml(htmlToInline('a &amp; b &lt;i&gt; &nbsp;<a href="x&quot;y">l</a>'));
    expect(html).toBe('a &amp; b &lt;i&gt; &nbsp;<a href="x&quot;y">l</a>');
  });
  it('is stable on already-canonical html', () => {
    const html = '<b>a</b><span class="nt-br-anchor" data-bid="1"><u>b</u></span>c<br>';
    expect(inlineToHtml(htmlToInline(html))).toBe(html);
  });
});
