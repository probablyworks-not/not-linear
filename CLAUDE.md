# CLAUDE.md — not-linear

**Read `AGENTS.md` first and follow it.** It is the source of truth for every agent — repo map, setup, verification smoke test, do-not-touch list, security rules, and the project-memory file structure. When anything here is unclear, **AGENTS.md wins.** This file only adds Claude-specific behavior; keep it short.

## Claude-specific behavior

- **Plan mode for risky changes.** Anything touching branches, persistence/IndexedDB, the server, or the migration: present a plan first, including the call sites you grepped and verified, before editing.
- **Notes feature persistence is deliberately separate.** Notes (`frontend/views/notes.js`, PRD `notes_product.md`) stores to its own Dexie db `notlinear-notes`, intentionally *not* the chat `notlinear` db (ADR-007). When a task touches Notes persistence, keep the two dbs separate and don't bump the chat schema for Notes.
- **Summarize the diff** you intend to make before applying it.
- **Ask before destructive or irreversible actions** — deleting files, clearing IndexedDB, rewriting git history, or any destructive command. Don't do them on assumption.
- **Follow `MIGRATION.md` for the modularization.** Do **one phase per session** and stop for the human to run the smoke test between phases. Do not bundle phases.

## Memory policy — update after every substantial session

Per AGENTS.md "Project memory": append to `CHANGELOG.md` and `docs/project-notes/CHANGES.md`; add a `BUGS.md` entry on fixes; log the smoke test in `docs/project-notes/RUNS.md`; record architectural choices in `docs/project-notes/DECISIONS.md`; keep `docs/project-notes/TASKS.md` statuses current. **If the session added, removed, or materially changed a feature** (backend endpoint, frontend interaction, view), also update the matching section of `FEATURES.md` in place — it's a current-state snapshot, not a changelog, so edit rather than append.

## Preferred working style

**Explore → plan → edit → test (smoke test) → update memory files → summarize.**

## Token hygiene

Don't re-read large files end to end. The JS in `notlinear.html` is sectioned with `// ---------- ... ----------` banners — grep to the relevant section/function. Load a `skills/*/SKILL.md` only when its description matches the task, and never pre-load its `references/`.
