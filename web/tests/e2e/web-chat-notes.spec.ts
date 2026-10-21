import { test, expect, type Page, type Route } from '@playwright/test';

// Chat -> Notes: the model files a long document as a note, the reply leaves a card, and the card
// opens the note in a pane beside the chat that can be read, edited and resized. Every service is
// mocked; the Notes backup is represented by its flag, so nothing here writes to ~/.notlinear.

const WEB = '/web/';
const sse = (events: unknown[]): string => events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('');
const claudeToolUse = (name: string, input: unknown): string => sse([
  { type: 'message_start', message: { usage: { input_tokens: 10 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu_1', name } },
  { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } },
  { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 4 } },
]);
const claudeAnswer = (text: string): string => sse([
  { type: 'message_start', message: { usage: { input_tokens: 30 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
  ...text.split(' ').map((w, i) => ({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: i ? ' ' + w : w } })),
  { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 12 } },
]);

async function seed(page: Page, backedUp = true): Promise<void> {
  await page.addInitScript((backup) => {
    localStorage.setItem('nl_api_keys', JSON.stringify({ anthropic: 'sk-ant-TESTONLY-notes' }));
    localStorage.setItem('nl_clarify_first', '0');
    if (backup) localStorage.setItem('nl_notes_v2_backed_up', JSON.stringify({ at: 'x', path: '/p', bytes: 1 }));
    // Once only: a reload must not wipe the note the chat filed.
    if (localStorage.getItem('e2e_seeded')) return;
    localStorage.setItem('e2e_seeded', '1');
    const open = indexedDB.open('notlinear-notes', 1);
    open.onupgradeneeded = () => { open.result.createObjectStore('kv', { keyPath: 'key' }); };
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put({ key: 'nl_notes_v1', value: [] });
      tx.oncomplete = () => db.close();
    };
  }, backedUp);
}

async function scriptClaude(page: Page, script: string[]): Promise<{ bodies: Array<{ tools?: Array<{ name: string }> }> }> {
  const bodies: Array<{ tools?: Array<{ name: string }> }> = [];
  await page.route('https://api.anthropic.com/v1/messages', async (route: Route) => {
    const n = bodies.length;
    bodies.push(JSON.parse(route.request().postData() ?? '{}'));
    await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: script[Math.min(n, script.length - 1)]! });
  });
  return { bodies };
}

async function newChat(page: Page): Promise<void> {
  await page.goto(WEB);
  await page.getByRole('button', { name: 'Open left pane' }).click();
  await page.getByRole('button', { name: /New chat/ }).click();
  await page.getByRole('button', { name: 'Close left pane' }).click();
}

async function ask(page: Page, text: string): Promise<void> {
  const box = page.getByRole('textbox', { name: 'Message' });
  await box.fill(text);
  await box.press('Enter');
}

const FILED = [
  claudeToolUse('create_note', { title: 'Launch plan', content: '## Goals\n\nShip the **first** version.\n\n- one\n- two' }),
  claudeAnswer('Saved the plan as a note.'),
];

test('the model files a document: a card appears, it opens beside the chat, and it can be resized', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await seed(page);
  const mock = await scriptClaude(page, FILED);
  await newChat(page);
  await ask(page, 'write me a launch plan');

  const card = page.locator('[data-chat-stream] .note-ref');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Launch plan');
  await expect(page.locator('[data-chat-stream]')).toContainText('Saved the plan as a note.');
  expect(mock.bodies[0]!.tools?.map(t => t.name)).toContain('create_note');
  // The document itself is not in the chat.
  await expect(page.locator('[data-chat-stream]')).not.toContainText('Ship the first version');

  const column = page.getByTestId('chat-stream');
  const before = (await column.boundingBox())!.width;
  await card.click();
  const pane = page.getByTestId('note-pane');
  await expect(pane).toBeVisible();
  await expect(pane.getByTestId('note-pane-title')).toHaveText('Launch plan');
  await expect(pane.locator('.bn-editor')).toContainText('Ship the first version');
  await expect(pane.locator('.bn-editor h2, .bn-editor [data-content-type="heading"]').first()).toContainText('Goals');
  // The chat column gave up room for the pane instead of sitting under it.
  await expect.poll(async () => (await column.boundingBox())!.width).toBeLessThan(before);
  expect(await pane.evaluate(el => el.getBoundingClientRect().left)).toBeGreaterThan(0);

  // Dragging the left edge resizes the pane, and the chat reflows with it.
  const w0 = (await pane.boundingBox())!.width;
  const c0 = (await column.boundingBox())!.width;
  const handle = (await page.getByTestId('note-pane-resize').boundingBox())!;
  await page.mouse.move(handle.x + 2, handle.y + 200);
  await page.mouse.down();
  await page.mouse.move(handle.x - 140, handle.y + 200, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await pane.boundingBox())!.width).toBeGreaterThan(w0 + 100);
  await expect.poll(async () => (await column.boundingBox())!.width).toBeLessThanOrEqual(c0);
  const wide = Math.round((await pane.boundingBox())!.width);
  expect(Number(await page.evaluate(() => localStorage.getItem('nl_note_pane_w')))).toBe(wide);

  // Closed, the chat has its room back; reopened after a reload, the card is still there and the width is remembered.
  await pane.getByRole('button', { name: 'Close note' }).click();
  await expect(pane).toBeHidden();
  await expect.poll(async () => (await column.boundingBox())!.width).toBeGreaterThanOrEqual(before - 1);
  await page.reload();
  await expect(page.locator('[data-chat-stream] .note-ref')).toContainText('Launch plan');
  await page.locator('[data-chat-stream] .note-ref').click();
  await expect.poll(async () => Math.round((await page.getByTestId('note-pane').boundingBox())!.width)).toBe(wide);
  expect(errors).toEqual([]);
});

test('the pane note is editable and the edit is saved to the note', async ({ page }) => {
  await seed(page);
  await scriptClaude(page, FILED);
  await newChat(page);
  await ask(page, 'write me a launch plan');
  await page.locator('[data-chat-stream] .note-ref').click();
  const editor = page.getByTestId('note-pane').locator('.bn-editor');
  await expect(editor).toContainText('Ship the first version');
  await editor.getByText('two').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' and three');
  await expect.poll(() => page.evaluate(() => new Promise<string>((resolve) => {
    const open = indexedDB.open('notlinear-notes');
    open.onsuccess = () => {
      const req = open.result.transaction('kv', 'readonly').objectStore('kv').get('nl_notes_v1');
      req.onsuccess = () => { open.result.close(); resolve(JSON.stringify(req.result?.value ?? [])); };
    };
  }))).toContain('and three');
});

test('while Notes are locked the document stays in the chat and no card is made', async ({ page }) => {
  await seed(page, false);
  await scriptClaude(page, FILED);
  await newChat(page);
  await ask(page, 'write me a launch plan');
  await expect(page.locator('[data-chat-stream]')).toContainText('Saved the plan as a note.');
  await expect(page.locator('[data-chat-stream] .note-ref')).toHaveCount(0);
});

test('below 900px the pane covers the chat instead of squeezing it', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 700 });
  await seed(page);
  await scriptClaude(page, FILED);
  await newChat(page);
  await ask(page, 'write me a launch plan');
  await page.locator('[data-chat-stream] .note-ref').click();
  const pane = page.getByTestId('note-pane');
  await expect(pane).toHaveAttribute('data-beside', 'false');
  expect(Math.round((await pane.boundingBox())!.width)).toBe(800);
});
