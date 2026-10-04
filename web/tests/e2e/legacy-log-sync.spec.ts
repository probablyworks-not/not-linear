import { test, expect } from '@playwright/test';
import { openApp } from './helpers';

// BUGS.md #055: the legacy app's logs.md sync sent no X-Notlinear-Local header, so
// after the P2 hardening the server answered 403 and the sync silently disabled itself.
// Smoke step 8 ("runtime log still syncs into logs.md") would have caught it, but only
// when someone looked at logs.md.
//
// The endpoint is fulfilled by the test, never reached, so this can never write the real logs.md.

test.describe('legacy runtime-log sync (BUGS.md #055)', () => {
  test('sends X-Notlinear-Local, and reports synced when the server accepts it', async ({ page }) => {
    const seen: Array<Record<string, string>> = [];
    await page.route('**/__notlinear_runtime_logs', r => {
      seen.push(r.request().headers());
      return r.fulfill({ contentType: 'application/json', body: '{"ok":true}' });
    });
    await openApp(page);
    await page.evaluate(() => {
      (window as unknown as { notlinearRequestLog: unknown[] }).notlinearRequestLog.push({ timestamp: new Date().toISOString(), kind: 'http', phase: 'start', url: '/probe' });
      window.dispatchEvent(new CustomEvent('notlinear:log'));
    });
    await expect.poll(() => seen.length, { timeout: 6000 }).toBeGreaterThan(0); // after the 1200ms debounce
    expect(seen[0]!['x-notlinear-local']).toBe('1');
    await expect(page.locator('#logs-file-status')).toHaveText('logs.md synced');
  });

  test('and the server really does refuse the request without it (so the header is load-bearing)', async ({ request }) => {
    const res = await request.post('/__notlinear_runtime_logs', { data: { events: [] } });
    expect(res.status()).toBe(403); // refused by the middleware before any handler runs: nothing is written
  });
});
