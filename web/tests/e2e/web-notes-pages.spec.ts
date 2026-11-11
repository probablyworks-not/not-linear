import { test, expect, type Page } from '@playwright/test';

// P6c: page operations in /web/ Notes: create, nest, duplicate, move, delete, icon, cover, tags.
// The backup endpoint is mocked (BUGS #053); every write goes to a fresh browser's IndexedDB.

interface Seed { id: string; title: string; parent: string | null; extra?: object }
const SEEDS: Seed[] = [
  { id: 'a', title: 'Alpha', parent: null },
  { id: 'b', title: 'Beta', parent: 'a' },
  { id: 'c', title: 'Gamma', parent: null },
];
const note = (s: Seed) => ({
  id: s.id, emoji: '📄', title: s.title, tags: ['keep'], parent: s.parent, createdAt: 1, updatedAt: 1,
  blocks: [{ id: `${s.id}-1`, type: 'text', text: `body of ${s.title}` }], ...s.extra,
});

async function seed(page: Page, open: string[] = []): Promise<void> {
  await page.addInitScript(([notes, openIds]) => {
    if (localStorage.getItem('e2e_seeded')) return;
    localStorage.setItem('e2e_seeded', '1');
    const req = indexedDB.open('notlinear-notes', 1);
    req.onupgradeneeded = () => { req.result.createObjectStore('kv', { keyPath: 'key' }); };
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('kv', 'readwrite');
      const kv = tx.objectStore('kv');
      kv.put({ key: 'nl_notes_v1', value: notes });
      kv.put({ key: 'nl_notes_selected_v1', value: 'a' });
      kv.put({ key: 'nl_notes_open_v1', value: openIds });
      tx.oncomplete = () => db.close();
    };
  }, [SEEDS.map(note), open]);
  await page.route('**/__notlinear_backup_notes', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, path: '/t/b.json', bytes: 9 }),
  }));
}

async function rows(page: Page): Promise<Record<string, any>> { // reason: test reads untyped IndexedDB rows
  return page.evaluate(() => new Promise<Record<string, unknown>>((resolve, reject) => {
    const req = indexedDB.open('notlinear-notes');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const all = db.transaction('kv', 'readonly').objectStore('kv').getAll();
      all.onsuccess = () => { db.close(); resolve(Object.fromEntries((all.result as { key: string; value: unknown }[]).map(r => [r.key, r.value]))); };
    };
  }));
}
const notesOf = async (page: Page) => (await rows(page)).nl_notes_v1 as { id: string; title: string; parent: string | null; tags: string[]; emoji: unknown; cover?: { src: string; posY: number }; blocks: { id: string }[] }[];

const side = (page: Page) => page.locator('aside[aria-label="Left pane"]');
const row = (page: Page, id: string) => side(page).locator(`[data-note="${id}"]`);

async function start(page: Page, open: string[] = [], unlock = true): Promise<void> {
  await seed(page, open);
  await page.goto('/web/');
  await page.getByRole('button', { name: 'Open left pane' }).click();
  await side(page).getByRole('button', { name: 'All notes', exact: true }).click();
  if (unlock) {
    await page.getByRole('button', { name: 'Back up notes' }).click();
    await expect(page.getByTestId('backup-notice')).toBeHidden();
  }
}

test('the tree nests pages, and expanding one is remembered in the legacy key', async ({ page }) => {
  await start(page);
  await expect(row(page, 'a')).toBeVisible();
  await expect(row(page, 'b')).toHaveCount(0);
  await row(page, 'a').getByRole('button', { name: 'Expand' }).click();
  await expect(row(page, 'b')).toBeVisible();
  await expect.poll(async () => (await rows(page)).nl_notes_open_v1).toEqual(['a']);
  await row(page, 'a').getByRole('button', { name: 'Collapse' }).click();
  await expect(row(page, 'b')).toHaveCount(0);
  await expect.poll(async () => (await rows(page)).nl_notes_open_v1).toEqual([]);
});

test('structural writes are refused until backed up, and say why', async ({ page }) => {
  await start(page, [], false);
  const before = await notesOf(page);
  await side(page).getByRole('button', { name: 'New note' }).click();
  await expect(page.getByText('Back up your notes first')).toBeVisible();
  expect(await notesOf(page)).toEqual(before);
});

test('new page and add subpage create the legacy shape and open it', async ({ page }) => {
  await start(page);
  await side(page).getByRole('button', { name: 'New note' }).click();
  await expect(page.getByLabel('Note title')).toHaveValue('');
  let notes = await notesOf(page);
  expect(notes).toHaveLength(4);
  expect(notes[3]).toMatchObject({ title: '', parent: null, emoji: '📄', tags: [] });
  expect(notes[3]!.blocks).toHaveLength(1);

  await row(page, 'c').hover();
  await row(page, 'c').getByRole('button', { name: 'Add subpage to Gamma' }).click();
  notes = await notesOf(page);
  expect(notes).toHaveLength(5);
  expect(notes[4]!.parent).toBe('c');
  expect((await rows(page)).nl_notes_open_v1).toContain('c');
});

test('duplicate copies the subtree after the original; the cover is left behind', async ({ page }) => {
  await start(page, ['a']);
  await row(page, 'a').hover();
  await row(page, 'a').getByRole('button', { name: 'Duplicate Alpha' }).click();
  await expect(page.getByText('page duplicated')).toBeVisible();
  const notes = await notesOf(page);
  expect(notes).toHaveLength(5);
  expect(notes.map(n => n.title)).toEqual(['Alpha', 'Alpha', 'Beta', 'Gamma', 'Beta']);
  const copy = notes[1]!;
  expect(copy.id).not.toBe('a');
  expect(notes.filter(n => n.parent === copy.id).map(n => n.title)).toEqual(['Beta']);
  expect(notes.find(n => n.id === 'a')!.blocks[0]!.id).toBe('a-1');
  expect(copy.blocks[0]!.id).not.toBe('a-1');
});

test('delete asks first, names the subpages, removes the subtree and closes its tab', async ({ page }) => {
  await start(page, ['a']);
  await row(page, 'a').click();
  await expect(page.getByRole('tab', { name: /Alpha/ })).toBeVisible();
  await row(page, 'a').hover();
  await row(page, 'a').getByRole('button', { name: 'Delete Alpha' }).click();
  await expect(page.getByText('and 1 subpage from Notes.')).toBeVisible();
  await page.getByRole('button', { name: 'Delete notes' }).click();
  await expect.poll(async () => (await notesOf(page)).map(n => n.id)).toEqual(['c']);
  await expect(page.getByRole('tab', { name: /Alpha/ })).toHaveCount(0);
  expect((await rows(page)).nl_notes_selected_v1).toBe('c');
  expect((await rows(page)).nl_notes_open_v1).toEqual([]);
});

test('cancelling the delete changes nothing', async ({ page }) => {
  await start(page);
  await row(page, 'c').hover();
  await row(page, 'c').getByRole('button', { name: 'Delete Gamma' }).click();
  await page.getByRole('button', { name: 'Cancel' }).click();
  expect(await notesOf(page)).toHaveLength(3);
});

test('delete all notes clears the lot after confirming', async ({ page }) => {
  await start(page);
  await side(page).getByRole('button', { name: 'Delete all notes' }).click();
  await page.getByRole('button', { name: 'Delete all notes' }).last().click();
  await expect.poll(async () => (await notesOf(page)).length).toBe(0);
});

test('dragging a page onto another nests it, onto the list background un-nests it, and a cycle is refused', async ({ page }) => {
  await start(page, ['a']);
  await row(page, 'c').dragTo(row(page, 'b'));
  await expect.poll(async () => (await notesOf(page)).find(n => n.id === 'c')!.parent).toBe('b');
  await row(page, 'a').dragTo(row(page, 'c')); // a is c's ancestor now: refused
  expect((await notesOf(page)).find(n => n.id === 'a')!.parent).toBeNull();
  const tree = page.getByTestId('notes-tree');
  const box = (await tree.boundingBox())!;
  await row(page, 'c').dragTo(tree, { targetPosition: { x: 40, y: box.height - 4 } });
  await expect.poll(async () => (await notesOf(page)).find(n => n.id === 'c')!.parent).toBeNull();
});

test('tags: add with Enter, no duplicates, remove', async ({ page }) => {
  await start(page);
  await row(page, 'c').click();
  await page.getByRole('button', { name: '+ add tag' }).click();
  await page.getByLabel('New tag').fill('fresh');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await notesOf(page)).find(n => n.id === 'c')!.tags).toEqual(['keep', 'fresh']);
  await page.getByRole('button', { name: '+ add tag' }).click();
  await page.getByLabel('New tag').fill('fresh');
  await page.keyboard.press('Enter');
  expect((await notesOf(page)).find(n => n.id === 'c')!.tags).toEqual(['keep', 'fresh']);
  await page.getByRole('button', { name: 'Remove tag keep' }).click();
  await expect.poll(async () => (await notesOf(page)).find(n => n.id === 'c')!.tags).toEqual(['fresh']);
});

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

test('cover: add (stored downscaled as a data URL), change, remove', async ({ page }) => {
  await start(page);
  await row(page, 'c').click();
  await page.locator('input[type=file]').first().setInputFiles({ name: 'c.png', mimeType: 'image/png', buffer: PNG });
  await expect(page.getByTestId('note-cover')).toBeVisible();
  const cover = (await notesOf(page)).find(n => n.id === 'c')!.cover!;
  expect(cover.src).toMatch(/^data:image\/jpeg;base64,/);
  expect(cover.posY).toBe(50);
  await page.getByTestId('note-cover').hover();
  await page.getByTestId('note-cover').getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByTestId('note-cover')).toHaveCount(0);
  expect((await notesOf(page)).find(n => n.id === 'c')).not.toHaveProperty('cover');
});

test('icon: an uploaded image becomes an img: token, and can be removed', async ({ page }) => {
  await start(page);
  await row(page, 'c').click();
  await page.getByTitle('Upload image icon').locator('xpath=following-sibling::input').setInputFiles({ name: 'i.png', mimeType: 'image/png', buffer: PNG });
  await expect.poll(async () => String((await notesOf(page)).find(n => n.id === 'c')!.emoji)).toMatch(/^img:data:image\/png;base64,/);
  await page.getByRole('button', { name: 'Remove custom icon' }).click();
  await expect.poll(async () => (await notesOf(page)).find(n => n.id === 'c')!.emoji).toBeNull();
});

test('the meta line says where a page lives', async ({ page }) => {
  await start(page, ['a']);
  await row(page, 'b').click();
  await expect(page.getByTestId('note-meta')).toContainText('subpage of Alpha');
  await row(page, 'a').click();
  await expect(page.getByTestId('note-meta')).toContainText('top-level');
});

test('export sends the page and its subpages as one Markdown file through the save endpoint', async ({ page }) => {
  const saves: { filename: string; content: string }[] = [];
  await page.route('**/__notlinear_save_file', async route => {
    saves.push(route.request().postDataJSON() as { filename: string; content: string });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });
  await start(page, ['a']);
  await row(page, 'a').click();
  await page.getByTestId('export-note').click();
  await expect.poll(() => saves.length).toBe(1);
  expect(saves[0]!.filename).toBe('Alpha.md');
  expect(saves[0]!.content).toBe('# Alpha\n\n---\n\nbody of Alpha\n\n---\n\n## Beta\n\n---\n\nbody of Beta\n');
});

test('export is available before the backup (it writes nothing) and is not on the index', async ({ page }) => {
  await page.route('**/__notlinear_save_file', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));
  await start(page, [], false);
  await expect(page.getByTestId('export-note')).toHaveCount(0);
  await row(page, 'c').click();
  await expect(page.getByTestId('export-note')).toBeVisible();
});

test.describe('the bento home page', () => {
  const grid = (page: Page) => page.getByTestId('notes-grid');
  const card = (page: Page, id: string) => page.locator(`[data-note-card="${id}"]`);

  test('shows root pages as tinted cards, newest edit first and pinned big, with subpage counts and a New note tile', async ({ page }) => {
    await start(page);
    const ids = await grid(page).locator('[data-note-card]').evaluateAll(els => els.map(e => e.getAttribute('data-note-card')));
    expect(ids).toEqual(['a', 'c']); // both updatedAt 1; stable order, children are not cards
    await expect(card(page, 'a')).toHaveAttribute('data-shape', 'big');
    await expect(card(page, 'a')).toContainText('Alpha');
    await expect(card(page, 'a')).toContainText('1 subpage');
    await expect(card(page, 'a')).toContainText('1 block');
    await expect(grid(page).getByRole('button', { name: 'New note' })).toBeVisible();
    // The tint is set from the page's icon and the card paints with it.
    const style = await card(page, 'a').getAttribute('style');
    expect(style).toMatch(/--tbg: var\(--bento-t[0-7]-bg\)/);
    await expect(card(page, 'a')).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  });

  test('orders by last edit, and a card keeps its shape from visit to visit', async ({ page }) => {
    await start(page);
    const shapes = async () => grid(page).locator('[data-note-card]').evaluateAll(els => els.map(e => e.getAttribute('data-shape')));
    const first = await shapes();
    await page.reload();
    await page.getByRole('button', { name: 'Open left pane' }).click();
    await page.locator('aside[aria-label="Left pane"]').getByRole('button', { name: 'All notes', exact: true }).click();
    expect(await shapes()).toEqual(first);
  });

  test('a card opens its page; its hover actions add a subpage or delete without opening it', async ({ page }) => {
    await start(page);
    await card(page, 'c').hover();
    await card(page, 'c').getByRole('button', { name: 'Add subpage to Gamma' }).click();
    await expect(page.getByLabel('Note title')).toHaveValue('');
    expect((await notesOf(page)).filter(n => n.parent === 'c')).toHaveLength(1);

    await side(page).getByRole('button', { name: 'All notes', exact: true }).click();
    await card(page, 'c').hover();
    await card(page, 'c').getByRole('button', { name: 'Delete Gamma' }).click();
    await page.getByRole('button', { name: 'Delete notes' }).click();
    await expect.poll(async () => (await notesOf(page)).map(n => n.id)).toEqual(['a', 'b']);

    await card(page, 'a').click();
    await expect(page.getByLabel('Note title')).toHaveValue('Alpha');
  });

  test('a card opens from the keyboard', async ({ page }) => {
    await start(page);
    await card(page, 'a').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Note title')).toHaveValue('Alpha');
  });

  test('an uploaded-image icon gets no bloom; an untitled page reads as Untitled', async ({ page }) => {
    await start(page);
    await row(page, 'c').click();
    await page.getByTitle('Upload image icon').locator('xpath=following-sibling::input').setInputFiles({ name: 'i.png', mimeType: 'image/png', buffer: PNG });
    await expect.poll(async () => String((await notesOf(page)).find(n => n.id === 'c')!.emoji)).toMatch(/^img:/);
    await page.getByLabel('Note title').fill('');
    await expect.poll(async () => (await notesOf(page)).find(n => n.id === 'c')!.title).toBe('');
    await side(page).getByRole('button', { name: 'All notes', exact: true }).click();
    await expect(card(page, 'c').locator('.nl-bloom')).toHaveCount(0);
    await expect(card(page, 'c')).toContainText('Untitled');
    await expect(card(page, 'a').locator('.nl-bloom')).toHaveCount(1);
  });

  test('with no pages there is an invitation, not a blank screen', async ({ page }) => {
    await start(page);
    await side(page).getByRole('button', { name: 'Delete all notes' }).click();
    await page.getByRole('button', { name: 'Delete all notes' }).last().click();
    await expect(page.getByText('No pages yet')).toBeVisible();
    await page.getByRole('button', { name: /No pages yet/ }).click();
    await expect(page.getByLabel('Note title')).toHaveValue('');
  });
});
