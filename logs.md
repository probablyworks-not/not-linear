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

_Last synced: 2026-08-01T14:44:11+00:00_

_Event count: 32_

```json
[
  {
    "timestamp": "2026-08-01T14:44:04.758Z",
    "id": 1,
    "kind": "http",
    "phase": "start",
    "startedAt": "2026-08-01T14:44:04.757Z",
    "method": "POST",
    "url": "/__notlinear_scan_project",
    "provider": null,
    "label": null,
    "timeoutMs": 0,
    "headers": {
      "content-type": "application/json"
    },
    "body": {
      "path": "/Users/yash/Claude/Aviso_2/"
    }
  },
  {
    "timestamp": "2026-08-01T14:44:05.047Z",
    "id": 1,
    "kind": "http",
    "phase": "end",
    "startedAt": "2026-08-01T14:44:04.757Z",
    "endedAt": "2026-08-01T14:44:05.047Z",
    "durationMs": 290,
    "method": "POST",
    "url": "/__notlinear_scan_project",
    "provider": null,
    "label": null,
    "timeoutMs": 0,
    "status": 200,
    "ok": true,
    "statusText": "OK"
  },
  {
    "timestamp": "2026-08-01T14:44:05.048Z",
    "id": 1,
    "kind": "http",
    "phase": "body_start",
    "provider": null,
    "label": "cp_scan:json",
    "timeoutMs": 20000,
    "status": 200,
    "ok": true
  },
  {
    "timestamp": "2026-08-01T14:44:05.065Z",
    "id": 1,
    "kind": "http",
    "phase": "body_end",
    "provider": null,
    "label": "cp_scan:json",
    "durationMs": 18,
    "status": 200,
    "ok": true
  },
  {
    "timestamp": "2026-08-01T14:44:05.065Z",
    "id": 2,
    "kind": "http",
    "phase": "start",
    "startedAt": "2026-08-01T14:44:05.065Z",
    "method": "POST",
    "url": "/__notlinear_scan_project",
    "provider": null,
    "label": null,
    "timeoutMs": 0,
    "headers": {
      "content-type": "application/json"
    },
    "body": {
      "path": "/Users/yash/Claude/Aviso_2/"
    }
  },
  {
    "timestamp": "2026-08-01T14:44:05.153Z",
    "id": 2,
    "kind": "http",
    "phase": "end",
    "startedAt": "2026-08-01T14:44:05.065Z",
    "endedAt": "2026-08-01T14:44:05.153Z",
    "durationMs": 88,
    "method": "POST",
    "url": "/__notlinear_scan_project",
    "provider": null,
    "label": null,
    "timeoutMs": 0,
    "status": 200,
    "ok": true,
    "statusText": "OK"
  },
  {
    "timestamp": "2026-08-01T14:44:05.153Z",
    "id": 2,
    "kind": "http",
    "phase": "body_start",
    "provider": null,
    "label": "cp_scan:json",
    "timeoutMs": 20000,
    "status": 200,
    "ok": true
  },
  {
    "timestamp": "2026-08-01T14:44:05.167Z",
    "id": 2,
    "kind": "http",
    "phase": "body_end",
    "provider": null,
    "label": "cp_scan:json",
    "durationMs": 13,
    "status": 200,
    "ok": true
  },
  {
    "timestamp": "2026-08-01T14:44:05.167Z",
    "id": 3,
    "kind": "http",
    "phase": "start",
    "startedAt": "2026-08-01T14:44:05.167Z",
    "method": "POST",
    "url": "/__notlinear_scan_project",
    "provider": null,
    "label": null,
    "timeoutMs": 0,
    "headers": {
      "content-type": "application/json"
    },
    "body": {
      "path": "/Users/yash/Downloads/notlinear/"
    }
  },
  {
    "timestamp": "2026-08-01T14:44:05.214Z",
    "id": 3,
    "kind": "http",
    "phase": "end",
    "startedAt": "2026-08-01T14:44:05.167Z",
    "endedAt": "2026-08-01T14:44:05.214Z",
    "durationMs": 46,
    "method": "POST",
    "url": "/__notlinear_scan_project",
    "provider": null,
    "label": null,
    "timeoutMs": 0,
    "status": 200,
    "ok": true,
    "statusText": "OK"
  },
  {
    "timestamp": "2026-08-01T14:44:05.214Z",
    "id": 3,
    "kind": "http",
    "phase": "body_start",
    "provider": null,
    "label": "cp_scan:json",
    "timeoutMs": 20000,
    "status": 200,
    "ok": true
  },
  {
    "timestamp": "2026-08-01T14:44:05.222Z",
    "id": 3,
    "kind": "http",
    "phase": "body_end",
    "provider": null,
    "label": "cp_scan:json",
    "durationMs": 8,
    "status": 200,
    "ok": true
  },
  {
    "timestamp": "2026-08-01T14:44:05.222Z",
    "id": 4,
    "kind": "http",
    "phase": "start",
    "startedAt": "2026-08-01T14:44:05.222Z",
    "method": "POST",
    "url": "https://api.deepseek.com/v1/chat/completions",
    "provider": null,
    "label": null,
    "timeoutMs": 0,
    "headers": {
      "content-type": "application/json",
      "Authorization": "[redacted]"
    },
    "body": {
      "model": "deepseek-chat",
      "max_tokens": 80,
      "stream": false,
      "messages": "[1 messages]"
    }
  },
  {
    "timestamp": "2026-08-01T14:44:05.223Z",
    "id": 5,
    "kind": "http",
    "phase": "start",
    "startedAt": "2026-08-01T14:44:05.222Z",
    "method": "POST",
    "url": "/__notlinear_scan_project",
    "provider": null,
    "label": null,
    "timeoutMs": 0,
    "headers": {
      "content-type": "application/json"
    },
    "body": {
      "path": "/Users/yash/Claude/Linkedin GTM/"
    }
  },
  {
    "timestamp": "2026-08-01T14:44:05.229Z",
    "id": 5,
    "kind": "http",
    "phase": "end",
    "startedAt": "2026-08-01T14:44:05.222Z",
    "endedAt": "2026-08-01T14:44:05.229Z",
    "durationMs": 7,
    "method": "POST",
    "url": "/__notlinear_scan_project",
    "provider": null,
    "label": null,
    "timeoutMs": 0,
    "status": 200,
    "ok": true,
    "statusText": "OK"
  },
  {
    "timestamp": "2026-08-01T14:44:05.229Z",
    "id": 5,
    "kind": "http",
    "phase": "body_start",
    "provider": null,
    "label": "cp_scan:json",
    "timeoutMs": 20000,
    "status": 200,
    "ok": true
  },
  {
    "timestamp": "2026-08-01T14:44:05.229Z",
    "id": 5,
    "kind": "http",
    "phase": "body_end",
    "provider": null,
    "label": "cp_scan:json",
    "durationMs": 0,
    "status": 200,
    "ok": true
  },
  {
    "timestamp": "2026-08-01T14:44:05.229Z",
    "id": 6,
    "kind": "http",
    "phase": "start",
    "startedAt": "2026-08-01T14:44:05.229Z",
    "method": "POST",
    "url": "/__notlinear_scan_project",
    "provider": null,
    "label": null,
    "timeoutMs": 0,
    "headers": {
      "content-type": "application/json"
    },
    "body": {
      "path": "/Users/yash/Downloads/notlinear/"
    }
  },
  {
    "timestamp": "2026-08-01T14:44:05.250Z",
    "id": 6,
    "kind": "http",
    "phase": "end",
    "startedAt": "2026-08-01T14:44:05.229Z",
    "endedAt": "2026-08-01T14:44:05.249Z",
    "durationMs": 20,
    "method": "POST",
    "url": "/__notlinear_scan_project",
    "provider": null,
    "label": null,
    "timeoutMs": 0,
    "status": 200,
    "ok": true,
    "statusText": "OK"
  },
  {
    "timestamp": "2026-08-01T14:44:05.250Z",
    "id": 6,
    "kind": "http",
    "phase": "body_start",
    "provider": null,
    "label": "cp_scan:json",
    "timeoutMs": 20000,
    "status": 200,
    "ok": true
  },
  {
    "timestamp": "2026-08-01T14:44:05.257Z",
    "id": 6,
    "kind": "http",
    "phase": "body_end",
    "provider": null,
    "label": "cp_scan:json",
    "durationMs": 7,
    "status": 200,
    "ok": true
  },
  {
    "timestamp": "2026-08-01T14:44:05.257Z",
    "id": 7,
    "kind": "http",
    "phase": "start",
    "startedAt": "2026-08-01T14:44:05.257Z",
    "method": "POST",
    "url": "https://api.deepseek.com/v1/chat/completions",
    "provider": null,
    "label": null,
    "timeoutMs": 0,
    "headers": {
      "content-type": "application/json",
      "Authorization": "[redacted]"
    },
    "body": {
      "model": "deepseek-chat",
      "max_tokens": 80,
      "stream": false,
      "messages": "[1 messages]"
    }
  },
  {
    "timestamp": "2026-08-01T14:44:05.257Z",
    "id": 8,
    "kind": "http",
    "phase": "start",
    "startedAt": "2026-08-01T14:44:05.257Z",
    "method": "POST",
    "url": "/__notlinear_scan_project",
    "provider": null,
    "label": null,
    "timeoutMs": 0,
    "headers": {
      "content-type": "application/json"
    },
    "body": {
      "path": "/Users/yash/Claude/Linkedin Posts scraper copy"
    }
  },
  {
    "timestamp": "2026-08-01T14:44:05.311Z",
    "id": 8,
    "kind": "http",
    "phase": "end",
    "startedAt": "2026-08-01T14:44:05.257Z",
    "endedAt": "2026-08-01T14:44:05.311Z",
    "durationMs": 54,
    "method": "POST",
    "url": "/__notlinear_scan_project",
    "provider": null,
    "label": null,
    "timeoutMs": 0,
    "status": 200,
    "ok": true,
    "statusText": "OK"
  },
  {
    "timestamp": "2026-08-01T14:44:05.311Z",
    "id": 8,
    "kind": "http",
    "phase": "body_start",
    "provider": null,
    "label": "cp_scan:json",
    "timeoutMs": 20000,
    "status": 200,
    "ok": true
  },
  {
    "timestamp": "2026-08-01T14:44:05.312Z",
    "id": 8,
    "kind": "http",
    "phase": "body_end",
    "provider": null,
    "label": "cp_scan:json",
    "durationMs": 1,
    "status": 200,
    "ok": true
  },
  {
    "timestamp": "2026-08-01T14:44:05.661Z",
    "id": 4,
    "kind": "http",
    "phase": "end",
    "startedAt": "2026-08-01T14:44:05.222Z",
    "endedAt": "2026-08-01T14:44:05.661Z",
    "durationMs": 439,
    "method": "POST",
    "url": "https://api.deepseek.com/v1/chat/completions",
    "provider": null,
    "label": null,
    "timeoutMs": 0,
    "status": 200,
    "ok": true,
    "statusText": ""
  },
  {
    "timestamp": "2026-08-01T14:44:05.662Z",
    "id": 4,
    "kind": "http",
    "phase": "body_start",
    "provider": null,
    "label": "cp_status:json",
    "timeoutMs": 20000,
    "status": 200,
    "ok": true
  },
  {
    "timestamp": "2026-08-01T14:44:05.681Z",
    "id": 7,
    "kind": "http",
    "phase": "end",
    "startedAt": "2026-08-01T14:44:05.257Z",
    "endedAt": "2026-08-01T14:44:05.681Z",
    "durationMs": 424,
    "method": "POST",
    "url": "https://api.deepseek.com/v1/chat/completions",
    "provider": null,
    "label": null,
    "timeoutMs": 0,
    "status": 200,
    "ok": true,
    "statusText": ""
  },
  {
    "timestamp": "2026-08-01T14:44:05.682Z",
    "id": 7,
    "kind": "http",
    "phase": "body_start",
    "provider": null,
    "label": "cp_status:json",
    "timeoutMs": 20000,
    "status": 200,
    "ok": true
  },
  {
    "timestamp": "2026-08-01T14:44:10.352Z",
    "id": 7,
    "kind": "http",
    "phase": "body_end",
    "provider": null,
    "label": "cp_status:json",
    "durationMs": 4670,
    "status": 200,
    "ok": true
  },
  {
    "timestamp": "2026-08-01T14:44:10.353Z",
    "id": 4,
    "kind": "http",
    "phase": "body_end",
    "provider": null,
    "label": "cp_status:json",
    "durationMs": 4691,
    "status": 200,
    "ok": true
  }
]
```
<!-- notlinear-runtime-log:end -->
