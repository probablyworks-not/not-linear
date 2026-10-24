import { test, expect, type Page } from '@playwright/test';
import { openSettings } from './helpers';

// Settings -> Runtime logs in /web/, and the logs.md sync behind it.
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
const row = (p: Page, kind: string) => p.locator(`[data-log-kind="${kind}"]`);
async function openLogs(page: Page): Promise<void> { await openSettings(page, 'Runtime logs'); }

const OK_LLM: Ev = { timestamp: '2026-10-21T19:45:08.726Z', id: 2, kind: 'http', phase: 'end', provider: 'anthropic', label: 'messages', status: 200, durationMs: 19625, inputTokens: 7507, outputTokens: 984 };
const OK_TOOL: Ev = { timestamp: '2026-10-21T19:45:01.210Z', id: 3, kind: 'http', phase: 'end', provider: 'serper', label: 'search', status: 200, durationMs: 1204 };
const ERR: Ev = { timestamp: '2026-10-21T19:31:12.002Z', id: 4, kind: 'http', phase: 'error', provider: 'openai', label: 'chat', error: 'Request timed out', durationMs: 310 };

test.describe('the viewer', () => {
  test('starts empty with a calm empty state and the sync status', async ({ page }) => {
    await interceptSync(page);
    await openLogs(page);
    await expect(page.getByTestId('empty-state')).toContainText('No events.');
    await expect(page.getByTestId('count-logs')).toHaveText('0');
    await expect(page.getByTestId('logs-file-status')).toHaveText('logs.md sync pending');
    await expect(page.getByRole('button', { name: 'Copy logs' })).toBeDisabled();
  });

  test('shows events newest first with kind, title, meta; updates live; expands to JSON one row at a time', async ({ page }) => {
    await interceptSync(page);
    await openLogs(page);
    await inject(page, [ERR, OK_TOOL, OK_LLM]);
    await expect(page.getByTestId('count-logs')).toHaveText('3');
    const rows = page.getByRole('list', { name: 'Log events' }).getByRole('listitem');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText('anthropic · messages · 200'); // pushed last = newest = first
    await expect(rows.nth(0)).toContainText('19.6s · 8.5k tok');
    await expect(rows.nth(1)).toContainText('serper · search · 200');
    await expect(rows.nth(2)).toContainText('openai · chat · Request timed out');

    await rows.nth(0).getByRole('button').click();
    await expect(page.getByTestId('log-json')).toHaveCount(1);
    await expect(page.getByTestId('log-json')).toContainText('"inputTokens": 7507');
    await rows.nth(2).getByRole('button').click();
    await expect(page.getByTestId('log-json')).toHaveCount(1); // one open at a time
    await expect(rows.nth(2).getByTestId('log-json')).toContainText('Request timed out');
  });

  test('the filter splits LLM / Tool / Error and says so when nothing matches', async ({ page }) => {
    await interceptSync(page);
    await openLogs(page);
    await inject(page, [OK_LLM, OK_TOOL]);
    const tab = (n: string) => page.getByRole('tab', { name: new RegExp(`^${n}`) });
    await expect(tab('All')).toContainText('2');
    await expect(tab('LLM')).toContainText('1');
    await expect(tab('Error')).toContainText('0');
    await tab('Tool').click();
    await expect(row(page, 'tool')).toHaveCount(1);
    await expect(row(page, 'llm')).toHaveCount(0);
    await tab('Error').click();
    await expect(page.getByTestId('empty-state')).toContainText('No error events.');
  });

  test('Refresh re-reads the buffer', async ({ page }) => {
    await interceptSync(page);
    await openLogs(page);
    await page.evaluate(ev => { (window as unknown as { notlinearRequestLog: unknown[] }).notlinearRequestLog.push(ev); }, OK_LLM); // no event fired
    await page.getByRole('button', { name: 'Refresh logs' }).click();
    await expect(row(page, 'llm')).toHaveCount(1);
  });

  test('Clear asks first (Esc keeps the log), then empties the buffer and says so', async ({ page }) => {
    await interceptSync(page);
    await openLogs(page);
    await inject(page, [OK_LLM, ERR]);
    await page.getByRole('button', { name: 'Clear logs' }).click();
    await expect(page.getByRole('alertdialog').getByRole('heading')).toHaveText('Clear runtime logs?');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('count-logs')).toHaveText('2');
    await page.getByRole('button', { name: 'Clear logs' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Clear logs' }).click();
    await expect(page.getByText('Logs cleared')).toBeVisible();
    await expect(page.getByTestId('count-logs')).toHaveText('0');
    await expect(page.getByTestId('empty-state')).toContainText('No events.');
    expect(await page.evaluate(() => (window as unknown as { notlinearRequestLog: unknown[] }).notlinearRequestLog.length)).toBe(0);
  });

  test('Copy puts the visible events on the clipboard and says so', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await interceptSync(page);
    await openLogs(page);
    await inject(page, [OK_LLM, OK_TOOL]);
    await page.getByRole('tab', { name: /^Tool/ }).click();
    await page.getByRole('button', { name: 'Copy logs' }).click();
    await expect(page.getByText('Logs copied')).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(JSON.stringify(OK_TOOL, null, 2)); // only what is visible
  });

  test('never shows a key: the url in a title has no query string', async ({ page }) => {
    await interceptSync(page);
    await openLogs(page);
    await inject(page, [{ timestamp: '2026-10-21T19:45:01.210Z', kind: 'http', phase: 'end', provider: 'serper', url: 'https://google.serper.dev/search?api_key=NEEDLE', status: 200 }]);
    await expect(row(page, 'tool')).toContainText('serper · /search · 200');
    await expect(row(page, 'tool').getByRole('button')).not.toContainText('NEEDLE');
  });
});

test.describe('syncing into logs.md', () => {
  test('one debounced POST for a burst, carrying X-Notlinear-Local and the events, then "synced"', async ({ page }) => {
    const seen = await interceptSync(page);
    await openLogs(page);
    for (const e of [OK_LLM, OK_TOOL, ERR]) await inject(page, [e]);
    await expect(page.getByTestId('logs-file-status')).toHaveText('logs.md sync pending');
    await expect.poll(() => seen.length, { timeout: 7000 }).toBe(1);
    expect(seen[0]!.headers['x-notlinear-local']).toBe('1'); // BUGS.md #055: the server 403s without it
    expect(seen[0]!.events).toHaveLength(3);
    await expect(page.getByTestId('logs-file-status')).toHaveText('logs.md synced');
  });

  test('clearing syncs the empty log so logs.md follows the buffer', async ({ page }) => {
    const seen = await interceptSync(page);
    await openLogs(page);
    await inject(page, [OK_LLM]);
    await expect.poll(() => seen.length, { timeout: 7000 }).toBe(1);
    await page.getByRole('button', { name: 'Clear logs' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Clear logs' }).click();
    await expect.poll(() => seen.length, { timeout: 7000 }).toBe(2);
    expect(seen[1]!.events).toHaveLength(0);
  });

  test('a refusing server turns it off, shows "unavailable", and is not retried', async ({ page }) => {
    const seen = await interceptSync(page, 403);
    await openLogs(page);
    await inject(page, [OK_LLM]);
    await expect(page.getByTestId('logs-file-status')).toHaveText('logs.md sync unavailable', { timeout: 7000 });
    await inject(page, [OK_TOOL]);
    await page.waitForTimeout(2000);
    expect(seen).toHaveLength(1);
  });
});
