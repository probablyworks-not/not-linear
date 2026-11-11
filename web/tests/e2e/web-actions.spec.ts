import { test, expect, type Page, type Route } from '@playwright/test';

// P5: the row under each reply (Copy, Download .md, Continue) and the collapsible usage line.
// The usage line is part of the SAVED reply, so legacy shows it on a reply React wrote.

const WEB = '/web/';
const CONTINUE_PROMPT = 'Continue from exactly where you stopped. Do not recap or restart; continue the previous answer from the next word or sentence.';
type Body = { system?: string; messages: Array<{ role: string; content: string }> };

const sse = (events: unknown[]): string => events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('');
const reply = (text: string, stop = 'end_turn'): string => sse([
  { type: 'message_start', message: { usage: { input_tokens: 40 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
  { type: 'message_delta', delta: { stop_reason: stop }, usage: { output_tokens: 12 } },
]);

async function claude(page: Page, replies: Array<string | ((n: number) => string)>): Promise<Body[]> {
  const bodies: Body[] = [];
  await page.route('https://api.anthropic.com/v1/messages', async (route: Route) => {
    const n = bodies.length;
    bodies.push(JSON.parse(route.request().postData() ?? '{}') as Body);
    const r = replies[Math.min(n, replies.length - 1)]!;
    await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: typeof r === 'function' ? r(n) : r });
  });
  return bodies;
}
async function chat(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('nl_api_keys', JSON.stringify({ anthropic: 'sk-ant-TESTONLY-a' })));
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
const replyEl = (page: Page) => page.locator('[data-chat-stream] .chat-stream .msg.ai .ai-content');
const actions = (page: Page) => page.locator('[data-chat-stream] [data-testid="msg-actions"]');

test.describe('usage line', () => {
  test('a finished reply carries a collapsible model/tokens/cost line, with the full context a click away; it survives reload and shows in legacy', async ({ page }) => {
    await claude(page, [reply('The Moon causes tides.')]);
    await chat(page);
    await ask(page, 'why tides?');
    await expect(replyEl(page)).toContainText('The Moon causes tides.');

    const meta = page.locator('[data-chat-stream] .llm-meta');
    await expect(meta).toHaveCount(1);
    await expect(meta.locator('summary')).toContainText('Claude Sonnet 5 · 52 tokens');
    await expect(meta.locator('.llm-summary-cost')).toHaveText('$0.00030');
    await expect(meta.locator('.llm-context')).toBeHidden();
    await meta.locator('summary').click();
    await expect(meta.locator('.llm-context')).toBeVisible();
    await expect(meta.locator('.llm-context')).toContainText('SYSTEM');
    await expect(meta.locator('.llm-context')).toContainText('You are a research assistant embedded in a non-linear thinking canvas called Notlinear.');
    await expect(meta.locator('.llm-context')).toContainText('why tides?');

    await page.reload();
    await expect(page.locator('[data-chat-stream] .llm-meta summary')).toContainText('Claude Sonnet 5 · 52 tokens');
  });
});

test.describe('Copy and Download', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  test('Copy puts the reply\'s markdown on the clipboard and says so', async ({ page }) => {
    await claude(page, [reply('## Heading\n\nSome **bold** text.')]);
    await chat(page);
    await ask(page, 'give me markdown');
    await expect(replyEl(page)).toContainText('Some bold text.');
    const row = actions(page).first();
    await expect(row.getByRole('button')).toHaveText(['Copy', 'Download .md']);
    await row.getByRole('button', { name: /Copy/ }).click();
    await expect(row.getByRole('button', { name: 'Copied!' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('## Heading\n\nSome **bold** text.');
  });

  test('Download .md asks the local server to save it, named from the reply or the chat title', async ({ page }) => {
    const saves: Array<{ filename: string; content: string }> = [];
    await page.route('**/__notlinear_save_file', route => { saves.push(JSON.parse(route.request().postData() ?? '{}')); return route.fulfill({ json: { ok: true } }); });
    await claude(page, [reply('Plain answer.'), reply('Saved as `notes/PLAN.md` for you.')]);
    await chat(page);
    await ask(page, 'First Question?');
    await expect(replyEl(page)).toContainText('Plain answer.');
    await actions(page).first().getByRole('button', { name: /Download/ }).click();
    await expect.poll(() => saves.length).toBe(1);
    expect(saves[0]).toEqual({ filename: 'first-question.md', content: 'Plain answer.' });

    await ask(page, 'second');
    await expect(replyEl(page).last()).toContainText('PLAN.md');
    await actions(page).last().getByRole('button', { name: /Download/ }).click();
    await expect.poll(() => saves.length).toBe(2);
    expect(saves[1]!.filename).toBe('PLAN.md'); // the reply named a file, so that is the name
  });
});

test.describe('Continue', () => {
  test('a reply cut off by the limit offers Continue; it carries on as a new "Continue" turn, up to three times', async ({ page }) => {
    const bodies = await claude(page, [(n: number) => reply(`part${n + 1} `, 'max_tokens')]);
    await chat(page);
    await ask(page, 'write a lot');
    await expect(replyEl(page)).toContainText('part1');
    const row = actions(page).last();
    await expect(row.getByRole('button')).toHaveText(['Continue']); // only Continue, no Copy/Download, as in legacy

    await row.getByRole('button', { name: 'Continue' }).click();
    await expect(replyEl(page).last()).toContainText('part2');
    expect(bodies[1]!.messages.map(m => m.content)).toEqual(['write a lot', 'part1 ', CONTINUE_PROMPT]);
    await expect(page.locator('[data-chat-stream] .msg.user').last()).toContainText('Continue');
    await expect(actions(page).last().getByRole('button')).toHaveText(['Continue (1/3)']);

    await actions(page).last().getByRole('button', { name: /Continue/ }).click();
    await expect(replyEl(page).last()).toContainText('part3');
    await actions(page).last().getByRole('button', { name: /Continue/ }).click();
    await expect(replyEl(page).last()).toContainText('part4');
    await expect(actions(page).last()).toContainText('Max continuations reached (3/3) — start a new message to go further.');
    await expect(actions(page).last().getByRole('button')).toHaveCount(0);
  });

  test('a normal reply has no Continue; after a reload a reply that stops mid-sentence still does', async ({ page }) => {
    await claude(page, [reply('A complete answer.'), reply('The reason is that tides are a product of')]);
    await chat(page);
    await ask(page, 'one');
    await expect(replyEl(page)).toContainText('A complete answer.');
    await expect(actions(page).last().getByRole('button')).toHaveText(['Copy', 'Download .md']);

    await ask(page, 'two');
    await expect(replyEl(page).last()).toContainText('a product of');
    await page.reload();
    await expect(replyEl(page).last()).toContainText('a product of');
    await expect(actions(page).last().getByRole('button')).toHaveText(['Continue']);
    await expect(actions(page).first().getByRole('button')).toHaveText(['Copy', 'Download .md']); // earlier replies are unaffected
  });

  test('a branch panel has the same row, and continues with its own context', async ({ page }) => {
    const bodies = await claude(page, [reply('Main answer about alpha and beta.'), reply('Branch part one ', 'max_tokens'), reply('and part two.')]);
    await chat(page);
    await ask(page, 'start');
    await expect(replyEl(page)).toContainText('Main answer');
    await page.evaluate(() => {
      const root = document.querySelector('[data-chat-stream] .msg.ai .ai-content')!;
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); w.nextNode();
      const n = w.currentNode as Text; const i = n.nodeValue!.indexOf('alpha and beta');
      const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 'alpha and beta'.length);
      const s = getSelection()!; s.removeAllRanges(); s.addRange(r);
    });
    await page.keyboard.press('b');
    const panel = page.locator('[data-testid="branch-stack"] .branch').first();
    await panel.getByRole('textbox', { name: 'Ask about this passage' }).fill('go on');
    await panel.getByRole('textbox', { name: 'Ask about this passage' }).press('Enter');
    await expect(panel.locator('.branch-body .msg.ai .ai-content')).toContainText('Branch part one');
    const row = panel.locator('[data-testid="msg-actions"]');
    await expect(row.getByRole('button')).toHaveText(['Continue']);
    await row.getByRole('button', { name: 'Continue' }).click();
    await expect(panel.locator('.branch-body .msg.ai .ai-content').last()).toContainText('and part two.');
    expect(bodies[2]!.messages.at(-1)!.content).toBe(CONTINUE_PROMPT);
    expect(bodies[2]!.messages.map(m => m.content)).toContain('Exploring: "alpha and beta"');
    await expect(panel.locator('.branch-body .msg.user').last()).toContainText('Continue');
  });
});

test.describe('working status', () => {
  test('before the answer starts there is a working indicator with a changing word, and it is gone once the answer streams', async ({ page }) => {
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    await page.route('https://api.anthropic.com/v1/messages', async route => { await gate; await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: reply('Finally.') }); });
    await chat(page);
    await ask(page, 'slow one');
    const working = page.locator('[data-chat-stream] [data-live] .working-status');
    await expect(working).toBeVisible();
    await expect(working.locator('.working-text')).toHaveText(/\S/);
    release();
    await expect(replyEl(page)).toContainText('Finally.');
    await expect(page.locator('[data-chat-stream] .working-status')).toHaveCount(0);
  });
});
