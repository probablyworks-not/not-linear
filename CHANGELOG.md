# Changelog

All notable repository changes made by AI agents should be recorded here.

## 2026-10-04

- Agent: Claude Opus 5
- Summary: P2a — the backend moves from a 949-line stdlib `http.server` to FastAPI in `backend/app/`, and static serving becomes an explicit allowlist instead of serving the whole repository.
- Files changed: `backend/app/**` (new), `backend/server.py` (now a shim), `backend/server_legacy.py` (the old implementation, retained as the test oracle), `tests/contract/**`, `requirements.txt` (new), `.github/workflows/ci.yml`, `README.md`, `docs/project-notes/DECISIONS.md`.
- Behavior changes: `GET /BUGS.md`, `/logs.md`, `/uploads/`, `/docs/project-notes/*`, `/backend/*` and every other repo file now 404 — previously the entire repository was served over HTTP. The twelve `/__notlinear_*` endpoints are unchanged and pinned by tests running against both servers. The app now has runtime dependencies: `pip install -r requirements.txt` is a required setup step, though `backend/server.py` re-execs into a repo `.venv` automatically so the launchers keep working, and `--legacy` still runs the old dependency-free server.
- Observed: two regressions caught only by exercising the real entry points rather than the test suite. The first allowlist omitted `/notlinear.html`, which is the URL the compiled `Notlinear.app` binary loads (confirmed with `strings`), so the desktop app rendered a 404. And the venv re-exec initially never fired, because `.venv/bin/python` is a symlink that `Path.resolve()` follows back to the base interpreter, making the "already in the venv" guard compare equal — fixed by comparing `sys.prefix`. Separately, transcribing constants during the "verbatim" move drifted twice: `LINK_PREVIEW_TIMEOUT_S` became 8 when the real value is 6, and the `CP_*` scan caps were dropped entirely; both were caught by the parity tests, not by review.
- Verification: the same 32 contract tests pass against `NOTLINEAR_SERVER=legacy` and `=fastapi`; 26 service parity tests diff the moved functions against the originals in one process; 21 new exposure tests; 13 Playwright tests pass against the FastAPI server; vitest and typecheck clean. The server was started with `/usr/bin/python3`, Homebrew `python3` and the venv's own interpreter to confirm the re-exec works from each and does not loop. Full 10-step human smoke test still NOT run.

- Agent: Claude Opus 5
- Summary: P1 safety net. 82 automated tests where there were none: a differential schema oracle, backend contract tests for all 12 endpoints, and a Playwright smoke suite against the legacy app with providers mocked. CI runs all three on every pull request.
- Files changed: `web/**` (new: scaffold, `src/db/{types,chat,notes,keypaths}.ts`, `tests/schema/*`, `tests/e2e/*`, `scripts/backup-to-fixture.mjs`), `tests/contract/*` (new), `.github/workflows/ci.yml` (new), `requirements-dev.txt` (new), `pytest.ini` (new), `.gitignore`, `tools/_backup-lib.js`.
- Behavior changes: none. P1 adds no production code — `frontend/` and `backend/server.py` are untouched apart from a counting fix in the P-1 backup tool.
- Observed: the schema oracle initially did NOT catch a Dexie version bump — all 24 oracle tests stayed green with `version(1)` changed to `version(2)`, because a fresh test database opens happily at any version. Added explicit `db.verno`/store-name assertions, which now fail on it. Also found `projects` is an object keyed by id, not an array, so the P-1 backup summary would have reported 0 projects for every real backup; fixed. Three initial Playwright failures were all wrong assumptions in the tests, not app bugs: `applyTheme` treats `prefs.theme` as the source of truth and overwrites `nl_theme`; the sidebar ships collapsed so thread rows are not clickable until it is opened; and the search palette hides via opacity, so its input reads as "visible" even when closed.
- Verification: 40 vitest (37 pass, 3 skipped pending a real-data fixture), 32 pytest contract tests, 13 Playwright tests — all green, and each CI command run locally exactly as CI invokes it. The oracle was mutation-tested: dropping a field, renaming the store and bumping the version are all now detected. Contract tests verified not to touch the real `logs.md` or `feedback/FEEDBACK.md` — but only after they did: the first run, before `FEEDBACK_PATH` was isolated, appended a stub `FB-001` entry to the real feedback log (`test_every_documented_endpoint_exists` POSTs to all 12 endpoints, including `feedback_save`). Reverted, isolation extended, and re-verified by hashing `logs.md`, `FEEDBACK.md` and the media file count across a full run.

- Agent: Claude Opus 5
- Summary: P0 repo and dev hygiene. Closed a live CORS hole, added `.gitignore`, untracked user content and build artifacts, removed every hardcoded `/Users/yash` path from the launchers, corrected docs pointing at a PRD that does not exist, and fixed a duplicate ADR ID.
- Files changed: `backend/server.py`, `.gitignore` (new), `launchers/{Notlinear.command,build-macos-app.command,Notlinear.applescript,NotlinearNative.m,NotlinearNative.swift}`, `README.md`, `AGENTS.md`, `CLAUDE.md`, `plan.md`, `frontend/core/store.js`, `frontend/views/notes.js`, `docs/project-notes/DECISIONS.md`.
- Behavior changes: `Access-Control-Allow-Origin: *` is gone. The server now echoes the allow header only for the exact loopback origin it is bound to, always sends `Vary: Origin`, and answers a preflight from any other origin with 403. Same-origin calls (the app, and the WKWebView shell) are unaffected. The shell and AppleScript launchers now locate the repo by walking up to `backend/server.py`; `Notlinear.app` takes its path from `NOTLINEAR_ROOT` (env, then compiled in by the build script, then a bundle walk).
- Observed: the old wildcard was live and exploitable — any site visited while Notlinear ran could POST to `/__notlinear_open_files`, pass the preflight, open a native picker, and read the chosen file's bytes; `save_file` and `scan_project` were reachable the same way. The comment at `server.py:548` justified it by loopback binding, which only stops other machines, not other pages in the user's own browser. Also confirmed `notes_product.md` was never committed and is not on disk, though `AGENTS.md` and `CLAUDE.md` still told agents to read it.
- Verification: `py_compile` + `node --check` + `zsh -n` + `osacompile` all clean; server boots and serves `/frontend/index.html`, `/notlinear.html`, `/CHANGELOG.md`, `/tools/export-data.html` (all 200); attacker-origin preflight 403, app-origin preflight 200; root discovery tested from a relocated copy, an orphaned copy and the real repo; `NotlinearNative.m` compiles both with and without `-DNOTLINEAR_ROOT`. Full 10-step human smoke test NOT yet run. `git gc` deliberately not run — awaiting approval.

- Agent: Claude Opus 5
- Summary: Backup tools corrected after the user found the desktop app and the browser show completely different data. The desktop app is a WKWebView whose storage lives in its own container, so it, Chrome and Safari each hold a separate copy of both databases despite all three loading `http://127.0.0.1:8765`.
- Files changed: `tools/_backup-lib.js`, `tools/export-data.html`, `tools/import-data.html`, docs/project-notes.
- Behavior changes: the export page now reports which storage realm it is running in, records it in the backup file, and warns on restore when a file came from a different realm. Saving now uses the same four-tier cascade as `frontend/app.js:738` (WKWebView bridge → `/__notlinear_save_file` → File System Access → blob), because a plain blob download does nothing inside the desktop app. Added a raw-JSON escape hatch for when every save route fails silently.
- Observed: real data confirmed at `~/Library/WebKit/local.notlinear.app/WebsiteData/Default/<salt>/<salt>/IndexedDB/` (two hashed database dirs, 52 MB total). The shipped `Notlinear.app` binary loads `http://127.0.0.1:8765/notlinear.html` and sets no web inspector.
- Verification: `node --check` clean; all three paths HTTP 200 on a test port. The desktop-app export path is NOT yet exercised — no backup has been taken in the app.

- Agent: Claude Opus 5
- Summary: Added `tools/export-data.html` and `tools/import-data.html` — a standalone backup/restore pair for both IndexedDB databases and all of localStorage. Phase P-1 of the React/FastAPI refactor plan; nothing else in that plan starts until a backup has been taken and restored once.
- Files changed: `tools/_backup-lib.js` (new), `tools/export-data.html` (new), `tools/import-data.html` (new), docs/project-notes.
- Behavior changes: none to the app. No app file was touched, no schema read or written outside the existing `kv` stores, and no Dexie version declared anywhere.
- Observed: the repo had no export of any kind, so all chat threads, branches, highlights and notes existed only in one browser profile with no second copy.
- Verification: `node --check` clean on all three scripts; all four paths served HTTP 200 on a test port with `_backup-lib.js` as `text/javascript`; `summarize`/`validateBackup` unit-checked headlessly (7/7 cases, counts correct against a synthetic app-shaped backup). Browser round-trip (export, then restore into a fresh profile) is a human step and is NOT yet done.

- Agent: Claude Sonnet 5.5
- Summary: README rewritten to document browser mode (macOS/Windows/Linux) alongside the macOS app, with platform differences, data location and troubleshooting. AGENTS.md "Manual" run line now points at `backend/server.py`.
- Files changed: `README.md`, `AGENTS.md`, docs/project-notes.
- Verification: server started on a test port and served `frontend/index.html` (HTTP 200). Not smoke-tested on Windows/Linux.

- Agent: Claude Sonnet 5.5
- Summary: Fixed OpenAI 400 error — `callOpenAICompatible` now sends `max_completion_tokens` for OpenAI (Gemini keeps `max_tokens`). BUGS.md #052.
- Files changed: `frontend/providers/openai.js`, `BUGS.md`
- Verification: `node --check` clean; not tested against the live OpenAI API.

- Agent: Claude Sonnet 5.5
- Summary: Conversation modes are now user-editable. New "New / manage modes" entry in the mode menu opens a modal to view, create, edit, reset and delete modes (each is only a system prompt).
- Files changed: `frontend/core/modes.js` (new), `frontend/views/modes-modal.js` (new), `frontend/app.js`, `frontend/index.html`, `frontend/core/{state,store}.js`, `frontend/providers/tools.js`, `frontend/styles/base.css`, `FEATURES.md`, docs/project-notes.
- Behavior changes: the six built-in modes live in `core/modes.js`; edits are stored as overrides (`prefs.modeOverrides`), custom modes in `prefs.customModes` (both inside the existing `kv:'state'` blob — no Dexie schema change). `modeSystemPromptParts` is re-exported from `providers/tools.js`, so app.js and Notes callers are unchanged. Deleting the active custom mode falls back to General.
- Verification: `node --check` clean; headless Playwright: menu lists 6 modes, modal opens, create + select custom mode, persists across reload, zero console errors. Edit/reset/delete paths covered only by a node unit test of `core/modes.js`; human GUI check of those pending.

## 2026-10-03

- Agent: Claude Sonnet 5.5
- Summary: Chat branches now have their own model/provider, independent of the main chat and of each other.
- Files changed: `frontend/app.js`, `BUGS.md`, `FEATURES.md`, docs/project-notes.
- Behavior changes: picking a model from a branch chip changes only that branch; picking from the main composer changes only main. New branches start with the parent branch's (or main's) model. Persisted in branch snapshots (`modelPref`, no schema change). Notes branch panels still follow the main model.
- Verification: `node --check frontend/app.js` only; GUI smoke test by the human pending.

## 2026-09-29

- Agent: Claude Sonnet 5.5
- Summary: Removed the Coding Projects feature from Notlinear at the user's request. Full record of what it was and how to restore it: `docs/coding-projects-archive.md`; final JS/CSS kept in `docs/archive/coding-projects/`.
- Files changed: deleted `frontend/views/coding-projects.js` and `frontend/styles/coding-projects.css`; new `frontend/styles/emoji-picker.css` (shared picker rules `.cp-pop`/`.cp-emoji-*`/`.mg-*` moved out of the deleted CSS, unchanged); `frontend/index.html` and `frontend/index-design.html` (sidebar block, `#cp-screen`/`#cp-drawer`, blank-tab tile removed); `frontend/app.js` (import, init call, tab-strip entry, tile handler); comment-only edits in `frontend/core/*`, `views/notes.js`, `styles/{base,tokens}.css`, `backend/server.py`; `AGENTS.md`, `FEATURES.md`.
- Behavior changes: no Coding Projects sidebar section, overlay, or "Coding projects" blank-tab tile (blank tab now has 4 tiles). Backend `/__notlinear_scan_project` and `/__notlinear_pick_folder` intentionally kept — chat Projects' linked-folder context uses them. Orphaned `nl_cp_*` localStorage keys are left in place.
- Verification: `node --check` on all frontend JS, `python3 -m py_compile backend/server.py`; headless Playwright against `:8765` — app loads with no console errors, no `cp-*` elements, blank tab shows 4 tiles, Notes opens. GUI smoke test by the human still pending.

## 2026-09-24 (2)

- Agent: Claude Sonnet 5
- Summary: Corrected the same-day Context panel redesign — user rejected the flat/quote-only tree and asked for branches to be grouped by which main-chat turn (A→B→C→D) they were branched from, most-recent turn on top, with the turn's user prompt visible on hover. Added `mainTurnId`/`mainTurnPrompt` fields captured at branch-creation time in the selection popover's "branch" handler (only for a top-level branch created by highlighting inside the live `stream`, via the closest `[data-turn-id]` ancestor shared by that turn's user+assistant DOM pair) and threaded through `openBranch`, `captureBranchSnapshot`, `applyBranchSnapshot`, `rememberBranchRecent`, and `mergeBranchRow`'s field whitelist so the linkage survives reload/thread-switch with no new persisted schema/table. `renderCtxPanel` now groups top-level branch rows by `mainTurnId`, sorts groups most-recent-first (via a new `turnTimestamp()` that decodes the ms timestamp already embedded in `makeTurnId()`'s string, so no separate per-turn timestamp field was needed), renders a `.ctx-turn` header per group (truncated prompt visible, full prompt via native `title` hover), and sorts branches within a turn — and within every nested sub-branch level — by `touchedAt` descending. Replaced the old flat `renderBranchRows` with a `renderBranchNode` single-node-plus-recurse helper so recency sorting applies at every depth, not just the top.
- Files changed: `frontend/app.js`, `frontend/styles/base.css`, `FEATURES.md`.
- Behavior changes: the Context panel's branch tree is now grouped under a header per main-chat turn (most recent turn on top, hover shows the full user prompt for that turn), with branches sorted recency-first within each turn and within each nesting level. Branches with no recorded turn (from the static doc, or created before this change) render ungrouped, below any turn groups — unchanged from before.
- Verification: `node --check` on app.js. Live headless Playwright E2E against the real dev server (Anthropic API mocked, zero cost): sent two real main-chat turns, branched from each turn's response through the actual selection-popover UI, and confirmed the Context panel rendered turn 2's group above turn 1's, each with the correct branch nested and the correct hover-title prompt text; also confirmed the pre-existing no-turn demo branches still render correctly with no turn header. Zero console errors. See RUNS.md.

## 2026-09-24

- Agent: Claude Sonnet 5
- Summary: Context panel branch tree redesign — the "Attach branch" picker (`frontend/app.js`'s `renderCtxPanel`/`renderBranchRows`/`buildCtxBranchRow`/`branchTreeRowHTML`) showed only a branch's quote, with no turn count, no content preview, and sub-branch nesting relied on a per-row indentation hack (fixed inline `margin-left` + a disconnected per-row `::before` hook) that was hard to read past 1-2 levels deep. Added a live turn-count badge per row (reusing `branchMessagesFor`), a click-to-expand inline preview of the last 1-2 turn-pairs (new `previewText`/`toggleBranchPreview`, handling both plain-string and Claude content-block-array message shapes), and restructured `renderBranchRows` to nest a parent's children inside a real `.ctx-branch-children` wrapper `<div>` instead of flat sibling rows — this gives collapsible subtrees (new session-only `ctxTreeCollapsed` state) and a continuous CSS `border-left` guide line per depth level "for free," replacing the old per-row hook. Attaching stays whole-branch (no turn-level selection) and no persistence/data-model changes were made.
- Files changed: `frontend/app.js`, `frontend/styles/base.css`, `FEATURES.md`.
- Behavior changes: branch rows in the Context panel now show a turn count and an expandable preview; branches with sub-branches get a collapse/expand chevron; the tree renders with continuous nested guide lines instead of per-row hooks. Attach/open/delete behavior on each row is unchanged.
- Verification: `node --check` on app.js; live headless-browser (Playwright) end-to-end test against the real dev server with the Anthropic API mocked (no real API calls/cost) — created a real parent branch + nested sub-branch via the actual selection-popover → branch UI flow, sent a message in each, confirmed accurate turn counts, correct nesting with visible guide line, working preview toggle (correct You/Assistant text), working collapse chevron (`display:none` on the children wrapper), and zero console errors. See RUNS.md.

## 2026-09-18

- Agent: Claude Sonnet 5
- Summary: Fixed Notes losing indented sub-bullets on copy/export (bug #049). `blocksToText()`/`blocksToMarkdown()` (`frontend/views/notes.js`) only recursed into a block's `children` when the block was a `toggle` — but any block type can carry Tab-indented children (per the existing `indentBlock` comment), so nested bullets/text/etc. under a plain bullet were silently dropped from ⌘C copy and "export as .md". Moved the children recursion out of the toggle-only branch so it runs for every block type.
- Files changed: `frontend/views/notes.js`, `BUGS.md`.
- Behavior changes: ⌘A ⌘A → ⌘C page copy and Markdown export now include indented sub-bullets/children under any block type, not just toggles.
- Verification: `node --check` on notes.js; scripted logic check (see RUNS.md) confirmed a 3-level nested bullet list serializes with correct indentation. Full in-app smoke test (creating an indented bullet in the browser and copy/pasting) not run this session — server wasn't started.

## 2026-09-06

- Agent: Claude Sonnet 5
- Summary: Fixed unreadable code blocks in the chat UI (and Notes' AI-branch replies / Coding Projects file preview, which share the same renderer). Fenced code was previously escaped into a plain flat-gray `<pre><code>` with no syntax highlighting even though `hljs` was already loaded globally and already used elsewhere in the app (Notes' own code-block editor). `core/markdown.js`'s `renderMarkdown()` now wraps each code fence in a `.code-block` with a header (language label + Copy button), and a new `highlightCodeIn(el)` helper runs `hljs` over rendered blocks (called from app.js's streaming `onDone` handlers, table rehydration, and thread restore, plus the equivalent spots in notes.js/coding-projects.js). Added a dedicated `--syn-*` color palette to `tokens.css` (per theme) since the rest of the app's palette is intentionally monochrome, and mapped `hljs-*` classes to it in chat.css/notes.css/coding-projects.css. Added a document-level delegated click handler for the new Copy button (delegated because the block's innerHTML gets fully rebuilt on every streamed delta).
- Files changed: `frontend/core/markdown.js`, `frontend/app.js`, `frontend/views/notes.js`, `frontend/views/coding-projects.js`, `frontend/styles/tokens.css`, `frontend/styles/chat.css`, `frontend/styles/notes.css`, `frontend/styles/coding-projects.css`.
- Behavior changes: fenced code blocks in chat/Notes-branch-replies/Coding-Projects-preview now show real syntax colors (keywords/strings/comments/numbers in distinct hues) instead of flat gray, and get a header bar with a language label and a "Copy" button that copies the code and briefly shows "Copied".
- Verification: `node --check` on all four touched JS files; a scratch Playwright script against the live `:8765` server injected a synthetic assistant code-block message through the app's own render path and confirmed the code-block wrapper, copy button, real hljs syntax-color spans, and working copy-to-clipboard, in both light and dark-mono themes (screenshots reviewed). No new console errors.

## 2026-09-06

- Agent: Claude Sonnet 5
- Summary: Fixed `fetch_url`/`firecrawl_scrape` silently truncating long pages at a fixed head-of-document cutoff (4000/6000 chars, always chars 0–N regardless of where the relevant content sits). Both runners now fetch the full page once, cache the raw text, and return a bounded *window* into it: an optional `offset` param resumes from a given character position, and an optional `query` param jumps the window to center on that term's first match. Every windowed result notes the char range shown and total length so the model knows to call again with `offset` to keep reading, instead of treating truncation as end-of-document. The per-URL cache (previously only in `claude.js`, and only caching the already-truncated string) moved into `tools.js` as a shared `fetchRawTextCached` helper keyed by `${tool}:${url}`, storing the untruncated text — so OpenAI/DeepSeek branches now also get cache reuse across pages/re-reads, and paging through one page never re-hits Jina/Firecrawl.
- Files changed: `frontend/providers/tools.js`, `frontend/providers/claude.js`, `frontend/app.js`.
- Behavior changes: `fetch_url`/`firecrawl_scrape` tool schemas (both the Claude and DeepSeek/OpenAI copies in `app.js`) now accept optional `offset`/`query` params; tool result strings for long pages now end with a `[showing chars X-Y of TOTAL. Call again with offset:Y to continue...]` note instead of `[content truncated]`.
- Verification: `node --check` on all three touched files; confirmed the running `:8765` server serves the updated `app.js` with no syntax errors. Did not exercise a live `fetch_url` call against a real long page in this session (would need a real API key + manual tool-call trigger) — flagging as an item for the user's own smoke pass.

## 2026-08-07

- Agent: Claude Sonnet 5
- Summary: Model-provider version upgrade across Claude, OpenAI, and DeepSeek (not Gemini, per explicit user request), plus expansion of the model picker to 14 selectable tiers (up from 9). Claude: `claude-sonnet-4-6`→`claude-sonnet-5`, `claude-opus-4-8`→`claude-opus-5`; fixed the now-required `thinking:{type:'adaptive'}` shape (the old `budget_tokens` form 400s on the new models). OpenAI: `gpt-4o`→`gpt-5.6-terra`, `gpt-4o-mini`→`gpt-5.6-luna` (GPT-4o is superseded by the GPT-5.6 family). DeepSeek: migrated all six call sites off the retired `deepseek-chat`/`deepseek-reasoner` names (DeepSeek retired them 2026-07-24, before this fix) to `deepseek-v4-flash` with a `thinking` request parameter distinguishing the two former variants — see BUGS.md #044. Added five additional selectable model tiers per user request (additive, not replacing the new defaults): Opus 4.8, Opus 4.5, Sonnet 4.6, Sonnet 4.5, and GPT-5 (flagged in the UI as legacy/retiring Dec 2026, since OpenAI has already deprecated it). Evaluated but did not add GPT-4.5 (fully removed from the OpenAI API since 2025) or Claude Opus 4.0/4.1/Sonnet 4.0 (deprecated or retiring within days). Along the way, found and fixed three incidental pre-existing bugs surfaced by this work: Opus was mislabeled as "Sonnet 4.6" and couldn't use Extended Thinking (#045); 5 of 9 buttons in Settings → Default model were dead due to a stale hardcoded whitelist (#046); and expanding the picker to 14 items exposed a real viewport-overflow bug in the menu positioning logic with no scroll fallback (#047).
- Files changed: `frontend/providers/claude.js`, `frontend/providers/deepseek.js`, `frontend/providers/tools.js`, `frontend/app.js`, `frontend/views/notes.js`, `frontend/views/coding-projects.js`, `frontend/index.html`, `frontend/styles/base.css`, `BUGS.md`, `docs/project-notes/{CHANGES,RUNS}.md`.
- Behavior changes: model picker now shows 14 entries instead of 9; DeepSeek's two presets ("DeepSeek Flash" / "DeepSeek Thinking") now share one underlying model distinguished by a thinking flag rather than two separate model names; Opus now correctly supports the Extended Thinking toggle; all Settings → Default model buttons are now functional; the model/mode menu now clamps to the viewport and scrolls internally instead of ever rendering off-screen.
- Verification: `node --check` on every touched JS file; headless Playwright against a throwaway `:8799` server (not the user's live `:8765` session) confirmed all 14 picker entries render with correct labels, each is clickable and updates the chip/pref correctly, the Settings panel whitelist fix works, the menu stays within the viewport, and zero console errors across all runs. **DeepSeek's exact `thinking` request-parameter shape was not verified against a live API key** — no key was available in this session; inferred from DeepSeek's own docs, not confirmed by a real response. See RUNS.md and BUGS.md #044.

## 2026-08-02

- Agent: Claude Sonnet 5
- Summary: [SCHEMA] Notes' "Ask AI" branches now reuse chat's branch-panel UI, per direct user request ("I want to have same branches in notes as well... reuse the same UI that we have for branches in chat everything same"). Replaced the single fixed right-side drawer (`#nt-branch-panel`, `.nbp-*` CSS) with floating panels built from the same `.branch`/`.branch-head`/`.branch-quote`/`.branch-body`/`.branch-compose`/`.branch-resize`/`.msg`/`.composer` DOM/CSS that chat's branches already use (`chat.css`, global/token-based, not chat-scoped) — same pinned-near-anchor positioning with auto-declutter layout, manual resize on all edges, reader/expand mode, collapse, and a "…" menu (Copy as quote / Close / Delete). Per user confirmation, Notes branches stay flat (no branch-the-branch nesting) and skip a "Recent branches" sidebar equivalent for this pass; the "Make this the main thread" menu item is omitted since Notes has no main-thread concept. All new logic lives in `frontend/views/notes.js` as parallel `note*`-prefixed functions — chat's branch code in `frontend/app.js` (the most fragile area per `BUGS.md`) was not touched. `note.branches[]` gained optional additive fields (`collapsed`, `reader`, `width`, `height`, `top`, `userSized`) inside the existing `notlinear-notes` db (no `db.version` bump, old records unaffected). Added a `--nt-drawer-w` CSS var (`tokens.css`) so resizing a Notes branch panel never touches chat's shared `--drawer-w`. See ADR-028 for the full design rationale and rejected alternatives.
- Files changed: `frontend/views/notes.js`, `frontend/index.html`, `frontend/styles/notes.css`, `frontend/styles/tokens.css`, `FEATURES.md`, `docs/project-notes/{DECISIONS,CHANGES,RUNS}.md`.
- Behavior changes: Notes branches now open as floating, resizable, collapsible panels near their highlighted anchor instead of a fixed full-height right drawer; multiple branches can be resized/collapsed independently but opening a new one still closes the previously open one (matches chat's actual behavior for non-nested/top-level branches — not a new limitation). Branch panels now close automatically when switching notes, opening the notes index, or leaving the Notes view (previously only implicitly on next drawer close). Clicking outside an open branch panel no longer closes it (previously it did, for the old single-drawer model) — matches chat, where branches only close via explicit controls. Panel collapsed/reader/size state now persists across reload; it did not before (there was nothing to persist for a fixed drawer).
- Verification: `node --check frontend/views/notes.js` passed. Ran a disposable server instance on `:8797` (separate from the user's live `:8765` session/origin) with Playwright against a fresh `notlinear-notes` db: created a note, selected text, branched via the floating toolbar, confirmed the panel opens pinned to the anchor with the correct quote; toggled reader/expand mode in and out; collapsed/expanded via the header; opened the "…" menu and closed via it; reopened via the per-block branch badge; sent a message (no API key configured in this sandbox, so the AI call fails as designed — confirmed the pre-existing "No API key" inline-error path still works, not a regression); resized via a drag handle and confirmed both the `user-sized` class and the actual pixel width changed; switched to a second note and confirmed the open panel closed automatically. A second run confirmed the pre-existing default chat branch (unrelated thread) still collapses/expands normally — chat's branch code is unaffected. A third run confirmed collapsed-state persists across a page reload (reopens collapsed via the badge) and that deleting a branch via the menu unwraps its anchor span and removes the block badge. Zero console/page errors across all runs. Full detail in `docs/project-notes/RUNS.md`.

## 2026-08-01

- Agent: Codex
- Summary: Fixed bug #043 — Notes pages now open as their own tabs instead of all sharing the singleton "Notes" tab. The prior #042 fix stopped the blank-tab Notes tile from resetting the open note to the index, but it intentionally preserved ADR-026's shared-Notes-tab model; that meant opening Note B still replaced Note A inside the same tab. Added concrete `note:<noteId>` tab ids in the existing tab strip, kept `notes` as the Notes index/home tab, and routed sidebar rows, bento cards, page-link blocks, note mention chips, and new-page creation through a new `registerNoteOpener`/`openNoteTab` bridge. Also extended `nl_tabs_v1` with an additive `active` field so a note tab can restore as active after reload, and removed the temporary `[BUG042-DEBUG]` console logging left by the prior fix.
- Files changed: `frontend/core/registry.js`, `frontend/app.js`, `frontend/views/notes.js`, `FEATURES.md`, `BUGS.md`, `docs/project-notes/{TASKS,DECISIONS,CHANGES,RUNS}.md`.
- Behavior changes: clicking a note now opens/focuses that concrete note's tab; multiple notes can be open at once. The generic "Notes" tab now represents the Notes index/home, not whichever note happened to be selected last. Existing saved `nl_tabs_v1` payloads still load; the new `active` field is additive UI state only, not a Dexie schema change.
- Verification: `node --check` on `frontend/app.js`, `frontend/views/notes.js`, and `frontend/core/registry.js` passed. Targeted headless Chromium verification against a disposable local server confirmed Note A → `+` → Notes → Note B creates two separate concrete note tabs, switching between them renders the correct page, reload restores both note tabs with the active note selected, and there were zero console/page errors. The run also caught the blank-tab fallback race described above, which was fixed and rechecked.

- Agent: Claude Sonnet 5
- Summary: Expanded the Mind Garden icon sheet (`frontend/mind-garden-icons.html`) from 145 to 251 hand-drawn SVG icons, adding 10 new sections (Heroes, Water Garden, Night Garden, Seasons, Valleys, Mountains, Rivers, Numbers, Hindi Vowels, Hindi Consonants) on top of the existing 11. User supplied the new content as a pasted document; it turned out to be double-encoded UTF-8 (em dashes and every Devanagari character in the two Hindi sections were mangled mojibake, e.g. "â" where an em dash belonged). Reconstructed the two prose lines from context and reconstructed all 46 Devanagari glyphs from their phonetic figcaptions (`a`, `ka`, `kha`, ... — the standard vowel/consonant order, unambiguous even with the source characters gone) rather than guessing at the corrupted bytes. Also caught and fixed a structural bug in the supplied Hindi markup before it ever reached the app: those 46 entries used a bare `<text fill="#2D1AE0">` with no `<g>` wrapper, but the sheet's parser (`frontend/core/mind-garden.js`) only recognizes `svg > g` — as supplied, all 46 would have silently failed to load — and the hardcoded hex fill would have ignored the picker's color palette. Wrapped each in `<g>` and switched to `fill="currentColor"` to match the other 205 icons. The other 145 icons and all page chrome were left byte-for-byte identical (diffed to confirm) — this is a pure content addition, no loader/renderer code changed.
- Files changed: `frontend/mind-garden-icons.html`, `FEATURES.md`, `docs/project-notes/{CHANGES,RUNS}.md`.
- Behavior changes: the Mind Garden icon picker (used by Notes page icons, callout icons, Coding Projects icons, and thread/project glyphs) now offers 106 additional icons under 10 new searchable sections; no existing icon ids, rendering, or picker UI changed.
- Verification: scripted structural checks (balanced tags, 251 unique parseable entries, zero mojibake byte sequences remaining) plus a live headless-Chromium run against the actual running app (`:8765`) — opened the real Mind Garden picker in Notes, confirmed all 251 icons render with the empty-search grid, confirmed keyword search finds the new sections ("hero" → 8, "valley" → 6, "devanagari" → 46), and confirmed both a new line-art icon (`koi`) and a new Devanagari glyph (`devanagariKa`) resolve to valid non-empty `<svg>` markup with zero console errors. Full detail in `docs/project-notes/RUNS.md`.

- Agent: Claude Sonnet 5
- Summary: Fixed bug #042 — opening Notes from a blank tab's "Notes" quick-action tile reset the already-open Notes tab back to the index/overview grid, discarding whichever note was open (reported as "opening another note closes the previous note and brings me to the home page," reproduced from the user's screen recording). Root cause: the `#bte-notes` blank-tab handler in `frontend/app.js` called `openNotesIndex()`, an explicit "start fresh in Notes" helper meant only for the sidebar "Notes" header click, instead of just focusing the existing singleton Notes tab. Fixed by switching it to `openTab('notes')`, the same focus path already used by the Coding-projects tile and the tab strip itself.
- Files changed: `frontend/app.js`, `BUGS.md`, `docs/project-notes/{TASKS,CHANGES,RUNS}.md`.
- Behavior changes: opening Notes via a blank tab's "Notes" tile now focuses the existing Notes tab as-is (preserving whichever note/subpage was open) instead of always jumping to the index grid. The sidebar "Notes" section header is unaffected and still always opens the index.
- Verification: `node --check` on `frontend/app.js` and `frontend/views/notes.js` (clean). Traced the fix against ADR-026 (which documents the intended singleton-Notes-tab-and-navigate behavior) and confirmed the new call path matches it. Manual smoke test (per `AGENTS.md`) still needs a human pass on the running app — see `docs/project-notes/RUNS.md`.

## 2026-07-31

- Agent: Claude Sonnet 5
- Summary: Two Notes changes, both from direct user request. (1) Added `@`-mentions: typing `@` in any Notes text block pops up an autocomplete (sectioned "Notes" / "Chats", live-filtered, arrow-key + Enter/Tab navigation) mirroring the existing slash-menu UX; picking an item inserts an inline, atomic chip (📄/💬 + title) at the caret using the same Range-based insertion technique as the existing inline-equation feature, so surrounding rich text is untouched. Clicking a chip opens it: a note chip switches to the Notes tab and jumps to that note; a chat chip opens/focuses that chat as its own tab in the tab strip. Chats aren't reachable from `notes.js` directly (its tab-strip logic is still un-modularized inside `app.js`), so added a minimal `registerChatOpener`/`openChatTab` bridge in `frontend/core/registry.js` — `app.js` registers its real `openTab` once at init. Per user confirmation, a note-mention click reuses the existing single shared "Notes" tab rather than opening a dedicated per-note tab (see ADR-026 for the alternatives considered). (2) Fixed BUGS.md #041: Markdown export only recursed into subpages that were embedded as in-content `page-link` blocks, silently dropping subpages created via the sidebar tree ("add subpage" button, unrelated to the `/page` in-content command). `noteToMarkdown()` now recurses into the union of both subpage sources.
- Files changed: `frontend/core/registry.js`, `frontend/app.js`, `frontend/index.html`, `frontend/styles/notes.css`, `frontend/views/notes.js`, `FEATURES.md`, `BUGS.md`, `docs/project-notes/{DECISIONS,CHANGES,RUNS}.md`.
- Behavior changes: typing `@` in a Notes text block now opens an autocomplete popover (previously `@` was a plain character); Notes Markdown export now includes sidebar-tree-only subpages that it previously omitted.
- Verification: `node --check` on all touched `.js` files. Headless Playwright against the live `:8765` server (fresh throwaway browser profile, user's real notes/threads untouched): typed `@te` in a fresh note, confirmed the "Chats" section listed the real open thread and picking it inserted a working chip; confirmed the chip and its data-id/data-kind survived a full page reload read back from `notlinear-notes`'s IndexedDB `kv` store, and remained clickable after reload; clicked a note-kind chip from a separate note and confirmed the page title changed to the mentioned note (Notes-tab-and-navigate behavior); created a parent note with a sidebar-added subpage (no page-link block) and exported it, intercepting the `/__notlinear_save_file` POST body (the real endpoint opens a native macOS save dialog that can't be driven headlessly) — confirmed the subpage's title and body appear as a `## <title>` section in the exported Markdown. Zero console errors throughout. Full detail in RUNS.md.

- Agent: Claude Sonnet 5
- Summary: Fixed bug #040 — Tab key was a silent no-op (moved focus to the next button/field) everywhere the user types free text. Added a shared `wireTabInsertsTab()` helper (`frontend/core/ui.js`) that inserts a literal tab character at the caret instead, wired into the main chat input, both branch-panel ask boxes, the Coding Projects comment composer, and the feedback textarea. In Notes specifically (per the user's follow-up clarification — "in bullet points, Tab should go to sub-bullet"), generalized the block model's `children` array (previously toggle-only) to any block type and implemented real Notion-style indent/outdent: Tab nests the current block under its preceding sibling, Shift+Tab pops it back out; falls back to inserting a literal tab when there's no preceding sibling to nest under. **Caught live by the user on their own real note right after the first pass shipped:** indenting produced a large blank gap with floating placeholder text instead of a clean sub-bullet. Root cause was a second, pre-existing bug — `.nt-screen .b` is a row-flex container with no `flex-wrap`, so the newly-rendered `.child-wrap` sat as a flex *sibling* of `.content` in the same row (squeezed into whatever space was left over) instead of stacking below it; the same latent bug already existed for `toggle` block children, just rarely triggered. Fixed by making `.b` `flex-wrap:wrap` and `.child-wrap` `flex:0 0 100%`, forcing it onto its own full-width line for every block type. See BUGS.md #040 and ADR-025 for full detail.
- Files changed: `frontend/core/ui.js`, `frontend/app.js`, `frontend/views/notes.js`, `frontend/views/coding-projects.js`, `frontend/core/feedback.js`, `frontend/styles/notes.css`, `BUGS.md`, `docs/project-notes/{TASKS,DECISIONS,CHANGES,RUNS}.md`.
- Behavior changes: Tab in any composer textarea now inserts a tab character instead of moving focus to the next UI element. In Notes, Tab/Shift+Tab on a block now indent/outdent it (nesting under/out of the preceding sibling) instead of doing nothing; any block type can now carry nested `children`, not just toggles; toggle-block children (and any block's indented children) now always render full-width below the parent instead of occasionally squeezing into a narrow leftover column.
- Verification: Headless Playwright (Python) against the live `:8765` server, fresh throwaway browser profile (user's real notes/threads untouched, and separate from the user's actual browser storage entirely since Playwright's context is its own isolated profile): reproduced the original focus-jump on `#main-input` and the Notes block editor; verified the fix on all 5 wired composers; reproduced the user's exact follow-up repro (Tab on a still-empty new bullet) and confirmed the blank-gap/floating-placeholder bug via bounding-box measurements (child rendered at 58px wide, offset into the parent's row) before fixing the CSS, then confirmed correct full-width stacked layout after; verified Shift+Tab outdent and the no-preceding-sibling tab-character fallback; verified the pre-existing slash-menu Tab-to-pick still works (non-regression); verified a toggle block's own child-add affordance also now renders full-width (non-regression + fix for the same latent bug); verified nested-bullet structure round-trips correctly through a full page reload via direct IndexedDB inspection (`notlinear-notes` → `kv` → `nl_notes_v1`). Zero console/page errors throughout.

- Agent: Claude Sonnet 5
- Summary: Notes bug fix + new feature, both from direct user request. (1) Fixed BUGS.md #039: mouse drag-selection across more than one note block silently stopped at the first block's boundary and copied nothing past it — root cause is that each block is its own separate `contenteditable`, and Chromium refuses to let a native `Selection` span two `contenteditable` "editing hosts" (confirmed this is a hard browser restriction, not a listener bug, by also testing a JS-constructed cross-block `Range` assigned via `addRange()`, which got clamped the same way). Added a custom drag-tracking layer (`wireBlockRangeDrag`/`paintBlockRange`) that detects the cross-block drag and paints a highlight + copies the selected blocks' text on `⌘/Ctrl+C`, generalizing the existing page-wide `⌘A ⌘A` select-all machinery (`blockSelAll` → `blockSelIds`) rather than replacing it. (2) Added Markdown export: a download-icon button in the Notes topbar exports the current page as a single self-contained `.md` file, recursively including every subpage the page links to (walks `page-link` blocks, cycle-safe) as its own section, with images embedded inline as base64 data URIs (they're already stored that way in `b.src`, so no separate asset files needed). Format (Markdown vs. HTML) and scope (page-only vs. recursive-with-subpages) were confirmed with the user via direct questions before implementation — see ADR-024; Markdown was chosen partly because it let the existing `/__notlinear_save_file` endpoint (already used by chat's "Download .md") be reused completely unchanged, no backend touch.
- Files changed: `frontend/views/notes.js`, `frontend/index.html`, `frontend/styles/notes.css`, `FEATURES.md`, `BUGS.md`, `docs/project-notes/{TASKS,DECISIONS,CHANGES,RUNS}.md`.
- Behavior changes: dragging the mouse from one block into another now selects/highlights every block in between (previously selected nothing past the first block); `⌘/Ctrl+C` after such a drag copies the highlighted blocks' text and shows a "selection copied" toast (new, alongside the existing "page copied" toast for full-page select-all). New "Export" download button appears in the Notes topbar whenever a page is open (hidden on the all-pages index).
- Observed: while testing, an accidental `pkill -f "backend/server.py"` briefly killed the **pre-existing** `:8765` server backing the user's already-open `Notlinear.app` (not a server started for this session) — caught immediately and restarted on the same port; flagged directly to the user.
- Verification: Headless Playwright (Python) against the live `:8765` server, fresh throwaway browser profile (user's real notes untouched): reproduced the original bug, verified the fix across a full 3-block drag, a partial 2-block drag, single-block-native-selection non-regression, and the pre-existing whole-page select-all non-regression; verified export end-to-end (real subpage created via the `/page` slash command, save-file network call intercepted so no real dialog fired) produced correct Markdown with the subpage as a nested section. Zero console errors in the final passing run. Full detail in `docs/project-notes/RUNS.md`.

- Agent: Claude Sonnet 5
- Summary: Notes all-pages index redesigned as an auto-adjusting bento grid, sorted by most-recently-edited first, per user request. Notes previously had no edit timestamp at all (`newPage()` created `{id, emoji, title, tags, parent, blocks}` only, and the open-page meta line hardcoded the string "updated just now"). Added `createdAt`/`updatedAt` at every note-creation site and a `touchSelected()` helper called before `save()` at every genuine content-edit call site (title, tags, cover, emoji, block add/remove/type-change/text-edit, branch messages — traced all ~55 `save()` call sites in `frontend/views/notes.js`), while deliberately *not* touching it on structural/UI-only actions (sidebar fold, opening a note, delete, reparent) so those don't reorder the grid. `renderIndex()` now sorts root notes by `updatedAt`/`createdAt` descending and renders them via a new `renderBentoCard()` into a `.nt-bento` CSS grid (`grid-template-columns:repeat(auto-fill,minmax(230px,1fr))` + `grid-auto-flow:dense`) — column count adapts to width with no JS breakpoints, and the most-recent note gets a larger 2×2 "featured" card (falls back to 1×1 under 640px). Added `timeAgo()` and `notePreview()` helpers; cards now show a real relative-time meta line and a short text-preview snippet instead of nothing. The single-page view's meta line also now uses `timeAgo()` instead of the old hardcoded string. Subpages are no longer nested inline in the grid (flat card layout matching the requested bento look) — still reachable via the sidebar tree/breadcrumbs, unaffected.
- Files changed: `frontend/views/notes.js`, `frontend/styles/notes.css`, `FEATURES.md`, `docs/project-notes/{CHANGES,RUNS}.md`.
- Behavior changes: Notes home page is a bento grid instead of a flat list; root notes now sort by recency instead of creation/array order; note objects gain `createdAt`/`updatedAt` fields (additive, no Dexie schema/version bump — `notlinear-notes` db, ADR-007).
- Verification: `node --check frontend/views/notes.js` clean. Headless Playwright drive against the running `:8765` server (fresh in-memory profile, user's own notes untouched): seeded 3 notes, confirmed 3 bento cards render with a featured card, real preview text and "X ago" meta (not blank); grid columns went 4→2 narrowing 1400px→700px; editing the oldest note moved it back to first place on return to the grid; zero console errors throughout. Screenshots reviewed.

- Agent: Claude Sonnet 5
- Summary: Iterated on the bento card design via three published Artifact mockups (icon-forward treatments using the real Mind Garden icon set + real workspace pages), then implemented the chosen "corner bloom" direction into `renderBentoCard()`. Each card now gets: (1) a giant, faint copy of its own icon bleeding off the bottom-right corner (never top-right, so it can't collide with the hover-revealed add/delete buttons there; skipped entirely for uploaded photo icons, where a huge faint raster would just look broken), and (2) a subtle full-card background tint. Both the bloom's stroke color and the tint are derived from the same 8-swatch palette (`--bento-t0..t7-bg/-fg` in `frontend/styles/notes.css`, one pair per theme), picked by a deterministic hash of the note's own `emoji` field (`tintFor()` in notes.js) — same icon always lands on the same tint, no per-note state to persist. For notes using a Mind Garden `icon:<id>` token, the bloom is actually colored (not just grey) via `renderIconSvg`'s existing `color` param — but only as a fallback: if the user already picked an explicit color for that icon in the picker, `bentoIconHTML()` respects their choice instead of overriding it. Plain emoji (still the default until a note's icon is customized — Mind Garden is the only icon source the picker itself offers now, per `core/emoji.js`) pass through unmodified since they're already colorful. Removed the small icon badge next to the title entirely (per direct user feedback on the mockup) — the bloom + tint are now the only icon signal.
- Files changed: `frontend/views/notes.js` (`tintFor`, `seedRand`, `bentoIconHTML`, `renderBentoCard`), `frontend/styles/notes.css` (`--bento-t*` tokens for dark-mono default + light theme, `.nt-bento-item`/`.nt-bloom` rules), `CHANGELOG.md`, `docs/project-notes/{CHANGES,RUNS}.md`.
- Behavior changes: bento cards lose their small icon badge; gain a background tint + corner-bloom icon instead. Purely presentational — no data model change beyond what the prior entry already added (`createdAt`/`updatedAt`); the tint/bloom are computed at render time from the existing `emoji` field, nothing new persisted.
- Verification: `node --check frontend/views/notes.js` clean. Headless Playwright against the live `:8765` server: created notes with distinct Mind Garden icons (mountain/wave/key) via the real picker UI, confirmed `getComputedStyle` on `.nt-bento-item` and `.nt-bloom svg` return the exact expected hex-derived RGB values per icon (same icon → same tint, different icons → different tints); confirmed titles/previews render correctly, sort-by-recency and edit-reorder still work, and the tint/bloom re-resolve correctly when flipping between dark-mono/grey/light via `data-theme` with no re-render (pure CSS variable reactivity, as intended). Zero console errors. Screenshots reviewed in all three themes.

- Agent: Claude Sonnet 5
- Summary: Two small follow-up tweaks after seeing the bloom/tint live against the user's real 33-page workspace. (1) The `--bento-t*-bg` tint swatches read stronger than intended against real content density — lightened all 16 (8 per theme) by blending each toward its theme's base ground (45% toward white for light, 40% toward `--surface` for dark-mono/grey) so the wash reads as "a hint of color" rather than a distinct colored card; `-fg` (bloom stroke) values untouched, since those need to stay saturated enough to read. (2) Removed the preview-text subtext line entirely — `notePreview()` and its call site in `renderBentoCard()` deleted along with the now-dead `.nt-ix-preview` CSS rule; cards now show just title, corner bloom, and the meta line.
- Files changed: `frontend/views/notes.js` (removed `notePreview()` + its call site), `frontend/styles/notes.css` (`--bento-t*-bg` values, removed `.nt-ix-preview` rule), `CHANGELOG.md`, `docs/project-notes/{CHANGES,RUNS}.md`.
- Behavior changes: bento card tints are subtler; cards no longer show a body-text preview snippet.
- Verification: `node --check frontend/views/notes.js` clean. Headless Playwright against the live `:8765` server: confirmed zero `.nt-ix-preview` elements remain, card layout intact (name + bloom + meta, no gap where the preview used to sit), zero console errors. Screenshot reviewed.

## 2026-07-26

- Agent: Claude Sonnet 5
- Summary: Product story fullscreen player fixes, reported live in-app by Yash. (1) The player opened at Update 1 = the *oldest* chapter and paged forward — `openStoryPlayer()` was reversing the already newest-first `storyChapters` array; removed the `.reverse()` so Update 1 is now the newest chapter, matching the inline pager's newest-first convention. (2) The top progress-segment bar (`.story-player-seg`) used `border-radius:2px` on a 3px-tall bar — nearly a full capsule; reduced to `1px` so segments read as ticks. (3) The per-chapter change-item chips (`.story-player-item`/`.story-player-item-text`) were nearly invisible against the dark player background (`rgba(255,255,255,0.08)` bg / `0.14` border) — raised to `0.14`/`0.24` and bumped item text to `12.5px`/`font-weight:500` for legibility. Verified live with headless Playwright (Python) against the running `:8765` server, including reproducing the exact reported frame (2026-05-24, "Update 8 of 41").
- Files changed: `frontend/app.js` (`openStoryPlayer`), `frontend/styles/base.css` (`.story-player-seg`, `.story-player-item`, `.story-player-item-text`), `FEATURES.md`.

- Agent: Claude Sonnet 5
- Summary: Fixed bug #031 — the Branches canvas (`#branch-canvas`) showed fewer branch cards/connectors than the Hierarchy sidebar for the same thread, because it read only the live in-memory `branches` object (branches currently open as panels) instead of the full merged branch list the sidebar already uses. See BUGS.md #031 for root cause and verification detail.
- Files changed: `frontend/app.js` (`bcLayout`, `bcRender`), `BUGS.md`, `docs/project-notes/{CHANGES,RUNS}.md`.

- Agent: Claude Sonnet 5
- Summary: TASK-NT08 (fifth phase of `notes_new_feature.md`, Notes v2; NT07 deferred) — four new slash-menu block types. **A4** video/audio embed: paste a YouTube/Vimeo link for an inline sandboxed player, or a direct `.mp4`/`.mp3`-style file URL for native `<video>`/`<audio>` playback; anything else degrades to a plain link card. **A5** file attachment: click/drag to attach, files over 5MB store name/size/mime only (never read into memory as a dataURL) with a "too large — use a link instead" message; smaller files get a working download link. **A6** bookmark: paste a URL, a new backend endpoint fetches title/description/favicon server-side (the frontend can't CORS-fetch arbitrary sites); a failed fetch degrades to a plain link card, never a broken one. **A7** generic embed: a small hardcoded allowlist (Figma/CodePen/Google Maps) gets a sandboxed iframe; anything else automatically converts into a bookmark block (A6) instead of a broken frame. Plan mode used first per CLAUDE.md — first change to `backend/server.py` since TASK-NT03, so the server-touching rule applied.
- [NEW ENDPOINT]: `/__notlinear_link_preview` (POST `{url}` → `{ok, title, description, domain, favicon}`), stdlib-only (`urllib.request` + `html.parser`, no new pip dependency), follows the existing `__notlinear_*` naming/JSON-response convention. Scheme-validated (http/https only) but not hardened against SSRF beyond that — see ADR-023 for why that's a deliberate, bounded call for this local single-user server, not an oversight. All existing endpoints unchanged.
- Files changed: `backend/server.py` (`link_preview`, `_LinkPreviewParser`, new `do_POST` route, stdlib imports), `frontend/views/notes.js` (four new `renderBlock` branches, `SLASH_ITEMS`, `applyType`, `blocksToText` export handling, new classify/format helpers), `frontend/styles/notes.css` (four new block-type style blocks), `docs/project-notes/DECISIONS.md` (ADR-023), `docs/project-notes/{TASKS,CHANGES,RUNS}.md`.
- Behavior changes: slash menu gains four new items (Video/audio, File attachment, Bookmark, Embed). Local server now makes outbound network requests for the first time (only for user-pasted bookmark/embed URLs, never automatically). No persisted-shape change to existing block types — these are net-new block types with their own fields.
- Verification: `python3 -m py_compile backend/server.py` clean. `node --check frontend/views/notes.js` clean. `curl`'d the new endpoint directly against a real site (title/domain/favicon came back correctly, including handling a `data:,` favicon some sites use to suppress the browser's default favicon request) and a bad scheme (`file://`, graceful `{ok:false}`, no crash); spot-checked an existing endpoint (`/__notlinear_scan_project`) still works. `backend/server.py` served all touched frontend assets HTTP 200. Headless Chrome `--dump-dom` boot check: zero console/page errors. Interactive click-through (paste a YouTube/Vimeo/audio/unrecognized link, attach a small and an over-5MB file, bookmark a real and a failing URL, embed a Figma/CodePen/Maps link and an unrecognized one) has **not** been driven by an automated browser in this session (no Playwright/puppeteer available) — human GUI smoke test recommended before treating this as fully verified.

- Agent: Claude Sonnet 5
- Summary: TASK-NT06 (fourth phase of `notes_new_feature.md`, Notes v2) — pages get a real cover photo (the old empty `.cover-spacer` now supports upload, drag-to-reposition vertically, change, and remove) and a custom uploaded-image page icon as an alternative to emoji/Mind-Garden icons. Plan mode used first per CLAUDE.md (both pieces are `[SCHEMA]`-tagged in the requirements doc). Two design decisions, both confirmed with the user and recorded in ADR-021: page icons store a new `img:<dataURL>` string token on `n.emoji` — following the *existing* `icon:<id>[:<hex>]` token convention already used by `glyphHTML`/Mind Garden — instead of the doc's suggested `{type,value}` object shape, so every existing icon-render call site keeps working unchanged and **no migration step is needed at all**; and the image-upload UI is a small separate button next to the existing page-icon button rather than a change to the shared `core/emoji.js` picker (also used by Coding Projects/sidebar, outside this doc's stated scope).
- [SCHEMA-additive]: `n.emoji` gains a new `img:<dataURL>` value domain (existing plain-emoji-string and `icon:` token notes are completely unaffected — same field, same type, just a new recognized prefix). New optional `note.cover = {src, posY}` field; notes without one render exactly as before (same 8px spacer). No `db.version` bump.
- Files changed: `frontend/views/notes.js` (`glyphHTML`, `renderPage`, new `downscaleImage`/`applyCoverFile` helpers), `frontend/styles/notes.css` (`.cover-wrap`/`.cover-img`/`.cover-controls`/`.cover-add`, `.pg-icon-wrap`/`.pg-icon-actions`), `docs/project-notes/DECISIONS.md` (ADR-021), `docs/project-notes/{TASKS,CHANGES,RUNS}.md`.
- Behavior changes: page header now shows hover-revealed cover/icon controls; uploaded cover photos and page icons are downscaled client-side via `<canvas>` before storing (cover: max width 1600px, JPEG ~0.85 quality; icon: 128×128 square PNG) so a full-resolution original photo doesn't bloat the `notlinear-notes` Dexie value for something rendered small. Cover control buttons use fixed dark/white colors (not theme tokens) since they float over arbitrary user-photo content — same documented exception class as the TASK-RD03 new-chat button, not a bug #022 case.
- Verification: `node --check frontend/views/notes.js` clean. `backend/server.py` served `frontend/index.html`/`notes.js`/`notes.css` HTTP 200. Headless Chrome `--dump-dom` boot check: zero console/page errors (one earlier attempt hit a transient connection error from a Chrome/server race, not a code issue — a clean re-run confirmed the page boots fine). Interactive click-through (add/reposition/change/remove a cover, upload/remove a custom image page icon and confirm it renders at every icon site, confirm existing emoji/Mind-Garden icons on other notes are unaffected) has **not** been driven by an automated browser in this session (no Playwright/puppeteer available) — human GUI smoke test recommended before treating this as fully verified.

- Agent: Claude Sonnet 5
- Summary: TASK-NT05 (third phase of `notes_new_feature.md`, Notes v2) — dragging a block onto the right two-thirds of a toggle block's row now nests it as that toggle's child (left third / non-toggle targets keep the existing reorder-only behavior); sidebar pages get a new duplicate action (deep-copies the page and all its subpages with fresh ids, inserted as a sibling right after the original); sidebar pages are now drag-and-drop reparentable (drop onto another page to make it a subpage, onto blank tree space to make it top-level, circular drops onto a page's own descendant are blocked). Plan mode used first per CLAUDE.md; two scope calls confirmed before implementation — block-nesting is toggle-blocks-only (page-link cross-note nesting deferred, more complex/risky), and duplicate copies the whole subpage subtree (Notion's default) but not `note.branches` (Ask-AI threads, since they're keyed by block ids that no longer exist post-copy).
- Files changed: `frontend/views/notes.js` (`wireBlockDrag`, `renderRow`, `wireSidebar`, new `deepCopyBlocks`/`duplicateSubtree`/`duplicatePage`/`reparentNote`/`wireSideDrag` helpers), `frontend/styles/notes.css` (`.b.drop-into`, `.nt-nrow.dragging`, `.nt-nrow.drop-into`), `docs/project-notes/{TASKS,CHANGES,RUNS}.md`.
- Behavior changes: block drag-and-drop now has a third drop zone (nest) in addition to above/below, for toggle blocks only. Sidebar page rows are now draggable and gain a duplicate (copy icon) button. No persisted-shape change — reparenting just updates the existing `.parent` field, duplication reuses the existing note/block object shapes with fresh ids.
- Verification: `node --check frontend/views/notes.js` clean. `backend/server.py` served `frontend/index.html`/`notes.js`/`notes.css` HTTP 200. Headless Chrome `--dump-dom` boot check: zero console/page errors. Interactive click-through (drag a block into a toggle's nest zone, duplicate a page with subpages, drag a sidebar page onto another / onto blank space, circular-reparent block check) has **not** been driven by an automated browser in this session (no Playwright/puppeteer available) — human GUI smoke test recommended before treating this as fully verified.

- Agent: Claude Sonnet 5
- Summary: TASK-NT04 (second phase of `notes_new_feature.md`, Notes v2) — code blocks now get real syntax highlighting (colors mapped to existing `tokens.css` custom properties, not a stock theme), and equation blocks actually render LaTeX via KaTeX instead of showing raw text (arguably a bug fix — the doc noted `eq` blocks "likely render as plain text"). New inline-equation toolbar button (Σ) lets you turn a text selection into rendered math anywhere in a note; click a rendered inline equation to edit its LaTeX. Plan mode used first per CLAUDE.md; two new CDN dependencies called out and approved before use (highlight.js over Prism, KaTeX over MathJax).
- **New dependencies:** `https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/{katex.min.css,katex.min.js}` and `https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11.9.0/highlight.min.js`, added to `frontend/index.html` following the existing Dexie/Tabler/Mermaid CDN `<script>`/`<link>` pattern. No highlight.js theme stylesheet included — only the JS; syntax colors come from new `.hljs-*` CSS rules in `notes.css` mapped to `tokens.css` vars, per AGENTS.md's no-hardcoded-colors rule. `katex.min.css` is included as-is (structural glyph metrics, not a color theme).
- Files changed: `frontend/index.html`, `frontend/views/notes.js`, `frontend/styles/notes.css`, `docs/project-notes/{TASKS,CHANGES,RUNS}.md`.
- Behavior changes: code blocks are now colorized (previously plain monochrome text); equation blocks now render actual math instead of showing the raw LaTeX string as plain text — existing saved equation blocks pick this up automatically on next render, no data change needed since equation source was always stored as plain text in `b.text`. Floating format toolbar gains a new Σ button.
- Verification: `node --check frontend/views/notes.js` clean. `backend/server.py` served `frontend/index.html`, `notes.js`, `notes.css` HTTP 200; both CDN URLs confirmed 200 on jsdelivr. Headless Chrome `--dump-dom` boot check: zero console/page errors, new toolbar button markup (`data-cmd="eq"`) present in the DOM. Interactive click-through (typing code and confirming live/on-blur highlighting, language-switch layout-shift check, typing valid/invalid LaTeX in an equation block, selecting text → Σ → click-to-edit, reload persistence of a rendered inline equation) has **not** been driven by an automated browser in this session (no Playwright/puppeteer available) — human GUI smoke test recommended before treating this as fully verified.

## 2026-07-24

- Agent: Claude Sonnet 5
- Summary: TASK-NT03 (first phase of `notes_new_feature.md`, Notes v2) — image blocks can now hold a pasted/dropped external URL instead of only a local-file dataURL, are resizable via a drag handle, and degrade to a clear "couldn't load this image" card instead of a broken `<img>` on a 404. New `/table of contents` block auto-lists the page's h1-h4 headings nested by level, updates live as headings are added/removed/edited, and clicking a row scrolls to it. Plan mode used first per CLAUDE.md (persistence-adjacent change).
- Files changed: `frontend/views/notes.js`, `frontend/styles/notes.css`, `docs/project-notes/{TASKS,CHANGES,RUNS}.md`.
- [SCHEMA-additive]: `image` blocks gain an optional `b.width` (px) field, and `b.src` may now be a plain URL string as well as a dataURL. No `notlinear-notes` `db.version` bump — old saved images (no `b.width`, dataURL `b.src`) render unchanged. New `toc` block type persists only `{id, type:'toc'}`; its listing is derived at render time, nothing else stored.
- Behavior changes: image block click-to-replace, drag/drop-to-upload unchanged; new affordances are additive (paste-URL button when empty, resize handle when filled). Slash menu gains one new "Table of contents" item.
- Verification: `node --check frontend/views/notes.js` clean. `backend/server.py` served all touched assets HTTP 200. Headless Chrome `--dump-dom` boot check: zero console/page errors, Notes shell present. Interactive click-through (slash-pick /toc, paste-URL, drag-drop URL, 404 fallback, resize-drag-then-reload, live TOC update while typing a heading, click-row-to-scroll) has **not** been driven by an automated browser in this session (no Playwright/puppeteer available) — human GUI smoke test recommended before marking fully verified.

- Agent: Claude Sonnet 5
- Summary: notlinear Redesign TASK-RD02 — projects and threads in the sidebar now default to a colored hand-drawn icon (iris/acorn/compass/star cycling for projects; branch/compass/roots/star cycling for threads, main thread always the blue branch glyph) instead of a single generic Tabler folder/message icon, reusing the existing Mind Garden icon system (`frontend/core/mind-garden.js`) rather than building anything new. A user's manually-chosen emoji/icon still always overrides the default. This is phase 2 of the notlinear Redesign rollout (`redesign_product.md`, TASK-RD00–RD09); see `docs/project-notes/DECISIONS.md` ADR-015.
- Files changed: `frontend/app.js` (`renderProjects`, `addThreadButton`, `refreshThreadGlyph`, plus new local `PROJECT_ICON_CYCLE`/`THREAD_ICON_CYCLE`/`cycleGlyphHTML`/`threadIconIndex` helpers), `redesign_product.md` (new), `docs/project-notes/{TASKS,DECISIONS,CHANGES,RUNS}.md`.
- Behavior changes: Projects and threads without a user-set emoji/icon now show a colored hand-drawn glyph rather than a plain Tabler icon. Icon cycling is by creation order, so deleting/reordering items can shift which default icon a remaining item shows on next render — cosmetic only, doesn't affect a user's manual icon pick.
- Verification: `node --check frontend/app.js` clean. `backend/server.py` served all touched assets HTTP 200. Headless Playwright: zero console/page errors on load; all 4 seed thread rows (`doc-main`/`pricing`/`onboarding`/`planning`, hardcoded in `index.html` rather than JS-created — caught and fixed a bug where they all fell back to index 0/branch since they lack `dataset.iconIndex`) render distinct correct glyphs (`#58A6FF` branch, `oklch(48% 0.08 195)` compass, `oklch(50% 0.10 145)` roots, `oklch(55% 0.13 25)` star); a newly-created chat thread gets its default icon immediately, not just after reload. Full manual GUI smoke test (AGENTS.md 10-item list) still recommended given this is the first of several redesign phases.

## 2026-07-25 (10)

- Agent: Claude Sonnet 5
- Summary: Tab strip fix — the "+" new-tab button now sits right next to the last tab instead of pinned to the far-right edge of the window. `.tab-strip-list` had `flex:1`, which always stretched it to fill the row regardless of tab count.
- Files changed: `frontend/styles/base.css`.
- Behavior changes: Visual only — the tab list now sizes to its content (like a normal browser tab bar) instead of always filling the available width. With many tabs open, the list scrolls internally and "+" remains visible.
- Verification: Headless check confirmed "+" sits ~6px after the last tab with few tabs open, and stays within the viewport with 9 tabs open. Zero console errors.

## 2026-07-25 (9)

- Agent: Claude Sonnet 5
- Summary: Tab strip fix — Notes and Coding Projects are true full-screen overlays (`position:fixed;inset:0`) that were painting over the entire tab strip whenever open, making it look like tabs had disappeared. They now leave the top 44px clear so the tab strip stays visible and usable while browsing Notes or Coding Projects (Settings/Product Story/Projects grid/branch canvas intentionally remain full-viewport — they're outside the tab system by design).
- Files changed: `frontend/styles/notes.css`, `frontend/styles/coding-projects.css`.
- Behavior changes: Notes and Coding Projects now start 44px from the top of the viewport instead of the very top, so the tab strip above them is always visible and clickable. No other layout change to either view.
- Verification: `node --check frontend/app.js` clean (no JS touched). Thorough headless pass: opened 4 thread tabs + Notes + Coding Projects (6 tabs), confirmed the tab strip stayed visible through both overlays, switched to a thread tab from inside Coding Projects (overlay correctly hid), rapid-switched all 6 tabs, created a new chat (7th tab), reloaded with all 7 open (all restored with correct active tab), closed a middle tab (only that one removed). Zero console errors across the entire sequence.

## 2026-07-25 (8)

- Agent: Claude Sonnet 5
- Summary: Tab strip fix — each thread's tab now shows that thread's actual icon (its manually-set emoji/icon, or the default hand-drawn cycled glyph from RD02) instead of a generic file icon on every tab.
- Files changed: `frontend/app.js`, `frontend/styles/base.css`.
- Behavior changes: Tab icons now match the sidebar row and doc-title icon for the same thread. Notes/Coding Projects/blank tabs are unaffected (still their own fixed icons).
- Verification: `node --check frontend/app.js` clean. Headless check confirmed a tab's icon SVG has the identical color/shape as its sidebar row's icon; zero console errors.

## 2026-07-25 (7)

- Agent: Claude Sonnet 5
- Summary: notlinear Redesign TASK-RD09 revision — tabs are now Notion-style: every open thread gets its own tab (not one generic "Doc" tab), and the open tabs + which one is active now survive a reload. Previously this reset every time the app reloaded, which is very likely what made the tab strip look broken/not working.
- Files changed: `frontend/app.js`, `docs/project-notes/{TASKS,DECISIONS,CHANGES,RUNS}.md`.
- Behavior changes: Tabs are now per-thread and none are pinned/protected — closing the last one reopens the main thread. Tab state persists in the browser's local storage across reloads. All existing thread-opening paths (sidebar, search, New chat, project chats) behave identically and automatically show up as tabs.
- Verification: `node --check frontend/app.js` clean. Headless Playwright verified tabs survive two separate reload cycles with correct active-tab state, a real new chat becomes its own persisted tab, and branch creation is unaffected. Three real bugs were found and fixed during this verification, each only reproducible via an actual page reload — see DECISIONS.md ADR-022 for details.

## 2026-07-25 (6)

- Agent: Claude Sonnet 5
- Summary: notlinear Redesign TASK-RD09 follow-up — the tab strip's "+" button now opens a real blank tab with a 5-button empty state (New chat / Existing chat / Projects / Coding projects / Notes), matching the original design's actual "+" behavior instead of the smaller dropdown menu from the first pass.
- Files changed: `frontend/index.html`, `frontend/app.js`, `frontend/styles/base.css`, `docs/project-notes/TASKS.md`.
- Behavior changes: "+" creates a blank tab (hides the doc pane) instead of opening a dropdown. Picking an option performs that real action (creates a chat, opens search, opens Projects/Notes/Coding Projects) and closes the blank tab.
- Verification: `node --check frontend/app.js` clean. Headless Playwright confirmed the full flow for all 5 buttons; zero console errors.

## 2026-07-25 (5)

- Agent: Claude Sonnet 5
- Summary: notlinear Redesign TASK-RD09 (final phase) — added a browser-style tab strip above the breadcrumb. "Doc" is a permanent pinned tab; Notes and Coding Projects can be opened as additional closable tabs via a "+" menu. Scoped down from the original prototype's full tab model after investigating the real view-registry code with Yash — Settings, Product Story, the Projects grid, and the branch canvas stay as their existing direct entry points for now rather than becoming tabs too (see ADR-020). This closes out the full `redesign_product.md` rollout (TASK-RD00–RD09).
- Files changed: `frontend/core/registry.js`, `frontend/app.js`, `frontend/index.html`, `frontend/styles/base.css`, `docs/project-notes/{TASKS,DECISIONS,CHANGES,RUNS}.md`.
- Behavior changes: New tab strip UI above the breadcrumb. All existing navigation (sidebar clicks, breadcrumb, back buttons) behaves identically — a new registry subscription hook keeps the tab strip in sync with them automatically, none of those ~10 call sites were modified. No change to chat, branches, Notes, or Coding Projects functionality itself.
- Verification: `node --check` clean on `frontend/app.js` and `frontend/core/registry.js`. Headless Playwright verified tab open/switch/close, that a pre-existing unmodified entry point (sidebar Notes header) correctly stays in sync with the tab strip, and that branch creation still works with zero errors after a full tab-interaction sequence.

## 2026-07-25 (4)

- Agent: Claude Sonnet 5
- Summary: notlinear Redesign TASK-RD06 follow-up — added a sidebar "Updates > Product story" entry point. Product story was only reachable via Settings > Changelog before this, which turned out not to be discoverable (Yash couldn't find it in the running app).
- Files changed: `frontend/index.html`, `frontend/app.js`, `docs/project-notes/TASKS.md`.
- Behavior changes: New "Product story" row in a new sidebar "Updates" section opens the full-screen story player directly. No change to the existing Settings > Changelog path, which still works as before.
- Verification: `node --check frontend/app.js` clean. Headless Playwright confirmed the sidebar button opens the player with the full real chapter set; zero console errors.

## 2026-07-25 (3)

- Agent: Claude Sonnet 5
- Summary: notlinear Redesign TASK-RD08 — a new "Branches — canvas view" toolbar button opens a full-screen pannable map of the current thread's branches, connected to their parent by curved lines. This is a purely additive, read-only visualization: it never modifies branch data, and clicking a branch node re-focuses it using the same existing mechanism the app already uses elsewhere, so branch creation/reopen/nesting behavior is unchanged. Presented the implementation plan and got explicit sign-off before writing any branch-adjacent code, given how central this system is.
- Files changed: `frontend/app.js`, `frontend/index.html`, `frontend/styles/base.css`, `redesign_product.md`, `docs/project-notes/{TASKS,DECISIONS,CHANGES,RUNS}.md`.
- Behavior changes: New toolbar icon opens the branch canvas (doesn't replace the existing thread-map icon/panel, which serves a different purpose — thread-level summaries, not branches). No change to any existing branch creation, panel, reader-mode, or persistence behavior.
- Verification: `node --check frontend/app.js` clean. Headless Playwright created a real branch and drove the full canvas flow (open, node-click re-focus, doc-node close, Escape, pan) with zero console errors and confirmed the branch was unaffected throughout.

## 2026-07-25 (2)

- Agent: Claude Sonnet 5
- Summary: notlinear Redesign TASK-RD07 — sidebar "Projects" now has a "view all projects" grid landing page (search, sort by Last updated/Name, New project button), and the project detail page's two-column layout is now three stacked sections (Chats / Project rules / Project files, with the linked-folder controls folded into Files). [SCHEMA] Added an additive `updatedAt` field to project objects for the new sort — old saved projects default to 0, no Dexie version bump.
- Files changed: `frontend/index.html`, `frontend/styles/base.css`, `frontend/app.js`, `frontend/core/store.js`, `docs/project-notes/{TASKS,CHANGES,RUNS}.md`.
- Behavior changes: New "view all projects" entry point in the sidebar (separate from the existing collapse-toggle click, which is unchanged). Project detail page's layout changed from 2-column to stacked sections — all existing controls (rename, rules, files, linked folder, delete) still present and functional, none removed. Projects now track an internal `updatedAt` timestamp, bumped on rename/rules-edit/file-add/new-chat, used only for the new grid's sort.
- Verification: `node --check` clean on `frontend/app.js` and `frontend/core/store.js`. Headless Playwright confirmed the grid, search, sort, and restructured detail page; a real page-reload test caught and confirmed the fix for a persistence bug where `updatedAt` was being silently dropped by `loadPersistedState`'s field allowlist. Zero console errors.

## 2026-07-25

- Agent: Claude Sonnet 5
- Summary: notlinear Redesign TASK-RD06 — the Settings changelog viewer now shows one date's changes at a time as a "Product story" card (hero icon, tagged change chips, Older/Newer paging, dot indicators) instead of a flat markdown dump, plus a new full-screen "Play the story" auto-advancing player reachable from that card. Chapters are mechanically built from the real CHANGELOG.md's own `## <date>` headings and `- Summary:` lines — not fabricated copy (see ADR-018 in `docs/project-notes/DECISIONS.md`).
- Files changed: `frontend/app.js`, `frontend/index.html`, `frontend/styles/base.css`, `docs/project-notes/{TASKS,DECISIONS,CHANGES,RUNS}.md`.
- Behavior changes: The Settings "View changelog" section now renders a chaptered card UI instead of the raw markdown history; the full history is still reachable via Older paging or Play the story, nothing was hidden. The bug #007 fetch-CHANGELOG.md-with-bundled-fallback mechanism is unchanged.
- Verification: `node --check frontend/app.js` clean. Headless Playwright against the real 30-entry CHANGELOG.md confirmed chapter parsing, paging, and the full-screen player's play-through-to-close behavior; zero console errors.

## 2026-07-24 (4)

- Agent: Claude Sonnet 5
- Summary: notlinear Redesign TASK-RD05 — Settings is now a centered modal dialog (dim scrim, rounded card, internal scroll) instead of a right-edge drawer. All existing settings content is unchanged — the app's real Settings has ~12 sections (API keys, SearXNG, changelog/feedback/logs viewers, etc.), well beyond the redesign's mocked 3-group example, and none of it was touched.
- Files changed: `frontend/styles/base.css`, `docs/project-notes/{TASKS,CHANGES,RUNS}.md`.
- Behavior changes: Settings now opens as a centered dialog instead of sliding in from the right edge. Same open/close triggers (gear icon, Escape, scrim click). No change to any setting's value, persistence, or the API-keys/changelog/feedback/logs sub-viewers.
- Verification: `node --check frontend/app.js` clean (no JS changed). Headless Playwright confirmed the modal centers correctly and all 12 settings sections still render; zero console errors.

## 2026-07-24 (3)

- Agent: Claude Sonnet 5
- Summary: notlinear Redesign TASK-RD04 — the Highlights and Context side panels are now floating cards inset from the top-right of the content pane (rounded corners, drop shadow) instead of full-height edge-to-edge drawers. The redesign's third target for this treatment, the branch-reply panel, was deferred rather than built — the real branch system is a multi-instance stack with its own Fragile-area history, not a single panel like the design prototype assumes (see ADR-016 in `docs/project-notes/DECISIONS.md`).
- Files changed: `frontend/styles/base.css`, `docs/project-notes/{TASKS,DECISIONS,CHANGES,RUNS}.md`.
- Behavior changes: Highlights/Context now appear as smaller floating cards near the top-right instead of full-height drawers from the right edge. Click-outside-to-close still works (existing scrim element and JS unchanged, just made visually transparent instead of a full-page dim). No change to branch panels/behavior.
- Verification: `node --check frontend/app.js` clean (no JS changed). Headless Playwright confirmed both panels' new geometry and that outside-click-to-close still works; zero console errors.

## 2026-07-24 (2)

- Agent: Claude Sonnet 5
- Summary: notlinear Redesign TASK-RD03 — the sidebar "New chat" button now has the dark-gradient/hover-lift/⌘N-kbd treatment from the redesign, and ⌘N is now a real working shortcut (there wasn't one before this — just a click handler).
- Files changed: `frontend/index.html`, `frontend/styles/base.css`, `frontend/app.js`, `docs/project-notes/{TASKS,CHANGES,RUNS}.md`.
- Behavior changes: New global ⌘N shortcut opens a new chat from anywhere in the app (mirrors the existing ⌘K search shortcut). Button visuals changed; no functional change to what "New chat" does.
- Verification: `node --check frontend/app.js` clean. Headless Playwright confirmed the new button class/gradient and that Cmd+N actually creates a new thread; zero console errors.

## 2026-07-15

- Agent: Codex
- Summary: Fixed bug #038 — when a child branch was created from inside a parent branch that was already expanded in reader mode, the parent kept `.reader` plus the reader z-layer and the child stayed visually trapped in the small stacked state. `rebalance()` now demotes any non-active reader branch before calculating the stack and orders z-index by active/ancestor role before stale reader state.
- Files changed: `frontend/app.js`, `BUGS.md`, `CHANGELOG.md`, `docs/project-notes/`.
- Behavior changes: Reader mode is now active-branch-only. Opening a child branch from an expanded parent returns the parent to a normal blurred ancestor card so the child can be expanded/read cleanly.
- Verification: `python3 -m py_compile backend/server.py` clean; `node --check frontend/app.js` clean; headless Playwright reproduced the parent-reader → child-branch stuck state before the fix, then verified the parent demotes from reader mode, child stays above it, and child expand enters reader mode with zero page errors.

## 2026-07-10

- Agent: Claude Sonnet 5
- Summary: Fixed bug #037 — expanding a branch panel into "reader" (full) mode while it had an open parent branch stacked behind it left the blurred parent as a stray, disconnected panel fragment on screen instead of staying hidden behind the expanded panel. Reproduced live with a headless Playwright (Python) session driving the running `:8765` server: branch from the doc, branch again from inside that branch (branch-from-branch, matching the user's report), then expand the front panel.
- Files changed: `frontend/app.js` (`layoutBranches`), `frontend/styles/chat.css`, `BUGS.md`, `docs/project-notes/`.
- Behavior changes: Ancestor branch panels of a reader-mode (expanded) branch are now fully hidden (`opacity:0` via new `.reader-eclipsed` class) instead of being independently repositioned by the anchor-based layout math. No change to branch data, persistence, single-instance behavior, or the "Back to parent branch" navigation.
- Verification: `node --check frontend/app.js` clean. Headless Playwright re-drive (2-level and 3-level nested branch chains) confirmed zero stray fragments before/after expand/un-expand, zero console errors.

## 2026-07-09 (part 6)

- Agent: Claude Sonnet 5
- Summary: Live-drove the app with headless Playwright (Python) to manually smoke-test the batch of uncommitted UI fixes (#026-#035, TASK-FB01-03) rather than trust the "pending human smoke test" notes at face value. Confirmed #026, #027, #029, #030, #032, #033, #034 all work as documented. Found bug #036 in the process: the app-level Escape/Enter handler referenced private `core/ui.js` variables that were never imported into `app.js`, throwing a `ReferenceError` on every Escape/Enter press and silently defeating the just-written `#031` fix (and Escape for several other panels). Fixed by exporting proper accessors from `core/ui.js`.
- Files changed: `frontend/core/ui.js`, `frontend/app.js`, `BUGS.md`, `docs/project-notes/`.
- Behavior changes: Escape now actually closes the ctx-ranking popover, delete-confirm dialog, sidebar, project panel, model/mode/main menus, ctx panel, and prefs panel again — this was silently broken before this fix.
- Verification: `node --check` clean on both files. Headless Playwright re-drive confirmed zero `pageerror` events and `display:none` on the popover after Escape.

## 2026-07-09 (part 5)

- Agent: Claude (Fable 5)
- Summary: Feedback capture v2 (TASK-FB03) — area selection, annotation, and preview-before-attach. Screenshot and Record buttons now open a two-option menu (Select area / Full screen); area capture uses `screencapture -i` (macOS crosshair; Escape cancels) and area recording `screencapture -v -i` (recording starts when the selection is released). Every capture opens a preview overlay before anything attaches: screenshots render on a canvas with a red pen (freehand draw, Undo, Clear — annotations are composited into the PNG on disk via a new upload route), recordings play in a `<video>` element. Explicit "Add to report" attaches the chip; "Discard" (or Escape) deletes the just-captured file. New `__notlinear_feedback_upload` and `__notlinear_feedback_discard` routes are path-validated to `feedback/media/` only.
- Files changed: `backend/server.py` (mode param on shot/record; cancelled detection for interactive captures; `_media_file_from_rel` guard; upload + discard routes), `frontend/core/feedback.js` (capture-mode menu, preview overlay, canvas annotation, add/discard flow), `frontend/styles/feedback.css` (menu + overlay styles).
- Behavior changes: capture buttons always go through the mode menu and the preview; nothing attaches without pressing Add. Cancelling the macOS selection (Escape) silently returns to the panel.
- Verification: `py_compile` + `node --check` pass. curl: upload/discard reject path traversal, accept media-dir paths. Headless Playwright E2E: menu → full-screen shot → preview → drew a pen stroke → Add rewrote the PNG on disk (size changed) + chip added; second capture → Discard removed the file, no chip; record → stop → video preview → Add → chip; zero console errors; overlay screenshot reviewed. Area flows exercise the native macOS picker and need the human smoke test. Test media removed; dev server restart required.

## 2026-07-09 (part 4)

- Agent: Claude (Fable 5)
- Summary: Fixed the actual reason #032–#034's Notes fixes weren't visible after reload (#035): `backend/server.py`'s `NotlinearHandler` sent no `Cache-Control` header at all, so WKWebView/Safari fell back to heuristic caching of CSS/JS that a normal reload (and sometimes even a hard refresh) didn't bust. Added an `end_headers` override sending `Cache-Control: no-store, must-revalidate` on every response.
- Files changed: `backend/server.py`, `BUGS.md`, `docs/project-notes/`.
- Behavior changes: every frontend asset (CSS, JS, HTML) now always revalidates against the server — edits show up on a plain reload going forward. Requires restarting the `:8765` dev server once to pick up the change (done this session) and relaunching the native `Notlinear.app` shell to drop its stale connection.
- Verification: `py_compile` passes; restarted the dev server and confirmed via `curl -sI` that `Cache-Control: no-store, must-revalidate` is present and the CSS body reflects the current file on disk.

## 2026-07-09 (part 3)

- Agent: Claude (Fable 5)
- Summary: Three Notes-view fixes from user bug report (#032–#034). Whole-page copy: ⌘A once selects the block, ⌘A again highlights all blocks and ⌘C copies the page as markdown-ish plain text (new `noteToText`/`blocksToText` serializers; Escape/click/typing exits). Block drag-to-reorder: the ⋮⋮ grip is now draggable with an orange insertion line above/below the hovered block; works across toggle children and columns, guarded against dropping into own descendants; grip click still opens the actions menu. Placeholder noise: "Type '/' for commands" now shows only on the focused empty text block; typed blocks (headings, lists, …) keep their always-visible labels.
- Files changed: `frontend/views/notes.js` (`wireBlockDrag`, `selectAllBlocks`/`clearBlockSel`, serializers, ⌘A escalation in `onEditorKey`, keydown/mousedown handlers in `wireGlobalListeners`), `frontend/styles/notes.css` (focus-gated text placeholder; `.dragging`/`.drop-above`/`.drop-below`/`.bsel`), `BUGS.md`, `docs/project-notes/`.
- Behavior changes: as above; no persistence/schema changes — the `notlinear-notes` Dexie db and block model are untouched (reorders go through the existing `save()`).
- Verification: `node --check` passes on notes.js. Headless Playwright drive against the running :8765 server (own IndexedDB, user data untouched): placeholder `::before` is `none` unfocused / slash hint focused; synthetic DnD moved Alpha below Charlie with the drop-below mark shown and the order surviving reload; ⌘A selected the block, second ⌘A highlighted all 3, ⌘C copied "Bravo\nCharlie\nAlpha" and cleared; Escape cleared; zero console errors. Screenshot reviewed.

## 2026-07-09 (part 2)

- Agent: Claude (Fable 5)
- Summary: Sidebar scroll fix (#030), Context Ranking popover fixes (#031), and a Settings viewer for the feedback log (TASK-FB02). The sidebar's middle now scrolls inside a new `.side-scroll` container while the brand header and settings footer stay pinned. Settings gains a "Feedback" section mirroring the Changelog pattern: a collapsible "View bugs & ideas" list showing every FEEDBACK.md entry (type badge, id, date, status, description, view/thread context, media links that open in a new tab), served by a new `__notlinear_feedback_list` route that parses FEEDBACK.md. The `.popover` border used the nonexistent `--border` token (now `--rule-2`) and Escape now closes the ctx-ranking popover.
- Files changed: `frontend/index.html` (`.side-scroll` wrapper; Feedback prefs section), `frontend/styles/base.css` (`.side-scroll`; popover border token), `frontend/app.js` (popover in Escape chain), `frontend/core/feedback.js` (settings log loader/renderer; save invalidates the cached list), `frontend/styles/feedback.css` (log entry styles), `backend/server.py` (`_feedback_parse_entries` + list route).
- Behavior changes: sidebar scrolls when content overflows; Settings → Feedback → "View bugs & ideas" lists entries newest-first, loads on first expand, refresh button re-fetches; Escape dismisses the Context Ranking popover.
- Verification: `py_compile` + `node --check` pass. Headless Playwright run: sidebar scrolled with footer pinned under injected overflow, ⌘⇧B opened the panel, settings list rendered 2 seeded entries ("1 bug · 1 idea"), ctx popover display:none on load, zero console errors. Screenshots reviewed. Seeded test entries removed. Dev server restart required for the new route.

## 2026-07-09

- Agent: Claude (Fable 5)
- Summary: Open-source plan for the core product. New root `plan.md`: extract threads + branching + Projects + context engine into a fresh public repo (clean history); Notes / Coding Projects / feedback collector stay private and move behind a `plugins/` seam on the existing view registry; phased tasks OSS-00–OSS-06 (settle tree → carve → scrub → docs → CI/Playwright smoke → cross-platform degrade → publish); Milestone 2 sketch for the VS Code branching extension (DOM-free `engine/` layer shared by web app and extension). Companion ADR-010 (proposed) records the repo-split + plugin-seam decision.
- Files changed: `plan.md` (new), `docs/project-notes/DECISIONS.md` (ADR-010), `docs/project-notes/CHANGES.md`.
- Behavior changes: none (docs only).

## 2026-07-08

- Agent: Claude (Fable 5)
- Summary: Feedback/bug collector (TASK-FB01). A persistent floating panel, toggled with ⌘⇧B (or ⌘Q in the native shell), for logging bugs and feature ideas from anywhere in the app. Bugs can attach a screenshot or a screen recording, captured OS-side via macOS `screencapture` (works identically in the native launcher and a browser tab — no getDisplayMedia). Entries append to `feedback/FEEDBACK.md` with sequential `FB-NNN` ids and `status: open`, ready for a coding agent to triage; media lands in `feedback/media/`.
- Files changed: `backend/server.py` (three new routes: `__notlinear_feedback_shot`, `__notlinear_feedback_record` start/stop, `__notlinear_feedback_save`; feedback constants + `_feedback_*` helpers; recording process guarded by a lock), `frontend/core/feedback.js` (new — panel UI, shortcuts, drag, capture calls), `frontend/styles/feedback.css` (new), `frontend/index.html` (stylesheet link), `frontend/app.js` (import + `initFeedback()` in init).
- Behavior changes: ⌘⇧B toggles the panel anywhere (⌘Q also wired, but browsers reserve it for quit — native shell only). Bug/Idea toggle; Screenshot hides the panel for the shot; Record turns into a red elapsed-time Stop button; saved entries clear the form and toast the new FB id. Panel is draggable and survives view switches. No Dexie involvement — feedback is files on disk.
- Verification: `python3 -m py_compile backend/server.py` and `node --check frontend/core/feedback.js` pass. Endpoints exercised on a test server: save (FB-001/FB-002 markdown correct), screenshot (real PNG after Screen Recording permission granted), record start→stop (real .mov), stop-without-start returns 409. Test artifacts removed. Requires macOS Screen Recording permission for the process running the server; the running dev server needs a restart to pick up the new routes.

## 2026-06-29 (continued — part 4)

- Agent: Claude (Haiku 4.5)
- Summary: Move Context Ranking from Context panel to dedicated topbar button (TASK-CTX03 refactor). User requested separate icon button instead of embedding in Context panel. New button appears as 🧠 icon in topbar, opens a small popover with ranking selector. Popover only shows when in a project chat with linked folder. Solves the "don't mix it with Context panel" issue.
- Files changed: `frontend/index.html` (remove ctx-ranking-section from Context panel, add ctx-ranking-btn topbar button, add ctx-ranking-popover modal), `frontend/app.js` (remove old renderCtxPanel ranking logic, add updateCtxRankingButton + closeCtxRankingPopover functions, wire popover handlers, call updateCtxRankingButton in renderThread), `frontend/styles/base.css` (add .popover CSS)
- Behavior changes: Context Ranking toggle is now a dedicated button with brain icon (🧠) in the topbar. Click it to open/close a small popover showing the ranking mode selector. Popover auto-populates current chat's ranking mode when opened. Same persistence and functionality as before, just different UI location.
- Verification: `node --check frontend/app.js` passes. Manual: open project chat with linked folder → button appears in topbar; click it → popover opens; select mode → saved to threadState; click again → popover closes.

## 2026-06-29 (continued — part 3)

- Agent: Claude (Haiku 4.5)
- Summary: Add visible feedback and per-chat control for context ranking (TASK-CTX03). Bug fix: `rankingLlm` pref was not persisted (reset on reload). Added per-thread `rankingMode` override in Context panel (Off / Keywords / DeepSeek / Global setting). Enhanced Sources chip with mode indicators (🧠 DeepSeek vs 📄 Keywords). Console debug logs show pipeline details (query, generated keywords, ranked files, mode). Context Ranking section only visible in project chats with linked folders.
- Files changed: `frontend/core/store.js` (add rankingLlm to persist allowlist — bug fix), `frontend/app.js` (update generateSearchKeywords/rankFilesWithDeepSeek to accept effectiveMode; update buildProjectFolderContext to accept rankingMode + return mode; update sendMain/sendBranchMsg to pass rankingMode; update runMainTurn/runBranchTurn signatures; enhance addSourcesBar calls with mode-aware labels/icons; add console.debug; wire ctx-ranking-mode handler; update renderCtxPanel), `frontend/index.html` (add Context Ranking section to ctx-panel), `docs/project-notes/` (memory updates), `CHANGELOG.md`
- Behavior changes: rankingLlm now persists across reload. Per-chat ranking mode stored in threadState (persists automatically via Dexie). Sources chip shows "(DeepSeek)" or "(keywords)" based on mode. Console logs `[notlinear:context]` object on every context request. Context Ranking section hidden for non-project chats.
- Verification: `node --check frontend/app.js` passes. Manual: enable DeepSeek in Settings → reload (should stay DeepSeek, not reset); open Context panel in project chat (should show ranking selector); change chat's ranking mode (should use different source indicator); check DevTools console for `[notlinear:context]` logs.

## 2026-06-29 (continued — part 2)

- Agent: Claude (Haiku 4.5)
- Summary: Upgrade project context to 3-step DeepSeek pipeline (TASK-CTX02). Instead of simple keyword matching, contexts now use: (1) DeepSeek expands query keywords semantically → (2) fast keyword-score pre-filter on all files → (3) DeepSeek reranks top 30 by semantic relevance. Increased max context files from 5 → 10. New "Context Ranking" settings section lets users choose between keyword-only (free, default) or DeepSeek-powered ranking (~$0.0003/query, caches aggressively). All DeepSeek calls gracefully fall back to keyword order on timeout/error/no-key.
- Files changed: `frontend/app.js` (add ranking caches + TTLs, `generateSearchKeywords()`, `rankFilesWithDeepSeek()`, rewrite `buildProjectFolderContext()` for 3-step pipeline, wire `#ranking-llm-select` handler, populate select in `renderPrefsUI()`), `frontend/core/state.js` (add `rankingLlm: 'none'` to default prefs), `frontend/index.html` (add "Context Ranking" prefs section, update DeepSeek label), `docs/project-notes/` (memory updates), `CHANGELOG.md`
- Behavior changes: `prefs.rankingLlm` controls whether DeepSeek is used (default `'none'` = opt-in). `projectKeywordCache` (30-min TTL) and `projectRankingCache` (10-min TTL) cache semantic keywords and file rankings. DeepSeek calls use direct `fetch()` to avoid `loggedFetch()` noise. `contextBlock` label reflects which mode is active.
- Verification: `node --check frontend/app.js` passes. Manual smoke test pending: enable DeepSeek ranking → send "how does auth work?" in project with `authentication.md` → confirm file appears even though "auth" wasn't in naive keywords.

## 2026-06-29 (continued — part 1)

- Agent: Claude (Haiku 4.5)
- Summary: Add project folder context injection via keyword matching (TASK-CTX01). Users can now link a local folder to a sidebar project; chats in that project automatically fetch relevant files from the folder based on keyword overlap and inject them into the system prompt. AI responses include a "Sources: file1.md, file2.md" chip showing which files were matched. Uses a 5-minute in-memory scan cache to avoid repeated backend calls.
- Files changed: `frontend/app.js` (scan cache, keyword extraction, buildProjectFolderContext, sendMain/runMainTurn/sendBranchMsg/runBranchTurn async flow, addSourcesBar, folder button handlers), `frontend/core/store.js` (project schema: add `path` field), `frontend/index.html` (Linked folder project card), `frontend/styles/chat.css` (.msg-sources styles), `docs/project-notes/` (memory updates), `CHANGELOG.md`, `BUGS.md`
- Behavior changes: Projects now carry a `path` field (graceful `|| ''` default for old saves). `buildSystemPrompt()` accepts `{ extraContext }` param; `getLLMAdapter()` threads it through. `sendMain()`, `sendBranchMsg()` are now `async` and pre-fetch folder context before calling `run*Turn()`. New "Link folder…" button in project panel; folder picker picks from filesystem; unlink clears path.
- Verification: `node --check frontend/app.js` passes. Manual smoke test complete: create project → link folder → chat in project with keywords matching .md files → Sources chip appears.

## 2026-06-29

- Agent: Claude (Haiku 4.5)
- Summary: Bug #030 — fixed Project file uploads silently failing. Clicking "Add files" in the Project panel opened the file picker, but selected files never appeared. Root cause: `triggerFilePicker` creates a hidden `<input type="file">`, calls `.click()`, then removes the element from DOM. The `ev.target.files` FileList is live and depends on the input being in the DOM; removing it made the FileList empty, so the async `readFiles` callback had nothing to read. Fix: Convert all FileList references to arrays with the spread operator (`[...ev.target.files]`) to capture File objects before any potential removal or garbage collection. Applied to `triggerFilePicker` (dynamic input) and all persistent file input handlers (#file-input-main, #folder-input-main, #file-input-branch, #folder-input-branch).
- Files changed: `frontend/app.js` (5 event handlers), `BUGS.md`, `CHANGELOG.md`, `docs/project-notes/`
- Behavior changes: None — file uploads now work reliably across all file picker surfaces.
- Verification: `node --check frontend/app.js` passes; manual smoke test pending.

## 2026-06-04

- Agent: Claude (Opus 4.8)
- Summary: Notes — added an all-pages **index** view. Clicking the **Notes** breadcrumb in the topbar (or the Notes header in the sidebar) now opens an overview that lists every note as a neat card with its icon, block count, and subpage count, nested like pages. Includes a prominent **New page** button (and a friendly empty state) for adding a note. Per-card hover actions add a subpage or delete.
- Files changed: `frontend/views/notes.js`, `frontend/styles/notes.css`, `CHANGELOG.md`, `docs/project-notes/{CHANGES,TASKS}.md`
- Behavior changes: New `state.showIndex` flag drives a `renderIndex()`/`renderIndexRow()` path; `selectNote` clears it; `showOverlay` renders the index when the flag is set or no note is selected. Additive UI only — no data/schema change; chat/branches untouched.
- Verification: `node --check frontend/views/notes.js` clean; assets HTTP 200 on :8765. Human GUI click-through pending (no headless browser available).

- Agent: Claude (Opus 4.8)
- Summary: Bug #029 — fixed Notes block content being indented ~60px to the right of the page title. The per-block hover gutter (`+` / grip handles) was an in-flow flex child (`flex:0 0 56px`), so it pushed every block's editor right of the block's left edge while the title/tags/meta sat flush in the page column. Made the gutter `position:absolute` in the left margin (`left:-52px; width:48px`) so `.content` now starts at the block's left edge, aligned under the title.
- Files changed: `frontend/styles/notes.css`, `BUGS.md`, `CHANGELOG.md`, `docs/project-notes/`
- Behavior changes: Notes block text now lines up vertically under the page title; the hover handles float into the left margin. CSS-only; no data/schema change.
- Verification: CSS-only edit; visual confirmation pending a refresh in the running app at :8765.

- Agent: Claude (Opus 4.8)
- Summary: Notes — implemented inline (text-anchored) comments. The floating-toolbar **Comment** button (previously a "coming soon" stub) now wraps the selected text in a `<span class="nt-cmt" data-cid>` and opens a thread popover for that span. Click the highlight (or the per-block comment badge) to reopen the thread, add/delete replies, or resolve (which removes the highlight and thread).
- Files changed: `frontend/views/notes.js`, `frontend/styles/notes.css`, `frontend/index.html`, `CHANGELOG.md`, `docs/project-notes/{CHANGES,RUNS,TASKS,DECISIONS}.md`
- Behavior changes: The Notes Comment toolbar button is now functional. Commentable blocks gain an optional `comments` array (threads keyed by `cid`) inside the existing `notlinear-notes` Dexie kv value, and commented text persists wrapped in `.nt-cmt[data-cid]` spans within the block HTML. No Dexie `db.version` bump; existing notes without comments are unaffected (additive, extends ADR-007). Comments are only available on text/heading/list/todo/toggle/quote/callout blocks (code blocks are `plaintext-only` and excluded). Orphaned threads (anchor text deleted) are pruned on the next render.
- Verification: `node --check` on `notes.js` clean; HTTP 200 for `frontend/index.html`, `frontend/views/notes.js`, `frontend/styles/notes.css` on :8765; the new `#nt-comments` popover present in both served and post-JS rendered DOM; headless Chrome boot showed no page/module JS errors. The interactive select-text→comment click-through remains a human GUI smoke (hard to drive headlessly).

- Agent: Claude (Opus 4.8)
- Summary: Bug #028 — fixed the branch maximize (reader) button instantly collapsing the branch instead of expanding it, most visible on nested branch-from-branch panels. `toggleReader` rewrites the maximize icon mid-click, detaching the clicked node, which defeated the branch-head guard `e.target.closest('.actions')` and let the head's `toggleCollapse` fire. Added a `.branch-head .actions` click listener that stops propagation so action-bar clicks never reach the collapse toggle.
- Files changed: `frontend/app.js`, `BUGS.md`, `CHANGELOG.md`, `docs/project-notes/`
- Behavior changes: Maximizing a branch (including nested ones) now expands and stays expanded; the collapse chevron and other header actions are unaffected.
- Verification: `node --check frontend/app.js`. Pending manual smoke confirmation in the running app.

## 2026-06-01

- Agent: Codex
- Summary: Bug #027 — fixed thread-opening actions while Notes/Coding Projects overlays are active. `renderThread(...)` now remounts the chat view after loading the requested thread, so New chat, sidebar Threads rows, project chat rows, search results, context-tree page rows, and recent-branch cross-thread opens no longer update the chat underneath an overlay.
- Files changed: `frontend/app.js`, `BUGS.md`, `CHANGELOG.md`, `docs/project-notes/`
- Behavior changes: Opening a chat thread from any route now returns the UI to the chat surface when another full-screen view is active.
- Verification: `node --check frontend/app.js`; browser smoke on local server :8796 reproduced Notes-visible state, then confirmed New chat hides `#nt-screen` and selects the new chat, and clicking `doc-main` from the Threads list hides `#nt-screen` and opens the document thread.

- Agent: Codex
- Summary: Coding Projects now shows all discovered Markdown files in the project page Files section instead of only the four convention docs. The scan endpoint adds an additive `markdownFiles` list with capped recursive `.md` previews, skipping hidden/vendor folders; the drawer opens any listed Markdown file by relative path.
- Files changed: `backend/server.py`, `frontend/views/coding-projects.js`, `frontend/styles/coding-projects.css`, `docs/project-notes/`
- Behavior changes: The Coding Projects meta strip now shows `N md files` plus the convention-doc count, and the updated timestamp can come from any discovered Markdown file. The backend scan reads Markdown files under the selected project folder, capped at 200 files and 1 MB per file, instead of only reading top-level `README/CHANGELOG/BUGS/TASKS`.
- Verification: `node --check frontend/views/coding-projects.js`; `python3 -m py_compile backend/server.py`; direct `scan_project('/Users/yash/Downloads/notlinear')` returned `markdownCount: 19`, `truncated: false`, with nested `docs/project-notes/*.md` included. Headless Playwright smoke on local server :8794 rendered 19 file cells and opened `docs/project-notes/CHANGES.md` in the drawer.

## 2026-05-28

- Agent: Codex
- Summary: Bug #026 — fixed Notes page/callout emoji picker selections closing before a click could register.
- Files changed: `frontend/views/notes.js`, `BUGS.md`, `CHANGELOG.md`, `docs/project-notes/`
- Behavior changes: Notes emoji/icon picker clicks now work from the page header and callout lead. No persistence schema or Dexie version changes.
- Verification: `node --check frontend/views/notes.js`, `frontend/app.js`, and `frontend/core/emoji.js`; local HTTP 200 for `frontend/index.html`, `frontend/views/notes.js`, and `frontend/core/emoji.js` on :8793. Browser-control tooling was unavailable in this session, so full GUI smoke remains pending.

- Agent: Codex
- Summary: Notes cleanup controls — removed the first-run demo note seeding, made an empty Notes database persist as empty, and added explicit trash actions for per-note deletion plus a Notes-header "delete all notes" control.
- Files changed: `frontend/views/notes.js`, `frontend/styles/notes.css`, `frontend/index.html`, `CHANGELOG.md`, `docs/project-notes/`
- Behavior changes: Fresh Notes now opens empty instead of creating the Research / Architecture / Daily journal sample pages. Deleting notes writes immediately to the separate `notlinear-notes` Dexie database, so deleted notes do not reappear after reload. Existing chat/threads persistence is untouched.
- Verification: `node --check frontend/views/notes.js`; `node --check frontend/app.js`; local HTTP 200 for `frontend/index.html`, `frontend/views/notes.js`, and `frontend/styles/notes.css` on :8792; headless Playwright smoke passed for empty first-load, note creation, per-note delete, delete-all, and reload persistence.

- Agent: Claude (Opus 4.7)
- Summary: Notes view — full Notion-style notebook (per `notes_product.md` PRD, §§3–§20 v1 acceptance). New top-level sidebar section "Notes" with a collapsible tree (rigid 4-col grid: chevron / emoji / label / actions; 14px-per-depth indent; hover-only `+`/`⋯`), and a full-screen overlay `#nt-screen` with breadcrumb topbar, emoji/title/tags/meta header, and a block editor supporting text / h1–h4 / bullet / numbered / todo / toggle (+ heading variants) / quote / callout / divider / code (lang picker, copy) / equation / image (click + drag, dataURL persist) / table / 2- and 3-column / page-link. Slash menu (caret-anchored, filterable, keyboard-navigable, markdown-shortcut autoconverts at start of empty text: `# `, `## `, `- `, `1. `, `[] `, `> `, `--- `, …). Floating format toolbar with B/I/U/S, inline code, color (5 palette) + highlight (5 palette) pickers, "Turn into…", link, comments placeholder; ⌘B/⌘I/⌘U/⌘E/⌘⇧H shortcuts. Emoji popover (8-col grid + random/remove) for page emoji and callout lead.
- Files changed: `frontend/views/notes.js` (new), `frontend/styles/notes.css` (new), `frontend/index.html` (+CSS link, Notes sidebar section, `.nt-screen` overlay + slash + ftoolbar markup), `frontend/app.js` (import + `initNotes()` call), `CHANGELOG.md`, `docs/project-notes/`
- Behavior changes: [SCHEMA] Adds a new Dexie database `notlinear-notes` (separate from the existing `notlinear` db) with a `kv` store holding `nl_notes_v1` (notes array), `nl_notes_selected_v1` (last-opened id), and `nl_notes_open_v1` (expanded sidebar branches). Includes a one-time migration that imports any pre-existing `nl_notes_v1` localStorage payload then clears it. The existing `notlinear` Dexie schema is untouched — chat/threads/projects state is unaffected. Seeds 5 example notes on first run.
- Verification: Pending human smoke test. Static checks: notes.js node --check clean; index.html and notes.css served 200; sidebar entry, overlay shell, slash menu, ftoolbar markup, and color/highlight pickers all wired against `nt-*` IDs.

## 2026-05-26

- Agent: Claude (Opus 4.7)
- Summary: Sidebar collapse + emojis everywhere. (1) New shared `frontend/core/emoji.js` — one searchable emoji picker and a curated list expanded from 12 → ~190 glyphs (type to search by keyword, or paste any emoji). Coding Projects now imports it instead of its old 12-item local list. (2) Projects, Threads, and Recent branches sidebar sections are now collapsible (caret + persisted `nl_side_collapsed_v1` localStorage key), matching the existing Coding Projects section. Threads are now wrapped in `#threads-list`. (3) Per-item emoji: every thread row and project row has a clickable leading glyph that opens the picker; the chosen emoji is stored on `threadState[id].emoji` / `projects[pid].emoji` and persisted via the existing `persistAll`. (4) Emoji insertion on the document page: a 😊 button in the doc action row inserts at the caret in `#doc-content`, and a chip in the composer inserts into the message textarea.
- Files changed: `frontend/core/emoji.js` (new), `frontend/views/coding-projects.js`, `frontend/app.js`, `frontend/index.html`, `frontend/styles/base.css`, `frontend/styles/coding-projects.css`, `CHANGELOG.md`
- Behavior changes: additive and backward-compatible — emoji fields are optional (rows fall back to their default Tabler icon), collapse state defaults to expanded. No schema reset required (new optional fields on existing persisted objects).

- Agent: Claude (Opus 4.7)
- Summary: Bug #025 — Coding Projects "create" buttons (missing-file blocks) rendered as clipped 32px squares with the label overflowing. Root cause: the button used the `ghost` (icon-only square) variant of `.cp-btn`; dropped `ghost` so it uses the base text-button style. Also restarted the stale `backend/server.py` on :8765 (predated the CP01 scan endpoint and 404'd — which is what produced the "scan failed" state that surfaced all four buttons at once).
- Files changed: `frontend/views/coding-projects.js`, `BUGS.md`, `docs/project-notes/`
- Behavior changes: none (visual fix only). The scan-endpoint 404 was an operational stale-process issue, not a code change.

- Agent: Claude (Opus 4.7)
- Summary: Bug #024 — Toasts were hidden behind the Coding Projects overlay (`.toast` z-index 300 < overlay 400), making the add-folder browse button and other actions appear to do nothing. Raised `.toast` z-index 300 → 500. Note: the add-folder native picker also requires restarting `backend/server.py` (the running process predates the CP01 endpoint and 404s — a server restart, not a code fix).
- Files changed: `frontend/styles/base.css`, `BUGS.md`, `docs/project-notes/`
- Behavior changes: Toasts now render above the overlay and all panels (global, also benefits chat).

- Agent: Claude (Opus 4.7)
- Summary: TASK-CP07 — Coding Projects add-project popover + emoji picker + default theme → light (final v1 phase). Add-project popover (folder path + browse-via-native-picker, optional display name, 12-emoji icon strip; "add project" disabled until a path is entered; Enter submits; prepends the project; toast "added <name>") triggered from the list "+ add folder", the empty-state CTA, and the sidebar "+". Reusable emoji picker (12 curated + paste-any-emoji input) wired to the list-row emoji, the project-page header emoji, and the add popover; selecting persists and toasts "icon updated". Refactored popover plumbing into a shared `attachFloater`. Default theme flipped to light: bootstrap reads `nl_theme` and falls back to `light`; `renderPrefsUI` defaults to `light` when `prefs.theme` is unset.
- Files changed: `frontend/views/coding-projects.js`, `frontend/styles/coding-projects.css`, `frontend/index.html` (bootstrap), `frontend/app.js` (theme default), `CHANGELOG.md`, `docs/project-notes/`
- Behavior changes: Default theme is now LIGHT for profiles with no saved `nl_theme` (PRD §9) — existing users with a saved theme are unaffected. "+ add folder" now opens a popover instead of going straight to the native picker (the picker is the popover's browse button).
- Verification: Pending human smoke test. Static checks: ES-module parse clean; no dangling refs; app.js + module + CSS + index serve 200; bootstrap default confirmed `||'light'`.

- Agent: Claude (Opus 4.7)
- Summary: TASK-CP06 — Coding Projects comments. Per-project notes stored in `localStorage` (`nl_cp_comments_v1` = `{[projectId]: Comment[]}`). Two surfaces: a list-row 💬 popover (chronological oldest→newest, anchored to the chip, viewport-clamped) and a project-page "notes & comments" thread (newest→oldest). Each comment: gradient-avatar initial · name · relative time · hover-delete (toast "comment deleted") · body (line breaks preserved). Composer auto-grows to 120px; ⌘/Ctrl+↵ posts. Counts on the row chip and page header stay in sync. Escape/back closes the popover first.
- Files changed: `frontend/views/coding-projects.js`, `frontend/styles/coding-projects.css`, `CHANGELOG.md`, `docs/project-notes/`
- Observed: the running dev server on :8765 was stale (started before CP01) and returned 404 for `/__notlinear_pick_folder`, so "add folder" did nothing. Hardened `pickAndAdd` to detect 404/501 and toast "restart the server …"; root fix is restarting `backend/server.py`. No server code changed.
- Behavior changes: List-row 💬 is now an interactive button. No chat code touched.
- Verification: Pending human smoke test. Static checks: ES-module parse clean; files serve 200.

- Agent: Claude (Opus 4.7)
- Summary: TASK-CP05 — Coding Projects file preview drawer (read-only). Clicking a present file cell on the project page opens a right-side floating drawer (`#cp-drawer`, reuses `--drawer-w`/`--drawer-gap`, z-index 410 above the overlay): header shows the mono full file path + size + reveal-in-Finder (stub) + close; body renders the file's markdown via `renderMarkdown`; `.cp-scroll` shifts left (`margin-right`) so nothing is occluded. Closes on the X, Escape, the back button, or clicking outside. Drawer is independent of the page nav.
- Files changed: `frontend/index.html` (drawer markup), `frontend/styles/coding-projects.css`, `frontend/views/coding-projects.js`, `CHANGELOG.md`, `docs/project-notes/`
- Behavior changes: File cells on the project page now open the drawer (were toast stubs). Escape priority is drawer → page→list → chat. No chat code touched.
- Verification: Pending human smoke test. Static checks: ES-module parse clean; files serve 200; drawer markup present in index.html.

- Agent: Claude (Opus 4.7)
- Summary: TASK-CP04 — Coding Projects project page. Clicking a list row (or a sidebar project) now opens a full project page in the overlay: editable title (blur/Enter persists to the registry; toast "renamed"), large emoji, mono path, a meta strip (`N/4 docs · M open bugs · updated … · manual`), and blocks in PRD order — files (2×2 grid, present cells clickable, missing cells dimmed + strikethrough), bugs, tasks, changelog, overview — rendered via the shared `renderMarkdown`. Missing files show a dashed "no <file>.md yet" callout with a create stub. Navigation: breadcrumb gains a "coding projects" link; back button and Escape are context-aware (page → list → chat). File drawer (CP05), comments (CP06), and emoji picker (CP07) are wired as toasts for now.
- Files changed: `frontend/views/coding-projects.js`, `frontend/styles/coding-projects.css`, `CHANGELOG.md`, `docs/project-notes/`
- Behavior changes: List rows and sidebar projects now open a page instead of toasting. No chat code touched.
- Verification: Pending human smoke test. Static checks: ES-module parse clean; files serve 200.

- Agent: Claude (Opus 4.7)
- Summary: TASK-CP03b — Switched the Coding Projects status-sentence provider from Claude (Haiku) to DeepSeek per user request. Isolated non-streaming POST to `https://api.deepseek.com/v1/chat/completions` (model `deepseek-chat`, `Authorization: Bearer`, OpenAI-compatible response shape), reusing `appState.apiKeys.deepseek`. Still does not touch `appState._activeController`; still mtime-cached with heuristic fallback. ADR-005 updated.
- Files changed: `frontend/views/coding-projects.js`, `docs/project-notes/DECISIONS.md` (ADR-005)
- Behavior changes: Status sentence now requires a DeepSeek key (not Anthropic) for LLM generation; heuristic fallback unchanged.

- Agent: Claude (Opus 4.7)
- Summary: TASK-CP03 — Coding Projects list view. Fleshed out `frontend/views/coding-projects.js`: a localStorage project registry (`nl_cp_projects_v1`), a per-project filesystem scan via the CP01 `/__notlinear_scan_project` endpoint, derived metadata (open-bug count from `- [ ]` checkboxes, last-updated from max file mtime, missing-file count, needs-attention flag), and a synthesized status sentence. Status uses an isolated non-streaming Claude (Haiku) call cached by file mtime in `nl_cp_status_cache_v1` (ADR-005), with a local heuristic fallback when no key/offline. Added list + gallery layouts, an empty state, a minimal "add folder" flow via `/__notlinear_pick_folder`, rescan, and a sidebar project list. Row click toasts a CP04 placeholder.
- Files changed: `frontend/views/coding-projects.js`, `frontend/styles/coding-projects.css`, `CHANGELOG.md`, `docs/project-notes/`
- Behavior changes: The "coding projects" sidebar section now lists added projects and the overlay shows a real list. Status-sentence generation makes a Haiku API call per project on first scan (then mtime-cached); falls back to a local heuristic with no key. No chat code touched.
- Verification: Pending human smoke test. Static checks done: ES-module parse clean; files serve 200; scan endpoint + open-bug regex validated against this repo.

- Agent: Claude (Opus 4.7)
- Summary: TASK-CP02 — Coding Projects shell seam (ADR-006). Added a full-screen overlay `#cp-screen` (mirrors `.project-screen`), a new `frontend/styles/coding-projects.css`, and a self-registering `frontend/views/coding-projects.js` view (`mount` shows the overlay, `unmount` hides it). Added a collapsible "coding projects" sidebar launcher section; its collapse state persists in `nl_cp_side_collapsed_v1`. Overlay opens from the section, closes via back button or Escape. CP02 renders a placeholder; the real list arrives in CP03.
- Files changed: `frontend/index.html` (CSS link + sidebar section + overlay markup), `frontend/styles/coding-projects.css` (new), `frontend/views/coding-projects.js` (new), `frontend/app.js` (import + `initCodingProjects()`), `CHANGELOG.md`, `docs/project-notes/`
- Behavior changes: New sidebar section "coding projects" between Projects and Threads. Escape now also closes the Coding Projects overlay when it is the active surface. Chat DOM and handlers are untouched (overlay sits on top), so all Fragile branch behavior is unaffected by construction.
- Verification: Pending human smoke test (AGENTS.md 10-item + hard branch exercise + open/close overlay over chat). Static checks done: ES-module syntax parse clean; all new files + app.js + index.html serve HTTP 200; index.html carries the new hooks.

- Agent: Claude (Opus 4.7)
- Summary: TASK-CP01 — Added two additive read-only backend endpoints for Coding Projects. `/__notlinear_pick_folder` runs osascript `choose folder` and returns `{ok, path}`. `/__notlinear_scan_project` takes `{path}` and returns the folder name, a shallow (non-recursive) top-level listing, and the parsed text + metadata of the four convention files (README/CHANGELOG/BUGS/TASKS, case-insensitive, optional `.md`). Reads are confined to the given dir (filenames from os.scandir, never caller input), size-capped at 1 MB/file, listing capped at 500 entries.
- Files changed: `backend/server.py`, `CHANGELOG.md`, `docs/project-notes/`
- Behavior changes: None to existing flows. Both endpoints are new and additive; `/__notlinear_open_files`, `/__notlinear_save_file`, `/__notlinear_runtime_logs` unchanged.
- Observed: README/CHANGELOG/BUGS present at repo root; no root TASKS.md (TASKS.md lives under docs/project-notes/), so scan reports tasks `{present:false}` — expected.

- Agent: Claude (Opus 4.7)
- Summary: TASK-CP00 — Started the Coding Projects feature. Recorded ADR-003 (real filesystem via new additive backend endpoints, shallow folder listing in scan), ADR-004 (feature state in localStorage, Dexie untouched), ADR-005 (LLM-generated status sentence cached by file mtime). Seeded CP00–CP07 in TASKS.md. No app code changed.
- Files changed: `docs/project-notes/DECISIONS.md`, `docs/project-notes/TASKS.md`, `docs/project-notes/CHANGES.md`, `docs/project-notes/RUNS.md`, `CHANGELOG.md`
- Behavior changes: None (docs only).

## 2026-05-24

- Agent: Claude (Sonnet 4.6)
- Summary: TASK-M04 — Lift shared state into core/state.js. Created `frontend/core/state.js` exporting `appState`. Updated `app.js`: 7 primitives (currentThreadId, activeBranchId, etc., 143 total refs) → `appState.X`; 11 objects/arrays (threadState, branches, prefs, etc.) → const alias pattern. No logic changed.
- Files changed: `frontend/core/state.js` (new), `frontend/app.js`, `CHANGELOG.md`, `docs/project-notes/`
- Behavior changes: None. All Fragile areas (branch reopen, persist, tool status) preserved — same object references, same logic.

- Agent: Claude (Sonnet 4.6)
- Summary: TASK-M03 — Externalize JS. Moved 6,326-line `<script>` block into `frontend/app.js` as an ES module (`<script type="module" src="./app.js">`). Stripped outer IIFE wrapper; module scope replaces it. No logic changed.
- Files changed: `frontend/index.html`, `frontend/app.js` (new), `CHANGELOG.md`, `docs/project-notes/`
- Behavior changes: None. CDN globals (Dexie, mermaid) available before module executes per document order.

- Agent: Claude (Sonnet 4.6)
- Summary: TASK-M02 — Extract CSS. Moved 650-line `<style>` block into `frontend/styles/tokens.css` (design tokens), `frontend/styles/base.css` (layout/chrome), `frontend/styles/chat.css` (chat/branches/composer). No CSS rules changed.
- Files changed: `frontend/index.html`, `frontend/styles/tokens.css` (new), `frontend/styles/base.css` (new), `frontend/styles/chat.css` (new), `CHANGELOG.md`, `docs/project-notes/`
- Behavior changes: None — pure file split, zero rule changes. Bug #022 (highlights light-mode) preserved: all highlight classes use CSS variables only.

- Agent: Claude (Sonnet 4.6)
- Summary: TASK-M01 — Folder split. Introduced `backend/server.py` and `frontend/index.html`. Server now serves from repo root so `CHANGELOG.md` and `logs.md` are accessible at their root paths. `notlinear_server.py` and `notlinear.html` kept at root as compatibility shims for the compiled `.app` binary.
- Files changed: `backend/server.py` (new), `frontend/index.html` (new), `notlinear_server.py` (shim), `notlinear.html` (redirect), `launchers/Notlinear.applescript`, `launchers/Notlinear.command`, `launchers/NotlinearNative.swift`, `CHANGELOG.md`, `docs/project-notes/`
- Behavior changes: App URL changes from `http://127.0.0.1:8765/notlinear.html` to `http://127.0.0.1:8765/frontend/index.html` for direct/script launchers. The compiled `.app` binary still opens `/notlinear.html` which now meta-refreshes to `frontend/index.html` — behavior identical, one redirect hop added. Changelog fetch changed from relative `CHANGELOG.md` to absolute `/CHANGELOG.md` (same file, no functional difference). `logs.md` still written to repo root. Swift source updated; binary needs a rebuild in Xcode to skip the redirect hop.

- Agent: Claude (Sonnet 4.6)
- Summary: TASK-M00 — Migration baseline commit and project-memory scaffolding. Created `docs/project-notes/` with `TASKS.md` (M00–M06 seeded), `RUNS.md`, `CHANGES.md`, `DECISIONS.md`. Recorded two ADRs. Committed working monolith as revertible baseline (commit d47bd96).
- Files changed: `docs/project-notes/TASKS.md` (new), `docs/project-notes/RUNS.md` (new), `docs/project-notes/CHANGES.md` (new), `docs/project-notes/DECISIONS.md` (new), `CHANGELOG.md`
- Behavior changes: None — no app files touched.

## 2026-05-22

- Agent: Claude (Opus 4.7)
- Summary: [SCHEMA] Added Projects — group chats under a project, give a project shared knowledge files and custom rules, and the AI applies both to every chat in the project. Phase 2 of the Projects + intent feature.
- Files changed: `notlinear.html`, `CHANGELOG.md`
- Behavior changes: New "Projects" section in the left sidebar with a "+" to create projects; each project opens a settings panel (name, rules textarea, files, and its chat list with "New chat in this project"). Chat→project membership lives on `threadState[id].projectId` (single source of truth); project entities live in a new top-level `projects` map. `buildSystemPrompt` now appends, for any chat in a project: the project name, the project rules, and the project files' extracted text (reusing `buildAttachmentContext`) — so rules + files apply on every call for that chat and its branches, with no per-turn re-send. Project chats are hidden from the flat Threads list and reached via the project panel (`syncThreadRowVisibility`). Deleting a project keeps its chats and moves them back to Threads.
- Schema: `persistAll` now writes `projects` and `projectCount`; `threadState[*]` may carry an optional `projectId`. `loadPersistedState` restores them and is backward-compatible — older saved state has no `projects`, so all chats load as ungrouped (no migration of existing data required, no Dexie version bump). Project files are stored with base64 stripped (only extracted text is kept) to keep the single persisted state record small.
- Note: `triggerFilePicker` gained an additive optional `onFiles` callback (default path unchanged) so project files reuse the existing native/browser file picker. Interactive verification (create project → add file → set rules → new chat → confirm the AI uses them) needs API keys and human testing.

- Agent: Claude (Opus 4.7)
- Summary: Added a manual conversation-mode switch (General / Research / Coding) in the composer to steer intent. Phase 1 of a larger Projects + intent feature; Projects layer (grouped chats, project files, project rules) is planned as a separate change.
- Files changed: `notlinear.html`, `CHANGELOG.md`
- Behavior changes: New mode chip next to the model picker. `prefs.mode` (default `'general'`) is persisted in the `persistAll` prefs whitelist — additive field, no schema migration needed (absent → `'general'` on load). `buildSystemPrompt` now appends mode-specific guidance: **Research** adds search-first / cross-check / always-cite instructions; **Coding** adds idiomatic-code / fenced-block / search-only-for-current-docs instructions. **General mode is unchanged** — no guidance strings were removed or weakened, so existing default behavior is byte-identical. Mode is global (applies to main chat and all branches via the shared system prompt).
- Note: Per the `system-prompt` skill, a before/after model-output comparison should be run on a Research and a Coding prompt to confirm the steering reads well; this needs API keys and human verification.

- Agent: Kimi (k2.6)
- Summary: Auto-fallback to DeepSeek when Claude is rate-limited in main thread and branch turns.
- Files changed: `notlinear.html`, `CHANGELOG.md`, `BUGS.md`
- Behavior changes: When a Claude request returns a 429/rate-limit error and a DeepSeek API key is configured, the app now automatically switches the adapter to DeepSeek and retries once instead of showing a non-functional "Try again" button.

## 2026-05-10

- Agent: Kimi (k2.6)
- Summary: Clicking a branch in the right sidebar Hierarchy now scrolls the main text to the branch's anchor location.
- Files changed: `notlinear.html`, `CHANGELOG.md`
- Behavior changes: `openCtxBranch` now calls `scrollIntoView({ block:'center', behavior:'smooth' })` on the `.branched` anchor element for both existing and newly opened branches.

## 2026-05-09

- Agent: Kimi (k2.6)
- Summary: Fixed unreadable highlight text in the Highlights panel when using light mode (bug #022).
- Files changed: `notlinear.html`, `BUGS.md`, `CHANGELOG.md`

## 2026-05-08

- Agent: Kimi (k2.6)
- Summary: Fixed attach menu "Add files / Add folder" not opening the file picker in the native macOS app (bug #021).
- Files changed: `notlinear.html`, `BUGS.md`, `CHANGELOG.md`

- Agent: Claude (Sonnet 4.6)
- Summary: Modularised LLM dispatch so any provider works in both main thread and branches. Added OpenAI (GPT-4o, GPT-4o Mini) and Google Gemini (2.0 Flash, 2.5 Pro) as selectable models. Branches now respect the user's model preference instead of a hardcoded API-key heuristic.
- Files changed: `notlinear.html`, `CHANGELOG.md`
- Behavior changes: `runBranchTurn` now calls whichever model is selected in `prefs.model` (via `getLLMAdapter`) instead of preferring DeepSeek whenever a DeepSeek key is present. The branch model chip now always shows the active model label instead of a fixed "DeepSeek" label. A new `callOpenAICompatible` base function handles OpenAI-format streaming for OpenAI and Gemini; `callOpenAI` and `callGemini` are thin wrappers over it. `getLLMAdapter(pref)` is the single dispatch point — add a new provider by adding one call function and one entry there.

- Agent: Kimi (k2.6)
- Summary: Auto-link bare URLs in rendered markdown so references and other plain-text links are clickable.
- Files changed: `notlinear.html`, `CHANGELOG.md`

## 2026-05-08

- Agent: Claude (Sonnet 4.6)
- Summary: Fixed expanded branch panels not hiding when anchor text scrolls out of view (bug #020). Branch panels now show/hide in sync with their anchor's scroll visibility.
- Files changed: `notlinear.html`, `BUGS.md`, `CHANGELOG.md`

- Agent: Claude (Sonnet 4.6)
- Summary: Fixed DeepSeek tool-result fallback being in the wrong function (bug #018) and stopped branch close/switch from aborting in-flight searches (bug #019).
- Files changed: `notlinear.html`, `BUGS.md`, `CHANGELOG.md`
- Behavior changes: When a DeepSeek synthesis is aborted (user stop, branch close, panel switch), retrieved tool results are now shown as a fallback answer instead of being lost. Closing a branch panel or opening another branch no longer aborts an in-flight DeepSeek search; the search completes in the background and is saved to the branch snapshot so it is visible when the branch is reopened. Explicit branch deletion still aborts the request.



- Agent: Codex
- Summary: Preserved retrieved branch tool results when a DeepSeek synthesis request is locally aborted after search succeeds.
- Files changed: `notlinear.html`, `BUGS.md`, `CHANGELOG.md`
- Behavior changes: DeepSeek branch abort logs now include an abort reason when available; post-tool synthesis aborts with too little answer text complete with the retrieved-results fallback instead of leaving a tiny stopped partial response.

- Agent: Codex
- Summary: Filtered DeepSeek DSML-style pseudo-tool-call markup out of branch answers during forced synthesis.
- Files changed: `notlinear.html`, `BUGS.md`, `CHANGELOG.md`
- Behavior changes: DeepSeek synthesis-only responses now suppress raw tool-call markup before it reaches the chat UI and fall back to retrieved tool results if the filtered answer is otherwise too thin.

- Agent: Codex
- Summary: Added local `logs.md` syncing for runtime request logs and capped DeepSeek branch tool loops so search-backed branches synthesize after bounded research.
- Files changed: `notlinear.html`, `notlinear_server.py`, `logs.md`, `BUGS.md`, `CHANGELOG.md`, `launchers/Notlinear.command`, `launchers/Notlinear.applescript`, `launchers/NotlinearNative.swift`, `launchers/NotlinearNative.m`
- Behavior changes: Launchers now start `notlinear_server.py` instead of plain `python3 -m http.server`; when served by that local server, Runtime logs automatically sync the latest 300 events into `logs.md`. DeepSeek branch research can use at most two tool rounds before the app forces a synthesis-only model request.

## 2026-05-07

- Agent: Codex
- Summary: Fixed URL reads and search result parsing so response bodies are covered by the same timeouts as the initial tool request.
- Files changed: `notlinear.html`, `BUGS.md`, `CHANGELOG.md`
- Behavior changes: Tool calls that receive headers but stall while reading text/JSON now time out and surface a tool error instead of leaving the branch on "Reading closely".

- Agent: Codex
- Summary: Added a parent-branch navigation button to nested branch panels so users can jump back one branch level.
- Files changed: `notlinear.html`, `CHANGELOG.md`
- Behavior changes: Nested branch headers now show a small back-to-parent button that opens the immediate parent branch through the existing single-panel branch open path.

- Agent: Codex
- Summary: Fixed nested branch depth labels so context-tree opens and restored branch panels use the actual parent-chain level instead of stale stored depth.
- Files changed: `notlinear.html`, `BUGS.md`, `CHANGELOG.md`
- Behavior changes: Branch headers opened from context, recents, or saved snapshots now show corrected depth when stored depth disagrees with the branch parent chain.

- Agent: Codex
- Summary: Added runtime backend logging for HTTP requests, tool calls, and LLM turns, plus a settings log viewer and `logs.md` debugging reference.
- Files changed: `notlinear.html`, `logs.md`, `CHANGELOG.md`
- Behavior changes: Settings now includes a Runtime logs panel; runtime request logs keep the latest 300 events instead of the previous 100.

- Agent: Codex
- Summary: Added explicit model guidance to end sourced answers with a numbered References section.
- Files changed: `notlinear.html`, `CHANGELOG.md`
- Behavior changes: Tool-backed or source-backed model answers should now end with numbered references for the sources actually used, instead of only brief inline citations.

- Agent: Codex
- Summary: Fixed branch search getting stuck after results return by surfacing retrieved tool results when DeepSeek stalls during the follow-up synthesis call.
- Files changed: `notlinear.html`, `BUGS.md`, `CHANGELOG.md`
- Behavior changes: DeepSeek branch searches now wait up to 30 seconds for post-search synthesis; if that stream stalls before producing answer text, the branch shows the retrieved results instead of spinning indefinitely.

- Agent: Codex
- Summary: Cleared stale branch/search working status as soon as answer text begins streaming so completed search phases no longer appear to spin above the response.
- Files changed: `notlinear.html`, `BUGS.md`, `CHANGELOG.md`
- Behavior changes: The tool/search status line now disappears when response text starts instead of staying visible until the model call fully completes.

- Agent: Claude (Opus 4.7)
- Summary: Restructured skills to follow Anthropic's SKILL.md convention. All five SKILL.md files now have YAML frontmatter (name + description) and trigger-focused descriptions. Added `references/` folder under `skills/branch-system/` with three deep-dive files (`functions.md`, `snapshot-protocol.md`, `failure-modes.md`) extracted from the original SKILL.md body to support progressive disclosure as that skill grows. Updated `AGENTS.md` to document the new skill structure (frontmatter, references folders, when to load referenced files).
- Files changed: `AGENTS.md`, `CHANGELOG.md`, `skills/bug-fixing/SKILL.md`, `skills/branch-system/SKILL.md`, `skills/branch-system/references/functions.md`, `skills/branch-system/references/snapshot-protocol.md`, `skills/branch-system/references/failure-modes.md`, `skills/persistence/SKILL.md`, `skills/tool-runners/SKILL.md`, `skills/system-prompt/SKILL.md`
- Behavior changes: none — no code in `notlinear.html` was modified.

- Agent: Claude (Opus 4.7)
- Summary: Established institutional-memory infrastructure for multi-agent collaboration. Rewrote `AGENTS.md` to add scope, read-before-write, and behavior-change rules. Added `BUGS.md` as an append-only bug log with a Fragile areas section, backfilled from prior changelog entries. Added `skills/` folder with five area-specific skill files (`bug-fixing`, `branch-system`, `persistence`, `tool-runners`, `system-prompt`).
- Files changed: `AGENTS.md`, `BUGS.md`, `CHANGELOG.md`, `skills/bug-fixing/SKILL.md`, `skills/branch-system/SKILL.md`, `skills/persistence/SKILL.md`, `skills/tool-runners/SKILL.md`, `skills/system-prompt/SKILL.md`
- Behavior changes: none — no code in `notlinear.html` was modified.

- Agent: Codex
- Summary: Normalized branch answer Markdown rendering so compact model output separates numbered items and field labels instead of collapsing into dense paragraphs.
- Files changed: `notlinear.html`, `CHANGELOG.md`

- Agent: Codex
- Summary: Fixed branch markers inside branch panels so child and nested child branches reopen when clicked.
- Files changed: `notlinear.html`, `CHANGELOG.md`

- Agent: Codex
- Summary: Replaced the single diagonal branch resize grip with directional edge handles for upward, downward, sideways, and corner resizing.
- Files changed: `notlinear.html`, `CHANGELOG.md`

- Agent: Codex
- Summary: Made branch panels single-instance, added manual resize controls, and tightened the default branch modal spacing to remove empty white space.
- Files changed: `notlinear.html`, `CHANGELOG.md`

- Agent: Codex
- Summary: Added branch deletion from branch panels, Recent branches, and the context tree, including persisted cleanup for deleted branch records.
- Files changed: `notlinear.html`, `CHANGELOG.md`

- Agent: Codex
- Summary: Replaced the static Recent branches sidebar rows with a dynamic persisted list that opens branches from the sidebar.
- Files changed: `notlinear.html`, `CHANGELOG.md`

- Agent: Codex
- Summary: Added repository instructions requiring every AI model that changes files to update this changelog.
- Files changed: `AGENTS.md`, `CHANGELOG.md`

- Agent: Codex
- Summary: Added a settings changelog viewer that can read `CHANGELOG.md` from inside the app, with a bundled fallback for local file access limits.
- Files changed: `notlinear.html`, `CHANGELOG.md`

- Agent: Codex
- Summary: Fixed branch chat persistence so branch conversations with content are snapshotted before switching chats.
- Files changed: `notlinear.html`, `CHANGELOG.md`

- Agent: Codex
- Summary: Prevented quote-only branch reopen flows from overwriting saved branch conversations.
- Files changed: `notlinear.html`, `CHANGELOG.md`

- Agent: Codex
- Summary: Made branch research faster by preferring quick search snippets for broad entity questions and shortening external tool timeouts.
- Files changed: `notlinear.html`, `CHANGELOG.md`

## 2026-05-08

- Agent: Kimi (k2.6)
- Summary: Removed the topbar settings, share, and edge-toggle buttons, leaving only Context & files and Highlights.
- Files changed: `notlinear.html`, `CHANGELOG.md`
