import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderMarkdown } from '../../src/lib/markdown';
import { nameLinksIn } from '../../src/lib/name-links';

function serverSays(title: string | null): void {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(title === null ? { ok: false } : { ok: true, title }) })));
}

/** In the document, because nameLinksIn skips a node React has since detached. */
function render(md: string): HTMLDivElement {
  const el = document.createElement('div');
  el.innerHTML = renderMarkdown(md);
  document.body.appendChild(el);
  return el;
}

afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ''; });

describe('nameLinksIn', () => {
  it('renames a link we named ourselves to the page title', async () => {
    serverSays('The internet is having a very bad cybersecurity day | TechCrunch');
    const el = render('https://techcrunch.com/2026/10/21/one/');
    await nameLinksIn(el);
    expect(el.querySelector('a')?.textContent).toBe('The internet is having a very bad cybersecurity day');
  });

  it('leaves the site name in place when the page has no usable title', async () => {
    serverSays(null);
    const el = render('https://techcrunch.com/2026/10/21/two/');
    await nameLinksIn(el);
    expect(el.querySelector('a')?.textContent).toBe('techcrunch.com');
  });

  it('never touches a link the author labelled', async () => {
    serverSays('Some other title');
    const el = render('[my own words](https://techcrunch.com/2026/10/21/three/)');
    await nameLinksIn(el);
    expect(el.querySelector('a')?.textContent).toBe('my own words');
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
  });

  it('asks once per link even when the view re-renders', async () => {
    serverSays('Fourth piece | TechCrunch');
    const el = render('https://techcrunch.com/2026/10/21/four/');
    await nameLinksIn(el);
    await nameLinksIn(el);
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(1);
  });
});
