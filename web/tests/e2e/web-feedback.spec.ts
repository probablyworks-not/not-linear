import { test, expect, type Page, type Route } from '@playwright/test';
import { openApp, openSidebar } from './helpers';

// P4 item 6: the Feedback panel in /web/.
//
// EVERY feedback endpoint is mocked here, on purpose. The real ones append to
// feedback/FEEDBACK.md and run `screencapture`; a test that reached them would
// write into the developer's real log (BUGS.md #053 is exactly that mistake). The
// backend contract tests cover the real endpoints in isolation.

interface Call { url: string; body: Record<string, unknown> }
interface Mock {
  calls: Call[];
  reply: Record<string, (body: Record<string, unknown>) => unknown>;
  delay: Record<string, number>;
}

async function mockFeedback(page: Page, png?: Buffer): Promise<Mock> {
  const m: Mock = {
    calls: [],
    reply: {
      shot: () => ({ ok: true, path: 'feedback/media/test-shot.png' }),
      record: b => (b.action === 'start' ? { ok: true } : { ok: true, path: 'feedback/media/test-rec.mov' }),
      upload: () => ({ ok: true }),
      discard: () => ({ ok: true }),
      save: () => ({ ok: true, id: 'B-001', path: 'feedback/FEEDBACK.md' }),
      list: () => ({ ok: true, entries: [] }),
    },
    delay: {},
  };
  await page.route('**/__notlinear_feedback_*', async (route: Route) => {
    const name = new URL(route.request().url()).pathname.replace('/__notlinear_feedback_', '');
    const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
    m.calls.push({ url: name, body });
    if (m.delay[name]) await new Promise(r => setTimeout(r, m.delay[name]));
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(m.reply[name]!(body)) });
  });
  if (png) await page.route('**/feedback/media/test-shot.png*', r => r.fulfill({ contentType: 'image/png', body: png }));
  await page.route('**/feedback/media/test-rec.mov*', r => r.abort()); // not playable: the preview must say so
  return m;
}
const calls = (m: Mock, name: string) => m.calls.filter(c => c.url === name);

/** A real PNG to draw on, taken from the app itself. */
async function makePng(page: Page): Promise<Buffer> {
  await page.goto('/web/');
  await expect(page.getByRole('button', { name: 'Open left pane' })).toBeVisible();
  return page.screenshot({ clip: { x: 0, y: 0, width: 480, height: 320 } });
}

async function openWeb(page: Page): Promise<void> {
  await page.goto('/web/');
  await expect(page.getByRole('button', { name: 'Open left pane' })).toBeVisible();
}
const sidebar = (p: Page) => p.locator('aside[aria-label="Left pane"]');
// The toggle button would CLOSE an already-open sidebar, so only click it when it is closed.
async function showSidebar(p: Page): Promise<void> {
  // Keyed on the `invisible` class, which flips with state at once. Not isVisible() (true for the 200ms
  // slide-out) and not aria-hidden (Radix removes that attribute when a dialog closes, so null means nothing).
  const closed = ((await sidebar(p).getAttribute('class')) ?? '').includes('invisible');
  if (closed) await p.getByRole('button', { name: 'Open left pane' }).click();
  await expect(sidebar(p)).not.toHaveClass(/invisible/);
}
const panel = (p: Page) => p.getByRole('dialog', { name: 'Feedback' });
const text = (p: Page) => panel(p).getByLabel('Feedback text');
async function openPanel(p: Page): Promise<void> {
  await p.keyboard.press('Control+Shift+f');
  await expect(panel(p)).toBeVisible();
}

test.describe('open and close', () => {
  test('Ctrl+Shift+F toggles it, focuses the box, and shows where it was filed from', async ({ page }) => {
    await mockFeedback(page);
    await openWeb(page);
    await openPanel(page);
    await expect(text(page)).toBeFocused();
    await expect(page.getByTestId('fb-ctx')).toHaveText('chat · doc-main');
    await page.keyboard.press('Control+Shift+f');
    await expect(panel(page)).toHaveCount(0);
  });

  test('Ctrl+Q also toggles (it is how the native shell opens it)', async ({ page }) => {
    await mockFeedback(page);
    await openWeb(page);
    await page.keyboard.press('Control+q');
    await expect(panel(page)).toBeVisible();
    await page.keyboard.press('Control+q');
    await expect(panel(page)).toHaveCount(0);
  });

  test('Esc inside the panel closes it, and so does the close button', async ({ page }) => {
    await mockFeedback(page);
    await openWeb(page);
    await openPanel(page);
    await page.keyboard.press('Escape');
    await expect(panel(page)).toHaveCount(0);
    await openPanel(page);
    await panel(page).getByRole('button', { name: 'Close feedback' }).click();
    await expect(panel(page)).toHaveCount(0);
  });

  test('closing keeps the draft', async ({ page }) => {
    await mockFeedback(page);
    await openWeb(page);
    await openPanel(page);
    await text(page).fill('half-written bug');
    await panel(page).getByRole('button', { name: 'Close feedback' }).click();
    await openPanel(page);
    await expect(text(page)).toHaveValue('half-written bug');
  });

  test('the type toggle swaps the placeholder and hides capture for ideas', async ({ page }) => {
    await mockFeedback(page);
    await openWeb(page);
    await openPanel(page);
    await expect(text(page)).toHaveAttribute('placeholder', 'What happened?');
    await expect(panel(page).getByRole('button', { name: 'Screenshot' })).toBeVisible();
    await panel(page).getByRole('button', { name: 'Idea' }).click();
    await expect(text(page)).toHaveAttribute('placeholder', "What's the idea?");
    await expect(panel(page).getByRole('button', { name: 'Screenshot' })).toHaveCount(0);
    await expect(panel(page).getByRole('button', { name: 'Record' })).toHaveCount(0);
  });

  test('Tab types a tab character instead of leaving the box', async ({ page }) => {
    await mockFeedback(page);
    await openWeb(page);
    await openPanel(page);
    await text(page).fill('ab');
    await text(page).press('Tab');
    await text(page).pressSequentially('c');
    await expect(text(page)).toHaveValue('ab\tc');
    await expect(text(page)).toBeFocused();
  });

  test('the header drags the panel, and it stays inside the window', async ({ page }) => {
    await mockFeedback(page);
    await openWeb(page);
    await openPanel(page);
    const head = panel(page).getByText('Feedback', { exact: true });
    const b0 = (await panel(page).boundingBox())!;
    const h = (await head.boundingBox())!;
    await page.mouse.move(h.x + 5, h.y + 5);
    await page.mouse.down();
    await page.mouse.move(h.x - 300, h.y - 200, { steps: 5 });
    await page.mouse.up();
    const b1 = (await panel(page).boundingBox())!;
    expect(b1.x).toBeLessThan(b0.x - 100);
    expect(b1.y).toBeLessThan(b0.y - 100);
    // Dragged far past the edge: clamped, never off-screen.
    await page.mouse.move(b1.x + 10, b1.y + 10);
    await page.mouse.down();
    await page.mouse.move(-500, -500, { steps: 5 });
    await page.mouse.up();
    const b2 = (await panel(page).boundingBox())!;
    expect(b2.x).toBeGreaterThanOrEqual(0);
    expect(b2.y).toBeGreaterThanOrEqual(0);
  });
});

test.describe('saving', () => {
  test('an empty report is refused; a real one is sent with its context and then cleared', async ({ page }) => {
    const m = await mockFeedback(page);
    await openWeb(page);
    await openPanel(page);
    await panel(page).getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Nothing to save yet')).toBeVisible();
    expect(calls(m, 'save')).toHaveLength(0);

    await panel(page).getByRole('button', { name: 'Idea' }).click();
    await text(page).fill('  Dark mode for the graph  ');
    await panel(page).getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Saved B-001 → feedback/FEEDBACK.md')).toBeVisible();
    expect(calls(m, 'save')[0]!.body).toEqual({ type: 'idea', text: 'Dark mode for the graph', media: [], context: { view: 'chat', thread: 'doc-main' } });
    await expect(text(page)).toHaveValue('');
  });

  test('a rejected save keeps the draft', async ({ page }) => {
    const m = await mockFeedback(page);
    m.reply.save = () => ({ ok: false, error: 'FEEDBACK.md is locked' });
    await openWeb(page);
    await openPanel(page);
    await text(page).fill('keep this');
    await panel(page).getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('FEEDBACK.md is locked')).toBeVisible();
    await expect(text(page)).toHaveValue('keep this');
  });

  test('the context follows the open thread', async ({ page }) => {
    const m = await mockFeedback(page);
    await openWeb(page);
    await page.getByRole('button', { name: 'Open left pane' }).click();
    await page.locator('[data-thread="pricing"]').getByRole('button', { name: 'Pricing research', exact: true }).click();
    await openPanel(page);
    await text(page).fill('x');
    await panel(page).getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => calls(m, 'save').length).toBe(1);
    expect(calls(m, 'save')[0]!.body.context).toEqual({ view: 'chat', thread: 'pricing' });
  });
});

test.describe('screenshot capture and annotation', () => {
  async function captureToPreview(page: Page): Promise<void> {
    await panel(page).getByRole('button', { name: 'Screenshot' }).click();
    await page.getByRole('menuitem', { name: 'Full screen' }).click();
    await expect(page.getByRole('dialog', { name: /Screenshot — draw to annotate/ })).toBeVisible();
  }
  const canvas = (p: Page) => p.getByTestId('fb-canvas');
  const pixels = (p: Page) => canvas(p).evaluate((c: HTMLCanvasElement) => c.toDataURL('image/png'));

  async function scribble(page: Page): Promise<void> {
    const box = (await canvas(page).boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.3);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5, { steps: 6 });
    await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.8, { steps: 6 });
    await page.mouse.up();
  }

  test('the capture menu offers area and full screen, and the panel hides itself while the shot is taken', async ({ page }) => {
    const png = await makePng(page);
    const m = await mockFeedback(page, png);
    m.delay.shot = 600;
    await openWeb(page);
    await openPanel(page);
    await panel(page).getByRole('button', { name: 'Screenshot' }).click();
    await expect(page.getByRole('menuitem', { name: 'Select area' })).toBeVisible();
    await page.getByRole('menuitem', { name: 'Full screen' }).click();
    // In flight: hidden, so it cannot appear in its own screenshot.
    await expect(panel(page)).toBeHidden();
    await expect.poll(() => calls(m, 'shot').length).toBe(1);
    expect(calls(m, 'shot')[0]!.body).toEqual({ mode: 'full' });
    await expect(page.getByRole('dialog', { name: /draw to annotate/ })).toBeVisible();
  });

  test('drawing changes the pixels, Undo restores them exactly, and Clear removes all strokes', async ({ page }) => {
    const png = await makePng(page);
    await mockFeedback(page, png);
    await openWeb(page);
    await openPanel(page);
    await captureToPreview(page);
    await expect(canvas(page)).toBeVisible();
    const clean = await pixels(page);
    await scribble(page);
    const drawn = await pixels(page);
    expect(drawn).not.toBe(clean);
    await page.getByRole('button', { name: 'Undo' }).click();
    expect(await pixels(page)).toBe(clean);
    await scribble(page);
    await scribble(page);
    await page.getByRole('button', { name: 'Clear annotations' }).click();
    expect(await pixels(page)).toBe(clean);
  });

  test('with the pen toggled off, dragging draws nothing', async ({ page }) => {
    const png = await makePng(page);
    await mockFeedback(page, png);
    await openWeb(page);
    await openPanel(page);
    await captureToPreview(page);
    await expect(canvas(page)).toBeVisible();
    const clean = await pixels(page);
    await page.getByRole('button', { name: 'Pen' }).click();
    await scribble(page);
    expect(await pixels(page)).toBe(clean);
  });

  test('Add with annotations uploads a flattened PNG, then the file joins the report as a chip', async ({ page }) => {
    const png = await makePng(page);
    const m = await mockFeedback(page, png);
    await openWeb(page);
    await openPanel(page);
    await captureToPreview(page);
    await expect(canvas(page)).toBeVisible();
    await scribble(page);
    await page.getByRole('button', { name: 'Add to report' }).click();
    await expect(page.getByRole('dialog', { name: /draw to annotate/ })).toHaveCount(0);
    const up = calls(m, 'upload');
    expect(up).toHaveLength(1);
    expect(up[0]!.body.path).toBe('feedback/media/test-shot.png');
    const bytes = Buffer.from(String(up[0]!.body.base64), 'base64');
    expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a'); // a real PNG, not the placeholder
    expect(bytes.length).toBeGreaterThan(500);
    await expect(page.getByTestId('fb-chips')).toContainText('test-shot.png');
  });

  test('Add without annotations uploads nothing', async ({ page }) => {
    const png = await makePng(page);
    const m = await mockFeedback(page, png);
    await openWeb(page);
    await openPanel(page);
    await captureToPreview(page);
    await expect(canvas(page)).toBeVisible();
    await page.getByRole('button', { name: 'Add to report' }).click();
    await expect(page.getByTestId('fb-chips')).toContainText('test-shot.png');
    expect(calls(m, 'upload')).toHaveLength(0);
  });

  test('a failed upload attaches nothing and keeps the preview', async ({ page }) => {
    const png = await makePng(page);
    const m = await mockFeedback(page, png);
    m.reply.upload = () => ({ ok: false, error: 'disk is read-only' });
    await openWeb(page);
    await openPanel(page);
    await captureToPreview(page);
    await expect(canvas(page)).toBeVisible();
    await scribble(page);
    await page.getByRole('button', { name: 'Add to report' }).click();
    await expect(page.getByText('disk is read-only')).toBeVisible();
    await expect(page.getByRole('dialog', { name: /draw to annotate/ })).toBeVisible();
    await expect(page.getByTestId('fb-chips')).toHaveCount(0);
  });

  test('Escape discards: the server deletes the file, nothing is attached, and the panel stays open', async ({ page }) => {
    const png = await makePng(page);
    const m = await mockFeedback(page, png);
    await openWeb(page);
    await openPanel(page);
    await captureToPreview(page);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: /draw to annotate/ })).toHaveCount(0);
    await expect.poll(() => calls(m, 'discard').length).toBe(1);
    expect(calls(m, 'discard')[0]!.body).toEqual({ path: 'feedback/media/test-shot.png' });
    await expect(panel(page)).toBeVisible();
    await expect(page.getByTestId('fb-chips')).toHaveCount(0);
  });

  test('Discard does the same; an unloadable image says so', async ({ page }) => {
    const m = await mockFeedback(page); // no PNG route: the placeholder cannot be decoded
    await openWeb(page);
    await openPanel(page);
    await page.route('**/feedback/media/test-shot.png*', r => r.fulfill({ contentType: 'image/png', body: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) }));
    await panel(page).getByRole('button', { name: 'Screenshot' }).click();
    await page.getByRole('menuitem', { name: 'Full screen' }).click();
    await expect(page.getByText('Could not load the screenshot.')).toBeVisible();
    await page.getByRole('button', { name: 'Discard' }).click();
    await expect.poll(() => calls(m, 'discard').length).toBe(1);
  });

  test('a cancelled area select says nothing and reopens the panel', async ({ page }) => {
    const m = await mockFeedback(page);
    m.reply.shot = () => ({ ok: false, cancelled: true });
    await openWeb(page);
    await openPanel(page);
    await panel(page).getByRole('button', { name: 'Screenshot' }).click();
    await page.getByRole('menuitem', { name: 'Select area' }).click();
    await expect(panel(page)).toBeVisible();
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
  });
});

test.describe('screen recording', () => {
  test('start shows a running Stop timer; stop opens a preview that says when it cannot play; Add attaches it', async ({ page }) => {
    const m = await mockFeedback(page);
    await openWeb(page);
    await openPanel(page);
    await panel(page).getByRole('button', { name: 'Record' }).click();
    await page.getByRole('menuitem', { name: 'Select area' }).click();
    await expect(page.getByText('Drag to select the area — recording starts on release')).toBeVisible();
    const stop = panel(page).getByRole('button', { name: /^Stop · 0:0\d$/ });
    await expect(stop).toBeVisible();
    expect(calls(m, 'record')[0]!.body).toEqual({ action: 'start', mode: 'area' });
    await page.waitForTimeout(1600);
    await expect(panel(page).getByRole('button', { name: /^Stop · 0:0[1-9]$/ })).toBeVisible(); // it counts

    await stop.or(panel(page).getByRole('button', { name: /^Stop/ })).click();
    await expect(page.getByRole('dialog', { name: 'Recording preview' })).toBeVisible();
    await expect(page.getByText('Preview not supported in this browser — the recording is still saved and can be added.')).toBeVisible();
    await page.getByRole('button', { name: 'Add to report' }).click();
    await expect(page.getByTestId('fb-chips')).toContainText('test-rec.mov');
    expect(calls(m, 'upload')).toHaveLength(0); // videos are never annotated
  });

  test('while recording the panel cannot be closed and Save is refused', async ({ page }) => {
    await mockFeedback(page);
    await openWeb(page);
    await openPanel(page);
    await panel(page).getByRole('button', { name: 'Record' }).click();
    await page.getByRole('menuitem', { name: 'Full screen' }).click();
    await expect(panel(page).getByRole('button', { name: /^Stop/ })).toBeVisible();

    await panel(page).getByRole('button', { name: 'Close feedback' }).click();
    await expect(page.getByText('Recording still running — stop it first')).toBeVisible();
    await expect(panel(page)).toBeVisible();

    await text(page).fill('while recording');
    await panel(page).getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Stop the recording first')).toBeVisible();
  });

  test('a recording that yields nothing says so', async ({ page }) => {
    const m = await mockFeedback(page);
    m.reply.record = b => (b.action === 'start' ? { ok: true } : { ok: false, cancelled: true });
    await openWeb(page);
    await openPanel(page);
    await panel(page).getByRole('button', { name: 'Record' }).click();
    await page.getByRole('menuitem', { name: 'Full screen' }).click();
    await panel(page).getByRole('button', { name: /^Stop/ }).click();
    await expect(page.getByText('No recording captured')).toBeVisible();
    await expect(panel(page).getByRole('button', { name: 'Record' })).toBeVisible();
  });
});

test.describe('media chips', () => {
  test('a chip can be removed from the report, and its icon follows the type', async ({ page }) => {
    const png = await makePng(page);
    await mockFeedback(page, png);
    await openWeb(page);
    await openPanel(page);
    await panel(page).getByRole('button', { name: 'Screenshot' }).click();
    await page.getByRole('menuitem', { name: 'Full screen' }).click();
    await expect(page.getByTestId('fb-canvas')).toBeVisible();
    await page.getByRole('button', { name: 'Add to report' }).click();
    await expect(page.getByTestId('fb-chips')).toContainText('test-shot.png');
    await panel(page).getByRole('button', { name: 'Remove test-shot.png' }).click();
    await expect(page.getByTestId('fb-chips')).toHaveCount(0);
  });
});

test.describe('Settings: bugs & ideas log', () => {
  const entries = [
    { id: 'B-003', type: 'bug', date: '2026-10-03', status: 'open', text: 'Branch panel flickers\non open', media: ['feedback/media/a.png', 'feedback/media/b.mov'], view: 'chat', thread: 'doc-main' },
    { id: 'I-002', type: 'idea', date: '2026-10-02', status: 'open', text: 'Keyboard shortcut for new project', media: [], view: '', thread: '' },
    { id: 'B-001', type: 'bug', date: '2026-10-01', status: 'fixed', text: 'Highlights unreadable in light mode', media: [], view: 'notes', thread: '' },
  ];
  async function openLog(page: Page): Promise<void> {
    await showSidebar(page);
    await page.getByRole('button', { name: 'Open settings' }).click();
    await page.getByRole('button', { name: 'View bugs & ideas' }).click();
  }

  test('lists entries newest first with badge, id, date, status, text and media links, and counts them', async ({ page }) => {
    const m = await mockFeedback(page);
    m.reply.list = () => ({ ok: true, entries });
    await openWeb(page);
    await openLog(page);
    await expect(page.getByTestId('fb-log-count')).toHaveText('2 bugs · 1 idea');
    const rows = page.getByTestId('fb-log-list').locator('[data-entry]');
    await expect(rows).toHaveCount(3);
    expect(await rows.evaluateAll(els => els.map(e => (e as HTMLElement).dataset.entry))).toEqual(['B-003', 'I-002', 'B-001']);
    await expect(rows.nth(0)).toContainText('Bug');
    await expect(rows.nth(0)).toContainText('Branch panel flickers');
    await expect(rows.nth(0)).toContainText('chat · doc-main');
    await expect(rows.nth(0).getByRole('link', { name: 'a.png' })).toHaveAttribute('href', '/feedback/media/a.png');
    await expect(rows.nth(0).getByRole('link', { name: 'b.mov' })).toHaveAttribute('target', '_blank');
    await expect(rows.nth(1)).toContainText('Idea');
    await expect(rows.nth(2)).toContainText('fixed');
  });

  test('empty and error states use the legacy wording', async ({ page }) => {
    const m = await mockFeedback(page);
    await openWeb(page);
    await openLog(page);
    await expect(page.getByTestId('fb-log-count')).toHaveText('Empty');
    await expect(page.getByText('No feedback yet — press ⌘⇧F anywhere to log a bug or idea.')).toBeVisible();
    m.reply.list = () => ({ ok: false, error: 'nope' });
    await page.getByRole('button', { name: 'Reload feedback' }).click();
    await expect(page.getByTestId('fb-log-count')).toHaveText('Unavailable');
    await expect(page.getByText('Could not load — is the server running with the latest code?')).toBeVisible();
  });

  test('is not fetched until expanded; reload refetches; a save makes the next open refetch', async ({ page }) => {
    const m = await mockFeedback(page);
    await openWeb(page);
    await showSidebar(page);
    await page.getByRole('button', { name: 'Open settings' }).click();
    expect(calls(m, 'list')).toHaveLength(0);
    await page.getByRole('button', { name: 'View bugs & ideas' }).click();
    await expect.poll(() => calls(m, 'list').length).toBe(1);
    await page.getByRole('button', { name: 'Reload feedback' }).click();
    await expect.poll(() => calls(m, 'list').length).toBe(2);

    await page.getByRole('button', { name: 'Close settings' }).click();
    await openPanel(page);
    await text(page).fill('new report');
    await panel(page).getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Saved B-001 → feedback/FEEDBACK.md')).toBeVisible();
    await showSidebar(page);
    await page.getByRole('button', { name: 'Open settings' }).click();
    await page.getByRole('button', { name: 'View bugs & ideas' }).click();
    await expect.poll(() => calls(m, 'list').length).toBe(3);
  });

  test('parity: the legacy log shows the same entries in the same order', async ({ page }) => {
    const m = await mockFeedback(page);
    m.reply.list = () => ({ ok: true, entries });
    await openApp(page);
    await openSidebar(page);
    await page.locator('#open-prefs').click();
    await page.locator('#fb-log-toggle').click();
    await expect(page.locator('#fb-log-count')).toHaveText('2 bugs · 1 idea');
    const legacy = await page.locator('#fb-log-list .fb-log-item').evaluateAll(els => els.map(e => ({
      id: e.querySelector('.fb-log-id')!.textContent!.trim(),
      badge: e.querySelector('.fb-log-badge')!.textContent!.trim(),
      status: e.querySelector('.fb-log-status')!.textContent!.trim(),
      text: e.querySelector('.fb-log-text')!.textContent!.trim(),
    })));

    await openWeb(page);
    await openLog(page);
    await expect(page.getByTestId('fb-log-list').locator('[data-entry]')).toHaveCount(3); // wait for the fetch
    const web = await page.getByTestId('fb-log-list').locator('[data-entry]').evaluateAll(els => els.map(e => {
      const spans = e.querySelectorAll(':scope > div:first-child > span');
      return {
        id: spans[1]!.textContent!.trim(), badge: spans[0]!.textContent!.trim(), status: spans[3]!.textContent!.trim(),
        text: e.querySelector(':scope > div:nth-child(2)')!.textContent!.trim(),
      };
    }));
    expect(web).toEqual(legacy);
    expect(web).toHaveLength(3);
  });
});

test.describe('parity of what gets saved', () => {
  test('the same report sent from each app has the same type, text, media and context shape', async ({ page }) => {
    const m = await mockFeedback(page);
    await openWeb(page);
    await openPanel(page);
    await panel(page).getByRole('button', { name: 'Idea' }).click();
    await text(page).fill('  same words  ');
    await panel(page).getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => calls(m, 'save').length).toBe(1);

    await openApp(page);
    await page.keyboard.press('Control+Shift+b'); // the legacy app keeps ⌘⇧B for Feedback
    await page.locator('.fb-type-btn[data-type="idea"]').click();
    await page.locator('.fb-text').fill('  same words  ');
    await page.locator('#fb-save').click();
    await expect.poll(() => calls(m, 'save').length).toBe(2);

    const [web, legacy] = calls(m, 'save').map(c => c.body);
    expect(Object.keys(web!).sort()).toEqual(Object.keys(legacy!).sort());
    expect({ ...web, context: Object.keys(web!.context as object).sort() }).toEqual({ ...legacy, context: Object.keys(legacy!.context as object).sort() });
  });
});
