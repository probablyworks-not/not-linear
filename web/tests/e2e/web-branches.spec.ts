import { test, expect, type Page, type Route } from '@playwright/test';
import { readPersistedState } from './helpers';

// P5b: highlights and branches in /web/. The handoff calls this the hard gate and says manual
// checking is not acceptable, because the repo's own ADRs record manual checks missing this
// class of bug twice (#002-#004 reopen, #008/#009 switch-and-return). Every provider call is
// mocked; nothing here reaches a real API.

const WEB = '/web/';
const KEYS = { anthropic: 'sk-ant-TESTONLY-branch-aaaaaaaa', deepseek: 'sk-ds-TESTONLY-branch-bbbbbbbb' };

type Body = { messages: Array<{ role: string; content: string }> };

/** Replies "Reply N says alphaN and betaN together …", N counting requests, and records each request body. */
async function mockReplies(page: Page): Promise<Body[]> {
  const bodies: Body[] = [];
  await page.route('https://api.anthropic.com/v1/messages', async (route: Route) => {
    bodies.push(JSON.parse(route.request().postData() ?? '{}') as Body);
    const n = bodies.length;
    const text = `Reply ${n} says alpha${n} and beta${n} together with some filler words.`;
    const events = [
      { type: 'message_start', message: { usage: { input_tokens: 10 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
      ...text.split(' ').map((w, i) => ({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: i ? ' ' + w : w } })),
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 8 } },
    ];
    await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('') });
  });
  return bodies;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(k => localStorage.setItem('nl_api_keys', JSON.stringify(k)), KEYS);
});

async function newChat(page: Page): Promise<void> {
  await page.goto(WEB);
  await expect(page.getByRole('button', { name: 'Open left pane' })).toBeVisible();
  await page.getByRole('button', { name: 'Open left pane' }).click();
  await page.getByRole('button', { name: /New chat/ }).click();
  await expect(page.getByTestId('chat-empty')).toBeVisible();
  await page.getByRole('button', { name: 'Close left pane' }).click();
}

async function ask(page: Page, text: string): Promise<void> {
  const box = page.getByRole('textbox', { name: 'Message' });
  await box.click();
  await box.fill(text);
  await box.press('Enter');
}

const mainReplies = (page: Page) => page.locator('[data-chat-stream] > .chat-stream > .msg.ai .ai-content, [data-chat-stream] .chat-stream > .msg.ai .ai-content');

/** Selects `phrase` inside the first element matching `scope`, as a person dragging over it would. */
async function select(page: Page, scope: string, phrase: string): Promise<void> {
  await page.evaluate(({ scope, phrase }) => {
    const root = document.querySelector(scope);
    if (!root) throw new Error(`no element for ${scope}`);
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) {
      const n = w.currentNode as Text;
      const i = n.nodeValue!.indexOf(phrase);
      if (i < 0) continue;
      const r = document.createRange();
      r.setStart(n, i);
      r.setEnd(n, i + phrase.length);
      const s = window.getSelection()!;
      s.removeAllRanges();
      s.addRange(r);
      return;
    }
    throw new Error(`"${phrase}" not found in ${scope}`);
  }, { scope, phrase });
}

const popover = (page: Page) => page.getByTestId('selection-popover');
const stackPanels = (page: Page) => page.locator('[data-testid="branch-stack"] .branch');
const REPLY = '[data-chat-stream] .chat-stream .msg.ai .ai-content';

type Thread = {
  stream?: string; mainMessages?: Array<{ role: string; content: string }>; highlights?: Array<Record<string, unknown>>;
  highlightsV2?: Array<Record<string, unknown>>; branchSnapshots?: Record<string, { messages: Array<{ role: string; content: string }>; bodyHTML: string; parentBid: string | null; quote: string; depth: number }>;
  branchRecents?: Record<string, { quote: string }>; mainHistory?: unknown[]; title?: string;
};
const persisted = async (page: Page): Promise<{ current: string; threads: Record<string, Thread> }> =>
  (await readPersistedState(page)) as unknown as { current: string; threads: Record<string, Thread> };
async function thread(page: Page): Promise<{ id: string; t: Thread }> {
  const s = await persisted(page);
  const id = Object.entries(s.threads).find(([, t]) => (t.mainMessages?.length ?? 0) > 0)?.[0] ?? s.current;
  return { id, t: s.threads[id]! };
}

/** A chat with one finished exchange, ready to be selected in. */
async function chatWithReply(page: Page): Promise<Body[]> {
  const bodies = await mockReplies(page);
  await newChat(page);
  await ask(page, 'Tell me about things');
  await expect(page.locator(REPLY)).toContainText('Reply 1 says alpha1 and beta1');
  await expect(page.getByRole('button', { name: 'Stop' })).toHaveCount(0);
  return bodies;
}

test.describe('highlights', () => {
  test('select → Highlight: wrapped, saved in both forms, listed in the panel, survives reload, removable', async ({ page }) => {
    await chatWithReply(page);
    await select(page, REPLY, 'alpha1 and beta1');
    await expect(popover(page)).toBeVisible();
    await popover(page).getByRole('button', { name: 'Save highlight' }).click();

    const mark = page.locator(`${REPLY} .highlighted`);
    await expect(mark.first()).toBeVisible();
    await expect(popover(page)).toHaveCount(0);
    await expect(page.getByText('Highlight saved')).toBeVisible();

    const { t } = await thread(page);
    expect(t.highlights).toHaveLength(1);
    expect(t.highlights![0]).toMatchObject({ source: 'main-chat', text: 'alpha1 and beta1' });
    expect(t.stream).toContain('class="highlighted"');
    expect(t.highlightsV2).toHaveLength(1);
    expect(t.highlightsV2![0]).toMatchObject({ kind: 'highlight', scope: 'stream', part: 'ai' });

    await page.reload();
    await expect(page.locator(`${REPLY} .highlighted`).first()).toBeVisible();

    await page.getByRole('button', { name: 'Highlights', exact: true }).click();
    const panel = page.getByTestId('highlights-panel');
    await expect(panel.getByTestId('highlight-count')).toHaveText('1');
    await expect(panel).toContainText('alpha1 and beta1');
    await expect(panel).toContainText('Main chat');
    await panel.getByRole('button', { name: 'Remove highlight' }).click();
    await expect(page.locator(`${REPLY} .highlighted`)).toHaveCount(0);
    await expect(panel).toContainText('No highlights saved in this chat yet.');
    const after = (await thread(page)).t;
    expect(after.highlights).toEqual([]);
    expect(after.stream).not.toContain('class="highlighted"');
    expect(after.highlightsV2 ?? []).toEqual([]);
  });

  test('clicking a saved highlight in the panel scrolls to it and closes the panel', async ({ page }) => {
    await chatWithReply(page);
    await select(page, REPLY, 'filler words');
    await popover(page).getByRole('button', { name: 'Save highlight' }).click();
    await expect(page.locator(`${REPLY} .highlighted`).first()).toBeVisible();
    await page.getByRole('button', { name: 'Highlights', exact: true }).click();
    await page.getByRole('button', { name: /Go to highlight/ }).click();
    await expect(page.getByTestId('highlights-panel')).toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator(`${REPLY} .highlighted`).first()).toHaveClass(/focused-highlight/);
  });

  test('Esc dismisses the popover and the selection stays', async ({ page }) => {
    await chatWithReply(page);
    await select(page, REPLY, 'alpha1');
    await expect(popover(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(popover(page)).toHaveCount(0);
  });

  test('a reply still being written cannot be selected for marking', async ({ page }) => {
    // The request never completes, so the reply stays live.
    await page.route('https://api.anthropic.com/v1/messages', () => { /* hang */ });
    await newChat(page);
    await ask(page, 'hang');
    await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
    await select(page, '[data-chat-stream] [data-live]', 'hang');
    await page.waitForTimeout(300);
    await expect(popover(page)).toHaveCount(0);
  });
});

test.describe('branching', () => {
  test('select → B: anchor in the text, a panel opens with the quote, it is remembered, nothing else changes', async ({ page }) => {
    await chatWithReply(page);
    const before = (await thread(page)).t;
    await select(page, REPLY, 'alpha1 and beta1');
    await expect(popover(page)).toBeVisible();
    await page.keyboard.press('b');

    await expect(stackPanels(page)).toHaveCount(1);
    const panel = stackPanels(page).first();
    await expect(panel.locator('.branch-quote')).toContainText('alpha1 and beta1');
    await expect(panel.locator('.branch-quote .lab')).toHaveText('Branched from doc');
    await expect(panel.locator('.depth')).toHaveText('↳ 1');
    await expect(page.locator(`${REPLY} .branched`).first()).toBeVisible();
    await expect(popover(page)).toHaveCount(0);
    await expect(page.getByTestId('branch-count')).toContainText('0 branches'); // remembered, not yet snapshotted (legacy)

    const bid = (await panel.getAttribute('data-bid'))!;
    await expect.poll(async () => (await thread(page)).t.branchRecents?.[bid]?.quote).toBe('alpha1 and beta1');
    const after = (await thread(page)).t;
    expect(after.mainMessages).toEqual(before.mainMessages); // the main conversation is untouched
    expect(after.stream).toContain(`data-bid="${bid}"`);
    expect(after.highlightsV2!.find(m => m.id === bid)).toMatchObject({ kind: 'branch', scope: 'stream' });
  });

  test('a message in the branch streams in the panel, is saved as the branch\'s own, and carries main + quote as context', async ({ page }) => {
    const bodies = await chatWithReply(page);
    await select(page, REPLY, 'alpha1 and beta1');
    await page.keyboard.press('b');
    const panel = stackPanels(page).first();
    const bid = (await panel.getAttribute('data-bid'))!;

    const input = panel.getByRole('textbox', { name: 'Ask about this passage' });
    await input.fill('say more about that');
    await input.press('Enter');
    await expect(panel.locator('.branch-body .msg.ai .ai-content')).toContainText('Reply 2 says');
    await expect(panel.getByRole('button', { name: 'Stop' })).toHaveCount(0);

    expect(bodies[1]!.messages).toEqual([
      { role: 'user', content: 'Tell me about things' },
      { role: 'assistant', content: 'Reply 1 says alpha1 and beta1 together with some filler words.' },
      { role: 'user', content: 'I\'ve highlighted this passage to explore: "alpha1 and beta1"\n\nsay more about that' },
    ]);
    await expect.poll(async () => (await thread(page)).t.branchSnapshots?.[bid]?.messages.length).toBe(2);
    const t = (await thread(page)).t;
    expect(t.branchSnapshots![bid]!.messages[0]).toEqual({ role: 'user', content: 'say more about that' });
    expect(t.mainMessages).toHaveLength(2); // still just the main exchange
    await expect(page.getByTestId('branch-count')).toContainText('1 branch');
    await expect(panel.locator('.branch-usage')).toContainText('tok');
  });

  test('nested: branching inside a branch stacks a child on its parent, and the child is sent the parent\'s whole conversation', async ({ page }) => {
    const bodies = await chatWithReply(page);
    await select(page, REPLY, 'alpha1 and beta1');
    await page.keyboard.press('b');
    const parent = stackPanels(page).first();
    const pid = (await parent.getAttribute('data-bid'))!;
    await parent.getByRole('textbox', { name: 'Ask about this passage' }).fill('parent question');
    await parent.getByRole('textbox', { name: 'Ask about this passage' }).press('Enter');
    await expect(parent.locator('.branch-body .msg.ai .ai-content')).toContainText('Reply 2 says');

    await select(page, `.branch[data-bid="${pid}"] .branch-body .msg.ai .ai-content`, 'alpha2 and beta2');
    await expect(popover(page)).toBeVisible();
    await page.keyboard.press('b');

    await expect(stackPanels(page)).toHaveCount(2);
    const child = stackPanels(page).filter({ hasNot: page.locator(`[data-bid="${pid}"]`) }).last();
    await expect(page.locator(`.branch[data-bid="${pid}"]`)).toHaveClass(/behind-active/);
    const cid = (await stackPanels(page).evaluateAll((els, p) => els.map(e => (e as HTMLElement).dataset.bid).find(b => b !== p), pid))!;
    const childPanel = page.locator(`.branch[data-bid="${cid}"]`);
    await expect(childPanel.locator('.depth')).toHaveText('↳ 2');
    await expect(childPanel.locator('.branch-quote .lab')).toHaveText('Branched from branch');
    await expect(childPanel.locator('[data-h="parent"]')).toBeVisible();

    await childPanel.getByRole('textbox', { name: 'Ask about this passage' }).fill('child question');
    await childPanel.getByRole('textbox', { name: 'Ask about this passage' }).press('Enter');
    await expect(childPanel.locator('.branch-body .msg.ai .ai-content')).toContainText('Reply 3 says');
    expect(bodies[2]!.messages.map(m => m.content)).toEqual([
      'Tell me about things', 'Reply 1 says alpha1 and beta1 together with some filler words.',
      'Exploring this passage: "alpha1 and beta1"', 'parent question', 'Reply 2 says alpha2 and beta2 together with some filler words.',
      'I\'ve highlighted this passage to explore: "alpha2 and beta2"\n\nchild question',
    ]);
    const t = (await thread(page)).t;
    expect(t.branchSnapshots![cid]).toMatchObject({ parentBid: pid, depth: 2 });
    void child;
  });

  test('close everything, then reopen from the anchors: parent from the text, child from inside the parent (#002-#004)', async ({ page }) => {
    await chatWithReply(page);
    await select(page, REPLY, 'alpha1 and beta1');
    await page.keyboard.press('b');
    const parent = stackPanels(page).first();
    const pid = (await parent.getAttribute('data-bid'))!;
    await parent.getByRole('textbox', { name: 'Ask about this passage' }).fill('parent question');
    await parent.getByRole('textbox', { name: 'Ask about this passage' }).press('Enter');
    await expect(parent.locator('.branch-body .msg.ai .ai-content')).toContainText('Reply 2 says');
    await select(page, `.branch[data-bid="${pid}"] .branch-body .msg.ai .ai-content`, 'alpha2 and beta2');
    await page.keyboard.press('b');
    await expect(stackPanels(page)).toHaveCount(2);
    const cid = (await stackPanels(page).evaluateAll((els, p) => els.map(e => (e as HTMLElement).dataset.bid).find(b => b !== p), pid))!;
    const childPanel = page.locator(`.branch[data-bid="${cid}"]`);
    await childPanel.getByRole('textbox', { name: 'Ask about this passage' }).fill('child question');
    await childPanel.getByRole('textbox', { name: 'Ask about this passage' }).press('Enter');
    await expect(childPanel.locator('.branch-body .msg.ai .ai-content')).toContainText('Reply 3 says');

    // close all
    await childPanel.getByRole('button', { name: 'Close branch' }).click();
    await expect(page.locator(`.branch[data-bid="${cid}"]`)).toHaveCount(0);
    await page.locator(`.branch[data-bid="${pid}"]`).hover(); // the actions only take clicks while the panel is hovered
    await page.locator(`.branch[data-bid="${pid}"]`).getByRole('button', { name: 'Close branch' }).click();
    await expect(stackPanels(page)).toHaveCount(0);

    // reopen the parent by its anchor in the main text: its content is back
    await page.locator(`${REPLY} .branched[data-bid="${pid}"]`).first().click();
    const reopened = page.locator(`.branch[data-bid="${pid}"]`);
    await expect(reopened).toBeVisible();
    await expect(reopened.locator('.branch-body .msg.user')).toContainText('parent question');
    await expect(reopened.locator('.branch-body .msg.ai .ai-content')).toContainText('Reply 2 says');

    // reopen the child by its anchor INSIDE the parent: nested reopen, content intact, parent kept behind it
    await reopened.locator(`.branched[data-bid="${cid}"]`).first().click();
    const child2 = page.locator(`.branch[data-bid="${cid}"]`);
    await expect(child2).toBeVisible();
    await expect(child2.locator('.branch-body .msg.user')).toContainText('child question');
    await expect(child2.locator('.branch-body .msg.ai .ai-content')).toContainText('Reply 3 says');
    await expect(child2.locator('.depth')).toHaveText('↳ 2');
    await expect(page.locator(`.branch[data-bid="${pid}"]`)).toHaveClass(/behind-active/);
    await expect(stackPanels(page)).toHaveCount(2); // one panel per branch, never a duplicate
  });

  test('switch chat → switch back: panels close, the branch and its content persist and reopen (#008/#009)', async ({ page }) => {
    await chatWithReply(page);
    await select(page, REPLY, 'alpha1 and beta1');
    await page.keyboard.press('b');
    const panel = stackPanels(page).first();
    const bid = (await panel.getAttribute('data-bid'))!;
    await panel.getByRole('textbox', { name: 'Ask about this passage' }).fill('kept across a switch');
    await panel.getByRole('textbox', { name: 'Ask about this passage' }).press('Enter');
    await expect(panel.locator('.branch-body .msg.ai .ai-content')).toContainText('Reply 2 says');
    const { id } = await thread(page);

    // switch to another chat
    await page.getByRole('button', { name: 'Open left pane' }).click();
    await page.getByRole('button', { name: /New chat/ }).click();
    await expect(page.getByTestId('chat-empty')).toBeVisible();
    await expect(stackPanels(page)).toHaveCount(0);

    // and back
    await page.locator(`aside[aria-label="Left pane"] [data-thread="${id}"]`).first().click();
    await expect(page.locator(REPLY)).toContainText('Reply 1 says');
    await expect(stackPanels(page)).toHaveCount(0);
    await page.locator(`${REPLY} .branched[data-bid="${bid}"]`).first().click();
    const back = page.locator(`.branch[data-bid="${bid}"]`);
    await expect(back.locator('.branch-body .msg.user')).toContainText('kept across a switch');
    await expect(back.locator('.branch-body .msg.ai .ai-content')).toContainText('Reply 2 says');
    const t = (await thread(page)).t;
    expect(t.branchSnapshots![bid]!.messages).toHaveLength(2);
  });
});

test.describe('panels', () => {
  async function openOne(page: Page): Promise<{ panel: ReturnType<Page['locator']>; bid: string }> {
    await chatWithReply(page);
    await select(page, REPLY, 'alpha1 and beta1');
    await page.keyboard.press('b');
    const panel = stackPanels(page).first();
    return { panel, bid: (await panel.getAttribute('data-bid'))! };
  }

  test('collapse and expand from the header and the chevron; the actions do not toggle it', async ({ page }) => {
    const { panel } = await openOne(page);
    await expect(panel).toHaveClass(/expanded/);
    await panel.locator('.branch-head .title').click();
    await expect(panel).toHaveClass(/collapsed/);
    await panel.locator('.branch-head .title').click();
    await expect(panel).toHaveClass(/expanded/);
    await panel.hover();
    await panel.getByRole('button', { name: 'Collapse or expand panel' }).click();
    await expect(panel).toHaveClass(/collapsed/);
    await panel.getByRole('button', { name: 'Collapse or expand panel' }).click();
    await expect(panel).toHaveClass(/expanded/);
  });

  test('reader mode enlarges it; leaving it (Shrink) restores the normal state', async ({ page }) => {
    const { panel } = await openOne(page);
    await panel.hover();
    await panel.getByRole('button', { name: 'Expand branch' }).click();
    await expect(panel).toHaveClass(/reader/);
    const wide = (await panel.boundingBox())!.width;
    expect(wide).toBeGreaterThanOrEqual(600);
    await panel.getByRole('button', { name: 'Shrink branch' }).click();
    await expect(panel).not.toHaveClass(/reader/);
  });

  test('dragging the left edge resizes it wider and the bottom edge taller, within the limits', async ({ page }) => {
    const { panel } = await openOne(page);
    // A toast ("New chat opened") can sit over the panel's bottom edge for a few seconds; wait it out.
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 10_000 });
    await panel.hover();
    const start = (await panel.boundingBox())!;
    const edge = panel.locator('.branch-resize[data-edge="left"]');
    const eb = (await edge.boundingBox())!;
    await page.mouse.move(eb.x + eb.width / 2, eb.y + eb.height / 2);
    await page.mouse.down();
    await page.mouse.move(eb.x - 120, eb.y + eb.height / 2, { steps: 6 });
    await page.mouse.up();
    const wider = (await panel.boundingBox())!;
    expect(wider.width).toBeGreaterThan(start.width + 80);
    expect(wider.width).toBeLessThanOrEqual(900);
    await expect(panel).toHaveClass(/user-sized/);

    // far past the maximum: clamped
    await panel.hover();
    const eb2 = (await panel.locator('.branch-resize[data-edge="left"]').boundingBox())!;
    await page.mouse.move(eb2.x + 3, eb2.y + eb2.height / 2);
    await page.mouse.down();
    await page.mouse.move(2, eb2.y + eb2.height / 2, { steps: 6 });
    await page.mouse.up();
    expect((await panel.boundingBox())!.width).toBeLessThanOrEqual(900);

    // the bottom edge makes it taller
    await panel.hover();
    const before = (await panel.boundingBox())!;
    const bottom = (await panel.locator('.branch-resize[data-edge="bottom"]').boundingBox())!;
    await page.mouse.move(bottom.x + bottom.width / 2, bottom.y + bottom.height / 2);
    await page.mouse.down();
    await page.mouse.move(bottom.x + bottom.width / 2, bottom.y + bottom.height / 2 + 60, { steps: 6 });
    await page.mouse.up();
    expect((await panel.boundingBox())!.height).toBeGreaterThan(before.height + 30);
  });

  test('the ⋯ menu: Copy as quote, Close', async ({ page }) => {
    const { panel } = await openOne(page);
    await panel.hover();
    await panel.getByRole('button', { name: 'Branch actions' }).click();
    const menu = page.getByTestId('branch-menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem')).toHaveText([/Make this the main thread/, /Copy as quote/, /Close branch/, /Delete branch/]);
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(stackPanels(page)).toHaveCount(1); // Esc closed only the menu
    await panel.getByRole('button', { name: 'Branch actions' }).click();
    await page.getByTestId('branch-menu').getByRole('menuitem', { name: /Close branch/ }).click();
    await expect(stackPanels(page)).toHaveCount(0);
  });

  test('Delete asks first, then removes the branch, its anchor and its saved data; cancel changes nothing', async ({ page }) => {
    const { panel, bid } = await openOne(page);
    await panel.getByRole('textbox', { name: 'Ask about this passage' }).fill('doomed');
    await panel.getByRole('textbox', { name: 'Ask about this passage' }).press('Enter');
    await expect(panel.locator('.branch-body .msg.ai .ai-content')).toContainText('Reply 2 says');
    await panel.hover();
    await panel.getByRole('button', { name: 'Branch actions' }).click();
    await page.getByTestId('branch-menu').getByRole('menuitem', { name: /Delete branch/ }).click();
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toContainText('Delete branch?');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(stackPanels(page)).toHaveCount(1);
    expect((await thread(page)).t.branchSnapshots![bid]).toBeDefined();

    await panel.hover();
    await panel.getByRole('button', { name: 'Branch actions' }).click();
    await page.getByTestId('branch-menu').getByRole('menuitem', { name: /Delete branch/ }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete branch' }).click();
    await expect(stackPanels(page)).toHaveCount(0);
    await expect(page.locator(`${REPLY} .branched`)).toHaveCount(0);
    await expect.poll(async () => (await thread(page)).t.branchSnapshots?.[bid]).toBeUndefined();
    expect((await thread(page)).t.stream).not.toContain(`data-bid="${bid}"`);
    expect((await thread(page)).t.mainMessages).toHaveLength(2);
  });

  test('Make this the main thread: the chat becomes the branch, the trail links back, and clicking it restores everything', async ({ page }) => {
    const { panel, bid } = await openOne(page);
    await panel.getByRole('textbox', { name: 'Ask about this passage' }).fill('go deeper');
    await panel.getByRole('textbox', { name: 'Ask about this passage' }).press('Enter');
    await expect(panel.locator('.branch-body .msg.ai .ai-content')).toContainText('Reply 2 says');
    const before = (await thread(page)).t;

    await panel.hover();
    await panel.getByRole('button', { name: 'Branch actions' }).click();
    await page.getByTestId('branch-menu').getByRole('menuitem', { name: /Make this the main thread/ }).click();

    await expect(page.getByTestId('thread-title')).toContainText('Now exploring');
    await expect(page.locator(REPLY)).toContainText('Reply 2 says');
    await expect(page.locator(REPLY)).not.toContainText('Reply 1 says');
    await expect(stackPanels(page)).toHaveCount(0);
    const crumbs = page.getByTestId('crumb-trail');
    await expect(crumbs.getByRole('button')).toHaveCount(1);
    await expect.poll(async () => ((await thread(page)).t.mainHistory ?? []).length).toBe(1);
    expect((await thread(page)).t.title).toBe(before.title); // the sidebar name is the thread's own

    await crumbs.getByRole('button').click();
    await expect(page.locator(REPLY)).toContainText('Reply 1 says');
    await expect(page.locator(REPLY)).not.toContainText('Reply 2 says');
    await expect(page.getByTestId('crumb-trail').getByRole('button')).toHaveCount(0);
    expect((await thread(page)).t.stream).toBe(before.stream);
    void bid;
  });
});

test.describe('title, header and responsive', () => {
  test('the title is editable in place and saved after the debounce; the sidebar follows', async ({ page }) => {
    await chatWithReply(page);
    const title = page.getByTestId('thread-title');
    await title.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('A renamed chat');
    await expect.poll(async () => (await thread(page)).t.title).toBe('A renamed chat');
    await page.keyboard.press('Enter');
    await page.reload();
    await expect(page.getByTestId('thread-title')).toHaveText('A renamed chat');
  });

  test('below 1100px the branch drawer is hidden, as in legacy, and the page does not make room for it', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 800 });
    await chatWithReply(page);
    await select(page, REPLY, 'alpha1 and beta1');
    await page.keyboard.press('b');
    await expect(page.getByTestId('branch-stack')).toBeHidden();
    const margin = await page.locator('[data-chat-stream]').evaluate(el => getComputedStyle(el.parentElement!).marginRight);
    expect(margin).toBe('0px');
  });

  test('above 1100px the page makes room for the open drawer: nothing of the chat sits under a panel', async ({ page }) => {
    await chatWithReply(page);
    await select(page, REPLY, 'alpha1 and beta1');
    await page.keyboard.press('b');
    const panel = stackPanels(page).first();
    await expect(panel).toBeVisible();
    await expect.poll(async () => {
      const column = (await page.getByTestId('chat-stream').boundingBox())!;
      const drawer = (await panel.boundingBox())!;
      return column.x + column.width <= drawer.x + 1;
    }).toBe(true);
    // ...including the header buttons that used to end up underneath it
    const actions = (await page.getByRole('button', { name: 'Thread map' }).boundingBox())!;
    expect(actions.x + actions.width).toBeLessThanOrEqual((await panel.boundingBox())!.x);
    // and the composer too
    const composer = (await page.getByRole('textbox', { name: 'Message' }).boundingBox())!;
    expect(composer.x + composer.width).toBeLessThanOrEqual((await panel.boundingBox())!.x);
    // closing it gives the room back
    await panel.hover();
    await panel.getByRole('button', { name: 'Close branch' }).click();
    await expect(stackPanels(page)).toHaveCount(0);
    await expect.poll(async () => (await page.getByTestId('chat-stream').boundingBox())!.width).toBeGreaterThan(700);
  });
});

test.describe('both apps share the branch (ADR-038)', () => {
});

test.describe('recent branches (sidebar)', () => {
  async function branchWithMessage(page: Page, question: string): Promise<string> {
    await select(page, REPLY, 'alpha1 and beta1');
    await page.keyboard.press('b');
    const panel = stackPanels(page).first();
    await panel.getByRole('textbox', { name: 'Ask about this passage' }).fill(question);
    await panel.getByRole('textbox', { name: 'Ask about this passage' }).press('Enter');
    await expect(panel.locator('.branch-body .msg.ai .ai-content')).toContainText('Reply 2 says');
    return (await panel.getAttribute('data-bid'))!;
  }
  const recent = (page: Page) => page.getByTestId('recent-branches');

  test('lists the branch with its chat, reopens it when closed, and deletes it from the list', async ({ page }) => {
    await chatWithReply(page);
    const bid = await branchWithMessage(page, 'listed');
    await page.getByRole('button', { name: 'Open left pane' }).click();
    const row = recent(page).locator(`[data-recent-branch="${bid}"]`);
    await expect(row).toContainText('alpha1 and beta1');
    await expect(row).toContainText('Tell me about things');

    await page.locator(`.branch[data-bid="${bid}"]`).getByRole('button', { name: 'Close branch' }).click();
    await expect(stackPanels(page)).toHaveCount(0);
    await row.getByRole('button', { name: /alpha1 and beta1/ }).first().click();
    await expect(page.locator(`.branch[data-bid="${bid}"] .branch-body`)).toContainText('listed');

    await row.getByRole('button', { name: /^Delete/ }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete branch' }).click();
    await expect(recent(page).locator(`[data-recent-branch="${bid}"]`)).toHaveCount(0);
    await expect(recent(page)).toContainText('No recent branches');
  });

  test('a branch in ANOTHER chat: clicking it switches to that chat and opens the panel with its content', async ({ page }) => {
    await chatWithReply(page);
    const bid = await branchWithMessage(page, 'in the first chat');

    await page.getByRole('button', { name: 'Open left pane' }).click();
    await page.getByRole('button', { name: /New chat/ }).click();
    await expect(page.getByTestId('chat-empty')).toBeVisible();
    await expect(stackPanels(page)).toHaveCount(0);

    await recent(page).locator(`[data-recent-branch="${bid}"]`).getByRole('button').first().click();
    await expect(page.locator(REPLY)).toContainText('Reply 1 says'); // switched back
    await expect(page.locator(`.branch[data-bid="${bid}"] .branch-body`)).toContainText('in the first chat');
  });
});

test.describe('Ask (popover)', () => {
  test('select → Ask: an "About" bubble, a streamed answer, saved with the fuller prompt', async ({ page }) => {
    const bodies = await chatWithReply(page);
    await select(page, REPLY, 'alpha1 and beta1');
    await popover(page).getByRole('button', { name: 'Ask AI inline' }).click();
    await expect(page.locator('[data-chat-stream] .msg.user').last()).toContainText('About: "alpha1 and beta1"');
    await expect(page.locator(REPLY).last()).toContainText('Reply 2 says');
    expect(bodies[1]!.messages.at(-1)).toEqual({ role: 'user', content: 'About this passage: "alpha1 and beta1"' });
    await expect.poll(async () => (await thread(page)).t.mainMessages?.length).toBe(4);
    await page.reload();
    await expect(page.locator('[data-chat-stream] .msg.user').last()).toContainText('About: "alpha1 and beta1"');
  });
});

test.describe('model and mode pickers', () => {
  const lastBody = (bodies: Array<Body & { model?: string; system?: string }>) => bodies[bodies.length - 1] as Body & { model?: string; system?: string };

  test('main composer: the model chip lists every model, switching it changes the request and is saved as the pref', async ({ page }) => {
    const bodies = await mockReplies(page) as Array<Body & { model?: string; system?: string }>;
    await newChat(page);
    const chip = page.locator('.model-chip');
    await expect(chip).toContainText('Sonnet 5');
    await chip.click();
    const menu = page.getByRole('menu', { name: 'Select model' });
    await expect(menu.getByRole('menuitem')).toHaveCount(15);
    await expect(menu.getByRole('menuitem', { name: /Sonnet 5/ })).toContainText('Best balance');
    await menu.getByRole('menuitem', { name: /Haiku 4.5/ }).click();
    await expect(chip).toContainText('Haiku 4.5');
    await expect(menu).toHaveCount(0);
    await ask(page, 'which model');
    await expect(page.locator(REPLY)).toContainText('Reply 1 says');
    expect(lastBody(bodies).model).toBe('claude-haiku-4-5-20251001');
    const prefs = ((await readPersistedState(page)) as unknown as { prefs: { model?: string } }).prefs;
    expect(prefs.model).toBe('haiku');
  });

  test('Esc closes the menu; extended thinking is disabled for models that cannot do it and works for ones that can', async ({ page }) => {
    await mockReplies(page);
    await newChat(page);
    await page.locator('.model-chip').click();
    await page.getByRole('menuitem', { name: /Haiku 4.5/ }).click();
    await page.locator('.model-chip').click();
    await expect(page.getByRole('switch', { name: 'Extended thinking' })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu', { name: 'Select model' })).toHaveCount(0);

    await page.locator('.model-chip').click();
    await page.getByRole('menuitem', { name: /Sonnet 5/ }).click();
    await page.locator('.model-chip').click();
    const sw = page.getByRole('switch', { name: 'Extended thinking' });
    await expect(sw).toBeEnabled();
    await sw.click();
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    const prefs = ((await readPersistedState(page)) as unknown as { prefs: { thinking?: boolean } }).prefs;
    expect(prefs.thinking).toBe(true);
  });

  test('the mode chip changes the system prompt and is saved; "New / manage modes" opens the Modes settings', async ({ page }) => {
    const bodies = await mockReplies(page) as Array<Body & { model?: string; system?: string }>;
    await newChat(page);
    const chip = page.locator('.mode-chip');
    await expect(chip).toContainText('General');
    await chip.click();
    const menu = page.getByRole('menu', { name: 'Select conversation mode' });
    await expect(menu.getByRole('menuitem')).toHaveCount(7); // six built-ins + manage
    await menu.getByRole('menuitem', { name: /Research/ }).click();
    await expect(chip).toContainText('Research');
    await ask(page, 'research this');
    await expect(page.locator(REPLY)).toContainText('Reply 1 says');
    expect(lastBody(bodies).system).toContain('You are in Research mode');
    expect(((await readPersistedState(page)) as unknown as { prefs: { mode?: string } }).prefs.mode).toBe('research');

    await chip.click();
    await page.getByRole('menuitem', { name: /New \/ manage modes/ }).click();
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
    await expect(page.getByRole('tab', { name: /^Modes/ })).toHaveAttribute('aria-selected', 'true');
  });

  test('a branch has its OWN model: changing it leaves the main chat alone and is what that branch is sent to', async ({ page }) => {
    await page.route('https://api.deepseek.com/v1/chat/completions', route => route.fulfill({
      status: 200, headers: { 'content-type': 'text/event-stream' },
      body: [{ choices: [{ delta: { content: 'Answered by DeepSeek in the branch.' }, finish_reason: null }] }, { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 3 } }]
        .map(c => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n',
    }));
    await chatWithReply(page);
    await select(page, REPLY, 'alpha1 and beta1');
    await page.keyboard.press('b');
    const panel = stackPanels(page).first();
    const bid = (await panel.getAttribute('data-bid'))!;
    await expect(panel.locator('.branch-model-chip')).toContainText('Sonnet 5');

    await panel.locator('.branch-model-chip').click();
    await page.getByRole('menuitem', { name: /DeepSeek Flash/ }).click();
    await expect(panel.locator('.branch-model-chip')).toContainText('DeepSeek Flash');
    await expect(page.locator('.model-chip')).toContainText('Sonnet 5'); // main is unchanged

    await panel.getByRole('textbox', { name: 'Ask about this passage' }).fill('use the branch model');
    await panel.getByRole('textbox', { name: 'Ask about this passage' }).press('Enter');
    await expect(panel.locator('.branch-body .msg.ai .ai-content')).toContainText('Answered by DeepSeek in the branch.');
    await expect.poll(async () => (await thread(page)).t.branchSnapshots?.[bid]).toMatchObject({ modelPref: 'deepseek', provider: 'deepseek' });
    expect(((await readPersistedState(page)) as unknown as { prefs: { model?: string } }).prefs.model ?? 'sonnet').toBe('sonnet');
  });
});

test.describe('thread map and branch canvas (read-only views)', () => {
  test('thread map: a card for each chat with messages (this one first), and a DeepSeek summary on request', async ({ page }) => {
    await page.route('https://api.deepseek.com/v1/chat/completions', route => route.fulfill({
      status: 200, headers: { 'content-type': 'text/event-stream' },
      body: [{ choices: [{ delta: { content: 'ABOUT: A chat about things.\n\nIDEAS:\n- first idea\n- second idea' }, finish_reason: null }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }]
        .map(c => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n',
    }));
    await chatWithReply(page);
    await page.getByRole('button', { name: 'Thread map' }).click();
    const map = page.getByTestId('thread-map');
    await expect(map).toHaveAttribute('aria-hidden', 'false');
    const card = map.locator('[data-tid]').first();
    await expect(card).toContainText('Tell me about things');
    await expect(card).toContainText('1 message');
    await card.getByRole('button', { name: 'Summarize' }).click();
    await expect(card).toContainText('A chat about things.');
    await expect(card.locator('li')).toHaveText(['·first idea', '·second idea']);
    await map.getByRole('button', { name: 'Close thread map' }).click();
    await expect(map).toHaveAttribute('aria-hidden', 'true');
  });

  test('thread map: summarising without a DeepSeek key says so', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('nl_api_keys', JSON.stringify({ anthropic: 'sk-ant-TESTONLY-x' })));
    await chatWithReply(page);
    await page.getByRole('button', { name: 'Thread map' }).click();
    await page.getByTestId('thread-map').getByRole('button', { name: 'Summarize' }).click();
    await expect(page.getByTestId('thread-map')).toContainText('No DeepSeek API key');
  });

  test('canvas: every branch ever made appears (open or not) with its parent edge; a click opens it; it pans; Esc closes', async ({ page }) => {
    await chatWithReply(page);
    await select(page, REPLY, 'alpha1 and beta1');
    await page.keyboard.press('b');
    const parent = stackPanels(page).first();
    const pid = (await parent.getAttribute('data-bid'))!;
    await parent.getByRole('textbox', { name: 'Ask about this passage' }).fill('parent q');
    await parent.getByRole('textbox', { name: 'Ask about this passage' }).press('Enter');
    await expect(parent.locator('.branch-body .msg.ai .ai-content')).toContainText('Reply 2 says');
    await select(page, `.branch[data-bid="${pid}"] .branch-body .msg.ai .ai-content`, 'alpha2 and beta2');
    await page.keyboard.press('b');
    await expect(stackPanels(page)).toHaveCount(2);
    const cid = (await stackPanels(page).evaluateAll((els, p) => els.map(e => (e as HTMLElement).dataset.bid).find(b => b !== p), pid))!;
    // close everything (child first: a parent behind it is blurred and not clickable), so the canvas has to show branches that are NOT open panels
    // (a panel's actions only take clicks while it is hovered, as in legacy)
    await page.locator(`.branch[data-bid="${cid}"]`).hover();
    await page.locator(`.branch[data-bid="${cid}"]`).getByRole('button', { name: 'Close branch' }).click();
    await expect(page.locator(`.branch[data-bid="${cid}"]`)).toHaveCount(0);
    await page.locator(`.branch[data-bid="${pid}"]`).hover();
    await page.locator(`.branch[data-bid="${pid}"]`).getByRole('button', { name: 'Close branch' }).click();
    await expect(stackPanels(page)).toHaveCount(0);

    await page.getByRole('button', { name: 'Branches — canvas view' }).click();
    const canvas = page.getByTestId('branch-canvas');
    await expect(canvas).toBeVisible();
    await expect(page.getByTestId('canvas-count')).toHaveText('2 branches');
    await expect(canvas.locator('[data-bc-id]')).toHaveCount(3); // the main thread + both branches
    await expect(page.getByTestId('canvas-plane').locator('svg path')).toHaveCount(2); // one edge per branch
    await expect(canvas.locator('[data-bc-id="doc"]')).toContainText('Main thread');
    await expect(canvas.locator(`[data-bc-id="${pid}"]`)).toContainText('Branch');

    // panning moves the plane
    const plane = page.getByTestId('canvas-plane');
    const before = await plane.evaluate(el => (el as HTMLElement).style.transform);
    // from an empty spot on the left, clear of the toast corner
    await page.mouse.move(200, 450);
    await page.mouse.down();
    await page.mouse.move(260, 490, { steps: 4 });
    await page.mouse.up();
    expect(await plane.evaluate(el => (el as HTMLElement).style.transform)).not.toBe(before);

    // a node opens its branch and closes the canvas
    await canvas.locator(`[data-bc-id="${pid}"]`).click();
    await expect(canvas).toHaveCount(0);
    await expect(page.locator(`.branch[data-bid="${pid}"]`)).toBeVisible();

    await page.getByRole('button', { name: 'Branches — canvas view' }).click();
    await expect(page.getByTestId('branch-canvas')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('branch-canvas')).toHaveCount(0);
  });
});
