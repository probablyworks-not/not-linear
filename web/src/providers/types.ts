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
  | 'firecrawl_scrape';

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
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

export interface ChatRequest {
  messages: ChatMessage[];
  systemPrompt: string;
  /** Tool *specs*, never a provider-shaped array — see tool-specs.ts. */
  tools: readonly ToolSpecLike[];
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
