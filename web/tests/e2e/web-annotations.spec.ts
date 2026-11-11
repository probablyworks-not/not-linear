import { test, expect } from '@playwright/test';
import { mockClaude } from './helpers';

test('amber marker follows held H, persists separately, and supports Undo and confirmed Clear', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('nl_api_keys', JSON.stringify({ anthropic:'sk-ant-TESTONLY-annotations' }));
  });
  await mockClaude(page, 'Amber annotations stay with this paragraph when you return to the conversation.');
  await page.goto('/web/');
  await page.getByRole('button', { name:'Open left pane' }).click();
  await page.getByRole('button', { name:/New chat/ }).click();
  await page.getByRole('button', { name:'Close left pane' }).click();
  const composer = page.getByRole('textbox', { name:'Message', exact:true });
  await composer.fill('Explain annotations');
  await composer.press('Enter');
  const paragraph = page.locator('[data-chat-stream] .msg.ai .ai-content p').first();
  await expect(paragraph).toContainText('Amber annotations');
  const marker = page.locator('.annotation-toolbar [data-action="draw"]');
  const paths = page.locator('.annotation-layer path');
  // A normal toolbar button takes focus away from the composer; leave toggle off.
  await marker.click();
  await marker.click();
  const box = (await paragraph.boundingBox())!;
  await page.keyboard.down('h');
  await expect(marker).toHaveAttribute('aria-pressed','true');
  await page.mouse.move(box.x+5,box.y+8);
  await page.mouse.down();
  await page.mouse.move(box.x+180,box.y+8,{steps:10});
  await page.mouse.up();
  await page.keyboard.up('h');
  await expect(marker).toHaveAttribute('aria-pressed','false');
  await expect(paths).toHaveCount(1);
  expect(await page.locator('[data-chat-stream] .annotation-layer').count()).toBe(0);
  // Typing H in the composer must never activate drawing.
  await composer.press('h');
  await expect(composer).toHaveValue('h');
  await expect(marker).toHaveAttribute('aria-pressed','false');
  await composer.fill('');
  await page.reload();
  await expect(paths).toHaveCount(1);
  await page.locator('.annotation-toolbar [data-action="clear"]').click();
  await expect(page.getByRole('heading',{name:'Clear annotations?',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(paths).toHaveCount(1);
  await page.locator('.annotation-toolbar [data-action="draw"]').click();
  await page.keyboard.press('Escape');
  await expect(marker).toHaveAttribute('aria-pressed','false');
  await page.screenshot({path:'/private/tmp/notlinear-desktop-annotations.png'});
  await page.locator('.annotation-toolbar [data-action="undo"]').click();
  await expect(paths).toHaveCount(0);
  await page.reload();
  await expect(paths).toHaveCount(0);
  expect(errors).toEqual([]);
});
