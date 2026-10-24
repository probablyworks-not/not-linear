import { test, expect, type Page } from '@playwright/test';
import { readPersistedState } from './helpers';

// Chats and notes can be filed in a project after they exist, and moved between projects. One project each.
// The backup endpoint is mocked (BUGS #053); every write goes to a fresh browser's IndexedDB.

async function seed(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (localStorage.getItem('e2e_seeded')) return;
    localStorage.setItem('e2e_seeded', '1');
    const t = (title: string) => ({ kind: 'chat', title, stream: '', docContent: '<p><br></p>', highlights: [], branchSnapshots: {}, branchRecents: {} });
    const proj = (id: string, name: string) => ({ id, name, rules: '', files: [], path: '', updatedAt: Date.now() });
    const chat = indexedDB.open('notlinear', 1);
    chat.onupgradeneeded = () => { chat.result.createObjectStore('kv', { keyPath: 'key' }); };
    chat.onsuccess = () => {
      const tx = chat.result.transaction('kv', 'readwrite');
      tx.objectStore('kv').put({ key: 'state', value: {
        threads: { 'doc-main': { ...t('Main'), kind: 'doc' }, 'chat-1': t('Loose chat') },
        current: 'doc-main', dynamic: [{ id: 'chat-1', title: 'Loose chat' }], deletedThreads: [], chatCount: 2,
        projects: { p1: proj('p1', 'Research'), p2: proj('p2', 'Launch') }, projectCount: 3, prefs: {},
      } });
      tx.oncomplete = () => chat.result.close();
    };
    const nb = indexedDB.open('notlinear-notes', 1);
    nb.onupgradeneeded = () => { nb.result.createObjectStore('kv', { keyPath: 'key' }); };
    nb.onsuccess = () => {
      const tx = nb.result.transaction('kv', 'readwrite');
      const kv = tx.objectStore('kv');
      const n = (id: string, title: string) => ({ id, emoji: '📄', title, tags: [], parent: null, createdAt: 1, updatedAt: 1, blocks: [{ id: `${id}-1`, type: 'text', text: title }] });
      kv.put({ key: 'nl_notes_v1', value: [n('a', 'Loose note')] });
      kv.put({ key: 'nl_notes_selected_v1', value: 'a' });
      kv.put({ key: 'nl_notes_open_v1', value: [] });
      tx.oncomplete = () => nb.result.close();
    };
  });
  await page.route('**/__notlinear_backup_notes', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, path: '/t/b.json', bytes: 9 }),
  }));
}

const side = (p: Page) => p.locator('aside[aria-label="Left pane"]');

test('a loose note and chat can be filed in a project, moved to another, and ungrouped', async ({ page }) => {
  await seed(page);
  await page.goto('/web/');
  await page.getByRole('button', { name: 'Open left pane' }).click();
  await side(page).getByRole('button', { name: 'All notes', exact: true }).click();
  await page.getByRole('button', { name: 'Back up notes' }).click();
  await expect(page.getByTestId('backup-notice')).toBeHidden();
  if (await side(page).evaluate(el => el.className.includes('invisible'))) await page.getByRole('button', { name: 'Open left pane' }).click();

  // Chat: file in Research from the sidebar, which hides it from Threads.
  await side(page).locator('[data-thread="chat-1"]').hover();
  await side(page).getByRole('button', { name: 'Move Loose chat to a project' }).click();
  await page.locator('[data-project-option="p1"]').click();
  await expect(side(page).locator('[data-thread="chat-1"]')).toHaveCount(0);

  // Note: file in Research, which hides it from the Notes tree.
  await side(page).locator('[data-note="a"]').hover();
  await side(page).getByRole('button', { name: 'Move Loose note to a project' }).click();
  await page.locator('[data-project-option="p1"]').click();
  await expect(side(page).locator('[data-note="a"]')).toHaveCount(0);

  // Both show in the project panel.
  await side(page).locator('[data-project="p1"]').getByText('Research').click();
  const panel = page.getByRole('dialog').filter({ has: page.getByTestId('project-title') });
  await expect(panel.locator('[data-chat="chat-1"]')).toBeVisible();
  await expect(panel.locator('[data-note="a"]')).toBeVisible();

  // Move both to Launch from the panel.
  await panel.getByRole('button', { name: 'Move Loose chat to another project' }).click();
  await page.locator('[data-project-option="p2"]').click();
  await expect(panel.locator('[data-chat="chat-1"]')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Move Loose note to another project' }).click();
  await page.locator('[data-project-option="p2"]').click();
  await expect(panel.locator('[data-note="a"]')).toHaveCount(0);

  const state = (await readPersistedState(page)) as unknown as { threads: Record<string, { projectId?: string }> };
  expect(state.threads['chat-1']?.projectId).toBe('p2');
  const notes = await page.evaluate(() => new Promise<{ id: string; projectId?: string }[]>(resolve => {
    const req = indexedDB.open('notlinear-notes');
    req.onsuccess = () => {
      const get = req.result.transaction('kv').objectStore('kv').get('nl_notes_v1');
      get.onsuccess = () => { req.result.close(); resolve(get.result.value); };
    };
  }));
  expect(notes.find(n => n.id === 'a')?.projectId).toBe('p2');

  // Remove the note from the project: it returns to the Notes tree.
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'Open left pane' }).click();
  await side(page).locator('[data-project="p2"]').getByText('Launch').click();
  await panel.getByRole('button', { name: 'Remove Loose note from project' }).click();
  await panel.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'Open left pane' }).click();
  await expect(side(page).locator('[data-note="a"]')).toBeVisible();
});
