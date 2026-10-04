import { test, expect, type Page } from '@playwright/test';
import { openApp, openSidebar, readPersistedState } from './helpers';

// P4.1a: Settings in /web/, against the same IndexedDB row and the same
// localStorage as the legacy app. Every test that matters here ends by loading
// the OTHER app and checking it sees the change, because "both apps agree" is
// the property that breaks silently.
//
// Keys below are obviously fake and are asserted on, so they must never be real.
const FAKE_SERPER = 'serper-TESTONLY-needle-9876543210';
const FAKE_ANTHROPIC = 'sk-ant-TESTONLY-needle-abcdefghij';

async function openWeb(page: Page): Promise<void> {
  await page.goto('/web/');
  await expect(page.getByRole('button', { name: 'Open left pane' })).toBeVisible();
}

async function openSettings(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Open left pane' }).click();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
}

/** Legacy ships its sidebar collapsed, so its Settings entry is off-screen until opened. */
async function openLegacySettings(page: Page): Promise<void> {
  await openSidebar(page);
  await page.locator('#open-prefs').click();
  await expect(page.locator('#prefs')).toHaveClass(/show/);
}

// A CSS locator, not getByRole: while a Radix dialog is open everything behind it is
// aria-hidden, so a role query reports the sidebar as absent whether or not it is open.
const sidebar = (page: Page) => page.locator('aside[aria-label="Left pane"]');

const prefsOf = async (page: Page) => ((await readPersistedState(page)) as { prefs: Record<string, unknown> } | null)?.prefs ?? {};

test.describe('Settings dialog', () => {
  test('opens from the sidebar footer and shows every section', async ({ page }) => {
    await openWeb(page);
    await openSettings(page);
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    for (const label of ['Appearance', 'Workspace name', 'What should AI call you?', 'Tone preset', 'What are you working on?', 'Default model', 'API Keys', 'Context Ranking', 'Web Search (SearXNG)']) {
      await expect(dialog.getByText(label, { exact: true })).toBeVisible();
    }
    // Defaults match the ones legacy shows for an unset pref.
    await expect(dialog.getByRole('radio', { name: /Light/ })).toHaveAttribute('aria-checked', 'true');
    await expect(dialog.getByRole('radio', { name: /Concise/ })).toHaveAttribute('aria-checked', 'true');
    await expect(dialog.getByRole('radio', { name: /Sonnet 5/ })).toHaveAttribute('aria-checked', 'true');
    await expect(dialog.getByLabel('Workspace name')).toHaveValue('Workspace');
  });

  test('Esc follows the legacy chain: the sidebar closes before Settings, then Settings', async ({ page }) => {
    await openWeb(page);
    await openSettings(page);
    await expect(sidebar(page)).toBeVisible(); // so the hidden check below is not vacuous
    await page.keyboard.press('Escape');
    await expect(sidebar(page)).toBeHidden();
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Settings' })).toHaveCount(0);
  });

  test('the close button works', async ({ page }) => {
    await openWeb(page);
    await openSettings(page);
    await page.getByRole('button', { name: 'Close settings' }).click();
    await expect(page.getByRole('dialog', { name: 'Settings' })).toHaveCount(0);
  });
});

test.describe('prefs round-trip with the legacy app', () => {
  test('theme chosen in /web/ is applied live, persisted in BOTH places, and legacy opens with it', async ({ page }) => {
    await openWeb(page);
    await openSettings(page);
    await page.getByRole('radio', { name: /Grey/ }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'grey');
    expect(await page.evaluate(() => localStorage.getItem('nl_theme'))).toBe('grey');
    await expect.poll(async () => (await prefsOf(page)).theme).toBe('grey');

    await openApp(page); // legacy re-applies prefs.theme on load and overwrites nl_theme from it
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'grey');
    expect(await page.evaluate(() => localStorage.getItem('nl_theme'))).toBe('grey');
  });

  test('a typed name persists after the debounce, updates the sidebar, and legacy shows it', async ({ page }) => {
    await openWeb(page);
    await openSettings(page);
    await page.getByLabel('Your name').fill('Sam Rivera');
    await expect.poll(async () => (await prefsOf(page)).name).toBe('Sam Rivera');
    await page.getByRole('button', { name: 'Close settings' }).click();
    await expect(page.getByRole('button', { name: 'Open settings' })).toContainText('Sam Rivera');

    await openApp(page);
    await expect(page.locator('.side-foot .name')).toHaveText('Sam Rivera');
  });

  test('default model, tone, context, ranking and SearXNG all persist and reach legacy', async ({ page }) => {
    await openWeb(page);
    await openSettings(page);
    const d = page.getByRole('dialog', { name: 'Settings' });
    await d.getByRole('radio', { name: /Haiku 4\.5/ }).click();
    await d.getByRole('radio', { name: /Socratic/ }).click();
    await d.getByLabel('What you are working on').fill('Studying tides');
    await d.getByLabel('Context ranking').selectOption('deepseek');
    await d.getByLabel('SearXNG URL').fill('  http://localhost:8888  ');
    await d.getByLabel('Workspace name').fill('Lab');
    // Each field has its own 200ms debounce and workspace name was filled last, so wait on that one.
    await expect.poll(async () => (await prefsOf(page)).folderName).toBe('Lab');
    expect((await prefsOf(page)).searxngUrl).toBe('http://localhost:8888'); // trimmed, like legacy
    expect(await prefsOf(page)).toMatchObject({
      model: 'haiku', tone: 'socratic', context: 'Studying tides', rankingLlm: 'deepseek', folderName: 'Lab',
    });

    await openApp(page);
    await expect(page.locator('#main-model-btn .model-label')).toHaveText('Haiku 4.5');
    await expect(page.locator('#pref-context')).toHaveValue('Studying tides');
    await expect(page.locator('#searxng-url')).toHaveValue('http://localhost:8888');
    await expect(page.locator('#ranking-llm-select')).toHaveValue('deepseek');
    await expect(page.locator('#prefs .seg button[data-v="socratic"]')).toHaveClass(/on/);
  });

  test('clearing the workspace name stores "Workspace", as legacy does, without fighting the input', async ({ page }) => {
    await openWeb(page);
    await openSettings(page);
    const field = page.getByLabel('Workspace name');
    await field.fill('');
    await expect(field).toHaveValue(''); // the draft is not snapped back mid-edit
    await expect.poll(async () => (await prefsOf(page)).folderName).toBe('Workspace');
  });

  test('a pref set by legacy is what /web/ shows', async ({ page }) => {
    await openApp(page);
    await openLegacySettings(page);
    await page.locator('#pref-name').fill('Legacy Lee');
    await page.locator('#seg-tone button[data-v="formal"]').click();
    await expect.poll(async () => (await prefsOf(page)).name).toBe('Legacy Lee');
    await expect.poll(async () => (await prefsOf(page)).tone).toBe('formal');

    await openWeb(page);
    await openSettings(page);
    await expect(page.getByLabel('Your name')).toHaveValue('Legacy Lee');
    await expect(page.getByRole('radio', { name: /Formal/ })).toHaveAttribute('aria-checked', 'true');
  });
});

test.describe('API keys', () => {
  test('connect: masked in the UI, stored in nl_api_keys in the shared shape, never in IndexedDB', async ({ page }) => {
    await openWeb(page);
    await openSettings(page);
    await page.getByLabel('Provider').selectOption('serper');
    await page.getByLabel('API key').fill(FAKE_SERPER);
    await page.getByRole('button', { name: 'Connect', exact: true }).click();

    await expect(page.getByTestId('key-mask-serper')).toHaveText('serp••••••••3210');
    await expect(page.getByLabel('API key')).toHaveValue(''); // cleared after connect
    await expect(page.getByText('API key connected')).toBeVisible(); // legacy's toast copy
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('nl_api_keys')!))).toEqual({ serper: FAKE_SERPER });

    // The full key appears nowhere in the rendered page...
    expect(await page.locator('body').innerText()).not.toContain('needle');
    expect(await page.content()).not.toContain('needle');
    // ...and was never written to the chat database.
    expect(JSON.stringify(await readPersistedState(page))).not.toContain('needle');
  });

  test('the key field is a password input that does not autocomplete', async ({ page }) => {
    await openWeb(page);
    await openSettings(page);
    const field = page.getByLabel('API key');
    await expect(field).toHaveAttribute('type', 'password');
    await expect(field).toHaveAttribute('autocomplete', 'off');
  });

  test('Enter connects; an empty key does nothing', async ({ page }) => {
    await openWeb(page);
    await openSettings(page);
    await page.getByLabel('API key').press('Enter');
    await expect(page.getByText('No keys connected yet.')).toBeVisible();
    await page.getByLabel('API key').fill(FAKE_ANTHROPIC);
    await page.getByLabel('API key').press('Enter');
    await expect(page.getByTestId('key-mask-anthropic')).toBeVisible();
  });

  test('a key connected in /web/ is visible to legacy, and removal propagates too', async ({ page }) => {
    await openWeb(page);
    await openSettings(page);
    await page.getByLabel('API key').fill(FAKE_ANTHROPIC);
    await page.getByRole('button', { name: 'Connect', exact: true }).click();

    await openApp(page);
    await openLegacySettings(page);
    await expect(page.locator('#api-key-list .api-provider')).toHaveText('Anthropic');
    await expect(page.locator('#api-key-list .api-key-mask')).toHaveText('sk-a••••••••ghij');

    await openWeb(page);
    await openSettings(page);
    await page.getByRole('button', { name: 'Disconnect Anthropic' }).click();
    await expect(page.getByText('No keys connected yet.')).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('nl_api_keys'))).toBe('{}');
  });

  test('a key connected in legacy is shown in /web/, and connecting there keeps it', async ({ page }) => {
    await openApp(page);
    await openLegacySettings(page);
    await page.locator('#api-provider').selectOption('anthropic');
    await page.locator('#api-key-input').fill(FAKE_ANTHROPIC);
    await page.locator('#api-key-add').click();
    // Precondition, so a failure below can only be /web/'s: legacy really stored it.
    await expect.poll(() => page.evaluate(() => localStorage.getItem('nl_api_keys'))).toContain('anthropic');

    await openWeb(page);
    await openSettings(page);
    await expect(page.getByTestId('key-mask-anthropic')).toBeVisible();
    await page.getByLabel('Provider').selectOption('serper');
    await page.getByLabel('API key').fill(FAKE_SERPER);
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    expect(await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('nl_api_keys')!)).sort())).toEqual(['anthropic', 'serper']);
  });
});

test.describe('tool availability', () => {
  const tool = (page: Page, name: string) => page.locator(`[data-tool="${name}"]`);

  test('starts with only the keyless tools, and each key or URL switches its tool on live', async ({ page }) => {
    await openWeb(page);
    await openSettings(page);
    await expect(tool(page, 'wikipedia_search')).toHaveAttribute('data-on', 'true');
    await expect(tool(page, 'fetch_url')).toHaveAttribute('data-on', 'true');
    for (const t of ['serper_search', 'firecrawl_scrape', 'web_search']) await expect(tool(page, t)).toHaveAttribute('data-on', 'false');
    await expect(tool(page, 'serper_search')).toContainText('needs a Serper key');

    await page.getByLabel('Provider').selectOption('serper');
    await page.getByLabel('API key').fill(FAKE_SERPER);
    await page.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(tool(page, 'serper_search')).toHaveAttribute('data-on', 'true');

    await page.getByLabel('SearXNG URL').fill('http://localhost:8888');
    await expect(tool(page, 'web_search')).toHaveAttribute('data-on', 'true');
    await page.getByLabel('SearXNG URL').fill('');
    await expect(tool(page, 'web_search')).toHaveAttribute('data-on', 'false');

    await page.getByRole('button', { name: 'Disconnect Serper' }).click();
    await expect(tool(page, 'serper_search')).toHaveAttribute('data-on', 'false');
  });
});
