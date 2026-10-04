# Refactor handoff — read this first

**Status as of 2026-10-04.** Phases P-1, P0, P1 and **P2 (complete, including the
four hardening changes and the provider registry)** are done and committed on branch
`refactor/p0-repo-hygiene`. `main` is untouched at `ccf7504`. Nothing is pushed.

**Next phase is P3 (React shell).**

This file is the context a new session needs. Read it instead of re-deriving the
state, then read `AGENTS.md` and `CLAUDE.md` for the standing rules.

---

## Where things are

| | |
|---|---|
| Branch | `refactor/p0-repo-hygiene` (5 commits ahead of `main`) |
| Plan of record | `/Users/yash/.claude/plans/pasted-content-id-9423-notlinear-refact-cheeky-brooks.md` |
| Backend | FastAPI in `backend/app/`, entry point `backend/server.py` |
| Old backend | `backend/server_legacy.py` — kept as the test oracle, delete at the P3 gate |
| Frontend | `frontend/` unchanged (native ES modules, no build step) |
| New frontend | `web/` — scaffold + tests only, no app yet |

```
33a02fd  Record P2 completion in the memory files
a6c1926  P2b: one ChatProvider interface and a single TOOL_SPECS registry
4c62500  Hardening (c) and (d): filesystem consent ledger, argv AppleScript
d79ae22  Hardening (b): block SSRF in link_preview (supersedes ADR-023)
87e9804  Hardening (a): require X-Notlinear-Local on every endpoint
aab8018  Add refactor handoff doc; record the smoke-test pass
cc7362a  Fail clearly when the port is already in use
b7de178  P2a: FastAPI core, and static serving becomes an allowlist
020b98a  P1: test safety net
3a6f43b  P0: repo and dev hygiene
d38702f  Add data backup/restore tools (P-1)
```

## Run it

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt   # one time
python3 backend/server.py                                           # http://127.0.0.1:8765
```

`backend/server.py` re-execs into `.venv` automatically, which is why the
launchers and `Notlinear.app` still work — they all call the system `python3`,
which has no FastAPI. `--legacy` runs the old dependency-free server.

## The gate before claiming anything is done

```bash
NOTLINEAR_SERVER=fastapi .venv/bin/python -m pytest tests/contract   # 142 tests
NOTLINEAR_SERVER=legacy  .venv/bin/python -m pytest tests/contract   # 120 + 22 skipped
cd web && pnpm test && pnpm typecheck                                # 63 + 3 skipped
cd web && pnpm e2e                                                   # 15 Playwright
```

Then the manual steps at `AGENTS.md` "Verification" that automation cannot cover:
the DeepSeek rate-limit fallback, nested branch reopen, search-backed branch
status, files-and-folder attach, light-mode contrast, and the update prompt.

---

## Landmines — things that cost real time to discover

Read these before touching the relevant area. Each one was found the hard way.

**Storage is per-realm, not per-origin.** `Notlinear.app` is a WKWebView using
its own `WKWebsiteDataStore` under `~/Library/WebKit/local.notlinear.app/`.
It, Chrome and Safari all load `http://127.0.0.1:8765` and each hold a
*completely separate* copy of both IndexedDB databases. The desktop app's data
and the browser's are different data. A backup covers only the realm it was
taken in. (`tools/export-data.html` detects and records the realm.)

**`localhost` ≠ `127.0.0.1`.** Different origins, different IndexedDB. Developing
on `localhost:5173` reads an empty database that looks exactly like data loss.
This is why P3's dev proxy must keep one origin.

**The schema stores rendered HTML.** `threadState[id].stream` is
`stream.innerHTML` (app.js:1164, :1369), with highlights and branch anchors
living inside it as `<span class="highlighted" data-hid>` / `.branched[data-bid]`.
"React chat + unchanged schema" therefore obliges React to **dual-write**
legacy-parsable HTML. This is the dominant hidden cost of P5. Decide dual-write
vs one-way cutover *before* starting P5a, not during it.

**`projects` is an object keyed by id, not an array.** Cost one real bug.

**Dexie version bumps are invisible to behavioural tests.** A fresh test database
opens at whatever version you ask for; a real one runs an upgrade. Only
`web/tests/schema/schema-invariants.test.ts` catches it. Do not delete it.

**`.venv/bin/python` is a symlink that `Path.resolve()` follows to the base
interpreter.** Comparing resolved paths to detect "am I in the venv" silently
reports yes when you are not. Compare `sys.prefix`.

**The compiled `Notlinear.app` loads `/notlinear.html`,** not
`/frontend/index.html`. It is in the static allowlist for that reason, with its
own regression test. Nothing else requests that path, so nothing else catches it.

**An endpoint sweep writes.** `test_every_documented_endpoint_exists` POSTs to
all twelve endpoints, including `feedback_save`. Any new module-level path in
the backend must be added to `isolated_paths` in `tests/contract/conftest.py` in
the same change. See BUGS.md #053.

**Transcribing constants during a "verbatim" move drifts.** Two did
(`LINK_PREVIEW_TIMEOUT_S`, the `CP_*` block). `tests/contract/test_service_parity.py`
is what caught them; keep it until `server_legacy.py` goes.

**Any new module-level path must go into `isolated_paths` in the same change.**
This is BUGS.md #053, and it was written down and then not applied when the
consent ledger landed — a test run wrote into `~/.notlinear`. The fixture is the
only thing standing between a test suite and the developer's real files.

**A test payload that fails validation proves nothing.** The first AppleScript
injection test used a payload containing `/`, which the filename check rejected
before `osascript` was ever called. It passed, and it tested nothing.

**Playwright failures are usually wrong test assumptions.** Three were:
`applyTheme` overwrites `nl_theme` from `prefs.theme`; the sidebar ships
collapsed so rows are not clickable; the search palette hides via opacity so its
input reads as "visible" when closed. Check the app's actual behaviour before
calling something a bug.

---

## The phases

Realistic budget: **16-18 sessions, not nine**. The phase boundaries are right;
the one-session-per-phase cadence is not. P5 alone is four sessions.

| | Phase | State |
|---|---|---|
| P-1 | Backup/restore tools | **done** |
| P0 | Repo + dev hygiene, CORS hotfix | **done**, smoke-tested |
| P1 | Test safety net + CI | **done** |
| P2a | FastAPI core, static allowlist | **done**, smoke-tested |
| P2 | Hardening (a-d) + provider registry | **done**, verified live |
| P3 | React shell | **next** |
| P4 | Leaf features | |
| P5 | Chat core (four sub-sessions) | |
| P6 | Notes editor | |
| P7 | Extension seams | |
| P8 | Public launch | |

Two things from P2 to carry forward:

- **`scan_project` returns 403** for a path outside an approved folder — the one
  place P2 is deliberately not byte-identical. The migration is
  trust-on-first-use: an *empty* ledger accepts and records the first path, so a
  stale ledger suppresses it.
- **The tool-description oracle** (`web/tests/providers/descriptions-match-app.test.ts`)
  compares the registry against `app.js`. **Delete it in P5d**, when app.js stops
  building tools and there is nothing left to compare against.

---

### P3 — React shell (next)

Foundation only. No chat, no notes.

1. **Tailwind + shadcn wired to tokens.** `web/tailwind.config.ts` maps every
   colour to a `var(--...)` from `frontend/styles/tokens.css` — enumerate them,
   do not invent. **No literal hex anywhere in `web/`**, enforced by an ESLint
   `no-restricted-syntax` rule, so bug #022 cannot recur. Preserve the three
   themes via the existing `data-theme` attribute and copy the pre-paint inline
   script from `frontend/index.html:55`.
2. **Shell layout as React**: sidebar sections, topbar + shadow, tab strip
   (ADR-022, key `nl_tabs_v1`), left pane. Toast and confirm become shadcn
   `Sonner`/`AlertDialog` but with the **exact copy** from `core/ui.js:116-137` —
   the delete-confirm wording is user-visible and asserted in smoke step 3.
3. **Zustand slices** mirroring `core/state.js:31 appState` field for field.
   **TanStack Query only for backend-derived reads** (`/CHANGELOG.md`,
   `scan_project`, `feedback_list`) — Dexie is local state behind `useLiveQuery`
   or store actions, never a query cache. Write that boundary down as an ADR;
   it is the thing teams get wrong.
4. **Persistence wiring**: `web/src/db/chat.ts` goes live, honouring
   "debounce, don't blast" — typing debounced, position and status immediate.
5. **Dev proxy**: FastAPI proxies `/web/*` to Vite so both apps share the
   `127.0.0.1:8765` origin and one IndexedDB. `web/vite.config.ts` already has
   `base: '/web/'` and `hmr.clientPort: 8765`; the server side is
   `backend/app/dev_proxy.py` behind `NOTLINEAR_DEV_PROXY=1` — an httpx
   streaming passthrough plus a websocket pump, ~60 lines. **Documented
   fallback** if the websocket pump proves flaky: `vite build --watch` and serve
   `web/dist` statically. Record that in the P3 ADR as accepted.
6. **Registry**: port `core/registry.js`'s `registerView`/`mountView`/
   `onViewChange` semantics for P7's plugin seam; drop the three
   `register*Opener` bridges — in React those are store actions.
7. **Keyboard**: `web/src/lib/keyboard.ts` for the Esc chain (`app.js:6252`).
   Port the precedence (preview > confirm > popover > panel) as a **priority
   list, not nested ifs**.

**Gate:** `/web/` renders in all three themes with zero hardcoded colours
(ESLint proves it); tabs persist to `nl_tabs_v1`; legacy still passes its smoke
test; **a thread created in legacy appears in `/web/`'s sidebar and vice versa,
within one storage realm**; schema tests green.
**Rollback:** `/web/` is purely additive; `/` still redirects to legacy.

### P4 — Leaf features (two-three sessions)

Order matters: API keys first, feedback last.

1. **Settings + API keys** (`app.js:4575` keys, `:4287` prefs, `:4632` context).
   Keys stay in `localStorage.nl_api_keys` — unchanged, `notes.js:3100` reads it
   too. Show live tool availability with `availableTools(ctx)` from the P2b
   registry: the first payoff of having moved it early. Modes modal and
   `core/modes.js` port as-is.
2. **Search palette** (`:6129`) — shadcn `Command`, same shortcut, same ranking.
3. **Changelog viewer + story player** (`:4362`, `:4471`) — keep
   `FALLBACK_CHANGELOG_MD` and ADR-018's mechanical `## <date>` parsing, no LLM.
4. **Projects grid** (`:5147`, `:5419`) — grid and chat-linking only. ADR-030
   removed the Coding Projects *view*; do not resurrect it.
5. **Attachments** (`:4672`, `:5078`) — `+` menu, native pick, drag-drop,
   attach-branch-transcript. Bug #021 (files **and** folder) gets a Playwright
   test using `NOTLINEAR_FAKE_NATIVE=1`.
6. **Feedback capture** — port `core/feedback.js` (455 lines) including the
   annotate canvas. It already uses `/feedback/media` same-origin.
7. **Runtime logs panel** (`:4529`) — keep `RUNTIME_LOG_SYNC_DEBOUNCE_MS = 1200`
   and the key/header redaction, which is an AGENTS.md hard rule.

**Gate:** each leaf exercised in `/web/`; prefs, keys and themes round-trip
between both apps (smoke step 7 run in **both**); logs still land in `logs.md`.
**Rollback:** each feature is one commit behind a `web/src/flags.ts` boolean, so
a broken leaf is a flag flip rather than a revert.

### P5 — Chat core (four sub-sessions)

**Decide before P5a:** dual-write `state.stream`, or declare a one-way cutover
where web writes `highlightsV2` only and legacy chat becomes read-only.
Dual-write preserves "both apps work" and makes P5 abandonable at any point with
zero data consequences; the cutover is cheaper but ends that guarantee early.
Do not decide this mid-phase.

- **P5a — render + stream, one thread, no branches.** Port `core/markdown.js` to
  `lib/markdown.ts` (KaTeX, mermaid, highlight.js become npm deps;
  `renderMermaidIn`/`highlightCodeIn` become post-render effects). Port
  `core/api-client.js` to `lib/api-client.ts` verbatim — timeouts,
  `signalWithTimeout`, `readStreamChunk`, request log, backend traces are all
  DOM-free. Wire the P2b providers. Main thread (`:927`), composer (`:4273`),
  conversation mode (`:1079`). Dual-write via `serializeStreamHTML`.
  **Gate:** send a Claude message; confirm the **Claude→DeepSeek rate-limit
  fallback** (#023); open the same thread in legacy and see identical content.
- **P5b — highlights + branches.** `web/src/chat/anchor.ts` (zero React: pure
  DOM and string) plus a ~40-line `useSelectionAnchor` hook. `rangeToAnchor`/
  `anchorToRange` port `selectedTextSegments` + `wrapRangeTextSegments`
  (`app.js:602-620`) near-verbatim — that `splitText` dance is load-bearing for
  multi-text-node selections. `applyMarks` takes a turn's whole mark list,
  sorts by `start` descending and wraps, so it is idempotent after every
  re-render. Plus selection popover (`:2962`), highlights panel (`:2220`),
  branch panels (`:3174`), branch menu (`:4100`), marker clicks (`:4204`), and
  the snapshot protocol (`captureBranchSnapshot`/`applyBranchSnapshot` — the
  source of #008/#009).
  **Gate, and it is the hard one:** Playwright must cover **create branch →
  nested child → close all → reopen** (#002-#004) and **switch chat → switch
  back → content persists** (#008/#009), plus a `highlightsV2`↔legacy-span
  round-trip. **Manual-only verification is not acceptable here** — the repo's
  own ADRs record that manual checks missed this class twice.
- **P5c — read-only visualizations.** Breadcrumbs (`:3265`), thread map
  (`:2650`), spatial canvas (`:2823`), edges (`:4240`). ADR-019 already fixes
  these as read-only with no branch-state writes; hold that line, it makes the
  port much safer.
- **P5d — search-backed branches.** Per-provider tool loop, status labels,
  `ToolFatalError`, `DEEPSEEK_MAX_TOOL_ROUNDS`. **Delete the tool-description
  oracle here.**
  **Gate:** smoke step 4 — status clears when the answer streams, results never
  lost (#010-#018), with a Playwright test using a mocked search tool.

**Rollback:** `/` points at legacy for all of P5; the new chat is reachable only
at `/web/`. Because every write is additive and `state.stream` is dual-written,
P5 can be abandoned mid-way with no data consequences — that property is worth
the dual-write cost.

### P6 — Notes editor

1. **Before any conversion:** define BlockNote custom inline specs for
   `.nt-cmt[data-cid]` (ADR-009) and `.nt-br-anchor[data-bid]` (ADR-028). These
   live inside `b.text` HTML, and **BlockNote drops unknown inline markup on
   parse** — so every note with a comment thread or an AI branch loses its
   anchors, after which `pruneComments` garbage-collects the orphaned threads on
   the next render. **Silent, unrecoverable data loss, and the single
   highest-risk item in the whole plan.**
2. `features/notes/convert.ts`: `legacyToBlockNote` / `blockNoteToLegacy`
   covering every block type `notes.js` emits — text, heading, list, todo,
   toggle, quote, callout, code, table, image, plus `children` (ADR-025),
   `emoji` including ADR-021's `img:<dataURL>` token, `rows`, `caption`.
3. **Property-based round-trip test**: `legacy → BlockNote → legacy` must be
   identity on the real-data fixture **and** on `fast-check`-generated
   documents, sorted-key compared. Any lossy field fails the build.
4. **Mandatory pre-write backup**: on first load of Notes v2, dump the whole
   `notlinear-notes` kv to a downloaded JSON and set `nl_notes_v2_backed_up`.
   Non-negotiable — the user holds a file before BlockNote ever writes.
5. Old editor behind `flags.notesV2`, meaning `frontend/views/notes.js` in the
   legacy shell, not a second React editor.
6. Notes branches reuse `anchor.ts` from P5b with `datasetKey: 'cid'|'bid'` —
   where that investment pays twice.
7. Export (ADR-024: markdown-only, recursive) and `save_file` wiring
   (`notes.js:1735`).

**Gate:** round-trip green on real captured data; a note with comments **and** an
AI branch survives legacy → v2 → legacy unchanged; backup file produced; full
smoke test on `/web/` alone.
**Then, one week later and as its own commit touching nothing else:** delete
`frontend/`, move `tokens.css` into `web/src/styles/`, flip `/` to `/web/`, drop
the `/frontend` mount, delete `backend/server_legacy.py` and the parity tests
that depend on it, and retire the shim for a uvicorn entry in the launchers.

### P7 — Extension seams

1. **Skills loader** — `skills/*/SKILL.md` is already a repo convention; expose
   them as selectable system-prompt augmentations reusing `core/modes.js`'s
   overrides-only merge rather than inventing storage.
2. **MCP tool registry** — an MCP client that pushes remote tools into
   `TOOL_SPECS` at runtime. Additive with zero provider changes, **which is the
   test of whether P2b was designed right.**
3. **GitHub/Reddit connectors** — more `ToolSpec`s, routed through the hardened
   `safe_fetch` with per-connector host allowlists (`api.github.com`,
   `oauth.reddit.com`) rather than the general SSRF filter.
4. **Cross-provider agent runtime** — a loop over `ChatProvider` + `TOOL_SPECS`
   with budget and step caps, kept DOM-free in `web/src/agent/` so a future
   VS Code extension can reuse it.

**Gate:** each seam adds a feature **without editing any provider file**,
enforced by a CI check that P7 commits touch nothing in
`web/src/providers/{claude,deepseek,openai,gemini}.ts`. If they do, the seam is
wrong.

**P7 does not block P8.** If the goal is to publish, ship P8 after P6 plus the
skills loader and land the rest in public. Blocking launch on four new features
is how a refactor becomes a rewrite that never ships.

### P8 — Public launch

1. **Resolve the license** (deferred from the start). Add `LICENSE`, `NOTICE`,
   `CONTRIBUTING.md`, `SECURITY.md` — documenting the loopback trust boundary
   and the ADR-035 controls honestly — and `CODE_OF_CONDUCT.md`.
2. `README.md` rewrite with screenshots, quick start and a platform support
   table; `docs/ARCHITECTURE.md`; `docs/FRAGILE.md` distilled from BUGS.md
   #002-#023.
3. Secret sweep with `gitleaks`/`trufflehog` over the **working tree** (the fresh
   repo makes history moot), plus a manual pass for `nl_api_keys` values,
   `/Users/yash/...`, and personal content in `FEATURES.md`, `plan.md`,
   `redesign_product.md`, `notes_new_feature.md`.
4. **Excluded from the public tree:** `feedback/`, `uploads/`, `logs.md`,
   `docs/project-notes/`, `BUGS.md`, the design-handoff folders,
   `tweaks-panel.jsx`, `notlinear-design.html`, `notlinear.html`,
   `notlinear_server.py`, `MIGRATION.md`.
5. **Fresh repo, one squashed commit**, seeded from a clean export of the
   curated tree. This repo stays private scratch. Add CI, issue templates,
   Dependabot.
6. Cross-platform honesty as a **real code task**: every `services/macos.py`
   function returns `{"ok": false, "error": "native dialogs are macOS-only"}` on
   non-Darwin rather than 500ing. The frontend already has browser fallbacks
   (`app.js:5003` checks `window.__notlinearDesktop || window.webkit`).

**Gate:** a stranger clones the public repo, runs two commands, and gets a
working app **on Linux** with graceful degradation of the native endpoints; CI
green; secret scan clean.

---

## ADRs still to write

| ID | Covers | Phase |
|---|---|---|
| ADR-031 | Build step accepted: React 18 + TS + Vite (supersedes ADR-001) | P3 |
| ADR-036 | Dexie schemas frozen; legacy `store.js` as the oracle; additive fields only | P3 |
| ADR-038 | Highlights/branch anchors as `(turnId, offset)` in `highlightsV2`; `state.stream` dual-written | P5b |
| ADR-039 | Dual-app coexistence: FastAPI dev-proxies `/web/*` to Vite; one origin per storage realm | P3 |
| ADR-040 | shadcn on Tailwind mapped to `tokens.css`; lint rule forbids literal colours | P3 |
| ADR-041 | Zustand owns app state; TanStack Query owns backend reads only; Dexie never behind a query cache | P3 |
| ADR-042 | Notes v2 on BlockNote with inline specs, lossless converter, mandatory backup | P6 |
| ADR-043 | Extension seams register as `ToolSpec`s; connectors use `safe_fetch` | P7 |
| ADR-044 | License + publish checklist | P8 |

Already written: ADR-032 (fresh squashed repo), ADR-033 (FastAPI), ADR-034
(static allowlist), ADR-035 (trust boundary), ADR-037 (provider registry),
ADR-047 (backup tools).

---

## Open items the user owns

- **Real-data fixture.** `cd web && pnpm fixtures <backup.json>` turns a backup
  from `tools/export-data.html` into a redacted fixture and un-skips 3 schema
  tests. Until then CI's only schema coverage is synthetic seeds, which contain
  only the fields someone thought of.
- **CI has never run on GitHub.** Verified locally only.
- **Nothing is pushed**, and `main` is untouched. Merging is the user's call.
- **A rebuild of `Notlinear.app`** would pick up the path-independence fix in
  `launchers/NotlinearNative.m`. The current binary works with its old compiled-in
  path, so this is optional.
- **Stray process** PID 47090, an idle `backend/server.py` from a failed start.
- **`~/.notlinear/allowed_roots.json` must be deleted.** A test run wrote a
  pytest temp path into it before the ledger was isolated. Because the ledger is
  non-empty, the trust-on-first-use migration will not fire, so an existing
  project folder will not be auto-approved and `scan_project` will return 403.
  `rm ~/.notlinear/allowed_roots.json` and re-pick the folder, or just delete it
  and let the next scan seed it.

## Conventions that are not optional

From `AGENTS.md` and `CLAUDE.md`, and all of them have teeth here:

- One phase per session; stop for the human smoke test between phases.
- Plan mode first for anything touching branches, persistence, the server or the
  migration — including the call sites you grepped and verified.
- Ask before destructive or irreversible actions.
- The twelve `/__notlinear_*` paths are frozen. New functionality is a new
  endpoint.
- The Dexie schemas are frozen, both of them, and they stay separate (ADR-007).
- Update the memory files every session: `CHANGELOG.md`,
  `docs/project-notes/{CHANGES,RUNS,DECISIONS,TASKS}.md`, `BUGS.md` on fixes, and
  `FEATURES.md` **in place** when a feature changes.
