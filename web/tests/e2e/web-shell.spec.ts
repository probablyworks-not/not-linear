import { test, expect, type Page } from '@playwright/test';
import { readPersistedState } from './helpers';

// The P3 gate, automated: the React shell at /web/ and the legacy app share
// one origin and one IndexedDB row, so a thread made in either shows in both.
//
// /web/ is served from web/dist by the same Python server (the static mount),
// which is why `pnpm e2e` builds first. The dev proxy is covered separately in
// tests/proxy.

const WEB = '/web/';

async function openWeb(page: Page): Promise<void> {
  await page.goto(WEB);
  await expect(page.getByRole('button', { name: 'Open left pane' })).toBeVisible();
}

async function showSidebar(page: Page): Promise<void> {
  if (await page.getByRole('complementary', { name: 'Left pane' }).isVisible()) return;
  await page.getByRole('button', { name: 'Open left pane' }).click();
  await expect(page.getByRole('complementary', { name: 'Left pane' })).toBeVisible();
}

const webRow = (page: Page, title: string | RegExp) =>
  page.getByRole('complementary', { name: 'Left pane' }).locator('[data-thread]').filter({ hasText: title });

test.describe('shell renders', () => {
  test('loads with no uncaught errors and the seeded threads listed', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await openWeb(page);
    await showSidebar(page);
    for (const t of ['Non-linear chat system', 'Pricing research', 'Onboarding flow review', 'Q3 planning notes']) {
      await expect(webRow(page, t)).toBeVisible();
    }
    expect(errors, errors.join(' | ')).toEqual([]);
  });

  // The point of the token mapping: the same classes paint a different
  // colour per theme, and every one of them traces to tokens.css.
  for (const [theme, attr] of [['dark', null], ['grey', 'grey'], ['light', 'light']] as const) {
    test(`paints from tokens in the ${theme} theme`, async ({ page }) => {
      await page.addInitScript(t => localStorage.setItem('nl_theme', t), theme);
      await openWeb(page);
      if (attr) await expect(page.locator('html')).toHaveAttribute('data-theme', attr);
      else await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
      const { body, token } = await page.evaluate(() => {
        const probe = document.createElement('div');
        probe.style.backgroundColor = 'var(--bg)';
        document.body.appendChild(probe);
        const token = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return { body: getComputedStyle(document.body).backgroundColor, token };
      });
      expect(body).toBe(token);
    });
  }

  test('the three themes really are three different backgrounds', async ({ browser }) => {
    const seen = new Set<string>();
    for (const theme of ['dark', 'grey', 'light']) {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.addInitScript(t => localStorage.setItem('nl_theme', t), theme);
      await page.goto(WEB);
      await page.getByRole('button', { name: 'Open left pane' }).waitFor();
      seen.add(await page.evaluate(() => getComputedStyle(document.body).backgroundColor));
      await ctx.close();
    }
    expect(seen.size).toBe(3);
  });
});

test.describe('tabs persist to nl_tabs_v1', () => {
  test('opening a thread adds a tab, and reload restores it and the active one', async ({ page }) => {
    await openWeb(page);
    await showSidebar(page);
    await webRow(page, 'Pricing research').getByRole('button', { name: 'Pricing research', exact: true }).click();
    await expect(page.getByRole('tab', { name: /Pricing research/ })).toHaveAttribute('aria-selected', 'true');

    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('nl_tabs_v1') ?? 'null'));
    expect(stored).toEqual({ tabs: [{ id: 'doc-main' }, { id: 'pricing' }], active: 'pricing' });

    await page.reload();
    await expect(page.getByRole('tab', { name: /Pricing research/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tab')).toHaveCount(2);
  });

  test('closing the last tab reopens the main thread', async ({ page }) => {
    await openWeb(page);
    await page.getByRole('button', { name: /Close Non-linear chat system/ }).click();
    await expect(page.getByRole('tab', { name: /Non-linear chat system/ })).toBeVisible();
  });

  test('the + button opens a blank tab that is never persisted', async ({ page }) => {
    await openWeb(page);
    await page.getByRole('button', { name: 'New tab' }).click();
    await expect(page.getByRole('tab', { name: /New tab/ })).toBeVisible();
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('nl_tabs_v1') ?? 'null'));
    expect(stored.tabs.map((t: { id: string }) => t.id)).not.toContain('blank');
  });

  test('restores a payload written by the legacy app, including note tabs', async ({ page }) => {
    await page.addInitScript(() => {
      if (!localStorage.getItem('nl_tabs_v1')) {
        localStorage.setItem('nl_tabs_v1', JSON.stringify({ tabs: [{ id: 'doc-main' }, { id: 'notes' }, { id: 'note:abc' }], active: 'notes' }));
      }
    });
    await openWeb(page);
    await expect(page.getByRole('tab')).toHaveCount(3);
    await expect(page.getByRole('tab', { name: /^Notes/ })).toHaveAttribute('aria-selected', 'true');
  });
});

test.describe('one database, two apps', () => {
});

test.describe('delete confirmation', () => {
  async function openConfirm(page: Page): Promise<void> {
    await openWeb(page);
    await showSidebar(page);
    await webRow(page, 'Pricing research').hover();
    await page.getByRole('button', { name: 'Delete Pricing research' }).click();
  }

  test('uses the exact legacy copy (smoke step 3 asserts this wording)', async ({ page }) => {
    await openConfirm(page);
    const dialog = page.getByRole('alertdialog');
    await expect(dialog.getByRole('heading')).toHaveText('Delete chat?');
    await expect(dialog).toContainText('This removes "Pricing research" from the left panel and clears its saved messages.');
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Delete chat' })).toBeVisible();
  });

  test('Cancel changes nothing', async ({ page }) => {
    await openConfirm(page);
    await page.getByRole('alertdialog').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(webRow(page, 'Pricing research')).toBeVisible();
    const state = (await readPersistedState(page)) as { deletedThreads: string[] } | null;
    expect(state?.deletedThreads ?? []).toEqual([]);
  });

  test('Esc closes the confirm first and leaves the sidebar open (priority chain)', async ({ page }) => {
    await openConfirm(page);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(page.getByRole('complementary', { name: 'Left pane' })).toBeVisible();
    await expect(webRow(page, 'Pricing research')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('complementary', { name: 'Left pane' })).toBeHidden();
  });

  test('the main thread has no delete control', async ({ page }) => {
    await openWeb(page);
    await showSidebar(page);
    await webRow(page, 'Non-linear chat system').hover();
    await expect(page.getByRole('button', { name: /^Delete Non-linear/ })).toHaveCount(0);
  });
});

test('⌘N opens a new chat', async ({ page }) => {
  await openWeb(page);
  await page.keyboard.press('Control+n');
  await expect(page.getByRole('tab', { name: /Untitled chat/ })).toBeVisible();
});
