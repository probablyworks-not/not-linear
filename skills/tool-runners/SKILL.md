---
name: tool-runners
description: Maintain legacy frontend/providers/tools.js runners only. Current React tool execution lives under web/src; Canvas execution is documented in skills/canvas-branch-system/SKILL.md.
---

# Scope and routing

The active application is React/TypeScript under `web/`, built with Vite. The historical vanilla-JS app is not the current Canvas implementation. Do not infer that Canvas uses `threadState`, `persistAll`, `openBranch`, legacy DOM panels, or the old no-build workflow.

For Canvas work, read [Canvas branch system](../canvas-branch-system/SKILL.md) and inspect current callers and types. For chat branches in React, inspect `web/src/branch/` and `web/src/db/branch-ops.ts`; do not apply legacy function contracts to them. For other React features, inspect their own store/repository and tests.

The material below is historical guidance for `frontend/` only. Preserve it for legacy maintenance; do not apply it to `web/`.

---


# Tool runners

The tool-runner surface area is large and growing. Each runner has its own provider quirks, but they share a strict request/timeout/logging contract that must not be broken.

## The runners

All live near each other in the script, dispatched through `executeTool(name, input, signal)`:

- `runWikipediaSearch(query, signal)` — free, no API key, used for established facts.
- `runFetchUrl(url, signal)` — direct fetch of a URL.
- `runWebSearch(query, signal)` — generic web search via SearxNG (`prefs.searxngUrl`).
- `runSerperSearch(query, signal)` — Serper-backed web search (requires `apiKeys.serper`).
- `runFirecrawlScrape(url, signal)` — JS-aware page scrape (requires `apiKeys.firecrawl`).

## The shared contract

Every runner must:

1. **Accept an `AbortSignal`** as its last argument and pass it to `loggedFetch`. Tool calls must be cancellable.
2. **Use `loggedFetch`, not raw `fetch`.** `loggedFetch` handles request logging, error payload reading, and timeout integration. Calling raw `fetch` bypasses observability and is a regression.
3. **Pass a `meta` object** to `loggedFetch` with `provider`, `label`, and `timeoutMs`. These show up in the request log (`window.notlinearRequestLog`) and are how debugging happens.
4. **Use the right timeout constant** — never inline a number. Constants exist near the top of the script:
   - `TOOL_TIMEOUT_MS` — generic tool default
   - `SEARCH_TIMEOUT_MS` — web/wiki searches
   - `PAGE_READ_TIMEOUT_MS` — direct URL fetches
   - `SCRAPE_TIMEOUT_MS` — Firecrawl
   - `MODEL_CONNECT_TIMEOUT_MS`, `MODEL_STREAM_IDLE_TIMEOUT_MS` — model API only
5. **Return a string** that the model can read directly (search snippets joined, page text extracted, etc.). Do not return raw JSON the model has to parse.

## Adding a new tool runner

If asked to add a new tool, follow this checklist:

- [ ] Add the runner function alongside the existing `run*` functions.
- [ ] Wire it into `executeTool`'s switch.
- [ ] Add the tool definition to `buildTools` (and `buildDeepSeekTools` if it should be available there too — confirm with the human; the two tool sets are intentionally not always identical).
- [ ] If it requires an API key, gate the tool entry on `apiKeys.<provider>` so models without the key don't see a broken tool.
- [ ] Update `buildSystemPrompt` to mention the new tool and when to use it. (See `system-prompt` skill.)
- [ ] Add an appropriate timeout constant if existing ones don't fit. Keep timeouts short — slow tools block branch responses. (See `BUGS.md` #010.)

## Editing existing runners

Be especially careful with:

- **Timeout values.** `BUGS.md` #010 was caused by overly generous timeouts. Do not lengthen them without reason.
- **Result shaping.** The model's behavior depends on what the tool returns. Changing the format (e.g., snippet count, separator) is a behavior change — disclose it in the changelog.
- **Error messages.** The strings returned on failure are read by the model and influence whether it retries with a different tool. Don't make them more verbose; do make them specific.

## Logging

`loggedFetch` populates `window.notlinearRequestLog` and emits via `logBackendEvent`. The log is the primary debugging surface for "why is the model doing the wrong thing." If you bypass logging, you make future debugging harder for everyone.

## Before you finish

- [ ] Every new fetch goes through `loggedFetch`, not raw `fetch`.
- [ ] Every runner respects its `AbortSignal`.
- [ ] No magic-number timeouts — all constants.
- [ ] If you added a tool, both `buildTools` and `buildSystemPrompt` know about it.
- [ ] If you changed return format, you noted the behavior change in the changelog.
