import { test, expect, type Page } from '@playwright/test';

// P6c: the blocks and menus the editor adds on top of BlockNote's own, and that each one is saved
// in the legacy block shape. Backup and link-preview endpoints are mocked (BUGS #053).

const NOTES = [
  { id: 'a', emoji: '📄', title: 'Alpha', tags: [], parent: null, createdAt: 1, updatedAt: 1, blocks: [{ id: 'a-1', type: 'text', text: '' }] },
  { id: 'o', emoji: '📄', title: 'Other page', tags: [], parent: null, createdAt: 1, updatedAt: 1, blocks: [{ id: 'o-1', type: 'text', text: 'x' }] },
];

async function open(page: Page): Promise<void> {
  await page.addInitScript((notes) => {
    if (localStorage.getItem('e2e_seeded')) return;
    localStorage.setItem('e2e_seeded', '1');
    localStorage.setItem('nl_notes_v2_backed_up', JSON.stringify({ at: 'x', path: '/p', bytes: 1 }));
    const req = indexedDB.open('notlinear-notes', 1);
    req.onupgradeneeded = () => { req.result.createObjectStore('kv', { keyPath: 'key' }); };
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put({ key: 'nl_notes_v1', value: notes });
      tx.oncomplete = () => db.close();
    };
  }, NOTES);
  await page.route('**/__notlinear_link_preview', route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ ok: true, title: 'Example Title', description: 'An example page', domain: 'example.test', favicon: '' }),
  }));
  await page.goto('/web/');
  await page.getByRole('button', { name: 'Open left pane' }).click();
  await page.locator('aside[aria-label="Left pane"] [data-note="a"] button').nth(1).click();
  await page.locator('.bn-block-content').first().click();
}

type Row = { id: string; blocks: Record<string, unknown>[] };
async function blocksOf(page: Page, id = 'a'): Promise<Record<string, unknown>[]> {
  const notes = await page.evaluate(() => new Promise<unknown>((resolve, reject) => {
    const req = indexedDB.open('notlinear-notes');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const g = db.transaction('kv', 'readonly').objectStore('kv').get('nl_notes_v1');
      g.onsuccess = () => { db.close(); resolve((g.result as { value: unknown }).value); };
    };
  }));
  return (notes as Row[]).find(n => n.id === id)!.blocks;
}

/** Chooses a slash-menu item by typing its name. */
async function slash(page: Page, name: string): Promise<void> {
  await page.keyboard.type(`/${name}`);
  await page.locator('.bn-suggestion-menu').getByText(name, { exact: true }).first().click();
}
const nonEmpty = (bs: Record<string, unknown>[]) => bs.filter(b => !(b.type === 'text' && b.text === ''));

test('the slash menu offers the legacy blocks and the custom ones, and drops what legacy lacks', async ({ page }) => {
  await open(page);
  await page.keyboard.type('/');
  const menu = page.locator('.bn-suggestion-menu');
  for (const t of ['Heading 1', 'Heading 4', 'Bullet List', 'Check List', 'Quote', 'Code Block', 'Table', 'Image', 'Toggle list', 'Toggle heading 2', 'Callout', 'Divider', '2 columns', '3 columns', 'Block equation', 'Table of contents', 'Bookmark', 'Embed', 'File', 'Video or audio', 'Page']) {
    await expect(menu.getByText(t, { exact: true }), t).toBeAttached();
  }
  for (const t of ['Emoji', 'Audio', 'Page Break', 'Heading 5']) await expect(menu.getByText(t, { exact: true }), t).toHaveCount(0);
});

test('callout and toggle are saved as legacy blocks, and a toggle remembers being open', async ({ page }) => {
  await open(page);
  await slash(page, 'Callout');
  await page.keyboard.type('mind this');
  await expect.poll(async () => nonEmpty(await blocksOf(page))).toEqual([expect.objectContaining({ type: 'callout', text: 'mind this' })]);

  await page.keyboard.press('Enter');
  await slash(page, 'Toggle list');
  await page.keyboard.type('folds');
  await page.getByRole('button', { name: 'Expand' }).click();
  await expect.poll(async () => (await blocksOf(page)).find(b => b.type === 'toggle')).toMatchObject({ text: 'folds', open: true });
});

test('a block equation renders with KaTeX and is saved as an eq block', async ({ page }) => {
  await open(page);
  await slash(page, 'Block equation');
  await page.keyboard.type('x^2 + y^2');
  await expect(page.getByTestId('eq-preview').locator('.katex')).toBeVisible();
  await expect.poll(async () => (await blocksOf(page)).find(b => b.type === 'eq')).toMatchObject({ text: 'x^2 + y^2' });
});

test('two columns are saved as a cols block with nested blocks', async ({ page }) => {
  await open(page);
  await slash(page, '2 columns');
  await page.keyboard.type('left side');
  await expect.poll(async () => (await blocksOf(page)).find(b => b.type === 'cols')).toMatchObject({
    cols: [[expect.objectContaining({ type: 'text', text: 'left side' })], [expect.objectContaining({ type: 'text' })]],
  });
});

test('divider and a table of contents that follows the headings', async ({ page }) => {
  await open(page);
  await slash(page, 'Table of contents');
  await expect(page.getByTestId('toc')).toContainText('Add a heading');
  await page.keyboard.press('Enter');
  await slash(page, 'Heading 2');
  await page.keyboard.type('Shiny heading');
  await expect(page.getByTestId('toc')).toContainText('Shiny heading');
  await expect.poll(async () => (await blocksOf(page)).map(b => b.type)).toEqual(expect.arrayContaining(['toc', 'h2']));
});

test('a bookmark takes a URL, fetches its preview and saves it in the legacy fields', async ({ page }) => {
  await open(page);
  await slash(page, 'Bookmark');
  await page.getByLabel('URL to bookmark').fill('https://example.test/page');
  await page.keyboard.press('Enter');
  await expect(page.getByText('Example Title')).toBeVisible();
  await expect.poll(async () => (await blocksOf(page)).find(b => b.type === 'bookmark')).toMatchObject({
    url: 'https://example.test/page', title: 'Example Title', description: 'An example page', domain: 'example.test',
  });
});

test('media recognises YouTube and frames only the known host; an unknown link is just a link', async ({ page }) => {
  await open(page);
  await slash(page, 'Video or audio');
  await page.getByLabel('Video or audio URL').fill('https://www.youtube.com/watch?v=abc123');
  await page.keyboard.press('Enter');
  await expect(page.locator('iframe[title="Embedded video"]')).toHaveAttribute('src', 'https://www.youtube.com/embed/abc123');
  await expect(page.locator('iframe[title="Embedded video"]')).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups');
  await expect.poll(async () => (await blocksOf(page)).find(b => b.type === 'media')).toMatchObject({ kind: 'youtube', embedSrc: 'https://www.youtube.com/embed/abc123' });
});

test('an embed of an unsupported site becomes a bookmark, as in legacy', async ({ page }) => {
  await open(page);
  await slash(page, 'Embed');
  await page.getByLabel('URL to embed').fill('https://example.test/anything');
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await blocksOf(page)).find(b => b.type === 'bookmark')).toMatchObject({ url: 'https://example.test/anything' });
});

test('a file is attached inline with its name, size and data', async ({ page }) => {
  await open(page);
  await slash(page, 'File');
  await page.getByLabel('Attach a file').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello world') });
  await expect(page.getByText('notes.txt')).toBeVisible();
  await expect.poll(async () => (await blocksOf(page)).find(b => b.type === 'file')).toMatchObject({ name: 'notes.txt', size: 11, mime: 'text/plain', src: expect.stringMatching(/^data:text\/plain/) });
});

test('@ mentions a note, saved as the legacy chip, and clicking it opens that note', async ({ page }) => {
  await open(page);
  await page.keyboard.type('see @Other');
  await page.locator('.bn-suggestion-menu').getByText('Other page', { exact: true }).click();
  await expect.poll(async () => String((await blocksOf(page))[0]!.text)).toContain('data-kind="note" data-id="o"');
  await page.locator('.nt-mention[data-id="o"]').click();
  await expect(page.getByLabel('Note title')).toHaveValue('Other page');
});

test('a page block creates its subpage on first click and links to it', async ({ page }) => {
  await open(page);
  await slash(page, 'Page');
  await page.getByTestId('page-link').click();
  await expect(page.getByLabel('Note title')).toHaveValue('');
  const notes = await page.evaluate(() => new Promise<{ id: string; parent: string | null }[]>((resolve) => {
    const req = indexedDB.open('notlinear-notes');
    req.onsuccess = () => { const g = req.result.transaction('kv').objectStore('kv').get('nl_notes_v1'); g.onsuccess = () => { req.result.close(); resolve((g.result as { value: never }).value); }; };
  }));
  const sub = notes.find(n => n.parent === 'a')!;
  expect(sub).toBeTruthy();
  expect((await blocksOf(page)).find(b => b.type === 'page-link')).toMatchObject({ target: sub.id });
});

test('the toolbar colours and highlights a selection and saves legacy markup', async ({ page }) => {
  await open(page);
  await page.keyboard.type('colour me');
  await page.keyboard.press('Shift+Home');
  await page.getByRole('button', { name: 'Colour' }).click();
  await page.getByRole('menuitem', { name: 'red', exact: true }).click();
  await expect.poll(async () => String((await blocksOf(page))[0]!.text)).toContain('<span data-color="red">');
  await page.locator('.bn-block-content').first().click();
  await page.keyboard.press('End');
  await page.keyboard.press('Shift+Home');
  await page.getByRole('button', { name: 'Colour' }).click();
  await page.getByRole('menuitem', { name: 'blue highlight', exact: true }).click();
  await expect.poll(async () => String((await blocksOf(page))[0]!.text)).toContain('<mark data-c="blue">');
});

test('the toolbar turns a selection into an inline equation, saved with its source', async ({ page }) => {
  await open(page);
  await page.keyboard.type('a^2');
  await page.keyboard.press('Shift+Home');
  await page.getByRole('button', { name: 'Equation' }).click();
  await expect(page.locator('.nt-eq-inline .katex')).toBeVisible();
  await expect.poll(async () => String((await blocksOf(page))[0]!.text)).toContain('data-tex="a^2"');
});

test('a table made from the slash menu is saved as rows of cells', async ({ page }) => {
  await open(page);
  await slash(page, 'Table');
  await page.keyboard.type('cell one');
  await expect.poll(async () => (await blocksOf(page)).find(b => b.type === 'table')).toMatchObject({ rows: expect.arrayContaining([expect.arrayContaining(['cell one'])]) });
});
