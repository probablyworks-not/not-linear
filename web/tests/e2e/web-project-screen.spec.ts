import { test, expect, type Page } from '@playwright/test';
import { readPersistedState } from './helpers';

// The redesigned project screen: an overview of cards (Chats, Notes, AI artifacts, Rules, Files, Memory) in three
// states (brand new, chats only, active), plus drill-ins for Notes, Files and AI artifacts. Artifacts and Memory have no
// backend yet, so they must show their empty / "Soon" states and nothing else.

type Scenario = 'new' | 'chats' | 'active';

async function seed(page: Page, scenario: Scenario): Promise<void> {
  await page.addInitScript((sc: string) => {
    if (localStorage.getItem('e2e_seeded')) return;
    localStorage.setItem('e2e_seeded', '1');
    localStorage.setItem('nl_notes_v2_backed_up', JSON.stringify({ at: new Date().toISOString(), path: '/t/b.json', bytes: 9 }));
    const now = Date.now();
    const chat = (title: string, ageMs: number, extra: Record<string, unknown> = {}) => ({
      kind: 'chat', title, stream: '', docContent: '<p><br></p>', highlights: [], branchSnapshots: {}, branchRecents: {},
      projectId: 'p1', updatedAt: now - ageMs,
      mainMessages: [{ role: 'user', content: 'q' }, { role: 'assistant', content: `Summary of ${title}` }], ...extra,
    });
    const threads: Record<string, unknown> = { 'doc-main': { kind: 'doc', title: 'Main', stream: '', docContent: '<p><br></p>', highlights: [], branchSnapshots: {}, branchRecents: {} } };
    const dynamic: Array<{ id: string; title: string }> = [];
    const add = (id: string, t: unknown, title: string) => { threads[id] = t; dynamic.push({ id, title }); };
    const base = { id: 'p1', name: 'Atlas redesign', rules: '', files: [] as unknown[], path: '', updatedAt: now - 2 * 3600_000 };
    let notes: unknown[] = [];
    if (sc !== 'new') {
      add('c1', chat('Navigation model', 2 * 3600_000, { branchSnapshots: { b1: {}, b2: {}, b3: {} } }), 'Navigation model');
      add('c2', chat('Empty states audit', 3 * 86400_000), 'Empty states audit');
      add('c3', chat('Pricing page teardown', 9 * 86400_000), 'Pricing page teardown');
    }
    if (sc === 'active') {
      for (let i = 4; i <= 7; i++) add(`c${i}`, chat(`Chat number ${i}`, (10 + i) * 86400_000), `Chat number ${i}`);
      base.rules = 'Answer in British English.';
      base.path = '/Users/test/atlas';
      base.files = [
        { name: 'brief.md', size: 1200, type: 'text/markdown', kind: 'file', content: '# Brief' },
        { name: 'spec.csv', size: 3400, type: 'text/csv', kind: 'file', content: 'a,b' },
        { name: 'extra.txt', size: 10, type: 'text/plain', kind: 'file', content: 'x' },
      ];
      const n = (id: string, title: string, text: string, extra: Record<string, unknown> = {}) =>
        ({ id, title, emoji: null, tags: [], parent: null, createdAt: 1, updatedAt: now - 3600_000, projectId: 'p1', blocks: [{ id: `${id}-1`, type: 'text', text }], ...extra });
      notes = [n('n1', 'Interview takeaways', '12 insights grouped into 4 themes.'), n('n2', 'Open questions', '7 items for design review.', { pinned: true }), n('n3', 'Naming ideas', 'Atlas, Meridian, Waypoint.'), { ...n('n4', 'Loose idea', 'Not in any project yet.'), projectId: undefined }];
    }
    // A chat that belongs to no project, for "Add existing chat".
    add('loose', { ...chat('Loose chat', 5000), projectId: undefined }, 'Loose chat');
    const open = indexedDB.open('notlinear', 1);
    open.onupgradeneeded = () => { open.result.createObjectStore('kv', { keyPath: 'key' }); };
    open.onsuccess = () => {
      const tx = open.result.transaction('kv', 'readwrite');
      tx.objectStore('kv').put({ key: 'state', value: { threads, current: 'doc-main', dynamic, deletedThreads: [], chatCount: 9, projects: { p1: base }, projectCount: 2, prefs: {} } });
      tx.oncomplete = () => open.result.close();
    };
    const nb = indexedDB.open('notlinear-notes', 1);
    nb.onupgradeneeded = () => { nb.result.createObjectStore('kv', { keyPath: 'key' }); };
    nb.onsuccess = () => {
      const tx = nb.result.transaction('kv', 'readwrite');
      const kv = tx.objectStore('kv');
      kv.put({ key: 'nl_notes_v1', value: notes });
      kv.put({ key: 'nl_notes_selected_v1', value: null });
      kv.put({ key: 'nl_notes_open_v1', value: [] });
      tx.oncomplete = () => nb.result.close();
    };
  }, scenario);
}

const panel = (p: Page) => p.getByRole('dialog').filter({ has: p.getByTestId('project-title') });
const card = (p: Page, id: string) => panel(p).getByTestId(`card-${id}`);

async function openProject(page: Page, scenario: Scenario): Promise<void> {
  await seed(page, scenario);
  await page.goto('/web/');
  await page.getByRole('button', { name: 'Open left pane' }).click();
  await page.getByRole('list', { name: 'Projects' }).getByRole('button', { name: 'Atlas redesign' }).first().click();
  await expect(panel(page)).toBeVisible();
}

test.describe('brand-new project', () => {
  test('shows every empty state, the Memory "Soon" card, and the delete link', async ({ page }) => {
    await openProject(page, 'new');
    await expect(panel(page).getByTestId('project-meta')).toHaveText('Just created · nothing here yet');
    await expect(card(page, 'chats')).toContainText('Plant the first chat');
    await expect(card(page, 'notes')).toContainText('No notes yet');
    await expect(card(page, 'artifacts')).toContainText('Nothing generated yet');
    await expect(card(page, 'rules')).toContainText('Instructions the AI follows in every chat here');
    await expect(card(page, 'files')).toContainText('Shared knowledge for every chat');
    await expect(card(page, 'memory')).toContainText('Soon');
    for (const id of ['chats', 'notes', 'artifacts', 'rules', 'files']) await expect(card(page, id)).toHaveAttribute('data-empty', 'true');
    await expect(panel(page).getByRole('button', { name: 'Delete project' })).toBeVisible();
  });
});

test.describe('project with chats only', () => {
  test('lists 3 chats with no branch chip, other cards stay empty, no delete link, no "View all"', async ({ page }) => {
    await openProject(page, 'chats');
    await expect(panel(page).getByTestId('project-meta')).toHaveText(/^3 items · active /);
    await expect(card(page, 'chats').locator('[data-chat]')).toHaveCount(3);
    await expect(card(page, 'chats')).not.toContainText('View all');
    await expect(card(page, 'chats').getByRole('button', { name: /Open chats/i })).toHaveCount(0);
    for (const id of ['notes', 'artifacts', 'rules', 'files']) await expect(card(page, id)).toHaveAttribute('data-empty', 'true');
    await expect(panel(page).getByRole('button', { name: 'Delete project' })).toHaveCount(0);
  });

  test('"Add existing chat" from the + menu opens the picker and files the chat', async ({ page }) => {
    await openProject(page, 'chats');
    await panel(page).getByRole('button', { name: 'Add to project' }).click();
    await panel(page).getByRole('menuitem', { name: 'Add existing chat' }).click();
    await card(page, 'chats').getByTestId('existing-picker').getByRole('button', { name: /Loose chat/ }).click();
    await expect(card(page, 'chats').locator('[data-chat="loose"]')).toBeVisible();
    await expect.poll(async () => ((await readPersistedState(page)) as unknown as { threads: Record<string, { projectId?: string }> }).threads.loose!.projectId).toBe('p1');
  });
});

test.describe('active project', () => {
  test('chat rows: newest first, branch chip only where branches exist, 5 shown until "View all 7"', async ({ page }) => {
    await openProject(page, 'active');
    await expect(panel(page).getByTestId('project-meta')).toHaveText(/^13 items · active /); // 7 chats + 3 notes + 3 files
    const rows = card(page, 'chats').locator('[data-chat]');
    await expect(rows).toHaveCount(5);
    await expect(rows.first()).toContainText('Navigation model');
    await expect(rows.first().getByTestId('branch-chip')).toHaveText('3');
    await expect(rows.nth(1).getByTestId('branch-chip')).toHaveCount(0);
    await expect(rows.first()).toContainText('Summary of Navigation model');
    await card(page, 'chats').getByRole('button', { name: 'View all 7' }).click();
    await expect(rows).toHaveCount(7);
    await card(page, 'chats').getByRole('button', { name: 'Show less' }).click();
    await expect(rows).toHaveCount(5);
  });

  test('cards: notes tiles with the pinned one first, rules text, files + linked folder, artifacts empty, Memory "Soon"', async ({ page }) => {
    await openProject(page, 'active');
    const tiles = card(page, 'notes').locator('[data-note]');
    await expect(tiles).toHaveCount(3);
    await expect(tiles.first()).toContainText('Open questions');
    await expect(tiles.first()).toHaveAttribute('data-pinned', 'true');
    await expect(card(page, 'rules').getByTestId('rules-text')).toHaveText('Answer in British English.');
    await expect(card(page, 'files').getByTestId('project-folder')).toHaveText('/Users/test/atlas');
    await expect(card(page, 'files')).toContainText('brief.md, spec.csv + 1 more');
    await expect(card(page, 'artifacts')).toContainText('Nothing generated yet');
    await expect(card(page, 'memory')).toContainText('Soon');
    await expect(panel(page).getByRole('button', { name: 'Delete project' })).toHaveCount(0);
  });

  test('a project that already has notes can still add an existing one, from the card and the + menu', async ({ page }) => {
    await openProject(page, 'active');
    await card(page, 'notes').getByRole('button', { name: 'Add existing' }).click();
    const picker = card(page, 'notes').getByTestId('existing-note-picker');
    await expect(picker).toContainText('Loose idea');
    await expect(picker).not.toContainText('Naming ideas'); // already in this project
    await picker.getByRole('button', { name: /Loose idea/ }).click();
    await expect(card(page, 'notes').locator('[data-note="n4"]')).toBeVisible();
    await expect(card(page, 'notes')).toContainText('Notes · 4');
    const projectId = await page.evaluate(() => new Promise<string | undefined>(resolve => {
      const req = indexedDB.open('notlinear-notes');
      req.onsuccess = () => {
        const get = req.result.transaction('kv').objectStore('kv').get('nl_notes_v1');
        get.onsuccess = () => { req.result.close(); resolve((get.result.value as Array<{ id: string; projectId?: string }>).find(n => n.id === 'n4')?.projectId); };
      };
    }));
    expect(projectId).toBe('p1');
  });

  test('"Add existing note" in the + menu opens the same picker', async ({ page }) => {
    await openProject(page, 'active');
    await panel(page).getByRole('button', { name: 'Add to project' }).click();
    await panel(page).getByRole('menuitem', { name: 'Add existing note' }).click();
    await expect(card(page, 'notes').getByTestId('existing-note-picker')).toContainText('Loose idea');
  });

  test('Notes drill-in: Pinned filter, pin toggle persists, Esc steps back to the overview before closing', async ({ page }) => {
    await openProject(page, 'active');
    await card(page, 'notes').getByRole('button', { name: 'Open Notes' }).click();
    const view = panel(page).getByTestId('notes-view');
    await expect(view.locator('[data-note]')).toHaveCount(3);
    await expect(view.getByRole('tab', { name: 'Pinned 1' })).toBeVisible();
    await expect(view.getByRole('tab', { name: /Linked/ })).toHaveCount(0); // hidden: no note-to-chat link yet
    await view.getByRole('tab', { name: 'Pinned 1' }).click();
    await expect(view.locator('[data-note]')).toHaveCount(1);
    await view.getByRole('tab', { name: /^All/ }).click();
    await view.getByRole('button', { name: 'Pin Naming ideas' }).click();
    await expect(view.getByRole('tab', { name: 'Pinned 2' })).toBeVisible();
    const pinned = await page.evaluate(() => new Promise<string[]>(resolve => {
      const req = indexedDB.open('notlinear-notes');
      req.onsuccess = () => {
        const get = req.result.transaction('kv').objectStore('kv').get('nl_notes_v1');
        get.onsuccess = () => { req.result.close(); resolve((get.result.value as Array<{ id: string; pinned?: boolean }>).filter(n => n.pinned).map(n => n.id).sort()); };
      };
    }));
    expect(pinned).toEqual(['n2', 'n3']);
    await page.keyboard.press('Escape');
    await expect(panel(page).getByTestId('project-overview')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);
  });

  test('Files card keeps "+ Add files" and the folder button once files and a folder exist', async ({ page }) => {
    await openProject(page, 'active');
    await expect(card(page, 'files').getByRole('button', { name: '+ Add files' })).toBeVisible();
    await expect(card(page, 'files').getByRole('button', { name: 'Change folder' })).toBeVisible();
    await page.route('**/__notlinear_pick_folder', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, path: '/Users/test/other' }) }));
    await card(page, 'files').getByRole('button', { name: 'Change folder' }).click();
    await expect(card(page, 'files').getByTestId('project-folder')).toHaveText('/Users/test/other');
  });

  test('Files drill-in lists uploaded files and the linked-folder banner; back returns to the overview', async ({ page }) => {
    await openProject(page, 'active');
    await card(page, 'files').getByRole('button', { name: 'Open Files' }).click();
    const view = panel(page).getByTestId('files-view');
    await expect(view.getByTestId('file-row')).toHaveCount(3);
    await expect(view.getByTestId('file-row').first()).toContainText('brief.md');
    await expect(view.getByTestId('project-folder')).toHaveText('/Users/test/atlas');
    await view.getByRole('button', { name: 'Atlas redesign' }).click();
    await expect(panel(page).getByTestId('project-overview')).toBeVisible();
  });

  test('AI artifacts drill-in is a complete empty shell: no filters, Export all disabled', async ({ page }) => {
    await openProject(page, 'active');
    await card(page, 'artifacts').getByRole('button', { name: 'Open AI artifacts' }).click();
    const view = panel(page).getByTestId('artifacts-view');
    await expect(view).toContainText('Nothing generated yet');
    await expect(view.getByRole('button', { name: 'Export all' })).toBeDisabled();
    await expect(view.getByRole('tablist')).toHaveCount(0);
  });

  test('rules: Edit shows the textarea, typing persists after the debounce, Done returns to text', async ({ page }) => {
    await openProject(page, 'active');
    await card(page, 'rules').getByRole('button', { name: 'Edit' }).click();
    await card(page, 'rules').getByLabel('Project rules').fill('Be brief.');
    await expect.poll(async () => ((await readPersistedState(page)) as unknown as { projects: Record<string, { rules: string }> }).projects.p1!.rules).toBe('Be brief.');
    await card(page, 'rules').getByRole('button', { name: 'Done' }).click();
    await expect(card(page, 'rules').getByTestId('rules-text')).toHaveText('Be brief.');
  });

  test('⌘N inside the project starts a chat in it; the … menu offers rename, rules and delete', async ({ page }) => {
    await openProject(page, 'active');
    await panel(page).getByRole('button', { name: 'Project menu' }).click();
    for (const name of ['Rename project', 'Edit rules', 'Delete project']) await expect(panel(page).getByRole('menuitem', { name })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel(page).getByRole('menu')).toHaveCount(0);
    await page.keyboard.press('Meta+n');
    await expect(page.getByText('New chat in project')).toBeVisible();
    await expect(panel(page)).toHaveCount(0);
    const row = (await readPersistedState(page)) as unknown as { threads: Record<string, { projectId?: string; title?: string }> };
    expect(Object.values(row.threads).filter(t => t.projectId === 'p1' && t.title?.startsWith('Untitled chat')).length).toBe(1);
  });

  test('the project icon is changeable from the header and persists on the project', async ({ page }) => {
    await openProject(page, 'active');
    await panel(page).getByRole('button', { name: 'Change project icon' }).click();
    const picker = page.getByTestId('glyph-picker');
    await expect(picker).toBeVisible();
    await picker.locator('.mg-opt').first().click();
    await expect.poll(async () => ((await readPersistedState(page)) as unknown as { projects: Record<string, { emoji?: string }> }).projects.p1!.emoji ?? '').toMatch(/^icon:/);
  });
});
