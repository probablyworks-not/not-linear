/**
 * One interface every provider implements, and one event stream they all emit.
 *
 * Today each provider is called through `getLLMAdapter()` (app.js:1729) with a
 * bag of eight callbacks — onDelta, onThinking, onStatus, onDone, onError,
 * onController, onAbort and more — which every call site has to wire up
 * correctly and none of them do identically. A discriminated event stream
 * replaces that: a caller handles the cases it cares about and the compiler
 * tells it which ones exist.
 */

export type ProviderId = 'claude' | 'deepseek' | 'openai' | 'gemini';

export type ToolName =
  | 'wikipedia_search'
  | 'web_search'
  | 'serper_search'
  | 'fetch_url'
  | 'firecrawl_scrape'
  // P7 connectors: offered only when a GitHub token is stored.
  | 'github_search_repos'
  | 'github_search_issues'
  | 'github_search_code'
  | 'github_get_issue'
  | 'github_get_file'
  // Linked project folder: offered only when the chat's project has one.
  | 'list_project_files'
  | 'read_project_file'
  // Chat→Notes: offered only on a main thread, when the Notes feature is on.
  | 'create_note';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  /** DeepSeek bills cached input tokens at a different rate. */
  cacheHitTokens?: number;
  /** Why the model stopped; 'max_tokens' is what offers "Continue". */
  stopReason?: string;
  /** How many provider requests the reply took (more than one when tools ran). */
  requestCount?: number;
  /**
   * What the model was actually sent, for the "Context sent to model" disclosure under a reply:
   * the system prompt, the FINAL request's messages, and the names of the tools offered.
   */
  context?: { system: string; messages: unknown[]; tools: string[] };
}

/** A provider-shaped content block (Anthropic's text, image and document blocks). */
export type ContentBlock = { type: string; [k: string]: unknown };

export interface ChatMessage {
  role: 'user' | 'assistant';
  /** Plain text, or blocks when a message carries a native PDF or image. */
  content: string | ContentBlock[];
}

/**
 * Everything a provider emits while answering.
 *
 * `status` carries the human-readable label shown while a tool runs ("Searching
 * the web…"). Bugs #010–#018 were all about that label failing to clear, or
 * results being lost when it did, so it is a first-class event rather than a
 * side effect of a callback.
 */
export type ProviderEvent =
  | { t: 'delta'; text: string }
  | { t: 'thinking'; text: string }
  | { t: 'status'; label: string }
  | { t: 'tool_call'; id: string; name: ToolName; input: unknown }
  | { t: 'tool_result'; id: string; title: string; markdown: string }
  | { t: 'done'; text: string; usage?: TokenUsage }
  | { t: 'error'; message: string; kind: ErrorKind };

/**
 * Why a request failed, in the terms the UI actually branches on.
 *
 * `rate_limit` exists as its own kind because the Claude→DeepSeek fallback
 * (bug #023) depends on telling it apart from a generic failure.
 */
export type ErrorKind = 'config' | 'rate_limit' | 'timeout' | 'aborted' | 'other';

export interface ProviderCapabilities {
  /** Supports an extended-thinking mode. */
  thinking: boolean;
  /** Has native tool-use, as opposed to prompt-level emulation. */
  nativeToolUse: boolean;
  /** How many tool round-trips before giving up. */
  maxToolRounds: number;
}

/**
 * Runs one tool the model asked for and returns text for it to read. Throws only for an abort
 * or a fatal tool failure (`isToolFatal`); every other failure is a returned string.
 */
export type ToolRunnerLike = (name: string, input: Record<string, unknown>, signal: AbortSignal) => Promise<string>;

export interface ChatRequest {
  messages: ChatMessage[];
  systemPrompt: string;
  /** Tool *specs*, never a provider-shaped array — see tool-specs.ts. */
  tools: readonly ToolSpecLike[];
  /** How to run them. A request with tools and no runner offers none. */
  toolRunner?: ToolRunnerLike;
  model: string;
  thinking: boolean;
  /** Replaces the onController/onAbort callback pair. */
  signal: AbortSignal;
}

/** The subset of a ToolSpec a provider needs. Keeps this file dependency-free. */
export interface ToolSpecLike {
  name: ToolName;
  description: string;
  jsonSchema: Record<string, unknown>;
}

export interface ChatProvider {
  readonly id: ProviderId;
  readonly caps: ProviderCapabilities;
  stream(req: ChatRequest): AsyncIterable<ProviderEvent>;
}
