import { test, expect } from '@playwright/test';

// The tab/breadcrumb bar and the composer stay out of the way until the pointer goes to their edge.
// The rest of the suite keeps them showing (playwright.config.ts); this one turns hiding back on.

test.use({
  storageState: { cookies: [], origins: [{ origin: 'http://127.0.0.1:8766', localStorage: [{ name: 'nl_autohide_bars', value: '1' }] }] },
});

test('top bar slides in from the top edge and out again', async ({ page }) => {
  await page.goto('/web/');
  const bar = page.locator('[data-topbar]');
  await expect(bar).toBeAttached();
  await page.mouse.move(600, 400);
  await expect.poll(async () => (await bar.boundingBox())?.y ?? 0).toBeLessThan(-20);
  await page.mouse.move(600, 4);
  await expect.poll(async () => (await bar.boundingBox())?.y ?? -99).toBeGreaterThanOrEqual(0);
  await page.mouse.move(600, 500);
  await expect.poll(async () => (await bar.boundingBox())?.y ?? 0).toBeLessThan(-20);
});
