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
  apiKeys: Partial<Record<'serper' | 'firecrawl' | 'tavily' | 'exa' | 'github', string>>;
  searxngUrl?: string;
  /** The chat can file a long document as a note (main threads only). */
  notes?: boolean;
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
  {
    name: 'create_note',
    description:
      'Save a long, standalone document as a note in the user\'s Notes, in the same project as this chat, so they can read it again later in a side pane. Use it when the user asks for something meant to be kept and re-read (a report, plan, spec, research summary, comparison, study guide, checklist) or your answer would run past roughly 400 words of structured material. Do NOT use it for short answers, conversation, or code snippets. Write the whole document in markdown in `content`, without repeating the title as a heading. After the tool succeeds, reply in one to three sentences saying what the note covers; do not repeat its content in the chat.',
    jsonSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'A short, specific title for the note' },
        content: { type: 'string', description: 'The full document in markdown (headings, lists, tables, code blocks allowed)' },
      },
      required: ['title', 'content'],
    },
    available: (ctx) => Boolean(ctx.notes),
  },
  ...githubSpecs(),
];

// GitHub connector (P7). All five need a token; they call api.github.com directly from the browser.
function githubSpecs(): ToolSpec[] {
  const on = (ctx: ToolContext): boolean => Boolean(ctx.apiKeys.github);
  const repo = { type: 'string', description: 'The repository as "owner/name", e.g. "facebook/react"' };
  return [
    {
      name: 'github_search_repos',
      description: 'Search GitHub repositories, most-starred first. Use to find what exists in a space, the main libraries for a problem, or prior art. Supports GitHub qualifiers such as "language:python", "topic:llm", "stars:>500", "pushed:>2025-01-01". Stars show popularity, not correctness.',
      jsonSchema: { type: 'object', properties: { query: { type: 'string', description: 'Search terms, with optional GitHub qualifiers' } }, required: ['query'] },
      available: on,
    },
    {
      name: 'github_search_issues',
      description: 'Search GitHub issues and pull requests, most-reacted first. Use to find the real problems people hit and how they were fixed; read the resolution, not just the title. Supports qualifiers such as "repo:owner/name", "is:issue", "is:pr", "is:closed", "label:bug".',
      jsonSchema: { type: 'object', properties: { query: { type: 'string', description: 'Search terms, with optional GitHub qualifiers' } }, required: ['query'] },
      available: on,
    },
    {
      name: 'github_search_code',
      description: 'Search code on GitHub for concrete usage examples. Add qualifiers to narrow it: "repo:owner/name", "language:ts", "path:src/". Returns file paths with matching fragments; follow up with github_get_file to read one.',
      jsonSchema: { type: 'object', properties: { query: { type: 'string', description: 'Code to search for, with optional GitHub qualifiers' } }, required: ['query'] },
      available: on,
    },
    {
      name: 'github_get_issue',
      description: 'Read one GitHub issue or pull request with its comments (state, body, discussion). Long threads are returned one window at a time (~6000 chars); use offset to keep reading or query to jump to a term.',
      jsonSchema: { type: 'object', properties: { repo, number: { type: 'number', description: 'The issue or pull request number' }, ...PAGE_WINDOW_PARAMS('thread') }, required: ['repo', 'number'] },
      available: on,
    },
    {
      name: 'github_get_file',
      description: 'Read a file (or list a directory) from a GitHub repository. Long files are returned one window at a time (~6000 chars); use offset to keep reading or query to jump to a term.',
      jsonSchema: {
        type: 'object',
        properties: { repo, path: { type: 'string', description: 'Path inside the repository, e.g. "src/index.ts" ("" for the root)' }, ref: { type: 'string', description: 'Branch, tag or commit (default: the default branch)' }, ...PAGE_WINDOW_PARAMS('file') },
        required: ['repo', 'path'],
      },
      available: on,
    },
  ];
}

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
