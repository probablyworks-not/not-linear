# plan.md — Open-sourcing the not-linear core

**Status:** proposed (2026-07-09). **Owner:** Yash.
**Decision record:** ADR-032 in `docs/project-notes/DECISIONS.md` (filed as a second ADR-010; renumbered 2026-10-04).

not-linear has grown from one product into several living in one repo: branching chat, Notes, Coding Projects, a feedback collector. This plan open-sources **only the core product** — threads, branching, chat projects, and the context engine — as its own repo, and defines how everything else stays separate from now on.

---

## 1. What ships vs. what stays private

### Ships (the OSS core)

| Capability | Where it lives today |
|---|---|
| Threads (chats, sidebar, breadcrumbs, thread map) | `frontend/app.js`, `frontend/index.html`, `frontend/styles/{tokens,base,chat}.css` |
| Branching from highlights (create / nest / reopen / persist) | `frontend/app.js` (branch sections), `skills/branch-system/` knowledge |
| Projects (rules, knowledge files, linked folder) | `frontend/app.js` (`// ---------- projects ----------`), `core/store.js` |
| Context engine (`buildBranchContext`, `buildSystemPrompt`, folder-context keyword + DeepSeek ranking, Sources chip) | `frontend/app.js`, provider modules |
| Providers + tools (Claude, DeepSeek, OpenAI-compatible; Serper/Firecrawl/SearXNG/Wikipedia/fetch_url) | `frontend/providers/*` |
| Shared core (registry, state, store, api-client, markdown, ui, emoji, mind-garden glyphs) | `frontend/core/*` (all except `feedback.js`) |
| Local server | `backend/server.py` minus the three `__notlinear_feedback_*` routes |
| Launchers | `launchers/` (macOS shell; keep, label macOS-only) |

Server endpoints that ship: `__notlinear_pick_folder`, `__notlinear_scan_project` (used by chat Projects' linked-folder context), `__notlinear_open_files`, `__notlinear_save_file`, `__notlinear_runtime_logs`.

### Stays private (excluded from the OSS repo)

- **Notes** — `frontend/views/notes.js`, `frontend/styles/notes.css`, `notes_new_feature.md` (the old `notes_product.md` PRD is not in the repo), its Dexie db `notlinear-notes` (ADR-007 already isolates it; nothing in core references it except the `initNotes()` bootstrap line).
- **Coding Projects** — `frontend/views/coding-projects.js`, `frontend/styles/coding-projects.css`.
- **Feedback collector** — `frontend/core/feedback.js`, `frontend/styles/feedback.css`, `feedback/`, the three `__notlinear_feedback_*` server routes.
- **Working memory & scratch** — `docs/project-notes/`, `logs.md` contents, `uploads/`, `BUGS.md` history (see §4 — a *curated* fragile-areas doc ships instead), `notlinear.html` (the legacy monolith), `frontend/{index-design,debug-keys,mind-garden-icons}.html`, `tweaks-panel.jsx`, `.claude/`.

The extraction is mostly **deletion + unwiring**, because Notes/Coding Projects/feedback are already self-contained modules: remove their files, delete 3 imports + 3 `init*()` calls in `app.js`, their two sidebar sections in `index.html`, three stylesheet links, and three server routes. Chat/branch/project code is untouched.

---

## 2. Repo strategy — new clean repo, no shared history

Create a **fresh public repo** (single squashed initial commit). Do **not** publish this repo or its history: history contains personal screenshots (`uploads/`), feedback media, runtime logs, and working notes, and scrubbing git history is riskier than starting clean.

- **Naming:** "not-linear/notlinear" collides mentally (and search-wise) with Linear the issue tracker. Decide before launch: keep the name and own the pun, or rename. Renaming is cheap now and impossible later. *(Recommendation: rename; shortlist 3 candidates before Phase 3.)*
- **This private repo continues to exist** as your personal workspace (Notes, Coding Projects, feedback, experiments).
- **Direction of flow after launch:** the OSS repo becomes the **source of truth for core**. Core fixes/features happen there; the private repo pulls core in (git subtree or plain vendoring — subtree recommended, it keeps "no build step" intact).

## 3. Keeping the projects separate from now on (the boundary)

The view registry (`frontend/core/registry.js`) is already the plugin seam. Formalize it:

1. **Core rule:** nothing under `frontend/core/`, `frontend/providers/`, `frontend/app.js`, or `backend/server.py` may reference a private feature by name. Private features register themselves.
2. **Plugin loader:** core's `app.js` bootstrap optionally imports `frontend/plugins/index.js` if present (a try/catch dynamic `import()`), and `server.py` optionally loads `backend/plugins.py` for extra routes. In the OSS repo, `plugins/` is a documented, gitignored extension point. In the private repo, Notes / Coding Projects / feedback move under `plugins/` and register through it.
3. **Persistence rule stays:** private features never touch the `notlinear` Dexie db (ADR-007 pattern generalizes: one db per feature).
4. **New features default to private-plugin first**; they graduate to core only deliberately.

This replaces "one repo, many products" with "public core + private plugins" — the separation the user asked for, without forking the UI shell.

---

## 4. Phased extraction tasks

Work one phase per session, smoke test between phases (AGENTS.md rules apply until the new repo exists).

### OSS-00 — Settle the working tree
Commit or stash all current uncommitted changes in this repo so extraction starts from a known-good baseline. Run the full 10-step smoke test and record it in `RUNS.md`.

### OSS-01 — Carve the core (in a scratch copy, not in-place)
Copy the repo to a scratch dir; delete the "stays private" list; unwire the 3 imports/inits in `app.js`, sidebar sections in `index.html`, stylesheet links, feedback routes in `server.py`. Verify with `node --check` on every JS file, `py_compile` on the server, then run the smoke test (steps 1–8; skip Notes/CP steps).

### OSS-02 — Scrub & security audit
- `grep -ri` for: `/Users/`, real names, emails, API keys, tokens (`sk-`, `key`, `Bearer`), personal URLs.
- Confirm the runtime log **redacts auth headers** (it does today — keep the test).
- Neutralize personal defaults (e.g. `prefs.name: 'Alex'` → empty / "You").
- Delete `.DS_Store`s, add a proper `.gitignore` (`logs.md` runtime section, `__pycache__`, `uploads/`, `plugins/`).
- Write `SECURITY.md`: threat model is *local-first, keys live in the browser's localStorage/IndexedDB for 127.0.0.1, never sent anywhere but the provider; the server binds to localhost only* (verify the bind address!).

### OSS-03 — Docs for humans
- **README.md** — the pitch (see §6), a 30-second GIF of the core loop (type → stream → highlight → branch → the branch already knows context), quickstart (`git clone`, `python3 backend/server.py`, open the URL — zero installs), provider key setup, macOS-only caveats.
- **LICENSE** — MIT (maximizes adoption; nothing here needs copyleft).
- **CONTRIBUTING.md** — small PRs, the smoke test is the contract, fragile-areas list.
- **FRAGILE.md** — curated from `BUGS.md`: the branch-reopen, branch-persistence, and tool-status failure modes, written as "here be dragons" guidance rather than the personal bug diary.
- **AGENTS.md (curated)** — ship a cleaned version + the `skills/` folder (branch-system, persistence, tool-runners, system-prompt). An agent-maintainable OSS repo is genuinely differentiating in 2026; scrub personal workflow references first.
- Fresh `CHANGELOG.md` starting at v0.1.0.

### OSS-04 — Minimum CI before accepting strangers' PRs
No test framework exists; the manual smoke test won't survive outside contributors. Minimum bar:
- GitHub Actions: `node --check` all JS, `python3 -m py_compile backend/server.py`.
- One **Playwright smoke test** that automates smoke steps 1, 3, 7 with a mocked provider (load app → create thread → branch from a highlight → reload → branch persists). This is the single highest-leverage investment in the whole plan — branching is the product *and* the most regression-prone area (bugs #002–#018).

### OSS-05 — Cross-platform honesty
`server.py` uses `osascript` for pickers/dialogs → those features are macOS-only; Linux/Windows users can still run everything else. For v0.1: feature-detect and degrade gracefully (hide "link folder"/native pickers off-macOS, keep drag/paste attachments working), and say so in the README. Full cross-platform pickers (a `tkinter` fallback or browser `showDirectoryPicker`) is a great "good first issue".

### OSS-06 — Publish
New GitHub repo, squashed initial commit, tag `v0.1.0`, demo GIF in the README, launch post (X + Show HN). Enable Issues with a bug template that asks for the smoke-test step that fails.

---

## 5. Milestone 2 — VS Code extension (next, ~tomorrow)

**Goal:** branch a Claude chat *inside VS Code*, including branching from a code selection.

### What carries over
The valuable, portable part is the **engine, not the DOM**: the thread/branch data model, `buildBranchContext` (ancestor-chain walk → messages array), `buildSystemPrompt`, and `frontend/providers/*` (already dependency-free ES modules that talk raw `fetch`). The 5,400-line `app.js` UI does **not** carry over.

### The quality principle
Output quality in a chat tool is a function of **what goes into the `messages` array**. That logic exists and is tuned in the web app. Therefore: **one engine, shared by both surfaces, extracted and tested before any extension code is written.** A second implementation inside the extension would drift and silently degrade one surface. Everything below serves that principle.

### VSX-00 — Prerequisite: extract + test the engine (do in the OSS repo; blocks everything else)
Extract an **engine layer** with zero DOM access:
```
frontend/engine/
  model.js      // thread/branch shapes, ids, tree ops (parent walk, subtree ops)
  context.js    // buildBranchContext, buildUserContent, buildSystemPrompt, token-budget trimming
  providers/    // moved from frontend/providers/ (already clean fetch-based ESM)
```
Rules: engine files never touch `document`, `window.Dexie`, or `localStorage`; state in → messages/streams out. `app.js` switches to importing the engine (behavior-identical move, MIGRATION.md discipline applies).

**Golden tests land in the same session** (`node --test`, no framework needed): fixture thread-trees → assert the **exact messages array** the engine builds — root-only, 3-deep branch chain, branch with `sourceQuote`, missing ancestor response, deep chain hitting the token budget. These snapshots are the output-quality contract: any PR that changes what the model sees fails a test and has to say so. This is also where web-app ↔ extension parity is enforced forever.

### VSX-01 — Extension skeleton + chat loop
- **Location:** `vscode/` inside the OSS repo — imports `../frontend/engine/` at build time; one source of truth, no sync scripts, engine test suite covers both surfaces.
- **Stack:** TypeScript `strict`, esbuild, `@vscode/vsce` for packaging. (The no-build rule is a web-app rule; extensions require packaging.) ESLint + `tsc --noEmit` gate every commit from day 1 — this codebase should never need its own MIGRATION.md.
- **Process split (also the security boundary):** provider calls run in the **extension host** (Node fetch, AbortController per thread); the **webview** is render-only and receives deltas via `postMessage`. Keys live in `SecretStorage` and never enter the webview. Strict CSP on the webview HTML.
- **Typed protocol:** a single `protocol.ts` of discriminated unions for every host↔webview message (`delta`, `done`, `error`, `branchFromSelection`, …). Untyped postMessage soup is the classic webview quality sink; this is non-negotiable.
- **Persistence:** JSON file under `context.globalStorageUri`, keyed by workspace, with a `schemaVersion` field and a migration function **from day 1** (the [SCHEMA] lesson, applied early). IndexedDB inside webviews is evictable — don't trust it.
- **UI:** minimal webview — thread list, active thread, branch crumbs. Plain TS + DOM (reuse `core/markdown.js`; it's DOM-based and webviews have a DOM). Theme via `--vscode-*` CSS variables so it looks native in every theme. Not a port of the full canvas.

### VSX-02 — Branching + the code-context recipe (where output quality is won or lost)
- **Branch inside a response:** select text in the webview → branch button → `sourceQuote`, same interaction and same engine path as the web app.
- **Branch from code:** editor context-menu *"Branch from selection"*. The naive version (paste the selection) produces *worse* answers than Copilot/Cursor, because they send file context. The recipe, built in `engine/context.js` as a pure function so it's testable:
  - the selection, fenced with `languageId`, tagged with `path:startLine-endLine`;
  - the **enclosing symbol** (function/class) via `vscode.executeDocumentSymbolProvider`, so the model sees the whole unit, not a fragment;
  - imports/top-of-file context up to a budget; active diagnostics on the selected range if any;
  - explicit, deterministic **token-budget trimming order** (drop file context before ancestor turns, never truncate the selection silently).
- **Context inspector:** a "what the model saw" toggle per response (the Sources-chip ethos carried over). When an answer is bad, you can see *why* — this is the debugging loop that keeps output quality from silently rotting.
- **MVP cut:** Claude only, no tools/search, no projects — threads + branching + context. Tools and projects come later.

### VSX-03 — Quality gates before Marketplace
- **CI:** engine golden tests + `tsc` + ESLint on every PR; integration test via `@vscode/test-electron` for the three critical paths (open panel, send/stream with a mocked provider, branch-from-selection produces the expected messages array).
- **Manual eval set:** ~10 fixed prompts (5 research-style, 5 code-branching on a sample repo) run before each release and compared against the web app's answers — cheap, catches prompt/context regressions the unit tests can't.
- **Dogfood a full week** in your own editor before publishing; errors must surface in the response UI (never swallowed — existing rule), including rate-limit and abort states.

### Sequencing (realistic)
Day 1: VSX-00 (engine + golden tests). Days 2–3: VSX-01 (skeleton, streaming chat). Days 4–5: VSX-02 (both branch entry points, persistence, context inspector). Then the VSX-03 dogfood week runs in parallel with OSS launch prep.

---

## 6. Positioning & product risks (summary — see review discussion)

- **The pitch is one sentence:** *"Chat is a document. Highlight anything, press branch, and the follow-up already knows everything above it."* Everything that isn't that sentence (Notes, Coding Projects) dilutes it — which is exactly why this plan cuts them.
- **Crowded space:** branching/canvas AI chat exists (ChatGPT's hidden edit-trees, canvas tools, various "loom"-style UIs). The defensible angles are (1) the highlight-→-branch interaction being *fast* (sub-2s loop), (2) local-first with your own keys, zero install, (3) meeting developers where they live — the VS Code extension matters more than the web app for distribution.
- **Biggest OSS-readiness gaps, in order:** no automated tests over the most fragile code (OSS-04), macOS-only server affordances (OSS-05), a 5,400-line `app.js` as the contribution surface (mitigate with FRAGILE.md + skills/ now; continue the modularization as public roadmap, don't block launch on it).
- **Name collision** with Linear (§2).

## 7. Launch checklist (gate for "public")

- [ ] OSS-00…OSS-06 done; smoke test green in the new repo
- [ ] Scrub grep clean; server binds localhost only; log redaction verified
- [ ] LICENSE, README + GIF, SECURITY.md, CONTRIBUTING.md, FRAGILE.md present
- [ ] CI green (checks + Playwright smoke)
- [ ] Name decided; repo + tagline set
- [ ] Private repo restructured to consume core + `plugins/` (can land after launch)
