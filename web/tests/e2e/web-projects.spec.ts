import { test, expect, type Page } from '@playwright/test';
import { readPersistedState } from './helpers';

// P4 item 4: Projects grid and chat-linking in /web/, over the same IndexedDB row
// as the legacy app. Scope is grid + linking + create/rename/delete; rules, files
// and the linked folder are later.

type Row = {
  threads: Record<string, Record<string, unknown>>;
  projects: Record<string, Record<string, unknown>>;
  deletedThreads: string[];
  dynamic: Array<{ id: string }>;
};
const persisted = async (page: Page) => (await readPersistedState(page)) as unknown as Row;

/**
 * Same data for both apps. Offsets are chosen well away from a unit boundary
 * ("3h ago", "1d ago", "31m ago") so the two apps cannot straddle a minute
 * between reads. Guarded: init scripts re-run on every navigation.
 */
async function seed(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const now = Date.now();
    const open = indexedDB.open('notlinear', 1);
    open.onupgradeneeded = () => { if (!open.result.objectStoreNames.contains('kv')) open.result.createObjectStore('kv', { keyPath: 'key' }); };
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('kv', 'readwrite');
      const store = tx.objectStore('kv');
      store.get('state').onsuccess = (e) => {
        if ((e.target as IDBRequest).result) return;
        const t = (title: string, extra: Record<string, unknown> = {}) =>
          ({ kind: 'chat', title, stream: '', docContent: '<p><br></p>', highlights: [], branchSnapshots: {}, branchRecents: {}, ...extra });
        const doc = (title: string) => ({ kind: 'doc', title, stream: '', docContent: '<p><br></p>', highlights: [], branchSnapshots: {}, branchRecents: {} });
        const proj = (id: string, name: string, ageMs: number) => ({ id, name, rules: '', files: [], path: '', updatedAt: now - ageMs });
        store.put({ key: 'state', value: {
          threads: {
            'doc-main': doc('Non-linear chat system'), pricing: doc('Pricing research'),
            onboarding: doc('Onboarding flow review'), planning: doc('Q3 planning notes'),
            'chat-1': t('Alpha chat', { projectId: 'p1' }), 'chat-2': t('Beta chat', { projectId: 'p1' }),
            'chat-3': t('Gamma chat'), 'chat-4': t('Delta chat', { projectId: 'p3' }),
          },
          current: 'doc-main',
          dynamic: ['chat-1', 'chat-2', 'chat-3', 'chat-4'].map(id => ({ id, title: id })),
          deletedThreads: [], chatCount: 5,
          projects: {
            p1: proj('p1', 'Zeta research', 3 * 3600_000),
            p2: proj('p2', 'Alpha lab', 26 * 3600_000),
            p3: proj('p3', 'Mid project', 31 * 60_000 + 30_000),
          },
          projectCount: 4, prefs: {},
        } });
      };
      tx.oncomplete = () => db.close();
    };
  });
}

async function openWeb(page: Page): Promise<void> {
  await page.goto('/web/');
  await expect(page.getByRole('button', { name: 'Open left pane' })).toBeVisible();
}
const sidebar = (p: Page) => p.locator('aside[aria-label="Left pane"]');
const showSidebar = async (p: Page) => {
  // Keyed on the `invisible` class, which flips with state at once. Not isVisible() (true for the 200ms
  // slide-out) and not aria-hidden (Radix removes that attribute when a dialog closes, so null means nothing).
  const closed = ((await sidebar(p).getAttribute('class')) ?? '').includes('invisible');
  if (closed) await p.getByRole('button', { name: 'Open left pane' }).click();
  await expect(sidebar(p)).not.toHaveClass(/invisible/);
};
/** Delete lives in the "…" menu of a project that has content; only a brand-new one shows it on the page. */
async function deleteFromMenu(p: Page): Promise<void> {
  await p.getByRole('button', { name: 'Project menu' }).click();
  await p.getByRole('menuitem', { name: 'Delete project' }).click();
}
const grid = (p: Page) => p.getByRole('dialog', { name: 'Projects' });
const panel = (p: Page) => p.getByRole('dialog').filter({ has: p.getByTestId('project-title') });
const cardNames = async (p: Page) => (await grid(p).locator('[data-pid]').locator('span.truncate').allInnerTexts()).map(s => s.trim());
const cardMeta = async (p: Page) => (await grid(p).locator('[data-pid]').evaluateAll(els => els.map(e => (e.lastElementChild as HTMLElement).innerText.replace(/\s+/g, ' ').trim())));
async function openGrid(p: Page): Promise<void> {
  await showSidebar(p);
  await p.getByRole('button', { name: 'View all projects' }).click();
  await expect(grid(p)).toBeVisible();
}

test.describe('sidebar', () => {
  test('lists projects in storage order and hides project chats from Threads', async ({ page }) => {
    await seed(page);
    await openWeb(page);
    await showSidebar(page);
    const projects = page.getByRole('list', { name: 'Projects' }).locator('[data-project]');
    await expect(projects).toHaveCount(3);
    expect(await projects.allInnerTexts()).toEqual(['Zeta research', 'Alpha lab', 'Mid project']);
    const threads = sidebar(page).locator('[data-thread]');
    const titles = await threads.allInnerTexts();
    expect(titles.map(t => t.trim())).toContain('Gamma chat');
    for (const filed of ['Alpha chat', 'Beta chat', 'Delta chat']) expect(titles.join('|')).not.toContain(filed);
  });
});

test.describe('grid', () => {
  test('cards default to last-updated order with legacy meta text', async ({ page }) => {
    await seed(page);
    await openWeb(page);
    await openGrid(page);
    expect(await cardNames(page)).toEqual(['Mid project', 'Zeta research', 'Alpha lab']);
    expect(await cardMeta(page)).toEqual(['1 thread · Updated 31m ago', '2 threads · Updated 3h ago', '0 threads · Updated 1d ago']);
    await expect(grid(page).locator('#pv-grid-new')).toBeVisible();
  });

  test('search filters by name and sort switches to name order; both reset on reopen', async ({ page }) => {
    await seed(page);
    await openWeb(page);
    await openGrid(page);
    await grid(page).getByLabel('Search projects').fill('  ALPHA ');
    expect(await cardNames(page)).toEqual(['Alpha lab']);
    await grid(page).getByLabel('Search projects').fill('');
    await grid(page).getByRole('button', { name: /Sort by/ }).click();
    await grid(page).getByRole('menuitemradio', { name: 'Name' }).click();
    expect(await cardNames(page)).toEqual(['Alpha lab', 'Mid project', 'Zeta research']);
    await page.keyboard.press('Escape');
    await expect(grid(page)).toHaveCount(0);
    await page.getByRole('button', { name: 'View all projects' }).click();
    expect(await cardNames(page)).toEqual(['Mid project', 'Zeta research', 'Alpha lab']);
    await expect(grid(page).getByLabel('Search projects')).toHaveValue('');
  });

  test('a card opens the project panel', async ({ page }) => {
    await seed(page);
    await openWeb(page);
    await openGrid(page);
    await grid(page).locator('[data-pid="p1"]').click();
    await expect(panel(page)).toBeVisible();
    await expect(page.getByTestId('project-title')).toHaveText('Zeta research');
    await expect(grid(page)).toHaveCount(0);
  });
});

test.describe('project panel', () => {
  async function openPanel(page: Page, name: string): Promise<void> {
    await showSidebar(page);
    await page.getByRole('list', { name: 'Projects' }).getByRole('button', { name }).first().click();
    await expect(panel(page)).toBeVisible();
  }

  test('shows the project name, its chats, and the empty state', async ({ page }) => {
    await seed(page);
    await openWeb(page);
    await openPanel(page, 'Zeta research');
    await expect(page.getByLabel('Project name')).toHaveValue('Zeta research');
    await expect(panel(page).locator('[data-chat]')).toHaveCount(2);
    await expect(panel(page)).toContainText('Alpha chat');
    await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);
    await openPanel(page, 'Alpha lab');
    await expect(panel(page)).toContainText('Plant the first chat');
  });

  test('remove from project: persisted and the chat returns to Threads', async ({ page }) => {
    await seed(page);
    await openWeb(page);
    await openPanel(page, 'Zeta research');
    await page.getByRole('button', { name: 'Remove Alpha chat from project' }).click();
    await expect(panel(page).locator('[data-chat]')).toHaveCount(1);
    await expect.poll(async () => (await persisted(page)).threads['chat-1']).not.toHaveProperty('projectId');
    await page.keyboard.press('Escape');
    await expect(sidebar(page).locator('[data-thread="chat-1"]')).toBeVisible();
  });

  test('add existing: lists ungrouped chats, files the chosen one, toasts', async ({ page }) => {
    await seed(page);
    await openWeb(page);
    await openPanel(page, 'Alpha lab');
    await panel(page).getByRole('button', { name: 'Add existing chat' }).click();
    const picker = page.getByTestId('existing-picker');
    await expect(picker).toContainText('Gamma chat');
    await expect(picker).not.toContainText('Alpha chat'); // already filed
    await expect(picker).not.toContainText('Non-linear chat system'); // doc-main is never offered
    await picker.getByRole('button', { name: /Gamma chat/ }).click();
    await expect(page.getByText('Chat added to project')).toBeVisible();
    await expect.poll(async () => (await persisted(page)).threads['chat-3']!.projectId).toBe('p2');
    await expect(panel(page).locator('[data-chat="chat-3"]')).toBeVisible();
  });

  test('New chat creates a chat IN the project, opens it as a tab and closes the panel', async ({ page }) => {
    await seed(page);
    await openWeb(page);
    await openPanel(page, 'Alpha lab');
    await panel(page).getByRole('button', { name: /^New chat/ }).first().click();
    await expect(page.getByText('New chat in project')).toBeVisible();
    await expect(panel(page)).toHaveCount(0);
    const row = await persisted(page);
    const id = Object.keys(row.threads).find(k => row.threads[k]!.projectId === 'p2')!;
    expect(row.threads[id]).toMatchObject({ kind: 'chat', title: 'Untitled chat 5', stream: '', docContent: '<p><br></p>' });
    await expect(page.getByRole('tab', { name: /Untitled chat 5/ })).toHaveAttribute('aria-selected', 'true');
  });

  test('renaming persists after the debounce, retitles the sidebar', async ({ page }) => {
    await seed(page);
    await openWeb(page);
    await openPanel(page, 'Alpha lab');
    await page.getByLabel('Project name').fill('Renamed lab');
    await expect(page.getByTestId('project-title')).toHaveText('Renamed lab');
    await expect.poll(async () => (await persisted(page)).projects.p2!.name).toBe('Renamed lab');
    await page.keyboard.press('Escape');
    await showSidebar(page);
    await expect(page.getByRole('list', { name: 'Projects' })).toContainText('Renamed lab');
  });

  test('deleting a chat from the panel uses the chat-delete wording', async ({ page }) => {
    await seed(page);
    await openWeb(page);
    await openPanel(page, 'Zeta research');
    await page.getByRole('button', { name: 'Delete Beta chat' }).click();
    const confirm = page.getByRole('alertdialog');
    await expect(confirm).toContainText('This removes "Beta chat" from the left panel and clears its saved messages.');
    await confirm.getByRole('button', { name: 'Delete chat' }).click();
    await expect(panel(page).locator('[data-chat="chat-2"]')).toHaveCount(0);
    expect((await persisted(page)).deletedThreads).toContain('chat-2');
  });

  test('delete project: legacy wording, Cancel keeps it, confirming keeps the CHATS and returns them to Threads', async ({ page }) => {
    await seed(page);
    await openWeb(page);
    await openPanel(page, 'Zeta research');
    await deleteFromMenu(page);
    const confirm = page.getByRole('alertdialog');
    await expect(confirm.getByRole('heading')).toHaveText('Delete project?');
    await expect(confirm).toContainText('This removes the project "Zeta research". Its chats are kept and moved back to Threads.');
    await page.keyboard.press('Escape');
    await expect(confirm).toHaveCount(0);
    await expect(panel(page)).toBeVisible();

    await deleteFromMenu(page);
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete project' }).click();
    await expect(page.getByText('Project deleted')).toBeVisible();
    await expect(panel(page)).toHaveCount(0);
    const row = await persisted(page);
    expect(row.projects.p1).toBeUndefined();
    expect(row.threads['chat-1']).toBeDefined();
    expect(row.threads['chat-1']).not.toHaveProperty('projectId');
    await showSidebar(page);
    await expect(sidebar(page).locator('[data-thread="chat-1"]')).toBeVisible();
    await expect(sidebar(page).locator('[data-thread="chat-2"]')).toBeVisible();
  });
});

test.describe('creating projects', () => {
  test('the sidebar + makes "New project", opens its panel with the name selected, and stamps it', async ({ page }) => {
    await openWeb(page);
    await showSidebar(page);
    await sidebar(page).getByTitle('New project', { exact: true }).click();
    await expect(panel(page)).toBeVisible();
    const name = page.getByLabel('Project name');
    await expect(name).toHaveValue('New project');
    await expect.poll(() => name.evaluate((el: HTMLInputElement) => document.activeElement === el && el.selectionStart === 0 && el.selectionEnd === el.value.length)).toBe(true);
    const row = await persisted(page);
    const id = Object.keys(row.projects)[0]!;
    expect(row.projects[id]).toMatchObject({ name: 'New project', rules: '', files: [], path: '' });
    expect(row.projects[id]!.updatedAt).toBeGreaterThan(0);
    // A second one is numbered, as legacy numbers them.
    await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);
    await showSidebar(page); // opening a project tucks the sidebar away
    await sidebar(page).getByTitle('New project', { exact: true }).click();
    await expect(page.getByLabel('Project name')).toHaveValue('New project 2');
  });

  test('the grid New project button and card both create one', async ({ page }) => {
    await openWeb(page);
    await openGrid(page);
    await grid(page).locator('#pv-grid-new').click();
    await expect(panel(page)).toBeVisible();
    await expect(page.getByLabel('Project name')).toHaveValue('New project');
  });
});
