import { test, expect, type Page, type Route } from '@playwright/test';

// "Clarify intent first" in /web/: the model's questions appear as a card before the reply, the
// answers anchor the reply's request, Skip and the setting both bypass it. Provider calls are mocked.

const WEB = '/web/';
const KEYS = { anthropic: 'sk-ant-TESTONLY-short-aaaaaaaa', deepseek: 'sk-ds-TESTONLY-short-bbbbbbbb' };
const REPLY = '[data-chat-stream] .chat-stream .msg.ai .ai-content';
const QUESTIONS = JSON.stringify({ questions: [
  { question: 'Who is this for?', options: [{ label: 'Beginners' }, { label: 'Experts' }] },
  { question: 'How deep should it go?', options: [{ label: 'Quick overview' }, { label: 'Full detail' }] },
] });

async function mockClaude(page: Page, systems: string[]): Promise<void> {
  await page.route('https://api.anthropic.com/v1/messages', async (route: Route) => {
    const body = route.request().postDataJSON() as { system?: unknown };
    const system = typeof body.system === 'string' ? body.system : JSON.stringify(body.system ?? '');
    systems.push(system);
    const text = system.includes('decide whether a user') ? QUESTIONS : 'A tailored answer about tides.';
    const events = [
      { type: 'message_start', message: { usage: { input_tokens: 10 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
      { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 8 } },
    ];
    await route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('') });
  });
}

async function newChatAndAsk(page: Page, text: string): Promise<void> {
  await page.goto(WEB);
  await page.getByRole('button', { name: 'Open left pane' }).click();
  await page.getByRole('button', { name: /New chat/ }).click();
  await page.getByRole('button', { name: 'Close left pane' }).click();
  const box = page.getByRole('textbox', { name: 'Message' });
  await box.click();
  await box.fill(text);
  await box.press('Enter');
}

test.beforeEach(async ({ page }) => {
  // The suite default is off (playwright.config.ts); this spec is the one that wants it.
  await page.addInitScript(k => { localStorage.setItem('nl_api_keys', JSON.stringify(k)); localStorage.setItem('nl_clarify_first', '1'); }, KEYS);
});

test.describe('clarify intent first', () => {
  test('asks, takes answers by keyboard, then the reply request carries them', async ({ page }) => {
    const systems: string[] = [];
    await mockClaude(page, systems);
    await newChatAndAsk(page, 'Explain how the tides work please');

    const card = page.getByTestId('clarify-card');
    await expect(card).toContainText('Who is this for?');
    await page.keyboard.press('1');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('clarify-question')).toHaveText('How deep should it go?');
    await page.keyboard.press('2');
    await page.getByTestId('clarify-next').click();

    await expect(page.locator(REPLY)).toContainText('A tailored answer about tides.');
    await expect(page.getByTestId('clarify-card')).toHaveCount(0);
    await expect(page.getByTestId('clarify-summary')).toContainText('Beginners');
    await expect(page.getByTestId('clarify-summary')).toContainText('Full detail');
    expect(systems.at(-1)).toContain('Who is this for? → Beginners');

    // Saved with the turn, so it is still there after a reload.
    await page.reload();
    await expect(page.getByTestId('clarify-summary')).toContainText('Beginners');
  });

  test('Esc skips the questions and the reply carries no anchor', async ({ page }) => {
    const systems: string[] = [];
    await mockClaude(page, systems);
    await newChatAndAsk(page, 'Explain how the tides work please');
    await expect(page.getByTestId('clarify-card')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator(REPLY)).toContainText('A tailored answer about tides.');
    await expect(page.getByTestId('clarify-summary')).toHaveCount(0);
    expect(systems.at(-1)).not.toContain('clarifying questions');
  });

  test('with the setting off it goes straight to the reply', async ({ page }) => {
    const systems: string[] = [];
    await mockClaude(page, systems);
    await page.addInitScript(() => localStorage.setItem('nl_clarify_first', '0'));
    await newChatAndAsk(page, 'Explain how the tides work please');
    await expect(page.locator(REPLY)).toContainText('A tailored answer about tides.');
    await expect(page.getByTestId('clarify-card')).toHaveCount(0);
    expect(systems).toHaveLength(1);
  });
});
