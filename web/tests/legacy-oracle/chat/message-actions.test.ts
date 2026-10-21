import { legacyFns } from '../helpers/legacy-source';
import { phaseFromStatus, statusDetail, pickStatusWord, STATUS_WORDS } from '../../../src/chat/status-copy';
import { detectMdFilename, slugifyTitle } from '../../../src/lib/save-file';
import { looksIncompleteResponse } from '../../../src/chat/MessageList';
import { responseMetaHTML, usageContextText } from '../../../src/chat/response-meta';
import { fmtTokenCount, fmtUsd } from '../../../src/chat/usage';
import { modelLabelFromId } from '../../../src/chat/models';
import { modelLabelFromId as legacyModelLabel } from '../../../../frontend/providers/tools.js';
import type { TokenUsage } from '../../../src/providers/types';

// Each helper behind the per-message UI is compared with the legacy function it came from, using
// the real source for the ones that live inside app.js and the real module for the ones that do not.

const STATUS_LINES = [
  null, '', 'Thinking…', 'Searching Wikipedia for "tides"…', 'Searching Google for "x"…', 'Searching for "y"…',
  'Scraping https://example.com…', 'Reading https://example.com/page…', 'Running 3 searches in parallel…',
  'Synthesizing answer from retrieved sources…', 'Synthesizing tool results…', 'Claude rate limited — switching to DeepSeek…',
];

describe('status copy', () => {
  const legacy = legacyFns<{ phaseFromStatus(m: unknown): string; statusDetailFromMsg(m: unknown): string }>(
    ['phaseFromStatus', 'statusDetailFromMsg'], {}, '', '{ phaseFromStatus, statusDetailFromMsg }',
  );

  it.each(STATUS_LINES)('%s: same phase and detail as legacy', line => {
    expect(phaseFromStatus(line)).toBe(legacy.phaseFromStatus(line));
    expect(statusDetail(line)).toBe(legacy.statusDetailFromMsg(line));
  });

  it('a word is never the same twice in a row, from the right pool', () => {
    let prev: string | undefined;
    for (let i = 0; i < 200; i++) {
      const w = pickStatusWord('searching', prev);
      expect(w).not.toBe(prev);
      expect(STATUS_WORDS.searching).toContain(w);
      prev = w;
    }
  });
});

describe('save helpers', () => {
  const legacy = legacyFns<{ detectMdFilename(t: string): string | null; slugifyTitle(t: string): string }>(
    ['detectMdFilename', 'slugifyTitle'], {}, '', '{ detectMdFilename, slugifyTitle }',
  );
  const texts = ['Saved to `notes/PLAN.md` for you.', 'see `README.md`', 'no file here', 'a `lowercase.MD` one', '`../up/ESCAPE.md`', '`-bad.md`', 'two `A.md` and `B.md`'];
  const titles = ['Why are there tides?', '  Tides & Moons  ', '???', '', 'Café — plans', 'a--b__c'];

  it.each(texts)('detectMdFilename %j', t => expect(detectMdFilename(t)).toBe(legacy.detectMdFilename(t)));
  it.each(titles)('slugifyTitle %j', t => expect(slugifyTitle(t)).toBe(legacy.slugifyTitle(t)));
});

describe('looksIncompleteResponse', () => {
  const legacy = legacyFns<(t: string) => boolean>(
    ['normalizeTitleText', 'looksIncompleteResponse'], {}, '', 'looksIncompleteResponse',
  );
  it.each([
    'A finished sentence.', 'and', 'It depends on the', 'Here is a list:', 'the answer is', 'x =', '(open', 'one,', 'two;', 'a +', 'ends with a dash -',
    '', '   ', 'Ends with the word "include"', 'Ends with including', 'Fine.', 'Not cut off at all!',
  ])('%j', t => expect(looksIncompleteResponse(t)).toBe(legacy(t)));
});

describe('model labels', () => {
  it.each(['claude-opus-5', 'claude-opus-4-8', 'claude-opus-4-5', 'claude-sonnet-5', 'claude-sonnet-4-6', 'claude-sonnet-4-5', 'claude-haiku-4-5-20251001', 'deepseek-v4-flash', 'deepseek-v4-pro', 'gpt-5.6-terra', 'gemini-2.5-pro-preview', 'unknown-model', ''])(
    '%j', id => {
      expect(modelLabelFromId(id)).toBe(legacyModelLabel(id));
      expect(modelLabelFromId(id, true)).toBe(legacyModelLabel(id, true));
    });
});

describe('usage numbers', () => {
  const fmt = legacyFns<{ fmtTokenCount(n: number): string; fmtUsd(n: number): string }>(
    ['fmtTokenCount', 'fmtUsd'], {}, '', '{ fmtTokenCount, fmtUsd }',
  );
  it.each([0, 5, 999, 1000, 1500, 9999, 10_000, 123_456, 1_000_000, 2_345_678])('fmtTokenCount %d', n => expect(fmtTokenCount(n)).toBe(fmt.fmtTokenCount(n)));
  it.each([0, 0.00001, 0.0009, 0.001, 0.0123, 1.5, 12.3456])('fmtUsd %d', n => expect(fmtUsd(n)).toBe(fmt.fmtUsd(n)));
});

describe('the "Context sent to model" text', () => {
  const legacy = legacyFns<(u: unknown) => string>(
    ['fmtTokenCount', 'contextValueForDisplay', 'contentToContextText', 'messageToContextText', 'usageContextText'], {}, '', 'usageContextText',
  );
  const usages: Array<[string, TokenUsage]> = [
    ['not captured', { inputTokens: 1, outputTokens: 1 }],
    ['a plain exchange', { inputTokens: 1, outputTokens: 1, context: { system: 'You are helpful.', tools: [], messages: [{ role: 'user', content: 'hi' }] } }],
    ['with tools and several requests', { inputTokens: 1, outputTokens: 1, requestCount: 3, context: {
      system: 'sys', tools: ['wikipedia_search', 'fetch_url'],
      messages: [
        { role: 'user', content: 'q' },
        { role: 'assistant', content: [{ type: 'thinking', thinking: 'secret', signature: 's' }, { type: 'text', text: 'let me look' }, { type: 'tool_use', id: 't1', name: 'wikipedia_search', input: { query: 'tides' } }] },
        { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'RESULT' }, { type: 'document', source: { media_type: 'application/pdf', data: 'x'.repeat(500) } }, { type: 'image', source: { type: 'base64', data: 'y'.repeat(500) } }] },
      ],
    } }],
    ['openai-shaped tool messages', { inputTokens: 1, outputTokens: 1, context: { system: 's', tools: ['x'], messages: [
      { role: 'system', content: 's' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'x', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'c1', content: 'out' },
      { role: 'user', content: '' },
    ] } }],
  ];
  it.each(usages)('%s', (_n, u) => expect(usageContextText(u)).toBe(legacy(u)));
});

describe('responseMetaHTML', () => {
  const parse = (html: string): HTMLElement => { const d = document.createElement('div'); d.innerHTML = html; return d; };

  it('says the model, tokens, cost and (when there are any) requests and cache hits', () => {
    const el = parse(responseMetaHTML({
      provider: 'anthropic', model: 'claude-sonnet-5',
      usage: { inputTokens: 1000, outputTokens: 500, requestCount: 2, context: { system: 's', messages: [], tools: [] } },
    }));
    expect(el.querySelector('summary .llm-summary-main span:last-child')!.textContent).toBe('Claude Sonnet 5 · 1.5k tokens · 2 req');
    expect(el.querySelector('.llm-summary-cost')!.textContent).toBe('$0.0105');
    expect([...el.querySelectorAll('.llm-usage-cell')].map(c => c.textContent)).toEqual(['ModelClaude Sonnet 5', 'Input1.0k', 'Output500', 'Cost$0.0105']);
    expect(el.querySelector('details')!.classList.contains('llm-meta') || el.firstElementChild!.classList.contains('llm-meta')).toBe(true);
  });

  it('a cache hit adds its cell and a note, and a DeepSeek reply is priced as DeepSeek', () => {
    const el = parse(responseMetaHTML({ provider: 'deepseek', model: 'deepseek-v4-flash', usage: { inputTokens: 2000, outputTokens: 100, cacheHitTokens: 1500 } }));
    expect(el.querySelector('summary')!.textContent).toContain('DeepSeek Flash · 2.1k tokens · 1.5k cached');
    expect([...el.querySelectorAll('.llm-usage-cell .lab')].map(c => c.textContent)).toContain('Cache hit');
  });

  it('escapes what the model said: the context is shown, never run', () => {
    const el = parse(responseMetaHTML({ provider: 'anthropic', model: 'claude-sonnet-5', usage: { inputTokens: 1, outputTokens: 1, context: { system: '<script>alert(1)</script>', messages: [], tools: [] } } }));
    expect(el.querySelector('script')).toBeNull();
    expect(el.querySelector('.llm-context')!.textContent).toContain('<script>alert(1)</script>');
  });
});
