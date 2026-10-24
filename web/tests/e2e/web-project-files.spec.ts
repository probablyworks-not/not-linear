import { test, expect, type Page } from '@playwright/test';
import { readPersistedState } from './helpers';

// P4 item 5: project rules, files and the linked folder in /web/, plus the
// attachment machinery (native pick -> browser fallback, reading, chips).
//
// The Playwright server runs with NOTLINEAR_FAKE_NATIVE=1 (playwright.config.ts), so
// the backend's native file dialog reports "cancelled". That is the exact condition
// BUGS.md #022 broke on: the app must fall through to the browser's own file input,
// which is what these tests drive with the browser's file chooser.

type Proj = { id: string; name: string; rules: string; files: Array<Record<string, unknown>>; path: string; updatedAt?: number };
const projectsOf = async (page: Page) => ((await readPersistedState(page)) as unknown as { projects: Record<string, Proj> }).projects;

async function seed(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const open = indexedDB.open('notlinear', 1);
    open.onupgradeneeded = () => { if (!open.result.objectStoreNames.contains('kv')) open.result.createObjectStore('kv', { keyPath: 'key' }); };
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('kv', 'readwrite');
      const store = tx.objectStore('kv');
      store.get('state').onsuccess = (e) => {
        if ((e.target as IDBRequest).result) return;
        const now = Date.now();
        const proj = (id: string, name: string) => ({ id, name, rules: '', files: [], path: '', updatedAt: now - 3600_000 });
        store.put({ key: 'state', value: {
          threads: {}, current: 'doc-main', dynamic: [], deletedThreads: [], chatCount: 1,
          projects: { p1: proj('p1', 'Web project'), p2: proj('p2', 'Legacy project') }, projectCount: 3, prefs: {},
        } });
      };
      tx.oncomplete = () => db.close();
    };
  });
}

const sidebar = (p: Page) => p.locator('aside[aria-label="Left pane"]');
async function showSidebar(p: Page): Promise<void> {
  // Keyed on the `invisible` class, which flips with state at once. Not isVisible() (true for the 200ms
  // slide-out) and not aria-hidden (Radix removes that attribute when a dialog closes, so null means nothing).
  const closed = ((await sidebar(p).getAttribute('class')) ?? '').includes('invisible');
  if (closed) await p.getByRole('button', { name: 'Open left pane' }).click();
  await expect(sidebar(p)).not.toHaveClass(/invisible/);
}
const panel = (p: Page) => p.getByRole('dialog').filter({ has: p.getByTestId('project-title') });
async function openWebPanel(page: Page, name = 'Web project'): Promise<void> {
  await page.goto('/web/');
  await expect(page.getByRole('button', { name: 'Open left pane' })).toBeVisible();
  await showSidebar(page);
  await page.getByRole('list', { name: 'Projects' }).getByRole('button', { name }).first().click();
  await expect(panel(page)).toBeVisible();
}
const TEXT = { name: 'notes.md', mimeType: 'text/markdown', buffer: Buffer.from('# Notes\n\nTide tables are weird.') };
const CSV = { name: 'data.csv', mimeType: 'text/csv', buffer: Buffer.from('a,b\n1,2\n') };
const PNG = { name: 'dot.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') };
const BIN = { name: 'blob.bin', mimeType: 'application/octet-stream', buffer: Buffer.from([0, 1, 2, 3]) };

async function chooseFiles(page: Page, trigger: () => Promise<void>, files: typeof TEXT[]): Promise<void> {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), trigger()]);
  await chooser.setFiles(files);
}

test.describe('project files (native picker cancelled -> browser fallback, #022)', () => {
  test('Add files opens the browser chooser, reads the files, shows chips, and stores text without base64', async ({ page }) => {
    await seed(page);
    await openWebPanel(page);
    await chooseFiles(page, () => panel(page).getByRole('button', { name: 'Add files' }).click(), [TEXT, CSV, PNG]);
    await expect(page.getByText('Added 3 files to project')).toBeVisible();

    await panel(page).getByRole('button', { name: 'Open Files' }).click();
    const chips = panel(page).getByTestId('file-row');
    await expect(chips).toHaveCount(3);
    await expect(chips.nth(0)).toContainText('notes.md');
    await expect(chips.nth(0)).toContainText(`${TEXT.buffer.length}B`);

    const files = (await projectsOf(page)).p1!.files;
    expect(files.map(f => f.name)).toEqual(['notes.md', 'data.csv', 'dot.png']);
    expect(files[0]).toMatchObject({ kind: 'file', type: 'text/markdown', content: '# Notes\n\nTide tables are weird.' });
    expect(files[2]).toMatchObject({ kind: 'image', type: 'image/png', content: null });
    for (const f of files) expect(f).not.toHaveProperty('base64'); // project files are text-only in storage
    expect(JSON.stringify(files)).not.toContain('iVBORw0K');
  });

  test('an unsupported type is still added as a chip and flagged, with the singular toast', async ({ page }) => {
    await seed(page);
    await openWebPanel(page);
    await chooseFiles(page, () => panel(page).getByRole('button', { name: 'Add files' }).click(), [BIN]);
    await expect(page.getByText('Added 1 file to project')).toBeVisible();
    expect((await projectsOf(page)).p1!.files[0]).toMatchObject({ name: 'blob.bin', unsupported: true, content: null });
  });

  test('removing a chip persists, and files accumulate across picks', async ({ page }) => {
    await seed(page);
    await openWebPanel(page);
    await chooseFiles(page, () => panel(page).getByRole('button', { name: 'Add files' }).click(), [TEXT]);
    await panel(page).getByRole('button', { name: 'Open Files' }).click();
    await chooseFiles(page, () => panel(page).getByRole('button', { name: 'Add files' }).click(), [CSV]);
    await expect(panel(page).getByTestId('file-row')).toHaveCount(2);
    await panel(page).getByRole('button', { name: 'Remove notes.md' }).click();
    await expect(panel(page).getByTestId('file-row')).toHaveCount(1);
    await expect.poll(async () => (await projectsOf(page)).p1!.files.map(f => f.name)).toEqual(['data.csv']);
  });
});

test.describe('project rules', () => {
  test('shows the placeholder and persists after the debounce', async ({ page }) => {
    await seed(page);
    await openWebPanel(page);
    await panel(page).getByRole('button', { name: '+ Add rules' }).click();
    const rules = panel(page).getByLabel('Project rules');
    await expect(rules).toHaveAttribute('placeholder', "Custom instructions the AI follows for every chat in this project, e.g. 'Answer in British English. Always cite sources. Prefer TypeScript examples.'");
    await rules.fill('Answer in British English.\nAlways cite sources.');
    await expect.poll(async () => (await projectsOf(page)).p1!.rules).toBe('Answer in British English.\nAlways cite sources.');

  });
});

test.describe('linked folder', () => {
  const pick = (page: Page, respond: { status?: number; body?: unknown } | 'abort') =>
    page.route('**/__notlinear_pick_folder', r => (respond === 'abort'
      ? r.abort()
      : r.fulfill({ status: respond.status ?? 200, contentType: 'application/json', body: JSON.stringify(respond.body ?? {}) })));

  test('link shows the path and an Unlink button, unlink removes them; both persist', async ({ page }) => {
    await seed(page);
    await pick(page, { body: { ok: true, path: '/Users/test/code/app' } });
    await openWebPanel(page);
    await expect(panel(page).getByRole('button', { name: 'Unlink' })).toHaveCount(0);
    await panel(page).getByRole('button', { name: 'Link folder', exact: true }).click();
    await expect(page.getByText('Folder linked')).toBeVisible();
    await expect(panel(page).getByTestId('project-folder')).toHaveText('/Users/test/code/app');
    await expect.poll(async () => (await projectsOf(page)).p1!.path).toBe('/Users/test/code/app');

    await page.goto('/web/');
    await showSidebar(page);
    await page.getByRole('list', { name: 'Projects' }).getByRole('button', { name: 'Web project' }).first().click();
    await panel(page).getByRole('button', { name: 'Unlink' }).click();
    await expect(page.getByText('Folder unlinked')).toBeVisible();
    await expect(panel(page).getByTestId('project-folder')).toHaveCount(0);
    await expect.poll(async () => (await projectsOf(page)).p1!.path).toBe('');
  });

  test('a cancelled pick changes nothing and says nothing', async ({ page }) => {
    await seed(page);
    await pick(page, { body: { ok: false, cancelled: true } });
    await openWebPanel(page);
    await panel(page).getByRole('button', { name: 'Link folder', exact: true }).click();
    await page.waitForTimeout(400);
    await expect(panel(page).getByTestId('project-folder')).toHaveCount(0);
    expect((await projectsOf(page)).p1!.path).toBe('');
  });

  for (const [name, respond, toastText] of [
    ['a picker error', { body: { ok: false, error: 'boom' } }, 'Picker error: boom'],
    ['an error with no message', { body: { ok: false } }, 'Could not pick folder'],
    ['a missing endpoint (404)', { status: 404, body: {} }, 'Restart the server — folder picker endpoint missing'],
    ['an unimplemented endpoint (501)', { status: 501, body: {} }, 'Restart the server — folder picker endpoint missing'],
    ['the server being unreachable', 'abort', 'Folder picker needs the local server (run backend/server.py)'],
  ] as const) {
    test(`reports ${name} with the legacy wording`, async ({ page }) => {
      await seed(page);
      await pick(page, respond);
      await openWebPanel(page);
      await panel(page).getByRole('button', { name: 'Link folder', exact: true }).click();
      await expect(page.getByText(toastText)).toBeVisible();
      expect((await projectsOf(page)).p1!.path).toBe('');
    });
  }
});

test.describe('persistence safety', () => {
  test('adding a file touches updatedAt; rules touch it; removing a file and linking a folder do not (as legacy)', async ({ page }) => {
    await seed(page);
    await pick();
    async function pick() { await page.route('**/__notlinear_pick_folder', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, path: '/x' }) })); }
    await openWebPanel(page);
    const t0 = (await projectsOf(page)).p1!.updatedAt!;
    await chooseFiles(page, () => panel(page).getByRole('button', { name: 'Add files' }).click(), [TEXT]);
    await expect.poll(async () => (await projectsOf(page)).p1!.updatedAt!).toBeGreaterThan(t0);
    const t1 = (await projectsOf(page)).p1!.updatedAt!;
    await panel(page).getByRole('button', { name: 'Open Files' }).click();
    await panel(page).getByRole('button', { name: 'Remove notes.md' }).click();
    await panel(page).getByRole('button', { name: 'Link folder…' }).click();
    await expect.poll(async () => (await projectsOf(page)).p1!.path).toBe('/x');
    expect((await projectsOf(page)).p1!.updatedAt).toBe(t1);
  });
});
