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

_Last synced: 2026-05-22T16:39:33+00:00_

_Event count: 28_

```json
[
  {
    "timestamp": "2026-05-22T15:31:33.953Z",
    "id": "llm-1",
    "kind": "llm",
    "phase": "start",
    "startedAt": "2026-05-22T15:31:33.953Z",
    "provider": "deepseek",
    "model": "deepseek-reasoner",
    "messages": [
      {
        "index": 0,
        "role": "user",
        "content": "[815 chars]"
      },
      {
        "index": 1,
        "role": "assistant",
        "content": "[7292 chars]"
      },
      {
        "index": 2,
        "role": "user",
        "content": "[93 chars]"
      },
      {
        "index": 3,
        "role": "assistant",
        "content": "[9009 chars]"
      },
      {
        "index": 4,
        "role": "user",
        "content": "[165 chars]"
      },
      {
        "index": 5,
        "role": "assistant",
        "content": "[24168 chars]"
      },
      {
        "index": 6,
        "role": "user",
        "content": "[262 chars]"
      },
      {
        "index": 7,
        "role": "assistant",
        "content": "[70 chars]"
      },
      {
        "index": 8,
        "role": "user",
        "content": "[126 chars]"
      },
      {
        "index": 9,
        "role": "assistant",
        "content": "[3562 chars]"
      },
      {
        "index": 10,
        "role": "user",
        "content": "[239 chars]"
      },
      {
        "index": 11,
        "role": "assistant",
        "content": "[15427 chars]"
      },
      {
        "index": 12,
        "role": "user",
        "content": "[415 chars]"
      },
      {
        "index": 13,
        "role": "assistant",
        "content": "[49 chars]"
      },
      {
        "index": 14,
        "role": "user",
        "content": "[412 chars]"
      },
      {
        "index": 15,
        "role": "assistant",
        "content": "[2797 chars]"
      },
      {
        "index": 16,
        "role": "user",
        "content": "[1 chars]"
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
    "timestamp": "2026-05-22T15:31:33.955Z",
    "id": 1,
    "kind": "http",
    "phase": "start",
    "startedAt": "2026-05-22T15:31:33.954Z",
    "method": "POST",
    "url": "https://api.deepseek.com/v1/chat/completions",
    "provider": "deepseek",
    "label": "chat:deepseek-reasoner",
    "timeoutMs": 70000,
    "headers": {
      "content-type": "application/json",
      "Authorization": "[redacted]"
    },
    "body": {
      "model": "deepseek-reasoner",
      "max_tokens": 8192,
      "stream": true,
      "messages": "[19 messages]"
    }
  },
  {
    "timestamp": "2026-05-22T15:31:34.972Z",
    "id": 1,
    "kind": "http",
    "phase": "end",
    "startedAt": "2026-05-22T15:31:33.954Z",
    "endedAt": "2026-05-22T15:31:34.972Z",
    "durationMs": 1017,
    "method": "POST",
    "url": "https://api.deepseek.com/v1/chat/completions",
    "provider": "deepseek",
    "label": "chat:deepseek-reasoner",
    "timeoutMs": 70000,
    "status": 200,
    "ok": true,
    "statusText": ""
  },
  {
    "timestamp": "2026-05-22T15:31:51.737Z",
    "id": "llm-1",
    "kind": "llm",
    "phase": "end",
    "startedAt": "2026-05-22T15:31:33.953Z",
    "endedAt": "2026-05-22T15:31:51.737Z",
    "durationMs": 17783,
    "provider": "deepseek",
    "model": "deepseek-reasoner",
    "inputTokens": 17946,
    "cacheHitTokens": 17152,
    "outputTokens": 1139,
    "requestCount": 1,
    "toolRoundCount": 0,
    "finishReason": "stop",
    "outputChars": 4663
  },
  {
    "timestamp": "2026-05-22T15:36:51.664Z",
    "id": "llm-2",
    "kind": "llm",
    "phase": "start",
    "startedAt": "2026-05-22T15:36:51.664Z",
    "provider": "deepseek",
    "model": "deepseek-reasoner",
    "messages": [
      {
        "index": 0,
        "role": "user",
        "content": "[815 chars]"
      },
      {
        "index": 1,
        "role": "assistant",
        "content": "[7292 chars]"
      },
      {
        "index": 2,
        "role": "user",
        "content": "[93 chars]"
      },
      {
        "index": 3,
        "role": "assistant",
        "content": "[9009 chars]"
      },
      {
        "index": 4,
        "role": "user",
        "content": "[165 chars]"
      },
      {
        "index": 5,
        "role": "assistant",
        "content": "[24168 chars]"
      },
      {
        "index": 6,
        "role": "user",
        "content": "[262 chars]"
      },
      {
        "index": 7,
        "role": "assistant",
        "content": "[70 chars]"
      },
      {
        "index": 8,
        "role": "user",
        "content": "[126 chars]"
      },
      {
        "index": 9,
        "role": "assistant",
        "content": "[3562 chars]"
      },
      {
        "index": 10,
        "role": "user",
        "content": "[239 chars]"
      },
      {
        "index": 11,
        "role": "assistant",
        "content": "[15427 chars]"
      },
      {
        "index": 12,
        "role": "user",
        "content": "[415 chars]"
      },
      {
        "index": 13,
        "role": "assistant",
        "content": "[49 chars]"
      },
      {
        "index": 14,
        "role": "user",
        "content": "[412 chars]"
      },
      {
        "index": 15,
        "role": "assistant",
        "content": "[2797 chars]"
      },
      {
        "index": 16,
        "role": "user",
        "content": "[1 chars]"
      },
      {
        "index": 17,
        "role": "assistant",
        "content": "[4663 chars]"
      },
      {
        "index": 18,
        "role": "user",
        "content": "[579 chars]"
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
    "timestamp": "2026-05-22T15:36:51.665Z",
    "id": 2,
    "kind": "http",
    "phase": "start",
    "startedAt": "2026-05-22T15:36:51.665Z",
    "method": "POST",
    "url": "https://api.deepseek.com/v1/chat/completions",
    "provider": "deepseek",
    "label": "chat:deepseek-reasoner",
    "timeoutMs": 70000,
    "headers": {
      "content-type": "application/json",
      "Authorization": "[redacted]"
    },
    "body": {
      "model": "deepseek-reasoner",
      "max_tokens": 8192,
      "stream": true,
      "messages": "[21 messages]"
    }
  },
  {
    "timestamp": "2026-05-22T15:36:52.449Z",
    "id": 2,
    "kind": "http",
    "phase": "end",
    "startedAt": "2026-05-22T15:36:51.665Z",
    "endedAt": "2026-05-22T15:36:52.449Z",
    "durationMs": 784,
    "method": "POST",
    "url": "https://api.deepseek.com/v1/chat/completions",
    "provider": "deepseek",
    "label": "chat:deepseek-reasoner",
    "timeoutMs": 70000,
    "status": 200,
    "ok": true,
    "statusText": ""
  },
  {
    "timestamp": "2026-05-22T15:37:15.699Z",
    "id": "llm-2",
    "kind": "llm",
    "phase": "end",
    "startedAt": "2026-05-22T15:36:51.664Z",
    "endedAt": "2026-05-22T15:37:15.699Z",
    "durationMs": 24035,
    "provider": "deepseek",
    "model": "deepseek-reasoner",
    "inputTokens": 19177,
    "cacheHitTokens": 17152,
    "outputTokens": 1788,
    "requestCount": 1,
    "toolRoundCount": 0,
    "finishReason": "stop",
    "outputChars": 5677
  },
  {
    "timestamp": "2026-05-22T16:30:22.623Z",
    "id": "llm-3",
    "kind": "llm",
    "phase": "start",
    "startedAt": "2026-05-22T16:30:22.623Z",
    "provider": "deepseek",
    "model": "deepseek-reasoner",
    "messages": [
      {
        "index": 0,
        "role": "user",
        "content": "[815 chars]"
      },
      {
        "index": 1,
        "role": "assistant",
        "content": "[7292 chars]"
      },
      {
        "index": 2,
        "role": "user",
        "content": "[93 chars]"
      },
      {
        "index": 3,
        "role": "assistant",
        "content": "[9009 chars]"
      },
      {
        "index": 4,
        "role": "user",
        "content": "[165 chars]"
      },
      {
        "index": 5,
        "role": "assistant",
        "content": "[24168 chars]"
      },
      {
        "index": 6,
        "role": "user",
        "content": "[262 chars]"
      },
      {
        "index": 7,
        "role": "assistant",
        "content": "[70 chars]"
      },
      {
        "index": 8,
        "role": "user",
        "content": "[126 chars]"
      },
      {
        "index": 9,
        "role": "assistant",
        "content": "[3562 chars]"
      },
      {
        "index": 10,
        "role": "user",
        "content": "[239 chars]"
      },
      {
        "index": 11,
        "role": "assistant",
        "content": "[15427 chars]"
      },
      {
        "index": 12,
        "role": "user",
        "content": "[415 chars]"
      },
      {
        "index": 13,
        "role": "assistant",
        "content": "[49 chars]"
      },
      {
        "index": 14,
        "role": "user",
        "content": "[412 chars]"
      },
      {
        "index": 15,
        "role": "assistant",
        "content": "[2797 chars]"
      },
      {
        "index": 16,
        "role": "user",
        "content": "[1 chars]"
      },
      {
        "index": 17,
        "role": "assistant",
        "content": "[4663 chars]"
      },
      {
        "index": 18,
        "role": "user",
        "content": "[579 chars]"
      },
      {
        "index": 19,
        "role": "assistant",
        "content": "[5677 chars]"
      },
      {
        "index": 20,
        "role": "user",
        "content": "[237 chars]"
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
    "timestamp": "2026-05-22T16:30:22.624Z",
    "id": 3,
    "kind": "http",
    "phase": "start",
    "startedAt": "2026-05-22T16:30:22.624Z",
    "method": "POST",
    "url": "https://api.deepseek.com/v1/chat/completions",
    "provider": "deepseek",
    "label": "chat:deepseek-reasoner",
    "timeoutMs": 70000,
    "headers": {
      "content-type": "application/json",
      "Authorization": "[redacted]"
    },
    "body": {
      "model": "deepseek-reasoner",
      "max_tokens": 8192,
      "stream": true,
      "messages": "[23 messages]"
    }
  },
  {
    "timestamp": "2026-05-22T16:30:23.335Z",
    "id": 3,
    "kind": "http",
    "phase": "end",
    "startedAt": "2026-05-22T16:30:22.624Z",
    "endedAt": "2026-05-22T16:30:23.334Z",
    "durationMs": 711,
    "method": "POST",
    "url": "https://api.deepseek.com/v1/chat/completions",
    "provider": "deepseek",
    "label": "chat:deepseek-reasoner",
    "timeoutMs": 70000,
    "status": 200,
    "ok": true,
    "statusText": ""
  },
  {
    "timestamp": "2026-05-22T16:31:18.338Z",
    "id": "llm-3",
    "kind": "llm",
    "phase": "end",
    "startedAt": "2026-05-22T16:30:22.623Z",
    "endedAt": "2026-05-22T16:31:18.338Z",
    "durationMs": 55715,
    "provider": "deepseek",
    "model": "deepseek-reasoner",
    "inputTokens": 21031,
    "cacheHitTokens": 0,
    "outputTokens": 4309,
    "requestCount": 1,
    "toolRoundCount": 0,
    "finishReason": "stop",
    "outputChars": 16008
  },
  {
    "timestamp": "2026-05-22T16:32:14.037Z",
    "id": "llm-4",
    "kind": "llm",
    "phase": "start",
    "startedAt": "2026-05-22T16:32:14.037Z",
    "provider": "deepseek",
    "model": "deepseek-reasoner",
    "messages": [
      {
        "index": 0,
        "role": "user",
        "content": "[815 chars]"
      },
      {
        "index": 1,
        "role": "assistant",
        "content": "[7292 chars]"
      },
      {
        "index": 2,
        "role": "user",
        "content": "[93 chars]"
      },
      {
        "index": 3,
        "role": "assistant",
        "content": "[9009 chars]"
      },
      {
        "index": 4,
        "role": "user",
        "content": "[165 chars]"
      },
      {
        "index": 5,
        "role": "assistant",
        "content": "[24168 chars]"
      },
      {
        "index": 6,
        "role": "user",
        "content": "[262 chars]"
      },
      {
        "index": 7,
        "role": "assistant",
        "content": "[70 chars]"
      },
      {
        "index": 8,
        "role": "user",
        "content": "[126 chars]"
      },
      {
        "index": 9,
        "role": "assistant",
        "content": "[3562 chars]"
      },
      {
        "index": 10,
        "role": "user",
        "content": "[239 chars]"
      },
      {
        "index": 11,
        "role": "assistant",
        "content": "[15427 chars]"
      },
      {
        "index": 12,
        "role": "user",
        "content": "[415 chars]"
      },
      {
        "index": 13,
        "role": "assistant",
        "content": "[49 chars]"
      },
      {
        "index": 14,
        "role": "user",
        "content": "[412 chars]"
      },
      {
        "index": 15,
        "role": "assistant",
        "content": "[2797 chars]"
      },
      {
        "index": 16,
        "role": "user",
        "content": "[1 chars]"
      },
      {
        "index": 17,
        "role": "assistant",
        "content": "[4663 chars]"
      },
      {
        "index": 18,
        "role": "user",
        "content": "[579 chars]"
      },
      {
        "index": 19,
        "role": "assistant",
        "content": "[5677 chars]"
      },
      {
        "index": 20,
        "role": "user",
        "content": "[237 chars]"
      },
      {
        "index": 21,
        "role": "assistant",
        "content": "[16008 chars]"
      },
      {
        "index": 22,
        "role": "user",
        "content": "[776 chars]"
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
    "timestamp": "2026-05-22T16:32:14.038Z",
    "id": 4,
    "kind": "http",
    "phase": "start",
    "startedAt": "2026-05-22T16:32:14.038Z",
    "method": "POST",
    "url": "https://api.deepseek.com/v1/chat/completions",
    "provider": "deepseek",
    "label": "chat:deepseek-reasoner",
    "timeoutMs": 70000,
    "headers": {
      "content-type": "application/json",
      "Authorization": "[redacted]"
    },
    "body": {
      "model": "deepseek-reasoner",
      "max_tokens": 8192,
      "stream": true,
      "messages": "[25 messages]"
    }
  },
  {
    "timestamp": "2026-05-22T16:32:14.850Z",
    "id": 4,
    "kind": "http",
    "phase": "end",
    "startedAt": "2026-05-22T16:32:14.038Z",
    "endedAt": "2026-05-22T16:32:14.850Z",
    "durationMs": 813,
    "method": "POST",
    "url": "https://api.deepseek.com/v1/chat/completions",
    "provider": "deepseek",
    "label": "chat:deepseek-reasoner",
    "timeoutMs": 70000,
    "status": 200,
    "ok": true,
    "statusText": ""
  },
  {
    "timestamp": "2026-05-22T16:32:38.506Z",
    "id": "llm-4",
    "kind": "llm",
    "phase": "end",
    "startedAt": "2026-05-22T16:32:14.037Z",
    "endedAt": "2026-05-22T16:32:38.506Z",
    "durationMs": 24469,
    "provider": "deepseek",
    "model": "deepseek-reasoner",
    "inputTokens": 25385,
    "cacheHitTokens": 384,
    "outputTokens": 1488,
    "requestCount": 1,
    "toolRoundCount": 0,
    "finishReason": "stop",
    "outputChars": 4497
  },
  {
    "timestamp": "2026-05-22T16:34:25.499Z",
    "id": "llm-5",
    "kind": "llm",
    "phase": "start",
    "startedAt": "2026-05-22T16:34:25.499Z",
    "provider": "deepseek",
    "model": "deepseek-reasoner",
    "messages": [
      {
        "index": 0,
        "role": "user",
        "content": "[815 chars]"
      },
      {
        "index": 1,
        "role": "assistant",
        "content": "[7292 chars]"
      },
      {
        "index": 2,
        "role": "user",
        "content": "[93 chars]"
      },
      {
        "index": 3,
        "role": "assistant",
        "content": "[9009 chars]"
      },
      {
        "index": 4,
        "role": "user",
        "content": "[165 chars]"
      },
      {
        "index": 5,
        "role": "assistant",
        "content": "[24168 chars]"
      },
      {
        "index": 6,
        "role": "user",
        "content": "[262 chars]"
      },
      {
        "index": 7,
        "role": "assistant",
        "content": "[70 chars]"
      },
      {
        "index": 8,
        "role": "user",
        "content": "[126 chars]"
      },
      {
        "index": 9,
        "role": "assistant",
        "content": "[3562 chars]"
      },
      {
        "index": 10,
        "role": "user",
        "content": "[239 chars]"
      },
      {
        "index": 11,
        "role": "assistant",
        "content": "[15427 chars]"
      },
      {
        "index": 12,
        "role": "user",
        "content": "[415 chars]"
      },
      {
        "index": 13,
        "role": "assistant",
        "content": "[49 chars]"
      },
      {
        "index": 14,
        "role": "user",
        "content": "[412 chars]"
      },
      {
        "index": 15,
        "role": "assistant",
        "content": "[2797 chars]"
      },
      {
        "index": 16,
        "role": "user",
        "content": "[1 chars]"
      },
      {
        "index": 17,
        "role": "assistant",
        "content": "[4663 chars]"
      },
      {
        "index": 18,
        "role": "user",
        "content": "[579 chars]"
      },
      {
        "index": 19,
        "role": "assistant",
        "content": "[5677 chars]"
      },
      {
        "index": 20,
        "role": "user",
        "content": "[237 chars]"
      },
      {
        "index": 21,
        "role": "assistant",
        "content": "[16008 chars]"
      },
      {
        "index": 22,
        "role": "user",
        "content": "[47 chars]"
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
    "timestamp": "2026-05-22T16:34:25.500Z",
    "id": 5,
    "kind": "http",
    "phase": "start",
    "startedAt": "2026-05-22T16:34:25.499Z",
    "method": "POST",
    "url": "https://api.deepseek.com/v1/chat/completions",
    "provider": "deepseek",
    "label": "chat:deepseek-reasoner",
    "timeoutMs": 70000,
    "headers": {
      "content-type": "application/json",
      "Authorization": "[redacted]"
    },
    "body": {
      "model": "deepseek-reasoner",
      "max_tokens": 8192,
      "stream": true,
      "messages": "[25 messages]"
    }
  },
  {
    "timestamp": "2026-05-22T16:34:26.332Z",
    "id": 5,
    "kind": "http",
    "phase": "end",
    "startedAt": "2026-05-22T16:34:25.499Z",
    "endedAt": "2026-05-22T16:34:26.332Z",
    "durationMs": 833,
    "method": "POST",
    "url": "https://api.deepseek.com/v1/chat/completions",
    "provider": "deepseek",
    "label": "chat:deepseek-reasoner",
    "timeoutMs": 70000,
    "status": 200,
    "ok": true,
    "statusText": ""
  },
  {
    "timestamp": "2026-05-22T16:34:58.791Z",
    "id": "llm-5",
    "kind": "llm",
    "phase": "end",
    "startedAt": "2026-05-22T16:34:25.499Z",
    "endedAt": "2026-05-22T16:34:58.791Z",
    "durationMs": 33293,
    "provider": "deepseek",
    "model": "deepseek-reasoner",
    "inputTokens": 25209,
    "cacheHitTokens": 384,
    "outputTokens": 2311,
    "requestCount": 1,
    "toolRoundCount": 0,
    "finishReason": "stop",
    "outputChars": 8393
  },
  {
    "timestamp": "2026-05-22T16:38:02.531Z",
    "id": "llm-6",
    "kind": "llm",
    "phase": "start",
    "startedAt": "2026-05-22T16:38:02.531Z",
    "provider": "deepseek",
    "model": "deepseek-reasoner",
    "messages": [
      {
        "index": 0,
        "role": "user",
        "content": "[815 chars]"
      },
      {
        "index": 1,
        "role": "assistant",
        "content": "[7292 chars]"
      },
      {
        "index": 2,
        "role": "user",
        "content": "[93 chars]"
      },
      {
        "index": 3,
        "role": "assistant",
        "content": "[9009 chars]"
      },
      {
        "index": 4,
        "role": "user",
        "content": "[165 chars]"
      },
      {
        "index": 5,
        "role": "assistant",
        "content": "[24168 chars]"
      },
      {
        "index": 6,
        "role": "user",
        "content": "[262 chars]"
      },
      {
        "index": 7,
        "role": "assistant",
        "content": "[70 chars]"
      },
      {
        "index": 8,
        "role": "user",
        "content": "[126 chars]"
      },
      {
        "index": 9,
        "role": "assistant",
        "content": "[3562 chars]"
      },
      {
        "index": 10,
        "role": "user",
        "content": "[239 chars]"
      },
      {
        "index": 11,
        "role": "assistant",
        "content": "[15427 chars]"
      },
      {
        "index": 12,
        "role": "user",
        "content": "[415 chars]"
      },
      {
        "index": 13,
        "role": "assistant",
        "content": "[49 chars]"
      },
      {
        "index": 14,
        "role": "user",
        "content": "[412 chars]"
      },
      {
        "index": 15,
        "role": "assistant",
        "content": "[2797 chars]"
      },
      {
        "index": 16,
        "role": "user",
        "content": "[1 chars]"
      },
      {
        "index": 17,
        "role": "assistant",
        "content": "[4663 chars]"
      },
      {
        "index": 18,
        "role": "user",
        "content": "[579 chars]"
      },
      {
        "index": 19,
        "role": "assistant",
        "content": "[5677 chars]"
      },
      {
        "index": 20,
        "role": "user",
        "content": "[237 chars]"
      },
      {
        "index": 21,
        "role": "assistant",
        "content": "[16008 chars]"
      },
      {
        "index": 22,
        "role": "user",
        "content": "[47 chars]"
      },
      {
        "index": 23,
        "role": "assistant",
        "content": "[8393 chars]"
      },
      {
        "index": 24,
        "role": "user",
        "content": "[33 chars]"
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
    "timestamp": "2026-05-22T16:38:02.532Z",
    "id": 6,
    "kind": "http",
    "phase": "start",
    "startedAt": "2026-05-22T16:38:02.531Z",
    "method": "POST",
    "url": "https://api.deepseek.com/v1/chat/completions",
    "provider": "deepseek",
    "label": "chat:deepseek-reasoner",
    "timeoutMs": 70000,
    "headers": {
      "content-type": "application/json",
      "Authorization": "[redacted]"
    },
    "body": {
      "model": "deepseek-reasoner",
      "max_tokens": 8192,
      "stream": true,
      "messages": "[27 messages]"
    }
  },
  {
    "timestamp": "2026-05-22T16:38:03.322Z",
    "id": 6,
    "kind": "http",
    "phase": "end",
    "startedAt": "2026-05-22T16:38:02.531Z",
    "endedAt": "2026-05-22T16:38:03.322Z",
    "durationMs": 791,
    "method": "POST",
    "url": "https://api.deepseek.com/v1/chat/completions",
    "provider": "deepseek",
    "label": "chat:deepseek-reasoner",
    "timeoutMs": 70000,
    "status": 200,
    "ok": true,
    "statusText": ""
  },
  {
    "timestamp": "2026-05-22T16:38:22.676Z",
    "id": "llm-6",
    "kind": "llm",
    "phase": "end",
    "startedAt": "2026-05-22T16:38:02.531Z",
    "endedAt": "2026-05-22T16:38:22.676Z",
    "durationMs": 20145,
    "provider": "deepseek",
    "model": "deepseek-reasoner",
    "inputTokens": 27440,
    "cacheHitTokens": 25088,
    "outputTokens": 1390,
    "requestCount": 1,
    "toolRoundCount": 0,
    "finishReason": "stop",
    "outputChars": 5111
  },
  {
    "timestamp": "2026-05-22T16:39:04.838Z",
    "id": "llm-7",
    "kind": "llm",
    "phase": "start",
    "startedAt": "2026-05-22T16:39:04.838Z",
    "provider": "deepseek",
    "model": "deepseek-reasoner",
    "messages": [
      {
        "index": 0,
        "role": "user",
        "content": "[815 chars]"
      },
      {
        "index": 1,
        "role": "assistant",
        "content": "[7292 chars]"
      },
      {
        "index": 2,
        "role": "user",
        "content": "[93 chars]"
      },
      {
        "index": 3,
        "role": "assistant",
        "content": "[9009 chars]"
      },
      {
        "index": 4,
        "role": "user",
        "content": "[165 chars]"
      },
      {
        "index": 5,
        "role": "assistant",
        "content": "[24168 chars]"
      },
      {
        "index": 6,
        "role": "user",
        "content": "[262 chars]"
      },
      {
        "index": 7,
        "role": "assistant",
        "content": "[70 chars]"
      },
      {
        "index": 8,
        "role": "user",
        "content": "[126 chars]"
      },
      {
        "index": 9,
        "role": "assistant",
        "content": "[3562 chars]"
      },
      {
        "index": 10,
        "role": "user",
        "content": "[239 chars]"
      },
      {
        "index": 11,
        "role": "assistant",
        "content": "[15427 chars]"
      },
      {
        "index": 12,
        "role": "user",
        "content": "[415 chars]"
      },
      {
        "index": 13,
        "role": "assistant",
        "content": "[49 chars]"
      },
      {
        "index": 14,
        "role": "user",
        "content": "[412 chars]"
      },
      {
        "index": 15,
        "role": "assistant",
        "content": "[2797 chars]"
      },
      {
        "index": 16,
        "role": "user",
        "content": "[1 chars]"
      },
      {
        "index": 17,
        "role": "assistant",
        "content": "[4663 chars]"
      },
      {
        "index": 18,
        "role": "user",
        "content": "[579 chars]"
      },
      {
        "index": 19,
        "role": "assistant",
        "content": "[5677 chars]"
      },
      {
        "index": 20,
        "role": "user",
        "content": "[237 chars]"
      },
      {
        "index": 21,
        "role": "assistant",
        "content": "[16008 chars]"
      },
      {
        "index": 22,
        "role": "user",
        "content": "[47 chars]"
      },
      {
        "index": 23,
        "role": "assistant",
        "content": "[8393 chars]"
      },
      {
        "index": 24,
        "role": "user",
        "content": "[33 chars]"
      },
      {
        "index": 25,
        "role": "assistant",
        "content": "[5111 chars]"
      },
      {
        "index": 26,
        "role": "user",
        "content": "[31 chars]"
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
    "timestamp": "2026-05-22T16:39:04.839Z",
    "id": 7,
    "kind": "http",
    "phase": "start",
    "startedAt": "2026-05-22T16:39:04.839Z",
    "method": "POST",
    "url": "https://api.deepseek.com/v1/chat/completions",
    "provider": "deepseek",
    "label": "chat:deepseek-reasoner",
    "timeoutMs": 70000,
    "headers": {
      "content-type": "application/json",
      "Authorization": "[redacted]"
    },
    "body": {
      "model": "deepseek-reasoner",
      "max_tokens": 8192,
      "stream": true,
      "messages": "[29 messages]"
    }
  },
  {
    "timestamp": "2026-05-22T16:39:05.580Z",
    "id": 7,
    "kind": "http",
    "phase": "end",
    "startedAt": "2026-05-22T16:39:04.839Z",
    "endedAt": "2026-05-22T16:39:05.580Z",
    "durationMs": 742,
    "method": "POST",
    "url": "https://api.deepseek.com/v1/chat/completions",
    "provider": "deepseek",
    "label": "chat:deepseek-reasoner",
    "timeoutMs": 70000,
    "status": 200,
    "ok": true,
    "statusText": ""
  },
  {
    "timestamp": "2026-05-22T16:39:32.607Z",
    "id": "llm-7",
    "kind": "llm",
    "phase": "end",
    "startedAt": "2026-05-22T16:39:04.838Z",
    "endedAt": "2026-05-22T16:39:32.607Z",
    "durationMs": 27769,
    "provider": "deepseek",
    "model": "deepseek-reasoner",
    "inputTokens": 28699,
    "cacheHitTokens": 25088,
    "outputTokens": 2480,
    "requestCount": 1,
    "toolRoundCount": 0,
    "finishReason": "stop",
    "outputChars": 8390
  }
]
```
<!-- notlinear-runtime-log:end -->
