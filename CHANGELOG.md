# Changelog

All notable repository changes made by AI agents should be recorded here.

## 2026-05-26

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
