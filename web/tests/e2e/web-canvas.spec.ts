import { test, expect, type Page, type Route } from '@playwright/test';

// Canvas (C2-C4), end to end in a real browser. The model is mocked — no request leaves the page —
// but everything else is real: the Dexie db, the tabs, React Flow, the composer's persisted drafts.
//
// What this covers that no unit test can: that `canvas:<id>` really survives a reload with two
// canvases open (the Notes singleton-tab regression, bugs #042/#043), that text inside a card is
// actually selectable (React Flow sets user-select:none on nodes — the C0 spike's first defect),
// and that the whole loop holds together.

type Req = { messages: { role: string; content: string }[]; system: string };

async function seed(page: Page): Promise<Req[]> {
  const requests: Req[] = [];
  await page.addInitScript(() => {
    localStorage.setItem('nl_api_keys', JSON.stringify({ anthropic: 'sk-test' }));
    const open = indexedDB.open('notlinear', 1);
    open.onupgradeneeded = () => { if (!open.result.objectStoreNames.contains('kv')) open.result.createObjectStore('kv', { keyPath: 'key' }); };
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('kv', 'readwrite');
      const store = tx.objectStore('kv');
      store.get('state').onsuccess = e => {
        if ((e.target as IDBRequest).result) return;
        store.put({ key: 'state', value: {
          threads: { 'doc-main': { kind: 'doc', title: 'Main', stream: '', docContent: '<p><br></p>', highlights: [], branchSnapshots: {}, branchRecents: {} } },
          current: 'doc-main', dynamic: [], deletedThreads: [], chatCount: 1,
          projects: { p1: { id: 'p1', name: 'Research', rules: '', files: [], path: '', updatedAt: Date.now() } },
          projectCount: 1, prefs: { model: 'opus' },
        } });
      };
      tx.oncomplete = () => db.close();
    };
  });
  await page.route('https://api.anthropic.com/v1/messages', async (route: Route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as Req;
    requests.push(body);
    const text = 'A widget has a sprocket and a flange.';
    const events = [
      { type: 'message_start', message: { usage: { input_tokens: 7 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
      ...text.split(' ').map((w, i) => ({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: i ? ` ${w}` : w } })),
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 9 } },
    ];
    await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('') });
  });
  return requests;
}

async function openProject(page: Page): Promise<void> {
  await page.goto('/web/');
  await page.getByRole('button', { name: 'Open left pane' }).click();
  await page.locator('aside[aria-label="Left pane"] [data-project="p1"] button').first().click();
  await expect(page.getByTestId('project-overview')).toBeVisible();
}

const canvasTab = (page: Page) => page.getByRole('tab').filter({ hasText: 'Untitled canvas' });

type Artifact = { id: string; title: string; version: number; source: string; canvasId?: string; canvasOutputVersionId?: string };
/** Reads the artifacts db directly: the toast lasts 1800ms, the record is the actual claim. */
async function artifacts(page: Page): Promise<Artifact[]> {
  return page.evaluate(() => new Promise<Artifact[]>(resolve => {
    const open = indexedDB.open('notlinear-artifacts');
    open.onerror = () => resolve([]);
    open.onsuccess = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains('kv')) { db.close(); resolve([]); return; }
      const get = db.transaction('kv', 'readonly').objectStore('kv').get('artifacts_v1');
      get.onsuccess = () => { db.close(); resolve((get.result?.value as Artifact[]) ?? []); };
      get.onerror = () => { db.close(); resolve([]); };
    };
  }));
}

async function newCanvas(page: Page): Promise<void> {
  // The empty card offers New in its body; once there are canvases it is the header's +.
  const card = page.getByTestId('card-canvases');
  const empty = card.getByTestId('canvas-new-empty');
  if (await empty.count()) await empty.click();
  else await card.getByTestId('canvas-new-card').click();
  await expect(page.getByTestId('canvas-workspace')).toBeVisible();
}

async function ask(page: Page, text: string): Promise<void> {
  const composer = page.getByTestId('ink-composer');
  await composer.getByRole('textbox').fill(text);
  await composer.getByRole('button', { name: 'Send' }).click();
}

// One IndexedDB origin is shared by the whole run (playwright.config.ts: `workers: 1`), so a spec
// that seeds the chat db has to put it back. Without this, the canvases and the project seeded
// here leak into whatever spec runs next — which is how this spec broke an MCP integrations test
// that passes on its own.
test.afterEach(async ({ page }) => {
  await page.evaluate(async () => {
    const drop = (name: string) => new Promise<void>(resolve => {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
      setTimeout(resolve, 1000);
    });
    localStorage.removeItem('nl_tabs_v1');
    await Promise.all([drop('notlinear'), drop('notlinear-canvas'), drop('notlinear-artifacts')]);
  }).catch(() => undefined);
});

test.describe('the canvas loop', () => {
  test('ask, stream a reply, and keep it across a reload', async ({ page }) => {
    const requests = await seed(page);
    await openProject(page);
    await newCanvas(page);

    await ask(page, 'what is a widget?');
    await expect(page.getByText('A widget has a sprocket and a flange.')).toBeVisible();
    expect(requests).toHaveLength(1);
    expect(requests[0]!.messages.at(-1)!.content).toBe('what is a widget?');

    await page.reload();
    await expect(page.getByTestId('canvas-workspace')).toBeVisible();
    await expect(page.getByText('A widget has a sprocket and a flange.')).toBeVisible();
  });

  test('text inside a card is selectable, and a selection becomes a branch with its source', async ({ page }) => {
    const requests = await seed(page);
    await openProject(page);
    await newCanvas(page);
    await ask(page, 'what is a widget?');
    await expect(page.getByText('A widget has a sprocket and a flange.')).toBeVisible();

    // React Flow sets user-select:none on nodes; without the override this selects nothing and the
    // whole branching gesture is dead. That is the C0 spike's first finding, asserted here.
    const selected = await page.evaluate(() => {
      const el = [...document.querySelectorAll('[data-part]')].find(n => n.textContent?.includes('sprocket'));
      if (!el) return '';
      // The part renders markdown, so the word sits in a text node somewhere inside it.
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let node: Node | null = null;
      while (walker.nextNode()) {
        if (walker.currentNode.textContent?.includes('sprocket')) { node = walker.currentNode; break; }
      }
      if (!node) return '';
      const text = node.textContent ?? '';
      const at = text.indexOf('sprocket');
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + 'sprocket'.length);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
      return sel.toString();
    });
    expect(selected).toBe('sprocket');

    await page.getByTestId('add-source').click();
    await expect(page.getByTestId('context-chips')).toContainText('sprocket');

    await ask(page, 'what does it do?');
    // Scoped: the sidebar's thread rows carry `data-thread` too.
    await expect(page.getByTestId('canvas-workspace').locator('[data-thread]')).toHaveCount(2);
    // the branch carried the excerpt and the ancestor exchange
    const last = requests.at(-1)!;
    expect(last.messages.at(-1)!.content).toContain('> sprocket');
    expect(last.messages.map(m => m.role)).toEqual(['user', 'assistant', 'user']);
  });

  test('two canvases keep their own tabs, drafts and content across a reload', async ({ page }) => {
    await seed(page);
    await openProject(page);

    await newCanvas(page);
    await page.getByTestId('ink-composer').getByRole('textbox').fill('draft for the first');
    const firstTab = await canvasTab(page).first().innerText();

    // back to the project, make a second canvas
    await page.getByRole('button', { name: 'Open left pane' }).click();
    await page.locator('aside[aria-label="Left pane"] [data-project="p1"] button').first().click();
    await newCanvas(page);
    await page.getByTestId('ink-composer').getByRole('textbox').fill('draft for the second');

    await expect(page.getByRole('tab')).toHaveCount(3); // main chat + two canvases
    // The draft is written on a 250ms debounce; a reload is not an unmount, so let it land.
    await page.waitForTimeout(400);
    await page.reload();

    // Both tabs come back, each with its own identity — the thing Notes' singleton tab got wrong.
    await expect(page.getByRole('tab')).toHaveCount(3);
    await expect(page.getByTestId('canvas-workspace')).toBeVisible();
    // and the draft that belongs to the canvas showing is the one that comes back
    await expect(page.getByTestId('ink-composer').getByRole('textbox')).toHaveValue('draft for the second');
    expect(firstTab).toBeTruthy();
  });

  test('a reply saves into the project as an artifact, and saving twice does not duplicate it', async ({ page }) => {
    await seed(page);
    await openProject(page);
    await newCanvas(page);
    await ask(page, 'what is a widget?');
    await expect(page.getByText('A widget has a sprocket and a flange.')).toBeVisible();

    const save = page.getByTestId('save-output');
    await save.dispatchEvent('click');
    await expect.poll(async () => (await artifacts(page)).length).toBe(1);

    const first = (await artifacts(page))[0]!;
    expect(first).toMatchObject({ source: 'canvas', version: 1 });
    expect(first.canvasOutputVersionId).toBeTruthy();

    // Saving the same output again must not make a second artifact: the operation record is
    // deterministic and a retry resumes it.
    await save.dispatchEvent('click');
    await page.waitForTimeout(500);
    expect(await artifacts(page)).toHaveLength(1);

    // and it shows up on the project screen
    await page.getByRole('button', { name: 'Open left pane' }).click();
    await page.locator('aside[aria-label="Left pane"] [data-project="p1"] button').first().click();
    await expect(page.getByTestId('card-artifacts')).toContainText('1');
  });

  test('the reading view shows the same threads, and goes back to the canvas', async ({ page }) => {
    await seed(page);
    await openProject(page);
    await newCanvas(page);
    await ask(page, 'what is a widget?');
    await expect(page.getByText('A widget has a sprocket and a flange.')).toBeVisible();

    await page.getByTestId('canvas-reading-toggle').click();
    await expect(page.getByTestId('canvas-reading')).toBeVisible();
    await expect(page.getByTestId('canvas-reading')).toContainText('A widget has a sprocket and a flange.');
    await page.getByRole('button', { name: 'Back to the canvas' }).click();
    await expect(page.getByTestId('canvas-reading')).toHaveCount(0);
  });

  test('the library creates, renames, duplicates and deletes', async ({ page }) => {
    await seed(page);
    await openProject(page);
    await page.getByTestId('card-canvases').getByRole('button', { name: 'Open Canvases' }).click();
    await expect(page.getByTestId('canvases-view')).toBeVisible();

    await page.getByTestId('canvas-new').click();
    await expect(page.getByTestId('canvas-workspace')).toBeVisible();

    await page.getByRole('button', { name: 'Open left pane' }).click();
    await page.locator('aside[aria-label="Left pane"] [data-project="p1"] button').first().click();
    await page.getByTestId('card-canvases').getByRole('button', { name: 'Open Canvases' }).click();

    await page.getByRole('button', { name: /^Rename/ }).click();
    await page.getByLabel('Canvas name').fill('Widgets');
    await page.getByLabel('Canvas name').press('Enter');
    await expect(page.getByTestId('canvases-view')).toContainText('Widgets');

    await page.getByRole('button', { name: /^Duplicate/ }).click();
    await expect(page.getByTestId('canvases-view')).toContainText('Widgets copy');

    await page.getByRole('button', { name: 'Delete Widgets copy' }).click();
    await page.getByRole('button', { name: 'Delete canvas' }).click();
    await expect(page.getByTestId('canvases-view')).not.toContainText('Widgets copy');
  });
});
