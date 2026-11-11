import { fenceRawHtml, renderMarkdown } from '../../src/lib/markdown';

// The failure this fixes: a model asked for "an HTML file" answered with the document itself and
// no fence, so every tag was escaped into prose and there was nothing to download.

const PAGE = [
  '<article style="max-width: 760px; margin: 0 auto;">',
  '  <h1>Should we just use MCP?</h1>',
  '  <p><strong>Short answer: No.</strong> Build the flow canvas first.</p>',
  '</article>',
].join('\n');

describe('fenceRawHtml', () => {
  it('fences a raw document and leaves the markup byte for byte', () => {
    const out = fenceRawHtml(PAGE);
    expect(out).toBe('```html\n' + PAGE + '\n```');
  });

  it('keeps a prose preamble outside the fence', () => {
    const out = fenceRawHtml(`Here is the page.\n\n${PAGE}`);
    expect(out).toBe(`Here is the page.\n\n\`\`\`html\n${PAGE}\n\`\`\``);
  });

  it('fences a bare <!doctype html> document and a standalone <svg>', () => {
    expect(fenceRawHtml('<!DOCTYPE html>\n<html><head><title>T</title></head><body><p>hi</p></body></html>')).toContain('```html\n<!DOCTYPE html>');
    expect(fenceRawHtml('<svg viewBox="0 0 2 2"><title>T</title><g><circle r="1" /></g></svg>')).toContain('```svg\n<svg');
  });

  it('leaves prose, a stray tag, and already-fenced text alone', () => {
    expect(fenceRawHtml('Use <strong>React Flow</strong> for the editor.')).toBe('Use <strong>React Flow</strong> for the editor.');
    expect(fenceRawHtml('```html\n<p>x</p>\n```')).toBe('```html\n<p>x</p>\n```');
    expect(fenceRawHtml('<div>only one tag here</div>')).toBe('<div>only one tag here</div>');
  });

  it('wants a closing tag at the end before trusting a weak opener like <div>', () => {
    const open = '<div class="a">\n<div class="b">\n<span>one</span>\n<span>two</span>\nand then prose runs on';
    expect(fenceRawHtml(open)).toBe(open);
  });
});

describe('renderMarkdown with a raw HTML reply', () => {
  it('renders it as an html code block, not as escaped paragraphs', () => {
    const html = renderMarkdown(PAGE);
    expect(html).toContain('<div class="code-block">');
    expect(html).toContain('class="lang-html"');
    expect(html).not.toContain('<p>&lt;article');
  });

  it('never applies the prose block-break fix-ups to code inside a fence', () => {
    // "No.Build" would be split by the sentence-break regex; inside a fence it must survive.
    const html = renderMarkdown('```html\n<p>Short answer: No.Build the canvas.</p>\n```');
    expect(html).toContain('No.Build the canvas.');
  });
});
