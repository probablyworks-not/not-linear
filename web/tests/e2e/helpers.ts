import type { Page, Route } from '@playwright/test';

/**
 * Installs a fake Anthropic API before the app loads.
 *
 * The chat flow cannot be exercised without an assistant response, and the
 * real API needs a key, costs money and is non-deterministic — none of which
 * belongs in a regression suite. The Claude provider POSTs to
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
