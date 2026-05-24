# CHANGES.md — internal work memory

Each entry: **date · summary · files touched · why changed · risks · tests run · next steps**

---

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
