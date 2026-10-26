import { describe, expect, it } from 'vitest';
import { extractHtmlDoc, wantsHtmlReply } from '../../src/canvas/exec/html-trigger';

// Opt-in only: a plain phrase match, never inferred from question complexity. These cases are the
// contract for that boundary — loosen or tighten the regex against this list, not by feel.

describe('wantsHtmlReply', () => {
  it('matches explicit HTML requests', () => {
    expect(wantsHtmlReply('generate this as an html report')).toBe(true);
    expect(wantsHtmlReply('show it in html with a table')).toBe(true);
    expect(wantsHtmlReply('can you render this as HTML?')).toBe(true);
    expect(wantsHtmlReply('give me an html version')).toBe(true);
  });

  it('does not match an ordinary question', () => {
    expect(wantsHtmlReply('what does this mean?')).toBe(false);
    expect(wantsHtmlReply('summarize the last three messages')).toBe(false);
    expect(wantsHtmlReply('is this related to HTML5 or XML parsing')).toBe(false);
  });
});

describe('extractHtmlDoc', () => {
  it('returns the raw text unchanged when there is no fence', () => {
    expect(extractHtmlDoc('<!doctype html><html></html>')).toBe('<!doctype html><html></html>');
  });

  it('strips a ```html fence if the model adds one anyway', () => {
    const fenced = '```html\n<!doctype html><html><body>hi</body></html>\n```';
    expect(extractHtmlDoc(fenced)).toBe('<!doctype html><html><body>hi</body></html>');
  });
});
