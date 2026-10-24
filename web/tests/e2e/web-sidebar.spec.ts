import { test, expect, type Page } from '@playwright/test';

// Sidebar sections fold from their headers, and which are folded is shared with the legacy app
// through localStorage.nl_side_collapsed_v1.

async function openWeb(page: Page): Promise<void> {
  await page.goto('/web/');
  await page.getByRole('button', { name: 'Open left pane' }).click();
}
const side = (page: Page) => page.locator('aside[aria-label="Left pane"]');
const header = (page: Page, section: string) => side(page).locator(`button[data-section="${section}"]`);

test('a section folds and unfolds from its header, and the choice survives a reload', async ({ page }) => {
  await openWeb(page);
  await expect(side(page).locator('[data-thread]').first()).toBeVisible();
  await expect(header(page, 'threads')).toHaveAttribute('aria-expanded', 'true');
  await header(page, 'threads').click();
  await expect(header(page, 'threads')).toHaveAttribute('aria-expanded', 'false');
  await expect(side(page).locator('[data-thread]').first()).toBeHidden();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('nl_side_collapsed_v1') || '{}'))).toEqual({ threads: true });

  await page.reload();
  await page.getByRole('button', { name: 'Open left pane' }).click();
  await expect(header(page, 'threads')).toHaveAttribute('aria-expanded', 'false');
  await expect(side(page).locator('[data-thread]').first()).toBeHidden();
  await header(page, 'threads').click();
  await expect(side(page).locator('[data-thread]').first()).toBeVisible();
});

test('Projects and Recent branches fold too, independently, and the header buttons do not fold the section', async ({ page }) => {
  await openWeb(page);
  await side(page).getByRole('button', { name: 'View all projects' }).click();
  await page.keyboard.press('Escape');
  await expect(header(page, 'projects')).toHaveAttribute('aria-expanded', 'true');
  await header(page, 'recent').click();
  await expect(side(page).getByTestId('recent-branches')).toBeHidden();
  await expect(side(page).locator('[data-thread]').first()).toBeVisible(); // threads unaffected
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('nl_side_collapsed_v1') || '{}'))).toEqual({ recent: true });
});

test('a thread glyph: legacy icon tokens render as icons, the picker saves one, and it survives a reload', async ({ page }) => {
  await page.addInitScript(() => {
    const open = indexedDB.open('notlinear', 1);
    open.onupgradeneeded = () => { if (!open.result.objectStoreNames.contains('kv')) open.result.createObjectStore('kv', { keyPath: 'key' }); };
    open.onsuccess = () => {
      const tx = open.result.transaction('kv', 'readwrite');
      const store = tx.objectStore('kv');
      store.get('state').onsuccess = (e) => {
        if ((e.target as IDBRequest).result) return;
        store.put({ key: 'state', value: {
          threads: { 'chat-1': { kind: 'chat', title: 'Iconic', stream: '', emoji: 'icon:book:c0392b' } },
          current: 'chat-1', dynamic: [{ id: 'chat-1', title: 'Iconic' }], deletedThreads: [], chatCount: 2, projects: {}, projectCount: 1, prefs: {},
        } });
      };
      tx.oncomplete = () => open.result.close();
    };
  });
  await openWeb(page);
  const row = side(page).locator('[data-thread="chat-1"]');
  await expect(row).toBeVisible();
  await expect(row).not.toContainText('icon:'); // a token is never shown as text
  await expect(row.getByTestId('glyph-button').locator('svg')).toBeVisible();

  await expect(page.getByRole('tab', { name: /Iconic/ }).locator('svg.mg-icon')).toBeVisible(); // the tab shows it too

  await row.getByTestId('glyph-button').click();
  const opt = page.locator('.mg-opt').first();
  await expect(opt).toBeVisible();
  const id = await opt.getAttribute('data-icon');
  await opt.click();
  await expect(page.locator('.mg-opt')).toHaveCount(0);
  await expect.poll(async () => page.evaluate(() => new Promise<string | undefined>(res => {
    const r = indexedDB.open('notlinear');
    r.onsuccess = () => { const g = r.result.transaction('kv').objectStore('kv').get('state'); g.onsuccess = () => res(g.result?.value?.threads?.['chat-1']?.emoji); };
  }))).toMatch(new RegExp(`^icon:${id}`));

  await page.reload();
  await page.getByRole('button', { name: 'Open left pane' }).click();
  await expect(side(page).locator('[data-thread="chat-1"]').getByTestId('glyph-button').locator('svg')).toBeVisible();
});
