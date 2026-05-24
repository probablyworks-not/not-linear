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
- **Status:** Todo
- **Goal:** Move the giant `<script>` into `frontend/app.js`, loaded via `<script type="module" src="./app.js">`; remove/adapt the IIFE wrapper.
- **Context:** First JS extraction step. Still one file — no logic split yet. Validates that the ES module boundary itself doesn't break anything before the harder shared-state work in M04.
- **Files likely involved:** `frontend/index.html`, `frontend/app.js` (new)
- **Acceptance criteria:** Full smoke test passes; no IIFE wrapper remains in app.js; `<script type="module">` in index.html.
- **Verification:** Full smoke test.

---

## TASK-M04 — Shared state → `core/state.js` (highest risk)
- **Status:** Todo
- **Goal:** Map every shared mutable value and cross-section helper; lift shared state into `core/state.js`; lift shared helpers into their modules; repoint all references.
- **Context:** This is the only non-mechanical phase. The IIFE implicitly shares all top-level let/const; splitting breaks those. Getting the state map right makes M05 purely mechanical. Go slow.
- **Files likely involved:** `frontend/app.js`, `frontend/core/state.js` (new), any helper modules created
- **Acceptance criteria:** All shared state exports from `core/state.js`; no implicit cross-module globals; full smoke test passes.
- **Verification:** Full smoke test with **hard branch exercise** (create / nest / reopen / persist-across-switch / search). CHANGES.md must note how each Fragile area was preserved.

---

## TASK-M05 — Peel modules off, leaf-first (one per commit)
- **Status:** Todo
- **Goal:** Extract sections into ES modules in order: `core/markdown.js` → `providers/{claude,deepseek,openai}.js` → `core/api-client.js` → `core/ui.js` → `core/store.js` → view pieces (thread map, highlights, branches, breadcrumbs, composer, prefs).
- **Context:** Each extraction is move-only. Commit and smoke-test after each one so any regression is immediately bisectable.
- **Files likely involved:** `frontend/core/markdown.js`, `frontend/core/api-client.js`, `frontend/core/ui.js`, `frontend/core/store.js`, `frontend/providers/claude.js`, `frontend/providers/deepseek.js`, `frontend/providers/openai.js`, view modules under `frontend/views/`
- **Acceptance criteria:** Each module extraction: chat + the relevant feature + one branch flow pass the smoke test; no logic changed.
- **Verification:** Smoke test after **each** extraction (minimum: chat, the relevant feature, one branch flow). Each run logged in RUNS.md.

---

## TASK-M06 — View registry + chat as the first view
- **Status:** Todo
- **Goal:** Add `core/registry.js`; make the existing chat experience register itself (`{ id, label, icon, mount, unmount }`) with no behavior change. `app.js` becomes: init core → register views → mount default.
- **Context:** Final migration phase. Establishes the extensibility seam so future features (e.g. Coding Projects) can be added as a new module under `frontend/views/` without touching the shell or chat.
- **Files likely involved:** `frontend/core/registry.js` (new), `frontend/app.js`, `frontend/views/chat.js` (or equivalent)
- **Acceptance criteria:** Behavior identical; adding a future view is "drop a module + register it"; full smoke test passes.
- **Verification:** Full smoke test.
