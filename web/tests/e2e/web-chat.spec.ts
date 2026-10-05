import { test, expect, type Page, type Route } from '@playwright/test';
import { mockClaude, openApp, readPersistedState, sendMessage as sendInLegacy, switchToThread } from './helpers';

// P5a: chat in /web/ — one thread, no branches. The property that matters most is
// the dual-write (ADR-038): a reply React streams must be a reply the legacy app can
// open and CONTINUE, and the other way round. Every provider call is mocked; nothing
// here reaches a real API.

const WEB = '/web/';
const FAKE_KEYS = { anthropic: 'sk-ant-TESTONLY-chat-aaaaaaaa', deepseek: 'sk-ds-TESTONLY-chat-bbbbbbbb' };

async function seedKeys(page: Page, keys: Record<string, string> = FAKE_KEYS): Promise<void> {
  await page.addInitScript(k => localStorage.setItem('nl_api_keys', JSON.stringify(k)), keys);
}

async function newWebChat(page: Page): Promise<void> {
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

type Persisted = { current: string; threads: Record<string, { stream?: string; mainMessages?: Array<{ role: string; content: string }>; title?: string; provider?: string; model?: string }> };
const persisted = async (page: Page): Promise<Persisted> => (await readPersistedState(page)) as unknown as Persisted;

/** Polls the stored row for a condition instead of sleeping: a fixed wait flakes (see the handoff). */
async function threadWhere(page: Page, ok: (t: Persisted['threads'][string]) => boolean): Promise<{ id: string; thread: Persisted['threads'][string] }> {
  let found: { id: string; thread: Persisted['threads'][string] } | null = null;
  await expect.poll(async () => {
    const s = await persisted(page);
    const hit = Object.entries(s.threads).find(([, t]) => ok(t));
    found = hit ? { id: hit[0], thread: hit[1] } : null;
    return !!found;
  }).toBe(true);
  return found!;
}

async function deepseekReply(page: Page, text: string): Promise<void> {
  await page.route('https://api.deepseek.com/v1/chat/completions', async (route: Route) => {
    const chunks = [
      ...text.split(' ').map((w, i) => ({ choices: [{ delta: { content: i === 0 ? w : ' ' + w }, finish_reason: null }] })),
      { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 4, prompt_cache_hit_tokens: 0 } },
    ];
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      body: chunks.map(c => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n',
    });
  });
}

test.describe('send and stream', () => {
  test('a message streams in, is saved, and survives a reload', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    await seedKeys(page);
    const reply = await mockClaude(page, 'Tides come from the moon and the sun pulling on the ocean.');
    await newWebChat(page);
    await ask(page, 'Why are there tides?');

    const stream = page.getByTestId('chat-stream');
    await expect(stream.locator('.msg.user')).toContainText('Why are there tides?');
    await expect(stream.locator('.msg.ai .ai-content')).toContainText(reply);
    await expect(page.getByRole('button', { name: 'Send' })).toBeDisabled(); // composer is empty again, not stuck on Stop

    const { id, thread } = await threadWhere(page, t => !!t.mainMessages?.length);
    expect(thread.mainMessages).toEqual([
      { role: 'user', content: 'Why are there tides?' },
      { role: 'assistant', content: reply },
    ]);
    expect(thread.title).toBe('Why are there tides');
    expect(thread.stream).toContain('data-turn-id=');

    await page.reload();
    await expect(page.getByTestId('chat-stream').locator('.msg.ai .ai-content')).toContainText(reply);
    expect((await persisted(page)).threads[id]!.mainMessages).toHaveLength(2);
    expect(errors, errors.join(' | ')).toEqual([]);
  });

  test('markdown renders: a code block with Copy, a table, and escaped HTML', async ({ page }) => {
    await seedKeys(page);
    await mockClaude(page, 'Here is the plan.\n\n- first point\n- second point\n\n1. one\n2. two\n\n## Plan\n\n```js\nconst a = 1;\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n<script>window.__pwned = 1</script>');
    await newWebChat(page);
    await ask(page, 'show me');
    const ai = page.getByTestId('chat-stream').locator('.msg.ai .ai-content');
    await expect(ai.locator('h2')).toHaveText('Plan');
    await expect(ai.locator('.code-block .code-block-lang')).toHaveText('js');
    await expect(ai.locator('.code-block button.code-copy-btn')).toBeVisible();
    await expect(ai.locator('table th')).toHaveText(['a', 'b']);
    // Tailwind's reset removes list markers; replies must put them back (it once rendered bullets as plain lines).
    await expect(ai.locator('ul')).toHaveCSS('list-style-type', 'disc');
    await expect(ai.locator('ol')).toHaveCSS('list-style-type', 'decimal');
    expect(await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)).toBeUndefined();
  });

  test('the second message carries the first one as context', async ({ page }) => {
    await seedKeys(page);
    const bodies: Array<{ messages: Array<{ role: string; content: string }> }> = [];
    page.on('request', req => {
      if (req.url() === 'https://api.anthropic.com/v1/messages') bodies.push(JSON.parse(req.postData() ?? '{}'));
    });
    await mockClaude(page, 'Noted.');
    await newWebChat(page);
    const stop = page.getByRole('button', { name: 'Stop' });
    await ask(page, 'My favourite number is 42.');
    await expect(page.getByTestId('chat-stream').locator('.msg.ai .ai-content')).toContainText('Noted.');
    await expect(stop).toHaveCount(0); // the first reply has finished, so the composer will accept the next message
    await ask(page, 'What did I just say?');
    await expect.poll(() => bodies.length).toBe(2);
    expect(bodies[1]!.messages).toEqual([
      { role: 'user', content: 'My favourite number is 42.' },
      { role: 'assistant', content: 'Noted.' },
      { role: 'user', content: 'What did I just say?' },
    ]);
  });
});

test.describe('both apps share the thread (ADR-038)', () => {
  test('a thread written by /web/ opens in the legacy app with the same content, and legacy can continue it', async ({ page }) => {
    await seedKeys(page);
    const reply = await mockClaude(page, 'Alpha beta gamma delta.');
    await newWebChat(page);
    await ask(page, 'Say the greek letters');
    await expect(page.getByTestId('chat-stream').locator('.msg.ai .ai-content')).toContainText(reply);
    const { id } = await threadWhere(page, t => (t.mainMessages?.length ?? 0) === 2);

    await openApp(page);
    await switchToThread(page, id);
    await expect(page.locator('#chat-stream .msg.user')).toContainText('Say the greek letters');
    await expect(page.locator('#chat-stream .msg.ai .ai-content')).toContainText(reply);

    // Legacy appends a second turn on top of what React wrote.
    await sendInLegacy(page, 'And again');
    await expect(page.locator('#chat-stream .msg.ai')).toHaveCount(2);
    await expect.poll(async () => (await persisted(page)).threads[id]!.mainMessages?.length).toBe(4);

    // ...and /web/ then shows both turns.
    await page.goto(WEB);
    await expect(page.getByTestId('chat-stream').locator('.msg.user')).toHaveCount(2);
    await expect(page.getByTestId('chat-stream').locator('.msg.ai')).toHaveCount(2);
  });

  test('a thread written by legacy shows in /web/ and /web/ can continue it', async ({ page }) => {
    await seedKeys(page);
    const reply = await mockClaude(page, 'From the classic app.');
    await openApp(page);
    await page.locator('#sidebar-toggle').click();
    await page.getByRole('button', { name: /New chat/ }).first().click();
    await sendInLegacy(page, 'Hello from legacy');
    await expect(page.locator('#chat-stream .msg.ai .ai-content')).toContainText(reply);
    const { id } = await threadWhere(page, t => (t.mainMessages?.length ?? 0) === 2);

    await page.goto(WEB);
    await expect(page.getByRole('button', { name: 'Open left pane' })).toBeVisible();
    await page.getByRole('button', { name: 'Open left pane' }).click();
    await page.locator(`aside[aria-label="Left pane"] [data-thread="${id}"]`).first().click();
    await expect(page.getByTestId('chat-stream').locator('.msg.user')).toContainText('Hello from legacy');
    await expect(page.getByTestId('chat-stream').locator('.msg.ai .ai-content')).toContainText(reply);

    await ask(page, 'Continue in web');
    await expect.poll(async () => (await persisted(page)).threads[id]!.mainMessages?.length).toBe(4);
  });
});

test.describe('failure', () => {
  test('Claude rate-limits, a DeepSeek key exists: the answer comes from DeepSeek and the thread records it (bug #023)', async ({ page }) => {
    await seedKeys(page);
    await page.route('https://api.anthropic.com/v1/messages', route => route.fulfill({ status: 429, body: '{"error":{"message":"slow down"}}' }));
    await deepseekReply(page, 'Answered by DeepSeek instead.');
    await newWebChat(page);
    await ask(page, 'anything');
    await expect(page.getByTestId('chat-stream').locator('.msg.ai .ai-content')).toContainText('Answered by DeepSeek instead.');
    const { thread } = await threadWhere(page, t => (t.mainMessages?.length ?? 0) === 2);
    expect(thread.provider).toBe('deepseek');
    expect(thread.model).toBe('deepseek-v4-flash');
    await expect(page.getByTestId('turn-actions')).toHaveCount(0);
  });

  test('Claude rate-limits and there is no DeepSeek key: a calm message and a Try again button, not a fallback', async ({ page }) => {
    await seedKeys(page, { anthropic: FAKE_KEYS.anthropic });
    let calls = 0;
    await page.route('https://api.anthropic.com/v1/messages', route => { calls += 1; return route.fulfill({ status: 429, body: '{}' }); });
    await newWebChat(page);
    await ask(page, 'anything');
    await expect(page.getByTestId('chat-stream').locator('.err-msg')).toContainText('Claude is rate limited');
    await expect(page.getByRole('button', { name: /Try again/ })).toBeVisible();
    expect(calls).toBe(1);
  });

  test('Try again re-asks the same question without duplicating it', async ({ page }) => {
    await seedKeys(page);
    let first = true;
    await page.route('https://api.anthropic.com/v1/messages', route => {
      if (first) { first = false; return route.fulfill({ status: 529, body: '{}' }); }
      return route.fulfill({
        status: 200, headers: { 'content-type': 'text/event-stream' },
        body: [
          { type: 'message_start', message: { usage: { input_tokens: 3 } } },
          { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
          { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Back again.' } },
          { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } },
        ].map(e => `data: ${JSON.stringify(e)}\n\n`).join(''),
      });
    });
    await newWebChat(page);
    await ask(page, 'once only');
    await page.getByRole('button', { name: /Try again/ }).click();
    await expect(page.getByTestId('chat-stream').locator('.msg.ai .ai-content')).toContainText('Back again.');
    await expect(page.getByTestId('chat-stream').locator('.msg.user')).toHaveCount(1);
    await expect(page.getByTestId('chat-stream').locator('.err-block')).toHaveCount(0);
  });

  test('no key: says what to do and offers Settings', async ({ page }) => {
    await newWebChat(page);
    await ask(page, 'hello');
    await expect(page.getByTestId('chat-stream').locator('.err-msg')).toContainText('No Anthropic API key set');
    await page.getByRole('button', { name: 'Open settings' }).last().click();
    await expect(page.getByRole('dialog', { name: 'Settings' })).toBeVisible();
  });
});
