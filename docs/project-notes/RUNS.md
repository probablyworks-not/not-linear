# RUNS.md — run log

Each entry: **date/time · task or bug ID · command category · result · important output · follow-up**

---

## 2026-08-01 — BUGS.md #043 (per-note tabs) — static syntax checks + targeted headless Chromium — pass

- **Command category:** static (`node --check`) + targeted headless Chromium against disposable `backend/server.py --port 8796`
- **Result:** pass
- **Output:** `node --check frontend/app.js`, `node --check frontend/views/notes.js`, and `node --check frontend/core/registry.js` all exited cleanly after adding `note:<id>` tab handling, the note-opener bridge, note tab metadata helpers, `nl_tabs_v1.active`, and routing Notes entry points through `openNoteTab`. Initial Playwright run inside the sandbox failed to launch Chromium on macOS (`MachPortRendezvousServer` permission denied), then the escalated browser run found a real blank-tab race: `closeTab('blank')` reopened the previous note before the intended Notes index could mount. After adding `removeTabWithoutFallback()` for direct-destination blank-tab actions, reran the flow successfully: created "Alpha" note tab, opened a blank tab, chose Notes, created "Beta" note tab, confirmed two `note:<id>` tabs, switched back to Alpha and saw title "Alpha", switched to Beta and saw title "Beta", reloaded, confirmed both note tabs restored and Beta remained active. Zero console/page errors. Disposable `:8796` server was stopped afterward.
- **Follow-up:** User will test in the desktop app. A final browser rerun after adding immediate note title/icon tab-label refresh was not approved; syntax checks cover that small polish addition. Manual delete-pruning test still recommended: delete a note with an open tab, reload, confirm the deleted note tab is gone.

## 2026-08-01 — Mind Garden icon sheet 145 → 251 icons — structural check + live headless Chromium — pass

- **Command category:** Python structural validation of the assembled `frontend/mind-garden-icons.html` (tag-balance counts, entry extraction mirroring the app's own parser logic, mojibake byte-sequence scan) + live headless Chromium (`playwright-core`, pointed at the machine's already-cached Playwright Chromium binary since neither `playwright` nor `chromium-cli` is installed in this repo) driving the real running `:8765` server.
- **Result:** pass
- **Output:** Structural check: 251/251 `<figure>`, `<svg>`, `<g>`/`<h2>`/`<section>` tags balanced; 251 entries extracted with unique non-empty ids; zero `Ã.`/`â€.`/`�` mojibake sequences left in the file. Live run: loaded `http://127.0.0.1:8765/frontend/index.html`, opened Notes, created a new page, clicked its `.pg-emoji` button to open the real `openEmojiPicker` popover. Typed into `.cp-emoji-search` and read `.mg-opt` result counts: "koi" → 1, "cricket" → 1, "devanagari" → 46, "hero" → 8, "valley" → 6, empty search → 251 total. Screenshotted the "devanagari" search results — all 46 reconstructed glyphs (अ आ इ ई उ ऊ ऋ ए ऐ ओ औ अं अः क ख ग घ ङ...) rendered as distinct, legible Devanagari characters in the correct vowel-then-consonant order, confirming the figcaption-based reconstruction was correct despite the source document's corrupted script text. DOM inspection: the `koi` button's `<svg>` had a 368-char non-empty `<g>` body; the `devanagariKa` button's `<svg>` contained a `<g><text ... fill="currentColor">क</text></g>` — confirming the `<g>`-wrapping fix was necessary and effective (the picker's `getMindGardenEntries()`/`renderIconSvg()` only surfaces entries with a `svg > g` match). `page.on('console'/'pageerror')` listeners captured zero new errors — the only console line logged was one pre-existing 404 for an unrelated resource, present on a clean load before this change and not something this task touched.
- **Follow-up:** None required — this is a static content addition (no loader/renderer/schema code changed) and it was verified against the actual running app end to end, not a synthetic harness. Optional, not blocking: the sheet's own print/PDF view (opening `frontend/mind-garden-icons.html` directly, as a human would to reprint the design doc) wasn't visually checked, since the app never renders that page itself — only `mind-garden.js`'s `DOMParser` pass over it, which the live run above exercises identically.

## 2026-08-01 — BUGS.md #042 (blank-tab Notes tile reset to index) — static check only — pass (manual smoke test pending)

- **Command category:** static (`node --check`) + video-frame repro analysis (ffmpeg extracted frames from the user's uploaded screen recording). No live-browser/Playwright run this session — sandboxed environment had no access to the running `:8765` app.
- **Result:** pass (static)
- **Output:** `node --check frontend/app.js` and `node --check frontend/views/notes.js` both clean after the fix. Repro confirmed purely from the screen recording: tabs `[chat, notes(Valley open), blank]` → click "Notes" tile in the blank tab → tabs collapse to `[chat, notes]` and the surviving Notes tab shows the 35-page index instead of "Valley." Fix (`openTab('notes')` instead of `openNotesIndex()` in the `#bte-notes` handler) traced against `mountView()`/`showOverlay()` in `frontend/views/notes.js`: `showOverlay()` only calls `renderIndex()` when `state.showIndex` is true or the selected note is gone, and the new path no longer sets `showIndex`, so the previously-selected note's page renders instead.
- **Follow-up:** A human needs to run the manual test case in `BUGS.md` #042 on the real running app (`Notlinear.app` or `python3 notlinear_server.py`) to confirm end to end, since this session couldn't drive the actual UI. Steps: open a subpage in Notes, open a blank tab, click its "Notes" tile, confirm the subpage is still showing (not the index).

## 2026-07-31 — Notes @-mentions + BUGS.md #041 (export subpage gap) — static check + headless Playwright — pass

- **Command category:** static (`node --input-type=module --check`) + headless Playwright (Node, local `playwright` install using the already-cached Chromium binary) driving the live `:8765` server, fresh throwaway browser context per script (isolated from the user's real browser/IndexedDB entirely).
- **Result:** pass
- **Output:** Syntax check clean on `frontend/views/notes.js`, `frontend/core/registry.js`, `frontend/app.js`. Drive script 1 (mentions): opened Notes via the sidebar (`#sidebar-toggle` slides it in — it starts off-canvas, off-screen click targets were the main early friction in scripting this), created a fresh note, typed `Hello @te` in its first text block — `#nt-mention.show` appeared with a "Chats" section and the real thread title; Enter inserted `<span class="nt-mention" data-kind="chat" data-id="doc-main">`; typed more text right after with no corruption; direct IndexedDB read (`notlinear-notes` → `kv` → `nl_notes_v1`) confirmed the chip's HTML was saved before reload; after `page.reload()` + reopening Notes + reselecting the note via the sidebar tree, the chip was still present and still clickable, and clicking it opened/focused the "Non-linear chat system for research" thread as a tab. Drive script 2 (note-mention nav + export fix): created "Parent Page" with body text, added "Child Subpage" via the sidebar row's "add subpage" button (deliberately not the in-content `/page` command, to isolate the tree-only path), created "Mentioner Page" that `@`-mentions "Parent Page" (popover correctly sectioned it under "Notes"); clicking the inserted note chip changed the visible page title from "Mentioner Page" to "Parent Page", confirming the mountView('notes')+selectNote(id) click-routing. Exported "Parent Page" with `page.route()` intercepting the `/__notlinear_save_file` POST (the real endpoint calls `osascript` for a native macOS save dialog, which hangs/no-ops headlessly) — captured `content` field showed `# Parent Page` / `Parent body text.` / `## Child Subpage` / `Child body text.`, confirming the sidebar-tree subpage is now included. Zero console/page errors across every run.
- **Follow-up:** None required — feature and bug fix both verified end to end against the real running app, not a synthetic harness. Optional human click-through: the visual feel of the popover position/animation and chip styling in both dark-mono and light themes (screenshots were reviewed during the session and looked correct, including one run that landed in dark theme, confirming the chip uses theme CSS variables rather than hardcoded colors).

## 2026-07-31 — BUGS.md #040 — headless Playwright (Python), live `:8765` server — pass

- **Command category:** headless Playwright (Python `playwright.sync_api`) driving the already-running `:8765` server, fresh throwaway browser profile per script (isolated from the user's real browser/IndexedDB entirely).
- **Result:** pass
- **Important output:**
  - Repro (pre-fix): Tab in `#main-input` after typing "hello" moved `document.activeElement` to `#main-attach-btn`; Tab in a Notes block after typing "hello" moved focus to `.nt-branch-cta-inp` — text stayed unchanged in both cases (focus moved, nothing inserted).
  - Post-fix, main input: typed "hello", Tab, typed "world" → value `"hello\tworld"`, `activeElement` stayed `main-input`.
  - Post-fix, feedback textarea (⌘⇧B): typed "abc", Tab, typed "def" → value `"abc\tdef"`. Zero console/page errors.
  - Post-fix, Notes indent: created a bullet "PM fam", Enter, typed "List", Tab → rendered DOM showed "List" nested inside "PM fam"'s new `.child-wrap.indent-children`.
  - Post-fix, Notes outdent: nested a second bullet "Nested2" under "PM fam" (alongside "List"), then Shift+Tab on "Nested2" → it popped back out to sit as a top-level sibling immediately after "PM fam"'s subtree.
  - Post-fix, no-sibling fallback: fresh page's first (only, plain-text) block, typed "hello", Tab, typed "world" → block text `"hello\tworld"`, focus stayed in the block's `.editor`.
  - Non-regression: `/head` slash-menu Tab-to-pick still converted the block to `b h1` as before.
  - Persistence: after creating a nested "Parent"/"Child" bullet pair and reloading, read `notlinear-notes`'s `kv` object store directly via `indexedDB.open()` → confirmed `nl_notes_v1`'s block tree still had `Child` under `Parent.children` post-reload.
- **Follow-up:** Coding Projects comment composer and the notes-branch-ask textarea use the identical shared `wireTabInsertsTab()` helper already verified above — not independently re-driven live (same code path, low risk). Optional human click-through for multi-level Shift+Tab and numbered-list renumbering across levels.
- **Gap in this pass, caught next:** The Notes indent check above only asserted on `innerHTML`/DOM nesting structure, never on rendered bounding boxes or a screenshot — so it missed a real CSS layout bug (flex-row squeeze, see follow-up run below) that only manifests visually, not in the DOM tree. The DOM was correctly nested the whole time; the *rendering* of that nesting was broken. Lesson: DOM-structure assertions alone are not sufficient verification for anything layout-related — a bounding-box check or screenshot is required whenever a change affects visual nesting/positioning.

## 2026-07-31 — BUGS.md #040 follow-up — CSS layout bug (child-wrap flex squeeze) — headless Playwright (Python), live `:8765` server — pass

- **Command category:** headless Playwright (Python), same live `:8765` server, fresh throwaway profile.
- **Result:** pass (after fix; failing repro confirmed first)
- **Important output:**
  - User reported the bug live on their own real note within minutes of the above run being marked "pass" — pressing Tab on a still-empty new bullet produced a large blank gap with a floating "Type '/' for commands" placeholder.
  - Repro (pre-fix): typed "PM fam", Enter, pressed Tab immediately (no typing on the new empty bullet — the exact sequence the DOM-only check above didn't try). `getBoundingClientRect()` on the two blocks: parent `{x:474, w:652}`, child `{x:1067.5, w:58.5}` — child squeezed into a sliver well to the right of the parent's row, not stacked below it, despite being correctly nested in the DOM (`.child-wrap.indent-children` contained the right block).
  - Root cause confirmed via CSS inspection: `.nt-screen .b{display:flex}` (`frontend/styles/notes.css:178`) has no `flex-wrap`; `.content{flex:1}` and `.child-wrap` are flex-row siblings, so `.child-wrap` gets squeezed into `.content`'s leftover space instead of wrapping to its own line.
  - Post-fix (`.b{flex-wrap:wrap}` + `.b .child-wrap{flex:0 0 100%}`): same repro now gives parent `{x:474,y:354,w:652}`, child `{x:500,y:392,w:626}` — correctly indented 26px, positioned directly below, full width.
  - Re-ran the full indent/outdent/fallback/persistence/slash-menu matrix from the run above — all still pass after the CSS change.
  - New check: added a child to a `toggle` block via its "empty — click to add" affordance (pre-existing feature, not part of this bug fix) — before the CSS fix this had the identical squeeze bug (confirmed), after the fix it renders full-width directly below the toggle's own line at `{x:501,y:392,w:625}`. This is a real fix to a previously-unnoticed toggle bug, not just a fix for the new indent feature.
  - Full-page screenshot reviewed: three-bullet note (`PM fam` / `Architect family of agents` nested / `Memory and context` outdented back to top level) renders cleanly with correct indentation and no gaps.
  - Zero console/page errors throughout.
- **Follow-up:** None outstanding. `BUGS.md` #040 was amended in place to include this (not filed as a new bug number) since it was found while the same fix was still being verified, before it was genuinely complete.

## 2026-07-31 — TASK-NT09 / BUGS.md #039 — headless Playwright (Python), live `:8765` server — pass

- **Command category:** headless Playwright (Python `playwright.sync_api`, browsers already installed at `~/Library/Caches/ms-playwright`) driving the already-running `:8765` server across four scripted passes, fresh throwaway browser profile each time (user's real IndexedDB notes untouched).
- **Result:** pass
- **Important output:**
  - Repro (pre-fix): dragging from block 1 into block 3 of a 3-block note copied only `"First block of text for testing selection."` — confirmed both via a real mouse drag and via a JS-constructed cross-host `Range` assigned through `Selection.addRange()` (also clamped to block 1) — establishing this is a Chromium editing-host restriction, not a listener bug.
  - Post-fix: same drag now paints `.bsel` on all 3 blocks and `⌘/Ctrl+C` clipboard read back `"First block...\nSecond block...\nThird block..."` in order.
  - Regression checks: drag confined to one block → native selection only (`bsel` count 0); 2-of-3 partial drag range → exactly 2 blocks highlighted, clipboard has exactly those 2 blocks' text, highlight clears after the copy; existing double-`⌘A`-then-`⌘C` whole-page path → all 3 blocks highlighted and copied, unaffected by the generalization from `blockSelAll` to `blockSelIds`.
  - Export: created "Parent Note" with a paragraph, inserted a real subpage via the `/page` slash command (not a stub), clicked `#nt-export-btn` with `**/__notlinear_save_file` intercepted at the network layer (`page.route`, fulfilled locally so no real macOS Save dialog fired against the backend). Captured request: `filename: "Parent Note.md"`, body starting `# Parent Note`, containing the intro paragraph, the in-body `📄 [New page](#new-page)` link, a `---` section break, and `## New page` for the subpage section — matching the recursive-subpage design in ADR-024.
  - Zero `pageerror` console events across all four passes (last two passes clean; two earlier iterations while landing the fix did surface a `clearBlockSel is not defined` `pageerror` — an accidental deletion of that function during an edit, caught by this exact test and fixed before the final passing run).
- **Follow-up:** Human GUI click-through recommended, especially: drag-select via a real trackpad, and opening the exported `.md` in an actual Markdown viewer to confirm image rendering (no image block was exercised in the automated pass — image embedding is straightforward string interpolation of the block's already-working `b.src` data URL, judged low-risk enough not to block on, but worth an eyeball). Separately: this session's testing briefly took down the **pre-existing** `:8765` server that the user's already-open `Notlinear.app` depends on (an accidental `pkill`, not a server started for this session) — it was restarted on the same port immediately and the user was told directly; worth a mention here in case the desktop app shows any transient connection blip in its own logs around that time.

## 2026-07-31 — Notes bento-grid home page (TASK-NT02 follow-up) — node --check + headless Playwright, live `:8765` server — pass

- **Command category:** static (`node --check`) + headless Playwright (Node, installed to scratchpad for this session) against the already-running `:8765` server, fresh in-memory browser profile (user's real IndexedDB notes untouched)
- **Result:** pass
- **Important output:** `node --check frontend/views/notes.js` clean. Drive script seeded 3 notes ("Meeting notes"/"Kickoff agenda", "Product ideas"/"Onboarding tweak", "Random thoughts"/"Just jotting things down") — bento card count 3, featured card present, card order newest-first ("Random thoughts" first as last-created), preview snippets matched each note's body text, meta lines read real e.g. "1 block · just now" instead of blank. Grid `gridTemplateColumns` column count went 4 at 1400px → 2 at 700px (auto-adjust confirmed, no JS breakpoint needed). Clicked into the oldest note ("Meeting notes"), appended text, returned to the grid — it moved back to first place and its preview updated to include the new text. Opened a fresh single note and confirmed `.pg-meta` now renders a real `timeAgo()`-computed "updated just now" instead of the previously hardcoded string. Zero console/page errors across the entire flow. Screenshots reviewed at both 1400px and 700px widths.
- **Follow-up:** Human GUI click-through recommended (create/edit/resize by hand) before treating this as fully done, though automated coverage above is thorough. No regressions expected in sidebar tree, branch chat, or drag-reorder — none of their `save()` sites were touched in a way that changes their existing behavior, only added a timestamp bump alongside the existing save.

## 2026-07-31 — Bento corner-bloom icon color + tint — node --check + headless Playwright (real icon picker), live `:8765` server — pass

- **Command category:** static (`node --check`) + headless Playwright driving the real Mind Garden icon picker UI (not a stub) against the already-running `:8765` server, fresh in-memory browser profile
- **Result:** pass
- **Important output:** `node --check frontend/views/notes.js` clean. Drive script opened `.pg-emoji`, typed into `.cp-emoji-search`, and clicked the first `.mg-opt` to assign real icons (mountain/wave/key) to notes created through the actual UI (including clicking `.pg-title` back into focus afterward — the picker steals focus, first pass without that fix produced empty titles, a test-harness bug not a product one, caught and fixed before trusting the result). `getComputedStyle(.nt-bento-item).backgroundColor` and `getComputedStyle(.nt-bloom svg).stroke` both matched the exact expected RGB for each icon's hashed tint (e.g. `icon:mountain` → `rgb(236,231,245)` bg / `rgb(107,90,150)` stroke, matching `--bento-t4-bg/-fg` exactly), with real variation across different icons. Sort-by-recency and edit-triggers-reorder re-verified unaffected (edited "Meeting notes" → jumped back to first place). Flipped `data-theme` across all three app themes (dark-mono default, grey, light) without any re-render and confirmed the tint/bloom colors updated correctly each time (pure CSS-variable reactivity, as designed — no JS re-render needed on theme switch). Zero console errors throughout. Screenshots reviewed in all three themes.
- **Follow-up:** None outstanding. Variant A/B artifact mockups (tinted badge, icon-print wallpaper) were explored and rejected in favor of C during this session — not implemented, no follow-up needed unless revisited later.

## 2026-07-31 — Bento tint lighten + drop preview subtext — node --check + headless Playwright, live `:8765` server — pass

- **Command category:** static (`node --check`) + headless Playwright against the already-running `:8765` server, fresh in-memory browser profile
- **Result:** pass
- **Important output:** `node --check frontend/views/notes.js` clean. `--bento-t*-bg` values recomputed via a lerp-toward-ground blend (45% white for light theme, 40% `--surface` for dark-mono/grey) — spot-checked the math, values land clearly lighter than before while `-fg` stayed untouched. Created a live "Himalayan Retreat" / mountain-icon note through the real picker and confirmed the card renders with the new subtler tint, the corner bloom, and **no** preview subtext line — `$$eval('.nt-ix-preview', els => els.length)` returned 0 across the grid. Layout intact (no gap left behind by the removed element). Zero console errors. Screenshot reviewed.
- **Follow-up:** None outstanding.

## 2026-07-26 — Product story fullscreen player fixes — headless Playwright, live `:8765` server — pass

- **Command category:** headless Playwright (Python) screenshot/interaction against the already-running `:8765` server (read-only, no writes)
- **Result:** pass
- **Important output:** Before fix, opening the player and reproducing the reported frame showed `Update 8 of 41 · 2026-05-24` (oldest-first) with low-contrast item chips and heavily-rounded top segments — matched the user's screenshot exactly. After fix: opening the player shows `Update 1 of 41 · 2026-07-26` (today, newest chapter); re-navigated to the same `2026-05-24` frame and confirmed item chips now have a clearly visible pill boundary; top segments render as thin ticks.
- **Follow-up:** None — user-reported issue, verified end-to-end live.

## 2026-07-26 — Bug #031 (Branches canvas vs. Hierarchy mismatch) — headless Playwright E2E — pass

- **Command category:** static (`node -c`) + headless Playwright E2E against a disposable server on a separate port
- **Result:** pass
- **Output:** `node -c frontend/app.js` clean. Installed Playwright + Chromium locally under the session scratchpad (not committed to the repo — not a project dependency) and ran `backend/server.py --port 8799` as a throwaway instance so the test's IndexedDB (origin-scoped by port) never touched the user's real `:8765` data. Drove the actual UI: selected real doc text and clicked the selection popover's "Branch" button to create a root branch (real `openBranch`/`wrapBranched` code path, not a mock); injected synthetic assistant text into that branch's `.branch-body` (removing the `.empty` class the same way `syncBranchEmpty` does) purely so there was real, selectable text inside the panel, then selected from it and clicked "Branch" again to create a nested child branch; created a second root branch the same way as the first. Reloaded the page — this clears the live in-memory `branches` object (0 open panels after reload, confirmed) while doc HTML / snapshots / recents persist, exactly the condition from the user's bug report. Result: Hierarchy panel and the Branches canvas both showed the same 5 branches (3 created + 2 pre-existing seed anchors already in the default doc's static content), the canvas correctly offset the nested branch one depth column to the right ("Sub-branch" tag vs. "Branch" for the 4 root-level ones), and drew exactly 5 connector edges (one per non-root card) — before this fix the canvas would have shown only whichever branches happened to still be open. Zero console/page errors during the run.
- **Follow-up:** This exercised a fresh/synthetic thread, not the user's actual persisted data — recommend the user reload their real thread once and confirm the Branches canvas now matches Hierarchy there too. Test artifacts (scratchpad Playwright install, throwaway `:8799` server) cleaned up / not part of the repo.

## 2026-07-26 — TASK-NT08 (video/audio embed + file attachment + bookmark + generic embed) — static + endpoint curl + headless boot — pass

- **Command category:** test (Python syntax check + JS syntax check + local server + direct endpoint curl + headless boot check)
- **Result:** pass
- **Output:** `python3 -m py_compile backend/server.py` clean. `node --check frontend/views/notes.js` clean. Restarted `python3 backend/server.py` on :8765; `curl` confirmed `frontend/index.html`/`notes.js`/`notes.css` HTTP 200. Direct `curl -X POST /__notlinear_link_preview -d '{"url":"https://example.com"}'` → correct `{ok:true, title:"Example Domain", ...}` (first attempt returned a mangled `favicon` value — fixed a bug where a site's `data:,` favicon-suppression tag was being treated as a relative path and prefixed with the domain; re-run confirmed correct `data:,` passthrough); a second real site (github.com) returned a correct absolute favicon URL too. `curl` with `{"url":"not-a-url"}` and `{"url":"file:///etc/passwd"}` both correctly returned `{ok:false,"error":"url must be http(s)"}`, no server error. Spot-checked the existing `/__notlinear_scan_project` endpoint still returns correct data (no regression). Headless Chrome (`--headless=new --dump-dom`) boot check: exit 0, 882-line DOM dump, `#nt-side-head` present, no `Uncaught`/`SyntaxError`/`ReferenceError`/`TypeError` in the console log.
- **Follow-up:** Confirms backend logic + boot/parse correctness, not the interactive block behavior (paste each media-URL variant and confirm correct embed/native-player/fallback; attach a file above and below the 5MB cap; bookmark a real and a failing/timeout URL; embed a Figma/CodePen/Maps link and confirm an unrecognized one falls back to a bookmark). Human GUI smoke test needed before this task is fully verified. Left the :8765 test server running in the background from this session.

## 2026-07-25 — TASK-NT06 (page cover image + custom image page icon) — static + headless boot — pass (interactive GUI pending)

- **Command category:** test (syntax check + local server + headless boot check)
- **Result:** pass (static/boot only)
- **Output:** `node --check frontend/views/notes.js` clean. `python3 backend/server.py` still running on :8765; `curl` confirmed `frontend/index.html`, `frontend/views/notes.js`, `frontend/styles/notes.css` all HTTP 200. First headless Chrome (`--headless=new --dump-dom`) attempt returned Chrome's own connection-error page instead of the app (transient race, not reproducible — `curl` succeeded immediately before and after); a clean re-run right after: exit 0, 803-line DOM dump, `#nt-side-head` present, no `Uncaught`/`SyntaxError`/`ReferenceError`/`TypeError` in the console log.
- **Follow-up:** Confirms boot/parse correctness only, not the interactive behavior (add/reposition/change/remove a cover photo, upload/remove a custom image page icon and confirm it renders at every icon site — sidebar row, index card, page header, breadcrumb — plain-emoji and Mind-Garden `icon:` tokens on other notes staying unaffected). Human GUI smoke test needed before this task is fully verified. Left the :8765 test server running in the background from this session.

## 2026-07-25 — TASK-NT05 (drag-to-nest + duplicate page + drag-to-reparent) — static + headless boot — pass (interactive GUI pending)

- **Command category:** test (syntax check + local server + headless boot check)
- **Result:** pass (static/boot only)
- **Output:** `node --check frontend/views/notes.js` clean. Restarted `python3 backend/server.py` on :8765 (stopped again between sessions); `curl` confirmed `frontend/index.html`, `frontend/views/notes.js`, `frontend/styles/notes.css` all HTTP 200. Headless Chrome (`--headless=new --dump-dom --enable-logging=stderr`) boot check: exit 0, 864-line DOM dump, no `Uncaught`/`SyntaxError`/`ReferenceError`/`TypeError` in the console log.
- **Follow-up:** Same caveat as prior NT phases — confirms boot/parse correctness only, not the interactive drag behavior (block nest-zone drop, page duplicate with subpages, sidebar reparent onto a row / onto blank space, circular-reparent block). Human GUI smoke test needed before this task is fully verified. Left the :8765 test server running in the background from this session.

## 2026-07-25 — TASK-NT04 (code syntax highlighting + LaTeX) — static + headless boot — pass (interactive GUI pending)

- **Command category:** test (syntax check + local server + CDN reachability + headless boot check)
- **Result:** pass (static/boot only)
- **Output:** `node --check frontend/views/notes.js` clean. Restarted `python3 backend/server.py` on :8765 (had stopped since the NT03 session); `curl` confirmed `frontend/index.html`, `frontend/views/notes.js`, `frontend/styles/notes.css` HTTP 200, plus `katex.min.css`, `katex.min.js`, `highlight.min.js` all 200 directly from jsdelivr. Headless Chrome (`--headless=new --dump-dom --enable-logging=stderr`) boot check: exit 0, 848-line DOM dump, no `Uncaught`/`SyntaxError`/`ReferenceError`/`TypeError` in the console log, new `data-cmd="eq"` toolbar button markup present.
- **Follow-up:** Same caveat as TASK-NT03's run — this confirms boot/parse correctness only, not the interactive behavior (live/on-blur code highlighting, no-layout-shift language switch, valid/invalid LaTeX rendering in an equation block, toolbar Σ → inline equation → click-to-edit → reload persistence). Human GUI smoke test needed before this task is fully verified. Left the :8765 test server running in the background from this session.

## 2026-07-24 — TASK-NT03 (image URL support + table of contents) — static + headless boot — pass (interactive GUI pending)

- **Command category:** test (syntax check + local server + headless boot check)
- **Result:** pass (static/boot only)
- **Output:** `node --check frontend/views/notes.js` clean. Started `python3 backend/server.py` on :8765; `curl` confirmed `frontend/index.html`, `frontend/views/notes.js`, `frontend/styles/notes.css` all HTTP 200. No Playwright/puppeteer package available in this session, so ran `/Applications/Google Chrome.app` headless (`--headless=new --dump-dom --enable-logging=stderr`) against `frontend/index.html` instead: exit 0, 789-line DOM dump containing `#nt-side-head` and `.nt-screen`, no `Uncaught`/`SyntaxError`/`ReferenceError`/`TypeError` in the console log (only Chromium-internal histogram/component noise).
- **Follow-up:** This confirms the app still boots with the new code and the module parses/executes without throwing — it does **not** confirm the interactive behavior (slash-pick `/table of contents`, paste-URL prompt flow, drag-drop of a URL, a 404 image falling back cleanly, the resize handle persisting width across reload, the TOC updating live while typing a heading without losing caret focus, or click-to-scroll). Human GUI smoke test needed for those before this task is fully verified — same caveat pattern as TASK-NOTES-03/TASK-NT01/TASK-NT02. Left the :8765 test server running in the background from this session.

## 2026-07-25 — TASK-RD09 revision (Notion-style per-thread tabs + localStorage persistence) — static + headless Playwright incl. real reloads — pass (3 bugs caught + fixed)

- **Command category:** test (syntax check + local server + headless browser drive, with real `page.reload()` round-trips — the class of check that caught all 3 bugs here)
- **Result:** pass, after 3 fix iterations
- **Output:** `node --check frontend/app.js` clean. Opened 3 threads (main + pricing + onboarding) plus Notes as tabs — 4 tabs shown correctly. First reload attempt showed only 1 tab (bug 1: threadState-existence filter dropping never-persisted lightly-visited threads) — fixed via `deletedThreadIds` filter, re-test showed all 4 tabs restored but **zero marked active** (bug 2 uncovered: `renderTabStrip()`'s boot-time pre-restore call was wiping the just-saved localStorage via its own unconditional `saveTabs()`) — fixed by moving persistence to the actual mutation points; re-test still showed zero active tab (bug 3: `syncThreadTab`/`mountView('chat')` call order inside `renderThread` meant the active-tab check ran against stale registry state) — fixed by reordering. Final re-test: 4 tabs restored correctly with "Onboarding flow review" correctly marked active (the last-viewed thread); clicking another tab correctly switched active state; created a real new chat via the sidebar "New chat" button — became its own 5th tab, thread count 4→5; second reload restored all 5 tabs with the new chat correctly marked active; closed a non-active tab — correctly removed without disturbing the active one; created a real branch on the main thread afterward — succeeded with zero errors. Zero console/page errors across every pass.
- **Follow-up:** This is the class of bug same-session testing structurally cannot catch — noted in ADR-022 as a standing lesson (matches the RD07 `updatedAt` persistence bug from earlier the same day: any new localStorage/IndexedDB-backed state needs an actual reload test, not just in-session interaction checks). Stopped the :8765 test server after the run.

## 2026-07-25 — TASK-RD09 (tab strip) — static + headless Playwright incl. cross-entry-point sync + branch regression — pass

- **Command category:** test (syntax check + local server + headless browser drive, specifically testing that a pre-existing, unmodified navigation entry point stays in sync with new tab-strip state)
- **Result:** pass
- **Output:** `node --check` clean on `frontend/app.js` and `frontend/core/registry.js`. Server on :8765. Playwright: initial tab strip showed only "Doc"; opened the "+" add-menu (listed "Notes"/"Coding projects"); clicked Notes — tab strip showed `['Doc','Notes']` and `#nt-screen` gained `.show`; switched to the Doc tab — `#nt-screen` lost `.show`, active tab correctly read "Doc"; **clicked the sidebar's `#nt-side-head` Notes header directly (not through the tab strip)** — tab strip correctly re-synced to `['Doc','Notes']`, confirming the `onViewChange` registry subscription keeps every pre-existing call site in sync without modification; closed the Notes tab via its `[data-tab-close]` — tabs returned to `['Doc']`, active tab "Doc"; confirmed `[data-tab-close="chat"]` doesn't exist (Doc is correctly non-closable/pinned); opened Coding Projects via the tab menu — `#cp-screen` gained `.show`, re-opening the add-menu showed "Coding projects (open)" disabled. **Regression check:** after the full tab-interaction sequence, double-click-selected doc text and created a real branch via `#pop [data-act="branch"]` — succeeded with a real bid, confirming zero impact on chat/branch functionality. Zero console/page errors across every step.
- **Follow-up:** Human GUI smoke recommended, all 3 themes. This closes out `redesign_product.md`'s TASK-RD00–RD09 (RD01 superseded into RD02) — recommend a full manual pass before calling the redesign rollout complete. Stopped the :8765 test server after the run.

## 2026-07-25 — TASK-RD08 (spatial branch canvas) — static + headless Playwright incl. real branch exercise — pass

- **Command category:** test (syntax check + local server + headless browser drive, creating a real branch through the actual selection popover, not synthetic state)
- **Result:** pass
- **Output:** `node --check frontend/app.js` clean. Server on :8765. Playwright: double-click-selected text in `#doc p`, clicked `#pop [data-act="branch"]` to create a real branch (`b1784969014263`). Opened `#branch-canvas` via the new toolbar button — `#bc-count` read "1 branch", 2 `.bc-node` elements rendered (doc + the branch), 1 SVG edge path. Clicked the branch node: canvas closed, and the branch panel's own `style.zIndex` became `3` with no `.behind-active` class — confirming `appState.activeBranchId` was correctly updated via the reused `openBranch({bid})` call. Reopened the canvas, clicked the doc node: canvas closed, branch still present and unaffected. Escape closed an open canvas. A real mouse drag (move→down→move→up) on the canvas background changed `#bc-plane`'s transform from `translate(60px,40px)` to `translate(120px,80px)`, confirming pan works and clicks on nodes aren't swallowed as drags. Zero console/page errors across the entire sequence.
- **Follow-up:** Human GUI smoke recommended — a deeper nested-branch tree (branch-on-branch) wasn't exercised headlessly (selecting text inside a freshly-created empty branch's quote area didn't trigger the selection popover in this session, likely needs real body text from a live API response); all 3 themes not visually checked. Stopped the :8765 test server after the run.

## 2026-07-25 — TASK-RD07 (Projects grid + detail restructure) — static + headless Playwright incl. real reload — pass (1 bug caught + fixed)

- **Command category:** test (syntax check + local server + headless browser drive, including an actual page reload to test persistence)
- **Result:** pass, after fixing one bug found during verification
- **Output:** `node --check` clean on `frontend/app.js` and `frontend/core/store.js`. First pass (same session): created 2 projects, opened `#projects-view` (2 cards rendered), search "New project 2" → 1 match, sort by Name → correct alphabetical order, clicked a card → grid closed + `#project-panel` opened with exactly 3 `.project-card-head` sections ("Chats in this project"/"Project rules"/"Project files"), renamed inline with no errors — zero console errors. **Second pass (real reload):** created + renamed a project, pressed Escape, waited for the `persistAll()` debounce, called `page.reload()`, reopened the grid — card showed "Updated just now" confirming `updatedAt` survived the round-trip through IndexedDB. This second pass initially failed (showed "Updated —") before the fix: `core/store.js`'s `loadPersistedState` rebuilds each saved project via an explicit field allowlist that didn't include the new field. Fixed by adding `updatedAt: sp.updatedAt || 0` to that allowlist; re-ran the reload test and it passed.
- **Follow-up:** Human GUI smoke recommended (all 3 themes, visual polish). Note for future project-field additions: same-session Playwright checks are not sufficient to catch persistence round-trip bugs in this codebase — `loadPersistedState`'s explicit allowlists mean a new field must always be tested with a real `page.reload()`, not just in-session state. Stopped the :8765 test server after the run.

## 2026-07-25 — TASK-RD06 (Product story chaptered UI + player) — static + headless Playwright — pass

- **Command category:** test (syntax check + local server + headless browser drive against the real, unmodified CHANGELOG.md)
- **Result:** pass
- **Output:** `node --check frontend/app.js` clean. Server on :8765, `index.html` HTTP 200. Playwright: opened Settings → View changelog, confirmed 30 `.story-dot` chapters parsed from the real file, newest chapter dated 2026-07-24 with correct narrative/item text; clicked Older, date correctly advanced to the next entry (`2026-07-24 (4)`); clicked "Play the story," confirmed the player opened at the oldest chapter (2026-05-08) with 30 progress segments and correct meta text ("Update 1 of 30 · 2026-05-08"); clicked Next 30 times, confirmed the player advanced through every chapter and auto-closed exactly on the 30th click, with the Next button showing a checkmark icon just before close; zero console/page errors across the whole run.
- **Follow-up:** Human GUI smoke recommended for visual polish (hero-icon animation feel, all 3 themes for the inline card, dark player look). Stopped the :8765 test server after the run.

## 2026-07-24 — TASK-RD05 (Settings centered modal) — static + headless Playwright — pass

- **Command category:** test (syntax check + local server + headless browser drive)
- **Result:** pass
- **Output:** `node --check frontend/app.js` clean (no JS touched). Server on :8765, `index.html` HTTP 200. Playwright: opened Settings via `#open-prefs`; `#prefs` bounding rect confirmed centered in a 1400×900 viewport (`x:380,y:81,w:640,h:738` — horizontally and vertically centered); all 12 real `.prefs-label` section headings still present (Appearance through Runtime logs); `#scrim` shown; scrim click closed the modal; zero console/page errors.
- **Follow-up:** Human GUI smoke recommended for all 3 themes and the internal-scroll feel with the full settings list. Stopped the :8765 test server after the run.

## 2026-07-24 — TASK-RD04 (floating Highlights/Context panels) — static + headless Playwright — pass

- **Command category:** test (syntax check + local server + headless browser drive)
- **Result:** pass
- **Output:** `node --check frontend/app.js` clean (no JS touched). Server on :8765, `index.html` HTTP 200. Playwright: clicked the real `[title="Highlights"]` and `[title="Context"]` toolbar buttons — both panels report computed `top:64px;right:16px;bottom:16px;border-radius:12px` and `.show` class present; clicked `#highlight-scrim` and confirmed the panel's `.show` class was removed (existing click-outside-to-close JS still works with the now-transparent scrim); zero console/page errors throughout.
- **Follow-up:** Branch-reply-panel portion of this task deferred, not built (see ADR-016) — no branch code touched, so no branch Fragile-area re-verification was needed for this run. Human GUI smoke recommended for visual polish (drop shadow, all 3 themes). Stopped the :8765 test server after the run.

## 2026-07-24 — TASK-RD03 (new-chat button treatment + ⌘N) — static + headless Playwright — pass

- **Command category:** test (syntax check + local server + headless browser drive)
- **Result:** pass
- **Output:** `node --check frontend/app.js` clean. Server on :8765, `index.html` HTTP 200. Playwright: `#new-chat` has class `new-chat-btn` and computed `background-image` is the expected gradient; simulated Cmd+N (`keyboard.down('Meta')` + `press('n')`) increased sidebar thread-row count from 4 to 5, confirming the new global shortcut actually calls `startNewChat()` and not just a visual hint; zero console/page errors.
- **Follow-up:** Human GUI smoke recommended for the hover-lift feel and all 3 themes. Stopped the :8765 test server after the run.

## 2026-07-24 — TASK-RD02 (default hand-drawn icons) — static + headless Playwright — pass

- **Command category:** test (syntax check + local server + headless browser drive)
- **Result:** pass
- **Output:** `node --check frontend/app.js` clean. Started `python3 backend/server.py` on :8765; `curl` confirmed `frontend/index.html`, `frontend/app.js`, `frontend/mind-garden-icons.html`, `frontend/styles/tokens.css` all HTTP 200. Playwright's Chromium wasn't cached in this environment — ran `python3 -m playwright install chromium` first. Headless pass: zero console/page errors on load and after opening a new chat. First pass surfaced a bug (all 4 seed thread rows resolved to icon index 0/branch since the hardcoded `index.html` rows have no `dataset.iconIndex`) — fixed via a `threadIconIndex(id)` fallback computed from `STATIC_THREAD_IDS` order. Re-run confirmed all 4 distinct: `doc-main`→`#58A6FF` (branch), `pricing`→`oklch(48% 0.08 195)` (compass), `onboarding`→`oklch(50% 0.10 145)` (roots), `planning`→`oklch(55% 0.13 25)` (star); a freshly-created chat thread shows its default icon immediately (no reload needed).
- **Follow-up:** Human GUI smoke test still recommended — confirm icons render correctly in all three themes (dark/grey/light) and that project-row cycling looks right with 2+ real projects (not exercised headlessly due to a viewport/sidebar-position quirk in the headless run, unrelated to this change). Stopped the :8765 test server after the run.

## 2026-07-15 — Bug #038 — static checks + headless Playwright nested-reader repro — pass

- **Command category:** test (static syntax checks + real browser drive against the running `:8765` server)
- **Result:** pass — reproduced the stuck nested-reader layering state and verified the fix
- **Output:** `python3 -m py_compile backend/server.py` clean; `node --check frontend/app.js` clean. Playwright flow: create a parent branch from doc text, inject selectable branch-body text, expand the parent into reader mode, create a child branch from inside that parent, then inspect branch classes/z-index. Pre-fix reproduction showed the parent as `.branch.expanded.reader.user-sized.behind-active` with `z-index:60` while the child was active with `z-index:3`, so the child sat under the fixed reader parent. Post-fix: after child creation, parent is `.behind-active` but no longer `.reader` and is `z-index:2`; child is active at `z-index:3`. Clicking the child expand button makes the child `.reader` at `z-index:60` and the parent `.reader-eclipsed` behind it. Zero page errors.
- **Follow-up:** Full AGENTS.md smoke test still needs human/API-key/native-picker coverage; this run covered the reported branch-on-branch reader bug and static syntax only.

## 2026-07-10 — Bug #037 — live headless Playwright drive — repro confirmed, fix verified

- **Command category:** test (real browser drive against a fresh `:8765` server; static `node --check` for syntax)
- **Result:** pass — bug reproduced pre-fix, confirmed resolved post-fix, no regressions found
- **Output:** Started `python3 backend/server.py`, drove with Python `playwright` (sync API, headless Chromium; no `chromium-cli`/node-playwright present, but the `playwright` pip package + a cached Chromium build were already on the machine). Pre-fix: created branch A from `#doc-content` via the selection popup (`#pop [data-act="branch"]`), sent a message, created branch B from inside A's `.branch-body` (child branch), then clicked B's `[data-h="reader"]` (Expand). Screenshot (`/tmp/nl_20_front_expanded.png`) showed branch A detached into a floating blurred fragment below/beside B — matches the user's reported screenshot exactly. Post-fix (`layoutBranches` ancestor exclusion + `reader-eclipsed` class): re-ran the same script — branch A fully hidden while B is expanded (screenshot `/tmp/fix_01_expanded.png`), correctly restacks on un-expand (`/tmp/fix_02_unexpanded.png`). Extended to 3-level nesting (grandparent → parent → child, `/tmp/fix_10_three_level_expanded.png`) — both ancestors correctly eclipsed, zero console/page errors across every run. `node --check frontend/app.js` clean.
- **Follow-up:** Not covered by this session: the "Back to parent branch" navigation path when the stack is tall enough to overflow the viewport (pre-existing, unrelated layout behavior — noted in CHANGES.md as a possible future bug, not fixed here per scope discipline). Full `AGENTS.md` smoke-test checklist (API-key-dependent items, native pickers) not re-run — out of scope for this targeted fix.

## 2026-07-09 — Bugs #026/#027/#029/#030/#032/#033/#034 + #036 — live headless Playwright drive — pass (7/7) + 1 regression found & fixed

- **Command category:** test (real browser drive against the running `:8765` server, not static analysis)
- **Result:** pass on all 7 re-tested items; found and fixed a new regression (#036)
- **Output:** Python Playwright (`sync_api`, headless Chromium; node-playwright/`chromium-cli` not installed) drove the app end to end: opened the sidebar (`#sidebar-toggle`, closed by default), created a Notes page, measured `.pg-title` vs first block `x` offset (374px both — #029 pass), typed multiple blocks and confirmed 3 drag grips present (#033), confirmed placeholder `::before` content is `'Type \'/\' for commands'` only while focused and `none` once blurred (#034), confirmed `.side-scroll` computed `overflow-y: auto` (#030), confirmed second ⌘A selected all blocks via `.bsel` count (#032), opened `.pg-emoji` → `.cp-emoji-pop` and made a selection (#026), clicked `#new-chat` and confirmed `#nt-screen` lost its `.show` class (#027). While testing #031, found the ctx-ranking popover did not close on Escape and the console showed `pageerror: pendingDeleteConfirm is not defined` on every Escape/Enter press — root-caused to app.js referencing private core/ui.js variables. Fixed (bug #036); re-drove the same Escape test post-fix: zero `pageerror`s, popover `display:none`, sidebar `.open` class removed.
- **Follow-up:** Still not live-tested: TASK-FB01/02/03 native-picker area-capture flows (macOS `screencapture -i`/`-v -i`, can't run headlessly), TASK-NT01 (Notes comments), TASK-NT02 (Notes index view), TASK-CP08 (markdown grid), TASK-CTX01-03 (needs a real DeepSeek key). Entire batch is still uncommitted in the working tree.

## 2026-06-04 — TASK-NT01 — static + boot smoke — pass (GUI click-through pending)

- **Command category:** test
- **Result:** pass (automated); interactive GUI smoke pending
- **Output:** `node --check frontend/views/notes.js` clean. `backend/server.py` on :8765 returned HTTP 200 for `frontend/index.html`, `frontend/views/notes.js`, and `frontend/styles/notes.css`; the new `#nt-comments` popover div is present in the served HTML and in the post-JS rendered DOM (headless Chrome `--dump-dom`). Headless Chrome boot console showed only Chrome-internal noise (IPH/histograms/signin) — no page/module JS errors (`SyntaxError`, `is not defined`, `Uncaught`, module load failures).
- **Follow-up:** Human GUI click-through still needed: select text → Comment → highlight + popover → Send reply → reload persists → delete anchor text prunes thread + badge updates → confirm code blocks reject comments. Regression: chat send + branch create/reopen unaffected (chat `notlinear` db untouched).

## 2026-06-01 17:41 IST — Bug #027 — static + browser smoke — pass

- **Command category:** test
- **Result:** pass
- **Output:** `node --check frontend/app.js` clean. Reproduced on local server :8795: with Notes visible, New chat changed the active thread but `#nt-screen` stayed visible. After the fix, served on fresh port :8796 to avoid browser module cache: Notes -> New chat produced `activeNotes:false`, selected the new chat, and showed `#doc h1` as `Untitled chat`; Notes -> Threads `doc-main` produced `activeNotes:false`, selected `doc-main`, and showed `Non-linear chat for research`.
- **Follow-up:** Full AGENTS.md smoke still needs human/API-key verification for Claude/DeepSeek, native file/folder picker, search-backed branch answer, runtime log sync, and update-refresh. The reported thread-opening bug is covered.

## 2026-06-01 16:35 IST — TASK-CP08 — static + scan + UI verification — pass

- **Command category:** test
- **Result:** pass
- **Output:** `node --check frontend/views/coding-projects.js` clean; `python3 -m py_compile backend/server.py` clean. Direct `scan_project('/Users/yash/Downloads/notlinear')` returned `ok:true`, `markdownCount:19`, `truncated:false`; sample paths included `AGENTS.md`, `BUGS.md`, `CHANGELOG.md`, `MIGRATION.md`, `README.md`, and `docs/project-notes/CHANGES.md`. Headless Playwright smoke on local server :8794 rendered `19 md files · 3/4 convention docs · 0 open bugs`, showed 19 `.cp-file-cell` entries, and opened `/Users/yash/Downloads/notlinear/docs/project-notes/CHANGES.md` in the drawer with no console/page errors. First Playwright launch needed escalation outside the sandbox; first actionability click hit an off-viewport sidebar item, then the DOM-click smoke passed.
- **Follow-up:** Human can still do a visual pass in the app window, and the full AGENTS.md Claude/branch/native-picker smoke remains a separate human/API-key pass. Automated local UI coverage for the requested Files section passed.

---

## 2026-05-28 16:21 IST — Bug #026 / TASK-NOTES-03 — static + served-file verification — pass (GUI pending)

- **Command category:** test
- **Result:** pass (static + HTTP); GUI pending
- **Output:** `node --check frontend/views/notes.js`, `node --check frontend/app.js`, and `node --check frontend/core/emoji.js` clean. Local backend started on :8793 because :8765 had an existing listener that did not accept sandbox curl. With elevated localhost curl permission, `/frontend/index.html`, `/frontend/views/notes.js`, and `/frontend/core/emoji.js` returned HTTP 200 on :8793. In-app browser control was not exposed by tool discovery, and local Playwright/Puppeteer packages were missing.
- **Follow-up:** Full GUI smoke still needed: page icon picker selection updates header/sidebar/breadcrumb and persists after reload; callout icon picker selection updates the block.

---

## 2026-05-28 — TASK-NOTES-02 — notes deletion smoke — pass

- **Command category:** test
- **Result:** pass
- **Output:** `node --check frontend/views/notes.js` and `node --check frontend/app.js` clean. Local server on :8792 returned HTTP 200 for `/frontend/index.html`, `/frontend/views/notes.js`, and `/frontend/styles/notes.css`. Headless Playwright smoke passed: fresh Notes first-load had 0 rows and the empty state; creating a note added one row; row trash + confirm deleted it; creating two notes then header trash + confirm cleared both; reload restored 0 rows.
- **Follow-up:** Full app smoke with real model calls and branch/search flows still needs human API-key/browser verification; this run covered the Notes deletion/persistence surface only.

---

## 2026-05-26 — Bug #025 + server restart — pass

- **Category:** test / migration (server restart)
- **Result:** pass
- **Output:** Diagnosed "scan failed": running `backend/server.py` (PID 52644, started May 24) predated the uncommitted `/__notlinear_scan_project` endpoint → 404. Killed it, restarted `backend/server.py --port 8765`. Re-probed scan for `/Users/yash/Claude/Linkedin Posts scraper copy` → `ok:true`, files present: readme, changelog, bugs, tasks. Fixed the malformed "create" button (dropped `ghost` square variant) in coding-projects.js.
- **Follow-up:** User reloads the CP page to confirm scan results render and create buttons (on genuinely-missing files) look correct.

## 2026-05-26 — Bug #024 + server re-probe — pass (static)

- **Category:** test
- **Result:** pass (static); server still stale
- **Output:** Re-probed :8765 → `/__notlinear_pick_folder` 404, `/__notlinear_scan_project` 404, index 200 → server NOT restarted since CP01. Found `.toast` z-index 300 < overlay 400 (toasts invisible in CP view); raised to 500.
- **Follow-up:** User must restart `backend/server.py` (kill old process first) for the picker/scan to work. Then retry add-folder; toast feedback is now visible.

## 2026-05-26 — TASK-CP07 — static checks — pass (smoke test pending)

- **Category:** test
- **Result:** pass (static only)
- **Output:** `node --input-type=module --check` clean; no dangling `pickAndAdd`; `app.js`, view module, CSS, index serve 200 on :8793; bootstrap line confirmed `nl_theme||'light'`.
- **Follow-up:** Full GUI smoke test (final v1): add a project via the popover (type path AND via browse button; pick an emoji from the strip); edit emoji on a row and on the page header (persists, "icon updated"); confirm a fresh profile (clear `nl_theme`) loads light; all three themes render; AND the standing chat smoke test + branch exercise show no regressions (esp. the theme-default change in app.js). If green, mark CP07 + the whole CP feature Done.

## 2026-05-26 — TASK-CP06 — static checks + server diagnosis — pass (smoke test pending)

- **Category:** test
- **Result:** pass (static); diagnosis logged
- **Output:** `node --input-type=module --check` clean; module + CSS serve 200. Diagnosis of user's "add folder does nothing": `curl -X POST :8765/__notlinear_pick_folder` → **404**, while `:8765/frontend/index.html` → 200. Confirms a stale server process (started before CP01's endpoint). Fix: restart `backend/server.py`.
- **Follow-up:** User restarts the server, retries add-folder (native picker should appear), then comments smoke test (post/delete/persist both surfaces, count sync, ⌘↵, themes).

## 2026-05-26 — TASK-CP05 — static checks — pass (smoke test pending)

- **Category:** test
- **Result:** pass (static only)
- **Output:** `node --input-type=module --check` clean. Module, CSS, index serve 200 on :8795; `cp-drawer` appears 7× in index.html (markup + handlers wired).
- **Follow-up:** GUI smoke test before marking CP05 Done — open each present file from the project page (drawer renders markdown, shows path+size), confirm missing cells are not clickable, close via X / Escape / outside-click, and that `.cp-scroll` reflows (margin-right) without occlusion. All three themes.

## 2026-05-26 — TASK-CP04 — static checks — pass (smoke test pending)

- **Category:** test
- **Result:** pass (static only)
- **Output:** `node --input-type=module --check` clean after adding the project page + DeepSeek status switch. View module, CSS, and index.html serve 200 on :8796.
- **Follow-up:** GUI smoke test before marking CP04 Done — open a project page, edit title (persists + "renamed"), confirm files grid (present clickable / missing dimmed), bugs/tasks/changelog/overview render, missing-file dashed callout, breadcrumb + back/Escape (page→list→chat), all three themes. Also confirm the DeepSeek status sentence fills when a DeepSeek key is set (heuristic otherwise).

## 2026-05-26 — TASK-CP03 — static checks — pass (smoke test pending)

- **Category:** test
- **Result:** pass (static only)
- **Output:** `node --input-type=module --check views/coding-projects.js` clean. Server on :8797: view module + CSS serve 200. Live `/__notlinear_scan_project` on this repo parsed; module's open-bug regex (`^[ \t>]*[-*+]\s+\[ \]`) returns 0 for this repo's BUGS.md (expected — fixed/verified format).
- **Follow-up:** GUI smoke test before marking CP03 Done — add a real folder via native picker, confirm row renders, status sentence fills (Haiku when a key is set, heuristic otherwise), gallery toggle, rescan, empty state, all three themes; and chat still unaffected.

## 2026-05-26 — TASK-CP02 — static checks — pass (smoke test pending)

- **Category:** test
- **Result:** pass (static only)
- **Output:** `node --input-type=module --check views/coding-projects.js` clean. Server on :8798: `frontend/views/coding-projects.js`, `frontend/styles/coding-projects.css`, `frontend/app.js`, `frontend/index.html` all 200; index.html grep found all 3 new hooks (`cp-screen`, `cp-side-head`, `coding-projects.css`).
- **Follow-up:** GUI smoke test required before marking CP02 Done — full AGENTS.md 10-item + hard branch exercise (create/nest/reopen/persist-across-switch/search) + open the "coding projects" sidebar section, confirm overlay opens, back button + Escape return to chat, collapse caret persists across reload, all three themes.

## 2026-05-26 — TASK-CP01 — curl verification — pass

- **Category:** test
- **Result:** pass
- **Output:** `py_compile` clean. Server on :8799. `/__notlinear_scan_project` on repo root: listing correct (files + dirs, hidden skipped); files block → readme/changelog/bugs present with text, tasks `{present:false}`. Missing path → `{ok:false,error:"not a directory"}`. Empty path → HTTP 400. Existing endpoints intact: `/__notlinear_runtime_logs` 200, `/frontend/index.html` 200.
- **Follow-up:** No app UI yet, so no full smoke test this phase. Human can spot-check the endpoints; then TASK-CP02 (shell seam) which DOES require the full hard smoke test.

## 2026-05-26 — TASK-CP00 — scaffold — pass

- **Category:** scaffold
- **Result:** pass
- **Output:** Recorded ADR-003/004/005 in DECISIONS.md and seeded CP00–CP07 in TASKS.md. No app files changed.
- **Follow-up:** Human reviews the plan; then TASK-CP01 (additive backend endpoints).

## 2026-05-24 — TASK-M04 — curl verification — pass

- **Category:** test
- **Result:** pass
- **Output:** HTTP 200 on app.js, core/state.js, index.html. No double substitution detected (assertion passed). 143 primitive refs replaced across 7 variables.
- **Follow-up:** Human runs **hard** smoke test: chat, branch create, branch nest, branch reopen, branch persist-across-switch, search-tool branch. All Fragile areas (#002–#018) must pass.

## 2026-05-24 — TASK-M03 — curl verification — pass

- **Category:** test
- **Result:** pass
- **Output:** HTTP 200 on `/frontend/app.js` and `/frontend/index.html`. IIFE wrapper stripped, module tag in place.
- **Follow-up:** Human runs full smoke test. Emphasis: chat, branches, branch reopen/persist, search tools — all require the JS to execute correctly as a module.

## 2026-05-24 — TASK-M02 — curl verification — pass

- **Category:** test
- **Result:** pass
- **Output:** All four paths return HTTP 200: `/frontend/index.html`, `/frontend/styles/tokens.css`, `/frontend/styles/base.css`, `/frontend/styles/chat.css`. No `<style>` block remains in index.html.
- **Follow-up:** Human runs full smoke test with **emphasis on all three themes** (dark-mono / grey / light) and **highlights panel text in light mode** (bug #022). If green, proceed to TASK-M03.

## 2026-05-24 — TASK-M01 — server + curl verification — pass

- **Category:** test
- **Result:** pass
- **Output:** `python3 backend/server.py --port 8766` started; `curl` verified HTTP 200 on `/frontend/index.html`, `/CHANGELOG.md`. Shim server (`notlinear_server.py`) on port 8767 also returned 200 on `/frontend/index.html`. All three paths confirmed working.
- **Follow-up:** Human runs full smoke test (AGENTS.md 10-item checklist) against `backend/server.py` at port 8765. Pay attention to: changelog viewer showing live file (not fallback), logs.md syncing, update-refresh firing on edit, themes, branches.

## 2026-05-24 — TASK-M00 — scaffold — pass

- **Category:** scaffold
- **Result:** pass
- **Output:** Created `docs/project-notes/` and all four memory files (TASKS.md, RUNS.md, CHANGES.md, DECISIONS.md). Committed migration baseline (d47bd96) capturing working monolith + all project docs. No app files changed.
- **Follow-up:** Human to confirm files look correct; then proceed to TASK-M01.

---

## 2026-05-28 — TASK-NOTES-01 — static checks
- **Command category:** static (no test suite exists)
- **Result:** pass
- **Output:** `node --check frontend/views/notes.js` clean. `frontend/index.html`, `frontend/styles/notes.css`, `frontend/views/notes.js` all serve HTTP 200 from the local server at :8765. Notes sidebar entry + overlay shell + slash menu + ftoolbar markup all present in index.html.
- **Follow-up:** Human to manually walk the §20 acceptance checklist in the browser (sidebar tree, page editor, slash menu, format toolbar, Dexie persistence on reload, theme cycle).

---

## 2026-07-08 — TASK-FB01 — static checks + endpoint tests
- **Command category:** static + curl integration (no test suite exists)
- **Result:** pass
- **Output:** `python3 -m py_compile backend/server.py` and `node --check frontend/core/feedback.js` clean. Throwaway server on :8799: `__notlinear_feedback_save` → FB-001/FB-002 with correct markdown structure; `__notlinear_feedback_shot` → real PNG (after Screen Recording permission was granted; before that it returned the permission error cleanly); `__notlinear_feedback_record` start→stop → playable .mov, stop-without-start → 409 "not recording". Test server killed; test entries and media removed; FEEDBACK.md reset to header.
- **Follow-up:** Human to restart the :8765 dev server, then smoke-test the panel UI: ⌘⇧B, log a bug with screenshot + recording, verify FEEDBACK.md entry and feedback/media/ files.

---

## 2026-07-09 — TASK-FB02 — static checks + headless browser drive
- **Command category:** static + Playwright (headless Chromium against a throwaway :8799 server)
- **Result:** pass
- **Output:** `py_compile` + `node --check` clean. Drive script: ctx-ranking popover `display:none` at load; `.side-scroll` overflowY `auto`, scrollTop held at 400 under 60 injected rows with the settings footer still visible; ⌘⇧B opened the feedback panel; Settings → Feedback expanded to "1 bug · 1 idea" rendering both seeded entries with badges, context, and media link; zero console errors. Screenshots reviewed (light theme). Seeded entries + test server cleaned up.
- **Follow-up:** Human smoke test on :8765 after restart: sidebar scroll with real data, log a bug end-to-end, view it in Settings → Feedback, confirm the white top-right box is gone (was the ctx-ranking popover, #031).

---

## 2026-07-09 — Bugs #032–#034 (Notes) — static check + headless browser drive
- **Command category:** static + Playwright (headless Chromium against the running :8765 server; headless profile has its own IndexedDB so user notes were untouched)
- **Result:** pass
- **Output:** `node --check` clean on notes.js. Drive: created a page with blocks Alpha/Bravo/Charlie. Placeholder `::before` content was `none` on unfocused empty text block and "Type '/' for commands" when focused. Synthetic HTML5 DnD (dragstart on grip → dragover bottom half of Charlie → drop): `.drop-below` mark appeared, order became Bravo/Charlie/Alpha, and survived a reload. ⌘A selected "Bravo" only (0 `.bsel`), second ⌘A marked all 3 blocks, ⌘C wrote "Bravo\nCharlie\nAlpha" to the clipboard stub and cleared the selection; Escape also cleared. Zero console errors; screenshot reviewed.
- **Follow-up:** Human smoke test in the real browser: drag feel (cursor, insertion line), ⌘A ⌘A ⌘C on a page with headings/todos/code to eyeball the markdown serialization, placeholder behavior while writing.

---

## 2026-07-09 — TASK-FB03 — static checks + curl + Playwright E2E
- **Command category:** static + curl + headless Playwright (throwaway :8799 server)
- **Result:** pass (full-screen flows); area flows pending human smoke test (native macOS picker can't be driven headlessly)
- **Output:** `py_compile` + `node --check` clean. Upload/discard routes reject path traversal (`backend/server.py`, `../…`) and accept `feedback/media/` paths. E2E: capture-mode menu shows 2 options; full-screen shot → preview overlay → pen stroke drawn → "Add to report" rewrote the PNG (1,125,593 → 1,170,972 bytes) and added the chip; second capture → Discard deleted the file with no chip; 2.5s full-screen recording → stop → `<video>` preview → Add → chip; zero console errors. Overlay screenshot reviewed (annotation visible). Test media removed; user's own capture kept.
- **Follow-up:** Human: restart :8765, test both "Select area" flows (shot + recording), annotate, Add, then Save a bug and confirm entry + media in Settings → Feedback.
