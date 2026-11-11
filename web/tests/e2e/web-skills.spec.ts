import { test, expect, type Page } from '@playwright/test';
import { mockClaude, openSettings } from './helpers';

// P7: the Skills tab in Settings. Skills live in their own db (notlinear-skills), so the
// persistence test reloads and re-reads through the UI.

const card = (page: Page, name: string) => page.locator(`[data-skill="${name}"]`);
const detail = (page: Page, name: string) => page.getByRole('region', { name: `Skill ${name}` });
const open = async (page: Page, name: string) => { await card(page, name).getByRole('button', { name: `Open ${name}` }).click(); };

test.describe('Skills tab', () => {
  test('lists the library as cards and the probe shows which skills would fire', async ({ page }) => {
    await openSettings(page, 'Skills');
    await expect(card(page, 'pre-mortem')).toBeVisible();
    await page.getByLabel('Test a message').fill('Run a pre-mortem on our launch: imagine it failed');
    await expect(page.getByTestId('skills-preview')).toContainText('pre-mortem');
  });

  test('clicking the toggle does not open the detail; clicking the card does; Esc closes the detail first, then Settings', async ({ page }) => {
    await openSettings(page, 'Skills');
    await page.getByLabel('Enable steelman').click();
    await expect(card(page, 'steelman')).toHaveAttribute('data-enabled', 'false');
    await expect(detail(page, 'steelman')).toHaveCount(0);
    await open(page, 'steelman');
    await expect(detail(page, 'steelman')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(detail(page, 'steelman')).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Settings' })).toHaveCount(0);
  });

  test('edits, a new skill and a pin persist across a reload', async ({ page }) => {
    await openSettings(page, 'Skills');
    await open(page, 'steelman');
    const kw = page.getByLabel('Add keyword');
    await kw.fill('zebra');
    await kw.press('Enter');
    await expect(detail(page, 'steelman')).toContainText('zebra');
    await page.getByRole('button', { name: 'All skills' }).click();

    await page.getByRole('button', { name: 'New skill' }).click();
    await expect(detail(page, 'new-skill')).toBeVisible();
    await page.getByLabel('Instructions', { exact: true }).fill('Always answer in haiku.');
    await page.getByRole('button', { name: 'All skills' }).click();

    await open(page, 'pre-mortem');
    await page.getByRole('switch', { name: 'Pinned' }).click();
    await page.waitForTimeout(400); // 200ms debounce
    await openSettings(page, 'Skills'); // reloads
    await expect(card(page, 'steelman')).toContainText('Edited');
    await expect(card(page, 'new-skill')).toContainText('Custom');
    await expect(card(page, 'pre-mortem')).toContainText('Always on');
    await page.getByLabel('Test a message').fill('zebra');
    await expect(page.getByTestId('skills-preview')).toContainText('steelman');
  });

  test('a custom skill can be renamed (slug, unique); blank and duplicate names are refused', async ({ page }) => {
    await openSettings(page, 'Skills');
    await page.getByRole('button', { name: 'New skill' }).click();
    const name = page.getByLabel('Skill name');
    await name.fill('My Cool Skill');
    await name.press('Enter');
    await expect(detail(page, 'my-cool-skill')).toBeVisible();
    await name.fill('pre-mortem'); // taken by a built-in
    await name.press('Enter');
    await expect(page.getByText('Skill names must be unique and not empty')).toBeVisible();
    await expect(name).toHaveValue('my-cool-skill');
    await name.fill('   ');
    await name.press('Enter');
    await expect(name).toHaveValue('my-cool-skill');
  });

  test('a built-in skill name is read-only and it cannot be deleted', async ({ page }) => {
    await openSettings(page, 'Skills');
    await open(page, 'steelman');
    await expect(page.getByLabel('Skill name')).toHaveAttribute('readonly', '');
    await expect(page.getByRole('button', { name: 'Delete skill' })).toHaveCount(0);
  });

  test('the instructions box shows live line and character counts; priority never goes below 0', async ({ page }) => {
    await openSettings(page, 'Skills');
    await page.getByRole('button', { name: 'New skill' }).click();
    await page.getByLabel('Instructions', { exact: true }).fill('a\nbb\nccc');
    await expect(page.getByTestId('skill-stats')).toHaveText('3 lines · 8 chars');
    await expect(page.getByRole('button', { name: 'Lower priority' })).toBeDisabled();
    await page.getByRole('button', { name: 'Raise priority' }).click();
    await expect(page.getByTestId('skill-priority')).toHaveText('1');
  });

  test('deleting a custom skill asks first, returns to the list, and the card is gone', async ({ page }) => {
    await openSettings(page, 'Skills');
    await page.getByRole('button', { name: 'New skill' }).click();
    await page.getByRole('button', { name: 'Delete skill' }).click();
    await expect(page.getByRole('alertdialog').getByRole('heading')).toHaveText('Delete skill?');
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete skill' }).click();
    await expect(detail(page, 'new-skill')).toHaveCount(0);
    await expect(card(page, 'new-skill')).toHaveCount(0);
  });

  test('search with no match shows an empty state that can be cleared', async ({ page }) => {
    await openSettings(page, 'Skills');
    await page.getByLabel('Search skills').fill('zzzz-no-such-skill');
    await expect(page.getByTestId('empty-state')).toContainText('No skills match');
    await page.getByRole('button', { name: 'Clear search' }).click();
    await expect(card(page, 'pre-mortem')).toBeVisible();
  });

  test('a disabled skill never fires', async ({ page }) => {
    await openSettings(page, 'Skills');
    await page.getByLabel('Enable steelman').click();
    await page.getByLabel('Test a message').fill('steelman the opposing argument');
    await expect(page.getByTestId('skills-preview')).not.toContainText('steelman ·');
  });

  test('Import rejects a file that is not a SKILL.md and accepts one that is', async ({ page }) => {
    await openSettings(page, 'Skills');
    const input = page.getByLabel('Import skill file');
    await input.setInputFiles({ name: 'bad.md', mimeType: 'text/markdown', buffer: Buffer.from('just text') });
    await expect(page.getByText('Not a SKILL.md')).toBeVisible();
    await input.setInputFiles({ name: 'ok.md', mimeType: 'text/markdown', buffer: Buffer.from('---\nname: imported-one\ndescription: From a file.\n---\n# Hi\n') });
    await expect(page.getByText('Imported "imported-one"')).toBeVisible();
    await expect(detail(page, 'imported-one')).toBeVisible();
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

  test('the list stays open after a pick, so several skills can be added in one go', async ({ page }) => {
    await newChat(page);
    const box = page.getByRole('textbox', { name: 'Message' });
    await box.fill('/pre-mor');
    await box.press('Enter');
    await expect(page.getByTestId('picked-skills')).toContainText('pre-mortem');
    // Still open, and the picked one is gone from the list.
    await expect(page.getByRole('listbox', { name: 'Skills' })).toBeVisible();
    await expect(page.locator('[data-skill-option="pre-mortem"]')).toHaveCount(0);
    // Typing filters again without retyping "/", and Enter adds a second chip.
    await box.press('d');
    await box.press('e');
    await box.press('v');
    await expect(page.locator('[data-skill-option]').first()).toBeVisible();
    await box.press('Enter');
    await expect(page.getByTestId('picked-skills').locator('span', { has: page.locator('button') })).toHaveCount(2);
    await expect(box).toHaveValue('');
    await box.press('Escape');
    await expect(page.getByRole('listbox', { name: 'Skills' })).toBeHidden();
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
  await openSettings(page, 'Models');
  await expect(page.getByText('GitHub repo search')).toBeVisible();
  await expect(page.getByText('needs a GitHub token').first()).toBeVisible();
  await page.locator('[data-provider="github"]').getByRole('button', { name: /settings/ }).click();
  await page.getByLabel('GitHub API key').fill('ghp_TESTONLY_e2e_aaaaaaaaaaaa');
  await page.getByLabel('GitHub API key').press('Enter');
  await expect(page.getByText('needs a GitHub token')).toHaveCount(0);
});
