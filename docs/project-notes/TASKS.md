# TASKS.md — not-linear migration work queue

Each entry: **ID · Status · Goal · Context · Files likely involved · Acceptance criteria · Verification**

---

## TASK-M00 — Baseline + create project-memory files
- **Status:** Done
- **Goal:** Git baseline of the working monolith, then create all missing memory files from AGENTS.md.
- **Context:** Required first step before any code moves. Establishes a revertible checkpoint and the working-memory scaffolding every subsequent agent session depends on.
- **Files likely involved:** `docs/project-notes/` (new), `CHANGELOG.md` (append only), `BUGS.md` (append only)
- **Acceptance criteria:** All memory files exist with correct headers; TASKS.md lists M00–M06; no app files touched; baseline commit landed.
- **Verification:** None needed (no app change); logged in RUNS.md and CHANGES.md.

---

## TASK-M01 — Folder split, zero code change
- **Status:** Done
- **Goal:** Introduce `backend/` and `frontend/` without changing any logic.
- **Context:** Structural prerequisite for all later phases. The server moves to `backend/server.py` and the monolith HTML moves to `frontend/index.html`. The server's served directory is repointed to `../frontend`. Changelog/logs/file-watch path gotchas must be addressed here.
- **Files likely involved:** `notlinear_server.py` → `backend/server.py`, `notlinear.html` → `frontend/index.html`
- **Acceptance criteria:** App loads and behaves identically served from `backend/server.py`; in-app changelog viewer shows live file; logs.md still syncs; update file-watch still fires.
- **Verification:** Full smoke test (AGENTS.md "Verification", all 10 items).

---

## TASK-M02 — Extract CSS
- **Status:** Done
- **Goal:** Move the `<style>` block into `frontend/styles/` split along existing CSS banners: `tokens.css`, `base.css`, `chat.css`; link them from `index.html`.
- **Context:** Pure move — no CSS rules change. Separates styling from markup to enable independent editing and future hot-reload.
- **Files likely involved:** `frontend/index.html`, `frontend/styles/tokens.css`, `frontend/styles/base.css`, `frontend/styles/chat.css`
- **Acceptance criteria:** All three themes (dark-mono / grey / light) render correctly; highlights panel text readable in light mode (bug #022); no inline `<style>` block remaining.
- **Verification:** Full smoke test with emphasis on all three themes and light-mode highlights.

---

## TASK-M03 — Externalize JS as a module (still one file)
- **Status:** Done
- **Goal:** Move the giant `<script>` into `frontend/app.js`, loaded via `<script type="module" src="./app.js">`; remove/adapt the IIFE wrapper.
- **Context:** First JS extraction step. Still one file — no logic split yet. Validates that the ES module boundary itself doesn't break anything before the harder shared-state work in M04.
- **Files likely involved:** `frontend/index.html`, `frontend/app.js` (new)
- **Acceptance criteria:** Full smoke test passes; no IIFE wrapper remains in app.js; `<script type="module">` in index.html.
- **Verification:** Full smoke test.

---

## TASK-M04 — Shared state → `core/state.js` (highest risk)
- **Status:** Done
- **Goal:** Map every shared mutable value and cross-section helper; lift shared state into `core/state.js`; lift shared helpers into their modules; repoint all references.
- **Context:** This is the only non-mechanical phase. The IIFE implicitly shares all top-level let/const; splitting breaks those. Getting the state map right makes M05 purely mechanical. Go slow.
- **Files likely involved:** `frontend/app.js`, `frontend/core/state.js` (new), any helper modules created
- **Acceptance criteria:** All shared state exports from `core/state.js`; no implicit cross-module globals; full smoke test passes.
- **Verification:** Full smoke test with **hard branch exercise** (create / nest / reopen / persist-across-switch / search). CHANGES.md must note how each Fragile area was preserved.

---

## TASK-M05 — Peel modules off, leaf-first (one per commit)
- **Status:** Done
- **Goal:** Extract sections into ES modules in order: `core/markdown.js` → `providers/{claude,deepseek,openai}.js` → `core/api-client.js` → `core/ui.js` → `core/store.js` → view pieces (thread map, highlights, branches, breadcrumbs, composer, prefs).
- **Context:** Each extraction is move-only. Commit and smoke-test after each one so any regression is immediately bisectable.
- **Files likely involved:** `frontend/core/markdown.js`, `frontend/core/api-client.js`, `frontend/core/ui.js`, `frontend/core/store.js`, `frontend/providers/claude.js`, `frontend/providers/deepseek.js`, `frontend/providers/openai.js`, view modules under `frontend/views/`
- **Acceptance criteria:** Each module extraction: chat + the relevant feature + one branch flow pass the smoke test; no logic changed.
- **Verification:** Smoke test after **each** extraction (minimum: chat, the relevant feature, one branch flow). Each run logged in RUNS.md.

---

## TASK-M06 — View registry + chat as the first view
- **Status:** Done
- **Goal:** Add `core/registry.js`; make the existing chat experience register itself (`{ id, label, icon, mount, unmount }`) with no behavior change. `app.js` becomes: init core → register views → mount default.
- **Context:** Final migration phase. Establishes the extensibility seam so future features (e.g. Coding Projects) can be added as a new module under `frontend/views/` without touching the shell or chat.
- **Files likely involved:** `frontend/core/registry.js` (new), `frontend/app.js`, `frontend/views/chat.js` (or equivalent)
- **Acceptance criteria:** Behavior identical; adding a future view is "drop a module + register it"; full smoke test passes.
- **Verification:** Full smoke test.

---

# Coding Projects feature (additive — must not change chat/threads/branches)

> One phase per session; smoke test + memory-file update between phases. See PRD (`Coding Projects PRD.md`) and ADR-003…ADR-005. Decisions for v1: real filesystem; shallow folder listing in scan; LLM-generated status sentence with mtime cache; all state in `localStorage`.

## TASK-CP00 — Memory scaffolding + ADRs
- **Status:** Done
- **Goal:** Seed the Coding Projects task queue and record the architectural decisions before any code.
- **Context:** Establishes the plan of record so each subsequent phase is small and reviewable.
- **Files likely involved:** `docs/project-notes/TASKS.md`, `docs/project-notes/DECISIONS.md`, `CHANGELOG.md`, `docs/project-notes/CHANGES.md`, `docs/project-notes/RUNS.md`
- **Acceptance criteria:** CP00–CP07 listed; ADR-003…ADR-005 recorded; no app files touched.
- **Verification:** None (no app change).

## TASK-CP01 — Backend: additive read-only endpoints
- **Status:** Done
- **Goal:** Add `/__notlinear_pick_folder` (returns `{ok, path}`) and `/__notlinear_scan_project` (returns name + shallow top-level listing + parsed `README/CHANGELOG/BUGS/TASKS` with present/size/mtime/text).
- **Context:** Real-filesystem data source for the feature. Existing endpoints stay frozen (AGENTS.md do-not-touch).
- **Files likely involved:** `backend/server.py`
- **Acceptance criteria:** Both endpoints return correct JSON; reads are size-capped and path-validated (reject `..`, confine to the given dir, no recursive walk); existing `/__notlinear_*` endpoints unchanged.
- **Verification:** `curl` each endpoint on a real folder; chat smoke test still green.

## TASK-CP02 — Shell seam: full-screen overlay + sidebar launcher (ADR-006)
- **Status:** Done
- **Goal:** Add a full-screen overlay `#cp-screen` (mirrors `.project-screen`) and a `views/coding-projects.js` module that registers a `coding-projects` view whose `mount` shows the overlay and `unmount` hides it (chat's mount/unmount stay no-ops — chat DOM untouched). Add a collapsible "coding projects" sidebar section (header + `+` add button) that opens the overlay; persist the section's collapse state in `nl_cp_side_collapsed_v1`. Overlay back/Escape returns to chat. CP02 renders a placeholder; CP03 fills it.
- **Context:** Per ADR-006 the overlay avoids touching the Fragile branch DOM entirely. The module exists from CP02 with registry wiring so CP03 only enriches `render()`.
- **Files likely involved:** `frontend/index.html`, `frontend/styles/coding-projects.css` (new), `frontend/views/coding-projects.js` (new), `frontend/app.js`
- **Acceptance criteria:** Chat behavior unchanged (DOM/handlers not touched); overlay opens from the sidebar section and closes via back/Escape; collapse state persists; renders in all three themes with tokens only.
- **Verification:** Full smoke test incl. hard branch exercise (Fragile #002–#018), plus open/close the overlay over chat. Note: existing Projects/Threads section collapse (pr/th keys) deferred to a later polish task to keep this phase minimal.

## TASK-CP03 — coding-projects view module + list view
- **Status:** Done (status sentence provider switched Claude → DeepSeek per user, 2026-05-26)
- **Goal:** New self-registering `frontend/views/coding-projects.js` + `frontend/styles/coding-projects.css` (tokens only). Project registry in `nl_cp_projects_v1`; scan each via CP01; render rows (emoji · name+path · status sentence · bug/comment counts · last-updated · attn dot); gallery toggle; empty state.
- **Context:** The home of the feature. Status sentence via LLM + mtime cache (ADR-005) with heuristic fallback.
- **Files likely involved:** `frontend/views/coding-projects.js` (new), `frontend/styles/coding-projects.css` (new), `frontend/core/api-client.js`, `frontend/providers/claude.js`, `frontend/index.html`
- **Acceptance criteria:** Rows render from a real folder in all three themes; no hardcoded colors (bug #022); gallery + empty state work.
- **Verification:** Add a real folder; verify list + gallery + empty in dark/grey/light.

## TASK-CP04 — Project page
- **Status:** Done
- **Goal:** Header (editable emoji + title persisted to registry, mono path), meta strip, blocks in PRD order: files (2×2, missing dimmed) · bugs · tasks · changelog · overview — via `renderMarkdown`, with bug/task checkbox lists and missing-file callouts.
- **Context:** Full detail page; reuses the markdown renderer.
- **Files likely involved:** `frontend/views/coding-projects.js`, `frontend/styles/coding-projects.css`
- **Acceptance criteria:** Page renders incl. a missing-file state; rename + emoji persist across reload.
- **Verification:** Open a project with one missing file; reload and confirm overrides stick.

## TASK-CP05 — File preview drawer
- **Status:** Done
- **Goal:** Reuse the right-drawer pattern (margin shift via `--drawer-w`, Escape/X/outside-close) to render a clicked file read-only as markdown. Drawer independent of comments.
- **Files likely involved:** `frontend/views/coding-projects.js`, `frontend/styles/coding-projects.css`
- **Acceptance criteria:** Each present/listed file opens in the drawer; missing cells not clickable; drawer + comments coexist.
- **Verification:** Open several files; confirm Escape/X/outside close and content area reflow.

## TASK-CP06 — Comments
- **Status:** Done
- **Goal:** `nl_cp_comments_v1` = `{[projectId]: Comment[]}`. List-view popover (oldest→newest) + project-page thread (newest→oldest); composer with ⌘↵; delete with `comment deleted` toast.
- **Files likely involved:** `frontend/views/coding-projects.js`, `frontend/styles/coding-projects.css`, `frontend/core/ui.js`
- **Acceptance criteria:** Post/delete/persist across reload; popover and drawer can be open together.
- **Verification:** Post + delete in both surfaces; reload and confirm persistence.

## TASK-CP07 — Add-project popover + default theme → light
- **Status:** In progress — code complete, awaiting human smoke test (final v1 phase)
- **Goal:** Add-project popover (folder path / display name / 12-emoji strip + more…) from sidebar `+` and list `+ add folder`; pick folder via CP01; prepend stub project; `added <name>` toast. Flip bootstrap default theme to `light` (fall back to `light` when `nl_theme` unset).
- **Context:** Final v1 phase; default-theme flip is a user-visible behavior change.
- **Files likely involved:** `frontend/views/coding-projects.js`, `frontend/index.html` (bootstrap theme), `frontend/styles/coding-projects.css`
- **Acceptance criteria:** Popover adds a project and toasts; fresh profile defaults to light; all three themes correct. `Behavior changes:` line logged for the theme default.
- **Verification:** Full smoke test, all three themes, default-on-fresh-profile is light.
