import { test, expect, type Page, type Route } from '@playwright/test';

// Global shortcuts in /web/: branch (⌘⇧B), copy last reply (⌘⇧C), and the ⌘/ sheet, canvas zoom.
// Provider calls are mocked; nothing here reaches a real API. Playwright's
// Control stands in for Meta: the handler accepts either.

const WEB = '/web/';
const KEYS = { anthropic: 'sk-ant-TESTONLY-short-aaaaaaaa', deepseek: 'sk-ds-TESTONLY-short-bbbbbbbb' };
const REPLY = '[data-chat-stream] .chat-stream .msg.ai .ai-content';

async function mockReply(page: Page): Promise<void> {
  await page.route('https://api.anthropic.com/v1/messages', async (route: Route) => {
    const text = 'Reply says alpha and beta together with some filler words.';
    const events = [
      { type: 'message_start', message: { usage: { input_tokens: 10 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
      ...text.split(' ').map((w, i) => ({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: i ? ' ' + w : w } })),
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 8 } },
    ];
    await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('') });
  });
}

async function chatWithReply(page: Page): Promise<void> {
  await mockReply(page);
  await page.goto(WEB);
  await page.getByRole('button', { name: 'Open left pane' }).click();
  await page.getByRole('button', { name: /New chat/ }).click();
  await page.getByRole('button', { name: 'Close left pane' }).click();
  const box = page.getByRole('textbox', { name: 'Message' });
  await box.click();
  await box.fill('Tell me about things');
  await box.press('Enter');
  await expect(page.locator(REPLY)).toContainText('Reply says alpha and beta');
  await expect(page.getByRole('button', { name: 'Stop' })).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(k => localStorage.setItem('nl_api_keys', JSON.stringify(k)), KEYS);
});

test.describe('global shortcuts', () => {
  test('⌘/ opens the cheat sheet and Esc closes it', async ({ page }) => {
    await page.goto(WEB);
    await page.keyboard.press('Control+/');
    await expect(page.getByTestId('shortcuts-dialog')).toContainText('Branch from selection');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('shortcuts-dialog')).toHaveCount(0);
  });

  test('⌘⇧B branches from the selection; with nothing selected it says so', async ({ page }) => {
    await chatWithReply(page);
    await page.keyboard.press('Control+Shift+b');
    await expect(page.getByText('Select some text in a reply to branch from it')).toBeVisible();
    await expect(page.locator('[data-testid="branch-stack"] .branch')).toHaveCount(0);

    await page.evaluate(sel => {
      const root = document.querySelector(sel)!;
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (w.nextNode()) {
        const n = w.currentNode as Text;
        const i = n.nodeValue!.indexOf('alpha and beta');
        if (i < 0) continue;
        const r = document.createRange();
        r.setStart(n, i);
        r.setEnd(n, i + 'alpha and beta'.length);
        window.getSelection()!.removeAllRanges();
        window.getSelection()!.addRange(r);
        return;
      }
    }, REPLY);
    await page.keyboard.press('Control+Shift+b');
    await expect(page.locator('[data-testid="branch-stack"] .branch')).toHaveCount(1);
  });

  test('⌘⇧C copies the last reply', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await chatWithReply(page);
    await page.keyboard.press('Control+Shift+c');
    await expect(page.getByText('Reply copied')).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('Reply says alpha and beta together with some filler words.');
  });

  test('⌘⇧R with no failed reply says there is nothing to retry', async ({ page }) => {
    await chatWithReply(page);
    await page.keyboard.press('Control+Shift+r');
    await expect(page.getByText('Nothing to retry: the last reply finished')).toBeVisible();
  });

  test('canvas: ⌘+ zooms in, ⌘− zooms out, ⌘0 fits; the page itself is not zoomed', async ({ page }) => {
    await chatWithReply(page);
    await page.getByRole('button', { name: 'Branches — canvas view' }).click();
    const plane = page.getByTestId('canvas-plane');
    const scale = async (): Promise<number> => plane.evaluate(el => {
      const m = (el as HTMLElement).style.transform.match(/scale\(([\d.]+)\)/);
      return m ? Number(m[1]) : NaN;
    });
    expect(await scale()).toBe(1);
    await page.keyboard.press('Control+=');
    expect(await scale()).toBeGreaterThan(1);
    await page.keyboard.press('Control+-');
    await page.keyboard.press('Control+-');
    expect(await scale()).toBeLessThan(1);
    await page.keyboard.press('Control+0');
    expect(await scale()).toBeLessThanOrEqual(1);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('branch-canvas')).toHaveCount(0);
  });

  test('canvas zoom keys do nothing when the canvas is closed', async ({ page }) => {
    await chatWithReply(page);
    await page.keyboard.press('Control+=');
    await expect(page.getByTestId('branch-canvas')).toHaveCount(0);
  });
});
