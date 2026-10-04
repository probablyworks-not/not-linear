import { FALLBACK_CHANGELOG_MD } from './fallback-changelog';

// app.js:4437 loadChangelog. Read /CHANGELOG.md; if the request fails, is not
// OK, or returns only whitespace, use the bundled copy instead (BUGS.md #007).
// Never throws: the viewer must always have something to show.
export type ChangelogSource = 'CHANGELOG.md' | 'Bundled copy';
export interface LoadedChangelog { text: string; source: ChangelogSource }

export async function loadChangelogText(fetchFn: typeof fetch = fetch): Promise<LoadedChangelog> {
  try {
    const res = await fetchFn('/CHANGELOG.md', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const fetched = await res.text();
    if (fetched.trim()) return { text: fetched, source: 'CHANGELOG.md' };
  } catch {
    /* fall through to the bundled copy */
  }
  return { text: FALLBACK_CHANGELOG_MD, source: 'Bundled copy' };
}
