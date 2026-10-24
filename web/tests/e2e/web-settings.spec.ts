import { test, expect, type Page } from '@playwright/test';
import { openSettings, readPersistedState } from './helpers';

// Settings is a full page with seven tabs. Keys below are obviously fake and are asserted on,
// so they must never be real.
const FAKE_SERPER = 'serper-TESTONLY-needle-9876543210';
const FAKE_ANTHROPIC = 'sk-ant-TESTONLY-needle-abcdefghij';

const page_ = (p: Page) => p.getByRole('dialog', { name: 'Settings' });
const prefsOf = async (page: Page) => ((await readPersistedState(page)) as { prefs: Record<string, unknown> } | null)?.prefs ?? {};
const card = (p: Page, id: string) => p.locator(`[data-provider="${id}"]`);
async function connect(p: Page, id: string, key: string): Promise<void> {
  await card(p, id).getByRole('button', { expanded: false }).click();
  await card(p, id).getByLabel(/API key/).fill(key);
  await card(p, id).getByRole('button', { name: 'Connect', exact: true }).click();
}

test.describe('the page', () => {
  test('opens on General from the sidebar footer, with every tab in the rail', async ({ page }) => {
    await openSettings(page);
    for (const t of ['General', 'Models & keys', 'Skills', 'Integrations', 'Modes', 'Product updates', 'Runtime logs']) {
      await expect(page_(page).getByRole('tab', { name: new RegExp(`^${t}`) })).toBeVisible();
    }
    await expect(page_(page).getByRole('tab', { name: /^General/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page_(page).getByRole('heading', { name: 'General' })).toBeVisible();
  });

  test('Esc closes it (no modal-over-modal chain any more) and so does the back button', async ({ page }) => {
    await openSettings(page);
    await page.keyboard.press('Escape');
    await expect(page_(page)).toHaveCount(0);
    await page.getByRole('button', { name: 'Open settings' }).click();
    await page.getByRole('button', { name: 'Close settings' }).click();
    await expect(page_(page)).toHaveCount(0);
  });

  test('the rail counts match the data: modes, skills, providers with a key', async ({ page }) => {
    await openSettings(page);
    await expect(page.getByTestId('count-modes')).toHaveText('6');
    await expect(page.getByTestId('count-models')).toHaveText('0');
    await expect(page.getByTestId('count-skills')).not.toHaveText('0');
    await page.getByRole('tab', { name: /^Models/ }).click();
    await connect(page, 'serper', FAKE_SERPER);
    await expect(page.getByTestId('count-models')).toHaveText('1');
  });

  test('the chosen tab is remembered while the app is open', async ({ page }) => {
    await openSettings(page, 'Modes');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Open settings' }).click();
    await expect(page_(page).getByRole('tab', { name: /^Modes/ })).toHaveAttribute('aria-selected', 'true');
  });
});

test.describe('General', () => {
  test('defaults match the ones legacy shows for an unset pref', async ({ page }) => {
    await openSettings(page);
    const d = page_(page);
    for (const label of ['Appearance', 'Workspace name', 'What should AI call you?', 'Tone preset', 'What are you working on?']) {
      await expect(d.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(d.getByRole('radio', { name: /Light/ })).toHaveAttribute('aria-checked', 'true');
    await expect(d.getByRole('radio', { name: /Concise/ })).toHaveAttribute('aria-checked', 'true');
    await expect(d.getByLabel('Workspace name')).toHaveValue('Workspace');
  });

  test('theme chosen here is applied live and persisted', async ({ page }) => {
    await openSettings(page);
    await page.getByRole('radio', { name: /Grey/ }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'grey');
    expect(await page.evaluate(() => localStorage.getItem('nl_theme'))).toBe('grey');
    await expect.poll(async () => (await prefsOf(page)).theme).toBe('grey');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'grey');
  });

  test('each theme card previews its own palette, whichever theme is applied', async ({ page }) => {
    await openSettings(page);
    const bg = (id: string) => page.locator(`[data-preview-theme="${id}"]`).evaluate(el => getComputedStyle(el).backgroundColor);
    const [dark, grey, light] = [await bg('dark'), await bg('grey'), await bg('light')];
    expect(new Set([dark, grey, light]).size).toBe(3);
  });

  test('a typed name persists after the debounce and updates the sidebar', async ({ page }) => {
    await openSettings(page);
    await page.getByLabel('Your name').fill('Sam Rivera');
    await expect.poll(async () => (await prefsOf(page)).name).toBe('Sam Rivera');
    await page.getByRole('button', { name: 'Close settings' }).click();
    await expect(page.getByRole('button', { name: 'Open settings' })).toContainText('Sam Rivera');
  });

  test('tone, context and workspace name persist; clearing the name stores "Workspace" without fighting the input', async ({ page }) => {
    await openSettings(page);
    const d = page_(page);
    await d.getByRole('radio', { name: /Socratic/ }).click();
    await d.getByLabel('What you are working on').fill('Studying tides');
    await d.getByLabel('Workspace name').fill('Lab');
    await expect.poll(async () => (await prefsOf(page)).folderName).toBe('Lab');
    expect(await prefsOf(page)).toMatchObject({ tone: 'socratic', context: 'Studying tides' });
    const field = d.getByLabel('Workspace name');
    await field.fill('');
    await expect(field).toHaveValue('');
    await expect.poll(async () => (await prefsOf(page)).folderName).toBe('Workspace');
  });
});

test.describe('Models & keys', () => {
  test('starts with nothing connected; default model and context ranking persist', async ({ page }) => {
    await openSettings(page, 'Models');
    const d = page_(page);
    for (const id of ['anthropic', 'openai', 'deepseek', 'gemini', 'serper', 'firecrawl', 'searxng', 'github']) {
      await expect(card(page, id)).toContainText('Not set');
    }
    await expect(d.getByRole('radio', { name: /Sonnet 5/ })).toHaveAttribute('aria-checked', 'true');
    await d.getByRole('radio', { name: /Haiku 4\.5/ }).click();
    await d.getByLabel('Context ranking').selectOption('deepseek');
    await expect.poll(async () => (await prefsOf(page)).rankingLlm).toBe('deepseek');
    expect(await prefsOf(page)).toMatchObject({ model: 'haiku' });
  });

  test('only one card is open at a time', async ({ page }) => {
    await openSettings(page, 'Models');
    await card(page, 'anthropic').getByRole('button', { name: /settings/ }).click();
    await expect(card(page, 'anthropic').getByLabel(/API key/)).toBeVisible();
    await card(page, 'openai').getByRole('button', { name: /settings/ }).click();
    await expect(card(page, 'anthropic').getByLabel(/API key/)).toHaveCount(0);
    await expect(card(page, 'openai').getByLabel(/API key/)).toBeVisible();
  });

  test('connect: masked, stored in nl_api_keys in the shared shape, never in IndexedDB or the page text', async ({ page }) => {
    await openSettings(page, 'Models');
    await connect(page, 'serper', FAKE_SERPER);
    await expect(card(page, 'serper')).toContainText('Connected');
    await expect(page.getByTestId('key-mask-serper')).toHaveText('serp••••••••3210');
    await expect(page.getByText('API key connected')).toBeVisible();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('nl_api_keys')!))).toEqual({ serper: FAKE_SERPER });
    expect(await page.locator('body').innerText()).not.toContain('needle');
    expect(await page.content()).not.toContain('needle');
    expect(JSON.stringify(await readPersistedState(page))).not.toContain('needle');
  });

  test('the key field is a password input that does not autocomplete; an empty key does nothing; Enter connects', async ({ page }) => {
    await openSettings(page, 'Models');
    await card(page, 'anthropic').getByRole('button', { name: /settings/ }).click();
    const field = card(page, 'anthropic').getByLabel(/API key/);
    await expect(field).toHaveAttribute('type', 'password');
    await expect(field).toHaveAttribute('autocomplete', 'off');
    await field.press('Enter');
    await expect(card(page, 'anthropic')).toContainText('Not set');
    await field.fill(FAKE_ANTHROPIC);
    await field.press('Enter');
    await expect(page.getByTestId('key-mask-anthropic')).toBeVisible();
  });

  test('Remove asks first; Cancel keeps the key; confirming deletes it', async ({ page }) => {
    await openSettings(page, 'Models');
    await connect(page, 'anthropic', FAKE_ANTHROPIC);
    await page.getByRole('button', { name: 'Remove Anthropic key' }).click();
    await expect(page.getByRole('alertdialog').getByRole('heading')).toHaveText('Remove API key?');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('key-mask-anthropic')).toBeVisible();
    await page.getByRole('button', { name: 'Remove Anthropic key' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Remove key' }).click();
    await expect(card(page, 'anthropic')).toContainText('Not set');
    expect(await page.evaluate(() => localStorage.getItem('nl_api_keys'))).toBe('{}');
  });

  test('a connected key survives a reload', async ({ page }) => {
    await openSettings(page, 'Models');
    await connect(page, 'openai', 'sk-TESTONLY-openai-0123456789');
    await openSettings(page, 'Models');
    await expect(card(page, 'openai')).toContainText('Connected');
  });

  test('SearXNG takes a URL: invalid text is refused with a message and not saved; a valid one connects; Remove clears it', async ({ page }) => {
    await openSettings(page, 'Models');
    await card(page, 'searxng').getByRole('button', { name: /settings/ }).click();
    const url = page.getByLabel('SearXNG URL');
    await url.fill('not a url');
    await expect(page.getByRole('alert')).toContainText('Enter a full URL');
    await page.waitForTimeout(400);
    expect((await prefsOf(page)).searxngUrl ?? '').toBe('');
    await url.fill('  http://localhost:8888  ');
    await expect.poll(async () => (await prefsOf(page)).searxngUrl).toBe('http://localhost:8888');
    await expect(card(page, 'searxng')).toContainText('Connected');
    await page.getByRole('button', { name: 'Remove SearXNG URL' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Remove URL' }).click();
    await expect(card(page, 'searxng')).toContainText('Not set');
    await expect.poll(async () => (await prefsOf(page)).searxngUrl).toBe('');
  });

  test('tool availability: only keyless tools at first, and each key or URL switches its tool on live', async ({ page }) => {
    await openSettings(page, 'Models');
    const tool = (name: string) => page.locator(`[data-tool="${name}"]`);
    await expect(tool('wikipedia_search')).toHaveAttribute('data-on', 'true');
    await expect(tool('fetch_url')).toHaveAttribute('data-on', 'true');
    for (const t of ['serper_search', 'firecrawl_scrape', 'web_search', 'github_search_repos']) await expect(tool(t)).toHaveAttribute('data-on', 'false');
    await expect(tool('serper_search')).toContainText('needs a Serper key');

    await connect(page, 'serper', FAKE_SERPER);
    await expect(tool('serper_search')).toHaveAttribute('data-on', 'true');
    await connect(page, 'github', 'ghp_TESTONLY_e2e_aaaaaaaaaaaa');
    await expect(tool('github_search_repos')).toHaveAttribute('data-on', 'true');
    await card(page, 'serper').getByRole('button', { name: /settings/ }).click(); // one card open at a time
    await page.getByRole('button', { name: 'Remove Serper key' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Remove key' }).click();
    await expect(tool('serper_search')).toHaveAttribute('data-on', 'false');
  });
});
