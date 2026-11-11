import { test, expect, type Page, type Route } from '@playwright/test';
import { readPersistedState } from './helpers';

// A project chat with a linked folder: the question is matched against the folder's files, the
// best ones go to the model, and the reply names them. The folder scan is mocked (the real one
// reads the disk); the per-chat ranking override is saved on the thread.

type Body = { system?: string; messages: Array<{ role: string; content: string }> };
const sse = (events: unknown[]): string => events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('');
const reply = (text: string): string => sse([
  { type: 'message_start', message: { usage: { input_tokens: 10 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } },
]);

/** A project with a linked folder, and a chat filed in it, already open. */
async function seed(page: Page, linked = true): Promise<void> {
  await page.addInitScript(({ linked }) => {
    localStorage.setItem('nl_api_keys', JSON.stringify({ anthropic: 'sk-ant-TESTONLY-a', deepseek: 'sk-ds-TESTONLY-d' }));
    localStorage.setItem('nl_tabs_v1', JSON.stringify({ tabs: [{ id: 'chat-1' }], active: 'chat-1' }));
    const open = indexedDB.open('notlinear', 1);
    open.onupgradeneeded = () => { if (!open.result.objectStoreNames.contains('kv')) open.result.createObjectStore('kv', { keyPath: 'key' }); };
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction('kv', 'readwrite');
      const store = tx.objectStore('kv');
      store.get('state').onsuccess = (e) => {
        if ((e.target as IDBRequest).result) return;
        store.put({ key: 'state', value: {
          threads: { 'chat-1': { kind: 'chat', title: 'Atlas chat', stream: '', projectId: 'p1', highlights: [], branchSnapshots: {}, branchRecents: {} } },
          current: 'chat-1', dynamic: [{ id: 'chat-1', title: 'Atlas chat' }], deletedThreads: [], chatCount: 2,
          projects: { p1: { id: 'p1', name: 'Atlas', rules: '', files: [], path: linked ? '/Users/me/atlas' : '', updatedAt: Date.now() } },
          projectCount: 2, prefs: {},
        } });
      };
      tx.oncomplete = () => db.close();
    };
  }, { linked });
}

async function claude(page: Page): Promise<Body[]> {
  const bodies: Body[] = [];
  await page.route('https://api.anthropic.com/v1/messages', async (route: Route) => {
    bodies.push(JSON.parse(route.request().postData() ?? '{}') as Body);
    await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: reply('Answered from the project.') });
  });
  return bodies;
}
async function mockScan(page: Page): Promise<{ calls: () => number }> {
  let n = 0;
  await page.route('**/__notlinear_scan_project', route => {
    n += 1;
    return route.fulfill({ json: { ok: true, contextFiles: [
      { present: true, filename: 'auth.md', relativePath: 'docs/auth.md', text: 'Authentication uses JWT tokens for the login flow.' },
      { present: true, filename: 'billing.md', relativePath: 'docs/billing.md', text: 'Invoices and subscriptions.' },
    ] } });
  });
  return { calls: () => n };
}
async function ask(page: Page, text: string): Promise<void> {
  const box = page.getByRole('textbox', { name: 'Message' });
  await box.fill(text);
  await box.press('Enter');
}

test.describe('project folder context', () => {
  test('relevant files go to the model as context, and the reply names them as its sources', async ({ page }) => {
    await seed(page);
    const scan = await mockScan(page);
    const bodies = await claude(page);
    await page.goto('/web/');
    await ask(page, 'how does the login flow work?');
    await expect(page.locator('[data-chat-stream] .chat-stream .msg.ai .ai-content')).toContainText('Answered from the project.');

    expect(scan.calls()).toBe(1);
    expect(bodies[0]!.system).toContain('This chat belongs to the project "Atlas".');
    expect(bodies[0]!.system).toContain('Relevant project files (none from linked folder):');
    expect(bodies[0]!.system).toContain('<project_file path="docs/auth.md">');
    expect(bodies[0]!.system).not.toContain('billing.md'); // only what matched

    const sources = page.locator('[data-chat-stream] .msg-sources');
    await expect(sources).toContainText('Sources (keywords):');
    await expect(sources.locator('.msg-source-chip')).toHaveText(['auth.md']);

    // saved with the reply, so it is there after a reload
    await page.reload();
    await expect(page.locator('[data-chat-stream] .msg-sources .msg-source-chip')).toHaveText(['auth.md']);
  });

  test('a chat in a project with no linked folder gets no folder context and no sources bar, and no ranking button', async ({ page }) => {
    await seed(page, false);
    const scan = await mockScan(page);
    const bodies = await claude(page);
    await page.goto('/web/');
    await ask(page, 'how does the login flow work?');
    await expect(page.locator('[data-chat-stream] .chat-stream .msg.ai .ai-content')).toContainText('Answered from the project.');
    expect(scan.calls()).toBe(0);
    expect(bodies[0]!.system).not.toContain('Relevant project files');
    await expect(page.locator('[data-chat-stream] .msg-sources')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Context ranking' })).toHaveCount(0);
  });

  test('the ranking override is per chat: saved on the thread, shown when reopened, and Esc closes it', async ({ page }) => {
    await seed(page);
    await mockScan(page);
    await claude(page);
    await page.goto('/web/');
    await page.getByRole('button', { name: 'Context ranking' }).click();
    const pop = page.getByTestId('ranking-popover');
    await expect(pop.getByRole('combobox')).toHaveValue('inherit');
    await expect(pop.getByRole('combobox').locator('option')).toHaveText(['Global setting', 'Off', 'Keywords only', 'DeepSeek (smart)']);
    await pop.getByRole('combobox').selectOption('keywords');
    await expect.poll(async () => ((await readPersistedState(page)) as unknown as { threads: Record<string, { rankingMode?: string }> }).threads['chat-1']!.rankingMode).toBe('keywords');
    await page.keyboard.press('Escape');
    await expect(pop).toHaveCount(0);
    await page.getByRole('button', { name: 'Context ranking' }).click();
    await expect(page.getByTestId('ranking-popover').getByRole('combobox')).toHaveValue('keywords');
  });

  test('in DeepSeek mode the reply says its sources were DeepSeek-ranked', async ({ page }) => {
    await seed(page);
    await mockScan(page);
    await claude(page);
    let dsCalls = 0;
    await page.route('https://api.deepseek.com/v1/chat/completions', route => {
      dsCalls += 1;
      const content = dsCalls === 1 ? '["authentication","jwt","login"]' : '[0]';
      return route.fulfill({ json: { choices: [{ message: { content } }] } });
    });
    await page.goto('/web/');
    await page.getByRole('button', { name: 'Context ranking' }).click();
    await page.getByTestId('ranking-popover').getByRole('combobox').selectOption('deepseek');
    await page.keyboard.press('Escape');
    await ask(page, 'how does the login flow work?');
    await expect(page.locator('[data-chat-stream] .msg-sources')).toContainText('Sources (DeepSeek):');
    expect(dsCalls).toBe(2); // keywords, then ranking
  });
});
