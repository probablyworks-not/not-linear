import { renderMarkdown as legacyRender, friendlyError as legacyFriendly, isConfigError as legacyConfig, hasMarkdownTable as legacyTable } from '../../../frontend/core/markdown.js';
import { renderMarkdown, friendlyError, isConfigError, hasMarkdownTable } from '../../src/lib/markdown';

// ADR-038: React dual-writes rendered HTML that legacy re-reads, so the two
// renderers must agree character for character. Legacy is the oracle.

const CORPUS = [
  '',
  'plain paragraph',
  '# Heading\n\nbody with **bold**, *italic*, `code` and ***both***.',
  '- one\n- two\n\n1. first\n2. second',
  '| a | b |\n|---|:-:|\n| 1 | 2 |\n| 3 | 4 | 5 |',
  '```js\nconst x = "<b>";\n```',
  '```mermaid\ngraph TD; A-->B\n```',
  '```mermaid\ngraph TD; A-->B',
  'See https://example.com/x?y=1, and [a link](https://example.org/a_b).',
  'Model: Foo\nFunding: $1M\nStatus: live',
  '1. Acme\nModel: Marketplace\n2. Beta\nFocus: Cleaning',
  'Intro sentence.Next sentence without a break.## Glued heading',
  '<script>alert(1)</script> & "quotes" \'single\'',
  '---\n\ntext\n\n***',
  '* a\n+ b\n-',
];

describe('lib/markdown matches core/markdown.js', () => {
  it.each(CORPUS.map((c, i) => [i, c] as const))('renderMarkdown corpus #%i', (_i, text) => {
    expect(renderMarkdown(text)).toBe(legacyRender(text));
  });

  it('hasMarkdownTable agrees', () => {
    for (const c of CORPUS) expect(hasMarkdownTable(c)).toBe(legacyTable(c));
  });

  it('friendlyError and isConfigError agree on every provider message', () => {
    const msgs = [
      'No API key — add your Anthropic key in Settings (⚙).',
      'No DeepSeek API key — add it in Settings (⚙).',
      'Invalid API key — check it in Settings.',
      'Claude rate limit hit — wait a moment, switch models, or reduce concurrent chats.',
      'DeepSeek rate limit hit — wait a moment, switch models, or reduce concurrent chats.',
      'Out of credits — top up at console.anthropic.com.',
      'Claude is overloaded right now — try again in a moment.',
      'Claude stream stopped sending data. Try again with a narrower query.',
      'Network error — check your connection.',
      'Stream interrupted — partial response preserved.',
      'something else entirely',
    ];
    for (const m of msgs) {
      expect(friendlyError(m)).toBe(legacyFriendly(m));
      expect(isConfigError(m)).toBe(legacyConfig(m));
    }
  });

  it('escapes script tags rather than emitting them', () => {
    expect(renderMarkdown('<script>alert(1)</script>')).not.toContain('<script>');
  });
});
