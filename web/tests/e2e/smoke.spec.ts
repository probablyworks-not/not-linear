import { test, expect } from '@playwright/test';
import { openApp, seedTheme, seedApiKey, mockClaude, sendMessage, readPersistedState, switchToThread } from './helpers';

// Automates the parts of the 10-step manual smoke test (AGENTS.md:50-64) that
// can run unattended. Steps needing native macOS dialogs (file/folder pick,
// screenshots) and human visual judgement stay manual and are listed at the
// bottom of this file so the gap is explicit rather than forgotten.

test.describe('step 1 — the app loads', () => {
  test('renders the shell with no uncaught page errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    // CDN scripts (mermaid, KaTeX, highlight.js) can 404 offline without
    // breaking the app, so console noise is not failed on — only real
    // uncaught exceptions are.
    await openApp(page);
    await expect(page.locator('#main-input')).toBeVisible();
    await expect(page.locator('.sidebar')).toBeAttached();
    expect(errors, `uncaught page errors: ${errors.join(' | ')}`).toEqual([]);
  });

  test('shows the seeded threads in the sidebar', async ({ page }) => {
    await openApp(page);
    await expect(page.locator('.sidebar [data-thread="doc-main"]')).toBeAttached();
    expect(await page.locator('.sidebar [data-thread]').count()).toBeGreaterThan(0);
  });
});

test.describe('step 7 — themes and persistence', () => {
  for (const theme of ['light', 'grey'] as const) {
    test(`applies the ${theme} theme before first paint`, async ({ page }) => {
      await seedTheme(page, theme);
      await openApp(page);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    });
  }

  test('keeps the theme across a reload', async ({ page }) => {
    await seedTheme(page, 'grey');
    await openApp(page);
    await page.reload();
    await page.waitForSelector('.sidebar [data-thread]', { state: 'attached' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'grey');
  });

  test('keeps API keys across a reload', async ({ page }) => {
    await seedApiKey(page);
    await openApp(page);
    await page.reload();
    const keys = await page.evaluate(() => localStorage.getItem('nl_api_keys'));
    expect(keys).toContain('anthropic');
  });
});

test.describe('step 2 — sending a message (provider mocked)', () => {
  test('streams an assistant reply into the transcript', async ({ page }) => {
    await seedApiKey(page);
    const reply = await mockClaude(page);
    await openApp(page);

    await sendMessage(page, 'what is the powerhouse of the cell?');

    // The assistant text arriving at all is the assertion; how it is chunked
    // is an implementation detail.
    await expect(page.locator('#chat-stream')).toContainText(reply.slice(0, 30), { timeout: 15_000 });
  });

  test('persists the exchange to IndexedDB', async ({ page }) => {
    await seedApiKey(page);
    const reply = await mockClaude(page);
    await openApp(page);
    await sendMessage(page, 'persist me');
    await expect(page.locator('#chat-stream')).toContainText(reply.slice(0, 20), { timeout: 15_000 });

    // Persistence is debounced (CLAUDE.md "debounce, don't blast").
    await page.waitForTimeout(1200);
    const state = await readPersistedState(page);
    expect(state, 'nothing was persisted to IndexedDB').not.toBeNull();
    expect(state).toHaveProperty('threads');
  });
});

test.describe('steps 3 and 8 — persistence across reload (BUGS #008/#009)', () => {
  test('a sent message survives a full page reload', async ({ page }) => {
    await seedApiKey(page);
    const reply = await mockClaude(page);
    await openApp(page);
    await sendMessage(page, 'survive the reload');
    await expect(page.locator('#chat-stream')).toContainText(reply.slice(0, 20), { timeout: 15_000 });
    await page.waitForTimeout(1200); // let the debounced write land

    await page.reload();
    await page.waitForSelector('.sidebar [data-thread]', { state: 'attached' });

    // This is the regression that manual same-session checks kept missing:
    // the content is restored from the persisted `stream` HTML blob.
    await expect(page.locator('#chat-stream')).toContainText(reply.slice(0, 20), { timeout: 15_000 });
  });

  test('switching threads and back preserves content', async ({ page }) => {
    await seedApiKey(page);
    const reply = await mockClaude(page);
    await openApp(page);
    await sendMessage(page, 'round trip me');
    await expect(page.locator('#chat-stream')).toContainText(reply.slice(0, 20), { timeout: 15_000 });
    await page.waitForTimeout(1200);

    // Away to another thread, then back. The sidebar must be opened first —
    // it ships collapsed, so the rows are not clickable until then.
    await switchToThread(page, 'pricing');
    await switchToThread(page, 'doc-main');

    await expect(page.locator('#chat-stream')).toContainText(reply.slice(0, 20), { timeout: 15_000 });
  });
});

test.describe('step 1 — search palette', () => {
  test('opens with the keyboard shortcut and closes with Escape', async ({ page }) => {
    await openApp(page);
    // Asserted on the palette's `show` class, not the input's visibility: the
    // palette hides via opacity/position rather than `display`, so the input
    // reads as "visible" to Playwright even while the palette is closed.
    const palette = page.locator('#search-palette');
    await expect(palette).not.toHaveClass(/\bshow\b/);
    await page.keyboard.press('Meta+k');
    await expect(palette).toHaveClass(/\bshow\b/);
    await expect(page.locator('#search-input')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(palette).not.toHaveClass(/\bshow\b/);
  });
});

test.describe('step 9 — in-app changelog viewer (BUGS #007)', () => {
  test('fetches CHANGELOG.md successfully', async ({ page }) => {
    await openApp(page);
    const status = await page.evaluate(async () => {
      const res = await fetch('/CHANGELOG.md', { cache: 'no-store' });
      return res.status;
    });
    expect(status).toBe(200);
  });
});

test.describe('P0 regression — CORS hardening stays in place', () => {
  test('the app can still reach its own endpoints same-origin', async ({ page }) => {
    await openApp(page);
    const ok = await page.evaluate(async () => {
      const res = await fetch('/__notlinear_runtime_logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: [] }),
      });
      return res.ok;
    });
    expect(ok, 'the app lost access to its own backend').toBe(true);
  });
});

// STILL MANUAL — these cannot run unattended and remain part of the human
// smoke test in AGENTS.md:50-64:
//   step 2 (second half)  Claude -> DeepSeek rate-limit fallback (#023): needs
//                         two real providers and an induced 429.
//   step 4                Search-backed branch question (#010-#018): needs a
//                         real search provider; mocking it is a P5d task.
//   step 5                Attach files AND a folder (#021): native macOS
//                         dialogs via osascript.
//   step 6                Highlights panel contrast in light mode (#022):
//                         visual judgement.
//   step 10               "New update - refresh" file-watch prompt: depends on
//                         editing a file mid-session.
