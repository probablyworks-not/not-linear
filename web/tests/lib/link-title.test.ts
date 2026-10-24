import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchLinkTitle } from '../../src/lib/link-title';

/** Stand in for the local server's /__notlinear_link_preview reply. */
function serverSays(body: unknown, ok = true): void {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok, json: () => Promise.resolve(body), status: ok ? 200 : 500 })));
}

afterEach(() => vi.unstubAllGlobals());

describe('fetchLinkTitle', () => {
  it('returns the article name with the site suffix trimmed off', async () => {
    serverSays({ ok: true, title: 'The internet is having a very bad cybersecurity day | TechCrunch' });
    expect(await fetchLinkTitle('https://techcrunch.com/a')).toBe('The internet is having a very bad cybersecurity day');
  });

  it('keeps a hyphenated title that is not the site name', async () => {
    serverSays({ ok: true, title: 'Rust 1.90 - release notes' });
    expect(await fetchLinkTitle('https://blog.rust-lang.org/b')).toBe('Rust 1.90 | release notes');
  });

  it('caps a very long title', async () => {
    serverSays({ ok: true, title: 'x'.repeat(200) });
    expect(await fetchLinkTitle('https://example.com/long')).toMatch(/^x{89}…$/);
  });

  it('is null when the title says no more than the site name', async () => {
    serverSays({ ok: true, title: 'example.com' });
    expect(await fetchLinkTitle('https://example.com/same')).toBeNull();
  });

  it('is null when the preview fails, and never throws', async () => {
    serverSays({ ok: false }, false);
    expect(await fetchLinkTitle('https://example.com/down')).toBeNull();
  });

  it('asks the server once per URL', async () => {
    serverSays({ ok: true, title: 'Cached piece | Example' });
    await fetchLinkTitle('https://example.com/cached');
    await fetchLinkTitle('https://example.com/cached');
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(1);
  });
});
