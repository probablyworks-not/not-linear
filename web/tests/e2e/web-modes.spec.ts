import { test, expect, type Page } from '@playwright/test';
import { openSettings, readPersistedState } from './helpers';

// Settings -> Modes (master/detail). Saving is explicit (Save / Create), as it always was.

const item = (page: Page, id: string) => page.locator(`[data-mode="${id}"]`);
const editor = (page: Page) => page.getByRole('tabpanel');
const prefsOf = async (page: Page) => ((await readPersistedState(page)) as { prefs: Record<string, any> } | null)?.prefs ?? {}; // eslint-disable-line @typescript-eslint/no-explicit-any -- test-only read of an untyped row

async function createMode(page: Page, name: string, desc: string, instr: string): Promise<string> {
  await page.getByRole('button', { name: 'New mode' }).first().click();
  await editor(page).getByLabel('Name').fill(name);
  await editor(page).getByLabel('Short description').fill(desc);
  await editor(page).getByLabel('Instructions').fill(instr);
  await editor(page).getByRole('button', { name: 'Create' }).click();
  await expect(page.getByText(`Created "${name}"`)).toBeVisible();
  return (await prefsOf(page)).customModes.at(-1).id as string;
}

test.describe('Modes tab', () => {
  test('lists the six built-ins, marks General active, and shows the helper text', async ({ page }) => {
    await openSettings(page, 'Modes');
    for (const [id, label] of [['general', 'General'], ['research', 'Research'], ['coding', 'Coding'], ['pm', 'PM'], ['cto', 'CTO'], ['critic', 'Critic']]) {
      await expect(item(page, id!)).toContainText(label!);
    }
    await expect(item(page, 'general')).toContainText('Active');
    await expect(item(page, 'research')).not.toContainText('Active');
    await expect(page.getByText('Added to the system prompt for every chat in this mode.')).toBeVisible();
    await expect(page.getByText('Built-in modes can be edited but not deleted.')).toBeVisible();
  });

  test('the composer\'s "New / manage modes" opens this tab', async ({ page }) => {
    await page.goto('/web/');
    await page.getByRole('button', { name: 'Open left pane' }).click();
    await page.getByRole('button', { name: /New chat/ }).click();
    await page.getByRole('button', { name: /mode/i }).filter({ hasText: /General/ }).first().click();
    await page.getByRole('menuitem', { name: /New \/ manage modes/ }).click();
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
    await expect(page.getByRole('tab', { name: /^Modes/ })).toHaveAttribute('aria-selected', 'true');
  });
});

test.describe('create, edit, reset, delete', () => {
  test('creating a mode persists it, selects it, and bumps the rail count', async ({ page }) => {
    await openSettings(page, 'Modes');
    const id = await createMode(page, 'Teacher', 'Explains simply', 'Teach like I am new.\n\nUse examples.');
    expect(id).toMatch(/^custom-/);
    await expect(item(page, id)).toContainText('Teacher');
    await expect(item(page, id)).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('count-modes')).toHaveText('7');
    expect((await prefsOf(page)).customModes).toEqual([{ id, label: 'Teacher', desc: 'Explains simply', instructions: 'Teach like I am new.\n\nUse examples.' }]);
  });

  test('an empty name is refused and nothing is saved; Cancel discards the draft', async ({ page }) => {
    await openSettings(page, 'Modes');
    await page.getByRole('button', { name: 'New mode' }).first().click();
    await editor(page).getByRole('button', { name: 'Create' }).click();
    await expect(page.getByText('Give the mode a name')).toBeVisible();
    expect((await prefsOf(page)).customModes).toBeUndefined();
    await editor(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(item(page, '__new__')).toHaveCount(0);
  });

  test('field limits (name 30, description 50)', async ({ page }) => {
    await openSettings(page, 'Modes');
    await page.getByRole('button', { name: 'New mode' }).first().click();
    await expect(editor(page).getByLabel('Name')).toHaveAttribute('maxlength', '30');
    await expect(editor(page).getByLabel('Short description')).toHaveAttribute('maxlength', '50');
  });

  test('editing a built-in stores only what differs; Reset to default removes it. Save is disabled until something changes', async ({ page }) => {
    await openSettings(page, 'Modes');
    await item(page, 'coding').click();
    await expect(editor(page).getByRole('button', { name: 'Save' })).toBeDisabled();
    await editor(page).getByLabel('Short description').fill('Terse and exact');
    await editor(page).getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Saved "Coding"')).toBeVisible();
    expect((await prefsOf(page)).modeOverrides).toEqual({ coding: { desc: 'Terse and exact' } });

    await editor(page).getByRole('button', { name: 'Reset to default' }).click();
    await expect(page.getByText('Reset to default', { exact: true })).toBeVisible();
    expect((await prefsOf(page)).modeOverrides).toEqual({});
  });

  test('delete asks with the legacy wording; Esc keeps the mode; confirming removes it and selects another', async ({ page }) => {
    await openSettings(page, 'Modes');
    const id = await createMode(page, 'Teacher', '', 'x');
    await editor(page).getByRole('button', { name: 'Delete', exact: true }).click();
    const confirm = page.getByRole('alertdialog');
    await expect(confirm.getByRole('heading')).toHaveText('Delete mode?');
    await expect(confirm).toContainText('This removes the mode "Teacher". Chats using it fall back to General.');
    await page.keyboard.press('Escape'); // the confirm outranks the Settings page in the Esc chain
    await expect(confirm).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
    await expect(item(page, id)).toBeVisible();

    await editor(page).getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete mode' }).click();
    await expect(page.getByText('Mode deleted')).toBeVisible();
    await expect(item(page, id)).toHaveCount(0);
    await expect(editor(page).getByLabel('Name')).toHaveValue('General'); // falls back to the first mode, not a blank panel
    expect((await prefsOf(page)).customModes).toEqual([]);
  });

  test('a built-in has no Delete', async ({ page }) => {
    await openSettings(page, 'Modes');
    await item(page, 'critic').click();
    await expect(editor(page).getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0);
  });
});
