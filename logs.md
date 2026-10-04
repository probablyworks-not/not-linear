# Runtime logs

Notlinear keeps an in-memory backend/debug log at `window.notlinearRequestLog`.

The same log is visible in the app under Settings -> Runtime logs. It stores the latest 300 events for the current browser session.

When Notlinear is launched through `notlinear_server.py`, the browser also syncs the latest 300 runtime events into the section at the bottom of this file. If the app is served by plain `python3 -m http.server`, file sync is unavailable and the Settings panel will say so.

## Event types

- `kind: "http"` logs every `loggedFetch` request: provider, label, method, URL, timeout, redacted headers, summarized body, status, and latency.
- `kind: "tool"` logs tool execution through `executeTool`: tool name, input, success/error/abort phase, latency, and output length/preview.
- `kind: "llm"` logs model turns through `callClaude` and `callDeepSeek`: provider, model, message/tool summary, success/error/abort phase, request count, token usage, finish reason, output length, and total latency.

## Phases

- `start` means the request, tool, or model turn began.
- `end` means it completed normally.
- `error` means it failed or returned an application-level error.
- `abort` means the user or caller cancelled it.
- `response_body` stores a parsed error payload for non-OK HTTP responses when available.

## Privacy

Authorization headers and API keys are redacted before logging. Model request bodies summarize message count, system prompt length, and tool count instead of storing full prompt contents.

## Debug checklist

1. Open Settings -> Runtime logs.
2. Reproduce the issue.
3. Copy logs.
4. Check the matching `llm-*` event for model, total latency, request count, token usage, and finish reason.
5. Check related `tool-*` and `http` events for search/API latency, HTTP status, timeout, and provider-specific errors.

<!-- notlinear-runtime-log:start -->
## Latest runtime log

_Last synced: 2026-10-03T05:37:29+00:00_

_Event count: 16_

```json
[
  {
    "timestamp": "2026-10-03T05:21:46.551Z",
    "id": "llm-1",
    "kind": "llm",
    "phase": "start",
    "startedAt": "2026-10-03T05:21:46.551Z",
    "provider": "deepseek",
    "model": "deepseek-v4-flash",
    "messages": [
      {
        "index": 0,
        "role": "user",
        "content": "[1190 chars]"
      }
    ],
    "tools": [
      "wikipedia_search",
      "serper_search",
      "fetch_url"
    ],
    "maxToolRounds": 2
  },
  {
    "timestamp": "2026-10-03T05:21:46.553Z",
    "id": 1,
    "kind": "http",
    "phase": "start",
    "startedAt": "2026-10-03T05:21:46.552Z",
    "method": "POST",
    "url": "https://api.deepseek.com/v1/chat/completions",
    "provider": "deepseek",
    "label": "chat:deepseek-v4-flash",
    "timeoutMs": 70000,
    "headers": {
      "content-type": "application/json",
      "Authorization": "[redacted]"
    },
    "body": {
      "model": "deepseek-v4-flash",
      "max_tokens": 8192,
      "stream": true,
      "messages": "[3 messages]",
      "thinking": {
        "type": "enabled"
      },
      "reasoning_effort": "high"
    }
  },
  {
    "timestamp": "2026-10-03T05:21:47.494Z",
    "id": 1,
    "kind": "http",
    "phase": "end",
    "startedAt": "2026-10-03T05:21:46.552Z",
    "endedAt": "2026-10-03T05:21:47.494Z",
    "durationMs": 943,
    "method": "POST",
    "url": "https://api.deepseek.com/v1/chat/completions",
    "provider": "deepseek",
    "label": "chat:deepseek-v4-flash",
    "timeoutMs": 70000,
    "status": 200,
    "ok": true,
    "statusText": ""
  },
  {
    "timestamp": "2026-10-03T05:22:11.353Z",
    "id": "llm-1",
    "kind": "llm",
    "phase": "end",
    "startedAt": "2026-10-03T05:21:46.551Z",
    "endedAt": "2026-10-03T05:22:11.353Z",
    "durationMs": 24801,
    "provider": "deepseek",
    "model": "deepseek-v4-flash",
    "inputTokens": 844,
    "cacheHitTokens": 0,
    "outputTokens": 4402,
    "requestCount": 1,
    "toolRoundCount": 0,
    "finishReason": "stop",
    "outputChars": 8694
  },
  {
    "timestamp": "2026-10-03T05:27:27.579Z",
    "id": "llm-2",
    "kind": "llm",
    "phase": "start",
    "startedAt": "2026-10-03T05:27:27.579Z",
    "provider": "anthropic",
    "model": "claude-haiku-4-5-20251001",
    "messages": [
      {
        "index": 0,
        "role": "user",
        "content": "[1190 chars]"
      },
      {
        "index": 1,
        "role": "assistant",
        "content": "[8694 chars]"
      },
      {
        "index": 2,
        "role": "user",
        "content": "[565 chars]"
      }
    ],
    "tools": [
      "wikipedia_search",
      "serper_search",
      "fetch_url"
    ],
    "thinking": false
  },
  {
    "timestamp": "2026-10-03T05:27:27.582Z",
    "id": 2,
    "kind": "http",
    "phase": "start",
    "startedAt": "2026-10-03T05:27:27.581Z",
    "method": "POST",
    "url": "https://api.anthropic.com/v1/messages",
    "provider": "anthropic",
    "label": "messages:claude-haiku-4-5-20251001",
    "timeoutMs": 70000,
    "headers": {
      "content-type": "application/json",
      "x-api-key": "[redacted]",
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    "body": {
      "model": "claude-haiku-4-5-20251001",
      "max_tokens": 8192,
      "stream": true,
      "system": "[2495 chars]",
      "messages": "[3 messages]",
      "tools": "[3 tools]"
    }
  },
  {
    "timestamp": "2026-10-03T05:27:28.946Z",
    "id": 2,
    "kind": "http",
    "phase": "end",
    "startedAt": "2026-10-03T05:27:27.581Z",
    "endedAt": "2026-10-03T05:27:28.946Z",
    "durationMs": 1365,
    "method": "POST",
    "url": "https://api.anthropic.com/v1/messages",
    "provider": "anthropic",
    "label": "messages:claude-haiku-4-5-20251001",
    "timeoutMs": 70000,
    "status": 200,
    "ok": true,
    "statusText": ""
  },
  {
    "timestamp": "2026-10-03T05:27:38.415Z",
    "id": "llm-3",
    "kind": "llm",
    "phase": "start",
    "startedAt": "2026-10-03T05:27:38.415Z",
    "provider": "anthropic",
    "model": "claude-haiku-4-5-20251001",
    "messages": [
      {
        "index": 0,
        "role": "user",
        "content": "[1190 chars]"
      },
      {
        "index": 1,
        "role": "assistant",
        "content": "[8694 chars]"
      },
      {
        "index": 2,
        "role": "user",
        "content": "[257 chars]"
      }
    ],
    "tools": [
      "wikipedia_search",
      "serper_search",
      "fetch_url"
    ],
    "thinking": false
  },
  {
    "timestamp": "2026-10-03T05:27:38.415Z",
    "id": 3,
    "kind": "http",
    "phase": "start",
    "startedAt": "2026-10-03T05:27:38.415Z",
    "method": "POST",
    "url": "https://api.anthropic.com/v1/messages",
    "provider": "anthropic",
    "label": "messages:claude-haiku-4-5-20251001",
    "timeoutMs": 70000,
    "headers": {
      "content-type": "application/json",
      "x-api-key": "[redacted]",
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    "body": {
      "model": "claude-haiku-4-5-20251001",
      "max_tokens": 8192,
      "stream": true,
      "system": "[2495 chars]",
      "messages": "[3 messages]",
      "tools": "[3 tools]"
    }
  },
  {
    "timestamp": "2026-10-03T05:27:39.081Z",
    "id": 3,
    "kind": "http",
    "phase": "end",
    "startedAt": "2026-10-03T05:27:38.415Z",
    "endedAt": "2026-10-03T05:27:39.081Z",
    "durationMs": 666,
    "method": "POST",
    "url": "https://api.anthropic.com/v1/messages",
    "provider": "anthropic",
    "label": "messages:claude-haiku-4-5-20251001",
    "timeoutMs": 70000,
    "status": 200,
    "ok": true,
    "statusText": ""
  },
  {
    "timestamp": "2026-10-03T05:27:51.716Z",
    "id": "llm-2",
    "kind": "llm",
    "phase": "end",
    "startedAt": "2026-10-03T05:27:27.579Z",
    "endedAt": "2026-10-03T05:27:51.716Z",
    "durationMs": 24137,
    "provider": "anthropic",
    "model": "claude-haiku-4-5-20251001",
    "inputTokens": 4121,
    "outputTokens": 1793,
    "requestCount": 1,
    "stopReason": "end_turn",
    "outputChars": 7256
  },
  {
    "timestamp": "2026-10-03T05:27:54.485Z",
    "id": "llm-3",
    "kind": "llm",
    "phase": "end",
    "startedAt": "2026-10-03T05:27:38.415Z",
    "endedAt": "2026-10-03T05:27:54.485Z",
    "durationMs": 16071,
    "provider": "anthropic",
    "model": "claude-haiku-4-5-20251001",
    "inputTokens": 4057,
    "outputTokens": 1099,
    "requestCount": 1,
    "stopReason": "end_turn",
    "outputChars": 4549
  },
  {
    "timestamp": "2026-10-03T05:37:19.563Z",
    "id": "llm-4",
    "kind": "llm",
    "phase": "start",
    "startedAt": "2026-10-03T05:37:19.563Z",
    "provider": "anthropic",
    "model": "claude-haiku-4-5-20251001",
    "messages": [
      {
        "index": 0,
        "role": "user",
        "content": "[1190 chars]"
      },
      {
        "index": 1,
        "role": "assistant",
        "content": "[8694 chars]"
      },
      {
        "index": 2,
        "role": "user",
        "content": "[293 chars]"
      },
      {
        "index": 3,
        "role": "user",
        "content": "[252 chars]"
      },
      {
        "index": 4,
        "role": "assistant",
        "content": "[7256 chars]"
      },
      {
        "index": 5,
        "role": "user",
        "content": "[465 chars]"
      }
    ],
    "tools": [
      "wikipedia_search",
      "serper_search",
      "fetch_url"
    ],
    "thinking": false
  },
  {
    "timestamp": "2026-10-03T05:37:19.564Z",
    "id": 4,
    "kind": "http",
    "phase": "start",
    "startedAt": "2026-10-03T05:37:19.563Z",
    "method": "POST",
    "url": "https://api.anthropic.com/v1/messages",
    "provider": "anthropic",
    "label": "messages:claude-haiku-4-5-20251001",
    "timeoutMs": 70000,
    "headers": {
      "content-type": "application/json",
      "x-api-key": "[redacted]",
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    "body": {
      "model": "claude-haiku-4-5-20251001",
      "max_tokens": 8192,
      "stream": true,
      "system": "[2495 chars]",
      "messages": "[6 messages]",
      "tools": "[3 tools]"
    }
  },
  {
    "timestamp": "2026-10-03T05:37:20.729Z",
    "id": 4,
    "kind": "http",
    "phase": "end",
    "startedAt": "2026-10-03T05:37:19.563Z",
    "endedAt": "2026-10-03T05:37:20.729Z",
    "durationMs": 1166,
    "method": "POST",
    "url": "https://api.anthropic.com/v1/messages",
    "provider": "anthropic",
    "label": "messages:claude-haiku-4-5-20251001",
    "timeoutMs": 70000,
    "status": 200,
    "ok": true,
    "statusText": ""
  },
  {
    "timestamp": "2026-10-03T05:37:27.876Z",
    "id": "llm-4",
    "kind": "llm",
    "phase": "end",
    "startedAt": "2026-10-03T05:37:19.563Z",
    "endedAt": "2026-10-03T05:37:27.876Z",
    "durationMs": 8313,
    "provider": "anthropic",
    "model": "claude-haiku-4-5-20251001",
    "inputTokens": 6034,
    "outputTokens": 550,
    "requestCount": 1,
    "stopReason": "end_turn",
    "outputChars": 2162
  }
]
```
<!-- notlinear-runtime-log:end -->
