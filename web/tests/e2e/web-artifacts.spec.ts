import { test, expect, type Page } from '@playwright/test';
import { mockClaude } from './helpers';

// AI artifacts: a note saved by hand, an html block saved from a reply, versions, the viewer, and delete.

async function seed(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (localStorage.getItem('e2e_seeded')) return;
    localStorage.setItem('e2e_seeded', '1');
    localStorage.setItem('nl_notes_v2_backed_up', JSON.stringify({ at: new Date().toISOString(), path: '/t/b.json', bytes: 9 }));
    localStorage.setItem('nl_api_keys', JSON.stringify({ anthropic: 'sk-ant-TESTONLY-art-aaaaaaaa' }));
    const now = Date.now();
    const threads = {
      'doc-main': { kind: 'doc', title: 'Main', stream: '', docContent: '<p><br></p>', highlights: [], branchSnapshots: {}, branchRecents: {} },
      c1: { kind: 'chat', title: 'Landing page', stream: '', docContent: '<p><br></p>', highlights: [], branchSnapshots: {}, branchRecents: {}, projectId: 'p1', updatedAt: now, mainMessages: [] },
    };
    const open = indexedDB.open('notlinear', 1);
    open.onupgradeneeded = () => { open.result.createObjectStore('kv', { keyPath: 'key' }); };
    open.onsuccess = () => {
      const tx = open.result.transaction('kv', 'readwrite');
      tx.objectStore('kv').put({ key: 'state', value: { threads, current: 'doc-main', dynamic: [{ id: 'c1', title: 'Landing page' }], deletedThreads: [], chatCount: 2, projects: { p1: { id: 'p1', name: 'Atlas', rules: '', files: [], path: '', updatedAt: now } }, projectCount: 2, prefs: {} } });
      tx.oncomplete = () => open.result.close();
    };
    const nb = indexedDB.open('notlinear-notes', 1);
    nb.onupgradeneeded = () => { nb.result.createObjectStore('kv', { keyPath: 'key' }); };
    nb.onsuccess = () => {
      const tx = nb.result.transaction('kv', 'readwrite');
      const kv = tx.objectStore('kv');
      kv.put({ key: 'nl_notes_v1', value: [{ id: 'n1', title: 'Launch plan', emoji: null, tags: [], parent: null, createdAt: 1, updatedAt: now, projectId: 'p1', blocks: [{ id: 'n1-1', type: 'text', text: 'Ship on Friday.' }] }] });
      kv.put({ key: 'nl_notes_selected_v1', value: null });
      kv.put({ key: 'nl_notes_open_v1', value: [] });
      tx.oncomplete = () => nb.result.close();
    };
  });
}

const panel = (p: Page) => p.getByRole('dialog').filter({ has: p.getByTestId('project-title') });

async function openProject(page: Page): Promise<void> {
  await page.goto('/web/');
  await page.getByRole('button', { name: 'Open left pane' }).click();
  await page.getByRole('list', { name: 'Projects' }).getByRole('button', { name: 'Atlas' }).first().click();
  await expect(panel(page)).toBeVisible();
}

test('a note saved from its page lands in the artifacts, opens in the viewer, and deletes', async ({ page }) => {
  await seed(page);
  await openProject(page);
  await expect(panel(page).getByTestId('card-artifacts')).toContainText('Nothing generated yet');

  await panel(page).getByTestId('card-notes').locator('[data-note="n1"]').first().click();
  await page.getByTestId('save-note-artifact').click();
  await expect(page.getByText('Saved to artifacts', { exact: true })).toBeVisible();

  // Come back to the project: one artifact at v1.
  await openProject(page);
  await panel(page).getByTestId('card-artifacts').locator('[data-artifact]').first().click();
  await expect(page.locator('[data-artifact]')).toHaveCount(1);
  await expect(page.locator('[data-artifact]')).toContainText('v1');
  await expect(page.locator('[data-artifact]')).toContainText('Launch plan');
  await page.getByTestId('artifact-open').click();
  await expect(page.getByTestId('artifact-md')).toContainText('Ship on Friday.');
  await page.getByTestId('artifact-delete').click();
  await page.getByTestId('artifact-delete-confirm').click();
  await expect(page.getByTestId('artifacts-view')).toContainText('Nothing generated yet');
});

test('an html reply becomes a file card: auto-saved, previewable, downloadable', async ({ page }) => {
  await mockClaude(page, 'Here you go:\n```html\n<title>Hello page</title><h1>Hello</h1>\n```\nDone.');
  await seed(page);
  // The save ladder's first browser step is the local server's dialog; catch it to see the download.
  const saved: Array<{ filename: string; content: string }> = [];
  await page.route('**/__notlinear_save_file', async route => {
    saved.push(JSON.parse(route.request().postData() ?? '{}') as { filename: string; content: string });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });
  await openProject(page);
  await panel(page).getByTestId('card-chats').locator('[data-chat="c1"]').first().click();
  const box = page.getByRole('textbox', { name: 'Message' });
  await box.click();
  await box.fill('make a page');
  await box.press('Enter');

  // The markup is a file, not a wall of source: one card, titled from the document, code hidden.
  const card = page.locator('.artifact-file-card');
  await expect(card).toHaveCount(1);
  await expect(card.locator('.artifact-card-title')).toHaveText('Hello page');
  await expect(card.locator('pre')).toBeHidden();
  // Kept without being asked, because the chat is in a project.
  await expect(card.locator('.artifact-card-meta')).toContainText('Saved to artifacts');

  await card.locator('.artifact-card-code-toggle').click();
  await expect(card.locator('pre')).toBeVisible();

  await card.locator('.artifact-download-btn').click();
  await expect.poll(() => saved).toHaveLength(1);
  expect(saved[0]!.filename).toBe('hello-page.html');
  expect(saved[0]!.content).toContain('<h1>Hello</h1>');

  await card.locator('.artifact-preview-btn').click();
  await expect(page.getByTestId('file-preview-frame')).toHaveAttribute('sandbox', '');
  await expect(page.frameLocator('[data-testid="file-preview-frame"]').locator('h1')).toHaveText('Hello');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('file-preview')).toHaveCount(0);

  // And it is in the project's artifacts, at v1, with the viewer still working.
  await openProject(page);
  await panel(page).getByTestId('card-artifacts').locator('[data-artifact]').first().click();
  await page.getByTestId('artifact-open').click();
  const frame = page.getByTestId('artifact-frame');
  await expect(frame).toHaveAttribute('sandbox', '');
  await expect(page.frameLocator('[data-testid="artifact-frame"]').locator('h1')).toHaveText('Hello');
});

test('a raw HTML reply with no code fence still becomes a file card', async ({ page }) => {
  await mockClaude(page, '<!DOCTYPE html>\n<html><head><title>Unfenced</title></head><body><h1>Raw</h1></body></html>');
  await seed(page);
  await openProject(page);
  await panel(page).getByTestId('card-chats').locator('[data-chat="c1"]').first().click();
  const box = page.getByRole('textbox', { name: 'Message' });
  await box.click();
  await box.fill('make a page');
  await box.press('Enter');
  const card = page.locator('.artifact-file-card');
  await expect(card).toHaveCount(1);
  await expect(card.locator('.artifact-card-title')).toHaveText('Unfenced');
  // The old failure: the tags rendered as escaped prose instead of a block. The markup is now
  // only inside the card's collapsed <pre>, never in a paragraph of the reply.
  await expect(card.locator('pre')).toBeHidden();
  await expect(page.locator('.msg.ai p').filter({ hasText: 'DOCTYPE' })).toHaveCount(0);
});
