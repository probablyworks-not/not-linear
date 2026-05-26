# RUNS.md — run log

Each entry: **date/time · task or bug ID · command category · result · important output · follow-up**

---

## 2026-05-26 — Bug #025 + server restart — pass

- **Category:** test / migration (server restart)
- **Result:** pass
- **Output:** Diagnosed "scan failed": running `backend/server.py` (PID 52644, started May 24) predated the uncommitted `/__notlinear_scan_project` endpoint → 404. Killed it, restarted `backend/server.py --port 8765`. Re-probed scan for `/Users/yash/Claude/Linkedin Posts scraper copy` → `ok:true`, files present: readme, changelog, bugs, tasks. Fixed the malformed "create" button (dropped `ghost` square variant) in coding-projects.js.
- **Follow-up:** User reloads the CP page to confirm scan results render and create buttons (on genuinely-missing files) look correct.

## 2026-05-26 — Bug #024 + server re-probe — pass (static)

- **Category:** test
- **Result:** pass (static); server still stale
- **Output:** Re-probed :8765 → `/__notlinear_pick_folder` 404, `/__notlinear_scan_project` 404, index 200 → server NOT restarted since CP01. Found `.toast` z-index 300 < overlay 400 (toasts invisible in CP view); raised to 500.
- **Follow-up:** User must restart `backend/server.py` (kill old process first) for the picker/scan to work. Then retry add-folder; toast feedback is now visible.

## 2026-05-26 — TASK-CP07 — static checks — pass (smoke test pending)

- **Category:** test
- **Result:** pass (static only)
- **Output:** `node --input-type=module --check` clean; no dangling `pickAndAdd`; `app.js`, view module, CSS, index serve 200 on :8793; bootstrap line confirmed `nl_theme||'light'`.
- **Follow-up:** Full GUI smoke test (final v1): add a project via the popover (type path AND via browse button; pick an emoji from the strip); edit emoji on a row and on the page header (persists, "icon updated"); confirm a fresh profile (clear `nl_theme`) loads light; all three themes render; AND the standing chat smoke test + branch exercise show no regressions (esp. the theme-default change in app.js). If green, mark CP07 + the whole CP feature Done.

## 2026-05-26 — TASK-CP06 — static checks + server diagnosis — pass (smoke test pending)

- **Category:** test
- **Result:** pass (static); diagnosis logged
- **Output:** `node --input-type=module --check` clean; module + CSS serve 200. Diagnosis of user's "add folder does nothing": `curl -X POST :8765/__notlinear_pick_folder` → **404**, while `:8765/frontend/index.html` → 200. Confirms a stale server process (started before CP01's endpoint). Fix: restart `backend/server.py`.
- **Follow-up:** User restarts the server, retries add-folder (native picker should appear), then comments smoke test (post/delete/persist both surfaces, count sync, ⌘↵, themes).

## 2026-05-26 — TASK-CP05 — static checks — pass (smoke test pending)

- **Category:** test
- **Result:** pass (static only)
- **Output:** `node --input-type=module --check` clean. Module, CSS, index serve 200 on :8795; `cp-drawer` appears 7× in index.html (markup + handlers wired).
- **Follow-up:** GUI smoke test before marking CP05 Done — open each present file from the project page (drawer renders markdown, shows path+size), confirm missing cells are not clickable, close via X / Escape / outside-click, and that `.cp-scroll` reflows (margin-right) without occlusion. All three themes.

## 2026-05-26 — TASK-CP04 — static checks — pass (smoke test pending)

- **Category:** test
- **Result:** pass (static only)
- **Output:** `node --input-type=module --check` clean after adding the project page + DeepSeek status switch. View module, CSS, and index.html serve 200 on :8796.
- **Follow-up:** GUI smoke test before marking CP04 Done — open a project page, edit title (persists + "renamed"), confirm files grid (present clickable / missing dimmed), bugs/tasks/changelog/overview render, missing-file dashed callout, breadcrumb + back/Escape (page→list→chat), all three themes. Also confirm the DeepSeek status sentence fills when a DeepSeek key is set (heuristic otherwise).

## 2026-05-26 — TASK-CP03 — static checks — pass (smoke test pending)

- **Category:** test
- **Result:** pass (static only)
- **Output:** `node --input-type=module --check views/coding-projects.js` clean. Server on :8797: view module + CSS serve 200. Live `/__notlinear_scan_project` on this repo parsed; module's open-bug regex (`^[ \t>]*[-*+]\s+\[ \]`) returns 0 for this repo's BUGS.md (expected — fixed/verified format).
- **Follow-up:** GUI smoke test before marking CP03 Done — add a real folder via native picker, confirm row renders, status sentence fills (Haiku when a key is set, heuristic otherwise), gallery toggle, rescan, empty state, all three themes; and chat still unaffected.

## 2026-05-26 — TASK-CP02 — static checks — pass (smoke test pending)

- **Category:** test
- **Result:** pass (static only)
- **Output:** `node --input-type=module --check views/coding-projects.js` clean. Server on :8798: `frontend/views/coding-projects.js`, `frontend/styles/coding-projects.css`, `frontend/app.js`, `frontend/index.html` all 200; index.html grep found all 3 new hooks (`cp-screen`, `cp-side-head`, `coding-projects.css`).
- **Follow-up:** GUI smoke test required before marking CP02 Done — full AGENTS.md 10-item + hard branch exercise (create/nest/reopen/persist-across-switch/search) + open the "coding projects" sidebar section, confirm overlay opens, back button + Escape return to chat, collapse caret persists across reload, all three themes.

## 2026-05-26 — TASK-CP01 — curl verification — pass

- **Category:** test
- **Result:** pass
- **Output:** `py_compile` clean. Server on :8799. `/__notlinear_scan_project` on repo root: listing correct (files + dirs, hidden skipped); files block → readme/changelog/bugs present with text, tasks `{present:false}`. Missing path → `{ok:false,error:"not a directory"}`. Empty path → HTTP 400. Existing endpoints intact: `/__notlinear_runtime_logs` 200, `/frontend/index.html` 200.
- **Follow-up:** No app UI yet, so no full smoke test this phase. Human can spot-check the endpoints; then TASK-CP02 (shell seam) which DOES require the full hard smoke test.

## 2026-05-26 — TASK-CP00 — scaffold — pass

- **Category:** scaffold
- **Result:** pass
- **Output:** Recorded ADR-003/004/005 in DECISIONS.md and seeded CP00–CP07 in TASKS.md. No app files changed.
- **Follow-up:** Human reviews the plan; then TASK-CP01 (additive backend endpoints).

## 2026-05-24 — TASK-M04 — curl verification — pass

- **Category:** test
- **Result:** pass
- **Output:** HTTP 200 on app.js, core/state.js, index.html. No double substitution detected (assertion passed). 143 primitive refs replaced across 7 variables.
- **Follow-up:** Human runs **hard** smoke test: chat, branch create, branch nest, branch reopen, branch persist-across-switch, search-tool branch. All Fragile areas (#002–#018) must pass.

## 2026-05-24 — TASK-M03 — curl verification — pass

- **Category:** test
- **Result:** pass
- **Output:** HTTP 200 on `/frontend/app.js` and `/frontend/index.html`. IIFE wrapper stripped, module tag in place.
- **Follow-up:** Human runs full smoke test. Emphasis: chat, branches, branch reopen/persist, search tools — all require the JS to execute correctly as a module.

## 2026-05-24 — TASK-M02 — curl verification — pass

- **Category:** test
- **Result:** pass
- **Output:** All four paths return HTTP 200: `/frontend/index.html`, `/frontend/styles/tokens.css`, `/frontend/styles/base.css`, `/frontend/styles/chat.css`. No `<style>` block remains in index.html.
- **Follow-up:** Human runs full smoke test with **emphasis on all three themes** (dark-mono / grey / light) and **highlights panel text in light mode** (bug #022). If green, proceed to TASK-M03.

## 2026-05-24 — TASK-M01 — server + curl verification — pass

- **Category:** test
- **Result:** pass
- **Output:** `python3 backend/server.py --port 8766` started; `curl` verified HTTP 200 on `/frontend/index.html`, `/CHANGELOG.md`. Shim server (`notlinear_server.py`) on port 8767 also returned 200 on `/frontend/index.html`. All three paths confirmed working.
- **Follow-up:** Human runs full smoke test (AGENTS.md 10-item checklist) against `backend/server.py` at port 8765. Pay attention to: changelog viewer showing live file (not fallback), logs.md syncing, update-refresh firing on edit, themes, branches.

## 2026-05-24 — TASK-M00 — scaffold — pass

- **Category:** scaffold
- **Result:** pass
- **Output:** Created `docs/project-notes/` and all four memory files (TASKS.md, RUNS.md, CHANGES.md, DECISIONS.md). Committed migration baseline (d47bd96) capturing working monolith + all project docs. No app files changed.
- **Follow-up:** Human to confirm files look correct; then proceed to TASK-M01.
