import { test, expect, type Page, type Route } from '@playwright/test';

// P6c: Ask-AI branches in /web/ Notes. The model is mocked (no request leaves the browser), the backup
// endpoint is mocked (BUGS #053). What matters: the anchor and the record stay in step, existing
// anchors reopen their panels, a failed send leaves nothing behind, and delete unwraps the text.

const ANCHORED = 'before <span class="nt-br-anchor" data-bid="nb_old">old quote</span> after';
const NOTES = [{
  id: 'a', emoji: '📄', title: 'Alpha', tags: [], parent: null, createdAt: 1, updatedAt: 1000,
  blocks: [
    { id: 'a-1', type: 'text', text: 'the quick brown fox jumps' },
    { id: 'a-2', type: 'text', text: ANCHORED },
  ],
  branches: [{ bid: 'nb_old', quote: 'old quote', blockId: 'a-2', messages: [{ role: 'user', content: 'why?' }, { role: 'assistant', content: 'Because **reasons**.' }], createdAt: 1, touchedAt: 1 }],
}];

type Req = { messages: { role: string; content: string }[]; system: string };

async function open(page: Page, claude: 'ok' | 'error' | 'hang' = 'ok'): Promise<Req[]> {
  const requests: Req[] = [];
  await page.addInitScript((notes) => {
    if (localStorage.getItem('e2e_seeded')) return;
    localStorage.setItem('e2e_seeded', '1');
    localStorage.setItem('nl_notes_v2_backed_up', JSON.stringify({ at: 'x', path: '/p', bytes: 1 }));
    localStorage.setItem('nl_api_keys', JSON.stringify({ anthropic: 'sk-test' }));
    const req = indexedDB.open('notlinear-notes', 1);
    req.onupgradeneeded = () => { req.result.createObjectStore('kv', { keyPath: 'key' }); };
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put({ key: 'nl_notes_v1', value: notes });
      tx.oncomplete = () => db.close();
    };
  }, NOTES);
  await page.route('https://api.anthropic.com/v1/messages', async (route: Route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as Req;
    requests.push(body);
    if (claude === 'hang') return;
    if (claude === 'error') { await route.fulfill({ status: 500, body: 'boom' }); return; }
    const text = `Answer ${requests.length} about the passage.`;
    const events = [
      { type: 'message_start', message: { usage: { input_tokens: 5 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
      ...text.split(' ').map((w, i) => ({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: i ? ` ${w}` : w } })),
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 4 } },
    ];
    await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('') });
  });
  await page.goto('/web/');
  await page.getByRole('button', { name: 'Open left pane' }).click();
  await page.locator('aside[aria-label="Left pane"] [data-note="a"]').click();
  await expect(page.locator('.bn-editor')).toBeVisible();
  return requests;
}

type Branch = { bid: string; quote: string | null; blockId: string | null; messages: { role: string; content: string }[] };
type NoteRow = { id: string; blocks: { id: string; text?: string }[]; branches?: Branch[]; updatedAt: number };
async function noteA(page: Page): Promise<NoteRow> {
  return page.evaluate(() => new Promise<NoteRow>((resolve, reject) => {
    const req = indexedDB.open('notlinear-notes');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const g = req.result.transaction('kv', 'readonly').objectStore('kv').get('nl_notes_v1');
      g.onsuccess = () => { req.result.close(); resolve(((g.result as { value: NoteRow[] }).value).find(n => n.id === 'a')!); };
    };
  }));
}

/** Selects text inside a block by double-click-free means: a range over the matching text node. */
async function select(page: Page, text: string): Promise<void> {
  await page.evaluate((needle) => {
    const walker = document.createTreeWalker(document.querySelector('.bn-editor')!, NodeFilter.SHOW_TEXT);
    let n: Node | null;
    while ((n = walker.nextNode())) {
      const i = (n.textContent ?? '').indexOf(needle);
      if (i >= 0) {
        const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + needle.length);
        const s = window.getSelection()!; s.removeAllRanges(); s.addRange(r);
        return;
      }
    }
    throw new Error(`no text ${needle}`);
  }, text);
}

const panel = (page: Page) => page.locator('.nl-note-stack .branch');
/** chat.css keeps the header buttons unclickable until the header is hovered. */
const hoverHead = (page: Page) => panel(page).locator('.branch-head').hover();

test('an existing anchor reopens its panel with the quote and the saved conversation', async ({ page }) => {
  await open(page);
  await page.locator('.nt-br-anchor[data-bid="nb_old"]').click();
  await expect(panel(page)).toHaveCount(1);
  await expect(panel(page).locator('.branch-quote')).toContainText('old quote');
  await expect(panel(page).locator('.msg.user')).toHaveText('why?');
  await expect(panel(page).locator('.msg.ai strong')).toHaveText('reasons');
});

test('Branch on a selection anchors it, saves the record before the answer, streams a reply and stores both turns', async ({ page }) => {
  const reqs = await open(page);
  await select(page, 'quick brown');
  await page.getByTestId('note-page').getByRole('button', { name: 'Branch', exact: true }).click();
  await expect(panel(page)).toHaveCount(1);
  await expect(panel(page).locator('.branch-quote')).toContainText('quick brown');

  await expect.poll(async () => (await noteA(page)).branches!.length).toBe(2);
  await expect.poll(async () => (await noteA(page)).blocks[0]!.text).toBe('the <span class="nt-br-anchor" data-bid="' + (await noteA(page)).branches![1]!.bid + '">quick brown</span> fox jumps');
  const made = (await noteA(page)).branches![1]!;
  expect(made).toMatchObject({ quote: 'quick brown', blockId: 'a-1', messages: [] });

  await panel(page).getByLabel('Ask about this').fill('what is this?');
  await page.keyboard.press('Enter');
  await expect(panel(page).locator('.msg.ai').last()).toContainText('Answer 1 about the passage.');
  await expect.poll(async () => (await noteA(page)).branches![1]!.messages).toEqual([
    { role: 'user', content: 'what is this?' }, { role: 'assistant', content: 'Answer 1 about the passage.' },
  ]);

  // The quote rides on the first message only, and the system prompt names the page and the passage.
  expect(reqs[0]!.messages).toEqual([{ role: 'user', content: '“quick brown”\n\nwhat is this?' }]);
  expect(reqs[0]!.system).toContain('Note: Alpha');
  expect(reqs[0]!.system).toContain('Selected passage:\n“quick brown”');
  expect(reqs[0]!.system).toContain('the quick brown fox jumps');

  // The old branch and its anchor are untouched.
  expect((await noteA(page)).branches![0]).toEqual(NOTES[0]!.branches[0]);
  expect((await noteA(page)).blocks[1]).toEqual(NOTES[0]!.blocks[1]);
});

test('a second question carries the whole conversation without repeating the quote', async ({ page }) => {
  const reqs = await open(page);
  await page.locator('.nt-br-anchor[data-bid="nb_old"]').click();
  await panel(page).getByLabel('Ask about this').fill('and then?');
  await page.keyboard.press('Enter');
  await expect(panel(page).locator('.msg.ai').last()).toContainText('Answer 1');
  expect(reqs[0]!.messages.map(m => m.role)).toEqual(['user', 'assistant', 'user']);
  expect(reqs[0]!.messages[0]!.content).toBe('why?');
});

test('a failed send shows the error and leaves no orphaned question behind', async ({ page }) => {
  await open(page, 'error');
  await page.locator('.nt-br-anchor[data-bid="nb_old"]').click();
  await panel(page).getByLabel('Ask about this').fill('will fail');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('note-branch-error')).toBeVisible();
  await expect.poll(async () => (await noteA(page)).branches![0]!.messages.length).toBe(2);
  expect((await noteA(page)).branches![0]!.messages).toEqual(NOTES[0]!.branches[0]!.messages);
  await expect(panel(page).getByLabel('Ask about this')).toBeEnabled();
});

test('stopping a reply that has not started takes the question back', async ({ page }) => {
  await open(page, 'hang');
  await page.locator('.nt-br-anchor[data-bid="nb_old"]').click();
  await panel(page).getByLabel('Ask about this').fill('slow');
  await page.keyboard.press('Enter');
  await expect(panel(page).getByRole('button', { name: 'Stop' })).toBeVisible();
  await panel(page).getByRole('button', { name: 'Stop' }).click();
  await expect(panel(page).getByRole('button', { name: 'Send' })).toBeVisible();
  await expect.poll(async () => (await noteA(page)).branches![0]!.messages.length).toBe(2);
});

test('collapse, reader and resize are remembered on the record; none of them is a content edit', async ({ page }) => {
  await open(page);
  await page.locator('.nt-br-anchor[data-bid="nb_old"]').click();
  await hoverHead(page);
  await panel(page).getByRole('button', { name: 'Collapse or expand panel' }).click();
  await expect(panel(page)).toHaveClass(/collapsed/);
  await expect.poll(async () => (await noteA(page)).branches![0]).toMatchObject({ collapsed: true });
  await hoverHead(page);
  await panel(page).getByRole('button', { name: 'Collapse or expand panel' }).click();
  await hoverHead(page);
  await panel(page).getByRole('button', { name: 'Expand branch' }).click();
  await expect(panel(page)).toHaveClass(/reader/);
  await expect.poll(async () => (await noteA(page)).branches![0]).toMatchObject({ collapsed: false, reader: true });
  expect((await noteA(page)).updatedAt).toBe(1000);
});

test('the page-bottom box asks about the whole note: a branch with no quote and no anchor', async ({ page }) => {
  const reqs = await open(page);
  await page.getByLabel('Ask AI about this note').fill('summarise');
  await page.keyboard.press('Enter');
  await expect(panel(page).locator('.msg.ai').last()).toContainText('Answer 1');
  await expect(panel(page).locator('.branch-quote')).toHaveCount(0);
  const b = (await noteA(page)).branches!.find(x => x.quote === null)!;
  expect(b).toMatchObject({ blockId: null, quote: null });
  expect(b.messages[0]).toEqual({ role: 'user', content: 'summarise' });
  expect(reqs[0]!.messages[0]!.content).toBe('summarise');
  expect(reqs[0]!.system).not.toContain('Selected passage');
});

test('delete takes the record and unwraps the anchor back to plain text, and leaves the rest', async ({ page }) => {
  await open(page);
  await page.locator('.nt-br-anchor[data-bid="nb_old"]').click();
  await hoverHead(page);
  await panel(page).getByRole('button', { name: 'Branch actions' }).click();
  await page.getByRole('menuitem', { name: 'Delete branch' }).click();
  await expect(panel(page)).toHaveCount(0);
  await expect.poll(async () => (await noteA(page)).blocks[1]!.text).toBe('before old quote after');
  const n = await noteA(page);
  expect(n).not.toHaveProperty('branches');
  expect(n.blocks[0]).toEqual(NOTES[0]!.blocks[0]);
});
