import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openApp, openSidebar } from './helpers';
import { parseStoryChapters } from '../../src/changelog/parse';

// P4 item 3: the changelog viewer in /web/ Settings. The Product story player
// and its sidebar entry are deliberately NOT ported (maintainer's call), and a
// test below keeps that explicit.
//
// Expected content is derived from the real CHANGELOG.md with the port's parser,
// which tests/changelog/parse-differential.test.ts proves equals the legacy one.
const realMd = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../../CHANGELOG.md'), 'utf8');
const chapters = parseStoryChapters(realMd);

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
    await openWeb(page);
    await openChangelog(page);
    await expect(newer(page)).toBeDisabled();
    await expect(older(page)).toBeEnabled();
    expect(chapters.length).toBeGreaterThan(2);
    await older(page).click();
    await expect(date(page)).toHaveText(chapters[1]!.date);
    await expect(narrative(page)).toHaveText(chapters[1]!.narrative);
    for (let i = 2; i < chapters.length; i++) await older(page).click();
    await expect(date(page)).toHaveText(chapters.at(-1)!.date);
    await expect(older(page)).toBeDisabled();
    await expect(newer(page)).toBeEnabled();
    await newer(page).click();
    await expect(date(page)).toHaveText(chapters.at(-2)!.date);
  });

  test('refresh re-reads the file and returns to the newest chapter', async ({ page }) => {
    let requests = 0;
    await page.route('**/CHANGELOG.md', route => { requests++; return route.continue(); });
    await openWeb(page);
    await openChangelog(page);
    await older(page).click();
    await page.getByRole('button', { name: 'Reload changelog' }).click();
    await expect.poll(() => requests).toBe(2);
    await expect(date(page)).toHaveText(chapters[0]!.date);
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
      await expect(date(page)).toHaveText('2026-05-07');
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
  test('the same chapter, narrative, items and tags in both apps', async ({ page }) => {
    await openApp(page);
    await openSidebar(page);
    await page.locator('#open-prefs').click();
    await page.locator('#changelog-toggle').click();
    await expect(page.locator('#changelog-source')).toHaveText('CHANGELOG.md');
    const legacy = {
      date: (await page.locator('.story-card .story-date').innerText()).trim(),
      narrative: (await page.locator('.story-card .story-narrative').innerText()).trim(),
      items: (await page.locator('.story-card .story-item').evaluateAll(els =>
        els.map(e => ({ text: e.querySelector('.story-item-text')!.textContent!.trim(), tag: e.querySelector('.story-item-tag')!.textContent!.trim() })))),
      dots: await page.locator('.story-dot').count(),
    };

    await openWeb(page);
    await openChangelog(page);
    const web = {
      date: (await date(page).innerText()).trim(),
      narrative: (await narrative(page).innerText()).trim(),
      items: await page.getByTestId('chapter-item').evaluateAll(els => els.map(e => {
        const spans = e.querySelectorAll(':scope > span');
        return { text: spans[1]!.textContent!.trim(), tag: spans[2]!.textContent!.trim() };
      })),
      dots: await page.locator('#changelog-view [data-on]').count(),
    };
    expect(web).toEqual(legacy);
    expect(web.items.length).toBeGreaterThan(0);
    expect(web.dots).toBeGreaterThan(3);
  });
});

test('the Product story is not part of /web/ for now', async ({ page }) => {
  await openWeb(page);
  await page.getByRole('button', { name: 'Open left pane' }).click();
  await expect(page.getByText('Product story')).toHaveCount(0);
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'View changelog' }).click();
  await expect(page.getByRole('button', { name: /Play the story/ })).toHaveCount(0);
});
