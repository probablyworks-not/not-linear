# Changelog

All notable repository changes made by AI agents should be recorded here.

## 2026-05-24

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
