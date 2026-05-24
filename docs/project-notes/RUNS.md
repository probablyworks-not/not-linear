# RUNS.md — run log

Each entry: **date/time · task or bug ID · command category · result · important output · follow-up**

---

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
