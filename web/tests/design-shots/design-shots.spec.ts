/*
 * Screenshots for docs/DESIGN.md — captured from the real app, never drawn by hand.
 *
 * Not a test suite: nothing here asserts product behaviour beyond "the surface rendered",
 * and it is excluded from `pnpm e2e` by living outside tests/e2e. Run it after any visual
 * change so the design doc's images stay honest:
 *
 *     pnpm shots          # vite build + capture into ../docs/design-assets
 *
 * Every provider call is mocked; nothing reaches a real API.
 */
import { test, expect, type Page, type Route } from '@playwright/test';

const OUT = '../docs/design-assets';
const WEB = '/web/';
const KEYS = { anthropic: 'sk-ant-TESTONLY-shots-aaaaaaaa' };

// One reply exercising most of the markdown surface: heading, list, link, table, fenced
// code (so the --syn-* tokens show), inline code. Change it and every shot changes.
const REPLY_MD = [
  '## Why rivers meander',
  '',
  'A channel never stays straight for long. Three forces keep bending it:',
  '',
  '1. **Helicoidal flow** — water corkscrews through a bend, undercutting the outer bank.',
  '2. **Deposition** — the slow inner bank drops its load and builds a point bar.',
  '3. **Avulsion** — once a loop is tight enough, the river cuts across and abandons it.',
  '',
  'The classic measure is sinuosity, channel length over valley length. See [Leopold & Wolman (1957)](https://pubs.usgs.gov) for the original survey.',
  '',
  '| Form | Sinuosity | Typical slope |',
  '| --- | --- | --- |',
  '| Straight | < 1.05 | steep |',
  '| Sinuous | 1.05 - 1.5 | moderate |',
  '| Meandering | > 1.5 | gentle |',
  '',
  '```python',
  'def sinuosity(channel_km: float, valley_km: float) -> float:',
  '    """Ratio above 1.5 is a meandering reach."""',
  '    if valley_km <= 0:',
  '        raise ValueError("valley length must be positive")',
  '    return channel_km / valley_km  # dimensionless',
  '```',
  '',
  'In short, a meander is `erosion` and deposition reaching a standoff.',
].join('\n');

// A reply that hands over a file, for the file-card shot. Short on purpose: the card is the subject.
const FILE_REPLY_MD = [
  'Here is the page. Open it or keep it — the markup is behind *Show code*.',
  '',
  '```html',
  '<!DOCTYPE html>',
  '<html><head><title>Meander field guide</title></head>',
  '<body><h1>Meander field guide</h1><p>Helicoidal flow, deposition, avulsion.</p></body></html>',
  '```',
].join('\n');

async function mockClaudeMd(page: Page, text: string): Promise<void> {
  await page.route('https://api.anthropic.com/v1/messages', async (route: Route) => {
    const events = [
      { type: 'message_start', message: { usage: { input_tokens: 420 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
      ...text.split(' ').map((w, i) => ({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: i ? ' ' + w : w } })),
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 310 } },
    ];
    await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('') });
  });
}

async function boot(page: Page, theme: 'dark' | 'grey' | 'light'): Promise<void> {
  await page.addInitScript(([k, t]) => {
    localStorage.setItem('nl_api_keys', k as string);
    localStorage.setItem('nl_theme', t as string);
  }, [JSON.stringify(KEYS), theme]);
  await page.setViewportSize({ width: 1440, height: 900 });
}

async function newChat(page: Page): Promise<void> {
  await page.goto(WEB);
  await expect(page.getByRole('button', { name: 'Open left pane' })).toBeVisible();
  await page.getByRole('button', { name: 'Open left pane' }).click();
  await page.getByRole('button', { name: /New chat/ }).click();
  await expect(page.getByTestId('chat-empty')).toBeVisible();
}

async function ask(page: Page, text: string): Promise<void> {
  const box = page.getByRole('textbox', { name: 'Message' });
  await box.click();
  await box.fill(text);
  await box.press('Enter');
}

const REPLY = '[data-chat-stream] .chat-stream .msg.ai .ai-content';

/** Clears the transient toast and parks the stream at the top: a shot must show the UI, not a notification. */
async function settle(page: Page, top = true): Promise<void> {
  await page.evaluate((top) => {
    document.querySelectorAll('[data-sonner-toaster]').forEach(n => n.remove());
    if (top) {
      const el = document.querySelector('[data-chat-stream]');
      const scroller = el?.closest('[class*="overflow"]') ?? el?.parentElement;
      if (scroller) (scroller as HTMLElement).scrollTop = 0;
      window.scrollTo(0, 0);
    }
  }, top);
  await page.waitForTimeout(250);
}

/** Selects `phrase` inside `scope`, as a person dragging over it would. */
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
      r.setStart(n, i); r.setEnd(n, i + phrase.length);
      const s = window.getSelection()!; s.removeAllRanges(); s.addRange(r);
      return;
    }
    throw new Error(`"${phrase}" not found in ${scope}`);
  }, { scope, phrase });
}

async function chatWithReply(page: Page, theme: 'dark' | 'grey' | 'light' = 'dark'): Promise<void> {
  await boot(page, theme);
  await mockClaudeMd(page, REPLY_MD);
  await newChat(page);
  await page.getByRole('button', { name: 'Close left pane' }).click();
  await ask(page, 'Why do rivers meander instead of running straight?');
  await expect(page.locator(REPLY)).toContainText('standoff');
  await expect(page.getByRole('button', { name: 'Stop' })).toHaveCount(0);
  await page.waitForTimeout(400);
}

test('01 empty state, sidebar open', async ({ page }) => {
  await boot(page, 'dark');
  await newChat(page);
  await settle(page);
  await page.screenshot({ path: `${OUT}/01-empty-state.png` });
});

test('02 reply: markdown, table, code block', async ({ page }) => {
  await chatWithReply(page);
  await settle(page);
  await page.screenshot({ path: `${OUT}/02-reply-markdown.png` });
});

test('09 generated file card', async ({ page }) => {
  await boot(page, 'dark');
  await mockClaudeMd(page, FILE_REPLY_MD);
  await newChat(page);
  await page.getByRole('button', { name: 'Close left pane' }).click();
  await ask(page, 'Write that up as an HTML page I can open.');
  await expect(page.locator('.artifact-file-card')).toBeVisible();
  await settle(page);
  await page.locator('.artifact-file-card').screenshot({ path: `${OUT}/09-file-card.png` });
});

test('03 selection popover', async ({ page }) => {
  await chatWithReply(page);
  await settle(page);
  await select(page, REPLY, 'Helicoidal flow');
  await expect(page.getByTestId('selection-popover')).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/03-selection-popover.png` });
});

test('04 branch panel with its own reply', async ({ page }) => {
  await chatWithReply(page);
  await select(page, REPLY, 'Helicoidal flow');
  await expect(page.getByTestId('selection-popover')).toBeVisible();
  await page.keyboard.press('b');
  const panel = page.locator('[data-testid="branch-stack"] .branch').first();
  await expect(panel).toBeVisible();
  await mockClaudeMd(page, 'Picture the flow as a corkscrew: surface water drives outward across the bend, dives at the outer bank, and returns along the bed toward the inner bank. That single cell is why outer banks are steep and inner banks shelve.');
  const input = panel.getByRole('textbox', { name: 'Ask about this passage' });
  await input.fill('Explain the corkscrew motion more concretely.');
  await input.press('Enter');
  await expect(panel.locator('.branch-body .msg.ai .ai-content')).toContainText('corkscrew');
  await expect(panel.getByRole('button', { name: 'Stop' })).toHaveCount(0);
  await settle(page, false);
  await page.screenshot({ path: `${OUT}/04-branch-panel.png` });
});

test('05 highlight mark in the reply', async ({ page }) => {
  await chatWithReply(page);
  await select(page, REPLY, 'channel length over valley length');
  await expect(page.getByTestId('selection-popover')).toBeVisible();
  await page.getByTestId('selection-popover').getByRole('button', { name: 'Save highlight' }).click();
  await expect(page.locator(`${REPLY} .highlighted`).first()).toBeVisible();
  await settle(page, false);
  await page.screenshot({ path: `${OUT}/05-highlight.png` });
});

test('06 light theme', async ({ page }) => {
  await chatWithReply(page, 'light');
  await settle(page);
  await page.screenshot({ path: `${OUT}/06-theme-light.png` });
});

test('07 grey theme', async ({ page }) => {
  await chatWithReply(page, 'grey');
  await settle(page);
  await page.screenshot({ path: `${OUT}/07-theme-grey.png` });
});

test('08 settings', async ({ page }) => {
  await boot(page, 'dark');
  await page.goto(WEB);
  await page.getByRole('button', { name: 'Open left pane' }).click();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.waitForTimeout(700);
  await settle(page, false);
  await page.screenshot({ path: `${OUT}/08-settings.png` });
});

// A reply with 2+ headings and `LABEL:` lines whose label reads as a heading (all-caps, 3+
// chars) — the two conditions web/src/canvas/view/structure-reply.ts looks for.
const CANVAS_REPLY_MD = [
  '# Flow Sketch',
  '',
  "WHO IT'S FOR: PMs, founders, designers and researchers who leave notlinear, build a flow in Figma, screenshot it, and come back.",
  '',
  'JOB TO BE DONE: Express a sequence of screens, decisions and outcomes without switching tools.',
  '',
  '## Strongest argument against',
  '',
  'notlinear is a thinking canvas, not a design suite.',
  '',
  '## Recommended concept',
  '',
  'Four node types. Nothing else: Screen, Action, Decision, Outcome.',
  '',
  '## Comparable tools',
  '',
  '- Figma',
  'Focus: freeform diagramming with no canvas-native model.',
  'Fit: closest to this, but a screenshot is the only way the flow leaves Figma.',
  '',
  '- Linear',
  'Focus: issue tracking, not spatial thinking.',
].join('\n');

async function canvasWithReply(page: Page): Promise<void> {
  await boot(page, 'dark');
  await page.addInitScript(() => {
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
  await mockClaudeMd(page, CANVAS_REPLY_MD);
  await page.goto(WEB);
  await page.getByRole('button', { name: 'Open left pane' }).click();
  await page.locator('aside[aria-label="Left pane"] [data-project="p1"] button').first().click();
  await expect(page.getByTestId('project-overview')).toBeVisible();
  const card = page.getByTestId('card-canvases');
  const empty = card.getByTestId('canvas-new-empty');
  if (await empty.count()) await empty.click();
  else await card.getByTestId('canvas-new-card').click();
  await expect(page.getByTestId('canvas-workspace')).toBeVisible();
  // The default composer starts as a collapsed launcher pill; click it open first. `.count()`
  // doesn't wait, so wait for either testid before checking which one actually rendered.
  const launcher = page.getByTestId('ink-launcher');
  const composer = page.getByTestId('ink-composer');
  await expect(launcher.or(composer)).toBeVisible();
  if (await launcher.count()) await launcher.click();
  await composer.getByRole('textbox').fill('give me the flow sketch brief');
  await composer.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('heading', { name: /Recommended concept/ })).toBeVisible();
  await page.waitForTimeout(400);
}

test('10 canvas: a sectioned reply, jump-to pills and callout cards', async ({ page }) => {
  await canvasWithReply(page);
  const fitView = page.locator('.react-flow__controls-fitview');
  if (await fitView.count()) await fitView.click({ force: true });
  await page.waitForTimeout(300);
  await settle(page, false);
  await page.screenshot({ path: `${OUT}/10-canvas-card.png` });
});

test('11 canvas: the same reply in Reading view', async ({ page }) => {
  await canvasWithReply(page);
  await page.getByTestId('canvas-reading-toggle').click();
  await page.waitForTimeout(300);
  await settle(page, false);
  await page.screenshot({ path: `${OUT}/11-canvas-reading.png` });
});

test('12 canvas: the search palette, grouped Threads and Replies (UI-08)', async ({ page }) => {
  await canvasWithReply(page);
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog', { name: 'Search this canvas' })).toBeVisible();
  await page.waitForTimeout(200);
  await settle(page, false);
  await page.screenshot({ path: `${OUT}/12-canvas-search.png` });
});

test('13 canvas: the output-detail view, a reply in full (UI-09)', async ({ page }) => {
  await canvasWithReply(page);
  await page.getByTestId('view-output').click();
  await expect(page.getByTestId('canvas-output-detail')).toBeVisible();
  await page.waitForTimeout(200);
  await settle(page, false);
  await page.screenshot({ path: `${OUT}/13-canvas-output-detail.png` });
});
