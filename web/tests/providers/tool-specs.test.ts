import { describe, it, expect } from 'vitest';
import {
  TOOL_SPECS,
  availableTools,
  toAnthropicTools,
  toOpenAITools,
  toolPromptSection,
  type ToolContext,
} from '../../src/providers/tool-specs';

// The point of the registry is that one list produces both provider schemas,
// so these tests check the derivations against what app.js builds today rather
// than against the registry itself — which would only prove it agrees with
// itself.
//
// The expected objects below are transcribed from buildTools() (app.js:381)
// and buildDeepSeekTools() (app.js:432). If the app changes, these fail, which
// is correct: the registry is meant to be the single source, and a divergence
// means the migration is incomplete rather than that the test is stale.

const NO_KEYS: ToolContext = { apiKeys: {} };
const ALL_KEYS: ToolContext = {
  apiKeys: { serper: 'k', firecrawl: 'k' },
  searxngUrl: 'http://127.0.0.1:8888',
};

describe('availability rules match app.js', () => {
  it('offers only the two keyless tools with no keys and no searxng', () => {
    expect(availableTools(NO_KEYS).map((t) => t.name)).toEqual(['wikipedia_search', 'fetch_url']);
  });

  it('adds web_search only when a searxng URL is set', () => {
    const names = availableTools({ apiKeys: {}, searxngUrl: 'http://x' }).map((t) => t.name);
    expect(names).toContain('web_search');
    expect(names).not.toContain('serper_search');
  });

  it('adds serper_search only when the serper key is present', () => {
    const names = availableTools({ apiKeys: { serper: 'k' } }).map((t) => t.name);
    expect(names).toContain('serper_search');
    expect(names).not.toContain('web_search');
  });

  it('adds firecrawl_scrape only when the firecrawl key is present', () => {
    expect(availableTools({ apiKeys: {} }).map((t) => t.name)).not.toContain('firecrawl_scrape');
    expect(availableTools({ apiKeys: { firecrawl: 'k' } }).map((t) => t.name)).toContain('firecrawl_scrape');
  });

  it('offers all five when everything is configured, in app.js order', () => {
    expect(availableTools(ALL_KEYS).map((t) => t.name)).toEqual([
      'wikipedia_search', 'web_search', 'serper_search', 'fetch_url', 'firecrawl_scrape',
    ]);
  });
});

describe('Anthropic derivation reproduces buildTools()', () => {
  it('emits name/description/input_schema and nothing else', () => {
    for (const tool of toAnthropicTools(availableTools(ALL_KEYS))) {
      expect(Object.keys(tool).sort()).toEqual(['description', 'input_schema', 'name']);
    }
  });

  it('matches the wikipedia_search schema exactly', () => {
    const tool = toAnthropicTools(TOOL_SPECS).find((t) => t.name === 'wikipedia_search');
    expect(tool!.input_schema).toEqual({
      type: 'object',
      properties: { query: { type: 'string', description: 'The search term or topic' } },
      required: ['query'],
    });
  });

  it('keeps the offset and query window params on fetch_url (ADR-029)', () => {
    const tool = toAnthropicTools(TOOL_SPECS).find((t) => t.name === 'fetch_url')!;
    const props = tool.input_schema.properties as Record<string, unknown>;
    expect(Object.keys(props).sort()).toEqual(['offset', 'query', 'url']);
    expect(tool.input_schema.required).toEqual(['url']);
  });

  it('keeps the same window params on firecrawl_scrape', () => {
    const tool = toAnthropicTools(TOOL_SPECS).find((t) => t.name === 'firecrawl_scrape')!;
    const props = tool.input_schema.properties as Record<string, unknown>;
    expect(Object.keys(props).sort()).toEqual(['offset', 'query', 'url']);
  });
});

describe('OpenAI derivation reproduces buildDeepSeekTools()', () => {
  it('wraps each tool as type: function with parameters', () => {
    for (const tool of toOpenAITools(availableTools(ALL_KEYS))) {
      expect(tool.type).toBe('function');
      expect(Object.keys(tool.function).sort()).toEqual(['description', 'name', 'parameters']);
    }
  });

  it('carries the identical schema object as the Anthropic shape', () => {
    // The whole point: one schema, two wrappers. If these ever differ, the
    // copies are back.
    const anthropic = toAnthropicTools(TOOL_SPECS);
    const openai = toOpenAITools(TOOL_SPECS);
    for (let i = 0; i < anthropic.length; i++) {
      expect(openai[i]!.function.parameters).toEqual(anthropic[i]!.input_schema);
      expect(openai[i]!.function.description).toBe(anthropic[i]!.description);
    }
  });
});

describe('prompt section is derived, not restated', () => {
  it('is empty when no search tool is configured', () => {
    expect(toolPromptSection(availableTools(NO_KEYS), NO_KEYS)).toBe('');
  });

  it('mentions each configured search tool once', () => {
    const text = toolPromptSection(availableTools(ALL_KEYS), ALL_KEYS);
    expect(text).toContain('web_search');
    expect(text).toContain('serper_search');
  });
});

describe('descriptions are prompt text, not documentation', () => {
  it('every tool has a non-trivial description', () => {
    for (const spec of TOOL_SPECS) {
      expect(spec.description.length).toBeGreaterThan(40);
    }
  });

  it('the paging tools explain the windowing in their description', () => {
    // The model relies on this wording to know it can call again with offset.
    for (const name of ['fetch_url', 'firecrawl_scrape'] as const) {
      const spec = TOOL_SPECS.find((t) => t.name === name)!;
      expect(spec.description).toContain('offset');
      expect(spec.description).toContain('one window at a time');
    }
  });
});
