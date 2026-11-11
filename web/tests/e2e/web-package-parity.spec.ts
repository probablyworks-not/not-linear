import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { openSettings } from './helpers';

test('packaged current Settings exposes every section and subscription controls', async ({ page }) => {
  test.skip(!process.env.NOTLINEAR_TEST_APP, 'Only applies to the packaged desktop audit');
  mkdirSync('../dist/parity-review', { recursive: true });
  await openSettings(page);
  for (const [id, label] of [
    ['general','General'], ['models','Models & keys'], ['skills','Skills'],
    ['integrations','Integrations'], ['modes','Modes'], ['updates','Product updates'],
    ['logs','Runtime logs'],
  ] as const) {
    await page.getByRole('tab', { name: new RegExp(`^${label}`) }).click();
    await expect(page.getByRole('tab', { name: new RegExp(`^${label}`) })).toHaveAttribute('aria-selected', 'true');
    if (id === 'models') {
      await expect(page.getByRole('button', { name: 'Connect Claude', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Continue with ChatGPT', exact: true })).toBeVisible();
    }
    if (id === 'updates') {
      await expect(page.getByText('Loading changelog...', { exact: true })).toHaveCount(0);
      await expect(page.getByTestId('release-card').first()).toBeVisible();
    }
    await page.screenshot({ path: `../dist/parity-review/settings-${id}.png`, fullPage: true });
  }
  await page.getByRole('button', { name: 'Close settings' }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Open left pane' })).toBeVisible();
});
