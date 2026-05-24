# DECISIONS.md — lightweight ADRs

Each entry: **Decision ID · status · context · decision · alternatives rejected · consequences/tradeoffs · related files**

---

## ADR-001 — Modular frontend via native ES modules, no build step
- **Status:** accepted
- **Context:** The `notlinear.html` monolith has grown to ~7,500 lines, making it difficult to add features, reason about sections, or work in parallel across areas. A modular structure is needed.
- **Decision:** Split into `backend/` + `frontend/` using native ES modules (`<script type="module">`). No bundler, no transpiler, no build step — just files the browser loads directly. CDN libraries (Dexie, Mermaid, Tabler, Google Fonts) stay as global `<script>` tags in `index.html`.
- **Alternatives rejected:**
  - **Vite / esbuild:** Adds a build step and npm dependency; contradicts "open it and it runs."
  - **Webpack / Rollup:** Same reason, heavier.
  - **Keep the monolith:** Unsustainable for adding features like Coding Projects.
- **Consequences/tradeoffs:** No tree-shaking or minification in dev; module loading is slightly more HTTP requests (acceptable on localhost). CDN libs remain globals, so modules can't `import` them — they rely on `window.Dexie`, `mermaid`, etc. This is a conscious trade-off documented here.
- **Related files:** `MIGRATION.md`, `frontend/index.html` (future), `frontend/app.js` (future)

---

## ADR-002 — Memory files under `docs/project-notes/`; CHANGELOG.md and BUGS.md stay at root
- **Status:** accepted
- **Context:** AGENTS.md requires project-memory files (`TASKS.md`, `RUNS.md`, `CHANGES.md`, `DECISIONS.md`) for agent working memory. `CHANGELOG.md` and `BUGS.md` already exist at root and are referenced by the app (in-app changelog viewer fetches `CHANGELOG.md`) and by existing workflow.
- **Decision:** Place the four new agent-memory files under `docs/project-notes/`. Keep `CHANGELOG.md` and `BUGS.md` at root, unchanged.
- **Alternatives rejected:**
  - **All memory files under `docs/`:** Would require moving `CHANGELOG.md` and `BUGS.md`, breaking the in-app viewer fetch path and existing workflow references.
  - **All memory files at root:** Clutters root; agent working memory and user-facing docs would mix.
- **Consequences/tradeoffs:** Slight inconsistency (some docs at root, some in `docs/`), but the split follows the natural boundary: user-visible / app-referenced files at root, agent-internal working memory under `docs/`.
- **Related files:** `AGENTS.md`, `CHANGELOG.md`, `BUGS.md`, `docs/project-notes/`
