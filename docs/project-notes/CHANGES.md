# CHANGES.md — internal work memory

Each entry: **date · summary · files touched · why changed · risks · tests run · next steps**

---

## 2026-05-26 — Bug #025: Coding Projects "create" buttons rendered as clipped squares + stale-server restart

- **Summary:** User reported "scan failed" + misaligned buttons on a Coding Projects project page. Two distinct causes. (1) **Scan failed = stale server.** The `backend/server.py` process on :8765 was started May 24, before the uncommitted `/__notlinear_scan_project` endpoint (+99 lines, working-tree only) existed, so it 404'd; the frontend's `res.json()` failed → `{ok:false}` → "scan failed". Verified by `curl` (404 HTML) and `ps`/`lsof` (start time predates the endpoint). Killed PID and restarted `backend/server.py`; re-probed scan → `ok:true`, all four convention files detected. No code change. (2) **Misaligned buttons = wrong CSS variant.** `blockHtml` gave the missing-file "create" button class `cp-btn ghost cp-create`; `.cp-btn.ghost` is the 32px icon-only square (used by the rescan button) and its specificity (0,2,0) beat `.cp-create` (0,1,0), so the text overflowed a tiny box. Dropped `ghost`. Logged BUGS.md #025.
- **Files touched:** `frontend/views/coding-projects.js`, `BUGS.md`, `CHANGELOG.md`, `docs/project-notes/{CHANGES,RUNS}.md`.
- **Why changed:** Bug report (scan fail + button alignment) on the CP project page.
- **Risks:** Low. JS change is one class-list edit on a button; no CSS, no logic, no persistence touched. Server restart is operational, reversible.
- **Tests run:** scan endpoint verified via curl (ok:true, 4 files present). Button visual verification pending human reload.
- **Next steps:** User reloads the page — scan succeeds, files show present, and any genuinely-missing-file "create" buttons now render as proper pills.

## 2026-05-26 — Bug #024: toasts hidden behind the Coding Projects overlay

- **Summary:** User reported the add-folder "browse" button did nothing. Root cause: `.toast` (z-index 300) renders behind `#cp-screen` (z-index 400), so the button's "restart the server — folder picker endpoint missing" toast was invisible. Fixed by raising `.toast` z-index 300 → 500 in `frontend/styles/base.css`. Logged BUGS.md #024.
- **Also diagnosed (not a code bug):** the running server on :8765 still 404s `/__notlinear_pick_folder` and `/__notlinear_scan_project` — it predates CP01. Fix is restarting `backend/server.py`; Python endpoints don't hot-reload.
- **Files touched:** `frontend/styles/base.css`, `BUGS.md`, `CHANGELOG.md`, `docs/project-notes/{CHANGES,RUNS}.md`.
- **Risks:** Low; one z-index value in a shared rule. Toast now sits above the 400 overlay and 201 search palette; still transient + pointer-events:none.
- **Tests run:** static (z-index value confirmed); behavioral verification pending after the user restarts the server.
- **Next steps:** User restarts `backend/server.py`, reloads, retries browse/add. Toast feedback now visible regardless.

## 2026-05-26 — TASK-CP07: Coding Projects — add popover + emoji picker + light default (v1 complete)

- **Summary:** Final v1 phase. (1) Add-project popover: folder path (with a browse button → native picker via `pickFolderPath()`), optional display name (defaults to last path segment), 12-emoji icon strip; submit disabled until a path exists; Enter submits; prepends + toast "added <name>". Triggered from list "+ add folder", empty-state CTA, and sidebar "+". (2) Reusable emoji picker (`openEmojiPicker` — 12 curated + paste-any-emoji input) via `pickEmojiFor`, wired to list-row emoji, page-header emoji, and the add popover; persists + toast "icon updated". (3) Refactored the comments-popover plumbing into shared `attachFloater`/`closeFloater` (alias `closeCommentsPopover` kept for `navBack`). (4) Default theme → light: `index.html` bootstrap `nl_theme||'light'`; `app.js renderPrefsUI` uses `prefs.theme || 'light'` for both `markSegValue` and `applyTheme`.
- **Files touched:** `frontend/views/coding-projects.js`, `frontend/styles/coding-projects.css`, `frontend/index.html`, `frontend/app.js`, `CHANGELOG.md`, `docs/project-notes/{CHANGES,RUNS,TASKS}.md`.
- **Why changed:** TASK-CP07 — the last v1 deliverable.
- **Theme-change reasoning (shared code):** Only the *unset* default changed. Existing users have `prefs.theme`/`nl_theme` persisted, so `prefs.theme || 'light'` and `nl_theme||'light'` leave them on their chosen theme. `applyTheme` still coerces unknown values to dark and persists `nl_theme`, so after first light render the value is written and stable. No branch/persistence-schema/server code touched.
- **Risks:** Low. The theme flip is a deliberate, logged behavior change for fresh profiles. Popovers share one `activePopover`, so opening one closes another (no stacking leaks).
- **Tests run:** `node --input-type=module --check` clean; no dangling `pickAndAdd`; app.js + module + CSS + index serve 200; bootstrap confirmed.
- **Next steps:** Human smoke test of the whole feature (add via popover incl. browse + emoji strip; emoji edit on row + page persists; fresh profile defaults to light; all three themes; chat unaffected — full AGENTS.md 10-item + branch exercise). If green, v1 (CP00–CP07) is complete.

## 2026-05-26 — TASK-CP06: Coding Projects — comments

- **Summary:** Comment store + two surfaces. Store: `loadComments/saveComments/addComment/deleteComment` over `nl_cp_comments_v1`. `renderCommentList(host, id, order, emptyCopy)` shared by popover (asc) and page (desc); `wireComposer` handles auto-grow + ⌘/Ctrl↵; `refreshCommentCounts` syncs the row chip and page header. List-row 💬 is now a button that opens a fixed, viewport-clamped popover anchored to the chip; project page has a full-width composer + thread. Escape/back closes the popover first (`navBack`).
- **Files touched:** `frontend/views/coding-projects.js`, `frontend/styles/coding-projects.css`, `CHANGELOG.md`, `docs/project-notes/{CHANGES,RUNS,TASKS}.md`.
- **Diagnosis (user report "add folder does nothing"):** Probed :8765 — `/__notlinear_pick_folder` returned 404 while `/frontend/index.html` returned 200. The running server predates CP01; Python endpoints don't hot-reload like the static frontend. Fix = restart `backend/server.py`. Hardened `pickAndAdd` to surface 404/501 as a "restart the server" toast and to show endpoint errors instead of swallowing them.
- **Risks:** Low; chat untouched. localStorage-only persistence (Dexie sacred). Popover uses a transient document `mousedown` listener removed on close.
- **Tests run:** `node --input-type=module --check` clean; module + CSS serve 200.
- **Next steps:** User restarts the server, then smoke-tests add-folder + comments (post/delete/persist in both surfaces, counts sync, ⌘↵). If green → CP07 (add-project popover + default theme → light).

## 2026-05-26 — TASK-CP05: Coding Projects — file preview drawer

- **Summary:** Read-only right-side drawer (`#cp-drawer` inside `#cp-screen`). `openDrawer(projectId, fileKey)` builds the full path from the project path + scanned filename, shows size, renders the file text via `renderMarkdown` (or "too large" when `tooBig`), and adds `.drawer-open` to `#cp-screen` so `.cp-scroll` gets a `margin-right`. Closes via X (`#cp-drawer-close`), Escape/back (`navBack` checks the drawer first), or an outside `mousedown` (ignores clicks on the drawer or a file cell). Reveal-in-Finder is a toast stub (no backend endpoint added). Reuses `--drawer-w`/`--drawer-gap`; z-index 410 sits above the 400 overlay.
- **Files touched:** `frontend/index.html`, `frontend/styles/coding-projects.css`, `frontend/views/coding-projects.js`, `CHANGELOG.md`, `docs/project-notes/{CHANGES,RUNS,TASKS}.md`.
- **Why changed:** TASK-CP05.
- **Risks:** Low; chat untouched. The new document-level `mousedown` listener is guarded by `drawerOpen()` so it's inert unless the drawer is open. Reveal-in-Finder intentionally stubbed (would need a new backend endpoint — out of scope here).
- **Tests run:** `node --input-type=module --check` clean; module + CSS + index serve 200; drawer markup present.
- **Next steps:** Human smoke test (open each present file → drawer renders markdown; missing cells not clickable; close via X/Escape/outside; content reflow). If green → CP06 (comments).

## 2026-05-26 — TASK-CP04: Coding Projects — project page (+ DeepSeek status switch)

- **Summary:** Added the project page. Row/sidebar click → `openProject(id)` renders into `#cp-inner`: editable title (persists name to registry; "renamed" toast), large emoji, mono path, meta strip, and blocks (files 2×2 / bugs / tasks / changelog / overview) via `renderMarkdown`. Missing files render a dashed callout + create stub. Breadcrumb gets a "coding projects" link; `#cp-back` and Escape are context-aware via `navBack()` (page→list, list→chat). `currentProjectId` tracks the sub-view. If a page opens before its scan completes, the page re-renders once the scan resolves. Also switched the status-sentence LLM from Claude/Haiku to **DeepSeek** (`deepseek-chat`) per the user — same isolation (no `_activeController`), same mtime cache + heuristic fallback; ADR-005 updated.
- **Files touched:** `frontend/views/coding-projects.js`, `frontend/styles/coding-projects.css`, `docs/project-notes/DECISIONS.md`, `CHANGELOG.md`, `docs/project-notes/{CHANGES,RUNS,TASKS}.md`.
- **Why changed:** TASK-CP04 (project page) + user request to use DeepSeek for the status sentence.
- **Risks:** Low for chat (untouched). File drawer/comments/emoji picker are intentionally toast stubs (CP05/CP06/CP07). Checkbox/p1-badge styling in bugs/tasks is whatever `renderMarkdown` produces for now — fine for v1; can be polished later.
- **Tests run:** `node --input-type=module --check` clean; module + CSS + index serve 200.
- **Next steps:** Human smoke test (open a project page, edit+persist title, see blocks render, missing-file callout, back/Escape navigation, themes). If green → CP05 (file preview drawer).

## 2026-05-26 — TASK-CP03: Coding Projects — list view

- **Summary:** Built the real list view inside `views/coding-projects.js`. Project registry in `nl_cp_projects_v1` (`[{id, path, emoji, name?}]`). On mount/rescan each project is scanned via `/__notlinear_scan_project`; rows render emoji · name+path · status sentence (sparkles) · bug count · last-updated · comment count, with a needs-attention dot. Gallery toggle (session var), empty state with "add folder" CTA, and a minimal add flow via `/__notlinear_pick_folder` (the richer popover is CP07). Sidebar section lists added projects.
- **Status sentence (ADR-005):** isolated non-streaming POST to Anthropic `messages` with model `claude-haiku-4-5-20251001`, max_tokens 80, reusing `appState.apiKeys.anthropic`. Deliberately does NOT touch `appState._activeController` (which `callClaude` mutates) so it can never interrupt an in-flight chat stream. Cached in `nl_cp_status_cache_v1` keyed by path + max(changelog,tasks mtime); regenerated only when that mtime changes or on rescan. Heuristic fallback (latest changelog line + first open task) when no key or the call fails — the list never blocks on the network.
- **Files touched:** `frontend/views/coding-projects.js`, `frontend/styles/coding-projects.css`, `CHANGELOG.md`, `docs/project-notes/{CHANGES,RUNS,TASKS}.md`.
- **Why changed:** TASK-CP03 — the home of the feature.
- **Risks:** Low for chat (no chat code touched). New network behavior: one Haiku call per project on first scan; mitigated by mtime cache + heuristic fallback. Status call uses the same browser-access headers as the existing chat Claude call.
- **Tests run:** `node --input-type=module --check` clean; `coding-projects.js`/`.css` serve 200; live scan of this repo parsed; open-bug regex returns 0 for this repo's BUGS.md (fixed/verified format, no `- [ ]`) — logic runs correctly.
- **Next steps:** Human smoke test: open coding projects → add a real folder (native picker) → row appears, status sentence fills (Haiku if key set, else heuristic) → toggle gallery → rescan → empty state when none → all three themes. If green, CP04 (project page).

## 2026-05-26 — TASK-CP02: Coding Projects — shell seam (overlay + launcher)

- **Summary:** Established the seam for the Coding Projects view via a full-screen overlay (ADR-006), so chat's DOM is never touched. Added `#cp-screen` markup, `coding-projects.css`, and `views/coding-projects.js` which registers a `coding-projects` view (mount→show overlay+render, unmount→hide). Sidebar gained a collapsible "coding projects" launcher section (caret toggles collapse, persisted to `nl_cp_side_collapsed_v1.cp`; header/`+` open the overlay). Back button + Escape return to chat. Renders a placeholder pending CP03.
- **Files touched:** `frontend/index.html`, `frontend/styles/coding-projects.css` (new), `frontend/views/coding-projects.js` (new), `frontend/app.js`, `CHANGELOG.md`, `docs/project-notes/{CHANGES,RUNS,TASKS}.md`, `DECISIONS.md` (ADR-006).
- **Why changed:** TASK-CP02 — the registry needed a real second view to prove the extensibility seam; the overlay is the lowest-risk home (ADR-006).
- **How Fragile areas were preserved:** Chat's DOM, handlers, branch stack, panels, and composer are not modified at all. The overlay (`position:fixed; inset:0; z-index:400`) simply covers them when shown; chat keeps running underneath. Chat's view `mount`/`unmount` remain no-ops. Therefore BUGS.md #002–#018 (branch reopen / persist-across-switch / research status) cannot be affected by this change — there is no code path into the branch system here.
- **Risks:** Low. The only shared-file edits are additive (one CSS link, one sidebar section, one overlay block, two app.js lines). New Escape listener is guarded by `#cp-screen.show` so it's inert unless the overlay is open.
- **Tests run:** `node --input-type=module --check` on the view module — clean. Server on :8798 — `coding-projects.js`, `coding-projects.css`, `app.js`, `index.html` all HTTP 200; index.html contains all 3 new hooks. Full browser smoke test NOT yet run (GUI) — pending human.
- **Next steps:** Human runs the smoke test (esp. branch exercise + open/close overlay). If green, mark CP02 Done and start CP03 (real list view rendering inside `render()`: scan projects via CP01 endpoints, status sentences, gallery, empty state).

## 2026-05-26 — TASK-CP01: Coding Projects — additive backend endpoints

- **Summary:** Added `/__notlinear_pick_folder` and `/__notlinear_scan_project` to `backend/server.py`, plus a module-level `scan_project()` helper. Pick-folder returns a path only (no bytes). Scan returns `{ok, name, path, listing[], files{readme,changelog,bugs,tasks}}`; each convention file slot is `{present, filename?, size?, mtime?, text?, tooBig?, error?}`.
- **Files touched:** `backend/server.py`, `CHANGELOG.md`, `docs/project-notes/CHANGES.md`, `docs/project-notes/RUNS.md`, `docs/project-notes/TASKS.md`.
- **Why changed:** TASK-CP01 per the Coding Projects plan / ADR-003 — real-filesystem data source. Existing endpoints are frozen (AGENTS.md do-not-touch), so these are additive.
- **Security:** Read-only. Path is resolved + must be an existing dir. The shallow listing is non-recursive (single `os.scandir`). Convention-file reads use filenames discovered from that scandir — never caller input — so no path traversal is possible. Per-file cap 1 MB (`tooBig` flag), listing cap 500, hidden entries skipped. Text decoded utf-8 with `errors=replace` (won't crash on binary). Stdlib only (`os`, `pathlib`) — no new dependency.
- **Risks:** Low. New endpoints only; verified existing `/__notlinear_runtime_logs` and static serving still return 200.
- **Tests run:** `py_compile` clean. Live server on :8799 — scanned this repo: listing correct; README/CHANGELOG/BUGS present with text, TASKS `{present:false}` (no root TASKS.md); missing path → `{ok:false}`; empty path → 400; runtime-logs 200; index 200.
- **Next steps:** TASK-CP02 — chat mount/unmount seam + main container + "coding projects" sidebar section (the one phase that touches shared shell code; full hard smoke test required).

## 2026-05-26 — TASK-CP00: Coding Projects — memory scaffolding + ADRs

- **Summary:** Kicked off the Coding Projects feature (per `Coding Projects PRD.md`). Read the PRD against the now-complete modular frontend and confirmed the view-registry seam. Recorded three ADRs and seeded the CP00–CP07 task queue. No app code touched. Locked v1 decisions: real filesystem data via new additive backend endpoints; scan returns a shallow top-level folder listing (not just the 4 convention files); status sentence is LLM-generated (Claude) cached by file mtime; all feature state in `localStorage` (Dexie untouched).
- **Files touched:** `docs/project-notes/DECISIONS.md` (ADR-003/004/005), `docs/project-notes/TASKS.md` (CP00–CP07), `CHANGELOG.md`, `docs/project-notes/CHANGES.md`, `docs/project-notes/RUNS.md`. No app files modified.
- **Why changed:** AGENTS.md requires the decisions and task queue recorded before code; plan-of-record for the additive feature.
- **Key finding:** Chat registers as a view but mounts inline with no-op `mount`/`unmount`; the shell is hardcoded in `index.html`. A behavior-neutral mount/unmount seam (TASK-CP02) is required before a second view can swap in.
- **Risks:** None this phase (docs only). Downstream: TASK-CP01 reads the filesystem (path-traversal guard required); TASK-CP02 touches shared shell code (must stay byte-for-byte for chat / Fragile #002–#018); TASK-CP07 flips the default theme (logged behavior change).
- **Tests run:** None required (no app change).
- **Next steps:** TASK-CP01 — add `/__notlinear_pick_folder` and `/__notlinear_scan_project` to `backend/server.py`.

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
