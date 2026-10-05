import { test, expect, type Page, type Route } from '@playwright/test';
import { readPersistedState } from './helpers';

// P5d: search-backed replies in /web/, the gate the handoff names ("smoke step 4 — status
// clears when the answer streams, results never lost, bugs #010-#018"). Every service is mocked:
// the model, Wikipedia, Serper. Nothing here reaches the network.

const WEB = '/web/';
type Req = { model?: string; system?: string; tools?: Array<{ name: string }>; messages: Array<{ role: string; content: unknown }> };

const sse = (events: unknown[]): string => events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('');
const claudeToolUse = (name: string, input: unknown): string => sse([
  { type: 'message_start', message: { usage: { input_tokens: 10 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu_1', name } },
  { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } },
  { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 4 } },
]);
const claudeAnswer = (text: string): string => sse([
  { type: 'message_start', message: { usage: { input_tokens: 30 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
  ...text.split(' ').map((w, i) => ({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: i ? ' ' + w : w } })),
  { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 12 } },
]);

async function mockWikipedia(page: Page): Promise<void> {
  await page.route('https://en.wikipedia.org/w/api.php**', route => route.fulfill({ json: { query: { search: [{ title: 'Tides' }] } } }));
  await page.route('https://en.wikipedia.org/api/rest_v1/page/summary/**', route => route.fulfill({
    json: { title: 'Tides', extract: 'Tides are the rise and fall of sea levels caused by the Moon.', content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Tide' } } },
  }));
}

async function seed(page: Page, keys: Record<string, string>): Promise<void> {
  await page.addInitScript(k => localStorage.setItem('nl_api_keys', JSON.stringify(k)), keys);
}

async function newChat(page: Page): Promise<void> {
  await page.goto(WEB);
  await page.getByRole('button', { name: 'Open left pane' }).click();
  await page.getByRole('button', { name: /New chat/ }).click();
  await page.getByRole('button', { name: 'Close left pane' }).click();
}
async function ask(page: Page, text: string): Promise<void> {
  const box = page.getByRole('textbox', { name: 'Message' });
  await box.fill(text);
  await box.press('Enter');
}
const persisted = async (page: Page) => (await readPersistedState(page)) as unknown as { threads: Record<string, { stream?: string; mainMessages?: Array<{ role: string; content: string }>; branchSnapshots?: Record<string, { bodyHTML: string; messages: Array<{ content: string }> }> }> };

/** A Claude mock that answers each request from `script`, optionally pausing the one at `holdAt` until released. */
async function scriptClaude(page: Page, script: string[], holdAt = -1): Promise<{ requests: Req[]; release(): void }> {
  const requests: Req[] = [];
  let release!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  await page.route('https://api.anthropic.com/v1/messages', async (route: Route) => {
    const n = requests.length;
    requests.push(JSON.parse(route.request().postData() ?? '{}') as Req);
    if (n === holdAt) await gate;
    await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: script[Math.min(n, script.length - 1)]! });
  });
  return { requests, release };
}

test.describe('search-backed replies', () => {
  test('the status says what is happening, clears when the answer streams, and the result reaches the model', async ({ page }) => {
    await seed(page, { anthropic: 'sk-ant-TESTONLY-t' });
    await mockWikipedia(page);
    const mock = await scriptClaude(page, [
      claudeToolUse('wikipedia_search', { query: 'tides' }),
      claudeAnswer('Tides come from the Moon pulling on the oceans.'),
    ], 1);
    await newChat(page);
    await ask(page, 'why are there tides?');

    // while the second request is held, the user is told what is going on
    const status = page.locator('[data-chat-stream] [data-live] .ai-status');
    await expect(status).toHaveAttribute('data-label', 'Thinking…'); // the search has finished; the model is working on the results
    expect(mock.requests).toHaveLength(2);
    mock.release();

    await expect(page.locator('[data-chat-stream] .msg.ai .ai-content')).toContainText('Tides come from the Moon');
    // the status is gone, live and saved (bugs #011-#013: it used to keep spinning after the answer started)
    await expect(page.locator('[data-chat-stream] .msg.ai .ai-status')).toHaveText('');
    await expect.poll(async () => Object.values((await persisted(page)).threads).some(t => (t.mainMessages?.length ?? 0) === 2)).toBe(true);
    const t = Object.values((await persisted(page)).threads).find(x => (x.mainMessages?.length ?? 0) === 2)!;
    expect(t.stream).not.toContain('Searching');
    expect(t.stream).not.toContain('Thinking…');

    // the model was offered the search tools and shown the result it asked for
    expect(mock.requests[0]!.tools!.map(x => x.name)).toEqual(['wikipedia_search', 'fetch_url']);
    const second = mock.requests[1]!.messages;
    expect(second.map(m => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(JSON.stringify(second[2]!.content)).toContain('Tides are the rise and fall of sea levels caused by the Moon.');
    expect(JSON.stringify(second[2]!.content)).toContain('Source: https://en.wikipedia.org/wiki/Tide');
  });

  test('the label names the tool while it runs', async ({ page }) => {
    await seed(page, { anthropic: 'sk-ant-TESTONLY-t' });
    let releaseWiki!: () => void;
    const wikiGate = new Promise<void>(r => { releaseWiki = r; });
    await page.route('https://en.wikipedia.org/w/api.php**', async route => { await wikiGate; await route.fulfill({ json: { query: { search: [{ title: 'Tides' }] } } }); });
    await page.route('https://en.wikipedia.org/api/rest_v1/page/summary/**', route => route.fulfill({ json: { title: 'Tides', extract: 'x' } }));
    await scriptClaude(page, [claudeToolUse('wikipedia_search', { query: 'tides' }), claudeAnswer('done now')]);
    await newChat(page);
    await ask(page, 'tides?');
    const status = page.locator('[data-chat-stream] [data-live] .ai-status');
    await expect(status).toHaveAttribute('data-label', 'Searching Wikipedia for "tides"…');
    await expect(status.locator('.working-detail')).toHaveText('"tides"'); // the query, small, next to the changing word
    releaseWiki();
    await expect(page.locator('[data-chat-stream] .msg.ai .ai-content')).toContainText('done now');
  });

  test('inside a branch panel too', async ({ page }) => {
    await seed(page, { anthropic: 'sk-ant-TESTONLY-t' });
    await mockWikipedia(page);
    const mock = await scriptClaude(page, [
      claudeAnswer('First answer about alpha and beta together.'),
      claudeToolUse('wikipedia_search', { query: 'tides' }),
      claudeAnswer('Branch answer from the search.'),
    ]);
    await newChat(page);
    await ask(page, 'start');
    await expect(page.locator('[data-chat-stream] .msg.ai .ai-content')).toContainText('First answer');
    await page.evaluate(() => {
      const root = document.querySelector('[data-chat-stream] .msg.ai .ai-content')!;
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); w.nextNode();
      const n = w.currentNode as Text; const i = n.nodeValue!.indexOf('alpha and beta');
      const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 'alpha and beta'.length);
      const s = getSelection()!; s.removeAllRanges(); s.addRange(r);
    });
    await page.keyboard.press('b');
    const panel = page.locator('[data-testid="branch-stack"] .branch').first();
    await panel.getByRole('textbox', { name: 'Ask about this passage' }).fill('look it up');
    await panel.getByRole('textbox', { name: 'Ask about this passage' }).press('Enter');
    await expect(panel.locator('.branch-body .msg.ai .ai-content')).toContainText('Branch answer from the search.');
    await expect(panel.locator('.branch-body .ai-status')).toHaveText('');
    expect(mock.requests).toHaveLength(3);
    expect(JSON.stringify(mock.requests[2]!.messages.at(-1)!.content)).toContain('Tides are the rise and fall');
    const bid = (await panel.getAttribute('data-bid'))!;
    const t = Object.values((await persisted(page)).threads).find(x => x.branchSnapshots?.[bid])!;
    expect(t.branchSnapshots![bid]!.messages.map(m => m.content)).toEqual(['look it up', 'Branch answer from the search.']);
  });

  test('a rejected search key ends the reply with a message that says what to do, and Try again works once fixed', async ({ page }) => {
    await seed(page, { anthropic: 'sk-ant-TESTONLY-t', serper: 'serper-TESTONLY-bad' });
    let serperCalls = 0;
    await page.route('https://google.serper.dev/search', route => {
      serperCalls += 1;
      return serperCalls === 1
        ? route.fulfill({ status: 401, body: '{}' })
        : route.fulfill({ json: { organic: [{ title: 'Tide', link: 'https://s/t', snippet: 'a tide' }] } });
    });
    await scriptClaude(page, [
      claudeToolUse('serper_search', { query: 'tides' }),
      claudeToolUse('serper_search', { query: 'tides' }),
      claudeAnswer('Found it after the retry.'),
    ]);
    await newChat(page);
    await ask(page, 'search tides');
    await expect(page.locator('[data-chat-stream] .err-msg')).toContainText('Serper search key was rejected. Check the Serper key in Settings.');
    await page.getByRole('button', { name: /Try again/ }).click();
    await expect(page.locator('[data-chat-stream] .msg.ai .ai-content')).toContainText('Found it after the retry.');
    await expect(page.locator('[data-chat-stream] .msg.user')).toHaveCount(1);
  });

  test('which tools the model is offered, and what it is told, follow the keys in Settings', async ({ page }) => {
    await seed(page, { anthropic: 'sk-ant-TESTONLY-t', serper: 'serper-TESTONLY-k', firecrawl: 'fc-TESTONLY-k' });
    const mock = await scriptClaude(page, [claudeAnswer('ok')]);
    await newChat(page);
    await ask(page, 'hello');
    await expect(page.locator('[data-chat-stream] .msg.ai .ai-content')).toContainText('ok');
    expect(mock.requests[0]!.tools!.map(t => t.name)).toEqual(['wikipedia_search', 'serper_search', 'fetch_url', 'firecrawl_scrape']);
    expect(mock.requests[0]!.system).toContain('use serper_search for current information');
    expect(mock.requests[0]!.system).toContain('use firecrawl_scrape only when the user explicitly asks');
  });

  test('DeepSeek searches too: the tool call is run and its result answers the question', async ({ page }) => {
    await seed(page, { deepseek: 'sk-ds-TESTONLY-d' });
    await mockWikipedia(page);
    const bodies: Array<{ messages: Array<{ role: string }>; tools?: unknown }> = [];
    await page.route('https://api.deepseek.com/v1/chat/completions', route => {
      bodies.push(JSON.parse(route.request().postData() ?? '{}'));
      const chunks = bodies.length === 1
        ? [{ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'wikipedia_search', arguments: '{"query":"tides"}' } }] }, finish_reason: null }] }, { choices: [{ delta: {}, finish_reason: 'tool_calls' }] }]
        : [{ choices: [{ delta: { content: 'DeepSeek says: the Moon causes tides.' }, finish_reason: null }] }, { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 9, completion_tokens: 6 } }];
      return route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: chunks.map(c => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n' });
    });
    await newChat(page);
    await page.locator('.model-chip').click();
    await page.getByRole('menuitem', { name: /DeepSeek Flash/ }).click();
    await ask(page, 'why tides?');
    await expect(page.locator('[data-chat-stream] .msg.ai .ai-content')).toContainText('DeepSeek says: the Moon causes tides.');
    expect(bodies).toHaveLength(2);
    expect(bodies[1]!.messages.map(m => m.role)).toEqual(['system', 'user', 'assistant', 'tool']);
    await expect(page.locator('[data-chat-stream] .msg.ai .ai-status')).toHaveText('');
  });
});
