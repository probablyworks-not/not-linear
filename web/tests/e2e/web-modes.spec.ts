import { test, expect, type Page } from '@playwright/test';
import { openApp, readPersistedState } from './helpers';

// P4.1b: the Modes manager in /web/, against the same prefs as the legacy app.
// As with Settings, the tests that matter finish by loading the OTHER app.

async function openWeb(page: Page): Promise<void> {
  await page.goto('/web/');
  await expect(page.getByRole('button', { name: 'Open left pane' })).toBeVisible();
}

async function openModes(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Open left pane' }).click();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'New / manage modes' }).click();
  await expect(page.getByRole('dialog', { name: 'Modes' })).toBeVisible();
}

// A CSS locator, not getByRole: while a Radix dialog is open everything behind it is
// aria-hidden, so a role query reports the sidebar as absent whether or not it is open.
const sidebar = (page: Page) => page.locator('aside[aria-label="Left pane"]');
const modal = (page: Page) => page.getByRole('dialog', { name: 'Modes' });
const row = (page: Page, id: string) => modal(page).locator(`[data-mode="${id}"]`);
const prefsOf = async (page: Page) => ((await readPersistedState(page)) as { prefs: Record<string, any> } | null)?.prefs ?? {}; // eslint-disable-line @typescript-eslint/no-explicit-any -- test-only read of an untyped row

async function createMode(page: Page, name: string, desc: string, instr: string): Promise<void> {
  await modal(page).getByRole('button', { name: 'New mode' }).click();
  await modal(page).getByLabel('Name').fill(name);
  await modal(page).getByLabel('Short description').fill(desc);
  await modal(page).getByLabel('Instructions').fill(instr);
  await modal(page).getByRole('button', { name: 'Create' }).click();
}

test.describe('Modes dialog', () => {
  test('lists the six built-ins with legacy badges and marks General active', async ({ page }) => {
    await openWeb(page);
    await openModes(page);
    await expect(modal(page).getByText('Instructions added to the system prompt. Applies to every chat.')).toBeVisible();
    for (const [id, label] of [['general', 'General'], ['research', 'Research'], ['coding', 'Coding'], ['pm', 'PM'], ['cto', 'CTO'], ['critic', 'Critic']]) {
      await expect(row(page, id!)).toContainText(label!);
      await expect(row(page, id!)).toContainText('Built-in');
    }
    await expect(row(page, 'general')).toContainText('Active');
    await expect(row(page, 'research')).not.toContainText('Active');
  });

  test('Esc unwinds by legacy precedence: modes (110), then the sidebar (80), then settings (30)', async ({ page }) => {
    await openWeb(page);
    await openModes(page);
    await page.keyboard.press('Escape');
    await expect(modal(page)).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
    await expect(sidebar(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sidebar(page)).toBeHidden();
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Settings' })).toHaveCount(0);
  });
});

test.describe('create, edit, reset, delete', () => {
  test('creating a mode persists it and legacy shows it in its mode menu', async ({ page }) => {
    await openWeb(page);
    await openModes(page);
    await createMode(page, 'Teacher', 'Explains simply', 'Teach like I am new.\n\nUse examples.');
    await expect(page.getByText('Created "Teacher"')).toBeVisible();

    const id = (await prefsOf(page)).customModes[0].id as string;
    expect(id).toMatch(/^custom-/);
    await expect(row(page, id)).toContainText('Teacher');
    await expect(row(page, id)).toContainText('Custom');
    expect((await prefsOf(page)).customModes).toEqual([{ id, label: 'Teacher', desc: 'Explains simply', instructions: 'Teach like I am new.\n\nUse examples.' }]);

    await openApp(page);
    await expect(page.locator('#mode-list button[data-mode]')).toHaveCount(7);
    await expect(page.locator(`#mode-list button[data-mode="${id}"]`)).toContainText('Teacher');
  });

  test('an empty name is refused with the legacy message and nothing is saved', async ({ page }) => {
    await openWeb(page);
    await openModes(page);
    await modal(page).getByRole('button', { name: 'New mode' }).click();
    await modal(page).getByRole('button', { name: 'Create' }).click();
    await expect(page.getByText('Give the mode a name')).toBeVisible();
    expect((await prefsOf(page)).customModes).toBeUndefined();
  });

  test('field limits match legacy (name 30, description 50)', async ({ page }) => {
    await openWeb(page);
    await openModes(page);
    await modal(page).getByRole('button', { name: 'New mode' }).click();
    await expect(modal(page).getByLabel('Name')).toHaveAttribute('maxlength', '30');
    await expect(modal(page).getByLabel('Short description')).toHaveAttribute('maxlength', '50');
  });

  test('editing a built-in stores only what differs; Reset to default removes it', async ({ page }) => {
    await openWeb(page);
    await openModes(page);
    await row(page, 'coding').getByRole('button', { name: /Coding/ }).first().click();
    await modal(page).getByLabel('Short description').fill('Terse and exact');
    await modal(page).getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Saved "Coding"')).toBeVisible();
    await expect(row(page, 'coding')).toContainText('Edited');
    expect((await prefsOf(page)).modeOverrides).toEqual({ coding: { desc: 'Terse and exact' } });

    await openApp(page);
    await expect(page.locator('#mode-list button[data-mode="coding"]')).toContainText('Terse and exact');

    await openWeb(page);
    await openModes(page);
    await row(page, 'coding').getByRole('button', { name: /Coding/ }).first().click();
    await modal(page).getByRole('button', { name: 'Reset to default' }).click();
    await expect(page.getByText('Reset to default', { exact: true })).toBeVisible();
    await expect(row(page, 'coding')).toContainText('Built-in');
    expect((await prefsOf(page)).modeOverrides).toEqual({});
  });

  test('delete asks with the legacy wording; Cancel keeps the mode; confirming removes it', async ({ page }) => {
    await openWeb(page);
    await openModes(page);
    await createMode(page, 'Teacher', '', 'x');
    const id = (await prefsOf(page)).customModes[0].id as string;

    await row(page, id).getByRole('button', { name: /Teacher/ }).first().click();
    await modal(page).getByRole('button', { name: 'Delete', exact: true }).click();
    const confirm = page.getByRole('alertdialog');
    await expect(confirm.getByRole('heading')).toHaveText('Delete mode?');
    await expect(confirm).toContainText('This removes the mode "Teacher". Chats using it fall back to General.');
    await expect(confirm.getByRole('button', { name: 'Delete mode' })).toBeVisible();

    await page.keyboard.press('Escape'); // confirm sits above the modes dialog in the chain
    await expect(confirm).toHaveCount(0);
    await expect(modal(page)).toBeVisible();
    await expect(row(page, id)).toBeVisible();

    await modal(page).getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete mode' }).click();
    await expect(page.getByText('Mode deleted')).toBeVisible();
    await expect(row(page, id)).toHaveCount(0);
    expect((await prefsOf(page)).customModes).toEqual([]);
  });

  test('deleting the ACTIVE mode falls back to General, and legacy agrees', async ({ page }) => {
    await openWeb(page);
    await openModes(page);
    await createMode(page, 'Teacher', '', 'x');
    const id = (await prefsOf(page)).customModes[0].id as string;

    // Make it the active mode through legacy's own composer menu (the picker is P5).
    await openApp(page);
    await page.locator('#main-mode-btn').click();
    await page.locator(`#mode-list button[data-mode="${id}"]`).click();
    await expect.poll(async () => (await prefsOf(page)).mode).toBe(id);

    await openWeb(page);
    await openModes(page);
    await expect(row(page, id)).toContainText('Active');
    await row(page, id).getByRole('button', { name: /Teacher/ }).first().click();
    await modal(page).getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete mode' }).click();
    await expect.poll(async () => (await prefsOf(page)).mode).toBe('general');
    await expect(row(page, 'general')).toContainText('Active');

    await openApp(page);
    await expect(page.locator('#main-mode-btn .mode-label')).toHaveText('General');
  });
});

test.describe('modes made in legacy', () => {
  test('a custom mode and a built-in edit made in legacy appear in /web/', async ({ page }) => {
    await openApp(page);
    await page.locator('#main-mode-btn').click();
    await page.locator('#mode-manage').click();
    await page.locator('#modes-new').click();
    await page.locator('.mode-name').fill('Legacy mode');
    await page.locator('.mode-instr').fill('From legacy.');
    await page.locator('[data-act="save"]').click();
    await expect.poll(async () => ((await prefsOf(page)).customModes ?? []).length).toBe(1);

    await openWeb(page);
    await openModes(page);
    await expect(modal(page).getByText('Legacy mode')).toBeVisible();
    await expect(modal(page).getByText('Custom')).toBeVisible();
  });
});
