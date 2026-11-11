import { test, expect, type Page } from '@playwright/test';
import { openSettings } from './helpers';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseStoryChapters } from '../../src/changelog/parse';
import { FALLBACK_CHANGELOG_MD } from '../../src/changelog/fallback-changelog';

// Settings -> Product updates (it used to be a collapsed section of the Settings dialog).
// The Product story player and its sidebar entry are deliberately NOT part of /web/.
//
// Expected content is derived from the real CHANGELOG.md with the port's parser,
// which tests/changelog/parse-differential.test.ts proves equals the legacy one.
const realMd = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../CHANGELOG.md'), 'utf8');
const chapters = parseStoryChapters(realMd);

// A fixed three-chapter file, so paging does not depend on how long the repo's own changelog is.
const MULTI_MD = [
  '# Changelog', '',
  '## 2026-03-03', '- Summary: **Third.** Newest entry.', '- Summary: Fix a thing.', '',
  '## 2026-02-02', '- Summary: **Second.** Middle entry.', '',
  '## 2026-01-01', '- Summary: **First.** Oldest entry.', '',
].join('\n');
const multi = parseStoryChapters(MULTI_MD);
const serveMulti = (page: Page) => page.route('**/CHANGELOG.md', route => route.fulfill({ status: 200, contentType: 'text/markdown', body: MULTI_MD }));

const openUpdates = async (page: Page): Promise<void> => { await openSettings(page, 'Product updates'); };
const cards = (p: Page) => p.getByTestId('release-card');

test.describe('the page', () => {
  test('is not fetched until the tab opens, then lists every chapter newest first from CHANGELOG.md', async ({ page }) => {
    let requests = 0;
    await page.route('**/CHANGELOG.md', route => { requests++; return route.continue(); });
    await openSettings(page);
    expect(requests).toBe(0);
    await page.getByRole('tab', { name: /^Product updates/ }).click();
    await expect(cards(page)).toHaveCount(chapters.length);
    await expect(cards(page).first().getByTestId('release-date')).toHaveText(chapters[0]!.date);
    await expect(cards(page).first().getByTestId('release-summary')).toHaveText(chapters[0]!.narrative);
    await expect(cards(page).first()).toContainText('Latest');
    if (chapters.length > 1) await expect(cards(page).nth(1)).not.toContainText('Latest');
    await expect(page.getByTestId('changelog-source')).toContainText('Reads from CHANGELOG.md');
    expect(requests).toBe(1);
  });

  test('groups items under New / Improved / Fixed and hides empty groups', async ({ page }) => {
    await serveMulti(page);
    await openUpdates(page);
    await expect(cards(page)).toHaveCount(3);
    const first = cards(page).first();
    await expect(first.getByText('New', { exact: true })).toBeVisible();
    await expect(first.getByText('Fixed', { exact: true })).toBeVisible();
    await expect(first.getByText('Improved', { exact: true })).toHaveCount(0);
    await expect(first.getByTestId('release-item')).toHaveCount(multi[0]!.items.length);
    await expect(cards(page).nth(2).getByText('Fixed', { exact: true })).toHaveCount(0);
  });

  test('Refresh re-reads the file; leaving and returning does not refetch', async ({ page }) => {
    let requests = 0;
    await page.route('**/CHANGELOG.md', route => { requests++; return route.fulfill({ status: 200, contentType: 'text/markdown', body: MULTI_MD }); });
    await openUpdates(page);
    await expect(cards(page)).toHaveCount(3);
    await page.getByRole('tab', { name: /^General/ }).click();
    await page.getByRole('tab', { name: /^Product updates/ }).click();
    await expect(cards(page)).toHaveCount(3);
    expect(requests).toBe(1);
    await page.getByRole('button', { name: 'Reload changelog' }).click();
    await expect.poll(() => requests).toBe(2);
  });

  test('it is gone from General (no changelog section in the settings form any more)', async ({ page }) => {
    await openSettings(page);
    await expect(page.getByRole('button', { name: 'View changelog' })).toHaveCount(0);
  });
});

test.describe('fallback to the bundled copy (BUGS.md #007)', () => {
  for (const [name, handler] of [
    ['a 500', (r: import('@playwright/test').Route) => r.fulfill({ status: 500, body: 'boom' })],
    ['a 404', (r: import('@playwright/test').Route) => r.fulfill({ status: 404, body: 'nope' })],
    ['a blank body', (r: import('@playwright/test').Route) => r.fulfill({ status: 200, contentType: 'text/markdown', body: '   \n' })],
    ['a network failure', (r: import('@playwright/test').Route) => r.abort()],
  ] as const) {
    test(`shows the bundled copy, and says so, on ${name}`, async ({ page }) => {
      await page.route('**/CHANGELOG.md', handler);
      await openUpdates(page);
      await expect(cards(page).first().getByTestId('release-date')).toHaveText(parseStoryChapters(FALLBACK_CHANGELOG_MD)[0]!.date);
      await expect(page.getByTestId('changelog-source')).toContainText('bundled with the app');
    });
  }

  test('a file with no entries shows an empty state rather than nothing', async ({ page }) => {
    await page.route('**/CHANGELOG.md', r => r.fulfill({ status: 200, contentType: 'text/markdown', body: '# Changelog\n\nNothing yet.\n' }));
    await openUpdates(page);
    await expect(page.getByTestId('empty-state')).toContainText('No updates yet');
  });
});

test('the Product story is not part of /web/ for now', async ({ page }) => {
  await openSettings(page, 'Product updates');
  await expect(page.getByText('Product story')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Play the story/ })).toHaveCount(0);
});
