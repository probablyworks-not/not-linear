import { test, expect, type Page } from '@playwright/test';
import { openSidebar } from './helpers';

// Both apps read and write the one `notlinear-notes` database. What /web/ saves must open, intact, in the
// classic Notes editor: the branch anchor still reopens its branch, edited blocks show their text, and
// pages made or moved in /web/ appear in the classic tree.

const NOTES = [{
  id: 'a', emoji: '📄', title: 'Alpha', tags: ['t1'], parent: null, createdAt: 1, updatedAt: 1000,
  blocks: [
    { id: 'a-1', type: 'text', text: 'plain start' },
    { id: 'a-2', type: 'text', text: 'before <span class="nt-br-anchor" data-bid="nb_1">anchored words</span> after\n\nline two' },
    { id: 'a-3', type: 'todo', text: 'a todo', done: true },
  ],
  branches: [{ bid: 'nb_1', quote: 'anchored words', blockId: 'a-2', messages: [{ role: 'user', content: 'why?' }, { role: 'assistant', content: 'because' }], createdAt: 1, touchedAt: 1 }],
}];

async function seed(page: Page): Promise<void> {
  await page.addInitScript((notes) => {
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
      kv.put({ key: 'nl_notes_open_v1', value: [] });
      tx.oncomplete = () => db.close();
    };
  }, NOTES);
  await page.route('**/__notlinear_backup_notes', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, path: '/t/b.json', bytes: 9 }),
  }));
}

test('what /web/ saves opens in the classic Notes editor with the anchor and branch intact', async ({ page }) => {
  await seed(page);
  await page.goto('/web/');
  await page.getByRole('button', { name: 'Open left pane' }).click();
  await page.locator('aside[aria-label="Left pane"] [data-note="a"]').click();
  await page.getByRole('button', { name: 'Back up notes' }).click();
  await expect(page.getByLabel('Note title')).toBeEnabled();

  // Edit one block, add a callout and a toggle, add a tag and a subpage: a spread of what /web/ writes.
  const first = page.locator('.bn-block-content', { hasText: 'plain start' });
  await first.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' edited in web');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/Callout');
  await page.locator('.bn-suggestion-menu').getByText('Callout', { exact: true }).first().click();
  await page.keyboard.type('a callout from web');
  await page.getByRole('button', { name: '+ add tag' }).click();
  await page.getByLabel('New tag').fill('fromweb');
  await page.keyboard.press('Enter');
  await page.locator('aside[aria-label="Left pane"] [data-note="a"]').hover();
  await page.getByRole('button', { name: 'Add subpage to Alpha' }).click();
  await expect(page.getByLabel('Note title')).toHaveValue(''); // the new, untitled subpage has opened
  await page.getByLabel('Note title').fill('Sub from web');

  await expect.poll(async () => page.evaluate(() => new Promise<boolean>((resolve) => {
    const req = indexedDB.open('notlinear-notes');
    req.onsuccess = () => {
      const g = req.result.transaction('kv').objectStore('kv').get('nl_notes_v1');
      g.onsuccess = () => {
        req.result.close();
        const notes = (g.result as { value: { id: string; title: string; blocks: { type: string; text?: string }[] }[] }).value;
        const a = notes.find(n => n.id === 'a')!;
        resolve(a.blocks.some(b => b.type === 'callout' && b.text === 'a callout from web') && notes.some(n => n.title === 'Sub from web'));
      };
    };
  }))).toBe(true);

  // Now the classic app, same origin, same database.
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/frontend/index.html');
  await page.waitForSelector('.sidebar [data-thread]', { state: 'attached' });
  await openSidebar(page);
  await page.locator('#nt-side-tree .nt-nrow', { hasText: 'Alpha' }).click();

  const pg = page.locator('#nt-page');
  await expect(pg.locator('.pg-title')).toHaveText('Alpha');
  await expect(pg).toContainText('plain start edited in web');
  await expect(pg).toContainText('a callout from web');
  await expect(pg.locator('.pg-tags')).toContainText('fromweb');
  await expect(pg.locator('.pg-tags')).toContainText('t1');
  await expect(pg).toContainText('a todo');
  await expect(pg.locator('.b.done')).toHaveCount(1);

  // The anchor survived the round trip and still opens its branch with the saved conversation.
  const anchor = pg.locator('.nt-br-anchor[data-bid="nb_1"]');
  await expect(anchor).toHaveText('anchored words');
  await anchor.click();
  await expect(page.locator('#nt-branch-stack .branch')).toHaveCount(1);
  await expect(page.locator('#nt-branch-stack .branch-quote')).toContainText('anchored words');
  await expect(page.locator('#nt-branch-stack .msg.user')).toHaveText('why?');

  // The subpage made in /web/ is in the classic tree under its parent.
  await expect(page.locator('#nt-side-tree')).toContainText('Sub from web');
  expect(errors).toEqual([]);
});
