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

_Last synced: 2026-05-26T13:52:12+00:00_

_Event count: 4_

```json
[
  {
    "timestamp": "2026-05-26T13:52:10.937Z",
    "id": 1,
    "kind": "http",
    "phase": "start",
    "startedAt": "2026-05-26T13:52:10.937Z",
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
    "timestamp": "2026-05-26T13:52:10.967Z",
    "id": 1,
    "kind": "http",
    "phase": "end",
    "startedAt": "2026-05-26T13:52:10.937Z",
    "endedAt": "2026-05-26T13:52:10.967Z",
    "durationMs": 31,
    "method": "POST",
    "url": "/__notlinear_scan_project",
    "provider": null,
    "label": null,
    "timeoutMs": 0,
    "status": 404,
    "ok": false,
    "statusText": "Not Found"
  },
  {
    "timestamp": "2026-05-26T13:52:10.968Z",
    "id": 1,
    "kind": "http",
    "phase": "body_start",
    "provider": null,
    "label": "cp_scan:json",
    "timeoutMs": 20000,
    "status": 404,
    "ok": false
  },
  {
    "timestamp": "2026-05-26T13:52:10.969Z",
    "id": 1,
    "kind": "http",
    "phase": "body_error",
    "provider": null,
    "label": "cp_scan:json",
    "durationMs": 0,
    "status": 404,
    "ok": false,
    "error": "The string did not match the expected pattern."
  }
]
```
<!-- notlinear-runtime-log:end -->
