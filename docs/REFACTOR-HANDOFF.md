# Refactor handoff — read this first

**Status as of 2026-10-04.** Phases P-1, P0, P1 and **P2 (complete, including the
four hardening changes and the provider registry)** are committed on branch
`refactor/p0-repo-hygiene`. **P3 (React shell) is implemented and automated-green but
UNCOMMITTED and awaiting the human smoke test.** `main` is untouched at `ccf7504`.

**P3 is committed (`cd5c67e`). P4.1a (Settings + API keys) and P4.1b (Modes manager) are implemented, automated-green and committed after it; the maintainer smoke-tested P3/P4.1 on 2026-10-04 and it passed. P4 item 2 (search palette, threads only) is implemented and committed, not yet smoke-tested. P4 item 3 (changelog viewer) is implemented and committed, NOT the Product story, which the maintainer asked to leave out for now. P4 item 4 (Projects grid and chat-linking) is implemented and committed, not yet smoke-tested; project rules/files/folder are deferred to item 5. Next: P4 item 5 (attachments).**

This file is the context a new session needs. Read it instead of re-deriving the
state, then read `AGENTS.md` and `CLAUDE.md` for the standing rules.

---

## Where things are

| | |
|---|---|
| Branch | `refactor/p0-repo-hygiene` (5 commits ahead of `main`) |
| Plan of record | `/Users/yash/.claude/plans/pasted-content-id-9423-notlinear-refact-cheeky-brooks.md` |
| Backend | FastAPI in `backend/app/`, entry point `backend/server.py` |
| Old backend | `backend/server_legacy.py` — kept as the contract-test oracle; the P6 cutover deletes it (P3's gate still needs it) |
| Frontend | `frontend/` unchanged (native ES modules, no build step) |
| New frontend | `web/` — shell only (P3): sidebar, tabs, confirm/toast, themes. No chat, no notes |

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
NOTLINEAR_SERVER=fastapi .venv/bin/python -m pytest tests/contract   # 146 (earlier figures here were stale)
NOTLINEAR_SERVER=legacy  .venv/bin/python -m pytest tests/contract   # 118 + 28 skipped
.venv/bin/python -m pytest tests/proxy                               # 7
cd web && pnpm test && pnpm typecheck && pnpm lint                   # 247
cd web && pnpm e2e                                                   # builds, then 95 Playwright (15 legacy + 80 /web/)
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

**Two writers, one whole-row schema (P3).** The legacy app rewrites the entire `state`
row from memory on every save. `web/` therefore writes only via `db/chat-repo.ts`: one
read-modify-write per `rw` transaction, touching only the fields its mutator owns. It still
cannot stop a *stale* legacy tab overwriting a web change on its next save; `/web/`
re-reads on window focus to narrow the window. Never add a second write path in `web/`.

**Never create a blank `state` row while `localStorage.nl_state_v2` exists.** Legacy imports
that key into Dexie exactly once, only when the row is absent; a blank row written first
shadows the user's old data permanently. `chat-repo.ts` refuses, and has a test.

**`pnpm e2e` builds `web/dist` first.** The Playwright server serves `/web/` from the
static mount, which only exists if `web/dist` does when the server starts.

**Don't kill PID 56857 or 47090.** 56857 is a running app on `:8765`; verify the dev proxy on
a spare port (`NOTLINEAR_PORT=8767` for Vite's HMR, `--port 8767` for the server). The HMR
websocket pump is tested against a fake Vite (`tests/proxy`), not yet by editing a file with
a live browser on `:8765`: do that once.

**The "already in use" after a restart is FIXED (BUGS.md #054).** The port probe lacked
`SO_REUSEADDR`. One thing remains by design: `Notlinear.app` must be fully quit (⌘Q) before
you start a server yourself, because its webview holds connections to the old server and the
app starts its own server on launch. If `ps -eo pid,command | grep "[N]otlinear.app"` shows a
process, quit it first.

**Do not paste shell snippets with `#` comments into interactive zsh.** Without
`interactive_comments`, an apostrophe in a comment opens an unclosed quote and the terminal
sits at `quote>`. Give the maintainer comment-free commands.

**Radix `aria-hidden`s everything behind an open dialog.** `getByRole('complementary')` (the
sidebar) then reports "absent" whether or not it is open, so `toBeHidden()` on a role query is
vacuous. Use a CSS locator (`aside[aria-label="Left pane"]`), and assert it visible first.

**A fresh database has no `prefs.mode`/`tone`/`model`/`theme`.** Legacy defaults them in memory
(`core/state.js`); `/web/` must apply the same default wherever it reads a pref. The Modes
"Active" badge missed this.

**Generated, not retyped.** Prompt text and other ported copy are emitted from the legacy source:
`settings/default-modes.ts` from `frontend/core/modes.js`, and
`changelog/{fallback-changelog,story-icons}.ts` via `node scripts/gen-changelog-assets.mjs`.
A test fails if any of them drifts from its source.

**Legacy's palette hides threads with no saved state, and `doc-main`'s title is an in-memory
default.** Any parity test between the apps must persist the seed threads first (see
`web-search.spec.ts`), or it compares data differences instead of behaviour.

**A control per data item overflows at real-data size.** The changelog pager has one dot per
chapter and the real changelog has 53; the row pushed Older/Newer out of the clipped panel.
Playwright reported it as "intercepts pointer events". Test per-item UI against the real data's
size, not three seeded rows.

**`getByRole('button', { name: 'Connect' })` also matches "Disconnect …".** Use `exact: true`.

**Legacy's sidebar and its Settings entry are off-screen until opened**, and the Socratic and
Technical tone buttons sit in a second `.seg` row outside `#seg-tone`.

**Editing this file: replace by exact anchor, never by a range between two headings.** A range
replace deleted six landmines here once.

**Legacy saves the OLD thread before switching.** After "New chat" the saved `current` is still the
previous thread (`renderThread` calls `saveCurrentThread` first). A test that waits for `current`
to equal the new chat can hang; wait for the chat in `dynamic` instead.

**A sidebar-open helper must key on `aria-hidden`, not `isVisible()`.** The sidebar stays visible
for the 200ms it takes to slide out, so `isVisible()` lies right after something closes it.

**Throwaway Playwright scripts that seed IndexedDB must `db.close()`.** An open v1 connection
blocks Dexie's upgrade to v10 and the app silently never renders (blank body, no error).

**Do not delete anything under "Landmines" with a range-replace.** See the note above.

**Never use `waitForTimeout` to wait for legacy to save.** It flaked 1 run in 3. Poll the
persisted state (`expect.poll(() => readPersistedState(...))`) for the actual condition.

**`getByRole('button', { name: 'Connect' })` also matches "Disconnect …".** Use `exact: true`.

**Legacy's sidebar and its Settings entry are off-screen until opened**, and Socratic/Technical
tone buttons are in a second `.seg` row outside `#seg-tone`.

**`tokens.css` gained six tokens in P3** (`--danger*`, `--on-danger`, `--scrim`) because
`base.css` hardcodes those colours and `web/` forbids literals. If a design needs another
colour, add a token; do not add a literal and do not widen the lint rule.

**The user's safety hook false-positives on harmless text** (it blocked a heredoc that merely
mentioned `os.environ`, and a test file). Writing the file with the Write/Edit tools instead
of a shell heredoc works; don't try to disguise content to get past it.

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
| P3 | React shell | **done, committed, smoke-tested** |
| P4 | Leaf features | **in progress**: 4.1 Settings, keys and Modes done; items 2 (search, threads only), 3 (changelog; Product story deferred) and 4 (projects grid + chat-linking) done; item 5 (attachments) next |
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

### P3 — React shell (done; uncommitted; smoke test pending)

Delivered, with ADR-031/036/039/040/041. Deviations from the plan above worth knowing:

- **Sidebar is Threads only.** Search, Projects, Notes, Updates and Recent-branches sections,
  and the Settings footer action, are *not* rendered — each belongs to a P4/P5 feature and a
  dead button is worse than an absent one. The footer shows identity only.
- **Selecting a thread opens a placeholder**, because chat is P5.
- **No `useLiveQuery`.** Cross-app live notification is unreliable (the two apps ship different
  Dexie builds), so the store re-hydrates on window focus (ADR-041).
- **Rename is not built.** `lib/debounced-writer.ts` (200ms, keyed, tested) exists for the
  first typed field, which is P5's composer; nothing in P3 types into the database.
- **New-chat button is the inverse of text colour**, not legacy's always-dark literal gradient.
- **`registerChatOpener` & friends are gone**; they are store actions (`state/actions.ts`).
- Icons are `lucide-react` (CLAUDE.md), not the Tabler webfont legacy uses.

**Gate (automated, green):** three themes render from tokens, ESLint proves zero literals (and a
test proves the rule fires); `nl_tabs_v1` round-trips; create and delete work in both directions
across the two apps; schema tests green. **Still manual:** run the 10-step smoke test in the
legacy app and click through `/web/` in the real `Notlinear.app` realm, which is a *separate*
IndexedDB from Chrome's.
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

**DECIDED 2026-10-04: dual-write (ADR-038).** The text below is the reasoning, kept for context. Do not reopen it.

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
| ADR-042 | Notes v2 on BlockNote with inline specs, lossless converter, mandatory backup | P6 |
| ADR-043 | Extension seams register as `ToolSpec`s; connectors use `safe_fetch` | P7 |
| ADR-044 | License + publish checklist | P8 |

Already written: ADR-031, 038 (dual-write decision; anchor details to be added as an amendment in P5b), 032 (fresh squashed repo), 033 (FastAPI), 034
(static allowlist), 035 (trust boundary), 036, 037 (provider registry), 039, 040, 041,
047 (backup tools).

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
