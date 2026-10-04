import { test, expect, type Page } from '@playwright/test';
import { openApp, openSidebar } from './helpers';

// P4 item 7: Settings -> Runtime logs in /web/, and the logs.md sync behind it.
//
// The sync endpoint is intercepted in every test, so nothing here can write the real logs.md.
// Events are injected the way legacy's own tests do (push to window.notlinearRequestLog, then
// fire notlinear:log): /web/ has no traffic that logs until the chat core arrives in P5.

type Ev = Record<string, unknown>;
const EVENTS: Ev[] = [
  { timestamp: '2026-10-04T10:00:00.000Z', id: 1, kind: 'http', phase: 'start', method: 'POST', url: 'https://api.example.com/v1', headers: { 'x-api-key': '[redacted]' } },
  { timestamp: '2026-10-04T10:00:01.000Z', id: 1, kind: 'http', phase: 'end', status: 200, durationMs: 812 },
  { timestamp: '2026-10-04T10:00:02.000Z', id: 'tool-1', kind: 'tool', phase: 'error', error: 'Request timed out' },
];

async function inject(page: Page, events: Ev[]): Promise<void> {
  await page.evaluate(evs => {
    const log = (window as unknown as { notlinearRequestLog: unknown[] }).notlinearRequestLog;
    log.push(...evs);
    window.dispatchEvent(new CustomEvent('notlinear:log'));
  }, events);
}
interface Sync { headers: Record<string, string>; events: Ev[] }
async function interceptSync(page: Page, status = 200): Promise<Sync[]> {
  const seen: Sync[] = [];
  await page.route('**/__notlinear_runtime_logs', r => {
    seen.push({ headers: r.request().headers(), events: (r.request().postDataJSON() as { events: Ev[] }).events });
    return r.fulfill({ status, contentType: 'application/json', body: status < 400 ? '{"ok":true}' : '{"ok":false}' });
  });
  return seen;
}
const sidebar = (p: Page) => p.locator('aside[aria-label="Left pane"]');
async function showSidebar(p: Page): Promise<void> {
  if (((await sidebar(p).getAttribute('class')) ?? '').includes('invisible')) await p.getByRole('button', { name: 'Open left pane' }).click();
  await expect(sidebar(p)).not.toHaveClass(/invisible/);
}
async function openWebLogs(page: Page): Promise<void> {
  await page.goto('/web/');
  await expect(page.getByRole('button', { name: 'Open left pane' })).toBeVisible();
}
async function expandLogs(page: Page): Promise<void> {
  await showSidebar(page);
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'View request logs' }).click();
}

test.describe('the viewer', () => {
  test('starts empty with the legacy wording', async ({ page }) => {
    await interceptSync(page);
    await openWebLogs(page);
    await expandLogs(page);
    await expect(page.getByTestId('logs-summary')).toHaveText('0 events');
    await expect(page.getByTestId('logs-content')).toHaveText('No log events yet.');
    await expect(page.getByTestId('logs-file-status')).toHaveText('logs.md sync pending');
  });

  test('shows events newest first as pretty JSON, singular for one, and updates live while open', async ({ page }) => {
    await interceptSync(page);
    await openWebLogs(page);
    await expandLogs(page);
    await inject(page, [EVENTS[0]!]);
    await expect(page.getByTestId('logs-summary')).toHaveText('1 event');
    await inject(page, EVENTS.slice(1));
    await expect(page.getByTestId('logs-summary')).toHaveText('3 events');
    const text = await page.getByTestId('logs-content').innerText();
    expect(text.indexOf('Request timed out')).toBeLessThan(text.indexOf('"durationMs": 812'));
    expect(text.indexOf('"durationMs": 812')).toBeLessThan(text.indexOf('api.example.com'));
    expect(text).toContain('"x-api-key": "[redacted]"');
  });

  test('Refresh re-reads the buffer; Clear empties it and says so', async ({ page }) => {
    await interceptSync(page);
    await openWebLogs(page);
    await inject(page, EVENTS); // logged while the viewer is closed
    await expandLogs(page);
    await expect(page.getByTestId('logs-summary')).toHaveText('3 events');
    await page.getByRole('button', { name: 'Clear logs' }).click();
    await expect(page.getByText('Logs cleared')).toBeVisible();
    await expect(page.getByTestId('logs-summary')).toHaveText('0 events');
    await expect(page.getByTestId('logs-content')).toHaveText('No log events yet.');
    expect(await page.evaluate(() => (window as unknown as { notlinearRequestLog: unknown[] }).notlinearRequestLog.length)).toBe(0);
  });

  test('Copy puts the whole log on the clipboard, oldest first, and says so', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await interceptSync(page);
    await openWebLogs(page);
    await inject(page, EVENTS);
    await expandLogs(page);
    await page.getByRole('button', { name: 'Copy logs' }).click();
    await expect(page.getByText('Logs copied')).toBeVisible();
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toBe(EVENTS.map(e => JSON.stringify(e, null, 2)).join('\n\n'));
  });
});

test.describe('syncing into logs.md', () => {
  test('one debounced POST for a burst, carrying X-Notlinear-Local and the events, then "synced"', async ({ page }) => {
    const seen = await interceptSync(page);
    await openWebLogs(page);
    await expandLogs(page);
    for (const e of EVENTS) await inject(page, [e]);
    await expect(page.getByTestId('logs-file-status')).toHaveText('logs.md sync pending');
    await expect.poll(() => seen.length, { timeout: 7000 }).toBe(1);
    expect(seen[0]!.headers['x-notlinear-local']).toBe('1'); // BUGS.md #055: the server 403s without it
    expect(seen[0]!.events).toHaveLength(3);
    await expect(page.getByTestId('logs-file-status')).toHaveText('logs.md synced');
  });

  test('a refusing server turns it off, shows "unavailable", and is not retried', async ({ page }) => {
    const seen = await interceptSync(page, 403);
    await openWebLogs(page);
    await expandLogs(page);
    await inject(page, [EVENTS[0]!]);
    await expect(page.getByTestId('logs-file-status')).toHaveText('logs.md sync unavailable', { timeout: 7000 });
    await inject(page, [EVENTS[1]!]);
    await page.waitForTimeout(2000);
    expect(seen).toHaveLength(1);
  });
});

test.describe('parity with the legacy viewer', () => {
  test('the same events render as the same text, in the same order, with the same count', async ({ page }) => {
    await interceptSync(page);
    await openApp(page);
    await inject(page, EVENTS);
    await openSidebar(page);
    await page.locator('#open-prefs').click();
    await page.locator('#logs-toggle').click();
    await expect(page.locator('#logs-summary')).toHaveText('3 events');
    const legacy = { summary: (await page.locator('#logs-summary').innerText()).trim(), content: await page.locator('#logs-content').textContent() };

    await openWebLogs(page);
    await inject(page, EVENTS);
    await expandLogs(page);
    await expect(page.getByTestId('logs-summary')).toHaveText('3 events');
    const web = { summary: (await page.getByTestId('logs-summary').innerText()).trim(), content: await page.getByTestId('logs-content').textContent() };
    expect(web.summary.toLowerCase()).toBe(legacy.summary.toLowerCase());
    expect(web.content).toBe(legacy.content);
    expect(web.content).toContain('Request timed out');
  });
});
