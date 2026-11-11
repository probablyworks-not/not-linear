import { describe, expect, it } from 'vitest';
import { articleName, labelIsUrl, linkDisplayText, linkLabel } from '../../src/lib/link-text';
import { renderMarkdown } from '../../src/lib/markdown';

describe('linkLabel', () => {
  it('shows the site, not the address', () => {
    expect(linkLabel('https://techcrunch.com/2026/10/21/a-very-long-slug/')).toBe('techcrunch.com');
    expect(linkLabel('https://www.nytimes.com/x?y=1')).toBe('nytimes.com');
    expect(linkLabel('http://localhost:8765/frontend/index.html')).toBe('localhost');
  });

  it('leaves text it cannot parse alone', () => {
    expect(linkLabel('not a url')).toBe('not a url');
  });

  it('spots a label that is just the URL again', () => {
    expect(labelIsUrl('https://x.com/a', 'https://x.com/a')).toBe(true);
    expect(labelIsUrl('https://x.com/a', 'https://x.com/a/')).toBe(true);
    expect(labelIsUrl('', 'https://x.com/a')).toBe(true);
    expect(labelIsUrl('The post', 'https://x.com/a')).toBe(false);
  });
});

describe('articleName', () => {
  it('reads the article out of the slug', () => {
    expect(articleName('https://techcrunch.com/2026/10/21/the-internet-is-having-a-very-bad-cybersecurity-day/'))
      .toBe('The internet is having a very bad cybersecurity day');
  });

  it('steps over dates and ids to the words', () => {
    expect(articleName('https://example.com/blog/2026/a-tale-of-two-caches/9f8e7d6c5b4a')).toBe('A tale of two caches');
  });

  it('is null when the path says less than the site does', () => {
    expect(articleName('https://stripe.com/pricing')).toBeNull();
    expect(articleName('https://example.com/')).toBeNull();
    expect(articleName('https://example.com/p/12345')).toBeNull();
    expect(articleName('not a url')).toBeNull();
  });

  it('decodes escapes, drops the file extension and caps the length', () => {
    expect(articleName('https://example.com/a%20very-long-read.html')).toBe('A very long read');
    expect(articleName(`https://example.com/${'word-'.repeat(40)}end`)).toMatch(/…$/);
  });

  it('linkDisplayText falls back to the site when there is no article', () => {
    expect(linkDisplayText('https://stripe.com/pricing')).toBe('stripe.com');
    expect(linkDisplayText('https://techcrunch.com/2026/10/21/a-very-bad-day-indeed/')).toBe('A very bad day indeed');
  });
});

describe('renderMarkdown links', () => {
  it('auto-links a bare URL as its article name, keeping the address in href and title', () => {
    const html = renderMarkdown('See https://techcrunch.com/2026/10/21/bad-day/ for more.');
    expect(html).toContain('href="https://techcrunch.com/2026/10/21/bad-day/"');
    expect(html).toContain('title="https://techcrunch.com/2026/10/21/bad-day/"');
    expect(html).toContain('>techcrunch.com</a>');
  });

  it('keeps trailing punctuation outside the link', () => {
    expect(renderMarkdown('Read https://example.com/x?y=1, then stop.')).toContain('>example.com</a>,');
  });

  it('links a URL sitting on its own line (the scheme colon is not a label)', () => {
    expect(renderMarkdown('https://techcrunch.com/2026/10/21/bad-day/')).toContain('>techcrunch.com</a>');
  });

  it('keeps a real markdown label and shortens one that is just the URL', () => {
    expect(renderMarkdown('[The post](https://example.org/a_b)')).toContain('>The post</a>');
    expect(renderMarkdown('[https://example.org/a](https://example.org/a)')).toContain('>example.org</a>');
  });
});
