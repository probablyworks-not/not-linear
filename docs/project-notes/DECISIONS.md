# DECISIONS.md — lightweight ADRs

Each entry: **Decision ID · status · context · decision · alternatives rejected · consequences/tradeoffs · related files**

---

## ADR-033 — FastAPI replaces the stdlib http.server; the twelve legacy endpoints are frozen and pinned by contract tests
- **Status:** accepted 2026-10-04.
- **Context:** `backend/server.py` was 949 lines with a single `do_POST` if/elif chain over ten endpoints and no place to put streaming, jobs, auth or MCP. The business logic was already factored into module-level functions; only the request dispatch was monolithic.
- **Decision:** `backend/app/` with `config.py`, `legacy.py`, `middleware/`, `services/` and `routers/`. Services are copy-pasted from `server.py` with no logic edits. The twelve `/__notlinear_*` paths, their status codes and body shapes are frozen; `tests/contract` runs the same suite against both servers via `NOTLINEAR_SERVER=legacy|fastapi`, so "byte-identical" is checked, not asserted. `tests/contract/test_service_parity.py` additionally diffs the moved functions against the originals in one process.
- **Alternatives rejected:** rewriting the handlers while moving them (makes the contract diff unreadable — the `save_file` AppleScript injection and the SSRF gap are therefore carried over unchanged and fixed in their own commits); a subprocess-based test server (native dialogs would pop real windows and hang CI).
- **Consequences/tradeoffs:** The app now has runtime dependencies where it had none; `pip install -r requirements.txt` is a required setup step and the "no build step, just run it" property is gone (see ADR-031). FastAPI silently changes four things that had to be forced back: `JSONResponse` appends `; charset=utf-8`, Pydantic returns 422 where these handlers return 400, an unhandled exception renders an HTML 500 page, and `runtime_logs` used `send_error`'s HTML bodies — those error-path *bodies* are explicitly out of contract, status codes are not. `backend/server_legacy.py` is retained as the parity oracle until the P3 gate.
- **Related files:** `backend/app/**`, `backend/server.py`, `backend/server_legacy.py`, `tests/contract/**`

## ADR-034 — Static serving is an explicit allowlist; the repository root is no longer served
- **Status:** accepted 2026-10-04.
- **Context:** `ThreadingHTTPServer(..., directory=REPO_ROOT)` served the **whole repository** over HTTP. `GET /BUGS.md` returned 96 KB of private bug triage, `/uploads/` returned personal screenshots, `/docs/project-notes/` was browsable, and `/backend/server.py` was readable. No exploit was needed — anything in the browser could simply ask.
- **Decision:** Serve only `/frontend`, `/tools`, `/feedback/media`, and the single files the app actually fetches: `/CHANGELOG.md`, `/logo.svg`, `/notlinear.html`. `/` redirects to `/frontend/index.html`, and that one line is the rollback switch when the React app takes over at the P6 gate. `tests/contract/test_static_exposure.py` asserts both halves — what must 404 and what must still work.
- **Alternatives rejected:** keeping root serving with a denylist (a denylist is wrong by default; every new private file would need remembering).
- **Consequences/tradeoffs:** Anything added at the repo root that the frontend needs must be added to the allowlist deliberately. The first cut omitted `/notlinear.html`, which is the URL the compiled `Notlinear.app` binary loads, and the desktop app rendered a 404 — invisible to every other test because nothing else requests that path. There is now a regression test for exactly that URL. `logs.md` needs no route at all; it is write-only via POST.
- **Related files:** `backend/app/main.py`, `backend/app/config.py`, `tests/contract/test_static_exposure.py`

## ADR-047 — Backup/restore lives in standalone `tools/` pages using raw IndexedDB, not Dexie
- **Status:** accepted 2026-10-04.
- **Context:** The approved refactor plan writes to live `kv:'state'` rows from phase P5 and rewrites note content in P6, but the repo had no export of any kind — all chat and note data existed in one browser profile with no second copy. A backup tool must therefore work before, during and after the refactor, including while the frontend is half-migrated.
- **Decision:** Two dependency-free pages under `tools/`, sharing `tools/_backup-lib.js`, using the raw IndexedDB API. Opening a database with no version attaches to whatever version exists and can never fire `onupgradeneeded`, so the tool cannot mutate the schema AGENTS.md calls sacred; it also removes the CDN dependency, so a backup works offline. Object stores are enumerated from `db.objectStoreNames` instead of hardcoding `kv`, and the whole of localStorage is dumped rather than the two known keys, so a store or key added later is captured instead of silently omitted. Restore is `put`-per-record with no `clear()`, and a store present in the backup but absent live is reported rather than created.
- **Alternatives rejected:** reusing the Dexie CDN build (declaring a version risks an upgrade, and a backup tool must not depend on the network); adding an export button inside the app (couples the backup to the code being refactored, and would be unavailable exactly when the app is broken); dumping only the known keys (a partial backup that reports success is worse than none); `clear()`-then-restore (lets a stale file destroy data it never knew about).
- **Consequences/tradeoffs:** The backup file contains API keys and full note text in plain text, so it must be stored outside the repo — both pages say so. Restoring replaces the entire `state` row, so a profile holding newer work than the file loses it; mitigated by a typed `RESTORE` confirmation and a pre-restore summary. Because IndexedDB is origin-scoped, both pages refuse `file://` and warn when the current origin has no notlinear database — `localhost` and `127.0.0.1` are different origins with different data. ADR-031 through ADR-046 are reserved by the refactor plan, hence ADR-047.
- **Amended 2026-10-04 (storage realms):** Origin does not identify the data. `Notlinear.app` is a WKWebView on the default `WKWebsiteDataStore`, stored in the app container at `~/Library/WebKit/local.notlinear.app/`; Chrome and Safari each have their own. All three load `http://127.0.0.1:8765`, so the same origin string maps to three separate copies of `notlinear` and `notlinear-notes`, and a backup covers only the realm it was taken in. The tools therefore detect the realm, display it, record it in the backup, and warn on a cross-realm restore. Saving also had to change: WKWebView ignores a blob `<a download>` without a `WKDownloadDelegate`, which this app does not implement, so `saveTextFile()` reuses the four-tier cascade at `frontend/app.js:738` (WKWebView bridge, then `/__notlinear_save_file`, then File System Access, then blob) with a raw-JSON textarea as a last resort.
- **Related files:** `tools/_backup-lib.js`, `tools/export-data.html`, `tools/import-data.html`, `frontend/core/store.js`, `frontend/views/notes.js`, `launchers/NotlinearNative.m`, `notlinear.html`.

## ADR-030 — Coding Projects removed; scan/pick-folder endpoints and picker CSS kept
- **Status:** accepted 2026-09-29.
- **Context:** User asked to remove Coding Projects entirely. Grep showed chat Projects' folder-context feature calls `/__notlinear_scan_project` and `/__notlinear_pick_folder`, and `core/emoji.js` uses `.cp-*`/`.mg-*` classes defined in `coding-projects.css`.
- **Decision:** Delete the view, its CSS, markup and wiring; keep the two endpoints; move shared picker CSS to `styles/emoji-picker.css`. Supersedes ADR-003–006, 008 for the removed UI. Archive: `docs/coding-projects-archive.md`.
- **Alternatives rejected:** deleting the endpoints (breaks chat Projects); renaming `cp-*` classes (unneeded churn).
- **Related files:** `frontend/styles/emoji-picker.css`, `backend/server.py`, `frontend/core/emoji.js`.

## ADR-029 — fetch_url/firecrawl_scrape page windowing lives in tools.js, not per-provider

- **Status:** accepted
- **Context:** `runFetchUrl`/`runFirecrawlScrape` truncated long pages to a fixed head-of-document cutoff (4000/6000 chars) with no way for the model to read further. Fixing this required deciding (a) how a model asks for "more" of a page, and (b) where the fetch-result cache should live — `claude.js` had its own `_fetchUrlCache` (URL → already-truncated string), while `openai.js`/`deepseek.js` had none.
- **Decision:** Add optional `offset`/`query` params to both tools' schemas (in all three provider tool-schema copies in `app.js`); `tools.js`'s runners fetch the full page once, cache the *raw* text keyed by `${tool}:${url}` in a new shared `fetchRawTextCached` helper, and slice a bounded window (`windowText`) per call — `offset` resumes from a position, `query` centers the window on a case-insensitive substring match. Every windowed result reports the char range and total length so the model knows to call again. The cache moved out of `claude.js` entirely; `executeTool` in `tools.js` is the single place all three providers hit, so all three now share one cache and the pagination behavior identically.
- **Alternatives rejected:**
  - **Keep the cache in `claude.js`, add offset/query only there:** would leave OpenAI/DeepSeek without caching or pagination, an inconsistency with no upside — the fetch/scrape logic is provider-agnostic.
  - **Duplicate the raw-text cache into each of the three provider files:** three copies of the same Map+wrapper logic for no behavioral difference; centralizing in `tools.js` (already the single dispatch point via `executeTool`) is strictly simpler.
  - **Just raise the truncation cap instead of paging:** doesn't solve the general case, only pushes the wall further out — a big-enough page still gets cut off with no way to continue.
- **Consequences/tradeoffs:** The raw-text cache now stores full page text instead of a truncated ~4-6KB string per URL, so per-session memory use for `fetch_url`/`firecrawl_scrape` grows somewhat on pages that get fetched — acceptable for a page-session-scoped cache. Tool schemas gained two optional params on both tools, effective across Claude, OpenAI, and DeepSeek call paths identically.
- **Related files:** `frontend/providers/tools.js` (`windowText`, `fetchRawTextCached`, `runFetchUrl`, `runFirecrawlScrape`, `executeTool`), `frontend/providers/claude.js` (removed `_fetchUrlCache`/`executeToolCached`), `frontend/app.js` (`buildTools`, `buildDeepSeekTools`)

---

## ADR-028 — Notes branches reuse chat's `.branch`/`.branch-stack` CSS/DOM and interaction model, not its data or code

- **Status:** accepted (2026-08-02)
- **Context:** Notes' "Ask AI" branches (ADR-009 area) lived in a single fixed right-side drawer (`#nt-branch-panel`, `.nbp-*` classes) — one panel at a time, not resizable, no reader/collapse states. The user asked for Notes branches to reuse chat's branch-panel UI "everything same": floating card pinned near its highlighted anchor, resizable, collapsible, reader/expand mode, "…" menu. Chat's branch code (`frontend/app.js`, `// ---------- branch panels ----------`) is the most fragile area in the codebase (`skills/branch-system/SKILL.md`, `BUGS.md` #001–#010) and is tightly coupled to `threadState`/the `notlinear` Dexie db. The options were: (A) extract a shared, data-source-agnostic branch-panel component used by both chat and Notes; (B) duplicate chat's CSS classes and interaction *pattern* into Notes' own functions, wired to Notes' own data/persistence, touching zero chat code.
- **Decision:** Option B. `frontend/views/notes.js` gained a parallel set of functions (`openNoteBranch`, `closeNoteBranch`, `toggleNoteCollapse`, `toggleNoteReader`, `wireNoteBranchResize`, `rebalanceNotes`/`layoutNoteBranches`, its own `#nt-branch-menu`) that build the *same* `.branch`/`.branch-head`/`.branch-quote`/`.branch-body`/`.branch-compose`/`.branch-resize`/`.msg`/`.composer` DOM structure and CSS classes chat.css already defines (they're global tokens/classes, not chat-scoped), appended to a new `#nt-branch-stack` container (`index.html`). Anchor lookup uses `.nt-br-anchor[data-bid]` inside `#nt-page` instead of `.branched` inside `#doc`; the rail/declutter placement math is copied from chat's `layoutBranches()` with the ancestor-chain/reader-eclipse/parent-snap logic removed, since Notes branches intentionally don't nest (branch-the-branch) — a scope decision confirmed with the user, along with skipping a "Recent branches" sidebar equivalent for Notes and the "Make this the main thread" menu item (no main-thread concept in Notes). `note.branches[]` gained optional additive fields (`collapsed`, `reader`, `width`, `height`, `top`, `userSized`) inside the existing `notlinear-notes` db — no `db.version` bump, extending the ADR-007/ADR-009 precedent. A new `--nt-drawer-w` CSS var (`tokens.css`) keeps Notes' panel-resize width independent of chat's shared `--drawer-w` (chat's `setBranchSize` mutates `--drawer-w` on `:root`, so sharing it would let resizing a Notes branch silently resize chat's branch rail and vice versa). No snapshot/reopen protocol (chat's `captureBranchSnapshot`/`applyBranchSnapshot`, the source of bugs #008/#009) was needed — Notes branch messages are plain data and the body is simply re-rendered from `br.messages` each time a panel opens.
- **Alternatives rejected:**
  - **(A) Shared component used by both chat and Notes:** would require touching the fragile chat branch code and its `threadState` coupling to generalize it, for a feature that per AGENTS.md must stay "strictly additive" to chat. Higher risk for no functional gain given Notes' simpler (flat, no-attachments, no-model-picker) requirements.
  - **Full nesting parity (branch-the-branch) for Notes:** would require porting the ancestor-chain/reader-eclipse/parent-snap logic and depth tracking; the user opted for flat branches for v1.
  - **A "Recent branches" sidebar for Notes:** more surface area to keep in sync (a common bug source per `skills/branch-system/SKILL.md`); the per-block branch badge already covers reopening. Deferred, not rejected outright.
- **Consequences/tradeoffs:** Two independent implementations of the same interaction pattern (some duplication between `app.js`'s branch functions and `notes.js`'s `note*`-prefixed equivalents) instead of one shared component — accepted in exchange for zero risk to chat's fragile branch code. Opening a branch in Notes closes any other open Notes branch (matches chat's actual behavior for non-nested/top-level branches, not a regression). Notes branch panels don't carry chat's attachment/model-picker/extended-thinking features — panel chrome only, not the full composer feature set.
- **Related files:** `frontend/views/notes.js`, `frontend/index.html` (`#nt-branch-stack`, `#nt-branch-menu`), `frontend/styles/notes.css`, `frontend/styles/tokens.css` (`--nt-drawer-w`), `frontend/styles/chat.css` (reused, unmodified), `frontend/app.js` (reference only, unmodified)

---

## ADR-027 — Concrete Notes pages are `note:<id>` tabs; `notes` is only the index/home tab

- **Status:** accepted (2026-08-01)
- **Context:** Bug #043 showed that ADR-026's shared-Notes-tab decision was no longer acceptable. The tab strip already supports many open thread tabs, but Notes still had only one singleton `notes` entry plus one module-global `state.selectedId`, so opening Note B necessarily replaced Note A inside the same tab. The user now explicitly wants multiple notes open at once in separate tabs.
- **Decision:** Add concrete note tab ids of the form `note:<noteId>` to the existing `openTabs` list. Keep `notes` as the Notes index/home tab only. `frontend/views/notes.js` remains the owner of Notes state and metadata; `frontend/app.js` owns tab-strip state and asks Notes for tab labels/icons through small exported helpers. A new `registerNoteOpener(fn)` / `openNoteTab(id)` bridge in `core/registry.js` mirrors the existing chat opener bridge so Notes can request a tab open without importing `app.js` closures.
- **Alternatives rejected:**
  - **Keep singleton Notes and only preserve selectedId per tab in app.js:** rejected because it still leaves no real tab identity for note pages; switching tabs would need hidden per-tab state layered on top of a view that thinks it has one selected note.
  - **Move all Notes tab state into Dexie `notlinear-notes`:** rejected because open tabs are UI state, already stored in `localStorage` by ADR-022. This change does not need a Notes db schema/version bump.
  - **Expose `app.js` tab functions directly to `notes.js`:** rejected for the same reason as ADR-026; `app.js` tab state is still inside the bootstrap module, so a tiny registry bridge is the smallest cross-module surface.
- **Consequences/tradeoffs:** Clicking a note from the sidebar, index, a page-link block, or a note mention now opens/focuses that note's own tab. Multiple tabs can point at distinct notes simultaneously, but the underlying note content still lives in one shared `notlinear-notes` database and one in-memory Notes module state. `nl_tabs_v1` now stores an additive `active` field so note tabs can restore as active after reload; old saved tab payloads without `active` still load.
- **Related files:** `frontend/core/registry.js`, `frontend/app.js`, `frontend/views/notes.js`, `BUGS.md` #043.

## ADR-026 — @-mention chips are inline HTML in `b.text`; opening a chat tab crosses the app.js/registry.js seam via a tiny opener-registration bridge

- **Status:** accepted
- **Context:** User requested Notion-style `@`-mentions in Notes (of both notes and chats), where clicking a mention "opens it in a new tab." Two design questions needed resolving before implementation: (1) where does a mention live in the data model — a new block type, or inline content inside the existing text-block field; (2) since `notes.js` cannot import `app.js`'s tab-strip closures (`openTab`, `openTabs`, `renderThread` — still un-modularized per `MIGRATION.md`), how does clicking a chat mention actually open/focus that chat as a tab; and (3) what does "open in new tab" mean for a *note* mention, given the tab strip's `NON_THREAD_TAB_META` currently treats Notes as one singleton tab, not one tab per note.
- **Decision:** (1) Mentions are inline `<span class="nt-mention" contenteditable="false" data-kind="note|chat" data-id="…">` chips embedded directly in `b.text`, inserted via the same Range wrap-and-insert technique the existing inline-equation feature (`nt-eq-inline`) already uses — no new block type, no schema change, consistent with how bold/italic/links already live in that same field. (2) Added a minimal bridge in `frontend/core/registry.js` — `registerChatOpener(fn)` / `openChatTab(id)` — mirroring the existing `registerView`/`mountView` indirection already in that file. `app.js` calls `registerChatOpener(openTab)` once, right where `openTab` is defined; `notes.js` imports and calls `openChatTab(id)` on a chat-chip click. (3) Confirmed directly with the user: a note mention click switches to/opens the existing shared "Notes" tab and navigates straight to that note (`mountView('notes')` + `selectNote(id)`, both already available), rather than extending the tab-strip's data model to support one tab per note.
- **Alternatives rejected:**
  - New `mention` block type (like `page-link`): rejected — mentions need to sit inline mid-sentence next to other rich text; a block-level item can't do that, and `pickSlash`'s whole-block-rebuild insertion technique would have destroyed surrounding formatting if reused for inline content.
  - Per-note tabs in the tab strip: rejected for this pass — would require extending `NON_THREAD_TAB_META`/`tabMeta`/`openTab`'s "singleton tab per view" model to "one tab per note," a materially bigger change to `app.js`'s tab-strip data model than the feature warranted; user confirmed the simpler shared-tab-and-navigate behavior is sufficient.
  - Direct import of `app.js` internals from `notes.js`: not possible — `openTab`/`openTabs`/`renderThread` are closures inside `app.js`'s still-un-modularized IIFE, not module exports.
- **Consequences/tradeoffs:** Chat list for the mention autocomplete reads `appState.threadState` directly (already documented as importable by "every feature module") — read-only, no new plumbing needed there. The one new cross-module surface is the 3-line opener bridge in `registry.js`; if `app.js`'s tab-strip is ever fully modularized (a later `MIGRATION.md` phase), this bridge can be deleted in favor of a direct import. Clicking a note mention never creates a second Notes tab — repeated note mentions across different notes all funnel through the one shared tab, which is a known, accepted limitation until/unless per-note tabs are requested.
- **Related files:** `frontend/core/registry.js`, `frontend/app.js`, `frontend/views/notes.js`, `frontend/index.html`, `frontend/styles/notes.css`.

## ADR-025 — Notes block indent/outdent (Tab/Shift+Tab) generalizes `children` to every block type, not just toggles (bug #040)

- **Status:** accepted (2026-07-31)
- **Context:** Fixing bug #040 (Tab did nothing useful) required deciding what Tab *should* do inside a Notes block. The user clarified mid-fix that in a bullet list, Tab should nest the block as a sub-bullet — Notion's standard behavior. The block model already had a `children` array, but it was wired up only for `toggle` blocks (its expand/collapse feature), and `renderBlock()` only rendered a `child-wrap` when `b.type === 'toggle'`. The question was whether to build a bullet/numbered/todo-only nesting feature, or generalize `children` to any block type.
- **Decision:** Generalize. `renderBlock()` now renders a `.child-wrap.indent-children` for *any* block that has `children.length`, and the new `indentBlock()`/`outdentBlock()` helpers in `frontend/views/notes.js` operate on any block type, not just lists. This was chosen because every block-tree walker in the file already recurses into `.children` regardless of type (`findBlock`, `blocksToText`, `blocksToMarkdown`, `collectHeadings`, `collectSubpageIds`) — the serialization/export layer already treats nesting as a generic block-tree concept, so restricting *creation* of that nesting to only list types would have been an arbitrary, inconsistent carve-out rather than a simplification.
- **Alternatives rejected:**
  - **Bullet/numbered/todo-only indent:** matches the literal user request more narrowly, but would need its own special-cased indent path (checking `b.type` before allowing indent) while the rest of the codebase already treats children generically — more code for a narrower, less consistent result.
  - **Universal indent restricted to only nesting under a same-type previous sibling:** rejected as unnecessary — since `child-wrap` rendering is now type-agnostic, nesting a bullet under a heading (for example) renders correctly with no special-casing, and Notion itself allows this.
- **Consequences/tradeoffs:** Any block (heading, quote, callout, code, etc.) can now acquire nested children via Tab, not just toggles and lists — this is a broader behavior surface than the user explicitly asked for, but is fully supported by existing rendering/serialization code and required no new storage shape (still the same `children` array already present in the schema for toggles — no `[SCHEMA]` migration needed, ADR non-negotiable #4 satisfied). Toggle blocks keep their own distinct `child-wrap` branch (with the `open`-gated visibility and "empty — click to add" placeholder) since that UX is toggle-specific; the new generic branch only fires for non-toggle types with a non-empty `children` array. **Rendering `child-wrap` outside the toggle-only path exposed a pre-existing latent CSS bug**: `.nt-screen .b` is a row-flex container with no `flex-wrap`, so `child-wrap` rendered as a flex *sibling* of `.content` squeezed into leftover row space instead of stacking below — visible almost immediately once bullets (a much more common block type than toggles) started using this path. Fixed in the same change (`.b{flex-wrap:wrap}` + `.b .child-wrap{flex:0 0 100%}`); this also silently fixes the same bug for toggle children, which had it all along.
- **Related files:** `frontend/views/notes.js` (`indentBlock`, `outdentBlock`, `onEditorKey`, `renderBlock`), `frontend/styles/notes.css` (`.child-wrap.indent-children`, `.b{flex-wrap:wrap}`, `.b .child-wrap{flex:0 0 100%}`), `BUGS.md` #040.

---

## ADR-024 — Notes export is Markdown-only, page + subpages recursive by default, no backend changes (TASK-NT09)

- **Status:** accepted (2026-07-31 — user picked via an explicit two-question choice before implementation)
- **Context:** User asked for an easy way to export a note including images and subpages. Two real design forks: (1) file format — Markdown vs. standalone HTML; (2) scope — current page only vs. current page + subpages walked recursively into the same file. The existing `/__notlinear_save_file` endpoint (already used by chat's "Download .md" action) unconditionally force-appends `.md` to whatever filename is saved (`backend/server.py`, `do_POST`), so an HTML export would need that endpoint changed or a new one added.
- **Decision:** Markdown, recursive-with-subpages by default, both confirmed with the user via `AskUserQuestion` before writing code. This lets export reuse the existing save-file endpoint completely unchanged — no backend touch at all. Images (already stored as base64 data URLs in `b.src`) embed inline as `![](data:...)`, which every common Markdown viewer with data-URI image support renders without any separate asset files or a zip. Subpages are walked via existing `page-link` blocks (not the sidebar parent/child tree) and appended as `## <title>` sections in the same file, cycle-guarded by a visited-id set.
- **Alternatives rejected:**
  - **Standalone HTML file:** renders more faithfully (real inline formatting instead of raw HTML passthrough, styled output) but requires loosening the save-file endpoint's forced `.md` extension — a server change, which this repo treats as a heavier-weight, more-caution change than a frontend-only one. Parked as a future option if the user wants nicer output later.
  - **Page-only export with a separate "with subpages" action:** simpler mental model, but the user explicitly said they wanted subpages included, and a single always-recursive button is less UI than two entry points for what's usually the desired outcome anyway.
  - **Converting inline HTML formatting (bold/italic/links) to literal Markdown syntax:** more "pure" Markdown output, but Markdown natively permits embedded raw HTML and every mainstream renderer (GitHub, VS Code, Obsidian) accepts it — so the block's already-stored HTML is emitted as-is rather than writing an HTML→MD inline converter, keeping the change small.
- **Consequences/tradeoffs:** Export always includes subpages — there's no "just this page" toggle; if a user wants to exclude a subpage from an export they'd need to unlink it first. Very large embedded images make for a large `.md` file (base64 is ~33% bigger than the binary), acceptable for the local single-user use case this app targets. Table of contents (`toc`) blocks are skipped in the export since they're derived/non-persisted, matching how they're already skipped in the existing plain-text copy path (`blocksToText`).
- **Related files:** `frontend/views/notes.js` (`blocksToMarkdown`, `noteToMarkdown`, `exportNoteMarkdown`, `collectSubpageIds`, `slugifyHeading`), `frontend/index.html` (`#nt-export-btn`), `frontend/styles/notes.css`, `backend/server.py` (unchanged — reused as-is).

---

## ADR-023 — Link-preview endpoint trusts its input scheme only; no SSRF/private-IP hardening (TASK-NT08)

> **Amended 2026-10-04.** The premise — "a threat model that doesn't exist in this deployment"
> because the server binds to `127.0.0.1` — is wrong, and the same reasoning had been applied to
> `Access-Control-Allow-Origin: *`. Loopback binding stops other *machines*; it does nothing about
> other *pages in the user's own browser*, which could reach every `/__notlinear_*` endpoint. The
> CORS half was fixed in P0 (see `backend/server.py` `_allowed_origin`). The SSRF half is still
> open and is scheduled as ADR-035 in the refactor plan.

- **Status:** accepted (2026-07-25 — plan reviewed and approved before implementation)
- **Context:** A6 (bookmark blocks) needs a title/description/favicon preview for a pasted URL, which the frontend can't fetch itself (no CORS access to arbitrary sites). This requires a new backend endpoint, `/__notlinear_link_preview`, that makes an **outbound** network request to a URL supplied by the user — the first endpoint in `backend/server.py` to do so. A server that fetches an attacker-influenced URL is a classic SSRF vector in a multi-tenant or internet-exposed deployment (an attacker could point it at internal-only services, cloud metadata endpoints, etc.).
- **Decision:** Validate only that the URL parses as `http://` or `https://` (reject everything else — no `file://`, no other schemes); apply a short fetch timeout (~6s) and a capped read (~512KB) to bound resource use. Deliberately **do not** add private-IP/localhost blocking or DNS-rebinding defenses. This server is local-first, single-user, and bound to `127.0.0.1` (per project memory and `AGENTS.md`'s architecture) — there is no other user or tenant on the other side of this request, and no privileged network the operator doesn't already have direct access to themselves. The classic SSRF threat model (an external attacker tricking a shared server into reaching internal infrastructure on the attacker's behalf) doesn't apply here.
- **Alternatives rejected:**
  - **Block RFC1918/loopback/link-local ranges before fetching:** the standard hardening for this class of endpoint, but adds real complexity (DNS resolution before connect, redirect-chain re-validation to prevent rebinding) for a threat model that doesn't exist in this deployment. Would revisit immediately if this server is ever exposed beyond `127.0.0.1` or gains multi-user concepts (see ADR-032, the OSS trajectory).
  - **No endpoint at all — client-side-only degrade to a plain link:** rejected because A6 explicitly asks for a real preview (title/domain/favicon), which is the whole point of a bookmark block versus a plain link block already covered elsewhere.
- **Consequences/tradeoffs:** If this server's trust boundary ever changes (exposed beyond localhost, multi-user), this endpoint needs revisiting before that ships — flagged here explicitly so it isn't mistaken for an oversight later. Today, the worst a malicious pasted URL can do is make the local server fetch it (same as the user's own browser could already do by visiting it directly) — no new capability is granted.
- **Related files:** `backend/server.py` (`link_preview` helper, `do_POST` route), `frontend/views/notes.js` (A6 bookmark block)

---

## ADR-022 — Tab strip revised to Notion-style per-thread tabs, persisted to localStorage (TASK-RD09 revision)
- **Status:** accepted (2026-07-25 — direct user feedback with reference screenshots)
- **Context:** ADR-020 scoped the tab strip to the 3 registry-known views (chat/notes/coding-projects) with one generic "Doc" tab representing whichever thread happened to be active, and explicitly chose not to persist tab state. Yash pushed back with two reference screenshots: the original design prototype's actual `+` behavior (a real blank tab with a picker, not a dropdown — addressed in a same-day follow-up to ADR-020), and then a real Notion screenshot showing multiple named tabs ("Illinois," "Job Search," "Fnb controller") with the explicit ask "like notion" — making clear each *open thread/page* should be its own tab, and state should survive reload. This is a bigger model than ADR-020's registry-only scope: threads aren't registry views at all, they're switched via a separate, already-centralized `renderThread(id)` function (11 call sites: sidebar rows, search palette, New chat, project chats, breadcrumb nav).
- **Decision:** Every open thread is now its own tab, identified by its `threadState` key (no prefix scheme needed — thread ids and the 3 non-thread ids `notes`/`coding-projects`/`blank` don't collide). Added one line inside `renderThread()` itself — `syncThreadTab(id)`, called after `mountView('chat')` — mirroring ADR-020's registry-subscription approach but at the thread level: since `renderThread` is the one function all 11 existing thread-switch call sites already go through, none of them needed to change. Nothing is pinned anymore (dropped ADR-020's "Doc is permanently pinned" rule) — every tab is closable, matching Notion; closing the last tab reopens `doc-main` rather than leaving zero tabs, matching the original prototype's stated "closing the last tab opens a fresh one" behavior. Tab list + which tab is active are now persisted to `localStorage` (`nl_tabs_v1`) — reversing ADR-020's "resets on reload" call, since that's exactly what "state should be as it is" asked for.
- **Bugs found and fixed while implementing, in order:**
  1. First persistence attempt filtered restored tabs by `threadState[id]` existing in memory — but a thread only gets written to IndexedDB on a real save-triggering event, not on every visit, so lightly-visited threads' tabs were silently dropped on reload even though they were legitimately open. Fixed by filtering on `deletedThreadIds.has(id)` instead (only exclude explicitly-deleted threads) — `renderThread()` already lazily recreates a `threadState` entry for any id with a real sidebar row, so nothing more was needed.
  2. `renderTabStrip()` unconditionally called `saveTabs()` at its end — including for the harmless pre-restore boot paint (`openTabs` still `[]` at that point) — which wiped a real saved tab list in `localStorage` moments before `loadStoredTabs()` got to read it. Fixed by moving the persistence call out of the generic render function and into the actual mutation points (`syncThreadTab`, the `onViewChange` listener, `closeTab`) instead.
  3. Inside `renderThread()`, `syncThreadTab(id)` was called *before* `mountView('chat')` — so the tab-strip's "which tab is active" check (`getActiveViewId() === 'chat'`) read a stale registry state and matched nothing, leaving zero tabs marked active after any thread switch. Fixed by reordering to `mountView('chat'); syncThreadTab(id);`.
  All three were caught by testing an actual `page.reload()` round-trip and checking `.tab-item.active` existed with the right label — same lesson as ADR-020/RD07's persistence bug: same-session-only checks don't catch this class of bug.
- **Alternatives rejected:**
  - **Keep the registry-only scope and just add persistence:** rejected — doesn't address the actual ask; a tab strip that can only ever show "Doc/Notes/Coding-projects" isn't what either reference screenshot showed.
  - **Prefix thread-tab ids (e.g. `thread:<id>`) to avoid theoretical collision with view ids:** rejected as unnecessary — `notes`/`coding-projects`/`blank` are reserved words that will never collide with the `chat-<timestamp>` / `doc-main` / static seed ids threads actually use.
- **Consequences/tradeoffs:** No tab is protected from being closed anymore, including the main thread — closing it just reopens `doc-main` fresh, which was judged acceptable (matches Notion, matches the prototype). `localStorage` (not Dexie) was used for tab persistence, consistent with ADR-014's stance that new UI-only state doesn't need to go through the chat/notes persistence schemas.
- **Related files:** `frontend/app.js` (`syncThreadTab`, `loadStoredTabs`/`saveTabs`, `renderThread`'s `mountView('chat')`/`syncThreadTab` ordering, `closeTab`/`openTab`/`currentActiveTabId`)

---

## ADR-021 — Custom image page icons stored as an `img:<dataURL>` token on `n.emoji`, not a `{type,value}` object (TASK-NT06)

- **Status:** accepted (2026-07-25 — plan reviewed and approved before implementation)
- **Context:** `notes_new_feature.md`'s A13 asks for page icons to support an uploaded image, not just emoji, and suggests widening `n.emoji` to an explicit `{type:'emoji'|'image', value}` object with a migration step for existing plain-string values. But `glyphHTML()` (`frontend/views/notes.js`) already has an established convention for exactly this problem: a `icon:<id>[:<hex>]` string-prefix token (from `core/mind-garden.js`'s `parseIconToken`), used by every note/page glyph render site (sidebar tree row, index cards, page header, breadcrumbs) via that one shared function. A13 also literally says "extend the existing emoji picker" — but that picker (`core/emoji.js`) is shared with Coding Projects and the sidebar's thread/project icons, outside this doc's stated scope (`frontend/views/notes.js` + `frontend/styles/notes.css` only, must not touch coding-projects).
- **Decision:** Follow the existing token convention instead of introducing a new object shape: `n.emoji` can now also be an `img:<dataURL>` string (downscaled to a small square PNG via `<canvas>` before storing, since it only ever renders at ~36px). `glyphHTML()` gets one new branch checking for the `img:` prefix before its existing `parseIconToken` check. Every existing read site keeps working with **zero changes** since they all already go through `glyphHTML`. Old plain-emoji-string notes need **no migration at all** — they're simply left as plain strings and fall through the same existing branch as before. The upload affordance is a small separate button next to the existing big page-icon button in `notes.js`'s own `renderPage()` header — not a change to `core/emoji.js` — confirmed with the user as the way to add this without touching a file shared with Coding Projects/sidebar.
- **Alternatives rejected:**
  - **`{type:'emoji'|'image', value}` object shape (the doc's literal suggestion):** would require migrating every existing note's plain-string `n.emoji` on load, and touching every read site to unwrap the new shape. The token-string approach achieves the same acceptance bar ("existing notes' emoji icons render unchanged") for free, since nothing about existing data changes shape at all.
  - **Extending `core/emoji.js` with an opt-in "image" tab** (flagged so only the Notes call site gets it): would keep the picker UI unified, but touches a file also used by Coding Projects and the sidebar's thread/project icon pickers — outside `notes_new_feature.md`'s explicit scope line. Rejected in favor of a Notes-only adjacent button, same pattern already used for A3's "paste image URL" affordance.
- **Consequences/tradeoffs:** Two independent "this string means something else" prefixes now exist (`icon:` and `img:`) rather than one unified shape — acceptable since both are parsed in exactly one place (`glyphHTML`) and neither is exposed outside it. Icon images are capped at a small square via canvas downscale, so a user picking a large photo as a page icon won't bloat the `notlinear-notes` Dexie value the way an unprocessed original would.
- **Related files:** `frontend/views/notes.js` (`glyphHTML`, `renderPage`), `frontend/core/mind-garden.js` (`parseIconToken`, read-only reference, not modified), `frontend/core/emoji.js` (explicitly not modified)

---

## ADR-020 — Tab strip scoped to registry-known views only; sync via a registry subscription, not touching call sites (TASK-RD09)
- **Status:** accepted (2026-07-25 — Yash confirmed the scoped plan before implementation)
- **Context:** RD09 is the biggest structural change in the redesign — approved by Yash in principle back at TASK-RD00, but not scoped in detail. The prototype's tab model (doc/blank/note/projects/release kinds, multiple simultaneous instances of each) doesn't map onto the real app: `core/registry.js` only knows 3 views (`chat`, `notes`, `coding-projects`), and Settings/Product-story/Projects-grid/branch-canvas are all separate ad-hoc overlays outside the registry, each with their own show/hide functions. There are also ~10 existing call sites of `mountView(id)` scattered across `app.js`/`notes.js`/`coding-projects.js` (sidebar clicks, breadcrumb links, back buttons) that all needed to keep working exactly as before.
- **Decision:** Presented Yash a narrowed plan and got sign-off before writing code: tab strip covers only the 3 registry-known views. "Doc" is a permanent pinned tab (not closable) representing the main chat pane, regardless of which thread is active in it. Notes and Coding Projects can be opened/closed as additional tabs via a "+" menu. Settings, Product Story, Projects grid, and the branch canvas stay exactly as they are — separate entry points, not tab-integrated, for this phase. To keep the tab strip in sync with every existing `mountView()` call site **without editing any of them**, added one small, additive export to `core/registry.js`: `onViewChange(fn)`, a subscription fired at the end of `mountView()`. The tab-strip code subscribes once; any call to `mountView(id)` from anywhere in the app — old or new — automatically creates a tab for that view if missing and re-renders the strip. Tab list is in-memory only (`let openTabs = [...]` in `app.js`), not persisted — resets on reload.
- **Alternatives rejected:**
  - **Register Settings/Product-story/Projects-grid/branch-canvas as views too, for full prototype parity:** offered to Yash as an option, not chosen — bigger surface area (4 more views' worth of registration, plus each currently has bespoke show/hide logic that isn't a clean `mount`/`unmount` pair) for one phase; can be layered on later without re-architecting this phase's work.
  - **Replace all ~10 `mountView()` call sites with a new `openTab()`-aware wrapper:** rejected — touching 10 call sites across 3 files for a UI-sync concern is exactly the kind of "read before you write, minimize blast radius" situation AGENTS.md warns about; the registry-level subscription achieves perfect sync with a 6-line additive change to one file instead.
  - **Persist open tabs to localStorage/Dexie:** rejected for v1 — no stated requirement for tabs to survive reload, and matches ADR-014's precedent (new UI-only state doesn't need persistence by default).
- **Consequences/tradeoffs:** Tabs reset on every reload — a user reopening the app always starts with just "Doc." Settings/Product-story/Projects-grid/branch-canvas remain reachable exactly as they were before RD09 (their own buttons/icons), just not represented as tabs — acceptable since none of the earlier redesign phases assumed tab integration. If those get registered as views later, the existing `onViewChange` subscription picks them up automatically with zero further tab-strip changes needed.
- **Related files:** `frontend/core/registry.js` (`onViewChange`, `listeners` — additive only, `mountView`'s existing behavior unchanged), `frontend/app.js` (tab strip render/state, `TAB_VIEW_META`), `frontend/index.html` (`#tab-strip`), `frontend/styles/base.css` (`.tab-*`)

---

## ADR-019 — Branch canvas is a read-only visualization; no drag-reposition, no branch-state writes (TASK-RD08)
- **Status:** accepted (2026-07-25 — Yash confirmed the scoped plan before implementation, per CLAUDE.md's plan-first-for-branches rule)
- **Context:** RD08 is the highest branch-Fragile-area exposure of the whole redesign. Before writing a plan, verified two things in the real code: (1) `.thread-map-panel` — which `redesign_product.md` (inheriting language from the original design handoff README) described as "a simple list of branch cards" that the canvas would supersede — actually lists *threads* (chats) with message/branch counts and an AI-summarize action, not individual branches; there was no existing per-branch navigator at all, so the canvas is net-new, not a replacement. (2) `branches[id]` already has a safe re-focus path: calling `openBranch({ bid: existingId })` when `branches[id]` already exists just calls `closeOtherBranches(id)`, sets `activeBranchId`, and `rebalance()`s — it does not recreate or mutate the branch. Presented this plan to Yash (scope, risk boundary, the corrected `.thread-map-panel` finding) and got explicit go-ahead before touching any code.
- **Decision:** `#branch-canvas` is a strictly read-only view over `branches` (filtered to `threadId === appState.currentThreadId`) plus a synthetic doc root. Node positions are computed by a pure function (`bcLayout`) — depth from `parentBid` chains determines the x-column, a DFS tree layout (leaves get sequential y, parents average their children's y) determines the y-position — recomputed fresh on every open, never persisted, never user-draggable. SVG connector edges are derived purely from `parentBid`. The **only** interaction that touches existing branch machinery is a node click, which calls the existing `openBranch({ bid })` re-focus path — same function, same code path, zero new branch-mutation logic. New toolbar button (`#branch-canvas-toggle`, `ti-git-branch` icon) sits next to the existing thread-map toggle rather than replacing it.
- **Alternatives rejected:**
  - **Drag-to-reposition nodes (matches the prototype more closely):** offered as an option, Yash chose to skip it for v1 — would require new per-branch persisted position state (a real, if additive, persistence-schema question) for a purely cosmetic feature; deferred rather than built speculatively.
  - **Auto-close/remove `.thread-map-panel` since the canvas is "the replacement":** rejected once it became clear `.thread-map-panel` serves a different purpose (thread-level summaries) — not in scope to remove.
  - **Reimplement branch focusing logic inside the canvas (e.g., directly setting `appState.activeBranchId` and calling `rebalance()`):** rejected — duplicating logic that `openBranch({bid})` already does correctly is exactly the kind of change that risks the Fragile areas; reusing the existing function is strictly safer.
- **Consequences/tradeoffs:** Layout is deterministic but not user-customizable in v1 — a user can't "arrange" their canvas, it always re-derives from the tree structure. Verified with headless Playwright creating a real branch, opening the canvas, clicking to re-focus, and confirming the branch panel's z-index/`.behind-active` state came out correct via the reused code path, plus confirming the branch was completely unaffected by the whole open/click/close/pan cycle.
- **Related files:** `frontend/app.js` (`bcLayout`, `bcRender`, `openBranchCanvas`, `closeBranchCanvas` — all new; `openBranch` itself untouched), `frontend/index.html` (`#branch-canvas`), `frontend/styles/base.css` (`.bc-*`), `redesign_product.md` (correction to the `.thread-map-panel` characterization)

---

## ADR-018 — Product story chapters are mechanically parsed from CHANGELOG.md, not LLM-generated (TASK-RD06)
- **Status:** accepted (2026-07-25 — Yash chose "mechanical grouping" over LLM-narrativized or shell-only-with-mocked-content)
- **Context:** The redesign's "Product story" prototype shows polished narrative chapters ("Give every branch a place," curated Epic/Feature/Improvement/Fix tags) — but that copy is fictional, written for the mockup. The real `CHANGELOG.md` is terse technical bullets (`- Agent:` / `- Summary:` / `- Files changed:` / etc.) under `## <date>` headings. Asked Yash how to bridge this gap before writing any UI, since guessing wrong here means either fabricating fake release-note prose or building a feature nobody can read.
- **Decision:** `parseStoryChapters()` in `app.js` splits `CHANGELOG.md` (or the existing `FALLBACK_CHANGELOG_MD` bundled fallback, unchanged from bug #007) on `## <date>` headings — one chapter per heading, including today's suffixed multi-entry headings (`## 2026-07-24 (2)`, `(3)`, etc., introduced this session to fit several same-day phases) which naturally become separate chapters. Each entry's `- Summary:` line becomes one "item"; the first entry's Summary is reused verbatim as the chapter's narrative (no fabricated headline copy). Items are tagged by keyword regex into 3 buckets — `Fix` (`/\bfix(es|ed)?\b/i`), `Improvement` (`/\bimprove|optimi[sz]e|refactor|update\b/i`), else `Feature`. The prototype's 4th tag, `Epic`, was dropped — there's no reliable mechanical signal for "this one's a big deal" vs. a regular feature, and guessing would be worse than not having the category.
- **Alternatives rejected:**
  - **LLM-narrativized (send raw entries to a provider for polished prose + tagging):** rejected by Yash — bigger feature (new provider call, caching, cost), separate risk surface, deferred rather than built now.
  - **Build the UI shell with the prototype's mocked/fictional chapters:** rejected — would ship fake release notes in a real app; the whole point of "Product story" is it's supposed to be true.
  - **Keep tag as 4 buckets and default unmatched items to "Epic":** rejected — inverts the meaning of "Epic" (should mark the few big things, not be the fallback bucket for everything unclassified).
- **Consequences/tradeoffs:** Chapter narrative quality is exactly as good as the underlying `- Summary:` line — some read a bit technical/terse rather than consumer-friendly prose, an accepted tradeoff for shipping now without fabrication or new provider risk. Revisit with the LLM-narrativized option later if the terseness bothers users in practice. `.changelog-content`'s old markdown-renderer CSS rules (`h1`/`h2`/`p`/`ul`/`li`/`code`) were removed as dead code since nothing calls `renderMarkdown()` for this container anymore — the bug #007 fallback-file mechanism itself (`FALLBACK_CHANGELOG_MD`, `/CHANGELOG.md` fetch-with-fallback) is untouched, only what happens to the resulting text changed.
- **Related files:** `frontend/app.js` (`parseStoryChapters`, `renderStoryChapterInline`, `openStoryPlayer`/`renderStoryPlayerFrame`, `loadChangelog`), `frontend/index.html` (`#story-player` overlay), `frontend/styles/base.css` (`.story-*` rules)

---

## ADR-017 — Tab strip approved as its own phase, built last (TASK-RD09)
- **Status:** accepted (2026-07-24 — Yash confirmed: build it, don't skip)
- **Context:** The design handoff's own README flags the tab strip as "the single biggest structural change; confirm with product before building since it changes the app's navigation model." The app currently renders exactly one view at a time via `core/registry.js`; a tab strip means multiple views can be simultaneously open and switched between, which changes how every other view's mount/unmount lifecycle is invoked.
- **Decision:** Split it out as its own task (RD09), status Blocked, gated on explicit user sign-off (Open question 1 in `redesign_product.md`) before any implementation starts. Every other redesign phase (RD01–RD08) is scoped to not depend on tabs existing — they degrade gracefully to the current single-view model if RD09 is deferred or rejected.
- **Alternatives rejected:**
  - **Build it as part of the general redesign pass:** rejected — violates the handoff's explicit instruction to confirm first, and AGENTS.md's "read before you write" + CLAUDE.md's plan-first-for-risky-changes rules.
  - **Skip it silently and only ship the other 7 areas:** rejected — the redesign's visual language (tab strip sitting above the breadcrumb) is referenced by other screens in the prototype; better to make the decision explicit than to quietly drop it.
- **Consequences/tradeoffs:** If approved, RD09 will likely require its own sub-ADR for the registry lifecycle change (multiple mounted views, background-tab state retention). If rejected, the breadcrumb bar keeps its current single-view header treatment and RD01–RD08 ship without it.
- **Related files:** `frontend/core/registry.js`, `frontend/app.js`, `redesign_product.md`

---

## ADR-016 — Floating panels replace edge drawers via CSS-only positioning change; branch-reply panel descoped from RD04 (TASK-RD04, RD05)
- **Status:** accepted (2026-07-24); revised same day after implementation — branch-reply-panel portion descoped, see below
- **Context:** `.highlight-panel` and `.ctx-panel` were `position:fixed;top:0;right:0;bottom:0;...transform:translateX(100%)` edge drawers sharing one show/hide pattern (`.show` class toggled by existing `openHighlights`/`closeHighlights`/`openCtx`/`closeCtx` functions in `app.js`). The redesign also describes a "branch reply panel" getting the same floating-card treatment. Before touching it, read the real branch system (`.branch`/`.branch-stack` in `chat.css`) — it's **not** a single-slot panel like the prototype's `branchPanel` state assumes. It's already a `position:fixed` stack (`.branch-stack{top:0;right:var(--drawer-gap);bottom:0}`) that can hold multiple simultaneously-open `.branch` cards, each independently positioned by `layoutBranches()`, with a `.branch.reader` promoted state, nesting, and the exact Fragile-area failure modes (#002-#004, #028, #037, #038) this ADR's own risk section flagged. Converting it to a prototype-style "single floating card" would be a real behavior change to a system explicitly called out as needing extra care, not a CSS-only tweak.
- **Decision:** RD04 ships **only** the Highlights and Context panel conversion: `position:fixed;top:64px;right:16px;bottom:16px;border-radius:12px` (was full-height, edge-to-edge), background moved from `--bg` to `--surface` (matches the PRD's card-surface token mapping), full `border` instead of `border-left` (now visible on all 4 sides). The existing `#ctx-scrim`/`#highlight-scrim` full-page-dim elements are kept (so click-outside-to-close JS is untouched) but recolored to `background:transparent` via an ID-selector override — a full-page dim reads wrong behind a small floating card. Zero JS changes. The branch-reply-panel portion of the original scope is **deferred, not built** — it doesn't have a clean 1:1 target in the real architecture; if wanted, it needs its own investigation (likely bundled with RD08's canvas work, since "click a canvas node → open its branch panel" is where the prototype's single-slot behavior actually lives).
- **Alternatives rejected:**
  - **One shared "floating panel" component for all four surfaces (Highlights/Context/Branch-reply/Settings):** rejected — Settings' centered-modal-with-scrim shape isn't a variant of the inset-floating-card shape, and branch panels are a different data model entirely (many instances vs. one slot).
  - **Convert `.branch`/`.branch-stack` to match the prototype's single-panel model anyway, since "continue" was given:** rejected — this is exactly the kind of undocumented behavior change AGENTS.md's non-negotiables warn against ("no silent behavior changes," "check Fragile areas first"). Flagging and deferring costs nothing; guessing wrong here breaks branch reopen/nesting for real users.
  - **Rewrite panel open/close state management alongside the visual change:** rejected for Highlights/Context too — no functional problem exists today; keeping JS untouched makes this phase pure-CSS and trivially revertible.
- **Consequences/tradeoffs:** Highlights/Context now look like floating cards; Settings still pending (RD05); branch-reply-panel treatment is an open item, not silently dropped — flagged for Yash. No risk to the existing mutual-exclusivity invariant (JS untouched) or to any Fragile branch area (branch code untouched).
- **Related files:** `frontend/styles/base.css` (`.ctx-panel`, `.highlight-panel`, `#ctx-scrim`/`#highlight-scrim`), `frontend/app.js` (read-only verification of `openHighlights`/`closeHighlights`/`openCtx`/`closeCtx` — no edits), `frontend/styles/chat.css` (`.branch`/`.branch-stack` — read-only, confirmed untouched)

---

## ADR-015 — Default project/thread icons reuse the existing Mind Garden system, no new module (TASK-RD02; supersedes RD01)
- **Status:** accepted (2026-07-24) — revised after discovering existing infrastructure; branch-blue reconciled to the existing `--branch` value (`#58A6FF`), no new token added
- **Context:** Before writing an icons module, grepped for existing icon-rendering call sites (`AGENTS.md` "read before you write"). Found `frontend/core/mind-garden.js` + `frontend/mind-garden-icons.html` already implement exactly this: 145 hand-drawn inline-SVG icons (including `iris`, `acorn`, `compass`, `star`, `branch`, `roots` — every glyph this redesign needs) loaded once and rendered via `renderIconSvg(id, {size, color})`. `frontend/app.js`, `views/notes.js`, and `views/coding-projects.js` already consume it through a shared `glyphHTML(value, {fallback})` helper and an `icon:<id>[:<hex>]` token format (parsed by `parseIconToken`), wired to a per-item emoji/icon picker (`core/emoji.js`'s `openEmojiPicker`, `ICON_COLORS` palette of fixed hex literals — the same "decorative constant, not a theme token" pattern the redesign's OKLCH hues need). Today, projects/threads only get a hand-drawn icon if a user manually picks one; the default (no pick) is a plain Tabler icon (`ti-folder` / `ti-message`) for every item, uniformly.
- **Decision:** No new module, no `tokens.css` additions. Add two small local constant arrays in `frontend/app.js` (`PROJECT_ICON_CYCLE`: iris/acorn/compass/star; `THREAD_ICON_CYCLE`: branch/compass/roots/star), each pairing an existing Mind Garden icon id with a literal OKLCH/hex color string — mirroring the existing `ICON_COLORS` pattern in `mind-garden.js` (hardcoded, theme-invariant decorative colors, not CSS custom properties, since an inline SVG `stroke` attribute can't resolve a `var()` without also changing `renderIconSvg`'s contract). `renderProjects()` and `addThreadButton()`/`refreshThreadGlyph()` compute a default glyph by cycling through these arrays by creation-order index (falling back to the existing Tabler icon via the same `svg || fallback` chain already in `mind-garden.js`/`glyphHTML`, so pre-load rendering is unaffected) — used only when the item has no user-chosen emoji/icon, which always wins.
- **Alternatives rejected:**
  - **Build `frontend/core/icons.js` as originally planned in RD01/RD02 (superseded):** rejected once the Mind Garden system was found — would have duplicated 145 already-hand-drawn icons' worth of infrastructure (loading, parsing, caching, rendering) for a system that already has the exact 6 icons needed.
  - **Add `tokens.css` custom properties for the new hues:** rejected — `renderIconSvg` sets `stroke="${color}"` as a plain SVG attribute, which doesn't resolve `var(--x)`; using literal color strings matches the codebase's own existing precedent (`ICON_COLORS` in `mind-garden.js`) for fixed, theme-invariant decorative colors.
  - **Store default glyphs as `icon:<id>:<hex>` tokens through the existing `parseIconToken`/`glyphHTML` pipeline:** rejected — that format only supports hex (`'#' + rest`), not OKLCH strings, and extending it would touch a function shared by `notes.js`/`coding-projects.js`/`emoji.js` for a value (the default, unpersisted glyph) that never needs to round-trip through storage.
- **Consequences/tradeoffs:** Zero new files; change is confined to `frontend/app.js`. Icon cycling is by index (creation order), so deleting/reordering projects can shift which default icon a remaining project shows on next render — matches the prototype's own `index % 4` approach and is a cosmetic-only concern (a user's manual icon pick, once set, is stable regardless of index). Thread color assignments were standardized to one hue per shape (branch=blue, compass=teal, roots=green, star=red) rather than pixel-matching the prototype's one-off "sundial colored violet" pricing-thread example, since that pairing wasn't systematic — noted as a deliberate simplification.
- **Related files:** `frontend/app.js` (`renderProjects`, `addThreadButton`, `refreshThreadGlyph`), `frontend/core/mind-garden.js` (read-only, unchanged), `frontend/core/emoji.js` (read-only, unchanged)

---

## ADR-014 — Redesign phases stay presentation-only; no Dexie/localStorage schema changes (TASK-RD00–RD09)
- **Status:** accepted (2026-07-24)
- **Context:** The design handoff touches nearly every screen in the app (sidebar, panels, settings, projects, changelog) but is explicitly a visual/interaction redesign, not a data-model change. AGENTS.md treats the persistence schema as sacred; Coding Projects (ADR-004) and Notes (ADR-007) both precedent-set "new feature state goes in localStorage/its own db, not a chat-schema bump."
- **Decision:** All new UI-only state introduced by this redesign (canvas pan/focus, story player index, projects-grid search/sort, open-tabs list if RD09 is approved) lives in a new slice of `core/state.js` and/or `localStorage`, following the Coding Projects precedent — never a `notlinear` or `notlinear-notes` Dexie version bump. Existing persisted data (threads, branches, projects, notes) changes presentation only; its shape is untouched.
- **Alternatives rejected:**
  - **Extend the `notlinear` Dexie schema to store canvas layout/tab state:** rejected — no persistence requirement in the spec beyond within-session UI state; a schema bump for ephemeral UI state isn't justified and risks the do-not-touch persistence rule.
  - **Store new UI state in Notes' `notlinear-notes` db:** rejected — unrelated feature area; would violate ADR-007's separation intent by proxy.
- **Consequences/tradeoffs:** Canvas pan position, tab list (if built), and story-player progress won't survive a full page reload unless explicitly persisted to `localStorage` — acceptable for v1 per the Coding Projects precedent, revisit if users want it to survive reloads.
- **Related files:** `frontend/core/state.js`, `redesign_product.md`

---

## ADR-013 — Feedback capture via OS `screencapture`, stored as repo files (TASK-FB01)
- **Status:** accepted
- **Context:** The feedback collector needs screenshots and screen recordings of bugs. Browser capture (`getDisplayMedia` + `MediaRecorder`) is unsupported in the WKWebView native launcher and forces a screen-picker prompt in browsers. Storage needs to be readable by a coding agent the next day.
- **Decision:** The local Python server shells out to macOS `screencapture`: `-x` for silent full-screen stills, `-v` spawned as a subprocess and finalized with SIGINT for recordings (one at a time, guarded by a `threading.Lock` since ThreadingHTTPServer handles requests on separate threads). Entries are plain files in the repo — `feedback/FEEDBACK.md` (sequential `FB-NNN` headings with `status: open`, context, media paths) and `feedback/media/`. No Dexie/IndexedDB involvement.
- **Alternatives rejected:**
  - **`getDisplayMedia` + `MediaRecorder`:** doesn't work in WKWebView; picker prompt every capture; produces blobs that would still need uploading to disk.
  - **Storing entries in Dexie:** invisible to the coding agent workflow, which is markdown-file-native (BUGS.md, TASKS.md); files on disk are the point.
  - **JSON/JSONL entry format:** machine-friendly but not hand-editable; agents read markdown fine and the repo's memory files are already markdown.
- **Consequences/tradeoffs:** macOS-only (fine — the whole launcher stack is macOS). Requires Screen Recording permission for the process running the server (one-time TCC grant). Recordings capture the whole screen, including other apps. Removing a chip in the UI drops the path from the entry but leaves the file on disk.
- **Related files:** `backend/server.py` (`_feedback_*` helpers, three routes), `frontend/core/feedback.js`, `feedback/FEEDBACK.md`

---

## ADR-012 — Per-thread ranking mode override (TASK-CTX03)
- **Status:** accepted
- **Context:** After TASK-CTX02, users had no way to control context ranking per-chat. Some chats might need full DeepSeek power; others might want minimal/off. Global setting alone was too coarse.
- **Decision:** Add `rankingMode` field to `threadState[id]`, storing one of `'inherit' | 'none' | 'keywords' | 'deepseek'`. `'inherit'` means "use global prefs.rankingLlm". Other values override for that chat only. Store in Context panel's `#ctx-ranking-mode` select. Show section only when chat has projectId + linked folder (hide otherwise). `threadState` is already persisted wholesale via Dexie, so no schema changes needed.
- **Alternatives rejected:**
  - **Global-only setting:** No per-chat control. Users frustrated if some chats need different modes.
  - **Store in localStorage (per-chat key):** Could work, but duplicates Dexie. `threadState` is already the source of truth for thread metadata.
  - **Per-project setting:** Makes sense conceptually, but rigid — a user might want one project to use DeepSeek and another to use keywords-only within the same project folder.
- **Consequences/tradeoffs:** `threadState` grows slightly (1-2 bytes per chat, not visible to users). Rendering complexity: need to show/hide Context Ranking section based on `projectId + linked folder` (done in `renderCtxPanel`, re-rendered on context-toggle). No cross-chat defaults — each new chat inherits global setting (requires an explicit click to override, which is good).
- **Related files:** `frontend/app.js` (buildProjectFolderContext resolves effectiveMode, generateSearchKeywords/rankFilesWithDeepSeek check effectiveMode, ctx-ranking-mode handler, renderCtxPanel show/hide logic), `frontend/index.html` (Context Ranking section in ctx-panel)

---

## ADR-011 — 3-step DeepSeek context pipeline with dual caches (TASK-CTX02)
- **Status:** accepted
- **Context:** Simple keyword matching (TASK-CTX01) misses synonyms and intent. "How does auth work?" should surface `authentication.md`, but naive tokenizing won't catch the semantic link. Alternatives: use an embeddings model, use a heavier LLM, use BM25 ranking. Cost/complexity must be reasonable.
- **Decision:** 3-step pipeline: ① DeepSeek keyword expansion (cached 30min), ② fast keyword pre-filter (free, sync), ③ DeepSeek semantic reranking (cached 10min). Two aggressive caches because: (a) keyword expansion is deterministic per query (30-min TTL reuse across users/sessions), (b) file reranking is deterministic per (pid, query) pair (10-min TTL). DeepSeek calls use direct `fetch()` (not `loggedFetch()`) to avoid polluting the dev request log. Opt-in via `prefs.rankingLlm: 'none'` default; graceful fallback to keyword order on any error/timeout/no-key.
- **Alternatives rejected:**
  - **Embeddings (transformers.js):** Offline, smart, but adds ~100MB model download + slow first-load + browser memory overhead.
  - **Claude for ranking:** Too expensive ($3/M tokens vs DeepSeek $0.14/M); defeats the purpose of cheap context.
  - **BM25 ranking:** Better than keywords, but doesn't catch semantic intent the way an LLM does.
  - **Single DeepSeek call:** Combine keyword gen + reranking into one call. Rejected because: (a) adds latency to every message, (b) reranking is specific to (pid, query) so it doesn't cache well with gen, (c) two calls allow independent cache policies.
- **Consequences/tradeoffs:** Two Deepseek API calls per unique query (cold: ~$0.0003, warm: $0.0000). ~300–600ms cold latency (happens before spinner appears, not visible). Keyword path still available for free (default). Requires DeepSeek API key and `rankingLlm: 'deepseek'` to activate. If DeepSeek times out or fails, silently falls back to keyword order (no user-facing error).
- **Related files:** `frontend/app.js` (caches, functions), `frontend/core/state.js` (prefs), `frontend/index.html` (settings UI)

---

## ADR-010 — Project folder scan cache: 5-minute TTL in-memory Map, not localStorage
- **Status:** accepted
- **Context:** TASK-CTX01 adds keyword-matched project folder context injection. Each send in a project-linked chat triggers a folder scan (up to 200 markdown files + listing). Re-scanning on every message is wasteful; a cache is needed to avoid repeated work.
- **Decision:** Cache scans in an in-memory `projectScanCache` Map with a 5-minute TTL (`Date.now() - hit.fetchedAt < 5*60*1000`). The cache is session-scoped (resets on page load). Scans are fetched with plain `fetch()` (not `loggedFetch()`) to avoid polluting the dev request log with silent background calls.
- **Alternatives rejected:**
  - **localStorage:** Would exceed quota for large project folders; Markdown file contents alone can be 1–5 MB per project.
  - **Dexie:** Overkill for session-scoped transient data; would require schema management.
  - **No cache:** User would see visible latency (a few hundred ms) on cold scans; repeated sends would re-scan needlessly.
- **Consequences/tradeoffs:** Cache expires on page reload (session boundary), which is fine — the user's project may have changed while they were away. Cold scans (first send, or after 5 min idle) incur a 200–500 ms round trip to the backend, but this happens before the working-status spinner appears, so it's not visible.
- **Related files:** `frontend/app.js` (PROJECT_SCAN_CACHE_TTL_MS, projectScanCache, fetchProjectScan)

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

---

## ADR-008 — Coding Projects scans capped recursive Markdown previews
- **Status:** accepted
- **Context:** ADR-003 originally kept the scan shallow and focused on four convention files. The user now wants the project page Files section to show **all** Markdown docs for a project, including files such as nested docs under `docs/`.
- **Decision:** Keep the existing `files.{readme,changelog,bugs,tasks}` object unchanged for status/bug/count logic, and add an additive `markdownFiles` array to `/__notlinear_scan_project`. The array contains `.md` files found recursively under the selected folder, each with `relativePath`, metadata, and preview text when the file is <=1 MB. Skip hidden/vendor directories (`.git`, `node_modules`, virtualenv/build/cache folders), cap the list at 200 files, and set `markdownFilesTruncated` when capped.
- **Alternatives rejected:**
  - **Only use the existing shallow `listing`:** It exposes names but not file text for drawer preview, and misses nested docs.
  - **Replace the convention `files` shape:** Risky and unnecessary; the status sentence and bug-count code already depends on that stable shape.
  - **Unbounded recursive scan:** Too expensive and too broad for local repos with generated/vendor trees.
- **Consequences/tradeoffs:** The scan endpoint reads more files than before, but remains read-only and bounded. The frontend can show all project Markdown docs while stale clients continue to use the old convention-doc object.
- **Related files:** `backend/server.py`, `frontend/views/coding-projects.js`, `frontend/styles/coding-projects.css`

---

## ADR-007 — Notes persists in a separate Dexie database, not the main `notlinear` db or localStorage

- **Status:** accepted
- **Context:** `notes_product.md` §10 specifies `localStorage` for the notebook (`nl_notes_v1`, `nl_notes_selected_v1`, `nl_notes_open`). The user overrode this during implementation: "the notes should be saved in the local db." The project's local db is Dexie/IndexedDB. Two options: (A) bump the existing `notlinear` db's version and add a new store (or share its `kv` store) for notes keys; (B) open a separate Dexie database, e.g. `notlinear-notes`.
- **Decision:** Option B — open a separate Dexie db `notlinear-notes` with its own `kv: 'key'` store, holding `nl_notes_v1` (notes array), `nl_notes_selected_v1`, and `nl_notes_open_v1`. The existing `notlinear` schema in `core/store.js` is not touched. A one-time migration imports any pre-existing `nl_notes_v1` from localStorage into the new db and clears the localStorage key. Saves are debounced (~180ms).
- **Alternatives rejected:**
  - **(A) Same db, new store or shared kv:** Cleaner from a one-db-per-app stance, but requires bumping `notlinear`'s `db.version` and editing `core/store.js`. That's a Fragile-areas-adjacent change (chat persistence is bug-cluster territory in BUGS.md) for no functional gain — notes have no FK to chat/threads/projects, so colocation buys nothing.
  - **localStorage as the PRD literally specifies:** Direct user instruction said "local db," and Dexie is the project's local-db norm; honoring intent over the PRD literal is correct.
- **Consequences/tradeoffs:** Two Dexie connections per session (negligible). Notes db is independently backup-able / restorable. Image blocks store dataURLs in IndexedDB, fine for v1 (PRD §15 non-goal). The PRD's `nl_notes_open` key is named `nl_notes_open_v1` here to match the project's `_v1` versioning convention.
- **Related files:** `frontend/views/notes.js`, `frontend/styles/notes.css`, `frontend/index.html`, `frontend/app.js`

---

## ADR-009 — Notes inline comments anchor as `data-cid` spans inside block HTML

- **Status:** accepted
- **Context:** The user wants to comment on particular sections of a note and chose inline/text-anchored comments (Notion-style) over whole-block comments. An inline comment must anchor to a specific text span and survive reloads, edits, and re-renders. Notes blocks already persist rich content as `innerHTML` in `b.text` (see `attachEditor`). Options for the anchor: (A) store character offsets/ranges per block and re-derive the span on render; (B) wrap the commented text in a marker element that lives inside the persisted HTML.
- **Decision:** Option B. On Comment, wrap the selection in `<span class="nt-cmt" data-cid="…">` and persist it as part of `b.text`. The thread itself (quoted snippet + replies) lives on the block as a new optional `comments` array: `b.comments = [{ cid, quote, items:[{id,text,ts}] }]`, keyed by the same `cid`. Threads whose `cid` no longer appears in `b.text` are pruned on render (`pruneComments`). Resolving a thread unwraps the span and drops the entry. Stored inside the existing `notlinear-notes` kv value — **no `db.version` bump** (extends ADR-007). Restricted to rich editors that persist to `b.text` (text/heading/list/todo/toggle/quote/callout); code blocks (`plaintext-only`), table cells (`b.rows`), and image captions (`b.caption`) are excluded.
- **Alternatives rejected:**
  - **(A) Offset/range model:** Requires bespoke range serialization and re-anchoring logic that drifts and breaks as the HTML changes (bold/highlight spans, etc.). The span-in-HTML approach lets the browser maintain the anchor for free and degrades gracefully (delete the text → the span and thread vanish).
  - **A separate `nl_notes_comments` kv key / new store:** Unnecessary indirection; threads are intrinsically per-block, co-locating them on the block keeps load/save/migration trivial and avoids orphan bookkeeping across keys.
  - **Block-level comments:** Simpler, but the user explicitly chose inline/text-anchored.
- **Consequences/tradeoffs:** Comment anchors are coupled to the block HTML, so a thread is lost if its highlighted text is deleted (acceptable/intended — the highlight is the source of truth). `wrapComment()` inherits the cross-element-boundary caveat of `wrapSelection()`. No schema/version change; existing notes are unaffected.
- **Related files:** `frontend/views/notes.js` (`startComment`, `wrapComment`, `openComments`/`renderComments`, `resolveThread`, `pruneComments`, `wireCommentSpans`), `frontend/styles/notes.css` (`.nt-cmt`, `#nt-comments`, `.nt-cbadge`), `frontend/index.html` (`#nt-comments`)

---

## ADR-032 — Open-source the core in a fresh repo; private features become plugins

> **Renumbered 2026-10-04.** This was filed as a second ADR-010, colliding with the
> accepted "Project folder scan cache" ADR-010 above. Renumbered to ADR-032, the ID the
> refactor plan reserves for this decision.

- **Status:** superseded 2026-10-04 by the React/FastAPI refactor plan — the core is still
  published as a fresh squashed repo, but as the React (`web/`) + FastAPI (`backend/app/`)
  rewrite rather than the no-build-step ES-module app this entry assumed. See ADR-031
  (build step accepted). Superseded for the *architecture*; the fresh-repo and
  private-plugins decisions still stand.
- **Context:** The repo now hosts several products (branching chat, Notes, Coding Projects, feedback collector). The maintainer wants to open-source only the core — threads + branching + Projects + context — and keep the rest separate going forward, with a VS Code branching extension as the next milestone. Options: (A) open-source this repo as-is; (B) scrub this repo's git history and flip it public; (C) extract the core into a fresh public repo with a clean initial commit, and restructure the private repo to consume the core plus private plugins.
- **Decision:** Option C, per `plan.md`. New public repo carries `backend/server.py` (minus feedback routes), `frontend/` minus `views/{notes,coding-projects}.js`, `core/feedback.js` and their CSS, plus curated docs (README, LICENSE MIT, SECURITY, CONTRIBUTING, FRAGILE, curated AGENTS + skills). Separation boundary going forward: core never references private features by name; private features live under `plugins/` and self-register via `core/registry.js` (optional dynamic import); one Dexie db per feature (generalizing ADR-007). After launch, core development happens in the public repo; the private repo pulls core via git subtree. A DOM-free `frontend/engine/` layer (model/context/providers) is extracted so the VS Code extension reuses the engine, not the UI.
- **Alternatives rejected:**
  - **(A) Publish as-is:** ships personal media (`uploads/`, `feedback/media/`), working memory, and multi-product sprawl that dilutes the pitch.
  - **(B) History scrub + flip public:** `git filter-repo` over months of history with personal artifacts is error-prone; a leaked blob is unrecoverable once public. Clean start is safer and simpler.
- **Consequences/tradeoffs:** Two repos to maintain and a subtree sync cost; public repo loses granular history (acceptable). The plugin seam requires a small core change (optional `plugins/` loader) logged as its own task. Public contributions demand automated smoke coverage (Playwright) before PRs open — called out as the highest-leverage prerequisite in `plan.md` §OSS-04.
- **Related files:** `plan.md`, `frontend/core/registry.js`, `frontend/app.js`, `backend/server.py`

## ADR-045 — Model choice is per composer, not global

- **Status:** accepted 2026-10-03. *(Reformatted 2026-10-04 from an undated freeform entry into the format this file mandates.)*
- **Context:** A single global model setting forced every branch to use whatever the main thread was set to, so exploring a tangent on a cheaper or faster model meant changing it for everything.
- **Decision:** Each chat branch stores its own `modelPref`, inherited from its parent (or main) at creation and independent afterwards. Main keeps using `prefs.model`.
- **Alternatives rejected:** keeping one global model (the problem); a per-thread rather than per-branch setting (too coarse — branches are where model choice actually varies).
- **Consequences/tradeoffs:** The thinking toggle stays global, and Notes branch panels still follow main — both revisitable. `modelPref` is an additive field inside the existing `kv:'state'` blob, so no Dexie version bump.
- **Related files:** `frontend/app.js`, `frontend/core/state.js`, `frontend/core/store.js`

## ADR-046 — Modes: overrides-only storage in the prefs blob

- **Status:** accepted 2026-10-04. *(Reformatted 2026-10-04 from an undated freeform entry into the format this file mandates.)*
- **Context:** Conversation modes became user-editable. Storing each edited mode as a full copy would freeze the built-in text at the moment of editing, so later improvements to a default would never reach anyone who had touched that mode.
- **Decision:** Built-in modes stay in code (`core/modes.js`). User edits are stored as per-field overrides in `prefs.modeOverrides`, user-created modes in `prefs.customModes`, and the two are merged at read time. Resetting a mode is simply deleting its override. A mode is only a system prompt — no tool or model settings — and the setting is global, not per-chat.
- **Alternatives rejected:** storing edited modes as full copies (defaults would never improve for edited modes); a new Dexie store for modes (unnecessary — the data is small and prefs-shaped).
- **Consequences/tradeoffs:** Lives in the existing `kv:'state'` blob, so no Dexie version bump. A built-in mode renamed or removed in code leaves an orphaned override, which the read-time merge must tolerate.
- **Related files:** `frontend/core/modes.js`, `frontend/views/modes-modal.js`, `frontend/core/store.js`, `frontend/providers/tools.js`
