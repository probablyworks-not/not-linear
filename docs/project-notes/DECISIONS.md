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

---

## ADR-003 — Coding Projects reads the real filesystem via new additive backend endpoints
- **Status:** accepted
- **Context:** The Coding Projects feature must list local code folders and read each project's `README/CHANGELOG/BUGS/TASKS`. The existing endpoints don't fit: `/__notlinear_open_files` returns base64 file *contents* from a picker (not a path), and there is no "read these files from a known path" endpoint. AGENTS.md forbids renaming or altering existing `/__notlinear_*` endpoints.
- **Decision:** Add two **additive, read-only** endpoints. `/__notlinear_pick_folder` runs osascript `choose folder` and returns `{ok, path}` (path only). `/__notlinear_scan_project` takes `{path}` and returns the project name, a **shallow top-level file listing** of the folder, and the parsed text + metadata (present/size/mtime) of the four convention files (case-insensitive `README/CHANGELOG/BUGS/TASKS`, with/without `.md`). Reads are size-capped and path-validated (reject `..`, confine to the given directory, no recursive walk).
- **Alternatives rejected:**
  - **Reuse `/__notlinear_open_files`:** Returns base64 from a one-shot picker; no way to re-scan a known path; would require altering a frozen endpoint.
  - **Read files in the browser via `file://`:** Blocked by the browser; the whole point of the local server is filesystem access.
  - **Strict 4-files-only scan (no listing):** Rejected per the user's choice to surface a shallow folder listing so the drawer can open more than the four files later.
- **Consequences/tradeoffs:** Slightly wider read surface than the four files (a shallow listing), so the scan endpoint must guard against path traversal and large/binary files. New endpoints are additive, so existing flows are untouched. Stdlib-only (`os`, `pathlib`) — no new dependency.
- **Related files:** `backend/server.py`, `frontend/core/api-client.js`, `frontend/views/coding-projects.js` (future)

---

## ADR-004 — Coding Projects state lives in localStorage, not Dexie
- **Status:** accepted
- **Context:** The feature needs to persist: the registry of added project paths + per-project emoji/name overrides, sidebar collapse state, comments, and the theme. The IndexedDB/Dexie schema is "sacred" (AGENTS.md) — any change needs a migration and a `[SCHEMA]` tag.
- **Decision:** Keep all Coding Projects state in `localStorage`, matching the PRD keys: `nl_cp_projects_v1` (registry: `[{id, path, emoji, name?}]`, keyed conceptually by absolute path per PRD §14.3), `nl_cp_side_collapsed_v1`, `nl_cp_comments_v1`, and the existing global `nl_theme`. The Dexie store is not touched.
- **Alternatives rejected:**
  - **New Dexie store:** Triggers the schema-migration ceremony and risks the Fragile persistence areas for no benefit at this scale.
  - **Write `.notlinear.json` into each project folder:** Mutates the user's repos; PRD §14.3 proposes workspace state instead.
- **Consequences/tradeoffs:** State is per-browser-profile and not shared across machines (acceptable for a local-first single-user tool). Comments are not in the same durable store as chat, but the PRD explicitly scopes them to `localStorage` for v1.
- **Related files:** `frontend/views/coding-projects.js` (future), PRD §10

---

## ADR-005 — Status sentence is LLM-generated (DeepSeek), cached by file mtime
- **Status:** accepted (updated 2026-05-26: provider Claude → DeepSeek per user request)
- **Context:** PRD §4/§14.1 asks for a synthesized one-line status per project derived from `changelog` + `tasks`. Open question: local heuristic vs. LLM. The user chose an LLM call now, and chose **DeepSeek** as the provider.
- **Decision:** Generate the status sentence with an isolated non-streaming **DeepSeek** call (`https://api.deepseek.com/v1/chat/completions`, model `deepseek-chat`, OpenAI-compatible, `Authorization: Bearer`), reusing the user's already-entered `appState.apiKeys.deepseek` — no new provider config. The call deliberately does NOT touch `appState._activeController` (which `callDeepSeek` mutates), so it can never interrupt an in-flight chat stream. **Cache invalidation:** cache the generated sentence in `localStorage` keyed by project path + the max mtime of `changelog`/`tasks`; regenerate only when that mtime changes (or on explicit rescan). Falls back to a local heuristic (latest changelog entry + first open task) if no DeepSeek key is set or the call fails, so the list never blocks on the network.
- **Alternatives rejected:**
  - **Local heuristic only:** Simpler, but the user wants the richer LLM synthesis now.
  - **Regenerate on every list render:** Wasteful and slow; would hammer the API on each mount.
- **Consequences/tradeoffs:** Adds a model dependency to the list view; mitigated by the mtime cache and the heuristic fallback. Model choice is fixed to the user's configured Claude model for v1.
- **Related files:** `frontend/views/coding-projects.js` (future), `frontend/providers/claude.js`, PRD §14.1

---

## ADR-006 — Coding Projects renders as a full-screen overlay, not an in-place main swap
- **Status:** accepted
- **Context:** TASK-CP06 (registry) made chat a registered view, but chat mounts inline with no-op `mount`/`unmount` and the shell is hardcoded in `index.html`. Two ways to give Coding Projects a home: (A) a full-screen overlay like the existing `.project-screen` (`#project-panel`), or (B) swap only the `.main` content/composer between chat and CP while keeping the sidebar always visible (matches the PRD layout more literally).
- **Decision:** Use a full-screen overlay `#cp-screen` (`position:fixed; inset:0; z-index:400; .show` toggles it) — identical mechanism to `.project-screen`, which already ships and is proven. The chat DOM is never modified, so the Fragile branch code (BUGS.md #002–#018) is untouched. Coding Projects has its own internal nav (list ⇄ project page) and a back affordance; the sidebar gains a "coding projects" launcher section.
- **Alternatives rejected:**
  - **In-place main swap (B):** Closer to the PRD's always-present sidebar, but requires giving chat real show/hide `mount`/`unmount` over shell visibility — risk near the Fragile areas for a cosmetic gain. Rejected for v1 (user chose the overlay).
- **Consequences/tradeoffs:** While Coding Projects is open, the chat sidebar is covered (the overlay supplies its own chrome). Slight divergence from the PRD's "sidebar always present." The app's main brand keeps its existing behavior; the CP launcher lives in the sidebar's new "coding projects" section, and brand/back *inside* the overlay returns to the list / to chat. Chat behavior is provably unchanged because its DOM and handlers are not touched.
- **Related files:** `frontend/index.html` (`#cp-screen`), `frontend/styles/coding-projects.css`, `frontend/views/coding-projects.js`, `frontend/core/registry.js`, `styles/base.css` (`.project-screen` precedent)
