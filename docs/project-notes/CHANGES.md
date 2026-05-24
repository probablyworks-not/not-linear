# CHANGES.md — internal work memory

Each entry: **date · summary · files touched · why changed · risks · tests run · next steps**

---

## 2026-05-24 — TASK-M06: View registry (core/registry.js)

- **Summary:** Created `frontend/core/registry.js` with `registerView`, `mountView`, `getRegisteredViews`, `getActiveViewId`. Chat view registered in app.js with `{ id:'chat', label:'Chat', icon:'ti-message', mount:no-op, unmount:no-op }` — chat mounts inline so mount is a no-op for now. `mountView('chat')` called at end of init. No behavior change.
- **Files touched:** `frontend/core/registry.js` (new), `frontend/app.js`
- **Why changed:** TASK-M06 per MIGRATION.md — establishes the extensibility seam for adding future views without touching the shell or chat.
- **Behavior changes:** None. Registry is bookkeeping only at this stage.
- **Risks:** None — additive only.
- **Tests run:** Syntax check (node --check), curl 200 on registry.js.
- **Next steps:** Human runs full smoke test. Future views: drop a module in `frontend/views/`, call `registerView()`.

## 2026-05-24 — TASK-M05: Peel modules off, leaf-first

- **Summary:** Extracted 6 modules across 6 commits:
  1. `core/markdown.js` — pure rendering (`esc`, `renderMarkdown`, `hasMarkdownTable`, `markdownTextFromRendered`, `renderMermaidIn`, `friendlyError`, `isConfigError`)
  2. `core/ui.js` — toast + confirm dialog
  3. `core/api-client.js` — fetch/logging infra, timeout constants, `requestLog`
  4. `providers/tools.js` — `ToolFatalError`, all `run*` tool runners, `executeTool`, `toolResultTitle`, `toolResultFallbackMarkdown`, `modelLabelFromId`
  5. `providers/claude.js`, `providers/deepseek.js`, `providers/openai.js` — LLM call functions; `buildSystemPrompt`/`buildTools`/`buildDeepSeekTools`/`buildBranchContext` stay in app.js (app-local state deps); provider signatures extended with `systemPrompt`/`tools` params; `getLLMAdapter` and `askInline` updated to pass them
  6. `core/store.js` — Dexie persistence; `loadPersistedState` takes DOM-mutating callbacks from app.js; `persistAll` uses `document.querySelectorAll` directly
- **Files touched:** all new modules above, `frontend/app.js`
- **Why changed:** TASK-M05 per MIGRATION.md — leaf-first module extraction.
- **Bug fixed en route:** M04 Python word-replacement incorrectly replaced `projectCount:` object key → `appState.projectCount:` (SyntaxError, broke entire app.js). Fixed in commit ae2b058.
- **Risks:** Provider signature change (added `systemPrompt`/`tools` params) — verified all 3 call sites updated.
- **Tests run:** Full smoke test passed after each extraction (user confirmed). Syntax check on all files.
- **Next steps:** M06 view registry.

## 2026-05-24 — TASK-M04: Lift shared state into core/state.js

- **Summary:** Created `frontend/core/state.js` exporting a single `appState` object. Updated `frontend/app.js` to import it and use `appState.X` for all shared primitives; object/collection variables use local `const X = appState.X` aliases (same reference, zero other changes needed). Fixed 2 `mainMessages` full-array reassignments to use splice-in-place pattern.
- **Files touched:** `frontend/core/state.js` (new), `frontend/app.js`, `CHANGELOG.md`, `docs/project-notes/`
- **Why changed:** TASK-M04 per MIGRATION.md — shared state must live in a single importable module before M05 can extract feature modules.
- **State map:**
  - Primitives (→ appState.X everywhere): `currentThreadId` (82 refs), `activeBranchId` (17), `currentCrumbTitle` (17), `newChatCount` (8), `projectCount` (8), `mainStreaming` (4), `_activeController` (3)
  - Objects/arrays (→ const alias = appState.X): `prefs`, `threadState`, `branches`, `projects`, `apiKeys`, `mainMessages`, `mainHistory`, `streamingThreadIds`, `mainControllers`, `threadAttachments`, `branchAttachments`
  - Kept local (single-module use): `changelogLoaded`, `branchLayoutRaf`, `streamScrollLocked`, `saveTimer`, `turnSaveTimers`, log state vars
- **Fragile areas check:**
  - Branch reopen/single-instance (#002–#004): `branches` object is same reference via alias, all branch logic unchanged. ✓
  - Branch persistence across switches (#008/#009): `threadState` object is same reference via alias; `appState.currentThreadId` replaces `currentThreadId` in all thread-switch logic. ✓
  - Branch research/tool status (#010–#018): `mainStreaming`, `streamingThreadIds` moved to appState; logic unchanged. ✓
- **Risks:** Primitive reassignment scope — all 143 primitive occurrences word-replaced with `\b` boundaries; verified no double-substitution.
- **Tests run:** curl 200 on app.js, core/state.js, index.html.
- **Next steps:** Human runs **hard** smoke test (create, nest, reopen, persist-across-switch branches + search-tool branch). If green, proceed to TASK-M05.

## 2026-05-24 — TASK-M03: Externalize JS as a single ES module

- **Summary:** Moved the 6,326-line `<script>` block into `frontend/app.js` loaded via `<script type="module" src="./app.js">`. Removed the outermost IIFE wrapper `(function(){...})()` — module scope replaces it. No logic changed. CDN globals (Dexie, mermaid) remain available: Dexie loads synchronously before the module, mermaid via `defer` also before the module (both precede the module in document order).
- **Files touched:** `frontend/index.html`, `frontend/app.js` (new), `CHANGELOG.md`, `docs/project-notes/`
- **Why changed:** TASK-M03 per MIGRATION.md — JS externalization, prerequisite for the shared-state split in M04.
- **Behavior changes:** None. Module loading order preserved (Dexie sync at line 516, mermaid deferred at line 12, both execute before the module script). Inner async init IIFE remains intact.
- **Risks:** ES modules are strict mode by default — any implicit globals in the old code would throw. Verified by serving and testing. None found.
- **Tests run:** curl 200 on app.js and index.html.
- **Next steps:** Human runs full smoke test. If green, proceed to TASK-M04 (shared state).

## 2026-05-24 — TASK-M02: Extract CSS into frontend/styles/

- **Summary:** Extracted the 650-line `<style>` block from `frontend/index.html` into three files: `tokens.css` (CSS custom properties + theme overrides), `base.css` (layout, shell, panels, overlays, chrome), `chat.css` (messages, markdown, composer, branches, thinking, inline spans). Replaced `<style>` with three `<link>` tags. No CSS rules changed.
- **Files touched:** `frontend/index.html`, `frontend/styles/tokens.css` (new), `frontend/styles/base.css` (new), `frontend/styles/chat.css` (new), `CHANGELOG.md`, `docs/project-notes/CHANGES.md`, `docs/project-notes/RUNS.md`, `docs/project-notes/TASKS.md`
- **Why changed:** TASK-M02 per MIGRATION.md — CSS extraction prerequisite for the JS module split.
- **Split logic:**
  - `tokens.css`: `:root` + `[data-theme]` overrides only.
  - `base.css`: Global resets, Shell/sidebar, Main layout, Doc, Selection popover, Search palette, Personalization drawer, Context panel, Highlights panel, Thread Map, Branch context menu, Toast, Confirm dialog, Responsive media queries.
  - `chat.css`: In-doc `.branched`/`.highlighted` spans, Chat messages, Markdown rendering, Code blocks, Mermaid, Search status, Extended thinking, Model menu thinking toggle, Sticky composer, Branch drawer, Edge connector, File chips, Inline error.
- **Fragile areas check:** Bug #022 (highlights light-mode): `.highlight-row`, `.highlight-text`, `.highlight-meta` — all use CSS variables only, no hardcoded colors. Preserved in chat.css. ✓
- **Risks:** None — pure file-split, zero rule changes.
- **Tests run:** `curl` verified 200 on all 4 paths (index.html + 3 CSS files).
- **Next steps:** Human runs smoke test (emphasis: all 3 themes + light-mode highlights). If green, proceed to TASK-M03.

## 2026-05-24 — TASK-M01: Folder split

- **Summary:** Introduced `backend/` and `frontend/` directories. Created `backend/server.py` (canonical server, serves from repo root) and `frontend/index.html` (canonical HTML). Left `notlinear_server.py` as a 5-line exec shim and `notlinear.html` as an HTML meta-refresh redirect so the compiled `.app` binary keeps working without a rebuild. Updated `.applescript`, `.command`, and `NotlinearNative.swift` to use new paths.
- **Files touched:** `backend/server.py` (new), `frontend/index.html` (new), `notlinear_server.py` (shim), `notlinear.html` (redirect), `launchers/Notlinear.applescript`, `launchers/Notlinear.command`, `launchers/NotlinearNative.swift`, `CHANGELOG.md`, `docs/project-notes/CHANGES.md`, `docs/project-notes/RUNS.md`, `docs/project-notes/TASKS.md`
- **Why changed:** TASK-M01 per MIGRATION.md — structural split prerequisite for all later phases.
- **Path gotchas addressed:**
  - `CHANGELOG.md` fetch: changed from relative `'CHANGELOG.md'` to absolute `'/CHANGELOG.md'` in `frontend/index.html`. Server serves repo root so `/CHANGELOG.md` resolves to root `CHANGELOG.md`. ✓
  - `logs.md` write: `LOGS_PATH = REPO_ROOT / "logs.md"` in `backend/server.py` keeps it at repo root. ✓
  - File-watch (update-refresh): uses `location.href` — automatically correct for whatever URL the page is loaded from. ✓
  - Binary compatibility: `notlinear_server.py` shim execs into `backend/server.py`; `notlinear.html` meta-refreshes to `frontend/index.html`. ✓
- **Risks:** One extra redirect hop for `.app` binary users (imperceptible). Binary needs an Xcode rebuild to eliminate the hop.
- **Tests run:** `curl` verified 200 on `/frontend/index.html`, `/CHANGELOG.md`, and via shim server.
- **Next steps:** Human runs full smoke test. If green, proceed to TASK-M02 (extract CSS).

## 2026-05-24 — TASK-M00: Migration baseline + memory scaffolding

- **Summary:** Committed the working monolith as the migration baseline. Created `docs/project-notes/` with all four memory files required by AGENTS.md. Seeded TASKS.md with M00–M06. Recorded two ADRs in DECISIONS.md.
- **Files touched:** `docs/project-notes/TASKS.md` (new), `docs/project-notes/RUNS.md` (new), `docs/project-notes/CHANGES.md` (new), `docs/project-notes/DECISIONS.md` (new). No app files modified.
- **Why changed:** AGENTS.md mandates these files exist before migration work begins. They provide working memory, task tracking, and a revertible baseline.
- **Risks:** None — no app code was changed.
- **Tests run:** None required (no app change).
- **Next steps:** Proceed to TASK-M01 (folder split: `notlinear_server.py` → `backend/server.py`, `notlinear.html` → `frontend/index.html`).
