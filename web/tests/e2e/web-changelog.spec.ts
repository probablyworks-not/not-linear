import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseStoryChapters } from '../../src/changelog/parse';
import { FALLBACK_CHANGELOG_MD } from '../../src/changelog/fallback-changelog';

// P4 item 3: the changelog viewer in /web/ Settings. The Product story player
// and its sidebar entry are deliberately NOT ported (maintainer's call), and a
// test below keeps that explicit.
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

async function openWeb(page: Page): Promise<void> {
  await page.goto('/web/');
  await expect(page.getByRole('button', { name: 'Open left pane' })).toBeVisible();
}
async function openChangelog(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Open left pane' }).click();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'View changelog' }).click();
  await expect(page.getByTestId('changelog-source')).not.toHaveText('Loading');
}
const date = (p: Page) => p.getByTestId('chapter-date');
const narrative = (p: Page) => p.getByTestId('chapter-narrative');
const older = (p: Page) => p.getByRole('button', { name: 'Older' });
const newer = (p: Page) => p.getByRole('button', { name: 'Newer' });

test.describe('the viewer', () => {
  test('is collapsed and fetches nothing until expanded, then shows the newest chapter from CHANGELOG.md', async ({ page }) => {
    let requests = 0;
    await page.route('**/CHANGELOG.md', route => { requests++; return route.continue(); });
    await openWeb(page);
    await page.getByRole('button', { name: 'Open left pane' }).click();
    await page.getByRole('button', { name: 'Open settings' }).click();
    await expect(page.getByRole('button', { name: 'View changelog' })).toHaveAttribute('aria-expanded', 'false');
    expect(requests).toBe(0);

    await page.getByRole('button', { name: 'View changelog' }).click();
    await expect(page.getByTestId('changelog-source')).toHaveText('CHANGELOG.md');
    await expect(date(page)).toHaveText(chapters[0]!.date);
    await expect(narrative(page)).toHaveText(chapters[0]!.narrative);
    await expect(page.getByTestId('chapter-item')).toHaveCount(chapters[0]!.items.length);
    expect(requests).toBe(1);
    await expect(page.getByText('Reads from')).toContainText('CHANGELOG.md');
  });

  test('Older and Newer page through every chapter and disable at the ends', async ({ page }) => {
    await serveMulti(page);
    await openWeb(page);
    await openChangelog(page);
    await expect(newer(page)).toBeDisabled();
    await expect(older(page)).toBeEnabled();
    expect(multi.length).toBeGreaterThan(2);
    await older(page).click();
    await expect(date(page)).toHaveText(multi[1]!.date);
    await expect(narrative(page)).toHaveText(multi[1]!.narrative);
    for (let i = 2; i < multi.length; i++) await older(page).click();
    await expect(date(page)).toHaveText(multi.at(-1)!.date);
    await expect(older(page)).toBeDisabled();
    await expect(newer(page)).toBeEnabled();
    await newer(page).click();
    await expect(date(page)).toHaveText(multi.at(-2)!.date);
  });

  test('refresh re-reads the file and returns to the newest chapter', async ({ page }) => {
    let requests = 0;
    await page.route('**/CHANGELOG.md', route => { requests++; return route.fulfill({ status: 200, contentType: 'text/markdown', body: MULTI_MD }); });
    await openWeb(page);
    await openChangelog(page);
    await older(page).click();
    await page.getByRole('button', { name: 'Reload changelog' }).click();
    await expect.poll(() => requests).toBe(2);
    await expect(date(page)).toHaveText(multi[0]!.date);
  });

  test('reopening does not refetch (legacy loads once per page)', async ({ page }) => {
    let requests = 0;
    await page.route('**/CHANGELOG.md', route => { requests++; return route.continue(); });
    await openWeb(page);
    await openChangelog(page);
    await page.getByRole('button', { name: 'View changelog' }).click();
    await page.getByRole('button', { name: 'View changelog' }).click();
    await expect(date(page)).toBeVisible();
    expect(requests).toBe(1);
  });
});

test.describe('fallback to the bundled copy (BUGS.md #007)', () => {
  for (const [name, handler] of [
    ['a 500', (r: import('@playwright/test').Route) => r.fulfill({ status: 500, body: 'boom' })],
    ['a 404', (r: import('@playwright/test').Route) => r.fulfill({ status: 404, body: 'nope' })],
    ['a blank body', (r: import('@playwright/test').Route) => r.fulfill({ status: 200, contentType: 'text/markdown', body: '   \n' })],
    ['a network failure', (r: import('@playwright/test').Route) => r.abort()],
  ] as const) {
    test(`shows the bundled copy on ${name}`, async ({ page }) => {
      await page.route('**/CHANGELOG.md', handler);
      await openWeb(page);
      await openChangelog(page);
      await expect(page.getByTestId('changelog-source')).toHaveText('Bundled copy');
      await expect(date(page)).toHaveText(parseStoryChapters(FALLBACK_CHANGELOG_MD)[0]!.date);
    });
  }

  test('a file with no entries says so rather than showing nothing', async ({ page }) => {
    await page.route('**/CHANGELOG.md', r => r.fulfill({ status: 200, contentType: 'text/markdown', body: '# Changelog\n\nNothing yet.\n' }));
    await openWeb(page);
    await openChangelog(page);
    await expect(page.getByText('No changelog entries found.')).toBeVisible();
  });
});

test.describe('parity with the legacy viewer', () => {
});

test('the Product story is not part of /web/ for now', async ({ page }) => {
  await openWeb(page);
  await page.getByRole('button', { name: 'Open left pane' }).click();
  await expect(page.getByText('Product story')).toHaveCount(0);
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'View changelog' }).click();
  await expect(page.getByRole('button', { name: /Play the story/ })).toHaveCount(0);
});
