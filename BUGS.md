# Bugs

This file is the institutional memory of every bug found and fixed in this repository. Every bug fix appends a new numbered entry. Entries are never deleted — they are the test cases we wish we had written.

Read the **Fragile areas** section before modifying any code in those areas.

---

## Fragile areas

Areas that have broken two or more times. If your task touches any of these, you must explicitly state in your reasoning how your change avoids the previous failure modes.

- **Branch panel reopen / single-instance behavior** — bugs #002, #003, #037, #038. Panels for child and nested-child branches have repeatedly failed to reopen after the single-instance rule was introduced, and the multi-panel stacking/layout math has its own class of regressions (#037, #038).
- **Branch chat persistence across switches** — bugs #008, #009. Branch conversations have been lost or overwritten by snapshot/restore logic that did not account for all entry paths (chat switch, quote-only reopen).
- **Branch research/tool status** — bugs #010, #011, #012, #014, #015, #016, #017, #018. Branch research has regressed in actual tool timing, stale status UI, post-search synthesis waits that hid retrieved results, unbounded response-body reads, model-driven tool loops that kept searching instead of answering, raw DeepSeek pseudo-tool markup leaking into answers, local aborts after successful tool results losing the fallback answer, and the `completeWithToolFallback` salvage being placed in the wrong function.
- **Notes tab identity / multi-note navigation** — bugs #042, #043. Notes originally entered the tab strip as one singleton `notes` view, which made distinct note pages overwrite one another's tab identity. Future Notes navigation work must verify opening Note A, opening Note B, switching back to Note A, and reloading with both note tabs open.

---

## Active bugs

None currently tracked.

### #047 — Model picker menu could render outside the viewport once the option count grew, with no way to scroll to the missing entries
- Date discovered: 2026-08-07
- Date fixed: 2026-08-07
- Agent: Claude Sonnet 5
- Symptom: After adding five extra legacy model tiers to `#model-menu` (14 entries total, up from 9), automated (Playwright) clicks on the newly-added lower entries failed with "Element is outside of the viewport," even after scrolling into view. The underlying cause reproduces for a real user too: on a normal-height viewport, `openModelMenu()` could position the menu so its bottom edge extended below the visible window, with no scrollbar to reach the cut-off items.
- Root cause: two compounding gaps. (1) `.menu` in `frontend/styles/base.css` had no `max-height`/`overflow-y`, so the menu always rendered at full content height regardless of viewport size. (2) `openModelMenu()` (`frontend/app.js`) picked "open above the anchor" or "open below the anchor" based only on whether there was room *above*, then never checked whether the menu actually fit in whichever direction it picked — so a menu taller than the remaining space below the anchor (common near the bottom composer bar) rendered partially off-screen with nothing to correct it.
- Fix: Added `max-height:calc(100vh - 40px);overflow-y:auto` to `.menu` so any menu this size or larger becomes internally scrollable instead of overflowing. Added a final clamp in `openModelMenu()` — `top = Math.max(8, Math.min(top, window.innerHeight - modelMenu.offsetHeight - 8))` — after the existing above/below branch, so the menu's bottom edge can never exceed the viewport regardless of anchor position or item count.
- Files touched: `frontend/styles/base.css`, `frontend/app.js`, `BUGS.md`, `CHANGELOG.md`, `docs/project-notes/{CHANGES,RUNS}.md`.
- Test case: headless Playwright at 1280×800 — open the model picker from the main composer (anchor near the bottom of the viewport); confirm the menu's bounding rect stays fully within `[0, window.innerHeight]`; click every one of the 14 entries and confirm each is reachable and sets the model chip label correctly.
- Prevention: any future growth of `#model-menu` (or reuse of `.menu` for another long list) is now covered by the CSS max-height/scroll and the positioning clamp — no per-menu fix needed.
- Related: #046 (found in the same session while expanding the model picker).

### #046 — Settings → "Default model" panel: 5 of 9 buttons were dead (Opus, GPT-4o, GPT-4o Mini, Gemini Flash, Gemini Pro did nothing on click)
- Date discovered: 2026-08-07
- Date fixed: 2026-08-07
- Agent: Claude Sonnet 5
- Symptom: Found while expanding the model picker for a model-upgrade task, not user-reported. The Settings panel's "Default model" segmented control (`#prefs [data-v=...]`) renders a button for all 9 model preferences, but its click handler in `frontend/app.js` only recognized `['sonnet','haiku','deepseek','deepseek-r1']` — clicking Opus, GPT-4o, GPT-4o Mini, Gemini 2.0 Flash, or Gemini 2.5 Pro in Settings silently did nothing (no error, no state change), while the same options worked fine from the main composer's model-menu dropdown, which uses a separate, complete handler.
- Root cause: the Settings click handler's model-preference branch used a hardcoded array literal instead of the already-existing `MODEL_OPTIONS` lookup object, and that array was never updated as new providers (OpenAI, Gemini) were added to `MODEL_OPTIONS` and the HTML.
- Fix: Changed the condition from `['sonnet','haiku','deepseek','deepseek-r1'].includes(v)` to `MODEL_OPTIONS[v]`, so it automatically covers every registered model preference, present and future.
- Files touched: `frontend/app.js`, `BUGS.md`, `CHANGELOG.md`, `docs/project-notes/{CHANGES,RUNS}.md`.
- Test case: headless Playwright — open Settings, click the GPT-5.6 Luna (and separately Opus 4.5) button in "Default model," confirm the `.on` class moves to the clicked button.
- Related: #047.

### #045 — Opus was mislabeled as "Sonnet 4.6" in the model chip, and the Extended Thinking toggle was disabled for Opus even though the Claude provider supported it
- Date discovered: 2026-08-07
- Date fixed: 2026-08-07
- Agent: Claude Sonnet 5
- Symptom: Found while auditing the model-switching UI, not user-reported. Two related gaps: (1) `MODEL_OPTIONS` in `frontend/app.js` had no `opus` entry, so `modelLabel()`'s fallback (`MODEL_OPTIONS[value] || MODEL_OPTIONS.sonnet`) silently displayed the Sonnet label whenever Opus was selected. (2) `providers/tools.js`'s `modelLabelFromId()` had no `opus` branch either, so Opus's `claude-opus-*` model ID fell through every check and would display as a raw model-ID string in message metadata. (3) `renderModelUI()`'s `thinkingSupported` check only allowed `'sonnet'` (plus `'deepseek-r1'`), even though `providers/claude.js`'s own `supportsThinking` check already covered both `'opus'` and `'sonnet'` — so the Extended Thinking toggle was greyed out and forced off for Opus, even though a real Opus request would have honored it.
- Fix: Added `opus` to `MODEL_OPTIONS`; added an `opus`-matching branch to `modelLabelFromId()`; extended `thinkingSupported` (both the `renderModelUI()` copy and the `#thinking-toggle` change-handler copy) to include Opus, matching what `providers/claude.js` already supports.
- Files touched: `frontend/app.js`, `frontend/providers/tools.js`, `BUGS.md`, `CHANGELOG.md`, `docs/project-notes/{CHANGES,RUNS}.md`.
- Test case: headless Playwright — select Opus from the model picker, reopen the picker, confirm the chip reads "Opus 5" (not "Sonnet …") and the Extended Thinking toggle is enabled (no `disabled` attribute).
- Related: #044.

### #044 — DeepSeek chat calls were about to break (or already broken): the app hardcoded the `deepseek-chat`/`deepseek-reasoner` model names DeepSeek retired on 2026-07-24
- Date discovered: 2026-08-07
- Date fixed: 2026-08-07
- Agent: Claude Sonnet 5
- Symptom: Found while auditing model versions across providers, not user-reported — but since DeepSeek's stated retirement date (2026-07-24) had already passed at the time of discovery (2026-08-07), every DeepSeek call path in the app (main chat, inline/branch chat, Notes AI fallback, Coding Projects status line, search-keyword extraction, file ranking, thread summarization) was likely already returning errors in production.
- Root cause: six call sites across `frontend/providers/deepseek.js`, `frontend/app.js`, `frontend/views/notes.js`, and `frontend/views/coding-projects.js` hardcoded the literal strings `'deepseek-chat'` and `'deepseek-reasoner'`, which DeepSeek retired in favor of a single model (`deepseek-v4-flash`) with reasoning controlled by a `thinking` request parameter instead of a separate model name.
- Fix: Migrated every call site to `model:'deepseek-v4-flash'`, with `thinking:{type:'enabled'},reasoning_effort:'high'` for what used to be `deepseek-reasoner` and `thinking:{type:'disabled'}` for what used to be `deepseek-chat` (explicit either way, since omitting `thinking` reportedly defaults to enabled on this model — leaving it implicit would have silently turned on reasoning, and its extra latency/cost, for fast utility calls like keyword extraction and file ranking that need to stay cheap). `providers/deepseek.js`'s tool-availability gate (previously `model !== 'deepseek-reasoner'`) now checks the `thinking` flag instead, since both variants now share one model string.
- Files touched: `frontend/providers/deepseek.js`, `frontend/app.js`, `frontend/views/notes.js`, `frontend/views/coding-projects.js`, `BUGS.md`, `CHANGELOG.md`, `docs/project-notes/{CHANGES,RUNS}.md`.
- Test case: `node --check` on all four files; headless Playwright confirmed the picker's "DeepSeek Flash" and "DeepSeek Thinking" entries select correctly and set the expected chip label. **Not verified against a live DeepSeek API key** — no key was available in this session — so the exact request-parameter shape (`thinking:{type:...}`, `reasoning_effort`) is inferred from DeepSeek's own reasoning-mode documentation, not confirmed by a real response. Recommend a human smoke test sending one real DeepSeek Flash message and one DeepSeek Thinking message before relying on this.
- Related: #045.

### #043 — Notes pages still shared one singleton tab, so opening a second note replaced the first
- Date discovered: 2026-08-01
- Date fixed: 2026-08-01
- Agent: Codex
- Symptom: User clarified that after bug #042, the real expected behavior still was not working: when one note was already open in the tab strip, opening another note should create/focus a separate note tab. Instead, every note click reused the same singleton "Notes" tab and navigated that single view to the newly selected note, so switching back to the previous note as its own tab was impossible.
- Root cause: the tab strip model in `frontend/app.js` only had `notes` in `NON_THREAD_TAB_META`, while `frontend/views/notes.js` stored the active page in one module-global `state.selectedId`. ADR-026 had explicitly rejected per-note tabs for the earlier @-mention feature, and the #042 fix intentionally preserved that singleton model. That fixed the index reset, but it left no addressable tab identity for individual note pages (`note:<id>` did not exist), so all note-opening paths (`renderRow`, bento cards, page-link blocks, and note mention chips) ultimately mutated the same selected note inside one view.
- Fix: Added first-class `note:<noteId>` tab ids in `frontend/app.js`, with note metadata supplied by `frontend/views/notes.js`. Added a tiny `registerNoteOpener`/`openNoteTab` bridge in `frontend/core/registry.js` mirroring the existing chat opener bridge. Routed Notes entry points through that bridge so sidebar rows, index cards, page links, note mentions, and new-page creation open/focus a concrete note tab. Kept `notes` as the Notes index/home tab. Extended `nl_tabs_v1` with an `active` field so a concrete note tab can be restored as active after reload, and pruned persisted note tabs whose target note no longer exists. Targeted browser verification found one more same-path race: blank-tab quick actions called `closeTab('blank')`, which briefly reopened the previous note before opening the intended destination; because note opening is async, the previous note could win and prevent the Notes index from showing. Fixed the direct-destination quick actions (New chat, Coding projects, Notes) to remove the blank tab without activating a fallback first. Added a tab-refresh bridge so note title/icon edits update note tab labels immediately. Removed the temporary `[BUG042-DEBUG]` console logging left by the prior fix.
- Files touched: `frontend/core/registry.js`, `frontend/app.js`, `frontend/views/notes.js`, `BUGS.md`, `CHANGELOG.md`, `FEATURES.md`, `docs/project-notes/{TASKS,DECISIONS,CHANGES,RUNS}.md`.
- Manual test case:
  1. Open Notes and click Note A from the sidebar or index.
  2. Click `+`, choose "Notes", then click Note B.
  3. Confirm the tab strip shows separate tabs for Note A and Note B, with Note B active.
  4. Click Note A's tab and confirm Note A renders, then click Note B's tab and confirm Note B renders.
  5. Reload the app and confirm both note tabs are restored and the active note tab remains active.
  6. Delete a note that has an open note tab, reload, and confirm the deleted note tab is not restored.
- Prevention: do not use `mountView('notes') + selectNote(id)` for user-facing note navigation entry points; use `openNoteTab(id)` so the tab strip has a stable `note:<id>` identity. Keep `notes` reserved for the index/home view.
- Related: #042, ADR-026, ADR-027.

### #042 — Opening Notes from a blank tab reset an already-open Notes tab back to the index, discarding the open note
- Date discovered: 2026-08-01
- Date fixed: 2026-08-01
- Agent: Claude Sonnet 5
- Symptom: User reported "one note is open, I am trying to open another note, it closes the previous note and brings me to the home page." Confirmed from a screen recording: with a "Notes" tab open on a specific note ("Valley," a subpage of "Requirement documents detailed"), opening a new blank tab (`+`) and clicking its "Notes" quick-action tile snapped the existing Notes tab back to the Notes index/overview grid, discarding the open note. The blank tab was consumed (closed) and the tab strip was left with just the two original tabs, but the surviving Notes tab no longer showed "Valley" — it showed the "35 pages" index.
- Root cause: `frontend/app.js`'s blank-tab "Notes" tile handler (`#bte-notes`) called `openNotesIndex()` unconditionally: `closeTab('blank'); openNotesIndex();`. `openNotesIndex()` (`frontend/views/notes.js`) is documented as an explicit "start fresh in Notes" entry point — it force-sets `state.showIndex = true` before mounting, by design, for its one intended caller (the sidebar "Notes" section header, which should always jump to the overview). But Notes is a singleton view-tab (per the tab-strip's `NON_THREAD_TAB_META` and ADR-026, which explicitly says a Notes navigation should "switch to/open the existing shared Notes tab and navigate straight to that note" — not reset it). The blank-tab tile reused the wrong helper: instead of just focusing the existing singleton Notes view (`mountView('notes')`, same as clicking the Notes tab in the strip, or same as the sibling `#bte-coding-projects` tile which calls `mountView('coding-projects')` directly with no reset), it forced `showIndex = true` every time, blowing away whatever note was open in the live, unmounted-but-still-in-memory `notes.js` module state.
- Fix: Changed the `#bte-notes` handler in `frontend/app.js` from `openNotesIndex()` to `openTab('notes')` — the same singleton-tab focus path already used for Coding projects and for the tab strip's own click-to-switch. This mounts the Notes view as-is (whatever `state.selectedId`/`state.showIndex` already were) instead of forcing the index. Removed the now-unused `openNotesIndex` import from `app.js` (its only remaining caller, the sidebar "Notes" header click in `notes.js`, is internal to that module and unaffected).
- Files touched: `frontend/app.js`, `BUGS.md`, `CHANGELOG.md`, `docs/project-notes/{TASKS,CHANGES,RUNS}.md`.
- Manual test case:
  1. Open a note with at least one subpage (e.g. open a parent note, then open one of its subpages) so a specific note is showing in the Notes tab, not the index.
  2. Click `+` to open a new blank tab.
  3. In the blank tab's quick-action grid, click "Notes."
  4. Confirm the Notes tab is focused and still shows the subpage you had open (not the "N pages" index grid), and the blank tab is gone.
  5. Confirm the sidebar "Notes" section header still opens the index/overview grid as before (unaffected, different code path).
  6. Confirm opening Notes for the very first time in a session (no note previously open) still works and lands somewhere sensible (last-viewed note, or index if none), and creating a new page / switching notes normally is unaffected.
- Prevention: `openNotesIndex()` is reserved for entry points whose actual intent is "show the overview," not as a generic "open the Notes view" call. Any future button/tile that just wants to bring Notes into view should use `openTab('notes')` / `mountView('notes')`, matching how the other singleton view-tabs (Coding projects, blank) are opened.
- Related: ADR-026 (documents the intended singleton-Notes-tab-and-navigate behavior this bug violated).

### #041 — Notes Markdown export dropped sidebar-created subpages (only in-content page-link subpages were included)
- Date discovered: 2026-07-31
- Date fixed: 2026-07-31
- Agent: Claude Sonnet 5
- Symptom: User exporting a note whose children were created via the sidebar tree (the row's "add subpage" button, or "New page" while a note is selected) found those subpages missing from the exported `.md` — only subpages that had been embedded as an in-content `page-link` block (e.g. via the `/page` slash command) showed up as sections.
- Root cause: `noteToMarkdown()` (`frontend/views/notes.js`) recursed only into `collectSubpageIds(n.blocks)`, which scans block content for `page-link` targets. It never consulted `kidsOf(n.id)` (`state.notes.filter(n => n.parent === pid)`) — the actual sidebar parent/child tree that "add subpage" and "duplicate page" build via the note's `parent` field. A note can gain a child through either mechanism independently (they only overlap when the in-content `/page` command is used, since that command sets both `parent` and a `page-link` block), so export silently missed the tree-only case.
- Fix: the `emit` walker inside `noteToMarkdown` now recurses into the union of both sources — `new Set([...kidsOf(n.id).map(c => c.id), ...collectSubpageIds(n.blocks)])` — instead of `collectSubpageIds` alone. The existing `visited` Set already deduplicates the case where a page is both a tree child and page-link-embedded, so no page is exported twice.
- Files touched: `frontend/views/notes.js` (`noteToMarkdown`), `BUGS.md`, `CHANGELOG.md`, `docs/project-notes/{CHANGES,RUNS}.md`, `FEATURES.md`.
- Manual test case: create a parent note; add a child via the sidebar row's "add subpage" button (not the in-content `/page` command) with its own body text; export the parent → the child's title and body appear as a `## <title>` section in the downloaded `.md`. Verified headlessly by intercepting the `/__notlinear_save_file` POST body (the real endpoint pops a native macOS save dialog via `osascript`, which can't be driven headlessly) — see RUNS.md.
- Related: none.

### #040 — Tab key did nothing useful anywhere text is typed (moved focus away instead of indenting/inserting)
- Date discovered: 2026-07-31
- Date fixed: 2026-07-31
- Agent: Claude Sonnet 5
- Symptom: User reported "tab key doesn't work as expected and it doesn't create space in the same line," plus (mid-fix, with a screenshot of a Notes bullet list) "when I press the Tab key it should go to sub-bullet." Confirmed live with headless Playwright against the running `:8765` server: pressing Tab in the main chat input (`#main-input`) moved keyboard focus to the next button (`#main-attach-btn`) and typed text landed nowhere; pressing Tab inside a Notes block (`.editor`, contenteditable) moved focus to the note's "Ask AI" box instead of doing anything to the block. **A second symptom surfaced after the first pass of this fix shipped**, caught live by the user on their own real note: pressing Tab on an empty (or short) bullet produced a large blank vertical gap with a "Type '/' for commands" placeholder floating far to the right instead of a clean nested sub-bullet — user: "I am not able to clear the space here."
- Root cause: Two independent gaps, both in the same area. **(1)** No code anywhere intercepted a plain `Tab` keydown on any of the app's free-text inputs, so the browser's native default — shift focus to the next element in tab order — always won. `mainInput`'s keydown handler (`frontend/app.js`) only handled `Enter`; the branch-panel textareas (`frontend/app.js`, `frontend/views/notes.js`), the Coding Projects comment composer (`frontend/views/coding-projects.js` `wireComposer`), and the feedback textarea (`frontend/core/feedback.js`) had the same gap. In the Notes block editor, `onEditorKey` (`frontend/views/notes.js`) only handled `Tab` as a special case *inside the slash-command menu* (to pick a command) — outside the slash menu, Tab fell through untouched, and there was no indent/outdent concept in the block model at all (`children` existed only on `toggle` blocks, used exclusively for their expand/collapse UI). **(2)** Once indent/outdent was added (reusing `children`, rendering a `.child-wrap` below any block that has them — see the fix below and ADR-025), a pre-existing latent CSS bug in `.nt-screen .b` (`frontend/styles/notes.css:178`) surfaced: `.b` is `display:flex` with no `flex-wrap`, and `.content` (`flex:1`) and `.child-wrap` are both in-flow flex children of it — i.e. flex *siblings in the same row*, not stacked. `.content{flex:1}` (flex-basis 0%) claims the row first, leaving `.child-wrap` squeezed into whatever narrow space is left over to its right instead of dropping to its own line below. The nested block's placeholder/caret text then wrapped character-by-character down that narrow column (`white-space:pre-wrap` + `flex:1` on `.editor`), inflating the row's height into the large blank-looking gap the user saw, with the placeholder only visible way down at the bottom-right of that inflated row. This same layout bug already existed for `toggle` blocks' children — it just was never noticed because toggles are used far less often than bullets and their children default to hidden until opened.
- Fix: (1) Added a shared `wireTabInsertsTab(textarea)` helper in `frontend/core/ui.js` — on a bare `Tab` keydown (no Shift/Cmd/Ctrl/Alt) it splices a literal `\t` into the textarea's value at the caret and re-fires `input` (so autosize/state listeners still run), instead of letting focus move. Wired into `#main-input`, both branch-panel ask textareas (app.js + notes.js), the Coding Projects comment composer, and the feedback textarea. (2) For the Notes block editor, generalized the existing toggle-only `children` mechanism (already recursed into by every block-tree walker — `findBlock`, `blocksToText`, `blocksToMarkdown`, `collectHeadings`, `collectSubpageIds` — see ADR-025) to any block type: `onEditorKey` now handles bare `Tab` (nest the current block as the last child of its immediately preceding sibling — new `indentBlock()`) and `Shift+Tab` (pop it back out to sit right after its parent in the parent's list — new `outdentBlock()`, which walks `note.blocks` via `findBlock` to locate the grandparent list). `renderBlock()` now renders a `.child-wrap.indent-children` for *any* block with `children.length`, not just `toggle`. If there's no preceding sibling to indent under (e.g. the very first block on the page), Tab falls back to inserting a literal `\t`, so it's never a silent no-op. The slash-menu's existing Tab-to-pick behavior is unchanged (checked first, still returns early). (3) **CSS layout fix**: added `flex-wrap:wrap` to `.nt-screen .b` and `flex:0 0 100%` to `.nt-screen .b .child-wrap` (both variants — toggle's and the new generic one), forcing any block's `child-wrap` onto its own full-width line below `.content` instead of squeezing into leftover row space. This also fixes the same latent bug for `toggle` block children, which had the identical squeeze problem, just rarely triggered.
- Files touched: `frontend/core/ui.js` (`wireTabInsertsTab`), `frontend/app.js` (`mainInput`, branch textarea), `frontend/views/notes.js` (`indentBlock`, `outdentBlock`, `onEditorKey`, `renderBlock`, `attachEditor` gains a `note` param threaded through its 3 call sites, note branch-ask textarea), `frontend/views/coding-projects.js` (`wireComposer`), `frontend/core/feedback.js`, `frontend/styles/notes.css` (`.child-wrap.indent-children`, `.b{flex-wrap:wrap}`, `.b .child-wrap{flex:0 0 100%}`), `BUGS.md`, `CHANGELOG.md`, `docs/project-notes/{TASKS,DECISIONS,CHANGES,RUNS}.md`.
- Manual test case:
  1. Type into the main chat box, press Tab mid-sentence — a tab character is inserted and focus stays in the box (previously: focus jumped to the attach button).
  2. Repeat in a branch panel's ask box, a Notes page's "Ask AI" box, a Coding Projects comment box, and the feedback panel (⌘⇧B) textarea.
  3. In Notes, create a bullet, press Enter, and **immediately** press Tab on the still-empty new bullet (the exact sequence that triggered the CSS bug) — it nests cleanly as a full-width sub-bullet directly below the first, no blank gap, no floating placeholder. Then type into it normally.
  4. Press Shift+Tab on that nested bullet — it pops back out to be a sibling of the first bullet again, positioned right after it, full width, top-level indentation.
  5. On the very first block of a fresh page (no preceding sibling), press Tab — a literal tab character is inserted into the block's text instead of nothing happening.
  6. Confirm the slash-menu (`/` command picker) still Tab-completes its selection as before.
  7. Reload the page — nested bullets persist correctly in `notlinear-notes` (verified directly against the IndexedDB `kv` store's `nl_notes_v1` entry).
  8. Add a child to a toggle block (click its "empty — click to add" affordance) — child renders full-width directly below the toggle's own line, not squeezed to the side (non-regression + fix for the same latent bug in toggles).
- Prevention: any new free-text input added to the app should go through `wireTabInsertsTab` (or the Notes indent path if it's a block-tree editor) rather than leaving Tab to native browser focus-navigation by default. Any future block type that appends a sibling wrapper div to `.b` (alongside `.content`) must account for `.b` being a row-flex container — either reuse the `.child-wrap` class (now `flex:0 0 100%` by default) or add an equivalent full-width rule, not assume block-level children automatically stack.
- Related: none — first Tab-key bug in this area, but the CSS half is a latent sibling of the toggle-children layout that had never been exercised enough to notice before.

### #039 — Notes: couldn't select/copy text spanning more than one block
- Date discovered: 2026-07-31
- Date fixed: 2026-07-31
- Agent: Claude Sonnet 5
- Symptom: User reported "I am not able to select and copy all the text in the notes." Confirmed with headless Playwright: dragging the mouse from inside one block into a sibling block did not extend the selection at all — the drag stayed clamped to the block it started in, so any text past the first block's end was silently unreachable, no matter how far the drag continued.
- Root cause: each block renders as its own separate `contenteditable="true"` `.editor` div (`renderBlock()`, one per top-level/nested block). Chromium (and WebKit) treat each `contenteditable` as its own "editing host" and refuse to let a user-driven mouse-drag `Selection` cross from one host into another — confirmed this is a hard UA restriction, not a listener bug: even a `Range` built and assigned programmatically via `Selection.addRange()` spanning two separate editing hosts gets silently clamped back to the first host. A page-wide `⌘A ⌘A → ⌘C` escape hatch already existed (`selectAllBlocks()`/`blockSelAll`) but only covered "select literally everything," not an arbitrary drag-selected range, and wasn't discoverable from a normal drag gesture.
- Fix: added `wireBlockRangeDrag()` — on `mousedown` inside a block's `.editor`, records the top-level block + index; on `mousemove`, once the cursor crosses into a different top-level block, native selection is cleared and a custom `.bsel` highlight is painted across the index range (reusing the CSS class the existing select-all already used) via `paintBlockRange()`. The existing `blockSelAll`/`clearBlockSel`/keydown-copy machinery was generalized to a `blockSelIds` set so `⌘/Ctrl+C` copies either the whole page (`noteToText`) or just the highlighted range (`blocksToText` over the filtered block slice), and `Escape`/click-away clears either. Dragging that stays within one block is untouched — native selection still handles it.
- Files touched: `frontend/views/notes.js` (`clearBlockSel`, `blockSelIds`, `topLevelBlockAt`, `paintBlockRange`, `wireBlockRangeDrag`, keydown copy handler), `FEATURES.md`, `CHANGELOG.md`, `docs/project-notes/{CHANGES,RUNS}.md`.
- Manual test case:
  1. Open a note with 3+ text blocks.
  2. Click-drag from partway through block 1 down into block 3, release.
  3. Confirm all dragged-over blocks show a highlighted background (not just block 1).
  4. Press `⌘/Ctrl+C`, paste elsewhere, confirm all blocks' text is present in order.
  5. Confirm a drag that stays inside a single block still shows normal native (blue) text selection, unaffected.
- Prevention: any future work on block selection/copy should remember that native `Selection`/`Range` **cannot** cross separate `contenteditable` hosts in this architecture (each block is its own host) — cross-block selection must go through this custom highlight-and-serialize path, not a native `Range`.
- Related: none — first bug in this area.

### #038 — Child branch opened under an expanded reader-mode parent and could not be read/expanded cleanly
- Date discovered: 2026-07-15
- Date fixed: 2026-07-15
- Agent: Codex
- Symptom: User reported that after creating a branch from inside another branch, the child branch got stuck in the small stacked state and could not be made big/readable. Screenshot showed a branch-from-branch panel in front of a blurred ancestor, matching the nested branch layout path.
- Root cause: `rebalance()` layered reader-mode panels before active/ancestor roles. If a parent branch was expanded in reader mode and the user created a child branch inside it, focus moved to the child but the parent kept `.reader` plus `z-index:60`. The active child only received `z-index:3`, so it was visually trapped beneath the fixed reader parent. `layoutBranches()` also snapped the child against the parent's stale inline `top` while the reader parent was actually positioned by `.branch.reader{top:72px !important}`, making the stacked state look stuck.
- Fix: `rebalance()` now treats reader mode as active-focus-only: any non-active branch that still has `reader` is demoted before stacking is calculated and its reader button is synchronized. The z-index expression was also reordered defensively so the active branch and its ancestor chain take precedence over stale reader state.
- Files touched: `frontend/app.js`, `BUGS.md`, `CHANGELOG.md`, `docs/project-notes/`.
- Manual test case:
  1. Create a branch from a document highlight.
  2. Expand that parent branch into reader mode.
  3. Create a child branch from text inside the parent branch body.
  4. Confirm the parent is blurred behind the child but is not still in reader mode above it.
  5. Click the child branch expand button and confirm the child becomes the readable reader panel while the parent is hidden/eclipsed behind it.
- Prevention: Keep reader mode tied to the active branch only. Future branch layout work should verify the "parent already reader -> create child -> expand child" path in addition to the existing nested branch reopen tests.
- Related: #028, #037, fragile area "Branch panel reopen / single-instance behavior".

### #037 — Expanding a branch panel ("reader" mode) left its blurred parent panel as a stray floating fragment
- Date discovered: 2026-07-10
- Date fixed: 2026-07-10
- Agent: Claude Sonnet 5
- Symptom: User reported: with multiple/nested branches open (branch-from-branch), they couldn't open/expand a branch panel and the UI "glitched." Screenshot showed the active (front) branch panel intact, with its blurred parent panel behind it — matching the intentional `.behind-active` stacked-card look — but after further interaction the parent panel visually detached into its own broken-looking fragment.
- Root cause: `layoutBranches()` (`frontend/app.js`) repositions every open branch panel each frame via anchor-based placement math, except branches in `reader` mode (which use `position:fixed` and are explicitly excluded from that math). It did **not** exclude the *ancestors* of a reader-mode branch. Before expansion, a child and its open parent share the same `top` (via the existing "snap child onto parent" logic), so the blurred parent is invisibly stacked directly behind the child. The instant the child enters reader mode, its own inline `top` becomes irrelevant (overridden by the `.branch.reader{top:72px !important}` rule), but the parent — still going through normal placement — gets repositioned to wherever its source highlight sits in the document, completely decoupled from the reader panel's actual on-screen position. Result: a blurred, non-interactive, orphaned panel fragment floating near the expanded one.
- Fix: In `layoutBranches()`, compute the ancestor-chain of any currently-open reader-mode branch and exclude those ancestors from the anchor-based placement loop (same treatment as the reader branch itself), so they keep their last (correctly stacked) position instead of drifting. Also added a `.branch.behind-active.reader-eclipsed{opacity:0}` CSS rule (`frontend/styles/chat.css`) and toggle the `reader-eclipsed` class on those ancestors in `layoutBranches()`, fully hiding them while eclipsed by the (wider, taller) reader panel rather than leaving a partial sliver visible when their heights don't exactly match.
- Files touched: `frontend/app.js` (`layoutBranches`), `frontend/styles/chat.css`.
- Manual test case (re-run live via headless Playwright against `:8765`, since the native-picker items in this app can't all be automated but this flow can):
  1. Highlight text in the doc → Branch → send a message (branch A).
  2. Highlight text inside branch A's body → Branch → send a message (branch B, child of A). Confirm A is stacked directly behind B, blurred, non-interactive (intentional).
  3. Click "Expand branch" (maximize icon) on B. Confirm A is **not** visible anywhere on screen (fully eclipsed) — no fragment, no sliver.
  4. Un-expand B. Confirm A reappears correctly stacked behind B.
  5. Repeated with 3 levels of nesting (grandparent → parent → child); expanding the child correctly eclipsed both ancestors.
- Related: Fragile area "Branch panel reopen / single-instance behavior" (#002, #003) — same subsystem, different failure mode (layout/visibility, not reopen-identity). The "Back to parent branch" button (`openParentBranch`, unrelated to this fix) remains the sanctioned way to bring a blurred ancestor back into focus — this bug did not change that interaction, only the visual layout during reader mode.

### #036 — Escape key broken app-wide (ReferenceError: pendingDeleteConfirm is not defined)
- Date discovered: 2026-07-09
- Date fixed: 2026-07-09
- Agent: Claude Sonnet 5
- Symptom: Found while running a live headless-browser smoke test on the batch of uncommitted UI fixes (#026-#035, TASK-FB01-03). The #031 fix ("Escape closes the Context Ranking popover") did not work in the running app — the popover stayed open after Escape — even though the code for it looked correct.
- Root cause: The app-level Escape/Enter handler in `frontend/app.js` referenced `pendingDeleteConfirm`, `closeDeleteConfirm`, and `deleteConfirmDelete` as if they were globals, but all three are module-private (`let`/`const`, never exported) inside `frontend/core/ui.js`. Every Escape or Enter keydown threw `ReferenceError: pendingDeleteConfirm is not defined` at the top of the handler, aborting the rest of the function before it reached any of the later checks — including the brand-new `#031` ctx-ranking-popover close, and also the project panel, sidebar, model menu, mode menu, main menu, ctx panel, and prefs panel closes. This line predates the current session (it was unchanged context in the diff, not new), so Escape has likely been silently broken for all of those surfaces since the `core/ui.js` extraction (TASK-M05) — it just hadn't been manually smoke-tested since.
- Fix: Exported proper accessors from `core/ui.js` instead of leaking private state — `isDeleteConfirmOpen()`, `isDeleteConfirmDeleteFocused()`, `cancelDeleteConfirm()`, `acceptDeleteConfirm()` — and updated the Escape/Enter handler in `app.js` to use them instead of the bare (undefined) variable names.
- Files touched: `frontend/core/ui.js`, `frontend/app.js`, `BUGS.md`, `CHANGELOG.md`, `docs/project-notes/`
- Manual test case (re-run live via headless Playwright against `:8765`):
  1. Open the delete-confirm dialog, ctx-ranking popover, or sidebar; press Escape.
  2. Confirm zero `pageerror` events in the console and that the specific panel actually closes.
  3. Repeat for the sidebar independently — opened via `#sidebar-toggle`, closed via Escape.
- Related: #031 (the fix this was silently defeating); Fragile area candidate — any future addition to the Escape handler chain should verify no earlier branch throws.

### #035 — Edited frontend CSS/JS didn't show up after reload (no cache-control on dev server)
- Date discovered: 2026-07-09
- Date fixed: 2026-07-09
- Agent: Claude (Fable 5)
- Symptom: After fixing #032–#034 in notes.css/notes.js, the user still saw the old behavior (redundant placeholders) in the native app after reloading. Curl against the server showed the new CSS was being served correctly, so the file on disk and the server response were both right — only the client was stale.
- Root cause: `NotlinearHandler` (backend/server.py) is a bare `SimpleHTTPRequestHandler` with no `Cache-Control` header on any response. Browsers/WKWebView apply their own heuristic caching for CSS/JS when the server is silent on caching, so a normal reload — and in WKWebView's case even a hard refresh — can keep serving a stale copy of a stylesheet or script indefinitely.
- Fix: Added an `end_headers` override on `NotlinearHandler` that sends `Cache-Control: no-store, must-revalidate` on every response before calling `super().end_headers()`. Since this project has no build step or cache-busted asset URLs (CLAUDE.md), always-revalidate is the correct default for a local dev server.
- Files touched: `backend/server.py`, `BUGS.md`, `CHANGELOG.md`, `docs/project-notes/`
- Manual test case:
  1. Edit any file under `frontend/styles/` or `frontend/` while the dev server is running.
  2. Reload the page in a browser tab — the change appears without a hard refresh.
  3. Quit and relaunch the native app (`launchers/NotlinearNative.swift` WKWebView shell) — the change appears without needing a full macOS relaunch cache-clear.
  4. `curl -sI http://127.0.0.1:8765/frontend/styles/notes.css` shows `Cache-Control: no-store, must-revalidate`.
- Related: #032, #033, #034 (the fixes this masked); affects every future frontend edit, not just Notes.

### #034 — Notes: "Type '/' for commands" placeholder showed on every empty line
- Date discovered: 2026-07-09
- Date fixed: 2026-07-09
- Agent: Claude (Fable 5)
- Symptom: Every empty text block on a Notes page displayed the "Type '/' for commands" ghost text simultaneously (user screenshot), making pages with a few blank lines read as a wall of repeated placeholder text.
- Root cause: `.nt-screen .b .editor:empty::before` in notes.css rendered `data-ph` on *every* empty editor unconditionally.
- Fix: For plain `text` blocks the placeholder now renders only while the block is focused (`.b.text .editor:empty:focus::before`); typed blocks (Heading 1–4, List, To-do, Toggle, Quote, Callout) keep their always-visible label since it identifies the block type. CSS-only change.
- Files touched: `frontend/styles/notes.css`, `BUGS.md`, `CHANGELOG.md`, `docs/project-notes/`
- Manual test case:
  1. Open a Notes page and create three empty text blocks.
  2. Confirm no placeholder shows on any of them until one is focused; the focused one shows "Type '/' for commands".
  3. Add an empty Heading 1 and an empty bullet — their "Heading 1" / "List" placeholders stay visible without focus.
- Related: Notes view (`frontend/views/notes.js`, PRD `notes_product.md`).

### #033 — Notes: block drag-and-drop did not work (grip was click-only)
- Date discovered: 2026-07-09
- Date fixed: 2026-07-09
- Agent: Claude (Fable 5)
- Symptom: Dragging a block by its ⋮⋮ grip handle did nothing — blocks could not be reordered.
- Root cause: Drag was never implemented. The grip button only had a click handler opening the `prompt()`-based del/dup menu; no `draggable`, `dragstart`, `dragover`, or `drop` wiring existed anywhere in the block renderer.
- Fix: New `wireBlockDrag()` in notes.js. The grip is `draggable`; dragging sets a module-level `dragCtx` (block id + source list). Every block element accepts `dragover`/`drop`, showing a `--branch`-colored insertion line above or below based on pointer midpoint (`.drop-above`/`.drop-below` in notes.css). Drop splices the block out of its source list and into the target's parent list, so reordering works at top level and into/out of toggle children and columns. Dropping a block onto itself or into its own descendants is guarded (`el.closest('.b.dragging')`). Click on the grip still opens the actions menu.
- Files touched: `frontend/views/notes.js`, `frontend/styles/notes.css`, `BUGS.md`, `CHANGELOG.md`, `docs/project-notes/`
- Manual test case:
  1. On a Notes page with several blocks, drag a block's ⋮⋮ grip over another block — an orange insertion line appears above/below depending on pointer position.
  2. Drop — the block moves there and persists after reload.
  3. Drag a block into a toggle's expanded children and back out.
  4. Drag a toggle over its own child — no insertion line, drop does nothing.
  5. Click the grip without dragging — the del/dup menu still opens.
- Related: #029 (gutter layout).

### #032 — Notes: could not select/copy text across blocks (whole-page copy impossible)
- Date discovered: 2026-07-09
- Date fixed: 2026-07-09
- Agent: Claude (Fable 5)
- Symptom: Mouse selection stopped at block boundaries, so there was no way to copy the whole page (or even two adjacent blocks) to the clipboard.
- Root cause: Each block is its own `contentEditable` element, and browsers confine any selection that starts inside an editable element to that element — cross-block native selection is structurally impossible with per-block editors.
- Fix: Notion-style select-all escalation. ⌘/Ctrl+A inside a block selects that block's text (native); pressing it again — or pressing it in an empty block — enters page-selection mode: all blocks highlight (`.bsel`), and ⌘/Ctrl+C copies the entire page as markdown-ish plain text via new `noteToText()`/`blocksToText()` serializers (headings → `#`, todos → `- [x]`, code fenced, tables piped, toggles indented, rich-text HTML stripped). Escape, click, or typing exits the mode. Handlers live in `wireGlobalListeners` gated on the Notes screen being visible.
- Files touched: `frontend/views/notes.js`, `frontend/styles/notes.css`, `BUGS.md`, `CHANGELOG.md`, `docs/project-notes/`
- Manual test case:
  1. On a Notes page with mixed blocks (headings, bullets, todo, code), click into a block and press ⌘A — the block's text selects.
  2. Press ⌘A again — every block highlights.
  3. Press ⌘C — toast "page copied"; paste into a text editor and confirm the whole page with markdown prefixes and correct order.
  4. Press Escape (or click anywhere) — highlight clears.
  5. ⌘A in an empty block goes straight to whole-page selection.
- Related: #034, #033 (same session Notes polish).

### #031 — Context Ranking popover rendered as a borderless white box and couldn't be dismissed with Escape
- Date discovered: 2026-07-09
- Date fixed: 2026-07-09
- Agent: Claude (Fable 5)
- Symptom: A stray white rounded box appeared fixed at the top-right of the window (user screenshot). It was the `#ctx-ranking-popover` opened via the topbar brain button: near-invisible edges made it look like a rendering artifact, and Escape did not close it — only the small × button or re-clicking the brain icon.
- Root cause: `.popover` used `border:1px solid var(--border)`, but no `--border` token exists in tokens.css (the tokens are `--rule`/`--rule-2`), so the border silently resolved to invalid → none. And the popover was never added to the app-level Escape close chain.
- Fix: `var(--border)` → `var(--rule-2)` in `.popover`; added the popover (checked via `style.display === 'block'`) to the Escape handler chain in app.js ahead of the menu checks.
- Files touched: `frontend/styles/base.css`, `frontend/app.js`, `BUGS.md`, `CHANGELOG.md`, `docs/project-notes/`
- Manual test case:
  1. Open a project chat with a linked folder so the brain (🧠) topbar button appears; click it.
  2. Confirm the popover has a visible border in all three themes.
  3. Press Escape — the popover closes (and Escape does not also close the sidebar or other panels on that press).
- Related: TASK-CTX03 topbar popover refactor (2026-06-29 part 4).

### #030 — Left sidebar did not scroll when content overflowed the viewport
- Date discovered: 2026-07-09
- Date fixed: 2026-07-09
- Agent: Claude (Fable 5)
- Symptom: With enough projects/coding projects/notes, sidebar sections below the fold (Threads, Notes, Recent branches, the Settings footer) were unreachable — the sidebar clipped instead of scrolling.
- Root cause: `.sidebar` is a fixed-position flex column with no `overflow-y` anywhere in it; content taller than the viewport was simply clipped.
- Fix: Wrapped everything between the brand header and the `.side-foot` settings footer in a new `.side-scroll` container (`flex:1; min-height:0; overflow-y:auto`), so the middle scrolls while the brand and footer stay pinned. Sibling order inside the wrapper is unchanged, so `wireSidebarCollapse`'s `nextElementSibling` pairing still holds.
- Files touched: `frontend/index.html`, `frontend/styles/base.css`, `BUGS.md`, `CHANGELOG.md`, `docs/project-notes/`
- Manual test case:
  1. Add enough projects/notes that the sidebar content exceeds the window height.
  2. Scroll the sidebar — all sections are reachable; the notlinear brand stays pinned at top and the Alex Chen/settings footer stays pinned at bottom.
  3. Collapse/expand each section header — collapse still works inside the scroll container.
- Related: none.

### #029 — Notes block content not aligned with the page title (indented ~60px right)
- Date discovered: 2026-06-04
- Date fixed: 2026-06-04
- Agent: Claude (Opus 4.8)
- Symptom: On a Notes page, the page title, the `#` tag row, and the meta line all started at the page's left padding, but every block below (text, headings, lists, the highlighted first line) was indented noticeably further right, so the body text did not line up under the title.
- Root cause: `.nt-screen .b` is a flex row whose first child `.gutter` (the hover `+` / grip handles) was `flex:0 0 56px`, reserving 56px of in-flow space on the left of every block. That pushed `.content` (the editor) ~60px to the right of the block's left edge, while the title/tags/meta sit directly in the page column with no such offset.
- Fix: Took the gutter out of flow — `position:absolute; left:-52px; top:0; width:48px` — so the handles float into the left margin and `.content` (flex:1) now starts at the block's left edge, aligned with the page title. CSS-only change.
- Files touched: `frontend/styles/notes.css`, `BUGS.md`, `CHANGELOG.md`, `docs/project-notes/`
- Manual test case:
  1. Open Notes and select a page that has a title and a few text/list blocks.
  2. Confirm the first character of each block's text lines up vertically under the first character of the page title.
  3. Hover a block — confirm the `+` / grip handles appear in the left margin and do not shift the text.
  4. Check nested cases (toggle children, callouts, lists) still read correctly.
- Related: Notes view layout.

### #028 — Maximize (reader) on a branch instantly collapsed it instead of expanding
- Date discovered: 2026-06-04
- Date fixed: 2026-06-04
- Agent: Claude (Opus 4.8)
- Symptom: Clicking the maximize (⤢) button on a branch — most noticeably a nested branch-from-branch — expanded it for an instant and then collapsed it; "the expansion goes out."
- Root cause: Two click listeners fire for one maximize click. The reader button's own handler runs `toggleReader` → `syncReaderButton`, which does `btn.innerHTML = '<i …>'`, replacing (detaching) the exact `<i>` icon that was clicked. The `.branch-head` click handler then fires on bubble and guards with `if (e.target.closest('.actions')) return;` — but `e.target` is now the detached old icon, so `closest('.actions')` returns `null`, the guard fails to bail, and `toggleCollapse(id)` runs and collapses the just-expanded branch.
- Fix: Added a dedicated click listener on `.branch-head .actions` that calls `e.stopPropagation()`, so action-bar clicks never reach the head's collapse toggle. This is the intended behavior and is robust against any action handler that mutates the DOM mid-click, rather than relying on the fragile detached-`e.target` guard.
- Files touched: `frontend/app.js`, `BUGS.md`, `CHANGELOG.md`, `docs/project-notes/`
- Manual test case:
  1. Open a branch from a doc highlight; inside it, highlight text and open a child branch-from-branch.
  2. Hover the child branch header and click the maximize (⤢) button.
  3. Confirm the branch enters reader/expanded mode and stays expanded (does not collapse).
  4. Click maximize again (now shrink) — confirm it returns to normal size without collapsing.
  5. Confirm the collapse chevron still collapses/expands on its own.
- Related: branch action-bar / head click handling.

### #023 — "Try again" button did nothing after Claude rate limit
- Date discovered: 2026-05-10
- Date fixed: 2026-05-10
- Agent: Kimi (k2.6)
- Symptom: When Claude returned a rate-limit error, the "Try again" button appeared but simply re-ran the same Claude request, which would fail again with the same error.
- Root cause: The `onError` handler in both `runMainTurn` and `runBranchTurn` treated all non-config errors the same way: show a "Try again" button that called the original `doMainCall`/`doBranchCall` with the same Claude adapter. There was no model-fallback path.
- Fix: Added a Claude-rate-limit detection guard in both `onError` handlers. When the error message matches `/claude.*rate limit/i`, a DeepSeek key is present, and the turn has not already auto-switched once, the handler swaps the adapter to DeepSeek, rebuilds the message list with `buildPlainUserContent`, sets a brief status, and retries automatically.
- Files touched: `notlinear.html`, `BUGS.md`, `CHANGELOG.md`
- Manual test case:
  1. Ensure Claude is selected and a DeepSeek API key is saved in Settings.
  2. Send a message that triggers a Claude 429 rate-limit response (or simulate by temporarily blocking the Anthropic endpoint).
  3. Confirm the UI shows "Claude rate limited — switching to DeepSeek…" and then automatically retries with DeepSeek.
  4. Confirm the DeepSeek response streams normally without requiring a manual click.
  5. Repeat inside a branch panel — same auto-fallback behavior.
- Related: none.

### #020 — Expanded branch panels stayed visible when anchor text scrolled out of view
- Date discovered: 2026-05-08
- Date fixed: 2026-05-08
- Agent: Claude (Sonnet 4.6)
- Symptom: With two branches open, only one was visible at a time. Scrolling did not hide/show branch panels in sync with their anchor text. Expanded (non-collapsed) branches remained on screen even when their anchor had scrolled fully out of the viewport.
- Root cause: The `source-out` visibility condition in `layoutBranches` was gated on `b.collapsed &&` — only collapsed branches were hidden when their anchor left the viewport. Expanded branches were never assigned `source-out`, so they always remained visible regardless of scroll position.
- Fix: Removed the `b.collapsed &&` guard. All branches (collapsed and expanded) now receive `source-out` when their anchor rect is outside the visible rail. The existing `window.addEventListener('scroll', scheduleBranchLayout)` already fires `layoutBranches` on every scroll, so visibility updates happen in real time.
- Files touched: `notlinear.html`, `BUGS.md`, `CHANGELOG.md`
- Manual test case:
  1. Create two branches from different highlights that are vertically separated in the doc.
  2. Scroll so both anchor texts are visible — both branch panels should be visible.
  3. Scroll down until the first anchor is out of view — its panel should disappear.
  4. Scroll back up until it re-enters view — its panel should reappear.
- Related: none.

---

## Resolved bugs (continued)

### #053 — New contract tests wrote a stub entry into the real feedback log
- Date discovered: 2026-10-04
- Date fixed: 2026-10-04
- Agent: Claude Opus 5
- Symptom: After the first run of the new `tests/contract` suite, `feedback/FEEDBACK.md` had gained a stub entry `## FB-001 · Idea · 2026-10-04 14:15 · status: open` that no human created. Developer data modified by a test run.
- Root cause: `backend/server.py` resolves `LOGS_PATH`, `FEEDBACK_DIR`, `FEEDBACK_MEDIA_DIR` and `FEEDBACK_PATH` at import time, relative to the repo. The autouse isolation fixture in `tests/contract/conftest.py` redirected the first three but missed `FEEDBACK_PATH`. `test_every_documented_endpoint_exists` POSTs an empty body to all 12 endpoints to prove none has been renamed, and that sweep includes `/__notlinear_feedback_save`, which appended a real entry.
- Fix: Added `FEEDBACK_PATH` to the autouse `isolated_paths` fixture and restored the file with `git checkout`. Verified by hashing `logs.md` and `feedback/FEEDBACK.md` and counting `feedback/media` before and after a full 32-test run.
- Files touched: `tests/contract/conftest.py`, `feedback/FEEDBACK.md` (restored)
- Manual test case:
  1. `md5 -q feedback/FEEDBACK.md logs.md` and `ls feedback/media | wc -l`.
  2. `pytest tests/contract`.
  3. Repeat step 1 — all three must be unchanged.
- Prevention: A test that sweeps every endpoint is a test that WRITES through every endpoint. Any new module-level path in `backend/server.py` must be added to `isolated_paths` in the same change, and the hash check above belongs in the P2 session before the first FastAPI contract run — not after it.
- Related: P1 safety net; the same sweep is what will validate the FastAPI shims in P2.


### #018 — DeepSeek tool-result fallback was placed in the wrong function
- Date discovered: 2026-05-08
- Date fixed: 2026-05-08
- Agent: Claude (Sonnet 4.6)
- Symptom: Branch search with DeepSeek kept spinning or showed a tiny partial response even after search results returned. The `completeWithToolFallback` salvage path (bug #017 fix) never fired for DeepSeek because it was accidentally defined inside `callClaude`, not `callDeepSeek`. Inside `callClaude` it referenced `lastToolResults`, `totalCacheHit`, and `toolRoundCount` — variables only defined in `callDeepSeek` — so it always returned false immediately.
- Root cause: Bug #017 fix added `safeAbortReason` and `completeWithToolFallback` into `callClaude`'s scope and updated `callClaude.reportAbort` to call them. It never added these helpers to `callDeepSeek` or updated `callDeepSeek.reportAbort` to call `completeWithToolFallback`. Evidence: `provider:'deepseek'` and `tools.map(t => t.function?.name)` (OpenAI tool format) in the code placed inside `callClaude` confirmed the copy-paste target was wrong.
- Fix: Removed `completeWithToolFallback` from `callClaude` (kept `safeAbortReason` for abort-reason logging). Added `safeAbortReason` and `completeWithToolFallback` inside `callDeepSeek` where all referenced variables (`lastToolResults`, `totalCacheHit`, `toolRoundCount`, etc.) are actually in scope. Updated `callDeepSeek.reportAbort` to call `completeWithToolFallback` before falling through to the abort path.
- Files touched: `notlinear.html`, `BUGS.md`, `CHANGELOG.md`
- Manual test case:
  1. Open a branch with DeepSeek and Serper configured.
  2. Ask a search-backed question.
  3. While DeepSeek synthesis is streaming, close the branch panel OR click stop.
  4. Confirm the branch shows retrieved tool results instead of a tiny partial or a permanent spinner.
- Related: #012, #015, #016, #017.

### #019 — Branch search aborted when panel is closed or another branch opens
- Date discovered: 2026-05-08
- Date fixed: 2026-05-08
- Agent: Claude (Sonnet 4.6)
- Symptom: Closing a branch panel or opening a second branch while a DeepSeek search was in progress aborted the in-flight search, discarding all retrieved tool results.
- Root cause: `closeBranch` called `b.controller?.abort('branch_closed')` and `closeOtherBranches` called `b.controller?.abort('other_branch_opened')` on any streaming branch. This was originally a cleanup measure, but it prevented background search completion.
- Fix: Removed the abort calls from `closeBranch` and `closeOtherBranches`. Explicit deletion (`removeOpenBranchImmediately`) still aborts to avoid orphaned requests for permanently-deleted branches. `captureBranchSnapshot` now accepts a `branch` option so `onDone`/`onError`/`onAbort` can save snapshots even after `branches[id]` is removed from the registry. All three callbacks in `runBranchTurn` pass `{ branch: b }` to ensure background-completed searches are persisted correctly.
- Files touched: `notlinear.html`, `BUGS.md`, `CHANGELOG.md`
- Manual test case:
  1. Open a branch with DeepSeek and start a search-backed question.
  2. While search tools are running, close the branch panel.
  3. Wait for the search to complete (check runtime logs).
  4. Reopen the branch — confirm the answer is present, not empty.
  5. Repeat step 2 but by opening a different branch instead of closing — same result.

---

## Resolved bugs

### #001 — Branch answer Markdown collapsed into dense paragraphs
- Date discovered: before 2026-05-07
- Date fixed: 2026-05-07
- Agent: Codex
- Symptom: Compact model output in branch answers ran multiple numbered items and field labels together in a single paragraph instead of separating them onto their own lines.
- Root cause: The branch Markdown rendering path did not normalize compact model output before passing it to `renderMarkdown`, so adjacent numbered items and `Label:` field markers were not split onto separate lines.
- Fix: Added/extended a normalization step (see `normalizeMarkdownForDisplay`) in the branch render path so numbered items and field labels each begin on their own line before Markdown parsing.
- Files touched: `notlinear.html`, `CHANGELOG.md`
- Manual test case:
  1. Open any branch.
  2. Send a prompt that produces a list with field labels (e.g., "list 3 competitors with Model, Funding, Focus").
  3. Confirm each numbered item starts on its own line and each field label is on its own line.
- Related: none.

### #002 — Branch markers inside branch panels did not reopen child branches
- Date discovered: before 2026-05-07
- Date fixed: 2026-05-07
- Agent: Codex
- Symptom: Clicking a branch marker inside an already-open branch panel did nothing for child or nested-child branches.
- Root cause: After branch panels were made single-instance (#004), the click handler for branch markers inside panels did not correctly resolve nested branch IDs, so the open path bailed out for non-root branches.
- Fix: Updated the marker click handling so nested branch IDs are resolved against the same registry used by `openBranch`, and the panel switches to the target branch instead of being suppressed.
- Files touched: `notlinear.html`, `CHANGELOG.md`
- Manual test case:
  1. Open a branch from a highlight in the main chat.
  2. Inside that branch, highlight text and create a child branch.
  3. Inside the child, create a nested child branch.
  4. Close all panels, then click the original branch marker — open.
  5. Click the child marker inside the panel — opens.
  6. Click the nested child marker — opens.
- Related: #003, #004.

### #003 — Diagonal-only branch resize was insufficient
- Date discovered: before 2026-05-07
- Date fixed: 2026-05-07
- Agent: Codex
- Symptom: Branch panels could only be resized via a single diagonal grip; users could not resize from the top edge, side, or other corners.
- Root cause: Resize was implemented with one corner handle. There were no edge or directional handles.
- Fix: Replaced the single grip with directional edge and corner handles; resizing logic in `wireBranchResize` and `setBranchSize` now respects `branchResizeBounds` for each direction.
- Files touched: `notlinear.html`, `CHANGELOG.md`
- Manual test case:
  1. Open a branch panel.
  2. Drag from the top edge — panel grows upward.
  3. Drag from the bottom edge — panel grows downward.
  4. Drag from a side — panel grows sideways.
  5. Drag from each corner — panel grows in two axes.
- Related: #004.

### #004 — Multiple panels for the same branch and excess modal whitespace
- Date discovered: before 2026-05-07
- Date fixed: 2026-05-07
- Agent: Codex
- Symptom: Opening a branch that was already open created a duplicate panel; the default branch modal had large empty regions.
- Root cause: `openBranch` did not check for an existing panel for the same branch ID; modal CSS used loose default sizing.
- Fix: Made branch panels single-instance — `openBranch` now reuses the existing panel for a branch ID if one is open. Tightened default branch modal spacing.
- Files touched: `notlinear.html`, `CHANGELOG.md`
- Manual test case:
  1. Open a branch from the main chat.
  2. Click the same branch marker again — focus moves to the existing panel; no duplicate is created.
  3. Open a fresh branch — its initial size has no excess top/bottom whitespace.
- Related: #002, #003. Note: this fix introduced #002 and required #003.

### #005 — No way to delete a branch
- Date discovered: before 2026-05-07
- Date fixed: 2026-05-07
- Agent: Codex
- Symptom: Users could create branches but had no way to remove them; deleted-feeling branches still appeared in the Recent branches sidebar and the context tree.
- Root cause: No deletion path existed. Once a branch was created, its records persisted indefinitely.
- Fix: Added branch deletion entry points from branch panels, the Recent branches sidebar, and the context tree. `deleteBranch` removes the open panel, the branch records, and any persisted recents entry. Persistence is updated via `removeBranchRecords` and `persistAll`.
- Files touched: `notlinear.html`, `CHANGELOG.md`
- Manual test case:
  1. Create a branch from the main chat.
  2. Delete it from the branch panel — panel closes, branch disappears from Recent branches and context tree.
  3. Reload the page — branch does not return.
  4. Repeat from the Recent branches sidebar — same result.
  5. Repeat from the context tree — same result.
- Related: none.

### #006 — Recent branches sidebar list was static
- Date discovered: before 2026-05-07
- Date fixed: 2026-05-07
- Agent: Codex
- Symptom: The Recent branches sidebar showed hardcoded placeholder rows; clicking them did not open the user's actual branches.
- Root cause: The sidebar was rendered with static markup; there was no persisted recents list and no click handler that resolved to a real branch.
- Fix: Replaced static rows with a dynamic list backed by `rememberBranchRecent` and persisted state. Clicking a row calls `openBranch` with the saved branch ID.
- Files touched: `notlinear.html`, `CHANGELOG.md`
- Manual test case:
  1. Open three branches across two different chats.
  2. Open the sidebar — Recent branches lists those three, most-recent first.
  3. Click any row — the correct branch opens.
  4. Reload — the list and click behavior are preserved.
- Related: #005.

### #007 — In-app changelog viewer could not read CHANGELOG.md
- Date discovered: before 2026-05-07
- Date fixed: 2026-05-07
- Agent: Codex
- Symptom: The settings panel changelog viewer was empty when the app was opened from the local filesystem because `fetch('CHANGELOG.md')` is blocked under `file://`.
- Root cause: The viewer relied solely on a network fetch of the file, which fails under `file://` origins.
- Fix: Added a bundled `FALLBACK_CHANGELOG_MD` constant. The viewer attempts to fetch the live file first and falls back to the bundled copy when the fetch fails.
- Files touched: `notlinear.html`, `CHANGELOG.md`
- Manual test case:
  1. Open `notlinear.html` directly from disk (double-click, `file://` URL).
  2. Open Settings → Changelog viewer.
  3. Confirm changelog content renders (from the fallback).
  4. Open the same file via a local web server — confirm the live file is read.
- Related: none.

### #008 — Branch chat content lost when switching chats
- Date discovered: before 2026-05-07
- Date fixed: 2026-05-07
- Agent: Codex
- Symptom: A branch with sent messages would lose its conversation content when the user switched to a different chat and came back.
- Root cause: The chat-switch path did not call the snapshot routine for branches with persistable content, so the in-memory branch state was discarded before being saved.
- Fix: Snapshot all open branches with persistable content before switching chats. Uses `branchHasPersistableContent` and `captureBranchSnapshot`; called via `syncOpenBranchSnapshots` on the switch path.
- Files touched: `notlinear.html`, `CHANGELOG.md`
- Manual test case:
  1. Open a branch in chat A and send a message that gets a response.
  2. Switch to chat B.
  3. Switch back to chat A and reopen the branch.
  4. Confirm both the user message and the response are still present.
- Related: #009.

### #009 — Quote-only branch reopen overwrote saved branch content
- Date discovered: before 2026-05-07
- Date fixed: 2026-05-07
- Agent: Codex
- Symptom: Reopening a branch via a quote-only flow (no fresh prompt) erased the previously saved branch conversation.
- Root cause: The reopen path treated quote-only entry as a fresh branch and reset the branch state instead of restoring from the saved snapshot.
- Fix: Quote-only reopen flows now check for an existing branch snapshot via `applyBranchSnapshot` before initializing fresh state. `snapshotHasPersistableContent` gates whether the snapshot is preferred over a reset.
- Files touched: `notlinear.html`, `CHANGELOG.md`
- Manual test case:
  1. Create a branch from a highlight, send messages.
  2. Close the branch panel.
  3. Reopen the same branch via the original highlight (quote-only path).
  4. Confirm prior messages are restored, not erased.
- Related: #008.

### #010 — Branch research was slow on broad entity questions
- Date discovered: before 2026-05-07
- Date fixed: 2026-05-07
- Agent: Codex
- Symptom: Broad branch prompts ("tell me more", "what about X") spent excessive time fetching full pages instead of returning quick search snippets.
- Root cause: The system prompt did not steer the model toward snippet-first behavior for broad entity questions, and tool timeouts were too generous, letting slow scrapes block responses.
- Fix: Updated `buildSystemPrompt` guidance for broad branch prompts to prefer search snippets first. Shortened external tool timeouts (`SEARCH_TIMEOUT_MS`, `PAGE_READ_TIMEOUT_MS`, `SCRAPE_TIMEOUT_MS`).
- Files touched: `notlinear.html`, `CHANGELOG.md`
- Manual test case:
  1. Open a branch from any highlight.
  2. Send "tell me more" with no other context.
  3. Confirm the model uses a search tool first and responds within ~12s rather than fetching a full page.
- Related: none.

### #011 — Branch search status kept spinning after answer text started
- Date discovered: 2026-05-07
- Date fixed: 2026-05-07
- Agent: Codex
- Symptom: Branch responses that used search showed a continuing "Sleuthing" or "Synthesizing Thinking" spinner above the answer, making it look like search was still stuck even after the answer text had begun streaming.
- Root cause: `streamInto` stopped the working-status timer when text deltas arrived but did not clear the existing `.ai-status` DOM. The compact status markup stayed visible until the model call fully finished, and its CSS spinner continued animating.
- Fix: Updated `streamInto` to clear the active AI status via `setAiStatus(turnEl, null)` before rendering the first streamed answer delta. This keeps the shared main, inline, and branch rendering path consistent without changing tool execution or branch persistence.
- Files touched: `notlinear.html`, `BUGS.md`, `CHANGELOG.md`
- Manual test case:
  1. Open a branch from a highlighted passage.
  2. Ask a search-backed question such as "what are the economics of this?"
  3. Confirm the branch may show a search/synthesis status while tools run.
  4. Confirm that status line clears as soon as answer text starts streaming, with no stale spinner left above the response.
- Related: #010.

### #012 — Branch search results were hidden when DeepSeek synthesis stalled
- Date discovered: 2026-05-07
- Date fixed: 2026-05-07
- Agent: Codex
- Symptom: Branch searches could appear to spin forever after the search provider returned results because the UI waited on DeepSeek's follow-up synthesis call and did not show the retrieved results.
- Root cause: `callDeepSeek` treated the post-tool model request the same as any other model stream, using the generic 120s stream idle timeout and only surfacing output if DeepSeek produced final answer text. Tool results were kept only in `currentMessages`, so if the second stream stalled before text deltas, the branch had no visible fallback despite successful search execution.
- Fix: Added a shorter post-tool synthesis idle timeout and retained the latest tool results in `callDeepSeek`. If DeepSeek stalls before producing synthesis text, the branch now renders a fallback answer with the retrieved tool results instead of continuing to spin.
- Files touched: `notlinear.html`, `BUGS.md`, `CHANGELOG.md`
- Manual test case:
  1. Open a branch from a highlighted passage with DeepSeek configured.
  2. Ask a current/search-backed question such as "what are the economics of this?"
  3. If search succeeds but DeepSeek does not emit final answer text, wait up to 30 seconds.
  4. Confirm the branch shows "Search completed..." with the retrieved results instead of remaining on a spinner.
- Related: #010, #011.

### #013 — Nested branch opened at one level too shallow
- Date discovered: 2026-05-07
- Date fixed: 2026-05-07
- Agent: Codex
- Symptom: A fourth-level nested branch could appear in the correct parent position in the context tree but show `↳ 3` in the branch panel header.
- Root cause: `branchRowsForThread` merged persisted `depth` values without recalculating them from `parentBid`, and branch open/restore paths trusted those stale values. `applyBranchSnapshot` could then overwrite a correct live depth with an older `snap.depth`.
- Fix: Normalize branch row depths from the `parentBid` chain before rendering/opening context rows. `openBranch` now prefers live parent-derived depth over a supplied override, and `applyBranchSnapshot` no longer lowers an already-correct depth from a stale snapshot.
- Files touched: `notlinear.html`, `BUGS.md`, `CHANGELOG.md`
- Manual test case:
  1. Create a branch from the main page, then create three nested child branches from inside branch panels.
  2. Open the context panel and click the deepest child branch.
  3. Confirm the deepest branch panel header shows `↳ 4`, not `↳ 3`.
  4. Close and reopen the same branch from the context tree or recent branches, and confirm it still shows `↳ 4`.
- Related: #002, #005, #006.

### #014 — Branch URL reads could hang after response headers
- Date discovered: 2026-05-07
- Date fixed: 2026-05-07
- Agent: Codex
- Symptom: Branch research could remain stuck on a status like "Reading closely https://..." after the model chose `fetch_url`, even though tool timeouts existed.
- Root cause: `loggedFetch` applied timeouts only to the initial `fetch()` call. Once headers arrived, `runFetchUrl` called `res.text()` with no timeout, and search/scrape runners called `res.json()` with no timeout. A provider could therefore stall while streaming the response body and leave the branch waiting indefinitely.
- Fix: Added timeout-aware response body readers and routed `fetch_url`, Wikipedia, SearXNG, Serper, Firecrawl, and logged error-body reads through them. Body read starts, ends, and errors are also logged in the runtime log.
- Files touched: `notlinear.html`, `BUGS.md`, `CHANGELOG.md`
- Manual test case:
  1. Open a branch and ask a question that makes the model read a page URL.
  2. If the URL provider returns headers but stalls on the body, wait for the page-read timeout.
  3. Confirm the branch leaves "Reading closely" and continues with a tool error or fallback instead of spinning indefinitely.
- Related: #010, #012.

### #015 — DeepSeek branch research kept searching instead of synthesizing
- Date discovered: 2026-05-08
- Date fixed: 2026-05-08
- Agent: Codex
- Symptom: Branch research appeared stuck while the status kept showing search/read activity even though Serper and page reads were succeeding.
- Root cause: `callDeepSeek` allowed DeepSeek to keep choosing more search and fetch tools until the generic 10-turn tool limit. Logs showed successful Serper 200s, successful body reads, repeated follow-up DeepSeek requests, and then `Reached the 10-turn tool use limit`.
- Fix: Added a bounded DeepSeek tool-round counter. DeepSeek can now perform at most two research tool rounds before the app sends a synthesis-only model request with tools omitted.
- Files touched: `notlinear.html`, `BUGS.md`, `CHANGELOG.md`
- Manual test case:
  1. Open a branch with DeepSeek and Serper configured.
  2. Ask a broad current-information question such as "Tell me more about their product lines".
  3. Confirm the runtime logs show at most two tool rounds for that branch run before a final DeepSeek request without tools.
  4. Confirm the branch produces an answer or the existing synthesis fallback instead of reaching the 10-turn tool use limit.
- Related: #010, #011, #012, #014.

### #016 — DeepSeek pseudo-tool markup leaked into branch answers
- Date discovered: 2026-05-08
- Date fixed: 2026-05-08
- Agent: Codex
- Symptom: A branch answer displayed raw DeepSeek DSML/tool-call markup such as `tool_calls`, `invoke`, `fetch_url`, and `serper_search` instead of hiding or executing it.
- Root cause: `callDeepSeek` streamed `delta.content` directly into the visible answer. When DeepSeek emitted pseudo-tool-call markup as plain content, especially during synthesis-only requests after tool limits, the renderer treated it as normal assistant text.
- Fix: Added a DeepSeek content filter that suppresses streamed DSML-style pseudo-tool-call blocks before they reach `onDelta`. The forced synthesis request now also includes an explicit no-tool-markup instruction, and if filtered pseudo-tool markup leaves too little visible answer text, the app falls back to showing retrieved tool results.
- Files touched: `notlinear.html`, `BUGS.md`, `CHANGELOG.md`
- Manual test case:
  1. Open a DeepSeek branch and ask a search-backed question that previously produced raw `tool_calls` markup.
  2. Confirm no `DSML`, `tool_calls`, `invoke`, `fetch_url`, or `serper_search` markup appears in the visible answer.
  3. Confirm the branch either synthesizes normally or shows the retrieved-results fallback.
- Related: #012, #015.

### #017 — DeepSeek synthesis aborts lost successful tool results
- Date discovered: 2026-05-08
- Date fixed: 2026-05-08
- Agent: Codex
- Symptom: Runtime logs showed successful Serper/fetch tool results followed by a final no-tools DeepSeek synthesis request that was locally aborted, leaving only a tiny partial answer such as 45 characters.
- Root cause: `callDeepSeek` treated all aborts the same. If a local abort happened after tool results were already available but before the synthesis stream completed, the branch went through the normal stopped-response path instead of surfacing the retrieved-results fallback.
- Fix: Added abort-reason logging and a DeepSeek abort salvage path. When a post-tool synthesis request aborts before producing a substantial answer, the app now completes the turn with the retrieved-results fallback instead of preserving a nearly empty partial response.
- Files touched: `notlinear.html`, `BUGS.md`, `CHANGELOG.md`
- Manual test case:
  1. Start a DeepSeek branch question that performs search/read tools.
  2. Abort the branch during the final synthesis request after tool results have returned.
  3. Confirm the runtime log records an `abortReason`.
  4. Confirm the branch shows the retrieved-results fallback rather than a tiny stopped partial answer.
- Related: #012, #015, #016.

### #024 — Toasts hidden behind the Coding Projects overlay
- Date discovered: 2026-05-26
- Date fixed: 2026-05-26
- Agent: Claude (Opus 4.7)
- Symptom: In the Coding Projects view, actions that should toast (browse/add folder, icon updated, comment deleted, "restart the server") appeared to do nothing — no feedback. Made the "open folder" browse button seem broken.
- Root cause: `.toast` is `z-index:300`, but the Coding Projects overlay `#cp-screen` is `z-index:400` (matches `.project-screen`). Any toast fired while the overlay is open renders *behind* it and is invisible. Introduced with the CP02 overlay; surfaced in CP07 when the browse button's "restart the server" toast couldn't be seen.
- Fix: Raised `.toast` `z-index` from 300 → 500 in `frontend/styles/base.css` so toasts always sit above the overlay (400) and other panels. Global change; benefits chat too.
- Files touched: `frontend/styles/base.css`, `BUGS.md`, `CHANGELOG.md`, `docs/project-notes/`
- Manual test case:
  1. Open Coding Projects; click "+ add folder" → browse, or add a project, or update an emoji.
  2. Confirm the toast (e.g. "added <name>", "icon updated") is visible above the overlay.
  3. In chat, trigger a toast (e.g. copy as quote) and confirm it still shows normally.
- Related: separate from the stale-server 404 (that needs a `backend/server.py` restart, not a code fix).

### #025 — "create" buttons on missing-file blocks rendered as clipped 32px squares
- Date discovered: 2026-05-26
- Date fixed: 2026-05-26
- Agent: Claude (Opus 4.7)
- Symptom: On a Coding Projects project page, the "create" buttons in the bugs/tasks/changelog/overview missing-file blocks looked misaligned/broken — the text spilled out of a tiny square border. Most visible when a scan failed (all four blocks showed the missing-file state at once).
- Root cause: `blockHtml` gave the create button class `cp-btn ghost cp-create`. The `ghost` modifier is the **icon-only square** variant — `.cp-btn.ghost{width:32px;padding:0;justify-content:center}` (used by the rescan icon button). Applied to a text button ("create"), it forced a 32px-wide box with the label overflowing the border. `.cp-create{height:26px;margin-left:auto}` could not correct the width because `.cp-btn.ghost` (specificity 0,2,0) outranks `.cp-create` (0,1,0).
- Fix: Dropped `ghost` from that button (`cp-btn ghost cp-create` → `cp-btn cp-create`) in `frontend/views/coding-projects.js`. It now uses the base `.cp-btn` (auto width, `padding:0 12px`) with `.cp-create`'s `height:26px;margin-left:auto`, rendering a properly sized right-aligned text button. No CSS changed.
- Files touched: `frontend/views/coding-projects.js`, `BUGS.md`, `CHANGELOG.md`, `docs/project-notes/`
- Manual test case:
  1. Open a Coding Projects project that is missing at least one of readme/changelog/bugs/tasks.
  2. Confirm the "create" button in each missing block is a normal pill-sized button with the label inside its border, right-aligned in the dashed row — not a clipped square.
- Related: stale-server 404 / #024 (the "scan failed" state that surfaced all four buttons at once is a separate operational issue — restart `backend/server.py`).

### #026 — Notes emoji picker closed before selections registered
- Date discovered: 2026-05-28
- Date fixed: 2026-05-28
- Agent: Codex
- Symptom: In Notes, clicking the large page emoji/icon opened the picker, but selecting a replacement did not update the note icon. The same failure affected callout lead icons.
- Root cause: `openEmojiPop` in `frontend/views/notes.js` had been switched to the shared `openEmojiPicker`, which renders `.cp-pop.cp-emoji-pop`. The Notes document-level `mousedown` outside-click handler still only treated the legacy `#nt-emoji-pop` and `[data-emoji-trigger]` as safe targets, so the first mousedown inside `.cp-emoji-pop` called `closeEmojiPop()` and removed the picker before the icon button's click handler could run.
- Fix: Updated `wireGlobalListeners` to treat `.cp-emoji-pop` as part of the Notes emoji surface: `#nt-emoji-pop, .cp-emoji-pop, [data-emoji-trigger]`. This preserves the shared picker's own outside-click behavior and does not alter note storage.
- Files touched: `frontend/views/notes.js`, `BUGS.md`, `CHANGELOG.md`, `docs/project-notes/`
- Manual test case:
  1. Open Notes and create or select a note.
  2. Click the large page emoji/icon above the title.
  3. Click an icon in the picker and confirm the page header, breadcrumb, and sidebar row update.
  4. Reload and confirm the chosen icon persists from `notlinear-notes`.
  5. Create a callout block, click its lead icon, choose another icon, and confirm it updates.
- Related: 2026-05-26 shared emoji picker changelog entry; Notes v1 entry.

### #027 — Thread opens stayed hidden behind the Notes overlay
- Date discovered: 2026-06-01
- Date fixed: 2026-06-01
- Agent: Codex
- Symptom: While the Notes overlay was visible, clicking New chat or a row in the left Threads list changed the active thread state but did not show the thread. The Notes page remained visible, making the click look like a no-op.
- Root cause: All thread-opening routes converged on `renderThread(...)`, but after the view registry was added, `renderThread(...)` only updated the chat DOM and `currentThreadId`. It did not call `mountView('chat')`, so active full-screen views such as Notes or Coding Projects stayed mounted above the updated chat.
- Fix: Added `mountView('chat')` at the end of `renderThread(...)`. This keeps the existing switch order intact: the old thread is saved and open branch snapshots are captured before `currentThreadId` changes, then the chat view is made visible after the requested thread renders.
- Files touched: `frontend/app.js`, `BUGS.md`, `CHANGELOG.md`, `docs/project-notes/`
- Manual test case:
  1. Start the app and open the left pane.
  2. Click Notes `+` so the Notes overlay is visible.
  3. Click New chat and confirm the Notes overlay closes and the new chat is visible/active.
  4. Click Notes `+` again.
  5. Click `Non-linear chat system` in the Threads list and confirm the Notes overlay closes and that thread is visible/active.
- Related: #008, #009 (chat-switch branch snapshot invariants); Notes v1 view-registry overlay.

### #022 — Highlights panel text was unreadable in light mode
- Date discovered: 2026-05-09
- Date fixed: 2026-05-09
- Agent: Kimi (k2.6)
- Symptom: In the Highlights panel (right-hand drawer), saved highlight text appeared as very light gray on a light background when the app was in light mode, making it nearly impossible to read.
- Root cause: `.highlight-text` had a hardcoded `color:#EAEAEA` instead of using the theme-aware CSS variable `var(--text)`. `#EAEAEA` is designed for dark backgrounds and becomes invisible on light backgrounds.
- Fix: Replaced the hardcoded `#EAEAEA` with `color:var(--text)` so the highlight text color adapts correctly to both dark and light themes.
- Files touched: `notlinear.html`, `BUGS.md`, `CHANGELOG.md`
- Manual test case:
  1. Switch the app to light mode.
  2. Open any chat and highlight some text to save it.
  3. Open the Highlights panel via the topbar button.
  4. Confirm the saved highlight text is clearly readable against the light panel background.
  5. Switch back to dark mode and confirm the text is still readable there.
- Related: none.

### #021 — Attach menu "Add files / Add folder" did not open file picker in WKWebView
- Date discovered: 2026-05-08
- Date fixed: 2026-05-08
- Agent: Kimi (k2.6)
- Symptom: Clicking "Add files" or "Add folder" in the attach popup menu did nothing — no macOS file picker dialog appeared.
- Root cause: The attach menu click handler called `.click()` on pre-existing `<input type="file">` elements that were hidden with `style="display:none"`. WebKit / WKWebView blocks programmatic `.click()` on file inputs hidden via `display:none` as a security measure. The browser silently ignored the call.
- Fix: Replaced the static hidden file input approach with a `triggerFilePicker` helper that dynamically creates a fresh `<input type="file">` element, appends it to `document.body`, calls `.click()` synchronously within the same user gesture, and removes the element after the `change` event fires. This pattern is the most reliable way to open file pickers in WKWebView because the input is guaranteed to be in the DOM and technically visible at the moment `.click()` is invoked.
- Files touched: `notlinear.html`, `BUGS.md`, `CHANGELOG.md`
- Manual test case:
  1. Open Notlinear in the native macOS app (WKWebView).
  2. Click the `+` attach button in the main chat input.
  3. Click "Add files" — confirm the native file picker opens.
  4. Click the `+` attach button again.
  5. Click "Add folder" — confirm the native folder picker opens.
  6. Repeat inside a branch panel — both options should still open the picker.
- Related: none.

### #030 — Project file upload silently failed; files never appeared
- Date discovered: 2026-06-29
- Date fixed: 2026-06-29 (two-part fix)
- Agent: Claude (Haiku 4.5 / Sonnet 4.6)
- Symptom: Clicking "Add files" in the Project panel did not add any files. The file picker would apparently open (or the osascript dialog would open invisibly), but nothing appeared in the project and no error was shown.
- Root cause (primary): `triggerFilePicker` first tries `/__notlinear_open_files` (osascript). When osascript fails or the user doesn't see the native dialog (it opens behind the browser window), the server returns `{"ok": false, "cancelled": true}`. The old code had `if (data.cancelled) return;` — it returned **early without falling through to the browser file picker**. So the user saw nothing happen, and the browser's own picker never opened.
- Root cause (secondary): Even in the browser fallback path, `ev.target.files` (a live FileList) was passed to an async callback. Once the `<input>` was removed from the DOM the FileList became empty — so even if the browser picker did open, the selected files couldn't be read.
- Fix (primary, line 4182): Changed the osascript response handler to only `return` when files were actually delivered (`deliver(fileObjs); return;`). All other paths (cancelled, error, empty) now fall through to the browser picker.
- Fix (secondary, line 4202): Spread FileList into array before removing the input — `const files = [...ev.target.files]`. Also applied preventatively to the four persistent `<input>` change handlers.
- Files touched: `frontend/app.js` (6 event handler locations), `BUGS.md`, `CHANGELOG.md`, `docs/project-notes/`
- Manual test case:
  1. Open the app in a browser (not the native app) and open a project panel.
  2. Click "Add files" — confirm the **browser's native file picker** opens immediately.
  3. Select one or more text/PDF files.
  4. Confirm the files appear as chips in the Project Files row.
  5. Close and reopen the project panel — confirm files persist.
- Related: #021 (same file picker infrastructure).

### #031 — Branches canvas showed fewer branches than Hierarchy, with missing/wrong connector lines
- Date discovered: 2026-07-26
- Date fixed: 2026-07-26
- Agent: Claude Sonnet 5
- Symptom: User reported (with screenshots) that the Branches canvas (`#branch-canvas`, opened via the git-branch topbar button) showed only 1 branch card/edge for a thread whose Hierarchy sidebar (`#ctx-tree`) showed 3 nested branch rows under the same "New chat" thread.
- Root cause: `bcLayout()` (`frontend/app.js`) built its node/edge list from `Object.entries(branches)` — the live, in-memory object populated only for branches that are currently open as floating panels this session. The Hierarchy panel instead calls `branchRowsForThread(tid, state)`, which merges branch anchors scanned from the document's saved HTML, `branchSnapshots`, `branchRecents`, and any live `branches`, giving a complete picture with resolved `parentBid`/depth. Any branch that existed in the doc (or was saved from a prior session) but hadn't been reopened yet was invisible to the canvas — collapsing the visual tree and making it look like branches/connectors were missing or misattached.
- Fix: `bcLayout()` now sources its rows from `branchRowsForThread(tid, threadState[tid])` (same call the Hierarchy panel uses) instead of the raw `branches` object, so both views agree on what branches exist and how they nest. The canvas node-click handler now opens a clicked branch via `openCtxBranch(tid, row)` (resolving from anchor/snapshot data) instead of `openBranch({bid})`, which assumed the branch object already existed in memory.
- Files touched: `frontend/app.js` (`bcLayout`, `bcRender`, node click handler), `BUGS.md`, `CHANGELOG.md`, `docs/project-notes/{CHANGES,RUNS}.md`.
- Test case (see RUNS.md for the automated headless run that exercised this): open a thread with branches that include at least one nested (branch-of-a-branch) child and at least one branch that hasn't been reopened since a reload; open Hierarchy and count/nesting of branch rows; open the Branches canvas and confirm the same count of node cards, same nesting depth (root branches at depth 1, nested children offset one column right), and one connector edge per non-root card.
- Related: none.

### #048 — Fenced code blocks in chat rendered as unreadable flat-gray text, no syntax colors
- Date discovered: 2026-09-06
- Date fixed: 2026-09-06
- Agent: Claude Sonnet 5
- Symptom: User reported code rendered in the UI was "very broken and unable to read."
- Root cause: `renderMarkdown()` (`frontend/core/markdown.js`) escaped fenced-code content straight into a plain `<pre><code>`, with chat.css styling the whole block as one flat `color:var(--text-2)` gray — no syntax highlighting at all, despite `hljs` already being loaded globally (via CDN in `index.html`) and already used by Notes' own code-block *editor* (`highlightCodeEditor` in `views/notes.js`). It had simply never been wired into the shared `renderMarkdown()` path used by chat, Notes' AI-branch replies, and the Coding Projects file preview.
- Fix: `renderMarkdown()` now wraps each fence in a `.code-block` with a header (language label + Copy button); new exported `highlightCodeIn(el)` in `core/markdown.js` runs `hljs.highlightElement` over rendered blocks (same optional-dependency/fail-safe pattern as the existing `renderMermaidIn`), called from every render site across `app.js`/`views/notes.js`/`views/coding-projects.js`. Added a dedicated `--syn-*` syntax-color palette to `tokens.css` per theme (the rest of the app's palette is intentionally near-monochrome) and mapped `hljs-*` classes to it in `chat.css`/`notes.css`/`coding-projects.css`.
- Files touched: `frontend/core/markdown.js`, `frontend/app.js`, `frontend/views/notes.js`, `frontend/views/coding-projects.js`, `frontend/styles/tokens.css`, `frontend/styles/chat.css`, `frontend/styles/notes.css`, `frontend/styles/coding-projects.css`, `BUGS.md`, `CHANGELOG.md`, `FEATURES.md`, `docs/project-notes/{CHANGES,RUNS}.md`.
- Test case (see RUNS.md for the automated headless run that exercised this): send a chat message that gets a fenced-code-block reply; confirm the block shows a header with the fence's language and a Copy button, code has distinct colors for keywords/strings/comments/numbers (not flat gray), and clicking Copy copies the code and briefly shows "Copied". Repeat in a Notes "Ask AI" branch reply and in a Coding Projects file preview with a code fence.
- Related: none.

### #049 — Notes: indented sub-bullets silently dropped from ⌘C copy and Markdown export
- Date discovered: 2026-09-18
- Date fixed: 2026-09-18
- Agent: Claude Sonnet 5
- Symptom: User reported that copying a Notes page (mindgarden.xyz page, "Products" section with a nested list of sub-bullets like "Notlinear", "GYST", "Interview feedback") only copied the top-level bullets — indented children were missing from the clipboard text entirely.
- Root cause: `blocksToText()` and `blocksToMarkdown()` (`frontend/views/notes.js`) only recursed into `b.children` inside the `toggle`-type branch. But per the existing comment at the `renderBlock` call site ("Any block type can gain nested children via Tab-indent, not just toggles"), any block — including a plain `bullet` — can carry indented children via `indentBlock`. Those children were rendered fine on screen but never walked by the two serializers, so ⌘C copy and the "export as .md" feature both silently dropped them.
- Fix: moved the children recursion out of the toggle-specific branch into a type-agnostic step run for every block (skipping `cols`, which already recurses into its own column arrays), so indented children are always emitted regardless of the parent block's type.
- Files touched: `frontend/views/notes.js` (`blocksToText`, `blocksToMarkdown`), `BUGS.md`, `CHANGELOG.md`, `docs/project-notes/{CHANGES,RUNS}.md`.
- Test case (see RUNS.md for a scripted-logic check that exercised this): build a bullet block with nested bullet children two levels deep (mirroring the mindgarden.xyz "Products" list), run it through `blocksToText`, confirm every nested bullet appears with one extra level of indent per depth. Manually: in the app, create a bullet, Tab-indent a child bullet under it, select the page (⌘A ⌘A) and copy (⌘C), paste into a plain-text field and confirm the child bullet is present.
- Related: none.

### #050 — Branch composer: model/mode not visibly changeable
- Date discovered: 2026-09-29
- Date fixed: 2026-09-29
- Agent: Claude Sonnet 5.5
- Symptom: In a chat branch panel the model chip had no chevron (looked static) and there was no mode picker at all, unlike the main composer.
- Root cause: `branchModelChipContents()` rendered the chip with `chevron:false`, and the branch composer template in `frontend/app.js` never included a mode chip.
- Fix: branch chip now shows the chevron; added `.branch-mode-chip` (reuses `#mode-menu`, shared global `prefs.mode`/`prefs.model`, kept in sync via `renderModeUI`/`renderModelUI`); opening one menu closes the other.
- Files touched: `frontend/app.js`, `BUGS.md`.
- Test case: open a branch, click the model chip and the mode chip, pick a different option; both chips (and the main composer's) update and the next branch reply uses them. Not click-tested in a browser this session.
- Related: none.

### #051 — Changing the model in a branch changed the main chat (and vice versa)
- Date discovered: 2026-10-03
- Date fixed: 2026-10-03
- Agent: Claude Sonnet 5.5
- Symptom: Model chips in branches and the main composer were one shared setting.
- Root cause: single global `prefs.model` read/written by the shared `#model-menu`, painted on every `.branch-model-chip`, and used by `sendBranchMsg`.
- Fix: per-branch `b.modelPref` (inherited from parent/main at creation, saved in branch snapshot as `modelPref`); `openModelMenu(anchor, branchId)` targets one composer; `sendBranchMsg` uses `branchModelPref(b)`. Supersedes the "shared prefs.model" note in #050.
- Files touched: `frontend/app.js`.
- Test case: set main=Haiku, branch A=Sonnet, branch B=DeepSeek; each chip keeps its own label, replies use their own provider, and it survives reload/chat switch. Not click-tested this session.
- Related: #050.

### #052 — OpenAI calls fail with 400 `max_tokens` unsupported
- Date discovered: 2026-10-04
- Date fixed: 2026-10-04
- Agent: Claude Sonnet 5.5
- Symptom: Selecting an OpenAI model (e.g. gpt-5.6-terra) failed immediately with "Unsupported parameter: 'max_tokens'... Use 'max_completion_tokens'".
- Root cause: `callOpenAICompatible` always sent `max_tokens:8192`.
- Fix: send `max_completion_tokens` when `providerLabel === 'openai'`; Gemini's compat endpoint keeps `max_tokens`.
- Files touched: `frontend/providers/openai.js`, `BUGS.md`, `CHANGELOG.md`.
- Test case: send a prompt with an OpenAI model; request returns 200 and streams. Not click-tested this session.
- Related: none.
