import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, type Page, type Route } from '@playwright/test';

/** The legacy app is a private, gitignored tree. Specs that cross-check against it skip without it. */
export const LEGACY_PATH = '/frontend/index.html';
export const HAS_LEGACY = existsSync(fileURLToPath(new URL('../../../frontend/index.html', import.meta.url)));

/**
 * Installs a fake Anthropic API before the app loads.
 *
 * The chat flow cannot be exercised without an assistant response, and the
 * real API needs a key, costs money and is non-deterministic — none of which
 * belongs in a regression suite. frontend/providers/claude.js POSTs to
 * https://api.anthropic.com/v1/messages with `stream: true` and parses the SSE
 * event stream, so this returns a hand-built stream in that exact shape.
 *
 * Returns the text the fake assistant will "say", so a test can assert on it.
 */
export async function mockClaude(page: Page, reply = 'The mitochondria is the powerhouse of the cell.'): Promise<string> {
  await page.route('https://api.anthropic.com/v1/messages', async (route: Route) => {
    // Deltas are split so the UI genuinely streams rather than receiving one
    // chunk — the streaming path is where the highlight/branch bugs live.
    const words = reply.split(' ');
    const events = [
      `event: message_start\ndata: ${JSON.stringify({ type: 'message_start', message: { id: 'msg_test', model: 'claude', role: 'assistant', content: [], usage: { input_tokens: 10, output_tokens: 0 } } })}\n\n`,
      `event: content_block_start\ndata: ${JSON.stringify({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } })}\n\n`,
      ...words.map((w, i) =>
        `event: content_block_delta\ndata: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: i === 0 ? w : ' ' + w } })}\n\n`),
      `event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n`,
      `event: message_delta\ndata: ${JSON.stringify({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: words.length } })}\n\n`,
      `event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`,
    ];
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
      body: events.join(''),
    });
  });
  return reply;
}

/**
 * Seeds an API key before the app boots.
 *
 * app.js reads localStorage.nl_api_keys during init (app.js:4577), so this has
 * to run as an init script rather than after navigation. The value is a dummy;
 * the request never leaves the browser because mockClaude intercepts it.
 */
export async function seedApiKey(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('nl_api_keys', JSON.stringify({ anthropic: 'sk-ant-test-not-a-real-key' }));
  });
}

/**
 * Sets the theme before first paint.
 *
 * `nl_theme` alone is NOT enough to survive a reload: app.js treats
 * `prefs.theme` as the source of truth and applyTheme() (app.js:4306)
 * overwrites `nl_theme` from it on every render. So a durable theme has to be
 * seeded into the persisted prefs too — which is also how the real app stores
 * it when the user picks a theme.
 */
export async function seedTheme(page: Page, theme: 'light' | 'grey'): Promise<void> {
  await page.addInitScript((t) => {
    localStorage.setItem('nl_theme', t);
    // Seed the Dexie `state` row so loadPersistedState restores this theme.
    const open = indexedDB.open('notlinear', 1);
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains('kv')) open.result.createObjectStore('kv', { keyPath: 'key' });
    };
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put({
        key: 'state',
        value: {
          threads: {}, current: 'doc-main', dynamic: [], deletedThreads: [],
          chatCount: 1, projects: {}, projectCount: 1, prefs: { theme: t },
        },
      });
      tx.oncomplete = () => db.close();
    };
  }, theme);
}

/**
 * Opens the collapsible left pane.
 *
 * The sidebar ships `aria-hidden="true"` and only gets its `open` class from
 * setSidebar() (app.js:1192), so thread rows are not clickable until this runs.
 */
export async function openSidebar(page: Page): Promise<void> {
  const sidebar = page.locator('#sidebar');
  if (!(await sidebar.evaluate(el => el.classList.contains('open')))) {
    await page.locator('#sidebar-toggle').click();
    await sidebar.evaluate(el => el.classList.contains('open'));
    await page.waitForTimeout(250); // the open transition
  }
}

/** Clicks a thread in the sidebar, opening the pane first if needed. */
export async function switchToThread(page: Page, threadId: string): Promise<void> {
  await openSidebar(page);
  await page.locator(`.sidebar [data-thread="${threadId}"] .thread-open`).click();
  await page.waitForTimeout(500);
}

/** Opens the LEGACY app and waits for app.js to have populated the sidebar. */
export async function openApp(page: Page): Promise<void> {
  test.skip(!HAS_LEGACY, 'cross-checks against the legacy app, which is not part of this repo');
  await page.goto(LEGACY_PATH);
  await page.waitForSelector('.sidebar [data-thread]', { state: 'attached' });
}

/** Sends a message through the composer and waits for the stream to finish. */
export async function sendMessage(page: Page, text: string): Promise<void> {
  const input = page.locator('#main-input');
  await input.click();
  await input.fill(text);
  await input.press('Enter');
}

/** Reads the persisted chat state straight out of IndexedDB. */
export async function readPersistedState(page: Page): Promise<Record<string, unknown> | null> {
  return page.evaluate(async () => {
    return new Promise((resolve) => {
      const open = indexedDB.open('notlinear');
      open.onerror = () => resolve(null);
      open.onsuccess = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains('kv')) { db.close(); resolve(null); return; }
        const req = db.transaction('kv', 'readonly').objectStore('kv').get('state');
        req.onsuccess = () => { const v = req.result?.value ?? null; db.close(); resolve(v); };
        req.onerror = () => { db.close(); resolve(null); };
      };
    });
  });
}
