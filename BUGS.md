# Bugs

This file is the institutional memory of every bug found and fixed in this repository. Every bug fix appends a new numbered entry. Entries are never deleted — they are the test cases we wish we had written.

Read the **Fragile areas** section before modifying any code in those areas.

---

## Fragile areas

Areas that have broken two or more times. If your task touches any of these, you must explicitly state in your reasoning how your change avoids the previous failure modes.

- **Branch panel reopen / single-instance behavior** — bugs #002, #003. Panels for child and nested-child branches have repeatedly failed to reopen after the single-instance rule was introduced.
- **Branch chat persistence across switches** — bugs #008, #009. Branch conversations have been lost or overwritten by snapshot/restore logic that did not account for all entry paths (chat switch, quote-only reopen).
- **Branch research/tool status** — bugs #010, #011, #012, #014, #015, #016, #017, #018. Branch research has regressed in actual tool timing, stale status UI, post-search synthesis waits that hid retrieved results, unbounded response-body reads, model-driven tool loops that kept searching instead of answering, raw DeepSeek pseudo-tool markup leaking into answers, local aborts after successful tool results losing the fallback answer, and the `completeWithToolFallback` salvage being placed in the wrong function.

---

## Active bugs

None currently tracked.

### #023 — "Try again" button did nothing after Claude rate limit
- Date discovered: 2026-05-10
- Date fixed: 2026-05-10
- Agent: Kimi (k2.6)
- Symptom: When Claude returned a rate-limit error, the "Try again" button appeared but simply re-ran the same Claude request, which would fail again with the same error.
- Root cause: The `onError` handler in both `runMainTurn` and `runBranchTurn` treated all non-config errors the same way: show a "Try again" button that called the original `doMainCall`/`doBranchCall` with the same Claude adapter. There was no model-fallback path.
- Fix: Added a Claude-rate-limit detection guard in both `onError` handlers. When the error message matches `/claude.*rate limit/i`, a DeepSeek key is present, and the turn has not already auto-switched once, the handler swaps the adapter to DeepSeek, rebuilds the message list with `buildPlainUserContent`, sets a brief status, and retries automatically.
- Files touched: `notlinear.html`, `BUGS.md`, `CHANGELOG.md`
- Manual test case:
  1. Ensure Claude is selected and a DeepSeek API key is saved in Settings.
  2. Send a message that triggers a Claude 429 rate-limit response (or simulate by temporarily blocking the Anthropic endpoint).
  3. Confirm the UI shows "Claude rate limited — switching to DeepSeek…" and then automatically retries with DeepSeek.
  4. Confirm the DeepSeek response streams normally without requiring a manual click.
  5. Repeat inside a branch panel — same auto-fallback behavior.
- Related: none.

### #020 — Expanded branch panels stayed visible when anchor text scrolled out of view
- Date discovered: 2026-05-08
- Date fixed: 2026-05-08
- Agent: Claude (Sonnet 4.6)
- Symptom: With two branches open, only one was visible at a time. Scrolling did not hide/show branch panels in sync with their anchor text. Expanded (non-collapsed) branches remained on screen even when their anchor had scrolled fully out of the viewport.
- Root cause: The `source-out` visibility condition in `layoutBranches` was gated on `b.collapsed &&` — only collapsed branches were hidden when their anchor left the viewport. Expanded branches were never assigned `source-out`, so they always remained visible regardless of scroll position.
- Fix: Removed the `b.collapsed &&` guard. All branches (collapsed and expanded) now receive `source-out` when their anchor rect is outside the visible rail. The existing `window.addEventListener('scroll', scheduleBranchLayout)` already fires `layoutBranches` on every scroll, so visibility updates happen in real time.
- Files touched: `notlinear.html`, `BUGS.md`, `CHANGELOG.md`
- Manual test case:
  1. Create two branches from different highlights that are vertically separated in the doc.
  2. Scroll so both anchor texts are visible — both branch panels should be visible.
  3. Scroll down until the first anchor is out of view — its panel should disappear.
  4. Scroll back up until it re-enters view — its panel should reappear.
- Related: none.

---

## Resolved bugs (continued)

### #018 — DeepSeek tool-result fallback was placed in the wrong function
- Date discovered: 2026-05-08
- Date fixed: 2026-05-08
- Agent: Claude (Sonnet 4.6)
- Symptom: Branch search with DeepSeek kept spinning or showed a tiny partial response even after search results returned. The `completeWithToolFallback` salvage path (bug #017 fix) never fired for DeepSeek because it was accidentally defined inside `callClaude`, not `callDeepSeek`. Inside `callClaude` it referenced `lastToolResults`, `totalCacheHit`, and `toolRoundCount` — variables only defined in `callDeepSeek` — so it always returned false immediately.
- Root cause: Bug #017 fix added `safeAbortReason` and `completeWithToolFallback` into `callClaude`'s scope and updated `callClaude.reportAbort` to call them. It never added these helpers to `callDeepSeek` or updated `callDeepSeek.reportAbort` to call `completeWithToolFallback`. Evidence: `provider:'deepseek'` and `tools.map(t => t.function?.name)` (OpenAI tool format) in the code placed inside `callClaude` confirmed the copy-paste target was wrong.
- Fix: Removed `completeWithToolFallback` from `callClaude` (kept `safeAbortReason` for abort-reason logging). Added `safeAbortReason` and `completeWithToolFallback` inside `callDeepSeek` where all referenced variables (`lastToolResults`, `totalCacheHit`, `toolRoundCount`, etc.) are actually in scope. Updated `callDeepSeek.reportAbort` to call `completeWithToolFallback` before falling through to the abort path.
- Files touched: `notlinear.html`, `BUGS.md`, `CHANGELOG.md`
- Manual test case:
  1. Open a branch with DeepSeek and Serper configured.
  2. Ask a search-backed question.
  3. While DeepSeek synthesis is streaming, close the branch panel OR click stop.
  4. Confirm the branch shows retrieved tool results instead of a tiny partial or a permanent spinner.
- Related: #012, #015, #016, #017.

### #019 — Branch search aborted when panel is closed or another branch opens
- Date discovered: 2026-05-08
- Date fixed: 2026-05-08
- Agent: Claude (Sonnet 4.6)
- Symptom: Closing a branch panel or opening a second branch while a DeepSeek search was in progress aborted the in-flight search, discarding all retrieved tool results.
- Root cause: `closeBranch` called `b.controller?.abort('branch_closed')` and `closeOtherBranches` called `b.controller?.abort('other_branch_opened')` on any streaming branch. This was originally a cleanup measure, but it prevented background search completion.
- Fix: Removed the abort calls from `closeBranch` and `closeOtherBranches`. Explicit deletion (`removeOpenBranchImmediately`) still aborts to avoid orphaned requests for permanently-deleted branches. `captureBranchSnapshot` now accepts a `branch` option so `onDone`/`onError`/`onAbort` can save snapshots even after `branches[id]` is removed from the registry. All three callbacks in `runBranchTurn` pass `{ branch: b }` to ensure background-completed searches are persisted correctly.
- Files touched: `notlinear.html`, `BUGS.md`, `CHANGELOG.md`
- Manual test case:
  1. Open a branch with DeepSeek and start a search-backed question.
  2. While search tools are running, close the branch panel.
  3. Wait for the search to complete (check runtime logs).
  4. Reopen the branch — confirm the answer is present, not empty.
  5. Repeat step 2 but by opening a different branch instead of closing — same result.

---

## Resolved bugs

### #001 — Branch answer Markdown collapsed into dense paragraphs
- Date discovered: before 2026-05-07
- Date fixed: 2026-05-07
- Agent: Codex
- Symptom: Compact model output in branch answers ran multiple numbered items and field labels together in a single paragraph instead of separating them onto their own lines.
- Root cause: The branch Markdown rendering path did not normalize compact model output before passing it to `renderMarkdown`, so adjacent numbered items and `Label:` field markers were not split onto separate lines.
- Fix: Added/extended a normalization step (see `normalizeMarkdownForDisplay`) in the branch render path so numbered items and field labels each begin on their own line before Markdown parsing.
- Files touched: `notlinear.html`, `CHANGELOG.md`
- Manual test case:
  1. Open any branch.
  2. Send a prompt that produces a list with field labels (e.g., "list 3 competitors with Model, Funding, Focus").
  3. Confirm each numbered item starts on its own line and each field label is on its own line.
- Related: none.

### #002 — Branch markers inside branch panels did not reopen child branches
- Date discovered: before 2026-05-07
- Date fixed: 2026-05-07
- Agent: Codex
- Symptom: Clicking a branch marker inside an already-open branch panel did nothing for child or nested-child branches.
- Root cause: After branch panels were made single-instance (#004), the click handler for branch markers inside panels did not correctly resolve nested branch IDs, so the open path bailed out for non-root branches.
- Fix: Updated the marker click handling so nested branch IDs are resolved against the same registry used by `openBranch`, and the panel switches to the target branch instead of being suppressed.
- Files touched: `notlinear.html`, `CHANGELOG.md`
- Manual test case:
  1. Open a branch from a highlight in the main chat.
  2. Inside that branch, highlight text and create a child branch.
  3. Inside the child, create a nested child branch.
  4. Close all panels, then click the original branch marker — open.
  5. Click the child marker inside the panel — opens.
  6. Click the nested child marker — opens.
- Related: #003, #004.

### #003 — Diagonal-only branch resize was insufficient
- Date discovered: before 2026-05-07
- Date fixed: 2026-05-07
- Agent: Codex
- Symptom: Branch panels could only be resized via a single diagonal grip; users could not resize from the top edge, side, or other corners.
- Root cause: Resize was implemented with one corner handle. There were no edge or directional handles.
- Fix: Replaced the single grip with directional edge and corner handles; resizing logic in `wireBranchResize` and `setBranchSize` now respects `branchResizeBounds` for each direction.
- Files touched: `notlinear.html`, `CHANGELOG.md`
- Manual test case:
  1. Open a branch panel.
  2. Drag from the top edge — panel grows upward.
  3. Drag from the bottom edge — panel grows downward.
  4. Drag from a side — panel grows sideways.
  5. Drag from each corner — panel grows in two axes.
- Related: #004.

### #004 — Multiple panels for the same branch and excess modal whitespace
- Date discovered: before 2026-05-07
- Date fixed: 2026-05-07
- Agent: Codex
- Symptom: Opening a branch that was already open created a duplicate panel; the default branch modal had large empty regions.
- Root cause: `openBranch` did not check for an existing panel for the same branch ID; modal CSS used loose default sizing.
- Fix: Made branch panels single-instance — `openBranch` now reuses the existing panel for a branch ID if one is open. Tightened default branch modal spacing.
- Files touched: `notlinear.html`, `CHANGELOG.md`
- Manual test case:
  1. Open a branch from the main chat.
  2. Click the same branch marker again — focus moves to the existing panel; no duplicate is created.
  3. Open a fresh branch — its initial size has no excess top/bottom whitespace.
- Related: #002, #003. Note: this fix introduced #002 and required #003.

### #005 — No way to delete a branch
- Date discovered: before 2026-05-07
- Date fixed: 2026-05-07
- Agent: Codex
- Symptom: Users could create branches but had no way to remove them; deleted-feeling branches still appeared in the Recent branches sidebar and the context tree.
- Root cause: No deletion path existed. Once a branch was created, its records persisted indefinitely.
- Fix: Added branch deletion entry points from branch panels, the Recent branches sidebar, and the context tree. `deleteBranch` removes the open panel, the branch records, and any persisted recents entry. Persistence is updated via `removeBranchRecords` and `persistAll`.
- Files touched: `notlinear.html`, `CHANGELOG.md`
- Manual test case:
  1. Create a branch from the main chat.
  2. Delete it from the branch panel — panel closes, branch disappears from Recent branches and context tree.
  3. Reload the page — branch does not return.
  4. Repeat from the Recent branches sidebar — same result.
  5. Repeat from the context tree — same result.
- Related: none.

### #006 — Recent branches sidebar list was static
- Date discovered: before 2026-05-07
- Date fixed: 2026-05-07
- Agent: Codex
- Symptom: The Recent branches sidebar showed hardcoded placeholder rows; clicking them did not open the user's actual branches.
- Root cause: The sidebar was rendered with static markup; there was no persisted recents list and no click handler that resolved to a real branch.
- Fix: Replaced static rows with a dynamic list backed by `rememberBranchRecent` and persisted state. Clicking a row calls `openBranch` with the saved branch ID.
- Files touched: `notlinear.html`, `CHANGELOG.md`
- Manual test case:
  1. Open three branches across two different chats.
  2. Open the sidebar — Recent branches lists those three, most-recent first.
  3. Click any row — the correct branch opens.
  4. Reload — the list and click behavior are preserved.
- Related: #005.

### #007 — In-app changelog viewer could not read CHANGELOG.md
- Date discovered: before 2026-05-07
- Date fixed: 2026-05-07
- Agent: Codex
- Symptom: The settings panel changelog viewer was empty when the app was opened from the local filesystem because `fetch('CHANGELOG.md')` is blocked under `file://`.
- Root cause: The viewer relied solely on a network fetch of the file, which fails under `file://` origins.
- Fix: Added a bundled `FALLBACK_CHANGELOG_MD` constant. The viewer attempts to fetch the live file first and falls back to the bundled copy when the fetch fails.
- Files touched: `notlinear.html`, `CHANGELOG.md`
- Manual test case:
  1. Open `notlinear.html` directly from disk (double-click, `file://` URL).
  2. Open Settings → Changelog viewer.
  3. Confirm changelog content renders (from the fallback).
  4. Open the same file via a local web server — confirm the live file is read.
- Related: none.

### #008 — Branch chat content lost when switching chats
- Date discovered: before 2026-05-07
- Date fixed: 2026-05-07
- Agent: Codex
- Symptom: A branch with sent messages would lose its conversation content when the user switched to a different chat and came back.
- Root cause: The chat-switch path did not call the snapshot routine for branches with persistable content, so the in-memory branch state was discarded before being saved.
- Fix: Snapshot all open branches with persistable content before switching chats. Uses `branchHasPersistableContent` and `captureBranchSnapshot`; called via `syncOpenBranchSnapshots` on the switch path.
- Files touched: `notlinear.html`, `CHANGELOG.md`
- Manual test case:
  1. Open a branch in chat A and send a message that gets a response.
  2. Switch to chat B.
  3. Switch back to chat A and reopen the branch.
  4. Confirm both the user message and the response are still present.
- Related: #009.

### #009 — Quote-only branch reopen overwrote saved branch content
- Date discovered: before 2026-05-07
- Date fixed: 2026-05-07
- Agent: Codex
- Symptom: Reopening a branch via a quote-only flow (no fresh prompt) erased the previously saved branch conversation.
- Root cause: The reopen path treated quote-only entry as a fresh branch and reset the branch state instead of restoring from the saved snapshot.
- Fix: Quote-only reopen flows now check for an existing branch snapshot via `applyBranchSnapshot` before initializing fresh state. `snapshotHasPersistableContent` gates whether the snapshot is preferred over a reset.
- Files touched: `notlinear.html`, `CHANGELOG.md`
- Manual test case:
  1. Create a branch from a highlight, send messages.
  2. Close the branch panel.
  3. Reopen the same branch via the original highlight (quote-only path).
  4. Confirm prior messages are restored, not erased.
- Related: #008.

### #010 — Branch research was slow on broad entity questions
- Date discovered: before 2026-05-07
- Date fixed: 2026-05-07
- Agent: Codex
- Symptom: Broad branch prompts ("tell me more", "what about X") spent excessive time fetching full pages instead of returning quick search snippets.
- Root cause: The system prompt did not steer the model toward snippet-first behavior for broad entity questions, and tool timeouts were too generous, letting slow scrapes block responses.
- Fix: Updated `buildSystemPrompt` guidance for broad branch prompts to prefer search snippets first. Shortened external tool timeouts (`SEARCH_TIMEOUT_MS`, `PAGE_READ_TIMEOUT_MS`, `SCRAPE_TIMEOUT_MS`).
- Files touched: `notlinear.html`, `CHANGELOG.md`
- Manual test case:
  1. Open a branch from any highlight.
  2. Send "tell me more" with no other context.
  3. Confirm the model uses a search tool first and responds within ~12s rather than fetching a full page.
- Related: none.

### #011 — Branch search status kept spinning after answer text started
- Date discovered: 2026-05-07
- Date fixed: 2026-05-07
- Agent: Codex
- Symptom: Branch responses that used search showed a continuing "Sleuthing" or "Synthesizing Thinking" spinner above the answer, making it look like search was still stuck even after the answer text had begun streaming.
- Root cause: `streamInto` stopped the working-status timer when text deltas arrived but did not clear the existing `.ai-status` DOM. The compact status markup stayed visible until the model call fully finished, and its CSS spinner continued animating.
- Fix: Updated `streamInto` to clear the active AI status via `setAiStatus(turnEl, null)` before rendering the first streamed answer delta. This keeps the shared main, inline, and branch rendering path consistent without changing tool execution or branch persistence.
- Files touched: `notlinear.html`, `BUGS.md`, `CHANGELOG.md`
- Manual test case:
  1. Open a branch from a highlighted passage.
  2. Ask a search-backed question such as "what are the economics of this?"
  3. Confirm the branch may show a search/synthesis status while tools run.
  4. Confirm that status line clears as soon as answer text starts streaming, with no stale spinner left above the response.
- Related: #010.

### #012 — Branch search results were hidden when DeepSeek synthesis stalled
- Date discovered: 2026-05-07
- Date fixed: 2026-05-07
- Agent: Codex
- Symptom: Branch searches could appear to spin forever after the search provider returned results because the UI waited on DeepSeek's follow-up synthesis call and did not show the retrieved results.
- Root cause: `callDeepSeek` treated the post-tool model request the same as any other model stream, using the generic 120s stream idle timeout and only surfacing output if DeepSeek produced final answer text. Tool results were kept only in `currentMessages`, so if the second stream stalled before text deltas, the branch had no visible fallback despite successful search execution.
- Fix: Added a shorter post-tool synthesis idle timeout and retained the latest tool results in `callDeepSeek`. If DeepSeek stalls before producing synthesis text, the branch now renders a fallback answer with the retrieved tool results instead of continuing to spin.
- Files touched: `notlinear.html`, `BUGS.md`, `CHANGELOG.md`
- Manual test case:
  1. Open a branch from a highlighted passage with DeepSeek configured.
  2. Ask a current/search-backed question such as "what are the economics of this?"
  3. If search succeeds but DeepSeek does not emit final answer text, wait up to 30 seconds.
  4. Confirm the branch shows "Search completed..." with the retrieved results instead of remaining on a spinner.
- Related: #010, #011.

### #013 — Nested branch opened at one level too shallow
- Date discovered: 2026-05-07
- Date fixed: 2026-05-07
- Agent: Codex
- Symptom: A fourth-level nested branch could appear in the correct parent position in the context tree but show `↳ 3` in the branch panel header.
- Root cause: `branchRowsForThread` merged persisted `depth` values without recalculating them from `parentBid`, and branch open/restore paths trusted those stale values. `applyBranchSnapshot` could then overwrite a correct live depth with an older `snap.depth`.
- Fix: Normalize branch row depths from the `parentBid` chain before rendering/opening context rows. `openBranch` now prefers live parent-derived depth over a supplied override, and `applyBranchSnapshot` no longer lowers an already-correct depth from a stale snapshot.
- Files touched: `notlinear.html`, `BUGS.md`, `CHANGELOG.md`
- Manual test case:
  1. Create a branch from the main page, then create three nested child branches from inside branch panels.
  2. Open the context panel and click the deepest child branch.
  3. Confirm the deepest branch panel header shows `↳ 4`, not `↳ 3`.
  4. Close and reopen the same branch from the context tree or recent branches, and confirm it still shows `↳ 4`.
- Related: #002, #005, #006.

### #014 — Branch URL reads could hang after response headers
- Date discovered: 2026-05-07
- Date fixed: 2026-05-07
- Agent: Codex
- Symptom: Branch research could remain stuck on a status like "Reading closely https://..." after the model chose `fetch_url`, even though tool timeouts existed.
- Root cause: `loggedFetch` applied timeouts only to the initial `fetch()` call. Once headers arrived, `runFetchUrl` called `res.text()` with no timeout, and search/scrape runners called `res.json()` with no timeout. A provider could therefore stall while streaming the response body and leave the branch waiting indefinitely.
- Fix: Added timeout-aware response body readers and routed `fetch_url`, Wikipedia, SearXNG, Serper, Firecrawl, and logged error-body reads through them. Body read starts, ends, and errors are also logged in the runtime log.
- Files touched: `notlinear.html`, `BUGS.md`, `CHANGELOG.md`
- Manual test case:
  1. Open a branch and ask a question that makes the model read a page URL.
  2. If the URL provider returns headers but stalls on the body, wait for the page-read timeout.
  3. Confirm the branch leaves "Reading closely" and continues with a tool error or fallback instead of spinning indefinitely.
- Related: #010, #012.

### #015 — DeepSeek branch research kept searching instead of synthesizing
- Date discovered: 2026-05-08
- Date fixed: 2026-05-08
- Agent: Codex
- Symptom: Branch research appeared stuck while the status kept showing search/read activity even though Serper and page reads were succeeding.
- Root cause: `callDeepSeek` allowed DeepSeek to keep choosing more search and fetch tools until the generic 10-turn tool limit. Logs showed successful Serper 200s, successful body reads, repeated follow-up DeepSeek requests, and then `Reached the 10-turn tool use limit`.
- Fix: Added a bounded DeepSeek tool-round counter. DeepSeek can now perform at most two research tool rounds before the app sends a synthesis-only model request with tools omitted.
- Files touched: `notlinear.html`, `BUGS.md`, `CHANGELOG.md`
- Manual test case:
  1. Open a branch with DeepSeek and Serper configured.
  2. Ask a broad current-information question such as "Tell me more about their product lines".
  3. Confirm the runtime logs show at most two tool rounds for that branch run before a final DeepSeek request without tools.
  4. Confirm the branch produces an answer or the existing synthesis fallback instead of reaching the 10-turn tool use limit.
- Related: #010, #011, #012, #014.

### #016 — DeepSeek pseudo-tool markup leaked into branch answers
- Date discovered: 2026-05-08
- Date fixed: 2026-05-08
- Agent: Codex
- Symptom: A branch answer displayed raw DeepSeek DSML/tool-call markup such as `tool_calls`, `invoke`, `fetch_url`, and `serper_search` instead of hiding or executing it.
- Root cause: `callDeepSeek` streamed `delta.content` directly into the visible answer. When DeepSeek emitted pseudo-tool-call markup as plain content, especially during synthesis-only requests after tool limits, the renderer treated it as normal assistant text.
- Fix: Added a DeepSeek content filter that suppresses streamed DSML-style pseudo-tool-call blocks before they reach `onDelta`. The forced synthesis request now also includes an explicit no-tool-markup instruction, and if filtered pseudo-tool markup leaves too little visible answer text, the app falls back to showing retrieved tool results.
- Files touched: `notlinear.html`, `BUGS.md`, `CHANGELOG.md`
- Manual test case:
  1. Open a DeepSeek branch and ask a search-backed question that previously produced raw `tool_calls` markup.
  2. Confirm no `DSML`, `tool_calls`, `invoke`, `fetch_url`, or `serper_search` markup appears in the visible answer.
  3. Confirm the branch either synthesizes normally or shows the retrieved-results fallback.
- Related: #012, #015.

### #017 — DeepSeek synthesis aborts lost successful tool results
- Date discovered: 2026-05-08
- Date fixed: 2026-05-08
- Agent: Codex
- Symptom: Runtime logs showed successful Serper/fetch tool results followed by a final no-tools DeepSeek synthesis request that was locally aborted, leaving only a tiny partial answer such as 45 characters.
- Root cause: `callDeepSeek` treated all aborts the same. If a local abort happened after tool results were already available but before the synthesis stream completed, the branch went through the normal stopped-response path instead of surfacing the retrieved-results fallback.
- Fix: Added abort-reason logging and a DeepSeek abort salvage path. When a post-tool synthesis request aborts before producing a substantial answer, the app now completes the turn with the retrieved-results fallback instead of preserving a nearly empty partial response.
- Files touched: `notlinear.html`, `BUGS.md`, `CHANGELOG.md`
- Manual test case:
  1. Start a DeepSeek branch question that performs search/read tools.
  2. Abort the branch during the final synthesis request after tool results have returned.
  3. Confirm the runtime log records an `abortReason`.
  4. Confirm the branch shows the retrieved-results fallback rather than a tiny stopped partial answer.
- Related: #012, #015, #016.

### #024 — Toasts hidden behind the Coding Projects overlay
- Date discovered: 2026-05-26
- Date fixed: 2026-05-26
- Agent: Claude (Opus 4.7)
- Symptom: In the Coding Projects view, actions that should toast (browse/add folder, icon updated, comment deleted, "restart the server") appeared to do nothing — no feedback. Made the "open folder" browse button seem broken.
- Root cause: `.toast` is `z-index:300`, but the Coding Projects overlay `#cp-screen` is `z-index:400` (matches `.project-screen`). Any toast fired while the overlay is open renders *behind* it and is invisible. Introduced with the CP02 overlay; surfaced in CP07 when the browse button's "restart the server" toast couldn't be seen.
- Fix: Raised `.toast` `z-index` from 300 → 500 in `frontend/styles/base.css` so toasts always sit above the overlay (400) and other panels. Global change; benefits chat too.
- Files touched: `frontend/styles/base.css`, `BUGS.md`, `CHANGELOG.md`, `docs/project-notes/`
- Manual test case:
  1. Open Coding Projects; click "+ add folder" → browse, or add a project, or update an emoji.
  2. Confirm the toast (e.g. "added <name>", "icon updated") is visible above the overlay.
  3. In chat, trigger a toast (e.g. copy as quote) and confirm it still shows normally.
- Related: separate from the stale-server 404 (that needs a `backend/server.py` restart, not a code fix).

### #025 — "create" buttons on missing-file blocks rendered as clipped 32px squares
- Date discovered: 2026-05-26
- Date fixed: 2026-05-26
- Agent: Claude (Opus 4.7)
- Symptom: On a Coding Projects project page, the "create" buttons in the bugs/tasks/changelog/overview missing-file blocks looked misaligned/broken — the text spilled out of a tiny square border. Most visible when a scan failed (all four blocks showed the missing-file state at once).
- Root cause: `blockHtml` gave the create button class `cp-btn ghost cp-create`. The `ghost` modifier is the **icon-only square** variant — `.cp-btn.ghost{width:32px;padding:0;justify-content:center}` (used by the rescan icon button). Applied to a text button ("create"), it forced a 32px-wide box with the label overflowing the border. `.cp-create{height:26px;margin-left:auto}` could not correct the width because `.cp-btn.ghost` (specificity 0,2,0) outranks `.cp-create` (0,1,0).
- Fix: Dropped `ghost` from that button (`cp-btn ghost cp-create` → `cp-btn cp-create`) in `frontend/views/coding-projects.js`. It now uses the base `.cp-btn` (auto width, `padding:0 12px`) with `.cp-create`'s `height:26px;margin-left:auto`, rendering a properly sized right-aligned text button. No CSS changed.
- Files touched: `frontend/views/coding-projects.js`, `BUGS.md`, `CHANGELOG.md`, `docs/project-notes/`
- Manual test case:
  1. Open a Coding Projects project that is missing at least one of readme/changelog/bugs/tasks.
  2. Confirm the "create" button in each missing block is a normal pill-sized button with the label inside its border, right-aligned in the dashed row — not a clipped square.
- Related: stale-server 404 / #024 (the "scan failed" state that surfaced all four buttons at once is a separate operational issue — restart `backend/server.py`).

### #022 — Highlights panel text was unreadable in light mode
- Date discovered: 2026-05-09
- Date fixed: 2026-05-09
- Agent: Kimi (k2.6)
- Symptom: In the Highlights panel (right-hand drawer), saved highlight text appeared as very light gray on a light background when the app was in light mode, making it nearly impossible to read.
- Root cause: `.highlight-text` had a hardcoded `color:#EAEAEA` instead of using the theme-aware CSS variable `var(--text)`. `#EAEAEA` is designed for dark backgrounds and becomes invisible on light backgrounds.
- Fix: Replaced the hardcoded `#EAEAEA` with `color:var(--text)` so the highlight text color adapts correctly to both dark and light themes.
- Files touched: `notlinear.html`, `BUGS.md`, `CHANGELOG.md`
- Manual test case:
  1. Switch the app to light mode.
  2. Open any chat and highlight some text to save it.
  3. Open the Highlights panel via the topbar button.
  4. Confirm the saved highlight text is clearly readable against the light panel background.
  5. Switch back to dark mode and confirm the text is still readable there.
- Related: none.

### #021 — Attach menu "Add files / Add folder" did not open file picker in WKWebView
- Date discovered: 2026-05-08
- Date fixed: 2026-05-08
- Agent: Kimi (k2.6)
- Symptom: Clicking "Add files" or "Add folder" in the attach popup menu did nothing — no macOS file picker dialog appeared.
- Root cause: The attach menu click handler called `.click()` on pre-existing `<input type="file">` elements that were hidden with `style="display:none"`. WebKit / WKWebView blocks programmatic `.click()` on file inputs hidden via `display:none` as a security measure. The browser silently ignored the call.
- Fix: Replaced the static hidden file input approach with a `triggerFilePicker` helper that dynamically creates a fresh `<input type="file">` element, appends it to `document.body`, calls `.click()` synchronously within the same user gesture, and removes the element after the `change` event fires. This pattern is the most reliable way to open file pickers in WKWebView because the input is guaranteed to be in the DOM and technically visible at the moment `.click()` is invoked.
- Files touched: `notlinear.html`, `BUGS.md`, `CHANGELOG.md`
- Manual test case:
  1. Open Notlinear in the native macOS app (WKWebView).
  2. Click the `+` attach button in the main chat input.
  3. Click "Add files" — confirm the native file picker opens.
  4. Click the `+` attach button again.
  5. Click "Add folder" — confirm the native folder picker opens.
  6. Repeat inside a branch panel — both options should still open the picker.
- Related: none.
