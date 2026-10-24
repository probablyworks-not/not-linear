import { describe, expect, it } from 'vitest';
import { classify, clockOf, countByKind, formatDuration, metaOf, titleOf } from '../../src/settings/log-view';

const at = (o: Record<string, unknown>) => ({ timestamp: '2026-10-21T19:45:08.726Z', ...o });

describe('classify', () => {
  it('calls failures errors whatever else they are', () => {
    expect(classify(at({ phase: 'error', provider: 'serper' }))).toBe('error');
    expect(classify(at({ status: 429, provider: 'openai' }))).toBe('error');
    expect(classify(at({ ok: false }))).toBe('error');
    expect(classify(at({ phase: 'body_error' }))).toBe('error');
  });
  it('separates tool providers from model providers', () => {
    expect(classify(at({ provider: 'serper', phase: 'end', status: 200 }))).toBe('tool');
    expect(classify(at({ provider: 'wikipedia' }))).toBe('tool');
    expect(classify(at({ provider: 'anthropic', phase: 'end', status: 200 }))).toBe('llm');
    expect(classify(at({ provider: null }))).toBe('llm');
  });
  it('honours an explicit kind', () => {
    expect(classify(at({ kind: 'tool', provider: 'anthropic' }))).toBe('tool');
  });
});

describe('titleOf', () => {
  it('never shows the origin or the query string, which can carry a key', () => {
    const t = titleOf(at({ provider: 'serper', url: 'https://google.serper.dev/search?api_key=SECRET', status: 200 }));
    expect(t).toBe('serper · /search · 200');
    expect(t).not.toContain('SECRET');
  });
  it('prefers the label and falls back to the phase', () => {
    expect(titleOf(at({ provider: 'wikipedia', label: 'summary', phase: 'start' }))).toBe('wikipedia · summary · start');
    expect(titleOf(at({}))).toBe('event');
  });
});

describe('metaOf / formatDuration / clockOf', () => {
  it('formats duration and tokens', () => {
    expect(formatDuration(812)).toBe('812ms');
    expect(formatDuration(19625)).toBe('19.6s');
    expect(metaOf(at({ durationMs: 19625, inputTokens: 7507, outputTokens: 984 }))).toBe('19.6s · 8.5k tok');
    expect(metaOf(at({}))).toBe('');
  });
  it('gives a placeholder for an unreadable timestamp', () => {
    expect(clockOf('nonsense')).toBe('--:--:--');
    expect(clockOf('2026-10-21T19:45:08.726Z')).toMatch(/^\d\d:\d\d:\d\d$/);
  });
});

describe('countByKind', () => {
  it('counts every entry once', () => {
    const c = countByKind([at({ provider: 'anthropic' }), at({ provider: 'serper' }), at({ phase: 'error' })]);
    expect(c).toEqual({ all: 3, llm: 1, tool: 1, error: 1 });
  });
});
