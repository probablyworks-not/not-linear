# Refactor handoff — read this first

**Status as of 2026-10-04.** Phases P-1, P0, P1 and P2a are done, smoke-tested and
committed on branch `refactor/p0-repo-hygiene`. `main` is untouched at `ccf7504`.
Nothing is pushed.

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
NOTLINEAR_SERVER=fastapi .venv/bin/python -m pytest tests/contract   # 79 tests
NOTLINEAR_SERVER=legacy  .venv/bin/python -m pytest tests/contract   # 58 + 21 skipped
cd web && pnpm test && pnpm typecheck                                # 37 + 3 skipped
cd web && pnpm e2e                                                   # 13 Playwright
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

**Playwright failures are usually wrong test assumptions.** Three were:
`applyTheme` overwrites `nl_theme` from `prefs.theme`; the sidebar ships
collapsed so rows are not clickable; the search palette hides via opacity so its
input reads as "visible" when closed. Check the app's actual behaviour before
calling something a bug.

---

## Next steps, in order

### 1. P2 hardening — four separate, individually revertable commits

Carried over from P2a deliberately so the move diff stayed reviewable. Each gets
its own commit and its own test.

- **(a) CSRF header.** Require `X-Notlinear-Local: 1` on every `/__notlinear_*`
  POST. A custom header forces a preflight, so a foreign page cannot reach these
  even as a simple request. Add it in `frontend/core/api-client.js` (`loggedFetch`)
  and `core/feedback.js`, plus the raw `fetch` sites: `app.js:760, 5037, 5161, 5609`
  and `notes.js:975, 1734`. **`Access-Control-Allow-Headers` must list it too.**
- **(b) SSRF in `link_preview`** — supersedes ADR-023, which explicitly declined
  this. Resolve the host with `getaddrinfo`, reject if *any* resolved address is
  loopback / RFC1918 / link-local / CGNAT / reserved, pin the connection to the
  validated IP so a second lookup cannot rebind, follow at most 3 redirects
  **re-validating every hop**, and reject content types outside
  `text/html` / `text/plain`. Keep the `{"ok": false, "error": ...}` contract so
  `notes.js:975` is untouched.
- **(c) `scan_project` consent ledger.** `~/.notlinear/allowed_roots.json`, whose
  only writer is `pick_folder` — the native dialog *is* the consent. Require the
  resolved path to sit at or under an allowed root; reject symlink escapes. Seed
  once from an existing `prefs.folderName` so current projects keep working.
- **(d) argv-based AppleScript.** `backend/app/services/macos.py:save_file` still
  interpolates the filename straight into the script. Use
  `osascript -e SCRIPT -- filename` with `on run argv`. Validate against
  `^[^/\x00]{1,120}$`, keep the `.md` suffix logic. Add an aggregate size cap to
  `open_files` (a folder pick is currently unbounded) as an additive
  `truncated` field.

Write **ADR-035** covering (a)–(d); it supersedes ADR-023.

### 2. P2b — providers and one tool registry in TypeScript

Moved forward from P5 on purpose: it is DOM-free, unit-testable immediately,
unblocks P4's settings UI, and is the entire premise of P7.

`web/src/providers/types.ts` — one `ChatProvider` interface with a discriminated
`ProviderEvent` stream replacing today's eight callbacks.
`web/src/providers/tool-specs.ts` — a single `TOOL_SPECS` registry from which
three things are *derived* rather than maintained:

| today | becomes |
|---|---|
| `app.js:381 buildTools()` (Anthropic `input_schema`) | `toAnthropicTools(TOOL_SPECS)` |
| `app.js:432 buildDeepSeekTools()` (OpenAI shape) | `toOpenAITools(TOOL_SPECS)` |
| `app.js:294-300` prose in `buildSystemPrompt` | `toolPromptSection(TOOL_SPECS, ctx)` |

`providers/tools.js`'s `executeTool` / `windowText` / `fetchRawTextCached` move
with **no logic change**; `windowText` and `_rawTextCache` stay module-private
(ADR-029 holds). `ToolFatalError` survives verbatim — it is what separates
abort-the-turn from feed-the-error-back, and bugs #010–#018 live in that seam.

### 3. P3 — React shell

Tailwind + shadcn mapped entirely to `frontend/styles/tokens.css` variables, with
a lint rule forbidding literal colours so bug #022 cannot recur. FastAPI
dev-proxies `/web/*` to Vite so both apps share the `127.0.0.1:8765` origin and
one IndexedDB (see the landmine above). Chat and Notes are **placeholders** —
chat is not a view module (`app.js:6354` registers an empty `mount`), so there is
nothing to embed; cross-app navigation is a plain whole-page link, no iframes.

Then P4 leaf features, P5a–d chat core, P6 Notes, P7 seams, P8 launch. The plan
file has the detail.

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
