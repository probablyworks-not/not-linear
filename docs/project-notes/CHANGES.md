# CHANGES.md — internal work memory

Each entry: **date · summary · files touched · why changed · risks · tests run · next steps**

---

## 2026-05-24 — TASK-M00: Migration baseline + memory scaffolding

- **Summary:** Committed the working monolith as the migration baseline. Created `docs/project-notes/` with all four memory files required by AGENTS.md. Seeded TASKS.md with M00–M06. Recorded two ADRs in DECISIONS.md.
- **Files touched:** `docs/project-notes/TASKS.md` (new), `docs/project-notes/RUNS.md` (new), `docs/project-notes/CHANGES.md` (new), `docs/project-notes/DECISIONS.md` (new). No app files modified.
- **Why changed:** AGENTS.md mandates these files exist before migration work begins. They provide working memory, task tracking, and a revertible baseline.
- **Risks:** None — no app code was changed.
- **Tests run:** None required (no app change).
- **Next steps:** Proceed to TASK-M01 (folder split: `notlinear_server.py` → `backend/server.py`, `notlinear.html` → `frontend/index.html`).
