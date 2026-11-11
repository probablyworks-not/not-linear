import { test, expect, type Page } from '@playwright/test';

// P6b: the BlockNote Notes editor in /web/. The properties that matter are data safety ones: a
// note opens without changing, editing is locked until a server-confirmed backup exists, an edit
// rewrites only the block that was edited, and everything the editor does not own stays put.
// `/__notlinear_backup_notes` is mocked: the real one writes into ~/.notlinear/backups (BUGS #053).

const ANCHORED = 'before <span class="nt-br-anchor" data-bid="nb_1">quoted words</span> after\n\nline two';
const NOTES = [
  {
    id: 'n1', emoji: '📄', title: 'Plan', tags: [], parent: null, updatedAt: 1000, createdAt: 1000,
    blocks: [
      { id: 'b1', type: 'text', text: ANCHORED },
      { id: 'b2', type: 'text', text: 'second block' },
    ],
    branches: [{ bid: 'nb_1', quote: 'quoted words', blockId: 'b1', messages: [{ role: 'user', content: 'why?' }], createdAt: 1, touchedAt: 1 }],
  },
  { id: 'n2', emoji: '📄', title: 'Other', tags: [], parent: null, updatedAt: 500, blocks: [{ id: 'o1', type: 'text', text: 'untouched' }] },
];

async function seed(page: Page): Promise<void> {
  await page.addInitScript((notes) => {
    if (localStorage.getItem('e2e_seeded')) return;
    localStorage.setItem('e2e_seeded', '1');
    const open = indexedDB.open('notlinear-notes', 1);
    open.onupgradeneeded = () => { open.result.createObjectStore('kv', { keyPath: 'key' }); };
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('kv', 'readwrite');
      const kv = tx.objectStore('kv');
      kv.put({ key: 'nl_notes_v1', value: notes });
      kv.put({ key: 'nl_notes_selected_v1', value: 'n1' });
      kv.put({ key: 'nl_notes_open_v1', value: ['n1'] });
      tx.oncomplete = () => db.close();
    };
  }, NOTES);
}

async function readRows(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => new Promise<Record<string, unknown>>((resolve, reject) => {
    const open = indexedDB.open('notlinear-notes');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const all = db.transaction('kv', 'readonly').objectStore('kv').getAll();
      all.onsuccess = () => {
        db.close();
        resolve(Object.fromEntries((all.result as { key: string; value: unknown }[]).map(r => [r.key, r.value])));
      };
    };
  }));
}

interface Mock { calls: unknown[] }
async function mockBackup(page: Page, reply: object = { ok: true, path: '/Users/test/.notlinear/backups/b.json', bytes: 1234 }): Promise<Mock> {
  const mock: Mock = { calls: [] };
  await page.route('**/__notlinear_backup_notes', async route => {
    mock.calls.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reply) });
  });
  return mock;
}

async function openNote1(page: Page): Promise<void> {
  await page.goto('/web/');
  await page.getByRole('button', { name: 'Open left pane' }).click();
  // The row itself has no click handler (drag only), so clicking it only works when the click
  // point happens to land on the name button. Buttons in a row are [0] expand, [1] the name.
  await page.locator('aside[aria-label="Left pane"] [data-note="n1"] button').nth(1).click();
  await expect(page.getByTestId('note-page')).toBeVisible();
}

const editorOf = (page: Page) => page.locator('.bn-editor');

test('a note opens in the editor with its branch anchor intact, and editing is locked until backed up', async ({ page }) => {
  await seed(page);
  await mockBackup(page);
  await openNote1(page);

  await expect(page.getByLabel('Note title')).toHaveValue('Plan');
  const anchor = editorOf(page).locator('.nt-br-anchor[data-bid="nb_1"]');
  await expect(anchor).toHaveText('quoted words');
  await expect(page.getByTestId('backup-notice')).toBeVisible();
  await expect(page.getByLabel('Note title')).toBeDisabled();
  await expect(editorOf(page).locator('[contenteditable="true"]')).toHaveCount(0);

  const rows = await readRows(page);
  expect((rows.nl_notes_v1 as { id: string; blocks: unknown[] }[])[0]!.blocks).toEqual(NOTES[0]!.blocks);
});

test('a failed backup keeps Notes locked and says so', async ({ page }) => {
  await seed(page);
  await mockBackup(page, { ok: false, error: 'disk full' });
  await openNote1(page);
  await page.getByRole('button', { name: 'Back up notes' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'disk full' })).toBeVisible();
  await expect(page.getByTestId('backup-notice')).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('nl_notes_v2_backed_up'))).toBeNull();
});

test('backing up sends the whole database, then unlocks editing', async ({ page }) => {
  await seed(page);
  const mock = await mockBackup(page);
  await openNote1(page);
  await page.getByRole('button', { name: 'Back up notes' }).click();
  await expect(page.getByTestId('backup-notice')).toBeHidden();
  await expect(page.getByLabel('Note title')).toBeEnabled();

  const sent = mock.calls[0] as { backup: { format: string; databases: Record<string, { stores: { kv: { records: { key: string }[] } } }> } };
  expect(sent.backup.format).toBe('notlinear-backup/v1');
  expect(sent.backup.databases['notlinear-notes']!.stores.kv.records.map(r => r.key).sort())
    .toEqual(['nl_notes_open_v1', 'nl_notes_selected_v1', 'nl_notes_v1']);
  expect(await page.evaluate(() => localStorage.getItem('nl_notes_v2_backed_up'))).toContain('/Users/test/.notlinear/backups/b.json');
});

test('editing one block rewrites only that block; the anchor, its branch and other notes are untouched', async ({ page }) => {
  await seed(page);
  await mockBackup(page);
  await openNote1(page);
  await page.getByRole('button', { name: 'Back up notes' }).click();
  await expect(page.getByLabel('Note title')).toBeEnabled();

  const second = editorOf(page).locator('.bn-block-content', { hasText: 'second block' });
  await second.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' plus more');

  await expect.poll(async () => {
    const notes = (await readRows(page)).nl_notes_v1 as { id: string; blocks: { id: string; text: string }[] }[];
    return notes[0]!.blocks.find(b => b.id === 'b2')?.text;
  }).toBe('second block plus more');

  const rows = await readRows(page);
  const notes = rows.nl_notes_v1 as { id: string; blocks: unknown[]; branches: unknown[]; updatedAt: number }[];
  expect(notes[0]!.blocks[0]).toEqual(NOTES[0]!.blocks[0]); // byte-identical, literal newlines and all
  expect(notes[0]!.branches).toEqual(NOTES[0]!.branches);
  expect(notes[0]!.updatedAt).toBeGreaterThan(1000);
  expect(notes[1]).toEqual(NOTES[1]);
  expect(rows.nl_notes_selected_v1).toBe('n1');
  expect(rows.nl_notes_open_v1).toEqual(['n1']);
});

test('renaming writes the title and the tab and breadcrumb follow', async ({ page }) => {
  await seed(page);
  await mockBackup(page);
  await openNote1(page);
  await page.getByRole('button', { name: 'Back up notes' }).click();
  await page.getByLabel('Note title').fill('Renamed plan');
  await expect.poll(async () => ((await readRows(page)).nl_notes_v1 as { title: string }[])[0]!.title).toBe('Renamed plan');
  await expect(page.getByRole('tab', { name: /Renamed plan/ })).toBeVisible();
});

test('opening a note and leaving it writes nothing', async ({ page }) => {
  await seed(page);
  await mockBackup(page);
  await openNote1(page);
  await page.getByRole('button', { name: 'Back up notes' }).click();
  await expect(page.getByLabel('Note title')).toBeEnabled();
  await page.waitForTimeout(600);
  const notes = (await readRows(page)).nl_notes_v1 as unknown[];
  expect(notes).toEqual(NOTES);
});

test('the Notes index lists pages and opens one', async ({ page }) => {
  await seed(page);
  await page.goto('/web/');
  await page.getByRole('button', { name: 'Open left pane' }).click();
  await page.getByRole('button', { name: 'All notes', exact: true }).click();
  await expect(page.getByTestId('notes-index')).toContainText('2 pages');
  await page.locator('[data-note-card="n2"]').click();
  await expect(page.getByLabel('Note title')).toHaveValue('Other');
});

test('the editor follows the app theme, not the OS colour scheme', async ({ page }) => {
  for (const [os, app, dark] of [['dark', 'light', false], ['light', 'dark', true]] as const) {
    const p = await page.context().newPage();
    await p.emulateMedia({ colorScheme: os });
    await p.addInitScript((theme) => { localStorage.setItem('nl_theme', theme); }, app);
    await seed(p);
    await p.goto('/web/');
    await p.getByRole('button', { name: 'Open left pane' }).click();
    await p.locator('aside[aria-label="Left pane"] [data-note="n1"] button').nth(1).click();
    await expect(p.locator('.bn-container')).toHaveClass(dark ? /\bdark\b/ : /\blight\b/);
    // No painted box behind the text: the editor is transparent on the page background.
    await expect(p.locator('.bn-editor')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await p.close();
  }
  await expect(page.locator('body')).toBeVisible();
});

test('the page-bottom placeholder is real text, not an escape sequence', async ({ page }) => {
  await seed(page);
  await mockBackup(page);
  await openNote1(page);
  await page.getByRole('button', { name: 'Back up notes' }).click();
  await expect(page.getByLabel('Ask AI about this note')).toHaveAttribute('placeholder', 'Ask AI about this note…');
});

test('⌘Z undoes, ⇧⌘Z and ⌘Y both redo, inside the editor', async ({ page }) => {
  await seed(page);
  await mockBackup(page);
  await openNote1(page);
  await page.getByRole('button', { name: 'Back up notes' }).click();
  await expect(page.getByLabel('Note title')).toBeEnabled();

  const second = editorOf(page).locator('.bn-block-content', { hasText: 'second block' });
  await second.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' plus more');
  await expect(second).toHaveText('second block plus more');

  await page.keyboard.press('ControlOrMeta+z');
  await expect(second).toHaveText('second block');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(second).toHaveText('second block plus more');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(second).toHaveText('second block');
  await page.keyboard.press('ControlOrMeta+y');
  await expect(second).toHaveText('second block plus more');
});
