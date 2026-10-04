import { loadChangelogText } from '../../src/changelog/load';
import { FALLBACK_CHANGELOG_MD } from '../../src/changelog/fallback-changelog';

const res = (body: string, status = 200) => Promise.resolve(new Response(body, { status }));
const asFetch = (f: (...a: Parameters<typeof fetch>) => Promise<Response>) => f as typeof fetch;

describe('loadChangelogText (BUGS.md #007)', () => {
  it('uses the served file when it is there', async () => {
    const calls: unknown[][] = [];
    const out = await loadChangelogText(asFetch((...a) => { calls.push(a); return res('## d\n- Summary: hi'); }));
    expect(out).toEqual({ text: '## d\n- Summary: hi', source: 'CHANGELOG.md' });
    expect(calls[0]).toEqual(['/CHANGELOG.md', { cache: 'no-store' }]);
  });
  it.each([
    ['a non-OK status', () => res('nope', 404)],
    ['a server error', () => res('boom', 500)],
    ['a blank body', () => res('  \n ')],
    ['a network failure', () => Promise.reject(new TypeError('Failed to fetch'))],
  ])('falls back to the bundled copy on %s', async (_n, f) => {
    expect(await loadChangelogText(asFetch(f))).toEqual({ text: FALLBACK_CHANGELOG_MD, source: 'Bundled copy' });
  });
  it('never throws', async () => {
    await expect(loadChangelogText(asFetch(() => { throw new Error('sync throw'); }))).resolves.toMatchObject({ source: 'Bundled copy' });
  });
});
