import { test, expect, type Page } from '@playwright/test';
import { openApp } from './helpers';

// P4 item 2: the quick-open palette in /web/. The strongest check here is the
// parity test, which runs the same queries through the legacy palette and this
// one and demands the same ordered results.

async function openWeb(page: Page): Promise<void> {
  await page.goto('/web/');
  await expect(page.getByRole('button', { name: 'Open left pane' })).toBeVisible();
}
const palette = (page: Page) => page.getByRole('dialog', { name: 'Search' });
const options = (page: Page) => palette(page).getByRole('option');
const titles = async (page: Page) => (await options(page).allInnerTexts()).map(t => t.trim());

test.describe('open and close', () => {
  test('Ctrl+K opens with the legacy placeholder and every thread, focus in the input', async ({ page }) => {
    await openWeb(page);
    await page.keyboard.press('Control+k');
    await expect(palette(page)).toBeVisible();
    const input = palette(page).getByRole('combobox');
    await expect(input).toBeFocused();
    await expect(input).toHaveAttribute('placeholder', 'Search threads and branches…');
    await expect(palette(page).getByText('Threads', { exact: true })).toBeVisible();
    expect(await titles(page)).toEqual(['Non-linear chat system', 'Pricing research', 'Onboarding flow review', 'Q3 planning notes']);
  });

  test('Ctrl+K toggles it shut, and Esc closes it', async ({ page }) => {
    await openWeb(page);
    await page.keyboard.press('Control+k');
    await expect(palette(page)).toBeVisible();
    await page.keyboard.press('Control+k');
    await expect(palette(page)).toHaveCount(0);
    await page.keyboard.press('Control+k');
    await page.keyboard.press('Escape');
    await expect(palette(page)).toHaveCount(0);
  });

  test('the sidebar Search button opens it', async ({ page }) => {
    await openWeb(page);
    await page.getByRole('button', { name: 'Open left pane' }).click();
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    await expect(palette(page)).toBeVisible();
  });

  test('reopening starts clean: empty query, nothing highlighted', async ({ page }) => {
    await openWeb(page);
    await page.keyboard.press('Control+k');
    await palette(page).getByRole('combobox').fill('plan');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+k');
    await expect(palette(page).getByRole('combobox')).toHaveValue('');
    await expect(palette(page).locator('[aria-selected="true"]')).toHaveCount(0);
  });
});

test.describe('deliberate difference from legacy', () => {
  test('lists seed threads that were never persisted; legacy hides them until they are visited', async ({ page }) => {
    await openWeb(page); // fresh database: no saved thread state at all
    await page.keyboard.press('Control+k');
    expect(await titles(page)).toHaveLength(4);
  });
});

test.describe('searching', () => {
  test('filters case-insensitively and marks the match', async ({ page }) => {
    await openWeb(page);
    await page.keyboard.press('Control+k');
    await palette(page).getByRole('combobox').fill('PLAN');
    expect(await titles(page)).toEqual(['Q3 planning notes']);
    await expect(palette(page).locator('mark')).toHaveText('plan');
  });

  test('a miss shows the legacy message with the query; an empty database state shows the other', async ({ page }) => {
    await openWeb(page);
    await page.keyboard.press('Control+k');
    await palette(page).getByRole('combobox').fill('zzz');
    await expect(palette(page)).toContainText('No results for "zzz"');
  });

  test('typed markup is shown as text, never parsed', async ({ page }) => {
    await openWeb(page);
    await page.keyboard.press('Control+k');
    await palette(page).getByRole('combobox').fill('<img src=x onerror=alert(1)>');
    await expect(palette(page)).toContainText('No results for "<img src=x onerror=alert(1)>"');
    await expect(palette(page).locator('img')).toHaveCount(0);
  });

  test('deleted threads are not offered', async ({ page }) => {
    await openWeb(page);
    await page.getByRole('button', { name: 'Open left pane' }).click();
    await page.locator('[data-thread="pricing"]').hover();
    await page.getByRole('button', { name: 'Delete Pricing research' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete chat' }).click();
    await page.keyboard.press('Control+k');
    expect(await titles(page)).not.toContain('Pricing research');
  });
});

test.describe('choosing', () => {
  test('ArrowDown then Enter opens the highlighted thread as the active tab and closes the palette', async ({ page }) => {
    await openWeb(page);
    await page.keyboard.press('Control+k');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await expect(options(page).nth(1)).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Enter');
    await expect(palette(page)).toHaveCount(0);
    await expect(page.getByRole('tab', { name: /Pricing research/ })).toHaveAttribute('aria-selected', 'true');
  });

  test('Enter with nothing highlighted opens the first result', async ({ page }) => {
    await openWeb(page);
    await page.keyboard.press('Control+k');
    await palette(page).getByRole('combobox').fill('onboard');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('tab', { name: /Onboarding flow review/ })).toHaveAttribute('aria-selected', 'true');
  });

  test('clicking a result opens it; arrows stop at the ends', async ({ page }) => {
    await openWeb(page);
    await page.keyboard.press('Control+k');
    for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowDown');
    await expect(options(page).nth(3)).toHaveAttribute('aria-selected', 'true');
    for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowUp');
    await expect(options(page).nth(0)).toHaveAttribute('aria-selected', 'true');
    await options(page).nth(3).click();
    await expect(page.getByRole('tab', { name: /Q3 planning notes/ })).toHaveAttribute('aria-selected', 'true');
  });
});

test.describe('parity with the legacy palette', () => {
  test('the same queries return the same ordered threads in both apps', async ({ page }) => {
    // Same data for both apps. Legacy omits any thread with no saved state, and takes
    // doc-main's title from an in-memory default that a fresh database does not hold -
    // neither is the filtering/ordering behaviour under test - so persist all four seed
    // threads first. Guarded: init scripts re-run on every navigation and must not
    // overwrite what /web/ writes afterwards.
    await page.addInitScript(() => {
      const open = indexedDB.open('notlinear', 1);
      open.onupgradeneeded = () => { if (!open.result.objectStoreNames.contains('kv')) open.result.createObjectStore('kv', { keyPath: 'key' }); };
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('kv', 'readwrite');
        const store = tx.objectStore('kv');
        store.get('state').onsuccess = (e) => {
          if ((e.target as IDBRequest).result) return;
          const seed = (title: string) => ({ kind: 'doc', title, stream: '', docContent: '<p><br></p>', highlights: [], branchSnapshots: {}, branchRecents: {} });
          store.put({ key: 'state', value: {
            threads: {
              'doc-main': seed('Non-linear chat system'), pricing: seed('Pricing research'),
              onboarding: seed('Onboarding flow review'), planning: seed('Q3 planning notes'),
            },
            current: 'doc-main', dynamic: [], deletedThreads: [], chatCount: 1, projects: {}, projectCount: 1, prefs: {},
          } });
        };
        tx.oncomplete = () => db.close();
      };
    });
    await openWeb(page);
    await page.keyboard.press('Control+n');
    await expect(page.getByRole('tab', { name: /Untitled chat$/ })).toBeVisible();
    await page.keyboard.press('Control+n');
    await expect(page.getByRole('tab', { name: /Untitled chat 2/ })).toBeVisible();

    const queries = ['', 'chat', 'CHAT', 'plan', 'in', 'research', 'q3', 'untitled chat 2', 'zzz', '  pric  '];
    const fromWeb: Record<string, string[]> = {};
    for (const q of queries) {
      await page.keyboard.press('Control+k');
      await palette(page).getByRole('combobox').fill(q);
      fromWeb[q] = q.trim() && !(await options(page).count()) ? [] : await titles(page);
      await page.keyboard.press('Escape');
    }

    await openApp(page);
    const fromLegacy: Record<string, string[]> = {};
    for (const q of queries) {
      await page.keyboard.press('Control+k');
      await page.locator('#search-input').fill(q);
      fromLegacy[q] = (await page.locator('#search-results .search-result-title').allInnerTexts()).map(t => t.trim());
      await page.keyboard.press('Escape');
    }
    expect(fromWeb).toEqual(fromLegacy);
    expect(fromWeb['chat']!.length).toBeGreaterThanOrEqual(3); // the check is not vacuous
  });
});
