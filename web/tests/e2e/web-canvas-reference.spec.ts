import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Test-only serving of design references: no new backend route and no changes to the HTML.
const root = resolve(process.cwd(), '../feature-canvas');
const allowed = new Set(['Conversations.html', 'Conversations.dc.html', 'support.js', 'canvas-navigation.js', 'context-islands.js', 'ds-base.js', 'composer-variants.css', 'canvas-navigation.css', 'context-islands.css']);
for (const reference of ['Conversations.html', 'Conversations.dc.html']) {
  test(`${reference} boots and opens reading mode`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('**/canvas-reference/**', async route => {
      const name = new URL(route.request().url()).pathname.split('/').at(-1)!;
      if (!allowed.has(name)) { await route.fulfill({ status: 404, body: 'Missing reference asset' }); return; }
      const body = await readFile(resolve(root, name));
      const contentType = name.endsWith('.js') ? 'application/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html';
      await route.fulfill({ contentType, body });
    });
    await page.goto(`/canvas-reference/${reference}`);
    const read = page.getByRole('button', { name: 'READ', exact: true });
    await expect(read).toBeVisible();
    await read.click();
    await expect(page.getByRole('button', { name: 'BY THREAD', exact: true })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('reference-reader.png'), fullPage: false });
    expect(errors).toEqual([]);
  });
}
