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

_Last synced: 2026-09-01T13:15:43+00:00_

_Event count: 18_

```json
[
  {
    "timestamp": "2026-09-01T13:13:02.461Z",
    "id": "llm-1",
    "kind": "llm",
    "phase": "start",
    "startedAt": "2026-09-01T13:13:02.461Z",
    "provider": "anthropic",
    "model": "claude-opus-5",
    "messages": [
      {
        "index": 0,
        "role": "user",
        "content": "[3703 chars]"
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
    "timestamp": "2026-09-01T13:13:02.462Z",
    "id": 1,
    "kind": "http",
    "phase": "start",
    "startedAt": "2026-09-01T13:13:02.462Z",
    "method": "POST",
    "url": "https://api.anthropic.com/v1/messages",
    "provider": "anthropic",
    "label": "messages:claude-opus-5",
    "timeoutMs": 70000,
    "headers": {
      "content-type": "application/json",
      "x-api-key": "[redacted]",
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    "body": {
      "model": "claude-opus-5",
      "max_tokens": 8192,
      "stream": true,
      "system": "[3070 chars]",
      "messages": "[1 messages]",
      "tools": "[3 tools]"
    }
  },
  {
    "timestamp": "2026-09-01T13:13:04.332Z",
    "id": 1,
    "kind": "http",
    "phase": "end",
    "startedAt": "2026-09-01T13:13:02.462Z",
    "endedAt": "2026-09-01T13:13:04.332Z",
    "durationMs": 1870,
    "method": "POST",
    "url": "https://api.anthropic.com/v1/messages",
    "provider": "anthropic",
    "label": "messages:claude-opus-5",
    "timeoutMs": 70000,
    "status": 200,
    "ok": true,
    "statusText": ""
  },
  {
    "timestamp": "2026-09-01T13:13:35.969Z",
    "id": "tool-2",
    "kind": "tool",
    "phase": "start",
    "startedAt": "2026-09-01T13:13:35.969Z",
    "tool": "serper_search",
    "input": {
      "query": "RBI prepaid payment instrument rules closed loop wallet advance against goods exemption"
    }
  },
  {
    "timestamp": "2026-09-01T13:13:35.970Z",
    "id": 2,
    "kind": "http",
    "phase": "start",
    "startedAt": "2026-09-01T13:13:35.970Z",
    "method": "POST",
    "url": "https://google.serper.dev/search",
    "provider": "serper",
    "label": "search",
    "timeoutMs": 12000,
    "headers": {
      "X-API-KEY": "[redacted]",
      "Content-Type": "application/json"
    },
    "body": {
      "q": "RBI prepaid payment instrument rules closed loop wallet advance against goods exemption",
      "num": 6
    }
  },
  {
    "timestamp": "2026-09-01T13:13:35.971Z",
    "id": "tool-3",
    "kind": "tool",
    "phase": "start",
    "startedAt": "2026-09-01T13:13:35.971Z",
    "tool": "serper_search",
    "input": {
      "query": "milk delivery subscription management software India dairy route agent app"
    }
  },
  {
    "timestamp": "2026-09-01T13:13:35.971Z",
    "id": 3,
    "kind": "http",
    "phase": "start",
    "startedAt": "2026-09-01T13:13:35.971Z",
    "method": "POST",
    "url": "https://google.serper.dev/search",
    "provider": "serper",
    "label": "search",
    "timeoutMs": 12000,
    "headers": {
      "X-API-KEY": "[redacted]",
      "Content-Type": "application/json"
    },
    "body": {
      "q": "milk delivery subscription management software India dairy route agent app",
      "num": 6
    }
  },
  {
    "timestamp": "2026-09-01T13:13:39.150Z",
    "id": 2,
    "kind": "http",
    "phase": "end",
    "startedAt": "2026-09-01T13:13:35.970Z",
    "endedAt": "2026-09-01T13:13:39.150Z",
    "durationMs": 3181,
    "method": "POST",
    "url": "https://google.serper.dev/search",
    "provider": "serper",
    "label": "search",
    "timeoutMs": 12000,
    "status": 200,
    "ok": true,
    "statusText": ""
  },
  {
    "timestamp": "2026-09-01T13:13:39.151Z",
    "id": 2,
    "kind": "http",
    "phase": "body_start",
    "provider": "serper",
    "label": "search:json",
    "timeoutMs": 12000,
    "status": 200,
    "ok": true
  },
  {
    "timestamp": "2026-09-01T13:13:39.152Z",
    "id": 2,
    "kind": "http",
    "phase": "body_end",
    "provider": "serper",
    "label": "search:json",
    "durationMs": 1,
    "status": 200,
    "ok": true
  },
  {
    "timestamp": "2026-09-01T13:13:39.153Z",
    "id": "tool-2",
    "kind": "tool",
    "phase": "end",
    "startedAt": "2026-09-01T13:13:35.969Z",
    "endedAt": "2026-09-01T13:13:39.153Z",
    "durationMs": 3184,
    "tool": "serper_search",
    "outputChars": 1610,
    "outputPreview": "1. **Nov 22, 2022 - Prepaid Payment Instruments (PPIs)**\nhttps://www.rbi.org.in/commonman/english/scripts/FAQs.aspx?Id=2812\nPPIs can be issued as cards, wallets, and any such form / instrument which can be used to access the PPI and to use the amount therein.\n\n2. **RBI proposes rehaul of Prepaid Payment Instruments (PPI) ...**\nhttps://www.lexology.com/library/detail.aspx?g=72222621-4870-40e5-9332-2592cbf892ba\nMarketplaces no longer entitled to claim closed-system PPI exemption. In the existing\u2026"
  },
  {
    "timestamp": "2026-09-01T13:13:39.443Z",
    "id": 3,
    "kind": "http",
    "phase": "end",
    "startedAt": "2026-09-01T13:13:35.971Z",
    "endedAt": "2026-09-01T13:13:39.443Z",
    "durationMs": 3472,
    "method": "POST",
    "url": "https://google.serper.dev/search",
    "provider": "serper",
    "label": "search",
    "timeoutMs": 12000,
    "status": 200,
    "ok": true,
    "statusText": ""
  },
  {
    "timestamp": "2026-09-01T13:13:39.443Z",
    "id": 3,
    "kind": "http",
    "phase": "body_start",
    "provider": "serper",
    "label": "search:json",
    "timeoutMs": 12000,
    "status": 200,
    "ok": true
  },
  {
    "timestamp": "2026-09-01T13:13:39.444Z",
    "id": 3,
    "kind": "http",
    "phase": "body_end",
    "provider": "serper",
    "label": "search:json",
    "durationMs": 0,
    "status": 200,
    "ok": true
  },
  {
    "timestamp": "2026-09-01T13:13:39.444Z",
    "id": "tool-3",
    "kind": "tool",
    "phase": "end",
    "startedAt": "2026-09-01T13:13:35.971Z",
    "endedAt": "2026-09-01T13:13:39.444Z",
    "durationMs": 3473,
    "tool": "serper_search",
    "outputChars": 1610,
    "outputPreview": "1. **Milk Delivery Software: The Complete Guide (2025)**\nhttps://milkmaster.co/blog/milk-delivery-software-complete-guide\nIndia's #1 SaaS platform for milk & subscription delivery. Trusted by 200+ brands across India and the UK.\n\n2. **Milk Supply Chain Management Software for Dairy Delivery**\nhttps://rekart.io/insights/milk-supply-chain-management-software\nRekart is a SaaS-based milk, tiffin, & grocery delivery and subscription management platform that enables businesses to manage subscriptions\u2026"
  },
  {
    "timestamp": "2026-09-01T13:13:39.445Z",
    "id": 4,
    "kind": "http",
    "phase": "start",
    "startedAt": "2026-09-01T13:13:39.445Z",
    "method": "POST",
    "url": "https://api.anthropic.com/v1/messages",
    "provider": "anthropic",
    "label": "messages:claude-opus-5",
    "timeoutMs": 70000,
    "headers": {
      "content-type": "application/json",
      "x-api-key": "[redacted]",
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true"
    },
    "body": {
      "model": "claude-opus-5",
      "max_tokens": 8192,
      "stream": true,
      "system": "[3070 chars]",
      "messages": "[3 messages]",
      "tools": "[3 tools]"
    }
  },
  {
    "timestamp": "2026-09-01T13:13:40.886Z",
    "id": 4,
    "kind": "http",
    "phase": "end",
    "startedAt": "2026-09-01T13:13:39.445Z",
    "endedAt": "2026-09-01T13:13:40.886Z",
    "durationMs": 1441,
    "method": "POST",
    "url": "https://api.anthropic.com/v1/messages",
    "provider": "anthropic",
    "label": "messages:claude-opus-5",
    "timeoutMs": 70000,
    "status": 200,
    "ok": true,
    "statusText": ""
  },
  {
    "timestamp": "2026-09-01T13:15:42.751Z",
    "id": "llm-1",
    "kind": "llm",
    "phase": "end",
    "startedAt": "2026-09-01T13:13:02.461Z",
    "endedAt": "2026-09-01T13:15:42.751Z",
    "durationMs": 160289,
    "provider": "anthropic",
    "model": "claude-opus-5",
    "inputTokens": 9331,
    "outputTokens": 10295,
    "requestCount": 2,
    "stopReason": "max_tokens",
    "outputChars": 12434
  }
]
```
<!-- notlinear-runtime-log:end -->
