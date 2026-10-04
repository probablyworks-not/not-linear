import type { ToolName } from './types';

/**
 * The single source of truth for tools.
 *
 * Today the same five tools are described in three places that must agree and
 * have no way of enforcing it:
 *
 *   - `buildTools()`      (app.js:381) — Anthropic `input_schema` shape
 *   - `buildDeepSeekTools()` (app.js:432) — OpenAI `type: 'function'` shape
 *   - `buildSystemPrompt()` (app.js:294-300) — the same availability rules
 *     restated in English prose for the model
 *
 * ADR-029 already recorded the cost: adding `offset` and `query` to two tools
 * meant editing "all three provider tool-schema copies in app.js". This file
 * replaces the copies with one list and three *derivations*, so a new tool or
 * a changed parameter is a single edit by construction.
 *
 * Descriptions are carried over verbatim from app.js. They are prompt text —
 * the model's behaviour depends on their exact wording, and "tidying" them is
 * a behaviour change, not a cleanup.
 */

/** What decides whether a tool is offered at all. */
export interface ToolContext {
  apiKeys: Partial<Record<'serper' | 'firecrawl' | 'tavily' | 'exa', string>>;
  searxngUrl?: string;
}

export interface ToolSpec {
  name: ToolName;
  description: string;
  /** JSON Schema for the input, in the one shape both providers derive from. */
  jsonSchema: Record<string, unknown>;
  /** Whether this tool can run at all, given the user's keys and settings. */
  available(ctx: ToolContext): boolean;
  /**
   * A line for the system prompt when this tool is live. Returning null means
   * the tool needs no prose beyond its description.
   */
  promptHint?(ctx: ToolContext): string | null;
}

const PAGE_WINDOW_PARAMS = (what: string) => ({
  offset: {
    type: 'number',
    description:
      'Character position to resume reading from, for a page longer than one window (from a previous result\'s "showing chars X-Y of TOTAL" note)',
  },
  query: {
    type: 'string',
    description: `A term to jump to within the ${what} — the returned window is centered on its first match, instead of reading from the top`,
  },
});

export const TOOL_SPECS: readonly ToolSpec[] = [
  {
    name: 'wikipedia_search',
    description:
      'Search Wikipedia for factual information about a topic — concepts, people, places, events, definitions, history. Prefer specific terms over full questions.',
    jsonSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'The search term or topic' } },
      required: ['query'],
    },
    // Always available: no key needed.
    available: () => true,
  },
  {
    name: 'web_search',
    description:
      'Search the web for current information, news, recent events, prices, documentation, or any topic that may have changed since your training data. Use this first for broad "tell me more" questions about current entities.',
    jsonSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'The search query' } },
      required: ['query'],
    },
    available: (ctx) => Boolean(ctx.searxngUrl),
    promptHint: (ctx) => (ctx.searxngUrl ? 'You can search the web with web_search.' : null),
  },
  {
    name: 'serper_search',
    description:
      'Search Google via Serper for current information, news, recent events, prices, people, documentation, or any topic that may have changed since your training data. Use this first for broad "tell me more" questions about current entities.',
    jsonSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'The search query' } },
      required: ['query'],
    },
    available: (ctx) => Boolean(ctx.apiKeys.serper),
    promptHint: (ctx) => (ctx.apiKeys.serper ? 'You can search Google with serper_search.' : null),
  },
  {
    name: 'fetch_url',
    description:
      'Fetch and read a specific web page. Use only when the user explicitly asks to read or summarize a URL, or after search when full-page verification is necessary. For general questions about a company, person, or topic, search first. Long pages are returned one window at a time (~4000 chars) — the result tells you the char range shown and the total length; call again with offset set to that range\'s end to keep reading, or with query set to a term to jump straight to the part that mentions it.',
    jsonSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The full URL to fetch' },
        ...PAGE_WINDOW_PARAMS('page'),
      },
      required: ['url'],
    },
    available: () => true,
  },
  {
    name: 'firecrawl_scrape',
    description:
      'Scrape and extract clean markdown content from a URL, including JavaScript-heavy pages and paywalled sites. Use only when the user explicitly asks to read or summarize a URL, when fetch_url fails, or when full-page verification is necessary. Long pages are returned one window at a time (~6000 chars) — the result tells you the char range shown and the total length; call again with offset set to that range\'s end to keep reading, or with query set to a term to jump straight to the part that mentions it.',
    jsonSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The full URL to scrape' },
        ...PAGE_WINDOW_PARAMS('page'),
      },
      required: ['url'],
    },
    available: (ctx) => Boolean(ctx.apiKeys.firecrawl),
  },
];

/** The tools actually offered for a given set of keys and settings. */
export function availableTools(ctx: ToolContext): ToolSpec[] {
  return TOOL_SPECS.filter((t) => t.available(ctx));
}

// --- the three derivations that replace the three hand-maintained copies ---

/** Anthropic's shape: `input_schema`. Was buildTools() in app.js:381. */
export function toAnthropicTools(specs: readonly ToolSpec[]): Array<{
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}> {
  return specs.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.jsonSchema,
  }));
}

/** OpenAI/DeepSeek's shape: `type: 'function'`. Was buildDeepSeekTools() in app.js:432. */
export function toOpenAITools(specs: readonly ToolSpec[]): Array<{
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}> {
  return specs.map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.jsonSchema },
  }));
}

/**
 * The prose block for the system prompt. Was the hand-written availability
 * logic inside buildSystemPrompt() (app.js:294-300), which derived the same
 * facts a third time and could disagree with both schemas.
 */
export function toolPromptSection(specs: readonly ToolSpec[], ctx: ToolContext): string {
  return specs
    .map((t) => t.promptHint?.(ctx) ?? null)
    .filter((line): line is string => Boolean(line))
    .join('\n');
}
