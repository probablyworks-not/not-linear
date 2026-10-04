# TASKS.md — not-linear migration work queue

Each entry: **ID · Status · Goal · Context · Files likely involved · Acceptance criteria · Verification**

---

## TASK-P4.3 — Changelog viewer in `/web/` (Product story deferred)
- **Status:** Done pending smoke test. Product story (sidebar row, fullscreen player, "Play the story") intentionally NOT built - maintainer's instruction.
- **Acceptance criteria:** identical chapters to legacy from the same file; bundled fallback on any failure; mechanical grouping; no literal colours; pager always reachable.
- **Verification:** RUNS.md TASK-P4.3.

---

## TASK-P4.2 — Search palette in `/web/`
- **Status:** Done pending smoke test. Branch results deferred to P5b.
- **Goal:** ⌘K quick-open over threads with legacy's filter and keyboard rules.
- **Acceptance criteria:** identical ordered results to the legacy palette on identical data; legacy keyboard rules; copy verbatim; typed markup never parsed.
- **Verification:** RUNS.md TASK-P4.2.

---

## TASK-P4.1b — Modes manager in `/web/`
- **Status:** Done pending the human smoke test (automated gate green 2026-10-04).
- **Goal:** create/edit/reset/delete modes in `/web/`, overrides-only (ADR-046), shared with legacy.
- **Acceptance criteria:** behaviour identical to `core/modes.js` under random op sequences; modes made in either app appear in the other; editing a mode never touches another pref; delete uses the legacy wording and falls the active mode back to General.
- **Verification:** RUNS.md 2026-10-04 TASK-P4.1b; ADR-046, ADR-048.

---

---

## TASK-P4.1a — Settings and API keys in `/web/`
- **Status:** Done pending the human smoke test (automated gate green 2026-10-04).
- **Goal:** Edit prefs and API keys from `/web/`, sharing storage with legacy, with live tool availability.
- **Context:** P4 item 1, split: the Modes modal (`core/modes.js`, ADR-046) is **TASK-P4.1b**, Todo.
- **Files likely involved:** `web/src/settings/*`, `web/src/lib/{api-keys,theme}.ts`, `web/src/state/app-store.ts`
- **Acceptance criteria:** every pref round-trips between the apps; `nl_api_keys` keeps its shape and `notes.js` still reads it; keys never rendered unmasked, logged, or stored in IndexedDB; theme agrees in `prefs.theme` and `nl_theme`; option lists pinned to legacy; tool list derives from the registry.
- **Verification:** RUNS.md 2026-10-04 TASK-P4.1a; ADR-048.

---

## TASK-P3 — React shell (phase 3 of the refactor)
- **Status:** Done pending the human smoke test (automated gate green 2026-10-04).
- **Goal:** `/web/` renders a shell that shares the legacy app's origin and data, with tokens, tabs, confirm/toast, a view registry and the Esc chain, and no hardcoded colour anywhere.
- **Context:** Foundation only. Chat is P5 and Notes P6, so selecting a thread opens a placeholder that says so.
- **Files likely involved:** `web/src/**`, `web/{tailwind,eslint}.config.*`, `backend/app/dev_proxy.py`, `frontend/styles/tokens.css`
- **Acceptance criteria:** three themes render from tokens with a lint rule proving zero literals; tabs persist to `nl_tabs_v1` in legacy's shape; a thread created or deleted in either app shows in the other; delete-confirm copy is byte-identical; Esc closes the highest-priority surface first; schema tests green.
- **Verification:** see RUNS.md 2026-10-04 TASK-P3. ADR-031, 036, 039, 040, 041.
- **Open:** `backend/server_legacy.py` is still here. The handoff says "delete at the P3 gate" in one place and "delete at the P6 cutover" in another; the P3 gate needs it as the contract oracle, so it stays until P6.

---

## TASK-P2 — Hardening and provider registry (phase 2 complete)
- **Status:** Done (smoke test passed on the live app 2026-10-04, with all four hardening changes verified active on the running instance)
- **Goal:** Close the local trust boundary the P0 CORS fix exposed as wrong, and replace the three hand-maintained tool-schema copies with one registry.
- **Context:** P2 of the approved plan. The hardening was deliberately carried over unchanged from P2a so the move diff stayed reviewable, then landed as four individually revertable commits. P2b was pulled forward from P5 because it is DOM-free, testable immediately, and the premise of P7.
- **Files likely involved:** `backend/app/services/{safe_fetch,consent,macos}.py`, `backend/app/middleware/local_only.py`, `backend/app/routers/endpoints.py`, `frontend/core/{api-client,feedback}.js`, `web/src/providers/*`
- **Acceptance criteria:** A POST without `X-Notlinear-Local` is refused and one with it succeeds. Private and loopback addresses unreachable from `link_preview`, every redirect hop re-validated. `scan_project` limited to picked folders, with an upgrade path that does not break existing installs. No filename reaches AppleScript source. One tool list derives both provider schemas and the prompt prose.
- **Verification:** 144 contract tests (fastapi), 63 vitest, 15 Playwright, mutation tests on the description oracle, then live probes against the running app. See ADR-035 and ADR-037.

---

## TASK-P2a — FastAPI core (phase 2a of the refactor)
- **Status:** Done (smoke test passed 2026-10-04, verified on the real Notlinear.app bundle). Next: the four hardening commits, then P2b (providers in TS)
- **Goal:** Move the twelve `/__notlinear_*` endpoints to modular FastAPI routers with behaviour provably unchanged, and replace whole-repo static serving with an explicit allowlist.
- **Context:** P2a of the approved plan. The endpoints are frozen per AGENTS.md, so the move must be provable rather than reviewed — hence the dual-server contract suite and the in-process service parity diff.
- **Files likely involved:** `backend/app/**`, `backend/server.py`, `backend/server_legacy.py`, `tests/contract/**`, `requirements.txt`
- **Acceptance criteria:** The same contract suite passes under `NOTLINEAR_SERVER=legacy` and `=fastapi`. Repo files no longer served; the app's own files still are, including the URL the compiled bundle loads. Every launcher still starts the server. `Notlinear.app` works unmodified.
- **Verification:** both pytest runs, service parity diff, exposure tests, Playwright against FastAPI, manual start under three interpreters; then the human 10-step smoke test.

---

## TASK-P1 — Test safety net (phase 1 of the React/FastAPI refactor)
- **Status:** Done (smoke test passed 2026-10-04). Still open: a real-data fixture to un-skip 3 schema tests, and a first CI run on GitHub
- **Goal:** Automated regression coverage before any production code moves, so every later phase has an oracle instead of a ten-step manual click-through.
- **Context:** P1 of the approved plan, and the phase plan.md calls the highest-leverage prerequisite. Deliberately changes NO production code, which is also why it was safe to run before P0's human smoke test — its Playwright suite automates most of that smoke test anyway.
- **Files likely involved:** `web/**`, `tests/contract/**`, `.github/workflows/ci.yml`, `requirements-dev.txt`, `pytest.ini`
- **Acceptance criteria:** The legacy `core/store.js` is usable as a differential oracle. A Dexie version bump, a store rename and a dropped field all fail the build. All 12 endpoints have contract tests that pass unchanged against FastAPI in P2. Playwright reproduces the automatable smoke steps. Contract tests never touch real `logs.md` or `FEEDBACK.md`.
- **Verification:** 37 vitest + 32 pytest + 13 Playwright green; oracle mutation-tested three ways; real-file hashes unchanged across a contract run.

---

## TASK-P0 — Repo and dev hygiene (phase 0 of the React/FastAPI refactor)
- **Status:** Done (smoke test passed 2026-10-04; `git gc` run, 62MB -> 4.2MB, 29 commits intact)
- **Goal:** Make the working tree and dev setup safe and portable before any refactor: close the CORS hole, stop tracking user content and build artifacts, remove hardcoded paths, and correct docs that point at things that do not exist.
- **Context:** P0 of the approved nine-phase plan. The CORS fix was pulled forward from P2 because it closes a live, exploitable hole and needs no FastAPI.
- **Files likely involved:** `backend/server.py`, `.gitignore`, `launchers/*`, `README.md`, `AGENTS.md`, `CLAUDE.md`, `plan.md`, `frontend/core/store.js`, `frontend/views/notes.js`, `docs/project-notes/DECISIONS.md`
- **Acceptance criteria:** No `/Users/yash` in any tracked file outside historical logs. No duplicate ADR IDs and no entries outside the mandated format. A cross-origin preflight to any `/__notlinear_*` endpoint is refused while the app's own origin is allowed. Every untracked file remains on disk. The app still loads and all 10 smoke steps pass.
- **Verification:** static checks across Python/JS/zsh/AppleScript; HTTP serve; CORS probes from both an attacker origin and the app origin; launcher path resolution from a relocated copy, an orphan and the real repo; then the human smoke test.

---

## TASK-P-1 — Data backup/restore tools (precondition for the React/FastAPI refactor)
- **Status:** Done (user reports the desktop-app export and the restore round-trip succeeded; not observed by the agent). Mid-task finding: storage is per-realm, not per-origin — see ADR-047 amendment.
- **Goal:** A standalone way to dump both Dexie databases plus localStorage to one JSON file and restore it, so every later refactor phase has a rollback for data rather than only for code.
- **Context:** P-1 of the approved refactor plan (`.claude/plans/` — React 18 + Vite frontend, FastAPI backend, nine phases). The repo had no export of any kind. P5 dual-writes into existing `state` rows and P6 rewrites note content, so a backup is a hard precondition. Plan: P0 does not start until the restore round-trip passes.
- **Files likely involved:** `tools/_backup-lib.js`, `tools/export-data.html`, `tools/import-data.html` (all new; no app file touched)
- **Acceptance criteria:** Export produces a JSON file whose summary counts match the live app. Restoring it into a fresh browser profile reproduces threads, branches, highlights, notes, API keys and theme. Neither page can run over `file://` or silently read the wrong origin. No Dexie version is ever declared, so no schema upgrade can be triggered.
- **Verification:** `node --check`; HTTP 200 on all paths; headless unit check of the pure functions; then the human round-trip in a fresh browser profile.

---

## TASK-BUG-043 — Make Notes pages open as separate tabs
- **Status:** Done (static checks + targeted headless browser flow passed; desktop app smoke pending)
- **Goal:** Opening a second note should create/focus that note's own tab, leaving the previous note tab open and switchable.
- **Context:** Follow-up to bug #042. #042 fixed the index reset caused by the blank-tab Notes tile, but it deliberately preserved the singleton Notes tab chosen in ADR-026. The user clarified that the intended behavior is true multiple note tabs.
- **Files likely involved:** `frontend/app.js` (tab-strip model), `frontend/views/notes.js` (note-opening entry points), `frontend/core/registry.js` (opener bridge), project-memory docs.
- **Acceptance criteria:** Note A and Note B can be open as separate tabs; clicking either tab renders the matching note. Sidebar/index/page-link/mention/new-page note-opening paths all create/focus `note:<id>` tabs. `notes` still opens the Notes index. Reload restores open note tabs and the active note tab. Deleted note tabs are not restored after reload.
- **Verification:** Static syntax checks passed. Targeted headless Chromium flow passed for multi-note tabs, tab switching, reload restore, and zero console/page errors. Desktop app manual smoke still pending.

## TASK-BUG-042 — Fix blank-tab "Notes" tile resetting the open Notes tab to the index
- **Status:** Done (pending human manual smoke test — see RUNS.md)
- **Goal:** Opening Notes from a blank tab's quick-action tile should focus the existing singleton Notes tab as-is, not force it back to the index and discard the open note.
- **Context:** User reported (with a screen recording) that opening another note while one was open closed the previous note and returned to the home/index page. See `BUGS.md` #042 and `ADR-026` (which already documents the intended singleton-Notes-tab-and-navigate behavior).
- **Files likely involved:** `frontend/app.js` (`#bte-notes` handler).
- **Acceptance criteria:** Clicking the blank tab's "Notes" tile when a Notes tab is already open on a specific note keeps that note showing (no reset to index). The sidebar "Notes" header still always opens the index, unaffected. First-time Notes open in a session still works sensibly.
- **Verification:** `node --check` on touched files (pass). Manual test case in `BUGS.md` #042 still needs a human pass on the running app — no browser available in this sandboxed session.

## TASK-BUG-040 — Fix Tab key (silent focus-jump) app-wide + Notes indent/outdent
- **Status:** Done
- **Goal:** Tab should never silently move focus away from a free-text input. In composer textareas, Tab should insert a tab character. In Notes, Tab/Shift+Tab on a block should indent/outdent it (nest under/pop out of the preceding sibling), matching Notion's bullet-list behavior the user asked for.
- **Context:** User reported Tab "doesn't work as expected" and "doesn't create space in the same line," then clarified (with a screenshot) that in a bullet list Tab should create a sub-bullet. See BUGS.md #040 and ADR-025.
- **Files likely involved:** `frontend/core/ui.js`, `frontend/app.js`, `frontend/views/notes.js`, `frontend/views/coding-projects.js`, `frontend/core/feedback.js`, `frontend/styles/notes.css`.
- **Acceptance criteria:** Tab in the main chat input, both branch ask boxes, the Coding Projects comment box, and the feedback textarea inserts a tab character and keeps focus in the field. In Notes, Tab nests a block under its preceding sibling; Shift+Tab pops it back out; a block with no preceding sibling falls back to inserting a literal tab. The existing slash-menu Tab-to-pick is unaffected. No persistence schema change (`children` field already existed for toggle blocks).
- **Verification:** Headless Playwright against the live `:8765` server — see `docs/project-notes/RUNS.md` 2026-07-31 entry for the full pass list, including a direct IndexedDB read confirming nested bullets persist across reload.

## TASK-NT09 — Notes: cross-block drag-select/copy fix + Markdown export (page + subpages + images)
- **Status:** Done (code complete; headless Playwright smoke passed against the live `:8765` server; human GUI click-through pending)
- **Goal:** User reported being unable to select and copy text spanning more than one note block, and asked for an easy way to export notes including images and subpages. Delivered: (1) bug fix — mouse drag now selects/copies across block boundaries via a custom highlight-and-serialize path (see BUGS.md #039); (2) new feature — a topbar export button that writes the current page + all recursively-linked subpages to a single self-contained Markdown file, images embedded inline as base64 data URIs.
- **Context:** User picked Markdown (not HTML) and "current page + subpages recursively" (not page-only) via an explicit choice — see `docs/project-notes/DECISIONS.md` ADR for the reasoning (Markdown avoids touching the `/__notlinear_save_file` endpoint, which currently force-appends `.md`).
- **Files likely involved:** `frontend/views/notes.js`, `frontend/styles/notes.css`, `frontend/index.html`, `FEATURES.md`, `BUGS.md`, project-memory docs.
- **Acceptance criteria:** Dragging from one block into another highlights and copies all dragged-over blocks' text in order; single-block drag still uses native selection unaffected; export produces one `.md` file with the page's own content, every subpage it links to (recursive, cycle-safe) as its own section, and every image inline as a data URI.
- **Verification:** Headless Playwright (Python) against the live `:8765` server: cross-block drag+copy, single-block-native-selection regression check, page-wide select-all regression check, and a full export run (parent note + one nested subpage created via the real `/page` slash command) with the save-file network call intercepted so no real dialog fired. Logged in RUNS.md.

---

## TASK-NT08 — Notes v2: video/audio embed + file attachment + bookmark + generic embed
- **Status:** Done (code complete; `py_compile` + `node --check` + endpoint curl + headless boot smoke passed; human GUI click-through pending)
- **Goal:** A4 (paste a video/audio URL, YouTube/Vimeo pattern-matched to an embed, direct file URLs play natively) + A5 (attach a file, 5MB dataURL cap else metadata-only) + A6 (bookmark a URL via a new additive backend link-preview endpoint) + A7 (generic sandboxed-iframe embed for a small allowlist — Figma/CodePen/Google Maps — falling back to A6 for anything else).
- **Context:** Fifth phase of `notes_new_feature.md` (NT07 deferred by user request). First backend change since NT03 — new `/__notlinear_link_preview` endpoint, plan mode used per CLAUDE.md's server rule. See ADR-023 for the endpoint's trust-boundary scope (local single-user server, scheme validation only, no SSRF/private-IP hardening — deliberate, not an oversight).
- **Files likely involved:** `backend/server.py`, `frontend/views/notes.js`, `frontend/styles/notes.css`, `docs/project-notes/DECISIONS.md`, project-memory docs.
- **Acceptance criteria:** Recognized video/audio links embed/play; unrecognized ones degrade to a plain link, never a broken frame. Files over 5MB store metadata only with a clear cap message, never balloon the dataURL. Bookmark fetch failures degrade to a plain link card. Generic embeds are always sandboxed and only ever point at the hardcoded allowlist; unmatched URLs fall back to a bookmark. Every existing `/__notlinear_*` endpoint unchanged; chat/threads/branches/coding-projects/`notlinear` db untouched.
- **Verification:** `python3 -m py_compile backend/server.py`; `node --check frontend/views/notes.js`; `curl` the new endpoint directly; manual smoke test in-browser per the plan; logged in RUNS.md.

---

## TASK-NT07 — Notes v2: @page and @date mentions (PARTIALLY DONE — A10 shipped in expanded form, A11 + two edge cases still open)
- **Status:** Partially done (2026-07-31) — A10 (`@`-mention autocomplete + inline chip) shipped, expanded to also cover chats (not in the original spec); A11 (date mentions) not started; two original acceptance criteria not met (see below)
- **Goal:** A10 (typing `@` opens inline autocomplete over note titles, inserts a navigable mention chip) + A11 (typing `@` + date-like text inserts a persisted date chip, stored as ISO date).
- **Context:** Picked back up by direct user request (screenshot of a Notes numbered list, "I should be able to @mention current notes or chats... when I click it it should open in new tab") — the request itself expanded A10's scope to include **chats**, not just notes. Implemented per the plan in this session: mention chips are inline `contenteditable="false"` spans in `b.text` (no new schema, no `[SCHEMA]` tag needed — contrary to this task's original assumption that a new chip type would need one), inserted via the same Range technique as the existing inline-equation feature. Clicking a note chip switches to/navigates within the existing shared Notes tab; clicking a chat chip opens/focuses that chat as a tab via a new `registerChatOpener`/`openChatTab` bridge in `core/registry.js`. See ADR-026, BUGS.md #041 (a related export fix from the same session), `docs/project-notes/CHANGES.md` 2026-07-31 entry.
- **Files likely involved:** `frontend/views/notes.js`, `frontend/styles/notes.css`, `frontend/index.html`, `frontend/core/registry.js`, `frontend/app.js`.
- **Acceptance criteria:** ~~renaming a mentioned page updates the mention's display text~~ — **not met**: the chip's label is captured as static text at insert time, not re-derived from the live note/chat title on render, so a rename after the fact leaves stale text in any existing chip. ~~deleting the target page degrades the mention to plain text~~ — **not met**: clicking a chip whose target note/chat was since deleted currently just fails silently (no graceful plain-text degradation) rather than being handled. `@`-mention autocomplete + insert + click-to-open — **met**, for both notes and chats, verified end to end (see RUNS.md). Date chips (A11) — **not started**.
- **Verification:** Headless Playwright (Node) against the live `:8765` server — see `docs/project-notes/RUNS.md` 2026-07-31 entry ("Notes @-mentions + BUGS.md #041"). Rename-sync and delete-degradation were not exercised since they aren't implemented yet.
- **Next steps (not requested this session, flagging for whenever this is picked back up):** live rename sync (render the chip's label from the current note/chat title at render time instead of baking it in at insert time — the chip already stores `data-id`, so this just means re-resolving the label on each `wireMentionSpans`/render pass instead of trusting the stored inner text) and delete-degradation (on render, if `data-id` no longer resolves to a real note/chat, unwrap the chip to plain text) would close out the original NT07 acceptance criteria. A11 (date mentions) is a separate, not-yet-started slice of the same deferred task.

---

## TASK-NT06 — Notes v2: page cover image + custom image page icon
- **Status:** Done (code complete; `node --check` + headless boot smoke passed; human GUI click-through pending)
- **Goal:** A12 (real page cover: upload, drag-to-reposition, remove) + A13 (page icon can be a custom uploaded image, not just emoji/Mind-Garden).
- **Context:** Fourth phase of `notes_new_feature.md`, both `[SCHEMA]`-tagged per the doc, plan mode required and used. Two design decisions made and confirmed with the user: (1) `n.emoji` gains a new `img:<dataURL>` string-token domain — following the *existing* `icon:<id>[:<hex>]` token convention already used by `glyphHTML`/Mind Garden, instead of the doc's suggested `{type,value}` object shape, so every existing read site keeps working unchanged and no migration step is needed at all; (2) the image-icon upload UI is a small separate button next to the existing page-icon button, not an extension of the shared `core/emoji.js` picker (that module is also used by Coding Projects/sidebar, outside this doc's stated scope). See ADR-021.
- **Files likely involved:** `frontend/views/notes.js` (`glyphHTML`, `renderPage`), `frontend/styles/notes.css`, `docs/project-notes/DECISIONS.md`, project-memory docs.
- **Acceptance criteria:** Notes without a cover/custom icon render exactly as before reload. Cover persists (photo + vertical reposition), Change/Remove work. Custom image page icon renders correctly at every existing icon site (sidebar row, index card, page header, breadcrumb) via the shared `glyphHTML`; Remove reverts to the emoji/📄 fallback; existing plain-emoji and Mind-Garden `icon:` tokens on other notes are unaffected. Chat/threads/branches/coding-projects/`core/emoji.js` untouched.
- **Verification:** `node --check frontend/views/notes.js`; manual smoke test in-browser per the plan; logged in RUNS.md.

---

## TASK-NT05 — Notes v2: drag-to-nest + duplicate page + drag-to-reparent
- **Status:** Done (code complete; `node --check` + headless boot smoke passed; human GUI click-through pending)
- **Goal:** B1 (dragging a block onto the right two-thirds of a toggle block's row nests it as a child) + B3 (duplicate a sidebar page, deep-copying its whole subtree with fresh ids) + B4 (drag a sidebar page onto another to reparent it, or onto blank space to make it top-level).
- **Context:** Third phase of `notes_new_feature.md`, editing/UX cluster, no schema change. Two scope decisions resolved before implementation: B1 nesting is toggle-blocks-only (page-link cross-note nesting explicitly deferred per user confirmation — more complex/risky, would move content between notes); B3 duplicates the whole subpage subtree (Notion's default), and does not copy `note.branches` (Ask-AI threads) since they're keyed by block ids that no longer exist post-copy.
- **Files likely involved:** `frontend/views/notes.js` (`wireBlockDrag`, `renderRow`, `wireSidebar`, new duplicate/reparent helpers), `frontend/styles/notes.css`, project-memory docs.
- **Acceptance criteria:** Dropping on the right two-thirds of a toggle's row nests as a child; left third and non-toggle targets keep existing reorder-only behavior; a toggle can't be dropped into its own descendant. Duplicated page appears as a sibling immediately after the original, subpages come along, no shared block ids with the source. Dragging a sidebar page onto another makes it a subpage; onto blank space makes it top-level; circular reparent (page onto its own descendant) is blocked with no drop indicator; expand-state persists sensibly. Chat/threads/branches/coding-projects and the `notlinear` db untouched.
- **Verification:** `node --check frontend/views/notes.js`; manual smoke test in-browser per the plan; logged in RUNS.md.

---

## TASK-NT04 — Notes v2: code block syntax highlighting + LaTeX rendering
- **Status:** Done — human GUI smoke test confirmed passing (2026-07-25)
- **Goal:** A1 (real syntax highlighting for code blocks, no layout shift on language switch) + A2 (block equations actually render LaTeX instead of showing raw text, plus inline equations from the floating toolbar).
- **Context:** Second phase of `notes_new_feature.md`. Adds two new CDN dependencies per the doc's constraints (explicit call-out + approval required) — user chose highlight.js (`@highlightjs/cdn-assets`) over Prism, and KaTeX over MathJax. Plan reviewed and approved before implementation; no `notlinear-notes` schema change. Colors mapped to existing `tokens.css` custom properties rather than either library's stock theme, per AGENTS.md's no-hardcoded-colors rule.
- **Files likely involved:** `frontend/index.html` (two new CDN tags), `frontend/views/notes.js`, `frontend/styles/notes.css`, project-memory docs.
- **Acceptance criteria:** Existing code blocks with a `lang` still render/edit correctly, now colorized; highlighting updates live as you type or on blur; switching languages via the picker causes no layout shift. Typing valid LaTeX in an equation block renders formatted math; invalid LaTeX shows a clear inline error state, not a crash; inline equations supported from the floating toolbar. Chat/threads/branches/coding-projects and the `notlinear` db untouched.
- **Verification:** `node --check frontend/views/notes.js`; manual smoke test in-browser per the plan; logged in RUNS.md.

---

## TASK-NT03 — Notes v2: image URL support + table of contents block
- **Status:** Done — human GUI smoke test confirmed passing (2026-07-25)
- **Goal:** A3 (image blocks accept an external URL or dropped/pasted URL without re-encoding to a dataURL, resizable, graceful 404 fallback) + A8 (new `toc` block auto-generated from the page's h1-h4 headings, clickable to scroll, live-updating).
- **Context:** First phase of `notes_new_feature.md` (Notes v2: Blocks/Editing/Databases), picked as the low-risk warm-up per the doc's suggested phase order — no `notlinear-notes` schema version bump, no backend changes. Plan reviewed and approved before implementation per CLAUDE.md's persistence plan-mode rule.
- **Files likely involved:** `frontend/views/notes.js`, `frontend/styles/notes.css`, project-memory docs.
- **Acceptance criteria:** Existing dataURL images unaffected; pasting/dropping an external image URL persists as a URL string, not a dataURL; 404'd image URL degrades to a clear inline message, not a broken `<img>`; resize handle persists width across reload. `/table of contents` block lists h1-h4 headings nested by level, updates as headings are added/removed/edited, clicking a row scrolls to that heading. Chat/threads/branches/coding-projects and the `notlinear` db untouched.
- **Verification:** `node --check frontend/views/notes.js`; manual smoke test in-browser per the plan (image upload/URL/404/resize, TOC add/edit/delete/click-to-scroll); logged in RUNS.md.

---

# notlinear Redesign (design handoff — additive presentation changes, one phase per session)

> Source: `redesign_product.md` (PRD) from `design_handoff_notlinear_redesign/notlinear-Redesign.dc.html`. See ADR-014…ADR-017 in `DECISIONS.md`. **Do not bump the `notlinear` or `notlinear-notes` Dexie schemas for this work** — tabs/canvas/story state are new UI state only. One phase per session; full smoke test (AGENTS.md, extra attention to branch-panel Fragile areas #002–#004/#028/#037/#038) between phases.

## TASK-RD00 — PRD + memory scaffolding + open-questions sign-off
- **Status:** Done
- **Goal:** Turn the design handoff into the repo's own task/ADR process before any code moves, per the handoff bundle's own instruction ("if anything is ambiguous, ask before implementing") and CLAUDE.md's plan-first rule for anything touching branches.
- **Context:** The handoff explicitly flags the tab strip as a navigation-model change needing product confirmation; three other decisions (delete-confirm gating, blue reconciliation, tab-bar/canvas-theme defaults) were cheap to settle now vs. mid-build. Resolved 2026-07-24: build the tab strip; use existing confirm dialog for deletes; use `--branch` token as-is; default to underline tabs + cards canvas.
- **Files likely involved:** `redesign_product.md` (new), `docs/project-notes/TASKS.md`, `docs/project-notes/DECISIONS.md`
- **Acceptance criteria:** PRD exists and matches the verified current-state facts (drawer classes, line numbers); RD01–RD09 listed; ADR-014…ADR-017 recorded as `accepted`; no app files touched.
- **Verification:** None needed (no app change).

## TASK-RD01 — Superseded by RD02
- **Status:** Superseded (folded into RD02, 2026-07-24) — see ADR-015
- **Why:** Originally scoped as "add tokens.css custom properties for the new hues." Discovered `frontend/core/mind-garden.js` already renders hand-drawn SVGs with literal (non-token) colors via the same pattern this task would have introduced (`ICON_COLORS` in that file). No `tokens.css` change is needed — RD02 defines the hue literals locally in `app.js` instead.

## TASK-RD02 — Default hand-drawn icons for projects/threads (reuse Mind Garden)
- **Status:** Done (code complete + headless-verified; human GUI smoke test recommended, esp. all 3 themes + 2+ real projects)
- **Goal:** Give every project/thread sidebar row a default hand-drawn glyph (iris/acorn/compass/star cycling for projects; branch/compass/roots/star cycling for threads, main thread always `branch`) instead of the current uniform Tabler `ti-folder`/`ti-message` fallback — using the **existing** `frontend/core/mind-garden.js` (`renderIconSvg`, `loadMindGarden`) already wired into `app.js`. A user's manually-chosen emoji/icon (via the existing picker) always overrides the default.
- **Context:** `core/mind-garden.js` + `frontend/mind-garden-icons.html` already contain every icon this redesign needs (`iris`, `acorn`, `compass`, `star`, `branch`, `roots` all confirmed present) — this is wiring a default, not building new icon infrastructure. See ADR-015 for why no new module/tokens are needed and how thread colors were standardized (branch=blue via existing `--branch` value, compass=teal, roots=green, star=red).
- **Files likely involved:** `frontend/app.js` only (`renderProjects`, `addThreadButton`, `refreshThreadGlyph`) — no new files, no CSS changes, no `mind-garden.js`/`emoji.js` edits.
- **Acceptance criteria:** Every project row and thread row (static seeds + newly created) shows a colored hand-drawn glyph when no custom emoji/icon is set; setting a custom emoji/icon via the existing picker still overrides it; pre-Mind-Garden-load render still shows the Tabler fallback with no layout jump once icons swap in; no hardcoded hex outside the two new local cycle arrays (bug #022 pattern respected — these are decorative constants, not theme-reactive colors).
- **Verification:** `node --check frontend/app.js`; full smoke test with visual confirmation of icons in all three themes; confirm a manually-picked project/thread icon still takes priority over the default.

## TASK-RD03 — New-chat button visual treatment
- **Status:** Done (code complete + headless-verified; human GUI smoke test recommended for all 3 themes)
- **Goal:** Give the sidebar "New chat" button the dark-gradient/inset-highlight/hover-lift/⌘N-kbd treatment from the prototype.
- **Context:** Small, isolated, no state changes. Discovered no ⌘N shortcut existed at all (only a click handler) — showing a kbd hint for a non-functional shortcut would be misleading, so wired an actual `document.addEventListener('keydown', ...)` handler mirroring the existing ⌘K search pattern, calling the existing `startNewChat()`.
- **Files likely involved:** `frontend/styles/base.css` (new `.new-chat-btn`/`.new-chat-icon`/`.new-chat-label`/`.new-chat-kbd` rules), `frontend/index.html` (button markup), `frontend/app.js` (⌘N keydown handler).
- **Acceptance criteria:** Button matches prototype treatment; colors are literal (not `tokens.css` vars) since this CTA is intentionally dark in all 3 themes, same class of exception as the existing project-avatar gradient — not a bug #022 case. ⌘N triggers `startNewChat()`.
- **Verification:** `node --check frontend/app.js` clean. Headless Playwright: button has `.new-chat-btn` class and the gradient background renders; simulated Cmd+N increased the thread-row count by one (4→5); zero console errors.

## TASK-RD04 — Floating panels: Highlights / Context (branch-reply descoped)
- **Status:** Done for Highlights + Context; branch-reply panel treatment deferred (needs its own decision, see ADR-016)
- **Goal:** Convert `.highlight-panel` and `.ctx-panel` from full-height right-edge drawers (`translateX(100%)` slide) to floating cards anchored `top:64px;bottom:16px;right:16px` inset from the content pane, rounded all corners, drop shadow — per prototype.
- **Context:** Presentation-only change; the existing mutual-exclusivity/show-hide logic was left untouched — same JS, new CSS shape. **Scope narrowed mid-implementation:** the prototype's "branch reply panel" doesn't map onto the real app's branch system, which is a `position:fixed` multi-instance stack (`.branch-stack`/`.branch`/`.branch.reader` in `chat.css`, driven by `layoutBranches()`) with the exact Fragile-area failure modes (#002-#004, #028, #037, #038) this task itself flagged as needing care — not a single-slot panel like the prototype assumes. Converting it would be a real behavior change, not a CSS tweak, so it was deferred rather than guessed at. See ADR-016.
- **Files likely involved:** `frontend/styles/base.css` (`.ctx-panel`, `.highlight-panel`, `#ctx-scrim`/`#highlight-scrim`) — done. `.branch`/`.branch-stack` in `chat.css` — read-only, untouched, deferred.
- **Acceptance criteria:** Highlights + Context render as floating cards, not edge drawers (met); single-panel-open invariant unchanged (met, JS untouched); branch Fragile areas untouched (met by not touching branch code at all — no re-verification needed since nothing branch-related changed).
- **Verification:** `node --check frontend/app.js` clean (no JS changed). Headless Playwright: both panels open via their existing toggle buttons and report `top:64px;right:16px;bottom:16px;border-radius:12px` computed style; clicking the (now-transparent) scrim still closes the highlight panel; zero console errors.

## TASK-RD05 — Settings as centered modal
- **Status:** Done (code complete + headless-verified; human GUI smoke test recommended for all 3 themes)
- **Goal:** Replace the right-edge `.prefs` drawer with a centered modal (dim scrim, rounded card, internal scroll).
- **Context:** Presentation-only; no settings values or persistence keys touched, zero JS changes (same `#scrim`/`openPrefs`/`closePrefs` as before). **Confirmed before implementing:** the real app's Settings already has ~12 sections (Appearance, Workspace name, "What should AI call you?", Tone preset, "What are you working on?", Default model, API Keys, Context Ranking, Web Search, Changelog, Feedback, Runtime logs) vs. the prototype's mocked 3 — and Appearance/Tone/Model already render via the existing `.seg` component, which is *already* a theme-token'd 3-column segmented grid with title+subtitle per button, pixel-matching the prototype's treatment. So there was nothing to rebuild there; RD05 is purely the outer container's shape.
- **Files likely involved:** `frontend/styles/base.css` (`.prefs` — done). `frontend/index.html`/`frontend/app.js` — read-only, confirmed no changes needed (existing `#scrim`/toggle JS already fit a centered-modal pattern).
- **Acceptance criteria:** Settings opens centered with the existing scrim, closes on scrim click/Escape/X (all pre-existing, unmodified); all ~12 existing settings sections still present and reachable, not reduced to the prototype's 3; no behavior change to persisted values.
- **Verification:** `node --check frontend/app.js` clean (no JS changed). Headless Playwright: modal's bounding rect is centered in the viewport at the new `max-height:82vh`; confirmed all 12 section labels still render; scrim click still closes it; zero console errors.

## TASK-RD06 — Product story (release notes revamp)
- **Status:** Done (code complete + headless-verified against the real 30-entry CHANGELOG.md; human GUI smoke test recommended)
- **Goal:** Replace `.changelog-view`'s raw-markdown dump with (a) an inline chaptered card (one chapter, Older/Newer paging, dot indicators) and (b) a full-screen "Play the story" auto-advancing player with tagged change items.
- **Context:** Asked Yash how to source chapter content since the prototype's copy is fictional (see ADR-018) — chose mechanical grouping: one chapter per `## <date>` heading in the real `CHANGELOG.md`, narrative = first entry's Summary verbatim, items tagged Fix/Improvement/Feature by keyword (dropped the prototype's 4th "Epic" tag — no reliable mechanical signal for it). Kept the entry point (`#changelog-toggle`/`#changelog-view`/`#changelog-source`/`#changelog-refresh`) and the bug #007 fetch-with-fallback mechanism (`FALLBACK_CHANGELOG_MD`) completely unchanged — only what happens to the resulting text changed. New full-screen player is a standalone overlay (`#story-player`), not dependent on RD09's tab strip.
- **Files likely involved:** `frontend/app.js` (`parseStoryChapters`, `renderStoryChapterInline`, `openStoryPlayer`/`renderStoryPlayerFrame`/nav functions, `loadChangelog` updated), `frontend/index.html` (`#story-player` overlay markup), `frontend/styles/base.css` (`.story-*` + `#story-player` rules; removed now-dead `.changelog-content h1/h2/p/ul/li/code` markdown rules).
- **Acceptance criteria:** Chapters reflect real CHANGELOG.md entries grouped by date (met — 30 chapters parsed from the real file); play mode opens fullscreen at the oldest chapter, Prev/Next work, next-past-last closes with a checkmark icon on the Next button beforehand (met); progress segments track chapters viewed (met); in-app changelog entry point and bug #007 fallback untouched (met — same ids, same fetch/fallback logic).
- **Verification:** `node --check frontend/app.js` clean. Headless Playwright against the real running app: 30 chapters parsed; newest chapter (2026-07-24) shown first with correct narrative/items; Older paging moved correctly; Play the story opened at the oldest chapter (2026-05-08) with 30 progress segments; clicking Next 30 times advanced through every chapter and closed on the 30th click with a checkmark shown just before close; zero console errors throughout.
- **Follow-up fix (2026-07-25):** Yash reported not being able to find Product story in the real running app — correct, it was only reachable via Settings > Changelog, with no sidebar entry point (an oversight — RD06's own verification drove straight to the Settings toggle, never checked general discoverability). Added a small "Updates" sidebar section with a "Product story" row (`#updates-story-open`) that loads the changelog if needed and opens the fullscreen player directly. Verified: click → player opens immediately with the full real chapter set (34 now, CHANGELOG.md has grown since RD06), zero console errors.

## TASK-RD07 — Projects: grid view + detail page restructure
- **Status:** Done (code complete + headless-verified; human GUI smoke test recommended, incl. reload-persists for `updatedAt`)
- **Goal:** Add a full-screen card-grid Projects landing (search, sort Last-updated/Name, "New project" pill) reached from sidebar "view all projects"; restructure project detail into stacked sections (Chats / Project rules / Project files+folder / Delete) replacing the two-column `.project-grid`.
- **Context:** Net-new landing page (`#projects-view`, reuses the existing `.project-screen` overlay pattern — same shell as `#project-panel`/`#cp-screen`/`#nt-screen`) plus a detail-page restructure. Confirmed `.project-grid`/`.project-col`/`.project-side` were pure CSS classes never referenced by JS, so the HTML restructure was safe; all functional element IDs (`#project-rules-input`, `#project-files-row`, `#project-link-folder`, etc.) were preserved unchanged. The prototype's "Linked folder" wasn't one of the named 3 sections — folded its controls into the "Project files" section header (matches the prototype's own layout, which shows the linked-folder path inline in that section's header). Real project objects had no `updatedAt` field for the "Last updated" sort — added one (additive field, not a schema change; old saved projects default via `if (!p.updatedAt) p.updatedAt = Date.now()` in `openProjectPanel`), bumped only on real mutations (rename, rules edit, add file, new chat in project) — not on merely viewing, so recency sort stays meaningful.
- **Files likely involved:** `frontend/index.html` (`#projects-view` new overlay, sidebar "view all projects" button, restructured `#project-panel` sections), `frontend/styles/base.css` (`.pv-*` new rules, `.project-sections`/`.project-card` replacing `.project-grid`/`.project-col`/`.project-side`), `frontend/app.js` (`openProjectsView`/`closeProjectsView`/`renderProjectsGridView`/`touchProjectUpdated`/`timeAgoShort`, touch calls added at mutation sites).
- **Acceptance criteria:** Grid view renders all projects with working search/sort (met); clicking a card closes the grid and opens that project's detail (met); detail page shows Chats/Rules/Files(+folder)/Delete stacked sections (met); rule/file add-remove still gated by the existing `.confirm-*` delete pattern per Q2 (untouched — no new delete-confirmation logic needed since none of this touched delete flows beyond the pre-existing project-delete confirm); existing project chat data and IDs unaffected (met, confirmed no Dexie schema change, only an additive `updatedAt` field).
- **Verification:** `node --check frontend/app.js` + `frontend/core/store.js` clean. Headless Playwright: created 2 projects, opened the new grid view (2 cards), searched "New project 2" (1 match), sorted by Name (correct alphabetical order), clicked a card (grid closed, detail opened with exactly 3 named section headings: "Chats in this project"/"Project rules"/"Project files"), edited the project name inline with no errors. **Caught and fixed a real bug:** `core/store.js`'s `loadPersistedState` reconstructs saved projects via an explicit field allowlist (`{id,name,rules,files,path}`) — my new `updatedAt` field was silently dropped on every reload until added to that allowlist. Verified the fix with an actual page reload (not just in-session): created + renamed a project, reloaded, confirmed the grid still showed "Updated just now" instead of resetting to "—". [SCHEMA] additive field, no Dexie version bump.

## TASK-RD08 — Spatial branch canvas
- **Status:** Done (code complete + headless-verified with a real created branch; human GUI smoke test recommended, esp. deeper nested branches and all 3 themes)
- **Goal:** New full-screen pannable overlay (`#branch-canvas`) rendering every branch of the current thread as a positioned card connected by curved SVG lines to its parent, dot-grid background, focus/dim states. Clicking a branch node re-focuses it; clicking the doc node closes the canvas.
- **Context:** **Highest-risk phase** — presented a plan to Yash before writing any code (per CLAUDE.md's plan-first-for-branches rule) after investigating the real branch data model. Corrected a wrong assumption inherited from the original design handoff: `.thread-map-panel` lists *threads*, not branches — there was no existing per-branch navigator to "supersede." Scoped RD08 as **read-only**: it never writes to `branches[id]`, never touches `.branch`/`.branch-stack` DOM, and reuses the existing `openBranch({bid: existingId})` re-focus path for node clicks (the same call already used elsewhere to safely re-open an existing branch without recreating it). No drag-to-reposition in v1 (Yash's choice) — layout is computed automatically (depth = column, DFS tree layout for vertical position), so no new persisted per-branch position state was needed.
- **Files likely involved:** `frontend/app.js` (`bcLayout`/`bcRender`/`openBranchCanvas`/`closeBranchCanvas` — all new, read-only over `branches`), `frontend/index.html` (`#branch-canvas` overlay + new `#branch-canvas-toggle` toolbar button next to the existing thread-map icon, not replacing it), `frontend/styles/base.css` (`.bc-*` new rules only).
- **Acceptance criteria:** Canvas opens full-screen (met); background-drag pans (met, 3px-equivalent via real mouse deltas, clicks on nodes still register since the mousedown handler bails on `.bc-node` targets); node click re-focuses the branch and closes the canvas (met); doc-node click just closes the canvas (met); focused node's edges highlight, unrelated dim (met via CSS, `.bc-node.dimmed`/`.focused`); zero writes to branch state, zero changes to any Fragile-area code path (met — confirmed the created branch was completely unaffected after canvas open/click/close/pan cycles).
- **Verification:** `node --check frontend/app.js` clean. Headless Playwright: created a real branch via the selection popover (`#pop [data-act="branch"]`, matching the exact flow used in prior branch bug-fix sessions); opened the canvas — correct "1 branch" count, 2 nodes (doc + branch), 1 edge; clicked the branch node — canvas closed, branch panel correctly became active (`z-index:3`, no `.behind-active`) via the reused `openBranch({bid})` path; reopened canvas, clicked the doc node — canvas closed, branch untouched and still present; Escape closed an open canvas; mouse drag on the canvas background correctly panned (`translate(60px,40px)` → `translate(120px,80px)`). Zero console/page errors across the entire exercise.

## TASK-RD09 — Tab strip
- **Status:** Done (code complete + headless-verified; human GUI smoke test recommended) — scoped down from the original goal, see ADR-020
- **Goal (as built):** Browser-style tab row above the breadcrumb. "Doc" is a permanent pinned tab (not closable). Notes and Coding Projects — the two other views `core/registry.js` already knows about — can be opened as additional closable tabs via a "+" menu. Underline style per confirmed default.
- **Context:** Investigated `core/registry.js` before proposing a plan: it only registers 3 views (`chat`/`notes`/`coding-projects`); Settings/Product-story/Projects-grid/branch-canvas are separate overlays outside the registry. Presented a narrowed scope to Yash (registry-known views only, in-memory tab state, everything else stays as its current direct entry point) and got explicit sign-off before writing code, per CLAUDE.md's plan-first rule for this kind of structural change. Kept all ~10 existing `mountView()` call sites (sidebar, breadcrumb, back buttons) completely untouched by adding one additive subscription hook (`onViewChange`) to the registry instead — see ADR-020.
- **Files likely involved:** `frontend/core/registry.js` (`onViewChange` — additive, `mountView`'s existing behavior unchanged), `frontend/app.js` (tab strip render/state), `frontend/index.html` (`#tab-strip`), `frontend/styles/base.css` (`.tab-*`).
- **Acceptance criteria:** Click switches tabs (met); "×" closes a non-pinned tab, falling back to Doc if it was active (met — no "last tab" edge case exists since Doc can't be closed); "+" opens a menu of not-yet-open registry views (met, disabled when already open); existing direct-navigation entry points (sidebar Notes/Coding-Projects clicks) stay in sync with the tab strip automatically (met, via the registry subscription — verified specifically); no regression to chat/branch/notes/coding-projects behavior (met — created a branch after a full tab-strip interaction sequence with zero issues).
- **Verification:** `node --check` clean on `frontend/app.js` and `frontend/core/registry.js`. Headless Playwright: opened Notes via the tab "+" menu (tab appeared, overlay shown); switched to Doc (overlay hidden, correct active tab); clicked the sidebar's Notes header **directly, bypassing the tab strip** (tab strip correctly re-synced, confirming the subscription approach works for any entry point); closed the Notes tab (removed, fell back to Doc active); confirmed the Doc tab has no close button (pinned); opened Coding Projects via the tab menu (overlay shown, add-menu correctly showed it as disabled/open); created a real branch after all of this — worked with zero errors. Zero console/page errors across the entire sequence.
- **Follow-up (2026-07-25):** Yash pointed at the original design prototype's "+" button, which opens a genuine blank tab showing a 4-button empty state (New chat/Existing chat/Projects/Notes) — my first pass instead had "+" open a small dropdown menu, missing this. Replaced it: "+" now registers `blank` as a real 4th registry view (singleton, same pattern as notes/coding-projects) whose mount/unmount hide/show the doc pane + composer and show/hide a new `#blank-tab-empty` picker. Picker has 5 buttons (added "Coding projects" as a 5th since the real app has that as a distinct feature the prototype didn't): New chat (`startNewChat()`), Existing chat (`openSearch()`), Projects (`openProjectsView()`, RD07), Coding projects (`mountView('coding-projects')`), Notes (`mountView('notes')`) — all reused existing functions, zero new business logic. Removed the now-superseded dropdown-menu markup/CSS/JS. Verified: `+` → empty state shown, doc/composer hidden; each of the 5 buttons produces the correct real effect (Notes/Coding-projects mount, Projects grid opens, New chat actually creates a thread — thread count went 4→5, Existing chat opens the real search palette) and correctly closes the blank tab afterward. Zero console errors.
- **Follow-up 3 (2026-07-25):** Yash reported still losing tabs, with a screenshot showing the tab strip completely absent while Notes was open. Root cause: `.nt-screen`/`.cp-screen` are `position:fixed;inset:0` full-viewport overlays that were painting directly over the tab strip (not a data-loss bug — the strip was just visually covered). Fixed by changing both from `inset:0` to `top:44px;right:0;bottom:0;left:0` (the tab strip's measured height), leaving it visible and clickable while either is open. Settings/Product Story/Projects grid/branch canvas deliberately stay full-viewport — they're outside the tab system per ADR-020/022. Ran a thorough pass per Yash's ask: 4 threads + Notes + Coding Projects open simultaneously (6 tabs) — strip stayed visible through both overlays; switched to a thread tab from inside Coding Projects — overlay correctly hid; rapid-switched all 6 tabs; created a new chat (7th tab); reloaded with all 7 open — all restored correctly with the right active tab; closed a middle tab — only that one removed. Zero console errors across the full sequence.
- **Follow-up 2 (2026-07-25) — revised to Notion-style per-thread tabs + persistence, see ADR-022:** Yash showed a real Notion screenshot ("like notion") with multiple named page tabs and asked for tab state to survive reload — a bigger model than the registry-only scope above. Every open **thread** is now its own tab (identified by its `threadState` key), not just the 3 registry views; hooked into `renderThread()` (the single function all 11 existing thread-switch call sites already go through) via a new `syncThreadTab(id)` call, so none of those call sites needed to change, mirroring how ADR-020 hooked the registry itself. Nothing is pinned anymore — closing the last tab reopens `doc-main`. Tabs + active tab now persist to `localStorage` (`nl_tabs_v1`). **Caught and fixed 3 bugs during verification, all only visible across a real `page.reload()`, not same-session testing:** (1) filtering restored tabs by `threadState[id]` existing wrongly dropped lightly-visited threads never yet written to IndexedDB — fixed to filter on `deletedThreadIds` instead; (2) `renderTabStrip()`'s unconditional `saveTabs()` call was wiping the real saved list via the harmless pre-restore boot paint, before the actual restore ever got to read it — moved persistence to the real mutation points only; (3) `syncThreadTab(id)` was called before `mountView('chat')` inside `renderThread`, so the tab strip's active-tab check read stale registry state and nothing showed as active — fixed the ordering. Final verification: opened 3 threads + Notes as tabs, reloaded — all 4 tabs and the correct active one restored; created a real new chat — became its own tab, survived a second reload; closed tabs — correct removal and fallback; branch creation on the main thread still works with zero errors throughout.

---

## TASK-BUG-038 — Fix child branch trapped under reader-mode parent
- **Status:** Done
- **Goal:** Let a branch created inside an expanded parent branch become the readable active panel and expand normally.
- **Context:** User reported branch-on-branch panels getting stuck small/unreadable. Prior branch reader/layout bugs #028 and #037 made this a fragile branch-panel area.
- **Files likely involved:** `frontend/app.js`, `BUGS.md`, `CHANGELOG.md`, project-memory docs.
- **Acceptance criteria:** Creating a child branch from a reader-mode parent demotes the parent to a normal blurred ancestor, keeps the child above it, and the child expand button enters reader mode cleanly. No persistence/schema changes.
- **Verification:** `node --check frontend/app.js`; headless Playwright nested-reader repro/verification; full human smoke still recommended for API-key/native-picker flows.

---

## TASK-FB03 — Feedback capture v2: area select, annotate, preview-before-attach
- **Status:** Done (full-screen flows verified headless; area flows need human smoke test — they open the native macOS picker)
- **Goal:** Screenshot/Record offer Select area vs Full screen; every capture shows a preview first — screenshots annotatable with a pen (undo/clear), recordings playable — and attaches only on explicit "Add to report"; Discard/Escape deletes the file.
- **Context:** User wanted region capture, pencil annotation, and a confirm step before media lands on a bug report.
- **Files likely involved:** `backend/server.py`, `frontend/core/feedback.js`, `frontend/styles/feedback.css`
- **Acceptance criteria:** Mode menu on both buttons. Area shot = `screencapture -i` (Escape cancels silently). Area recording = `screencapture -v -i`. Preview overlay: canvas + red pen + undo/clear for images (annotations composited into the PNG on disk), `<video>` for recordings. Add attaches chip; Discard deletes file. Upload/discard routes confined to `feedback/media/`.
- **Verification:** curl path-traversal rejected; Playwright E2E: annotate→Add rewrote PNG + chip; Discard deleted file; record→preview→Add chip; zero console errors.

---

## TASK-FB02 — Settings feedback viewer + sidebar scroll fix
- **Status:** Done (verified headless; manual smoke test pending)
- **Goal:** View all logged bugs/ideas from Settings, and make the left sidebar scrollable when content overflows. Also fix the ctx-ranking popover's invisible border and missing Escape handling (#031).
- **Context:** Sidebar clipped below the fold with many projects/notes (#030). Feedback entries (TASK-FB01) had no in-app viewer.
- **Files likely involved:** `frontend/index.html`, `frontend/styles/base.css`, `frontend/core/feedback.js`, `frontend/styles/feedback.css`, `frontend/app.js`, `backend/server.py`
- **Acceptance criteria:** Sidebar middle scrolls, brand + settings footer pinned, section collapse still works. Settings → Feedback mirrors the Changelog section UX: collapsible list, count toolbar, refresh; entries newest-first with badge/id/date/status/text/context/media links. Escape closes the ctx popover; popover border visible.
- **Verification:** Headless Playwright: scroll held with footer visible under injected overflow; settings list rendered seeded entries with "1 bug · 1 idea"; zero console errors. `py_compile` + `node --check` pass.

---

## TASK-FB01 — Feedback/bug collector panel
- **Status:** Done (code complete + endpoints verified; manual UI smoke test pending)
- **Goal:** Persistent floating panel to log bugs and feature ideas from anywhere in the app, with screenshot / screen-recording attachments for bugs, saved to files a coding agent can triage.
- **Context:** User wants to capture issues the moment they happen and hand `feedback/FEEDBACK.md` to a coding agent the next day. Capture is OS-side (`screencapture`) so it works in both the native shell and browsers.
- **Files likely involved:** `backend/server.py`, `frontend/core/feedback.js`, `frontend/styles/feedback.css`, `frontend/index.html`, `frontend/app.js`
- **Acceptance criteria:** ⌘⇧B toggles the panel (⌘Q too, native shell only). Bug/Idea toggle; media buttons only for bugs. Screenshot excludes the panel itself. Record shows elapsed time and stops on second click. Save appends `FB-NNN` entry with view/thread context + media paths to `feedback/FEEDBACK.md`, clears the form, keeps the panel open. Errors surface as toasts.
- **Verification:** `py_compile` + `node --check` pass. curl against test server: save → correct markdown + sequential ids; shot → real PNG; record start/stop → real .mov; stop-without-start → 409. Human: restart :8765 server, ⌘⇧B, log a bug with both media types, confirm FEEDBACK.md + feedback/media/.

---

## TASK-CTX03 — Context ranking feedback + per-chat toggle
- **Status:** Done (code complete, manual smoke test pending)
- **Goal:** Add visible feedback and per-chat control for context ranking. Bug fix: persist rankingLlm pref. Enhanced Sources chip with mode indicators. Per-thread ranking override in Context panel.
- **Context:** TASK-CTX02 had no user feedback. Users couldn't see which mode was active, if context was used, or control it per-chat. rankingLlm pref kept resetting.
- **Files likely involved:** `frontend/core/store.js`, `frontend/app.js` (context functions, send handlers, event wiring, renderCtxPanel), `frontend/index.html` (Context Ranking section in ctx-panel)
- **Acceptance criteria:** rankingLlm persists across reload. Context Ranking section visible in project chats with linked folders, hidden otherwise. Per-thread override stored in threadState + persists via Dexie. Sources chip shows mode-aware label (DeepSeek vs keywords) + icon (🧠 vs 📄). Console logs `[notlinear:context]` object on every context request. Per-chat mode selection saved + restored when opening Context panel.
- **Verification:** Reload app with DeepSeek enabled → setting persists. Open Context panel in project chat → ranking section appears; in non-project chat → section hidden. Select "Off" in one chat → Sources shows "(keywords)"; select "DeepSeek" in another → shows "(DeepSeek)". DevTools console shows debug logs on message send.

---

## TASK-CTX02 — DeepSeek semantic context pipeline (keyword gen + rerank)
- **Status:** Done (code complete, manual smoke test complete)
- **Goal:** Upgrade keyword-matching context selection to a 3-step DeepSeek pipeline: expand query keywords semantically, pre-filter files by keyword, rerank by semantic relevance. Add opt-in "Context Ranking" setting.
- **Context:** Simple keyword matching misses intent. DeepSeek can expand "how does auth work?" to include "authentication", "login", "session", etc., then rerank files by actual relevance. Opt-in to avoid imposing API cost.
- **Files likely involved:** `frontend/app.js` (caches, 2 new functions, 3-step pipeline rewrite), `frontend/core/state.js` (add `rankingLlm` pref), `frontend/index.html` (Context Ranking section), project-memory docs.
- **Acceptance criteria:** Settings panel shows "Context Ranking" select (Keywords only / DeepSeek). Default is keywords-only. When set to DeepSeek + key present: query → keyword generation cached 30min → pre-filter to 30 candidates → semantic rerank cached 10min → top 10 files injected. Graceful fallback to keyword order on timeout/error/no-key. Sources chip reflects active mode ("DeepSeek-ranked" vs "keyword-matched").
- **Verification:** `node --check frontend/app.js` passes. Manual: enable DeepSeek in settings → chat in project → send "how does auth work?" → Sources includes `authentication.md` even if "auth" isn't in naive keywords; send same query again → no extra network call (cache hit); disable DeepSeek key → Sources still appears (keyword fallback).

---

## TASK-CTX01 — Project folder context injection via keyword matching
- **Status:** Done (code complete, manual smoke test complete)
- **Goal:** Let users link a local folder to a sidebar project; when they send a message in a chat within that project, the app automatically includes relevant files from the folder as context (zero-cost keyword matching).
- **Context:** User wants chats to automatically pull in relevant project files based on message keywords, showing which files were used as "Sources" beneath the response.
- **Files likely involved:** `frontend/app.js` (scan cache, keyword extraction, async send + context pre-fetch, addSourcesBar, folder buttons), `frontend/core/store.js` (project schema), `frontend/index.html` (Linked Folder card), `frontend/styles/chat.css` (sources bar styles), project-memory docs.
- **Acceptance criteria:** Link folder button opens macOS picker; path persists across reload; chat in project with keywords matching .md file shows "Sources" chip; unrelated keywords show no sources; existing project-file uploads unaffected; old saves (no path field) load without error.
- **Verification:** `node --check frontend/app.js` clean. Manual: create project → link folder → send message whose words appear in a .md file → confirm Sources chip; reload persists path; unlink clears path.

---

## TASK-BUG-027 — Restore thread opens from overlay views
- **Status:** Done
- **Goal:** Make New chat and left-sidebar thread rows visibly open the requested thread even when Notes or another full-screen view is active.
- **Context:** The view registry introduced overlay views whose DOM can remain above chat. Thread routes were still updating chat state underneath the active overlay.
- **Files likely involved:** `frontend/app.js`, `BUGS.md`, `CHANGELOG.md`, project-memory docs.
- **Acceptance criteria:** From Notes, New chat hides the overlay and shows the new chat; from Notes, clicking a Threads row hides the overlay and shows that thread; existing branch snapshot-before-switch behavior is preserved.
- **Verification:** `node --check frontend/app.js`; browser smoke on local server :8796 for Notes -> New chat and Notes -> Threads row passed.

## TASK-NOTES-03 — Fix Notes emoji picker selection
- **Status:** Done
- **Goal:** Let Notes page and callout emoji/icon pickers accept a selected replacement.
- **Context:** The shared emoji picker renders as `.cp-emoji-pop`, while the Notes outside-click handler still only allowed the old `#nt-emoji-pop`, so picker clicks were dismissed before selection.
- **Files likely involved:** `frontend/views/notes.js`, `BUGS.md`, `CHANGELOG.md`, project-memory docs.
- **Acceptance criteria:** Clicking the large page icon opens the picker; selecting an icon updates the note and persists; callout icon selection works; no `notlinear-notes` schema change.
- **Verification:** Static check + served-file verification passed; full GUI picker smoke is pending because browser automation was unavailable in this session.

---

## TASK-NOTES-02 — Remove seeded notes + add note deletion
- **Status:** Done
- **Goal:** Stop creating default sample notes and give the sidebar explicit delete controls for one note/subtree and for all notes.
- **Context:** User wants the current Notes area cleared for now and needs a visible way to delete notes instead of relying on the hidden `...` prompt flow.
- **Files likely involved:** `frontend/views/notes.js`, `frontend/styles/notes.css`, `frontend/index.html`, project-memory docs.
- **Acceptance criteria:** Fresh Notes starts empty; empty persisted Notes stays empty after reload; row trash deletes the note and subpages; header trash clears all notes; deletion persists in the `notlinear-notes` Dexie db without touching chat persistence.
- **Verification:** Static checks and headless Notes smoke passed: empty first-load, create note, row delete, clear-all, reload-restores-empty.

---

## TASK-NOTES-01 — Notes view (Notion-style notebook) v1
- **Status:** Done (pending human smoke test)
- **Goal:** Implement `notes_product.md` PRD (§§3–§20 v1 acceptance) inside the existing modular `frontend/` structure.
- **Context:** Net-new feature from the design-bundle handoff (`tQ1SqTIQV7nuYH2FXw3FwQ`). Bundle includes a reference `notes-editor.js` + `Notes.html`; per user choice, ported into the modular structure rather than rebuilt from PRD. Persistence per user instruction: Dexie (separate `notlinear-notes` db), not localStorage as the PRD literally says. See ADR-007.
- **Files likely involved:** `frontend/views/notes.js` (new), `frontend/styles/notes.css` (new), `frontend/index.html` (sidebar entry + overlay markup + CSS link), `frontend/app.js` (import + init).
- **Acceptance criteria:** All §20 checklist items pass — sidebar tree (4-col grid, 14px indent, hover actions, collapse-persist), page header (emoji/title/tags/meta with Workspace/Notes/ancestors breadcrumb), every block type in §5 (text/h1–h4/lists/todo/toggle ± heading/quote/callout/divider/code/eq/image/table/cols/page-link), slash menu (filter, kbd nav, markdown shortcuts), floating toolbar (B/I/U/S/code/color/highlight/turn/link), §8 keyboard model, theme tokens (no hardcoded colors), Dexie persistence + reload restores state.
- **Verification:** `node --check frontend/views/notes.js` clean; new CSS/JS served HTTP 200. Manual smoke test pending: open app → click Notes section → confirm seed tree → type title → `/` slash menu → ⌘B on selection → create a sub-page via `/page` → toggle theme → reload → state persists.

---

## TASK-M00 — Baseline + create project-memory files
- **Status:** Done
- **Goal:** Git baseline of the working monolith, then create all missing memory files from AGENTS.md.
- **Context:** Required first step before any code moves. Establishes a revertible checkpoint and the working-memory scaffolding every subsequent agent session depends on.
- **Files likely involved:** `docs/project-notes/` (new), `CHANGELOG.md` (append only), `BUGS.md` (append only)
- **Acceptance criteria:** All memory files exist with correct headers; TASKS.md lists M00–M06; no app files touched; baseline commit landed.
- **Verification:** None needed (no app change); logged in RUNS.md and CHANGES.md.

---

## TASK-M01 — Folder split, zero code change
- **Status:** Done
- **Goal:** Introduce `backend/` and `frontend/` without changing any logic.
- **Context:** Structural prerequisite for all later phases. The server moves to `backend/server.py` and the monolith HTML moves to `frontend/index.html`. The server's served directory is repointed to `../frontend`. Changelog/logs/file-watch path gotchas must be addressed here.
- **Files likely involved:** `notlinear_server.py` → `backend/server.py`, `notlinear.html` → `frontend/index.html`
- **Acceptance criteria:** App loads and behaves identically served from `backend/server.py`; in-app changelog viewer shows live file; logs.md still syncs; update file-watch still fires.
- **Verification:** Full smoke test (AGENTS.md "Verification", all 10 items).

---

## TASK-M02 — Extract CSS
- **Status:** Done
- **Goal:** Move the `<style>` block into `frontend/styles/` split along existing CSS banners: `tokens.css`, `base.css`, `chat.css`; link them from `index.html`.
- **Context:** Pure move — no CSS rules change. Separates styling from markup to enable independent editing and future hot-reload.
- **Files likely involved:** `frontend/index.html`, `frontend/styles/tokens.css`, `frontend/styles/base.css`, `frontend/styles/chat.css`
- **Acceptance criteria:** All three themes (dark-mono / grey / light) render correctly; highlights panel text readable in light mode (bug #022); no inline `<style>` block remaining.
- **Verification:** Full smoke test with emphasis on all three themes and light-mode highlights.

---

## TASK-M03 — Externalize JS as a module (still one file)
- **Status:** Done
- **Goal:** Move the giant `<script>` into `frontend/app.js`, loaded via `<script type="module" src="./app.js">`; remove/adapt the IIFE wrapper.
- **Context:** First JS extraction step. Still one file — no logic split yet. Validates that the ES module boundary itself doesn't break anything before the harder shared-state work in M04.
- **Files likely involved:** `frontend/index.html`, `frontend/app.js` (new)
- **Acceptance criteria:** Full smoke test passes; no IIFE wrapper remains in app.js; `<script type="module">` in index.html.
- **Verification:** Full smoke test.

---

## TASK-M04 — Shared state → `core/state.js` (highest risk)
- **Status:** Done
- **Goal:** Map every shared mutable value and cross-section helper; lift shared state into `core/state.js`; lift shared helpers into their modules; repoint all references.
- **Context:** This is the only non-mechanical phase. The IIFE implicitly shares all top-level let/const; splitting breaks those. Getting the state map right makes M05 purely mechanical. Go slow.
- **Files likely involved:** `frontend/app.js`, `frontend/core/state.js` (new), any helper modules created
- **Acceptance criteria:** All shared state exports from `core/state.js`; no implicit cross-module globals; full smoke test passes.
- **Verification:** Full smoke test with **hard branch exercise** (create / nest / reopen / persist-across-switch / search). CHANGES.md must note how each Fragile area was preserved.

---

## TASK-M05 — Peel modules off, leaf-first (one per commit)
- **Status:** Done
- **Goal:** Extract sections into ES modules in order: `core/markdown.js` → `providers/{claude,deepseek,openai}.js` → `core/api-client.js` → `core/ui.js` → `core/store.js` → view pieces (thread map, highlights, branches, breadcrumbs, composer, prefs).
- **Context:** Each extraction is move-only. Commit and smoke-test after each one so any regression is immediately bisectable.
- **Files likely involved:** `frontend/core/markdown.js`, `frontend/core/api-client.js`, `frontend/core/ui.js`, `frontend/core/store.js`, `frontend/providers/claude.js`, `frontend/providers/deepseek.js`, `frontend/providers/openai.js`, view modules under `frontend/views/`
- **Acceptance criteria:** Each module extraction: chat + the relevant feature + one branch flow pass the smoke test; no logic changed.
- **Verification:** Smoke test after **each** extraction (minimum: chat, the relevant feature, one branch flow). Each run logged in RUNS.md.

---

## TASK-M06 — View registry + chat as the first view
- **Status:** Done
- **Goal:** Add `core/registry.js`; make the existing chat experience register itself (`{ id, label, icon, mount, unmount }`) with no behavior change. `app.js` becomes: init core → register views → mount default.
- **Context:** Final migration phase. Establishes the extensibility seam so future features (e.g. Coding Projects) can be added as a new module under `frontend/views/` without touching the shell or chat.
- **Files likely involved:** `frontend/core/registry.js` (new), `frontend/app.js`, `frontend/views/chat.js` (or equivalent)
- **Acceptance criteria:** Behavior identical; adding a future view is "drop a module + register it"; full smoke test passes.
- **Verification:** Full smoke test.

---

# Coding Projects feature (additive — must not change chat/threads/branches)

> One phase per session; smoke test + memory-file update between phases. See PRD (`Coding Projects PRD.md`) and ADR-003…ADR-005. Decisions for v1: real filesystem; shallow folder listing in scan; LLM-generated status sentence with mtime cache; all state in `localStorage`.

## TASK-CP00 — Memory scaffolding + ADRs
- **Status:** Done
- **Goal:** Seed the Coding Projects task queue and record the architectural decisions before any code.
- **Context:** Establishes the plan of record so each subsequent phase is small and reviewable.
- **Files likely involved:** `docs/project-notes/TASKS.md`, `docs/project-notes/DECISIONS.md`, `CHANGELOG.md`, `docs/project-notes/CHANGES.md`, `docs/project-notes/RUNS.md`
- **Acceptance criteria:** CP00–CP07 listed; ADR-003…ADR-005 recorded; no app files touched.
- **Verification:** None (no app change).

## TASK-CP01 — Backend: additive read-only endpoints
- **Status:** Done
- **Goal:** Add `/__notlinear_pick_folder` (returns `{ok, path}`) and `/__notlinear_scan_project` (returns name + shallow top-level listing + parsed `README/CHANGELOG/BUGS/TASKS` with present/size/mtime/text).
- **Context:** Real-filesystem data source for the feature. Existing endpoints stay frozen (AGENTS.md do-not-touch).
- **Files likely involved:** `backend/server.py`
- **Acceptance criteria:** Both endpoints return correct JSON; reads are size-capped and path-validated (reject `..`, confine to the given dir, no recursive walk); existing `/__notlinear_*` endpoints unchanged.
- **Verification:** `curl` each endpoint on a real folder; chat smoke test still green.

## TASK-CP02 — Shell seam: full-screen overlay + sidebar launcher (ADR-006)
- **Status:** Done
- **Goal:** Add a full-screen overlay `#cp-screen` (mirrors `.project-screen`) and a `views/coding-projects.js` module that registers a `coding-projects` view whose `mount` shows the overlay and `unmount` hides it (chat's mount/unmount stay no-ops — chat DOM untouched). Add a collapsible "coding projects" sidebar section (header + `+` add button) that opens the overlay; persist the section's collapse state in `nl_cp_side_collapsed_v1`. Overlay back/Escape returns to chat. CP02 renders a placeholder; CP03 fills it.
- **Context:** Per ADR-006 the overlay avoids touching the Fragile branch DOM entirely. The module exists from CP02 with registry wiring so CP03 only enriches `render()`.
- **Files likely involved:** `frontend/index.html`, `frontend/styles/coding-projects.css` (new), `frontend/views/coding-projects.js` (new), `frontend/app.js`
- **Acceptance criteria:** Chat behavior unchanged (DOM/handlers not touched); overlay opens from the sidebar section and closes via back/Escape; collapse state persists; renders in all three themes with tokens only.
- **Verification:** Full smoke test incl. hard branch exercise (Fragile #002–#018), plus open/close the overlay over chat. Note: existing Projects/Threads section collapse (pr/th keys) deferred to a later polish task to keep this phase minimal.

## TASK-CP03 — coding-projects view module + list view
- **Status:** Done (status sentence provider switched Claude → DeepSeek per user, 2026-05-26)
- **Goal:** New self-registering `frontend/views/coding-projects.js` + `frontend/styles/coding-projects.css` (tokens only). Project registry in `nl_cp_projects_v1`; scan each via CP01; render rows (emoji · name+path · status sentence · bug/comment counts · last-updated · attn dot); gallery toggle; empty state.
- **Context:** The home of the feature. Status sentence via LLM + mtime cache (ADR-005) with heuristic fallback.
- **Files likely involved:** `frontend/views/coding-projects.js` (new), `frontend/styles/coding-projects.css` (new), `frontend/core/api-client.js`, `frontend/providers/claude.js`, `frontend/index.html`
- **Acceptance criteria:** Rows render from a real folder in all three themes; no hardcoded colors (bug #022); gallery + empty state work.
- **Verification:** Add a real folder; verify list + gallery + empty in dark/grey/light.

## TASK-CP04 — Project page
- **Status:** Done
- **Goal:** Header (editable emoji + title persisted to registry, mono path), meta strip, blocks in PRD order: files (2×2, missing dimmed) · bugs · tasks · changelog · overview — via `renderMarkdown`, with bug/task checkbox lists and missing-file callouts.
- **Context:** Full detail page; reuses the markdown renderer.
- **Files likely involved:** `frontend/views/coding-projects.js`, `frontend/styles/coding-projects.css`
- **Acceptance criteria:** Page renders incl. a missing-file state; rename + emoji persist across reload.
- **Verification:** Open a project with one missing file; reload and confirm overrides stick.

## TASK-CP05 — File preview drawer
- **Status:** Done
- **Goal:** Reuse the right-drawer pattern (margin shift via `--drawer-w`, Escape/X/outside-close) to render a clicked file read-only as markdown. Drawer independent of comments.
- **Files likely involved:** `frontend/views/coding-projects.js`, `frontend/styles/coding-projects.css`
- **Acceptance criteria:** Each present/listed file opens in the drawer; missing cells not clickable; drawer + comments coexist.
- **Verification:** Open several files; confirm Escape/X/outside close and content area reflow.

## TASK-CP06 — Comments
- **Status:** Done
- **Goal:** `nl_cp_comments_v1` = `{[projectId]: Comment[]}`. List-view popover (oldest→newest) + project-page thread (newest→oldest); composer with ⌘↵; delete with `comment deleted` toast.
- **Files likely involved:** `frontend/views/coding-projects.js`, `frontend/styles/coding-projects.css`, `frontend/core/ui.js`
- **Acceptance criteria:** Post/delete/persist across reload; popover and drawer can be open together.
- **Verification:** Post + delete in both surfaces; reload and confirm persistence.

## TASK-CP07 — Add-project popover + default theme → light
- **Status:** In progress — code complete, awaiting human smoke test (final v1 phase)
- **Goal:** Add-project popover (folder path / display name / 12-emoji strip + more…) from sidebar `+` and list `+ add folder`; pick folder via CP01; prepend stub project; `added <name>` toast. Flip bootstrap default theme to `light` (fall back to `light` when `nl_theme` unset).
- **Context:** Final v1 phase; default-theme flip is a user-visible behavior change.
- **Files likely involved:** `frontend/views/coding-projects.js`, `frontend/index.html` (bootstrap theme), `frontend/styles/coding-projects.css`
- **Acceptance criteria:** Popover adds a project and toasts; fresh profile defaults to light; all three themes correct. `Behavior changes:` line logged for the theme default.
- **Verification:** Full smoke test, all three themes, default-on-fresh-profile is light.

## TASK-CP08 — Show all Markdown files on the Coding Projects page
- **Status:** Done
- **Goal:** Replace the fixed README/CHANGELOG/BUGS/TASKS file grid with every discovered `.md` file for the selected project folder.
- **Context:** User wants the Files section in the project page to surface all Markdown docs, including nested docs, not only the four convention files.
- **Files likely involved:** `backend/server.py`, `frontend/views/coding-projects.js`, `frontend/styles/coding-projects.css`, `docs/project-notes/DECISIONS.md`
- **Acceptance criteria:** Scan response includes an additive `markdownFiles` list; the project page renders every returned Markdown file cell; clicking any cell opens the drawer preview; existing convention-doc metadata/status/bug logic still works; scan remains read-only and capped.
- **Verification:** Static checks plus direct scan passed; GUI smoke pending in the app window.

## TASK-NT01 — Notes inline (text-anchored) comments
- **Status:** Done (code complete; static + boot smoke passed, human GUI click-through pending)
- **Goal:** Make the Notes floating-toolbar Comment button functional. Select text → Comment wraps it in `<span class="nt-cmt" data-cid>` and opens a thread popover; click the highlight or per-block badge to reopen; add/delete replies; resolve to unwrap + remove. Persist threads on `b.comments` in the `notlinear-notes` db (additive, no version bump — ADR-009).
- **Context:** User asked to comment on particular sections of a note; chose inline/text-anchored over block-level.
- **Files likely involved:** `frontend/views/notes.js`, `frontend/styles/notes.css`, `frontend/index.html`, `docs/project-notes/DECISIONS.md`.
- **Acceptance criteria:** Comment a phrase → highlight + thread; add/delete replies; reopen from highlight and badge; reload persists; deleting the anchor text prunes the thread; code blocks reject comments; chat/branches untouched.
- **Verification:** `node --check` clean; assets HTTP 200 on :8765; `#nt-comments` in served + rendered DOM; headless Chrome boot no JS errors. Human GUI smoke for the select→comment→reload→prune flow.

## TASK-NT02 — Notes all-pages index view
- **Status:** Done (code complete; static + boot smoke passed, human GUI click-through pending)
- **Goal:** Make the topbar "Notes" breadcrumb open an overview that lists every note with its icon in a neat format, nested like pages, with an option to add a new note.
- **Context:** User: clicking the Notes breadcrumb should show a list of all notes with icons + an add-new option; "just like pages — we already have nested pages, same format."
- **Files likely involved:** `frontend/views/notes.js`, `frontend/styles/notes.css`, `docs/project-notes/{CHANGES,TASKS}.md`, `CHANGELOG.md`.
- **Acceptance criteria:** Notes breadcrumb (and sidebar Notes header) opens an index; index lists top-level notes as cards with icon + block/subpage counts, subpages nested beneath; "New page" creates and opens a note; per-card add-subpage/delete work; clicking a card opens that page; empty state invites creating the first page; chat/branches and db schema untouched.
- **Verification:** `node --check` clean; assets HTTP 200 on :8765. Human GUI smoke for breadcrumb→overview→open/create/delete pending (no headless browser available).
