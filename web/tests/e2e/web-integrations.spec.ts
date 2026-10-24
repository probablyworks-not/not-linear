import { test, expect, type Page } from '@playwright/test';
import { openSettings } from './helpers';

// Settings -> Integrations. A PLACEHOLDER: nothing connects to anything. These tests pin the
// behaviour of the preview (and that it says it is one), so a real integration can replace it.

const open = (p: Page) => openSettings(p, 'Integrations');
const sub = (p: Page, n: string) => p.getByRole('tab', { name: new RegExp(`^${n}`) });

test('says it is a preview', async ({ page }) => {
  await open(page);
  await expect(page.getByRole('note')).toContainText('not live yet');
});

test.describe('Apps', () => {
  test('lists the five apps as not connected, with scopes and an offer', async ({ page }) => {
    await open(page);
    for (const id of ['github', 'reddit', 'notion', 'drive', 'slack']) {
      await expect(page.locator(`[data-app="${id}"]`)).toHaveAttribute('data-connected', 'false');
    }
    await expect(page.locator('[data-app="github"]')).toContainText('Read repos · Issues · Pull requests · Code search');
    await expect(page.getByTestId('count-integrations')).toHaveText('0');
  });

  test('Connect / Disconnect toggles locally, updates the rail count and survives a reload', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Connect Reddit' }).click();
    await expect(page.locator('[data-app="reddit"]')).toContainText('Connected (preview)');
    await expect(page.getByTestId('count-integrations')).toHaveText('1');
    await open(page);
    await expect(page.locator('[data-app="reddit"]')).toHaveAttribute('data-connected', 'true');
    await page.getByRole('button', { name: 'Disconnect Reddit' }).click();
    await expect(page.getByTestId('count-integrations')).toHaveText('0');
  });

  test('GitHub points to the real token field in Models & keys', async ({ page }) => {
    await open(page);
    await page.locator('[data-app="github"]').getByRole('button', { name: 'Models & keys' }).click();
    await expect(page.getByRole('tab', { name: /^Models/ })).toHaveAttribute('aria-selected', 'true');
  });
});

test.describe('MCP servers', () => {
  test('zero state offers Add server; the form ignores a blank name; a blank command saves as "not configured"', async ({ page }) => {
    await open(page);
    await sub(page, 'MCP servers').click();
    await expect(page.getByTestId('empty-state')).toContainText('No MCP servers');
    await page.getByRole('button', { name: 'Add server' }).click();
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByText('Give the server a name')).toBeVisible();
    await expect(page.locator('[data-mcp]')).toHaveCount(0);
    await page.getByLabel('Server name').fill('Local');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.locator('[data-mcp="Local"]')).toContainText('not configured');
    await expect(page.locator('[data-mcp="Local"]')).toContainText('0 tools');
    await expect(page.getByTestId('count-integrations')).toHaveText('1');
  });

  test('tells a URL (http) from a command (stdio); toggle and delete (with a confirm)', async ({ page }) => {
    await open(page);
    await sub(page, 'MCP servers').click();
    await page.getByRole('button', { name: 'Add server' }).click();
    await page.getByLabel('Server name').fill('Remote');
    await page.getByLabel('URL or command').fill('https://x.dev/mcp');
    await page.getByLabel('URL or command').press('Enter');
    await expect(page.locator('[data-mcp="Remote"]')).toContainText(/http/i);
    await page.getByRole('button', { name: 'Add server' }).click();
    await page.getByLabel('Server name').fill('Fetch');
    await page.getByLabel('URL or command').fill('uvx mcp-server-fetch');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.locator('[data-mcp="Fetch"]')).toContainText(/stdio/i);

    await page.getByRole('switch', { name: 'Enable Fetch' }).click();
    await expect(page.locator('[data-mcp="Fetch"]')).toContainText('Off');
    await expect(page.getByTestId('count-integrations')).toHaveText('1');

    await page.getByRole('button', { name: 'Delete Fetch' }).click();
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-mcp="Fetch"]')).toBeVisible();
    await page.getByRole('button', { name: 'Delete Fetch' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete server' }).click();
    await expect(page.locator('[data-mcp="Fetch"]')).toHaveCount(0);
  });

  test('servers survive a reload; deleting the last one brings the zero state back', async ({ page }) => {
    await open(page);
    await sub(page, 'MCP servers').click();
    await page.getByRole('button', { name: 'Add server' }).click();
    await page.getByLabel('Server name').fill('Keep');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await open(page);
    await sub(page, 'MCP servers').click();
    await expect(page.locator('[data-mcp="Keep"]')).toBeVisible();
    await page.getByRole('button', { name: 'Delete Keep' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete server' }).click();
    await expect(page.getByTestId('empty-state')).toContainText('No MCP servers');
  });
});

test.describe('Plugins', () => {
  test('lists the four plugins with their defaults and toggles them', async ({ page }) => {
    await open(page);
    await sub(page, 'Plugins').click();
    await expect(page.getByRole('switch', { name: 'Enable Wikipedia search' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('switch', { name: 'Enable Save answers as notes' })).toHaveAttribute('aria-checked', 'false');
    await page.getByRole('switch', { name: 'Enable Save answers as notes' }).click();
    await expect(page.getByRole('switch', { name: 'Enable Save answers as notes' })).toHaveAttribute('aria-checked', 'true');
  });

  test('Web search warns until a Serper key or SearXNG URL exists', async ({ page }) => {
    await open(page);
    await sub(page, 'Plugins').click();
    const web = page.locator('[data-plugin="web-search"]');
    await expect(web.getByRole('status')).toContainText('No search key yet');
    await page.addInitScript(() => localStorage.setItem('nl_api_keys', JSON.stringify({ serper: 'serper-TESTONLY-0123456789' })));
    await open(page);
    await sub(page, 'Plugins').click();
    await expect(page.locator('[data-plugin="web-search"]').getByRole('status')).toHaveCount(0);
  });
});
