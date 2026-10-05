import { test, expect, type Page, type Route } from '@playwright/test';
import { readPersistedState } from './helpers';

// Attachments and the Context panel in /web/: the `+` menu, files sent with a message, native PDF
// and image blocks for Claude, text-only for DeepSeek, branch transcripts attached as context,
// and the panel that shows the branch hierarchy. The picker is the browser's own file input,
// because the Playwright server reports the native dialog as cancelled (BUGS.md #022).

const WEB = '/web/';
type Block = { type: string; text?: string; source?: { media_type?: string; data?: string } };
type Body = { system?: string; messages: Array<{ role: string; content: string | Block[] }> };

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const sse = (events: unknown[]): string => events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('');
const reply = (text: string): string => sse([
  { type: 'message_start', message: { usage: { input_tokens: 10 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } },
]);

async function claude(page: Page, text = 'Noted. Alpha and beta seen.'): Promise<Body[]> {
  const bodies: Body[] = [];
  await page.route('https://api.anthropic.com/v1/messages', async (route: Route) => {
    bodies.push(JSON.parse(route.request().postData() ?? '{}') as Body);
    await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: reply(text) });
  });
  return bodies;
}
async function chat(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('nl_api_keys', JSON.stringify({ anthropic: 'sk-ant-TESTONLY-a', deepseek: 'sk-ds-TESTONLY-d' })));
  await page.goto(WEB);
  await page.getByRole('button', { name: 'Open left pane' }).click();
  await page.getByRole('button', { name: /New chat/ }).click();
  await page.getByRole('button', { name: 'Close left pane' }).click();
}
async function pick(page: Page, trigger: () => Promise<void>, files: Array<{ name: string; mimeType: string; buffer: Buffer }>): Promise<void> {
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), trigger()]);
  await chooser.setFiles(files);
}
const composer = (page: Page) => page.getByRole('textbox', { name: 'Message' }).locator('xpath=ancestor::div[contains(@class,"rounded-[14px]")][1]');
const chips = (page: Page) => composer(page).getByTestId('file-chip');
async function addFile(page: Page, name: string, mime: string, buffer: Buffer): Promise<void> {
  await pick(page, async () => {
    await composer(page).getByRole('button', { name: 'Add files or folder' }).click();
    await page.getByRole('menuitem', { name: 'Add files' }).click();
  }, [{ name, mimeType: mime, buffer }]);
}
async function ask(page: Page, text: string): Promise<void> {
  const box = page.getByRole('textbox', { name: 'Message' });
  if (text) await box.fill(text);
  await box.press('Enter');
}
const persisted = async (page: Page) => (await readPersistedState(page)) as unknown as { threads: Record<string, { stream?: string; mainMessages?: Array<{ role: string; content: unknown }>; title?: string }> };

test.describe('the + menu', () => {
  test('offers files, folder and branch; Esc closes it', async ({ page }) => {
    await claude(page);
    await chat(page);
    await composer(page).getByRole('button', { name: 'Add files or folder' }).click();
    const menu = page.getByRole('menu', { name: 'Add to this message' });
    await expect(menu.getByRole('menuitem')).toHaveText(['Add files', 'Add folder', 'Attach branch']);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
  });
});

test.describe('files sent with a message', () => {
  test('a text file becomes a chip, is sent as context ahead of the question, shows in the bubble, and is used up', async ({ page }) => {
    const bodies = await claude(page);
    await chat(page);
    await addFile(page, 'notes.txt', 'text/plain', Buffer.from('The secret word is pineapple.'));
    await expect(chips(page)).toHaveCount(1);
    await expect(chips(page).first()).toContainText('notes.txt');
    await expect(chips(page).first()).toContainText('29B');

    await ask(page, 'what is the word?');
    await expect(page.locator('[data-chat-stream] .chat-stream .msg.ai .ai-content')).toContainText('Noted.');
    expect(bodies[0]!.messages[0]!.content).toContain('<attached_file name="notes.txt"');
    expect(bodies[0]!.messages[0]!.content).toContain('The secret word is pineapple.');
    expect(String(bodies[0]!.messages[0]!.content)).toMatch(/User request:\nwhat is the word\?$/);

    // the bubble keeps a chip, and the files are gone from the composer
    await expect(page.locator('[data-chat-stream] .msg.user .file-chip')).toContainText('notes.txt');
    await expect(chips(page)).toHaveCount(0);
    // only the question is saved as the message; the file text is not repeated in history
    const t = Object.values((await persisted(page)).threads).find(x => (x.mainMessages?.length ?? 0) === 2)!;
    expect(t.mainMessages![0]).toEqual({ role: 'user', content: 'what is the word?' });
  });

  test('a file with no question asks for a summary, and the chat is named after the file', async ({ page }) => {
    const bodies = await claude(page);
    await chat(page);
    await addFile(page, 'report.md', 'text/markdown', Buffer.from('# Report'));
    await expect(page.getByRole('button', { name: 'Send' })).toBeEnabled(); // no text, but there is a file
    await ask(page, '');
    await expect(page.locator('[data-chat-stream] .chat-stream .msg.ai .ai-content')).toContainText('Noted.');
    expect(String(bodies[0]!.messages[0]!.content)).toMatch(/User request:\nPlease summarize the attached file\(s\)\.$/);
    await expect.poll(async () => Object.values((await persisted(page)).threads).some(x => x.title === 'report.md')).toBe(true);
  });

  test('a chip can be removed before sending', async ({ page }) => {
    const bodies = await claude(page);
    await chat(page);
    await addFile(page, 'a.txt', 'text/plain', Buffer.from('aaa'));
    await addFile(page, 'b.txt', 'text/plain', Buffer.from('bbb'));
    await expect(chips(page)).toHaveCount(2);
    await chips(page).first().getByRole('button', { name: 'Remove a.txt' }).click();
    await expect(chips(page)).toHaveCount(1);
    await ask(page, 'go');
    await expect(page.locator('[data-chat-stream] .chat-stream .msg.ai .ai-content')).toContainText('Noted.');
    const content = String(bodies[0]!.messages[0]!.content);
    expect(content).toContain('b.txt');
    expect(content).not.toContain('a.txt');
  });

  test('Claude is sent an image as a native block; its thumbnail opens a full-size preview that Esc closes', async ({ page }) => {
    const bodies = await claude(page);
    await chat(page);
    await addFile(page, 'pixel.png', 'image/png', PNG);
    await expect(chips(page).first().locator('img')).toBeVisible();
    await ask(page, 'what is this?');
    await expect(page.locator('[data-chat-stream] .chat-stream .msg.ai .ai-content')).toContainText('Noted.');

    const blocks = bodies[0]!.messages[0]!.content as Block[];
    expect(blocks.map(b => b.type)).toEqual(['image', 'text']);
    expect(blocks[0]!.source).toMatchObject({ media_type: 'image/png', data: PNG.toString('base64') });

    const thumb = page.locator('[data-chat-stream] .msg.user .msg-image');
    await expect(thumb).toBeVisible();
    await thumb.click();
    await expect(page.getByTestId('image-preview')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('image-preview')).toHaveCount(0);
  });

  test('an image pasted into the composer is attached', async ({ page }) => {
    await claude(page);
    await chat(page);
    await page.getByRole('textbox', { name: 'Message' }).click();
    await page.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const file = new File([bytes], 'pasted.png', { type: 'image/png' });
      const dt = new DataTransfer();
      dt.items.add(file);
      const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
      document.activeElement!.dispatchEvent(ev);
    }, PNG.toString('base64'));
    await expect(chips(page)).toHaveCount(1);
    await expect(chips(page).first()).toContainText('pasted.png');
  });

  test('DeepSeek is sent the same files as text only (no native blocks)', async ({ page }) => {
    await page.route('https://api.deepseek.com/v1/chat/completions', route => {
      (page as unknown as { __ds: unknown }).__ds = JSON.parse(route.request().postData() ?? '{}');
      return route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: sse([{ choices: [{ delta: { content: 'ok' }, finish_reason: null }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }]) + 'data: [DONE]\n\n' });
    });
    await chat(page);
    await page.locator('.model-chip').click();
    await page.getByRole('menuitem', { name: /DeepSeek Flash/ }).click();
    await addFile(page, 'doc.txt', 'text/plain', Buffer.from('plain words for deepseek'));
    await expect(chips(page)).toHaveCount(1);
    await ask(page, 'read it');
    await expect(page.locator('[data-chat-stream] .chat-stream .msg.ai .ai-content')).toContainText('ok');
    const sent = (page as unknown as { __ds: { messages: Array<{ role: string; content: unknown }> } }).__ds;
    const user = sent.messages.find(m => m.role === 'user')!;
    expect(typeof user.content).toBe('string');
    expect(String(user.content)).toContain('<attached_file name="doc.txt"');
    expect(String(user.content)).toContain('plain words for deepseek');
  });

  test('files in a branch panel are the branch\'s own; they are sent with its next message and used up', async ({ page }) => {
    const bodies = await claude(page, 'Reply with alpha and beta words.');
    await chat(page);
    await ask(page, 'start');
    await expect(page.locator('[data-chat-stream] .chat-stream .msg.ai .ai-content')).toContainText('alpha and beta');
    await page.evaluate(() => {
      const root = document.querySelector('[data-chat-stream] .msg.ai .ai-content')!;
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); w.nextNode();
      const n = w.currentNode as Text; const i = n.nodeValue!.indexOf('alpha and beta');
      const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 'alpha and beta'.length);
      const s = getSelection()!; s.removeAllRanges(); s.addRange(r);
    });
    await page.keyboard.press('b');
    const panel = page.locator('[data-testid="branch-stack"] .branch').first();
    await pick(page, async () => {
      await panel.getByRole('button', { name: 'Add files or folder' }).click();
      await page.getByRole('menuitem', { name: 'Add files' }).click();
    }, [{ name: 'branch-notes.txt', mimeType: 'text/plain', buffer: Buffer.from('only for the branch') }]);
    await expect(panel.getByTestId('file-chip')).toHaveCount(1);
    await expect(composer(page).getByTestId('file-chip')).toHaveCount(0); // not on the main composer
    await panel.getByRole('textbox', { name: 'Ask about this passage' }).fill('use my file');
    await panel.getByRole('textbox', { name: 'Ask about this passage' }).press('Enter');
    await expect(panel.locator('.branch-body .msg.ai .ai-content')).toContainText('alpha and beta');
    const sent = JSON.stringify(bodies[1]!.messages.at(-1)!.content);
    expect(sent).toContain('only for the branch');
    expect(sent).toContain('I\'ve highlighted this passage to explore');
    await expect(panel.getByTestId('file-chip')).toHaveCount(0);
  });
});

test.describe('Context panel', () => {
  async function twoBranches(page: Page): Promise<{ pid: string; cid: string }> {
    await claude(page, 'Reply with alpha and beta words, then more words to branch.');
    await chat(page);
    await ask(page, 'start');
    await expect(page.locator('[data-chat-stream] .chat-stream .msg.ai .ai-content')).toContainText('alpha and beta');
    const sel = async (scope: string, phrase: string) => page.evaluate(({ scope, phrase }) => {
      const root = document.querySelector(scope)!;
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (w.nextNode()) { const n = w.currentNode as Text; const i = n.nodeValue!.indexOf(phrase); if (i >= 0) { const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + phrase.length); const s = getSelection()!; s.removeAllRanges(); s.addRange(r); return; } }
    }, { scope, phrase });
    await sel('[data-chat-stream] .msg.ai .ai-content', 'alpha and beta');
    await page.keyboard.press('b');
    const parent = page.locator('[data-testid="branch-stack"] .branch').first();
    const pid = (await parent.getAttribute('data-bid'))!;
    await parent.getByRole('textbox', { name: 'Ask about this passage' }).fill('parent q');
    await parent.getByRole('textbox', { name: 'Ask about this passage' }).press('Enter');
    await expect(parent.locator('.branch-body .msg.ai .ai-content')).toContainText('alpha and beta');
    await sel(`.branch[data-bid="${pid}"] .branch-body .msg.ai .ai-content`, 'more words');
    await page.keyboard.press('b');
    await expect(page.locator('[data-testid="branch-stack"] .branch')).toHaveCount(2);
    const cid = (await page.locator('[data-testid="branch-stack"] .branch').evaluateAll((els, p) => els.map(e => (e as HTMLElement).dataset.bid).find(b => b !== p), pid))!;
    return { pid, cid };
  }

  test('shows the hierarchy: the chat, the turn each branch came from, and sub-branches under their parent', async ({ page }) => {
    const { pid, cid } = await twoBranches(page);
    await page.getByRole('button', { name: 'Context and files' }).click();
    const panel = page.getByTestId('ctx-panel');
    await expect(panel).toHaveAttribute('aria-hidden', 'false');
    const tree = panel.getByTestId('ctx-tree');
    await expect(tree).toContainText('Workspace');
    await expect(tree).toContainText('start'); // the page, titled from the first question
    await expect(tree.locator(`[data-ctx-branch="${pid}"]`)).toContainText('alpha and beta');
    await expect(tree.locator(`[data-ctx-branch="${cid}"]`)).toBeVisible();
    // the sub-branch is nested inside its parent's block
    expect(await tree.locator(`[data-ctx-branch="${pid}"]`).evaluate((el, id) => !!el.parentElement!.querySelector(`[data-ctx-branch="${id}"]`), cid)).toBe(true);
    await expect(panel).toContainText('No files attached to this page.');
  });

  test('turn count previews the last turns; the chevron folds sub-branches; clicking a branch opens it; the bin deletes it', async ({ page }) => {
    const { pid, cid } = await twoBranches(page);
    await page.getByRole('button', { name: 'Context and files' }).click();
    const panel = page.getByTestId('ctx-panel');
    const parentRow = panel.locator(`[data-ctx-branch="${pid}"]`);
    await parentRow.getByRole('button', { name: /turn/ }).click();
    await expect(panel).toContainText('parent q');
    await parentRow.getByRole('button', { name: 'Toggle sub-branches' }).click();
    await expect(panel.locator(`[data-ctx-branch="${cid}"]`)).toHaveCount(0);
    await parentRow.getByRole('button', { name: 'Toggle sub-branches' }).click();
    await expect(panel.locator(`[data-ctx-branch="${cid}"]`)).toBeVisible();

    // close the panels, then reopen one from the tree
    await page.keyboard.press('Escape'); // closes the Context panel first
    await expect(panel).toHaveAttribute('aria-hidden', 'true');
    await page.getByRole('button', { name: 'Context and files' }).click();
    await panel.locator(`[data-ctx-branch="${cid}"]`).click();
    await expect(page.locator(`.branch[data-bid="${cid}"]`)).toBeVisible();

    await panel.locator(`[data-ctx-branch="${cid}"]`).hover();
    await panel.locator(`[data-ctx-branch="${cid}"]`).getByRole('button', { name: /^Delete/ }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete branch' }).click();
    await expect(panel.locator(`[data-ctx-branch="${cid}"]`)).toHaveCount(0);
  });

  test('Attach branch: clicking branches adds their transcripts to the next message, clicking again removes; they are sent as context', async ({ page }) => {
    const { pid } = await twoBranches(page);
    // back on the main composer, attach the parent branch as context
    await composer(page).getByRole('button', { name: 'Add files or folder' }).click();
    await page.getByRole('menuitem', { name: 'Attach branch' }).click();
    const panel = page.getByTestId('ctx-panel');
    await expect(panel).toHaveAttribute('aria-hidden', 'false');
    await expect(page.getByTestId('ctx-picker-note')).toBeVisible();

    const row = panel.locator(`[data-ctx-branch="${pid}"]`);
    await row.click();
    await expect(row).toHaveAttribute('aria-pressed', 'true');
    await expect(composer(page).getByTestId('file-chip')).toHaveCount(1);
    await expect(composer(page).getByTestId('file-chip').first()).toContainText('turn');
    await row.click(); // again: removed
    await expect(row).toHaveAttribute('aria-pressed', 'false');
    await expect(composer(page).getByTestId('file-chip')).toHaveCount(0);
    await row.click();
    await page.keyboard.press('Escape');

    const bodies: Body[] = [];
    await page.unroute('https://api.anthropic.com/v1/messages');
    await page.route('https://api.anthropic.com/v1/messages', async route => {
      bodies.push(JSON.parse(route.request().postData() ?? '{}') as Body);
      await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: reply('Seen.') });
    });
    await ask(page, 'compare with that branch');
    await expect(page.locator('[data-chat-stream] .chat-stream .msg.ai .ai-content').last()).toContainText('Seen.');
    const content = String(bodies[0]!.messages.at(-1)!.content);
    expect(content).toContain('<attached_branch quote="alpha and beta">');
    expect(content).toContain('Quote explored: "alpha and beta"');
    expect(content).toContain('[user] parent q');
    expect(content).toMatch(/User request:\ncompare with that branch$/);
    await expect(composer(page).getByTestId('file-chip')).toHaveCount(0); // used up
  });

  test('page files: add from the panel, see them listed, remove them; they go with the next message', async ({ page }) => {
    await claude(page);
    await chat(page);
    await page.getByRole('button', { name: 'Context and files' }).click();
    const panel = page.getByTestId('ctx-panel');
    await pick(page, () => panel.getByRole('button', { name: 'Add files to this page' }).click(), [{ name: 'page.txt', mimeType: 'text/plain', buffer: Buffer.from('page file body') }]);
    await expect(panel.getByTestId('file-chip')).toContainText('page.txt');
    await expect(composer(page).getByTestId('file-chip')).toContainText('page.txt'); // the same files, on the composer
    await panel.getByRole('button', { name: 'Remove page.txt' }).click();
    await expect(panel).toContainText('No files attached to this page.');
  });
});
