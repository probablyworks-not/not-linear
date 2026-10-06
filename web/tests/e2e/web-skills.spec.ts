import { test, expect, type Page } from '@playwright/test';
import { mockClaude } from './helpers';

// P7: the Skills dialog in /web/. Skills live in their own db (notlinear-skills), so the
// persistence test reloads and re-reads through the UI.

async function openSkills(page: Page): Promise<void> {
  await page.goto('/web/');
  await page.getByRole('button', { name: 'Open left pane' }).click();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Browse / edit skills' }).click();
  await expect(page.getByRole('dialog', { name: 'Skills' })).toBeVisible();
}
const modal = (page: Page) => page.getByRole('dialog', { name: 'Skills' });
const row = (page: Page, name: string) => modal(page).locator(`[data-skill="${name}"]`);

test.describe('Skills dialog', () => {
  test('lists the library and the probe shows which skills would fire', async ({ page }) => {
    await openSkills(page);
    await expect(row(page, 'pre-mortem')).toBeVisible();
    await modal(page).getByLabel('Test a message').fill('Run a pre-mortem on our launch: imagine it failed');
    await expect(modal(page).getByTestId('skills-preview')).toContainText('pre-mortem');
  });

  test('edits, adds and pins persist across a reload', async ({ page }) => {
    await openSkills(page);
    await row(page, 'steelman').getByRole('button', { name: /steelman/ }).first().click();
    await row(page, 'steelman').getByLabel('Keywords: comma-separated trigger terms').fill('zebra, steelman');
    await modal(page).getByRole('button', { name: 'New skill' }).click();
    await row(page, 'new-skill').getByLabel('Instructions: sent to the model').fill('Always answer in haiku.');
    await row(page, 'pre-mortem').getByRole('button', { name: 'Pin pre-mortem' }).click();
    await page.waitForTimeout(400); // 200ms debounce
    await page.reload();
    await page.getByRole('button', { name: 'Open left pane' }).click();
    await page.getByRole('button', { name: 'Open settings' }).click();
    await page.getByRole('button', { name: 'Browse / edit skills' }).click();
    await expect(row(page, 'steelman')).toContainText('Edited');
    await expect(row(page, 'new-skill')).toContainText('Custom');
    await expect(row(page, 'pre-mortem').getByRole('button', { name: 'Unpin pre-mortem' })).toBeVisible();
    await modal(page).getByLabel('Test a message').fill('zebra');
    await expect(modal(page).getByTestId('skills-preview')).toContainText('steelman');
  });

  test('a disabled skill never fires', async ({ page }) => {
    await openSkills(page);
    await row(page, 'steelman').getByLabel('Enable steelman').uncheck();
    await modal(page).getByLabel('Test a message').fill('steelman the opposing argument');
    await expect(modal(page).getByTestId('skills-preview')).not.toContainText('steelman ·');
  });
});

test.describe('/ skill picker in the composer', () => {
  async function newChat(page: Page): Promise<void> {
    await page.addInitScript(() => localStorage.setItem('nl_api_keys', JSON.stringify({ anthropic: 'sk-ant-TESTONLY-skills-aaaaaaaa' })));
    await page.goto('/web/');
    await page.getByRole('button', { name: 'Open left pane' }).click();
    await page.getByRole('button', { name: /New chat/ }).click();
    await expect(page.getByTestId('chat-empty')).toBeVisible();
  }

  test('/skills lists skills; Enter picks one as a chip; Backspace removes it; Esc closes the list', async ({ page }) => {
    await newChat(page);
    const box = page.getByRole('textbox', { name: 'Message' });
    await box.fill('/skills');
    await expect(page.getByRole('listbox', { name: 'Skills' })).toBeVisible();
    await box.press('Escape');
    await expect(page.getByRole('listbox', { name: 'Skills' })).toBeHidden();
    await box.fill('/pre-mor');
    await expect(page.locator('[data-skill-option="pre-mortem"]')).toBeVisible();
    await box.press('Enter');
    await expect(page.getByTestId('picked-skills')).toContainText('pre-mortem');
    await expect(box).toHaveValue('');
    await box.press('Backspace');
    await expect(page.getByTestId('picked-skills')).toBeHidden();
  });

  test('a picked skill reaches the system prompt of that message only', async ({ page }) => {
    const systems: string[] = [];
    page.on('request', req => {
      if (req.url() === 'https://api.anthropic.com/v1/messages') systems.push(JSON.stringify((JSON.parse(req.postData() ?? '{}') as { system?: unknown }).system));
    });
    await mockClaude(page, 'Noted.');
    await newChat(page);
    const box = page.getByRole('textbox', { name: 'Message' });
    await box.fill('/pre-mor');
    await box.press('Enter');
    await box.fill('hello there');
    await box.press('Enter');
    await expect.poll(() => systems.length).toBe(1);
    expect(systems[0]).toContain('### Skill: pre-mortem');
    await expect(page.getByTestId('picked-skills')).toBeHidden();
    await expect(page.getByText('Noted.')).toBeVisible();
    await box.fill('and again');
    await box.press('Enter');
    await expect.poll(() => systems.length).toBe(2);
    expect(systems[1]).not.toContain('### Skill: pre-mortem');
  });

  test('"/" lists every skill, not just a few', async ({ page }) => {
    await newChat(page);
    await page.getByRole('textbox', { name: 'Message' }).fill('/');
    await expect(page.locator('[data-skill-option]')).toHaveCount(57);
  });

  test('automatic selection is shown after the reply', async ({ page }) => {
    await mockClaude(page, 'Noted.');
    await newChat(page);
    const box = page.getByRole('textbox', { name: 'Message' });
    await box.fill('Run a pre-mortem on our launch: imagine it failed');
    await box.press('Enter');
    await expect(page.getByTestId('skills-used')).toContainText('pre-mortem · auto');
    await box.fill('hello there');
    await box.press('Enter');
    await expect(page.getByTestId('skills-used')).toContainText('no skills matched');
  });

  test('"/skills" works at the end of a long message and keeps the text', async ({ page }) => {
    await newChat(page);
    const box = page.getByRole('textbox', { name: 'Message' });
    await box.fill('How should we build this product? use this skills /pre-mor');
    await expect(page.locator('[data-skill-option="pre-mortem"]')).toBeVisible();
    await box.press('Enter');
    await expect(page.getByTestId('picked-skills')).toContainText('pre-mortem');
    await expect(box).toHaveValue('How should we build this product? use this skills');
  });
});

test('GitHub can be connected in Settings and turns the GitHub tools on', async ({ page }) => {
  await page.goto('/web/');
  await page.getByRole('button', { name: 'Open left pane' }).click();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await expect(page.getByText('GitHub repo search')).toBeVisible();
  await expect(page.getByText('needs a GitHub token').first()).toBeVisible();
  await page.getByLabel('Provider').selectOption('github');
  await page.getByLabel('API key').fill('ghp_TESTONLY_e2e_aaaaaaaaaaaa');
  await page.getByLabel('API key').press('Enter');
  await expect(page.getByText('needs a GitHub token')).toHaveCount(0);
});
