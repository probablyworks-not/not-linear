# MIGRATION.md — single file → modular backend/frontend

**Audience:** Claude Code (and any coding agent).
**Status:** active. This is the authoritative plan for modularizing not-linear. Follow it exactly.
**Read first:** `AGENTS.md` (rules, repo map, smoke test, do-not-touch) and `CLAUDE.md`.

---

## How to use this file

- Do **one phase (TASK-Mxx) per session.** After each phase, **stop** and let the human run the smoke test (AGENTS.md "Verification"). Do not bundle phases.
- This migration is **move-only**: relocate and re-wire code **without changing behavior.** Logic cleanups happen later, as separate tasks.
- Work on **git**, committing after every green phase so any step is revertible.
- Update memory files per AGENTS.md after each phase: `CHANGELOG.md`, `docs/project-notes/CHANGES.md`, `RUNS.md`; advance the matching `TASKS.md` entry.

---

## Guardrails (do not violate)

1. **No behavior change.** If anything user-visible shifts (timing, layout, persistence, the update-refresh flow), it's a bug — except where this file explicitly calls out a required adjustment, which must be logged as `Behavior changes:`.
2. **Persistence schema is sacred.** No Dexie/IndexedDB store or shape changes during migration. If unavoidable, stop and ask; tag `[SCHEMA]`.
3. **Server endpoints unchanged.** Only the **served directory** changes (to `../frontend`). `/__notlinear_*` logic stays identical.
4. **No new dependencies, no build step.** Native ES modules only. CDN libs stay as global `<script>` tags in `index.html` (`window.Dexie`, `mermaid`, Tabler, fonts).
5. **Fragile areas first.** Branch reopen/single-instance, branch persistence across switches, and branch research/tool status (BUGS.md #002–#018) are the highest-risk code. When a phase moves branch code, explicitly note how you preserved each behavior, and exercise branches hard in the smoke test.
6. **Same-origin only.** The server serves the frontend, so all API calls stay same-origin. Don't introduce cross-origin calls.

---

## Repo-specific gotchas — verify these explicitly

These are the things most likely to silently break. Check each as you go.

- **Changelog viewer path.** The in-app viewer does `fetch('CHANGELOG.md')` with a bundled `FALLBACK_CHANGELOG_MD` (bug #007). Once `index.html` lives in `frontend/`, that relative fetch resolves to `frontend/CHANGELOG.md` and silently falls back. **Decide and document:** point the fetch at the correct relative path to root `CHANGELOG.md`, or serve a copy. Confirm the viewer shows the **live** file, not just the fallback.
- **Runtime-log sync path.** The server writes `logs.md` next to itself and the browser POSTs to `/__notlinear_runtime_logs`. After the split, confirm `logs.md` still updates from the running app.
- **Update file-watch.** The "New update — refresh" flow watches the entrypoint for changes. Renaming `notlinear.html` → `frontend/index.html` (and splitting JS into modules) changes what must be watched. Adjust deliberately; log as `Behavior changes:`; verify the refresh prompt still appears after an edit.
- **`file://` behavior.** Some paths behave differently under `file://` vs the local server (bug #007). Keep the server-served path working; don't regress the `file://` fallbacks.
- **WKWebView file pickers.** The dynamic-input picker fix (bug #021) must survive any composer/attachment module move.

---

## Target structure

See AGENTS.md "Repo map → Target." Mechanism: native ES modules (`<script type="module">`), the server serves `frontend/`, one `core/api-client.js` is the only seam to the backend, and each feature is a self-registering module under `frontend/views/`.

## The hard part — shared closure state (read before TASK-M04)

`notlinear.html` is one IIFE, so many top-level `let`/`const` values and helpers are shared implicitly across sections. Splitting into modules breaks those implicit references — this is the only non-mechanical part.

**Before extracting modules:** map every shared mutable value (current chat, active thread, `branches` registry, selection, prefs, the Dexie handle, etc.) and every cross-section helper. Move shared state into `core/state.js` (a single exported object) and shared helpers into the module they belong to, exported. Get this map right and the rest is mechanical.

---

## Phased tasks

> **TASK-M00 does the scaffolding the human asked for** — it creates the project-memory files. Copy TASK-M00…TASK-M06 into `docs/project-notes/TASKS.md` (TASKS.md format) and work them in order.

### TASK-M00 — Baseline + create project-memory files
- **Goal:** `git` baseline of the working monolith, then create every missing memory file from AGENTS.md "Project memory."
- **Do:**
  - Commit the current working tree as the migration baseline.
  - Create `docs/project-notes/` and the files **`TASKS.md`, `RUNS.md`, `CHANGES.md`, `DECISIONS.md`** using the templates/fields in AGENTS.md. **Do not create or overwrite `CHANGELOG.md` or `BUGS.md`** — they exist. (If `CHANGELOG.md` is somehow absent, create it from the bundled `FALLBACK_CHANGELOG_MD` content and note it.)
  - Seed `TASKS.md` with TASK-M00…TASK-M06.
  - Record two ADRs in `DECISIONS.md`: (a) "Modular frontend via native ES modules, no build step"; (b) "Memory files under `docs/project-notes/`; `CHANGELOG.md`/`BUGS.md` stay at root because they're already referenced by the app and existing workflow."
- **Acceptance:** all memory files exist with correct headers; TASKS.md lists the phases; no app files touched.
- **Verification:** none needed (no app change); log creation in `RUNS.md`/`CHANGES.md`.

### TASK-M01 — Folder split, zero code change
- **Goal:** introduce `backend/` and `frontend/` without changing any logic.
- **Do:** move `notlinear_server.py` → `backend/server.py`; move `notlinear.html` → `frontend/index.html` (still a monolith); point the server's served directory at `../frontend`. Address the **changelog/logs/file-watch path gotchas** now.
- **Acceptance:** app loads and behaves identically, served from `backend/server.py`.
- **Verification:** full smoke test. This phase proves the split itself breaks nothing.

### TASK-M02 — Extract CSS
- **Goal:** move the `<style>` block into `frontend/styles/` (`tokens.css`, `base.css`, `chat.css`), split along the existing CSS banners; link them from `index.html`.
- **Acceptance/Verification:** smoke test, **with emphasis on all three themes** and the highlights light-mode case (#022).

### TASK-M03 — Externalize JS as a module (still one file)
- **Goal:** move the giant `<script>` into `frontend/app.js`, loaded via `<script type="module" src="./app.js">`; remove/adapt the IIFE wrapper.
- **Acceptance/Verification:** full smoke test. Now external + a module, still one JS file.

### TASK-M04 — Shared state → `core/state.js` (highest risk)
- **Goal:** apply the shared-closure-state map; lift shared state into `core/state.js` and shared helpers into their modules; repoint references. **Go slow.**
- **Acceptance/Verification:** full smoke test with **hard branch exercise** (create/nest/reopen/persist-across-switch/search). Explicitly note in CHANGES.md how each Fragile area was preserved.

### TASK-M05 — Peel modules off, leaf-first (one per commit)
- **Goal:** extract sections into modules in this order, verifying + committing after each: `core/markdown.js` → `providers/{claude,deepseek,openai}.js` → `core/api-client.js` (the `/__notlinear_*` calls) → `core/ui.js` (toast/confirm/popover) → `core/store.js` (Dexie) → heavier view pieces (`thread map`, `highlights`, `branches`, `breadcrumbs`, `composer`, `prefs`).
- **Acceptance:** each extraction is move-only; chat + branches unaffected.
- **Verification:** smoke test after **each** extraction (at minimum: chat, the relevant feature, and one branch flow). Log each in RUNS.md.

### TASK-M06 — View registry + chat as the first view
- **Goal:** add `core/registry.js`; make the existing chat experience register itself (`{ id, label, icon, mount, unmount }`) with no behavior change. `app.js` becomes: init core → register views → mount default.
- **Acceptance:** behavior identical; adding a future feature is now "drop a module in `frontend/views/` and register it."
- **Verification:** full smoke test.

---

## Definition of done (whole migration)

- App is served from `backend/server.py` → `frontend/`, modular, no build step, no new deps.
- Every smoke-test item passes; no console errors; behavior matches the TASK-M00 baseline (except the explicitly logged file-watch/path adjustments).
- All Fragile areas verified intact.
- Memory files updated; `TASKS.md` shows M00–M06 Done; `DECISIONS.md` records the structure choice.
- The Coding Projects feature (separate brief) can be added as a new `frontend/views/` module without touching the shell or chat.
