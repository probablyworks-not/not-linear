# FEATURES.md — not-linear feature inventory

This is the canonical list of **what the product does**, organized by area, at the level of individual buttons/menus/behaviors — not architecture. It complements the other memory files: `CHANGELOG.md` says *when* something shipped, `BUGS.md` says *what broke*, `docs/project-notes/DECISIONS.md` says *why* a design was chosen. This file says **what exists right now, concretely.**

**Keep this current.** Per `AGENTS.md` → "Project memory," any change that adds, removes, or materially changes a feature must update this file in the same session (see "Required updates per change" in `AGENTS.md`). This is a snapshot — edit sections in place, don't append dated entries.

---

## Architecture note

`frontend/` + `backend/app/` (entered via `backend/server.py`) is the canonical, currently-running app (`notlinear.html` at repo root is now just a `meta refresh` redirect stub to `frontend/index.html` for old launcher shortcuts — the migration in `MIGRATION.md` has completed its cutover). Everything below describes the modular tree.

---

## 1. Chat & document core

### Composer (main thread + every branch)

- Autosizing textarea (grows up to 160px). **Enter** sends, **Shift+Enter** inserts a newline.
- Send button doubles as a **Stop** button while streaming (aborts the in-flight request via `AbortController`); disabled when there's no text and no attachments.
- **Paste an image** into the textarea auto-attaches it as a file instead of pasting as text.
- **Attach menu** (`+` chip): Add files, Add folder (recursive, native picker when available), Attach branch (switches the Context panel into a "click a branch to attach/detach" picker mode, with its own toast prompt).
- **Model picker** (chip + menu), 9 models across 4 providers — see §5. Per composer: the main chat and each chat branch hold their own model (a branch inherits from its parent/main at creation, then is independent; saved with the branch). Notes branch panels follow the main model.
- **Extended thinking toggle** — inside the model menu, gated to Sonnet and DeepSeek R1 (see §5 for exact behavior and a reload-persistence quirk).
- **Conversation mode picker** — global (all chats) system-prompt personas. Built-ins: General ("Balanced default"), Research (forces proactive search + a References section), Coding, PM (closes with Impact/Effort/Open-questions), CTO (Recommendation/Key risks/Open decisions), Critic (steel-mans, then Proceed/Revise/Scrap verdict). The menu ends with **New / manage modes**, which opens a modal: list all modes, click a row to edit name / short description / instructions, **+ New mode**, **Reset to default** (edited built-ins), **Delete** (custom only; deleting the active mode falls back to General). A mode is only a system prompt. Stored in `prefs.customModes` / `prefs.modeOverrides` (`core/modes.js`).
- **"Tools" chip** exists in the composer row but is inert — no click handler wired (visual only).
- **Attachment chips** — images get a thumbnail + click-to-fullscreen-preview (Escape/click-outside to dismiss); non-image files show name/size/type icon; a branch attached as context shows its quote + turn count; every chip has a remove (×).
- **Per-turn response actions**: Copy (markdown → clipboard, flips to "Copied!" for 2s), Download .md (native WKWebView save → local-server save dialog → browser File System Access API → `<a download>` blob fallback, in that order), a Sources/References bar when tool results or project-folder context were used, and a Continue button when a reply was cut off by the max-tokens limit (caps at 3 continuations, then "Max continuations reached").
- **Reasoning disclosure** — collapsible panel above the answer, "Reasoning…" while streaming → "View reasoning" once done.
- **Usage/cost meta** — collapsible per-message details: model, tokens in/out, cost, cache-hit tokens, and the full "Context sent to model" dump (entire message list + system prompt + tools) for transparency/debugging.
- **Rotating status copy** while a phase is active — e.g. thinking: "Pondering / Cogitating / Mulling it over / …", searching: "Sleuthing / Scouring sources / …", reading: "Reading closely / Skimming signals / …", synthesizing: "Synthesizing / Stitching pieces / …".
- **Ask AI inline** — from the selection popover, posts `About: "<quote>"` into the main stream and asks about a highlighted passage without opening a branch.
- File handling: PDFs (native text extraction, 6s timeout, >20MB flagged too big, also sent as a base64 document block to Claude), images (native image block, 5MB cap), text-like files (md/txt/csv/json/js/ts/css/html/xml/yml/log, 2MB cap) — oversized/unsupported files degrade to a clear "not included" message rather than failing silently.
- No native HTML5 drag-and-drop zone on the composer/doc — attachment is exclusively via the menu, paste, or native pickers.

### Selection popover ("Pop")

Appears on any text selection in the doc or a branch body:
- **Branch** (primary; also triggerable with the **`B`** key while the popover is showing) — opens a new branch panel seeded with the quote.
- **Highlight** — saves the selection as a highlight, no branch.
- **Ask AI inline** — see above.
- Bold / Italic / Link buttons are present in the markup but **inert** — no handler; clicking them just closes the popover.

### Branching mechanics

- **Highlight → Branch**: wraps the selection in a `.branched` marker, opens a floating panel pinned with the quoted passage ("Branched from doc" / "Branched from branch"), focuses its composer.
- **Branch-the-branch**: highlighting AI text inside an open branch and hitting Branch opens a stacked child branch.
- **Panel header controls**: back-to-parent (↩, nested branches only), Reader/expand toggle (min 620×480, only one branch can be in reader mode at a time), Collapse chevron (opening one branch auto-collapses siblings), "…" menu, Close (×).
- **Depth indicator** (`↳ 2`, `↳ 3`, …) recomputed live from the parent chain.
- **"…" menu**: Make this the main thread (promotes the branch — replaces the doc/stream, pushes the old doc onto the breadcrumb trail), Copy as quote, Close branch, Delete branch (danger-styled, cascades to children).
- **Delete branch** — confirms via the shared dialog, naming how many child branches will also be removed; unwraps `.branched` markup everywhere it's persisted (doc/stream/snapshots) and deletes recents/snapshots.
- **Manual resize** — pointer-drag handles on all edges/corners, clamped to viewport; marks the branch "user-sized" so auto-layout stops repositioning it.
- **Auto-layout ("rebalance")** — branches stack near their anchor's on-screen Y position, avoid overlap, dim/lower z-index when a descendant is focused, and flag "source-out" when their anchor text scrolls off-screen.
- **Recent branches (sidebar)** — collapsible list of recently touched branches across all threads (quote as title, owning thread as subtitle), each openable and independently deletable.
- **Branch canvas** (spatial view, doc toolbar toggle) — full-screen pannable node/edge graph of the current thread's doc + all branches with bezier parent→child edges, node-count badge, click-a-node to focus, Back/Close.
- **Promote to main thread** — sets a new H1 ("Now exploring: …"), a new eyebrow ("Promoted from branch · <time>"), pushes a breadcrumb entry.
- **Breadcrumb history** — clicking an earlier crumb restores that historical doc+stream+message snapshot.
- A branch-edge SVG connector-drawing function exists in code but is permanently disabled (`showEdges = false`) — not reachable by the user.

### Highlights

- Saved from the selection popover; wraps the selection in a `.highlighted` span, recording source metadata (document / main-chat / branch, with branch quote/depth/parent).
- **Highlights panel** — count badge, newest-first list, each row shows a source icon+label ("Document" / "Main chat" / "Branch ↳N · <title>") and the text, click navigates to + flashes the source (opening the owning branch if needed), per-row remove.
- Removing a highlight unwraps its markup everywhere it's persisted; if it was the last reference keeping an otherwise-empty branch alive, that branch's snapshot is pruned too.

### Context / files panel

- **Hierarchy tree**: Workspace → project (if any) → thread pages → **main-chat turn groups** → nested branches, each row opens/focuses its branch and has its own delete button. A top-level branch created by highlighting inside a live main-chat reply is linked to that specific turn and rendered under a `.ctx-turn` header (truncated user prompt visible, full prompt on hover) — turn groups are ordered most-recent-turn-first, and branches within a turn (and within every nested sub-branch level) are sorted most-recently-touched-first. Branches with no recorded turn (highlighted from the static doc, or created before this linkage existed) render ungrouped below any turn groups. Sub-branches render inside a real nested container per parent (`.ctx-branch-children`) with a continuous left guide-line per depth level, rather than flat rows with per-row indentation.
- **Branch row detail**: each branch shows a live turn-count badge (e.g. "4 turns", from `branches[id].messages` falling back to the persisted snapshot — hidden entirely for a branch with no turns yet). Clicking the badge expands an inline preview of the branch's last up to 2 turn-pairs (labeled You/Assistant, truncated to ~200 chars each) directly under the row; click again to collapse. A branch with sub-branches gets a chevron toggle (session-only, resets on reload) to collapse/expand that subtree; toggling, previewing, and deleting are independent of the row's own attach/open click.
- **Page files section** — files attached to the current thread, with size + remove; "Add files to this page" button.
- **Attach-a-branch picker mode** (entered from the composer's attach menu) — toast "Click a branch to add it as context — click again to remove"; clicking rows (not the turn-count/toggle/delete controls) toggles them into the composer's attachment list. Attaching is always whole-branch — no per-turn selection.
- **Context Ranking popover** (brain icon, only visible when the thread belongs to a project with a linked folder) — per-chat override: Global setting (inherit) / Off / Keywords only / DeepSeek (smart).

### Thread map

- Card per thread with ≥1 user message (current thread pinned first): title, message count, branch count.
- **Summarize** per card — DeepSeek call (requires a DeepSeek key, else "No DeepSeek API key — add it in Settings") streaming a structured `ABOUT:` / `IDEAS:` digest that includes branch transcripts; retry on failure.

### Sidebar

- Search (⌘K hint), New chat (⌘N hint).
- **Projects section** — collapsible; "View all projects" grid icon, "New project" +; rows show emoji/icon (click → picker), name, "…" settings (opens the project panel).
- **Threads section** — collapsible; each row has an icon button (click/Enter/Space → picker), title, delete (except pinned `doc-main`); threads that belong to a project are hidden from this flat list.
- **Notes section** — collapsible, "Delete all notes" and "New note" icon buttons.
- **Product story entry** ("✨ Product story") — opens the fullscreen changelog player.
- **Recent branches section** — collapsible, dynamic (see Branching above).
- Section collapse states persist to `localStorage` (`nl_side_collapsed_v1`).
- Footer: avatar (first letter of display name) + name + gear → Settings.
- Hamburger toggles the sidebar; overlays with a click-to-close scrim on narrow viewports, auto-closes after most navigation there.
- Shared emoji/Mind-Garden icon picker on every thread/project/doc-title glyph, synced everywhere it appears.
- **Unread indicator** — thread rows flag `.has-unread` (and an updated aria-label) when a background/streaming response completes on a thread that isn't active.

### Tab strip

- Every open thread is its own closable tab (Notion-style); every open note page is its own closable `note:<id>` tab; Notes index / a blank "New tab" are singleton tabs.
- `+` opens a blank tab with quick actions: New chat, Existing chat (search palette), Projects, Notes.
- Closing the active tab falls back to the next-most-recent, or `doc-main` if none remain.
- Open tabs and the active tab id persist to `localStorage` (`nl_tabs_v1`).

### Projects

- **Grid view** — search box, sort (Last updated / Name), card grid (icon, name, thread count, relative "Updated Xh ago"), New project.
- **Project panel** (per project, overlay) — editable name; New chat / Add existing chat (toggles an ungrouped-chats picker); chat list per chat: open, "Remove from project" (keeps the chat, moves it back to Threads), Delete chat (confirm); **Project rules** textarea (custom instructions applied to every chat/branch in the project's system prompt); **Project files** — Add files, Link folder…/Unlink (native picker, shows the linked path, unlinking clears the scan cache); Delete project (confirm dialog, explicitly states chats are kept and moved back to Threads).
- **Linked-folder context injection** — sending a message triggers keyword extraction + optional DeepSeek semantic rerank, selecting up to 10 relevant files from the folder scan, injected as `<project_file>` context with a "Sources (DeepSeek):" or "Sources (keywords):" bar on the response.

### Search palette (⌘K)

- Searches Threads (title) and Branches (quote text + owning thread title), grouped headers, match highlighting.
- Arrow Up/Down to navigate, Enter to select (active or first result), click also selects.
- Closes via Escape, scrim click, or ⌘K again.

### Settings / Preferences

- **Appearance** — Dark ("Black mono") / Grey ("Softer dark") / Light ("Bright & clean"), applied immediately, persisted.
- **Workspace name** — reflected in breadcrumbs and the context-panel folder row.
- **"What should AI call you?"** — used in the system prompt and the sidebar avatar initial.
- **Tone preset** — Concise / Friendly / Formal / Technical / Socratic, each a distinct system-prompt instruction applied everywhere.
- **"What are you working on?"** — free-text, injected into the system prompt.
- **Default model** — same 9-model grid as the composer picker.
- **API Keys** — provider dropdown (Anthropic/Claude, DeepSeek, Serper, Firecrawl, OpenAI, Google/Gemini, Other), masked rows once connected (`abcd••••••••wxyz`), disconnect ×; stored in `localStorage`, "only sent to their respective APIs."
- **Context Ranking** — Keywords only (free, instant) vs DeepSeek (keyword gen + rerank, ~$0.0003/query); needs a DeepSeek key, only applies to projects with a linked folder.
- **Web Search (SearXNG)** — URL to a self-hosted instance (needs CORS enabled); blank disables the `web_search` tool.
- **Changelog** — "View changelog" loads `CHANGELOG.md` (bundled fallback on fetch failure), parsed into date-grouped "story chapters" with Older/Newer paging + dot indicators, a "Play the story" button, and a manual refresh.
- **Feedback** — "View bugs & ideas" lists entries from the floating Feedback panel with a count summary and refresh; help text: "Logged anywhere with ⌘⇧B. Saved to feedback/FEEDBACK.md for the coding agent."
- **Runtime logs** — "View request logs" shows the in-memory request log (newest first) with Refresh, Copy (toast "Logs copied"/"Could not copy logs"), Clear (toast "Logs cleared"); also debounced-syncs to a local `logs.md` file when running on `localhost`/`127.0.0.1`, with a status line ("logs.md sync pending/synced/unavailable").

### Product story (fullscreen changelog player)

- Segmented per-chapter progress bar (thin tick segments), "Update N of M · <date>" meta, hero icon/color per chapter, narrative text, tagged item list (Fix/Feature/Improvement, each with its own icon/color, rendered as clearly-bordered chips), Prev/Next, close (×); Next on the last chapter closes it; Escape closes it too.
- Starts at Update 1 = the newest chapter; Next walks backward through history toward the oldest (matches the inline "Older/Newer" pager's newest-first convention).

### Delete confirmation

- Shared modal for chats/branches/projects: heading + description with the item name interpolated, Cancel / destructive action.
  - Chat: "Delete chat?" / "This removes '<title>' from the left panel and clears its saved messages."
  - Branch: "Delete branch?" ("Delete branches?" if it has children, naming how many will also go).
  - Project: "Delete project?" / explicitly notes chats are kept and moved back to Threads.
- Enter (Delete button focused) confirms; Escape cancels; scrim click cancels.

### Toasts (representative set)

"Model set to …", "Mode: …", "Extended thinking on/off", "Highlight saved/removed", "Branch promoted to main thread", "Branch/Branches deleted", "Chat deleted", "New chat opened/in project", "API key connected", "Project deleted", "Folder linked/unlinked", "Chat added to project", "Added N file(s) to project", "Logs copied/Could not copy logs/Logs cleared", "Click a branch to add it as context — click again to remove", "Copied source quote", plus error fallbacks ("Could not highlight that selection", "Source text is no longer on this page", "Opened source branch", "Parent branch is no longer available").

### Update-available banner

- Polls the current page every 5s (HEAD, comparing `Last-Modified`/`ETag`/`Content-Length`); shows a "New update - refresh" pill once the file changes after the first baseline read; clicking it saves the current thread and reloads.

### Keyboard shortcuts (consolidated)

| Shortcut | Scope | Effect |
|---|---|---|
| `Enter` / `Shift+Enter` | composer | send / newline |
| `B` | selection popover visible | Branch |
| `⌘K` / `Ctrl+K` | global | toggle search palette |
| `⌘N` / `Ctrl+N` | global | new chat |
| `⌘⇧B` / `Ctrl+Shift+B` | global | toggle Feedback panel |
| `⌘Q` / `Ctrl+Q` | native shell only | toggle Feedback panel (browsers reserve ⌘Q) |
| `Escape` | global | prioritized close-stack: branch canvas → story player → search palette → delete-confirm → modes modal → project panel → projects grid → sidebar (mobile) → context-ranking popover → model menu → mode menu → branch "…" menu → context panel → prefs → else hide selection popover |
| `Enter` | delete-confirm, Delete focused | confirm |
| `↑`/`↓` + `Enter` | search palette | navigate / select |
| `⌘B`/`⌘I`/`⌘U` | Notes floating toolbar | Bold/Italic/Underline (see §2) |

---

## 2. Notes

Full block-based notebook, own Dexie db `notlinear-notes` (kept separate from chat persistence, ADR-007), full-screen overlay view.

### Pages & sidebar tree

- **Create**: `+` on the sidebar header or a row's "add subpage" button; new page gets a default `📄` and one empty text block, auto-focused.
- **Nesting**: arbitrary-depth subpages, indented tree.
- **Drag-to-reparent**: drag a row onto another to nest it; drop on blank tree space to make it top-level; self/descendant drops are blocked (no circular reparenting).
- **Duplicate**: deep-copies the page **and its entire subpage subtree** with fresh block ids, inserted as a sibling right after the source; toast "page duplicated". (Ask-AI branches are not copied — they're keyed to block ids that no longer exist post-copy.)
- **Delete**: confirmation names how many subpages will also be deleted; removes the whole subtree; toast "Note deleted"/"Notes deleted".
- **Delete all notes** — sidebar action, wipes every page after confirmation.
- **Rename** — the page title itself is a `contenteditable` H1; live-updates sidebar + breadcrumb.
- **Icon/emoji** — shared Mind Garden picker; also supports a **custom uploaded image icon** (downscaled to 128×128 PNG, stored as `img:<dataURL>`), with a remove-custom-icon button reverting to default.
- **Cover image** — Add cover; once set: Reposition (drag vertically, persists `posY`), Change, Remove. Downscaled to max 1600px width, JPEG q0.85.
- **Expand/collapse** per row (chevron, only shown when a row has children), state persisted; sidebar tree section also has its own independent collapse.
- Sidebar header click opens the **all-pages index**.

### All-pages index

- Opened from the "Notes" breadcrumb, sidebar header click, or automatically when there's no valid selected note.
- Header: page-count subtitle ("N pages"), "New page" button.
- **Bento grid** of root-level pages (`nt-bento`), CSS `auto-fill`/`grid-auto-flow:dense` so column count adapts to width with no JS breakpoints; the most recently edited page renders as a larger "featured" 2×2 card (falls back to 1×1 under 640px).
- **Sorted by recency**: every note carries `createdAt`/`updatedAt`; `updatedAt` is bumped on any real content edit (title, tags, cover, blocks, branch messages — see `touchSelected()` in `frontend/views/notes.js`), not on structural/UI-only actions (sidebar fold, opening a note, delete, reparent). Root pages are sorted newest-edited-first.
- Each card shows title (or italic "Untitled") and "N blocks" / "N subpages" / a real "updated X ago" (`timeAgo()`) meta line — no body-text preview subtext (removed after user feedback that it read as clutter). Subpages are **not** nested inline in the grid (flat card layout) — reachable via the sidebar tree or by opening the parent.
- **Icon identity, no badge**: cards carry no small icon glyph next to the title. Instead each gets (1) a subtle full-card background tint and (2) a giant, faint "corner bloom" of the note's own icon bleeding off the bottom-right corner (never top-right, to stay clear of the hover add/delete buttons). Both come from the same hashed palette (`tintFor()` — 8 curated bg/fg swatch pairs, `--bento-t0..t7-bg/-fg` in `notes.css`, themed for dark-mono/light, tuned light so the wash reads as a hint of color rather than a distinct colored card) keyed off the note's `emoji` field, so the same icon always lands on the same tint. For a Mind Garden `icon:<id>` token, the bloom is genuinely colorized with the tint's color via `renderIconSvg` — unless the user already picked an explicit color for that icon, which always wins. Skipped for uploaded photo (`img:`) icons.
- A dashed "New note" tile sits at the end of the grid alongside the header's "New page" button.
- Hover actions per card: add subpage, delete page. Click navigates in.
- Empty state: "No pages yet — create your first one."
- The single-page view's meta line ("N blocks · updated X ago · …") uses the same real `timeAgo()` value now, no longer a hardcoded "just now".

### Block types

| Type | Notes |
|---|---|
| text | default; placeholder "Type '/' for commands" when focused-empty |
| h1–h4 | feed the auto TOC; typing shortcuts `#`–`####` + space |
| bullet | `- `/`* `/`+ ` shortcut |
| numbered | `1. ` shortcut; index recomputed live on reorder/delete |
| todo | `[] `/`[ ] ` shortcut; checkbox toggles `done`, strikethrough+dim when done |
| toggle | collapsible with children; drop another block on its right two-thirds to nest it |
| toggle heading (1–4) | toggle + heading size |
| quote | `> ` shortcut |
| callout | emoji-led box, independently click-to-change emoji (default 💡) |
| divider | `--- ` shortcut, no editable text |
| code | language picker (plain/js/ts/python/rust/go/html/css/sql/json/bash), live/on-blur `hljs` syntax highlighting with caret preserved across re-render, copy button |
| eq (block equation) | LaTeX source + live debounced (300ms) KaTeX preview; invalid LaTeX shows an inline error instead of breaking |
| image | file upload (dataURL) **or** paste-a-URL (stored raw, not re-encoded) **or** drag-drop of a file/URI; resizable (bottom-right handle, 120px–container clamp, persists width); broken-image (404) shows a "click to replace" placeholder; editable caption |
| toc | derived/non-persisted; auto-collects all h1–h4 across the page (incl. inside toggles/columns), indented by level, click-to-jump-and-flash, live-refreshes on every heading edit |
| table | editable grid, first row as header; + row / + column toolbar buttons (extends all rows uniformly) |
| cols (2 or 3) | each column is its own independent block list, any block type nestable inside; empty column shows a "click to add" affordance |
| page-link | inline sub-page reference; click navigates, or (unbound placeholder) creates+binds a fresh subpage on click |
| (generic) | any other type falls back to a plain rich-text `contenteditable` editor |

Per-block actions (gutter): add block below (+), drag handle (reorder among siblings, or drag-to-nest into a toggle), block menu (del / dup via a `prompt()`-based mini menu), type conversion (slash menu or the toolbar's "Turn into"), and a **branch badge** (git-branch icon + count) that opens the block's most recent AI branch if any exist.

### Slash menu (`/`)

- Triggers at the end of a non-whitespace run in any rich-text block; live substring filter as you type; section headers (Basic blocks / Media & content / Advanced) hide when empty.
- Nav: ↑/↓ move highlight, Enter/Tab picks, Escape closes; mouse hover/click also work.
- Items: Text, Page, Heading 1–4, Bulleted list, Numbered list, To-do list, Toggle list, Code, Quote, Callout, Divider, Image, Table, Toggle heading 1–3, 2 columns, 3 columns, Block equation, Table of contents. (No database/synced-block/button items — those remain unbuilt.)

### @-mention (`@`)

- Triggers at the end of a non-whitespace run following `@` in any rich-text block (same before-caret scan technique as the slash menu); live substring filter across two sections — **Notes** (every page, by title) and **Chats** (every thread in `appState.threadState`, by title) — 8 results per section.
- Nav: ↑/↓ move highlight, Enter/Tab picks, Escape closes; mouse hover/click also work.
- Picking an item inserts an inline, atomic (`contenteditable="false"`) chip — 📄 + title for a note, 💬 + title for a chat — at the caret, same DOM technique as the existing inline-equation feature (wrap-via-Range, not a whole-block rebuild), so it never disturbs other rich formatting (bold/italic/links) already in the same block. A trailing space is auto-inserted so typing continues normally right after it.
- **Click a chip to open it**: a note chip opens/focuses that note as its own tab in the tab strip; a chat chip opens/focuses that chat as its own tab (reuses the existing tab if already open, via small `registerNoteOpener`/`openNoteTab` and `registerChatOpener`/`openChatTab` bridges in `core/registry.js` — the seam between Notes and the still-un-modularized chat/tab-strip code in `app.js`).
- Chips are plain inline HTML stored in the block's existing `b.text` field — no schema change, no new block type.

### Floating format toolbar

Appears on any non-collapsed text selection: **Bold, Italic, Underline, Strikethrough, Code** (wraps in `<code>`), **Equation** (converts selection to an inline KaTeX span, click-to-edit via prompt), **Link** (prompt for URL), **Branch** (starts an Ask-AI thread anchored to the selection), **Color** picker (red/orange/green/blue/purple swatches), **Highlight** picker (yellow default + blue/green/pink/gray), **"Turn into"** (block-type conversion from the toolbar, same as the slash menu).

### Inline comments — "Ask AI" branches

The actual comment/thread system is AI-chat branches, not plain comments. The panel UI/interaction model is shared with chat's branch panels (`.branch`/`.branch-stack`/`.branch-menu` in `chat.css`) — same floating card, resize, reader mode, and collapse behavior — while the data, persistence, and backend call stay entirely separate from chat (own `note.branches[]`, `notlinear-notes` db, no nesting). See ADR-028.
- **Anchored**: select text in a branchable block (text/h1-4/bullet/numbered/todo/toggle/quote/callout) → toolbar "Branch" wraps it in a `data-bid` span (`.nt-br-anchor`) and opens a floating panel.
- **Note-wide**: bottom-of-page "Ask AI about this note…" CTA creates an unanchored branch (`quote:null, blockId:null`).
- **Panel** (floating, right side, `#nt-branch-stack`): pinned near its anchor's on-screen position (auto-repositions on scroll/resize, same rail/declutter algorithm as chat's branches minus the ancestor-chain logic — Notes branches don't nest). Quoted-passage header for anchored branches, scrolling message list (user right-aligned, AI rendered via the shared markdown renderer), auto-grow composer (Enter to send, Shift+Enter newline).
- **Panel controls**: Expand/reader toggle (min 620×480, only one branch reader at a time), Collapse chevron (header click), manual resize (drag handles on all edges/corners, clamped to viewport, marks it "user-sized" so auto-layout stops repositioning it), "…" menu (Copy as quote / Close / Delete — no "make main thread", Notes has no main-thread concept), Close (×). Opening a branch closes any other open note branch (flat, one active panel at a time, matching chat's behavior for non-nested branches).
- **Backend**: Claude (`claude-sonnet-4-6`) or DeepSeek depending on which key exists; model label shown ("Claude"/"DeepSeek"/"No API key"); send button doubles as stop/abort while streaming. Unchanged — only the panel chrome moved, not the model/attachment feature set (no per-branch model picker or attachments, unlike chat).
- **System prompt**: the note's breadcrumb path + up to 3000 chars of stripped page text, plus the quoted passage if anchored.
- **Reopen**: click the highlighted anchor span, or the per-block branch-count badge (opens the most recent).
- **Delete**: unwraps the anchor span back to plain text, removes the branch record, closes the panel.
- **Anchor pruning**: runs on every render — if the anchor text was deleted directly from the block, the orphaned branch is silently dropped (and its open panel, if any, closes) so stale anchors never linger.
- **Geometry persistence**: collapsed/reader/width/height/top are saved onto the branch record (`notlinear-notes`, additive fields) and restored next time the panel opens; panels close automatically when navigating to a different note, the notes index, or out of the Notes view entirely.

### Keyboard shortcuts

- Markdown typing shortcuts: `# `/`## `/`### `/`#### ` → headings, `- `/`* `/`+ ` → bullet, `1. ` → numbered, `[] `/`[ ] ` → todo, `> ` → quote, `--- ` → divider.
- `⌘/Ctrl+B/I/U` — bold/italic/underline; `⌘/Ctrl+E` — inline code; `⌘/Ctrl+Shift+H` — highlight wrap.
- `⌘/Ctrl+A` — first press selects the current block's text; a second press (or on an already-fully-selected/empty block) selects **every block on the page**.
- `⌘/Ctrl+A` → `⌘/Ctrl+C` (page-wide selection) — copies the whole page as plain text (markdown-ish serialization: `#`, `-`, `[x]`, `>`, fenced code, `|`-joined table rows); toast "page copied".
- **Drag-select across blocks**: mouse-dragging from one block into another highlights every top-level block in the dragged range (each block is its own `contenteditable`, so the browser can't natively extend a selection across them — this is a custom highlight + `⌘/Ctrl+C` copies the selected blocks as the same markdown-ish plain text, toast "selection copied"). Dragging within a single block still uses native text selection, untouched. Click elsewhere or `Escape` clears the highlight. Not supported for selections starting/ending inside a toggle's children or a column (top-level blocks only).
- `Enter` — new block after current (inherits type for bullet/numbered/todo, else text); on an empty block, demotes it to text instead (exits heading/list/quote/toggle).
- `Backspace` at start of an empty block — demotes special types to text first, then (if already text) merges into the previous block.
- `↑`/`↓` at caret start/end — cross-block caret navigation to the previous/next sibling.
- `Tab` — indents the current block: it becomes the last nested child of its immediately preceding sibling (any block type, not just bullets — same `children` array toggle blocks already use). `Shift+Tab` outdents it back out to sit right after its former parent. If there's no preceding sibling to nest under (e.g. the page's first block), Tab inserts a literal tab character instead of doing nothing. Bug #040 / ADR-025.

### Export

- Download icon in the Notes topbar (hidden on the all-pages index, visible on any open page) exports the current page as a single self-contained **Markdown** file.
- **Recursive by default**: walks every subpage of the page — both sidebar-tree children (`parent`) and in-content `page-link` block targets — transitively, and appends each as its own `## <title>` section in the same file, separated by `---`; a visited-set guards against duplicates and link cycles regardless of which relationship a given subpage came from. Nested-only reference (a `[title](#slug)` link) is left in place at the point the subpage was linked.
- **Images travel with the file**: image blocks are stored as base64 data URLs already (`b.src`), so `![caption](data:...)` embeds render inline in any markdown viewer that supports data-URI images (VS Code, Obsidian, GitHub) — no separate asset files or zip needed.
- Block-level structure (headings/lists/todo/quote/callout/code fences/tables/dividers) is converted to real Markdown syntax; inline formatting (bold/italic/links/highlights) is left as the block's stored HTML rather than converted, since Markdown natively allows embedded HTML and every common renderer accepts it.
- Save path reuses the same fallback chain as the chat "Download .md" action: native WKWebView bridge (desktop app) → server-side `/__notlinear_save_file` (native macOS Save dialog) → browser `showSaveFilePicker` → plain `<a download>` blob link.
- Filename is the page title (sanitized), `.md` extension.

### Explicitly not present

- **No search** within Notes (no search input/index/filter anywhere).
- **No app-level undo/redo** — only the browser's native per-field `contenteditable` undo.
- **No HTML/PDF export, no import.** Export is Markdown-only (see above); there's no "current page only" toggle — export is always the page + its subpages.

### Other details

- Free-text **tags** per page (`# tagname` pills), add via inline input (Enter commits), remove via ×.
- Page meta line: live block count, static "updated just now" text, top-level vs. "subpage of \<parent\>".
- Autosave debounces 180ms to Dexie `notlinear-notes`; a one-time migration imports any pre-existing `nl_notes_v1` localStorage payload on first load.
- Clicking blank space below the last block appends (or focuses an existing empty) text block.
- Theme-aware throughout via existing CSS custom properties.

---

## 3. Coding Projects

**Removed 2026-09-29.** See `docs/coding-projects-archive.md` for what it did and how to restore it.

---

## 4. Feedback capture (⌘⇧B / ⌘Q)

- Draggable floating panel (drag by header), toggled globally with ⌘⇧B (and ⌘Q in the native shell only). Escape closes it (only while focus is inside and no capture-preview overlay is open); closing is blocked with "Recording still running — stop it first" mid-recording. Shows a context line: `<active view id> · <current thread id>`.
- **Bug / Idea** toggle — switching to Idea hides the media row and swaps the textarea placeholder ("What happened?" → "What's the idea?").
- **Screenshot** and **Record** buttons each open a capture-mode menu: "Select area" or "Full screen".
- **Screenshot flow**: panel hides itself first (so it's not in the shot) → native capture → preview overlay opens with the image, or a toast on failure/cancel.
- **Recording flow**: starting flips the button into a live "Stop · m:ss" timer (updates every 500ms); stopping opens a video preview; cancel/failure show the corresponding toast. **One recording at a time** — starting a second is rejected outright.
- **Preview/annotate**: images get freehand pen annotation (red strokes, adaptive width) with Undo and Clear annotations; videos get an inline muted-autoplay player instead (no annotation tools). Footer: Discard (deletes the file from disk) or "Add to report" (flattens any pen strokes into the image before attaching).
- Attached media renders as removable chips (removing only detaches it from the report — the file stays on disk).
- **Save** posts type + text + media + `{view, thread}` context; requires text or ≥1 media; blocked mid-recording. Toast: `"Saved FB-00N → feedback/FEEDBACK.md"`.
- **Feedback log** (in Settings, not the floating panel) — "View bugs & ideas": Bug/Idea badge, id, date, status badge, body, originating view/thread, clickable links to attached media; manual refresh.

---

## 5. Model providers & tools

### Models offered (composer picker + Settings default-model grid — identical 9 options)

| Menu label | Tagline | Internal pref | API model id | Provider |
|---|---|---|---|---|
| Opus 4.8 | Best reasoning | `opus` | `claude-opus-4-8` | Claude |
| Sonnet 4.6 (default) | Best balance | `sonnet` | `claude-sonnet-4-6` | Claude |
| Haiku 4.5 | Cheap, fast | `haiku` | `claude-haiku-4-5-20251001` | Claude |
| DeepSeek Chat | Fast, cheap | `deepseek` | `deepseek-chat` | DeepSeek |
| DeepSeek R1 | Deep thinking | `deepseek-r1` | `deepseek-reasoner` | DeepSeek |
| GPT-4o | OpenAI flagship | `gpt-4o` | `gpt-4o` | OpenAI |
| GPT-4o Mini | Fast & cheap | `gpt-4o-mini` | `gpt-4o-mini` | OpenAI |
| Gemini 2.0 Flash | Fast, multimodal | `gemini-flash` | `gemini-2.0-flash` | Gemini (OpenAI-compatible) |
| Gemini 2.5 Pro | Best reasoning | `gemini-pro` | `gemini-2.5-pro-preview-05-06` | Gemini (OpenAI-compatible) |

Every chat and every branch can independently choose its own model. Selecting one toasts "Model set to \<label\>". **No automatic cross-provider fallback on error** — each provider simply surfaces its error (see below); there's no silent retry or model-switch built in.

### Missing-API-key messages

- Claude: "No API key — add your Anthropic key in Settings (⚙)."
- DeepSeek: "No DeepSeek API key — add it in Settings (⚙)."
- OpenAI/Gemini: "No \<openai|gemini\> API key — add it in Settings (⚙)."

### Extended thinking mode

- Toggle enabled only for Sonnet and DeepSeek R1; note text: "Deeper reasoning. Adds 3–8s. Sonnet only." (or, for R1: "DeepSeek R1 always reasons — toggle shows/hides it."). Toggling toasts "Extended thinking on/off".
- Claude: request adds `thinking:{type:'enabled', budget_tokens:8000}` and raises `max_tokens` 8192→16000; streamed `thinking_delta` renders as the "Reasoning…" panel. (Quirk: Opus can also carry thinking if the toggle was already on from a prior Sonnet selection — the UI only lets you *turn it on* from Sonnet/R1, but doesn't force it off when you switch to Opus.)
- DeepSeek R1 always reasons server-side; the toggle only controls whether that reasoning is *displayed*.
- Not available at all for GPT-4o/GPT-4o-mini or Gemini.
- **Quirk**: `prefs.thinking` is saved like any other pref, but the load path force-resets it to `false` on every page load — it never survives a reload and must be re-enabled each session.

### Tool-use loop, per turn

- Hard cap of **10 model requests per turn** across all providers ("Reached the 10-turn tool use limit — try a more specific question.").
- DeepSeek additionally caps actual **tool-calling rounds at 2** (`DEEPSEEK_MAX_TOOL_ROUNDS`); after that it's forced into synthesis-only mode even under the 10-request ceiling.
- Live status line per tool: `Searching Wikipedia for "<query>"…`, `Searching Google for "<query>"…`, `Searching for "<query>"…`, `Scraping <url>…`, `Reading <url>…`; Claude shows `Running <N> searches in parallel…` for concurrent tool calls; post-tool status becomes `Thinking…` (Claude/OpenAI) or `Synthesizing tool results…`/`Synthesizing answer from retrieved sources…` (DeepSeek).

### Error messages (exact text, per provider)

**Claude**: 401 → "Invalid API key — check it in Settings." · 429 → "Claude rate limit hit — wait a moment, switch models, or reduce concurrent chats." · 402/"credit" → "Out of credits — top up at console.anthropic.com." · 529 → "Claude is overloaded right now — try again in a moment." · network → "Network error — check your connection." · cut stream → "Stream interrupted — partial response preserved."

**DeepSeek**: 401 → "Invalid DeepSeek API key." · 429 → "DeepSeek rate limit hit — wait a moment, switch models, or reduce concurrent chats." · 402 → "DeepSeek out of credits — top up at platform.deepseek.com."

**OpenAI/Gemini**: 401 → "Invalid \<provider\> API key — check it in Settings." · 429 → "\<Provider\> rate limit hit — wait a moment or switch models."

`friendlyError()` further rewrites several of these into more actionable copy (e.g. suggesting a specific alternate model/provider to switch to for that specific rate-limit).

### Timeouts

| Constant | Value | Applies to |
|---|---|---|
| `MODEL_CONNECT_TIMEOUT_MS` | 70s | initial LLM connection |
| `MODEL_STREAM_IDLE_TIMEOUT_MS` | 120s | model stream goes silent |
| `TOOL_SYNTHESIS_IDLE_TIMEOUT_MS` | 30s | DeepSeek tool-result synthesis stall |
| `TOOL_TIMEOUT_MS` | 20s | generic tool default |
| `SEARCH_TIMEOUT_MS` | 12s | Wikipedia / SearXNG / Serper |
| `PAGE_READ_TIMEOUT_MS` | 8s | `fetch_url` (Jina) |
| `SCRAPE_TIMEOUT_MS` | 24s | Firecrawl |

### DeepSeek pseudo-tool-call handling (user-visible quirks)

- DeepSeek occasionally leaks fake tool-call markup (`<｜tool▁calls｜>`, `<invoke>` variants) into plain text; this is actively detected and stripped before display, buffering a 180-character trailing window so a partial tag never flashes on screen before being filtered.
- If a whole response gets filtered as pseudo-tool markup but real tool results exist, the raw retrieved results are shown instead of nothing, prefixed: *"Search completed, but the model stalled while turning the results into a final answer."* + numbered source sections (long content truncated at 5000 chars).
- If the final visible answer is under 500 characters after markup was stripped, the same fallback content is appended automatically so the user isn't left with an unhelpfully thin answer.
- On abort mid-stream with unused tool results and little text, the fallback is shown before reporting the abort — an interrupted DeepSeek research turn still surfaces the raw sources.

### Tools available to the model

| Tool | What it does | Requires | Timeout | Notable limits/errors |
|---|---|---|---|---|
| `wikipedia_search` | Searches Wikipedia, fetches the top hit's summary + 2 related titles | — | 12s | "No Wikipedia results found for: \<query\>" |
| `fetch_url` | Reads a URL via Jina Reader (`r.jina.ai`) | — | 8s | windowed to 4000 chars per call; model can pass `offset` (resume position) or `query` (jump to a match) to read further; shared per-session cache by URL across all providers |
| `web_search` | Google-style search via self-hosted SearXNG | SearXNG URL in Settings | 12s | fatal if unconfigured: "Web search is not configured. Add a SearXNG URL in Settings, or add a Serper key." |
| `serper_search` | Google search via Serper.dev, incl. a direct-answer box | Serper API key | 12s | fatal if missing key; 429 → "Serper search is rate limited. Wait a moment and try again." |
| `firecrawl_scrape` | Full-page scrape to markdown via Firecrawl | Firecrawl API key | 24s (longest) | windowed to 6000 chars per call; model can pass `offset` or `query` to read further; fatal if missing key |

Non-fatal tool errors are fed back to the model as `Tool error (<name>): <message>` so it can try something else; *fatal* tool errors (missing required config/key) abort the whole turn and show the message directly to the user.

`fetch_url`/`firecrawl_scrape` never dump a whole long page at once: each result is a bounded window into the page ending with a `[showing chars X-Y of TOTAL. Call again with offset:Y to continue, or query:"term" to jump to a match.]` note when there's more to read, so the model can page through a page longer than one window or jump straight to a relevant section instead of only ever seeing the head of the document (see ADR-029).

### Markdown rendering (chat/branch responses)

Bold/italic, inline code, markdown + auto-linked bare URLs, full GFM-style pipe tables (with column alignment), fenced code blocks, **Mermaid diagrams** (dark-themed, `securityLevel:'loose'`, rendered client-side, graceful fallback while a fence is still streaming/unclosed), headings, horizontal rules, ordered/unordered lists, and two LLM-output-specific heuristics: "label lines" (`Label: value` → styled as a mini definition line) and auto-inserted paragraph breaks before common field labels (`Model:`, `Status:`, `References:`, `Source(s):`, etc.) so compact/glued model output still displays as separate lines. **No LaTeX/math rendering** in chat (that's Notes-only, via KaTeX).

**Fenced code blocks** render with real `hljs` syntax coloring (a dedicated `--syn-*` color palette per theme, since the rest of the app's tokens are deliberately monochrome) and a header bar showing the fence's language plus a **Copy** button (copies the code, label flips to "Copied" briefly). The same treatment applies to Notes' AI-branch replies and the Coding Projects markdown file preview, since all three share `core/markdown.js`'s `renderMarkdown()`/`highlightCodeIn()`.

---

## 6. Core UI infrastructure

- **Toast system** — single bottom toast, auto-hides after 1800ms, resets its timer on rapid repeats so toasts don't cut each other off.
- **Delete confirm dialog** — generic reusable modal (Promise-based); focus starts on Cancel (safe default against a stray Enter), restores focus to whatever triggered it on close.
- **Emoji/icon picker** — despite the name and a 210-entry curated emoji list still present in code, the actual picker popover **no longer offers emoji at all**; it's Mind-Garden-icons-only (comment in code: "Mind Garden is the single source of glyphs across the app"). The raw emoji list is still used directly elsewhere (e.g. the inline add-project quick-grid). Picker: live keyword search, an 11-color tint palette, Escape closes, Enter picks the first filtered icon, outside-click closes; fixed 300×380px popover, viewport-clamped.
- **Mind Garden icon system** — 251 hand-drawn SVG icons across 21 sections, parsed once from a design sheet (`frontend/mind-garden-icons.html`) and cached for the session, each renderable at any size in `currentColor` or one of **11 fixed tint colors** (default/black/gray/brown/mustard/orange/green/blue/purple/pink/red). Sections: Flowers, Trees, Leaves & Greenery, Fruits & Seeds, Birds, Helpful Creatures, Snakes & Weeds, Mind & Philosophy, Elements & Weather, Objects of the Garden, UI, Heroes, Water Garden, Night Garden, Seasons, Valleys, Mountains, Rivers, Numbers, Hindi Vowels, Hindi Consonants. The last two sections are literal Devanagari-script glyphs (Google Fonts "Kalam", loaded via a second `<link>` in the sheet's `<head>`) rather than hand-drawn line art — each is a bare `<text fill="currentColor">` wrapped in `<g>` (the sheet's loader in `frontend/core/mind-garden.js` only picks up `svg > g`, so every entry, glyph or line-art, needs that wrapper) so they still tint through the same `currentColor`/hex-override path as every other icon. Token format: `icon:<id>` or `icon:<id>:<hex>`.
- **View registry / top-level navigation** — a single-active-view Map controller. Registered views: `chat` (default canvas, inline), `blank` (New tab empty state), `notes` (overlay). Settings, Product story, and the Projects grid are deliberately outside this registry/tab system (separate modal/panel UI).
- **Autosave timing** — every save writes the whole state blob to IndexedDB immediately (no user-visible error surfaced on save failure, just a console warning); most interactions (delete/rename/prefs/theme/model changes, etc.) save synchronously on the action; only high-frequency updates — live-streaming AI text — are debounced (350ms) so the DB isn't hit on every token.

---

## 6b. React shell at `/web/` (P3 — foundation only)

A second front end, being built toward replacing `frontend/` (ADR-031). It has **chat with highlights, branches, thread map/canvas, tools, attachments and project-folder context (P5), and no Notes yet** (P6).
What it does today, against the *same* origin and the *same*
`notlinear` IndexedDB row as the legacy app (ADR-036, ADR-039):

- **Sidebar** listing the four seed threads plus dynamic ones, minus deleted; **New chat** (⌘N / Ctrl+N) creates the exact thread object legacy's `startNewChat` does; **delete** (hover trash, never on `doc-main`) shows the legacy confirm copy verbatim and tombstones the id in `deletedThreads`. Sidebar ships collapsed; the toggle and Esc open and close it.
- **Tab strip** persisted to `localStorage.nl_tabs_v1` in legacy's `{tabs:[{id}], active}` shape (shared with the legacy tab strip). `blank` is never saved; closing the last tab reopens `doc-main`; a tab is dropped only for an *explicitly deleted* thread.
- **Themes** dark-mono / grey / light via `data-theme` and the shared `nl_theme` key, every colour a `var(--…)` from `tokens.css`; ESLint forbids literal colours in `web/src`.
- **Esc chain** as an ordered priority table (`lib/keyboard.ts`): confirm closes before the sidebar.
- **View registry** (`registry/views.ts`) with `registerView` / `mountView` / `onViewChange`, the seam P7 plugs into.
- **Settings** (sidebar footer → dialog, `flags.settings`): theme, workspace name, your name, tone, "what are you working on", default model (14 choices), API keys, context ranking, SearXNG URL. Prefs write one key at a time (typed text debounced 200ms, flushed on blur/close); theme writes `prefs.theme` and `nl_theme` together. **API keys** live in `localStorage.nl_api_keys` (same flat shape legacy and `notes.js` read), shown masked, never logged, never in IndexedDB; connecting toasts "API key connected". A live **"Tools the model can use"** list shows each of the five tools on/off and what enables it, derived from the `TOOL_SPECS` registry. **Conversation modes** (Settings → New / manage modes, `flags.modes`): the six built-ins plus custom modes, with legacy's badges (Built-in / Edited / Custom / Active), create/edit/reset-to-default/delete, name limit 30 and description limit 50, delete confirm "This removes the mode \"X\". Chats using it fall back to General." Overrides-only storage (ADR-046); deleting the active mode falls back to General. Picking the active mode is still done in the legacy composer (P5). **Search palette** (⌘K / Ctrl+K, or the sidebar Search row; `flags.search`): case-insensitive substring filter over thread titles in sidebar order, match marked, `No results for "q"` / `No threads or branches yet`; ArrowUp/Down clamp (no wrap), Enter opens the highlighted result or the first; Esc closes (priority above confirm in the Esc chain). Threads only - the Branches group arrives with P5b. **Changelog** (Settings → View changelog, `flags.changelog`): reads `/CHANGELOG.md` on first expand, groups mechanically by `## <date>` heading (ADR-018, no LLM; narrative = the first entry's Summary verbatim), one chapter card at a time with Older/Newer, a dot per chapter, a source label (`CHANGELOG.md` / `Bundled copy`) and a reload button; falls back to the bundled copy on a failed, non-OK or blank response (BUGS.md #007). The **Product story** (sidebar row, fullscreen player, "Play the story") is not in `/web/` for now. **Projects** (`flags.projects`): sidebar section (list, grid icon, +) with each project's chats reached through it and hidden from Threads; full-screen grid with name search, sort by Last updated or Name, cards showing `N thread(s) · Updated Xh ago`, and a New project card; a project panel to rename (200ms debounce), New chat in project, Add existing chat (real chats with saved state, never `doc-main`), open/remove/delete each chat, and Delete project (chats are kept and return to Threads). Membership is stored only on `threads[id].projectId`. Also in the panel: **Project rules** (text, 200ms debounce), **Project files** (Add files via the native picker, falling back to the browser's; read as text, PDF text via pdf.js, or kept as image; base64 is dropped before storing; chips with remove) and the **linked folder** (Link folder… via the native folder picker, Unlink, path shown; the server records the pick in its consent ledger). Not yet: project emoji.
- **Chat** (`flags.chat`, P5a): opening a thread shows its conversation and a composer (Enter sends, Shift+Enter adds a line, Send becomes Stop while streaming). Claude and DeepSeek only; the model comes from the default-model pref (`prefs.thinking` enables reasoning where legacy does) and any other model is explained rather than swapped. Replies stream as rendered markdown (headings, lists, tables, code blocks with Copy, mermaid, highlight.js), with a reasoning panel for thinking models. A Claude rate limit before any text falls back to DeepSeek when a DeepSeek key exists, and the thread records the model that answered. Failures show a calm message with Try again (retries the same question, no duplicate) or Open settings. A thread's usage line shows under the conversation. Saved as legacy saves it: `stream` HTML (one turn upserted per save, everything else untouched), `mainMessages`, title from the first prompt, usage and cost; text saves every 350ms while streaming and at once on send, finish, error and stop. A thread written by either app opens and continues in the other. Not in `/web/` chat yet: tools and web search (P5d), highlights and branches (P5b), the thread map and canvas (P5c), OpenAI and Gemini models, attachments in the composer, Continue, per-message usage details and copy/download actions; `doc-main` is read-only until legacy has saved it once.
- Not here yet: the Notes section and its editor (P6), OpenAI/Gemini models, the Product story (deferred by the maintainer), the composer's `+` menu and branch-transcript attach.
- **Feedback** (`flags.feedback`): Ctrl/Cmd+Shift+B (or Ctrl/Cmd+Q, the native shell's key) toggles a floating, draggable, non-modal panel: Bug or Idea, text (Tab types a tab), Screenshot and Record (area or full screen, via the OS-side `screencapture` endpoints; the panel hides itself during a shot), a preview with pen annotation (undo, clear) and Add to report / Discard (Esc discards and deletes the file), media chips, and Save to `feedback/FEEDBACK.md` with the view and thread it was filed from. The draft survives closing; closing and saving are refused mid-recording. Settings → Feedback → View bugs & ideas lists the saved entries.
- **Runtime logs** (`flags.logs`): Settings → Runtime logs → View request logs shows the in-memory request log (newest first, pretty JSON; refresh, copy, clear), kept to 300 events with credential headers redacted and request bodies summarised at the moment each entry is built, and mirrors it into `logs.md` through a 1200ms-debounced sync that sends `X-Notlinear-Local`. Empty in `/web/` until the chat core produces traffic (P5).
- Cross-app freshness is on window focus, not live; a stale legacy tab can overwrite a `/web/` change when it saves.
- Served from `web/dist` by the Python server, or proxied to Vite with `NOTLINEAR_DEV_PROXY=1` (`pnpm dev` in `web/`).

## 7. Backend endpoints (`backend/app/`, entry point `backend/server.py`)

FastAPI on uvicorn (`127.0.0.1:8765`), entered via `backend/server.py`, which re-execs into the repo's
`.venv` when the calling interpreter lacks the dependencies — this is what keeps the launchers and
`Notlinear.app` working, since they all invoke the system `python3`. `--legacy` still runs the
pre-P2 stdlib server (`backend/server_legacy.py`), kept as the contract-test oracle until P3.

Static serving is an **explicit allowlist** (ADR-034): `/frontend`, `/tools`, `/feedback/media`,
plus `/CHANGELOG.md`, `/logo.svg` and `/notlinear.html`. Everything else at the repo root — `BUGS.md`,
`logs.md`, `uploads/`, `docs/project-notes/` — now 404s; before P2 the entire repository was served.
`/` redirects to `/frontend/index.html`.

CORS is **not** wide open (ADR-035 pending, P0 fix in place): the allow header is echoed only for the
exact loopback origin the server is bound to, `Vary: Origin` is always sent, and a preflight from any
other origin gets 403. Several endpoints remain **macOS-only** (shell out to `osascript`/`screencapture`)
and fail on other platforms.

| Endpoint | User-facing capability | Limits |
|---|---|---|
| `/__notlinear_pick_folder` | Native folder-choose dialog | 120s timeout |
| `/__notlinear_scan_project` | Recursive read-only scan used by chat Projects' linked-folder context (shallow top-level listing, README/CHANGELOG/BUGS/TASKS by stem, every markdown file, plus a code+config file list for LLM context) | listing capped at 500 entries; any single file read capped at 1MB (`tooBig` beyond that); markdown files capped at 200 (truncation flag); context files capped at 300 (own truncation flag); skips `.git`/`node_modules`/`dist`/etc.; all reads path-confined to inside the given folder |
| `/__notlinear_open_files` | Native file **or** folder multi-select attach picker | 20MB per-file cap (base64-encoded), oversized files listed as `tooBig` with no content |
| `/__notlinear_save_file` | Native Save dialog for AI-generated content | forces a `.md` extension if the chosen name lacks one |
| `/__notlinear_feedback_shot` | Screenshot capture (`screencapture -x -t png`); `-i` for interactive area select | 240s (area) / 30s (full) timeout; permission errors surfaced as a Screen Recording permission hint |
| `/__notlinear_feedback_record` | Start/stop screen recording (`screencapture -v -x`) | **one recording at a time** (second start → 409 "already recording"); stop waits up to 15s |
| `/__notlinear_feedback_upload` | Overwrite a captured media file with an annotated version | writes are confined inside `feedback/media/` — rejects any path that resolves outside it |
| `/__notlinear_feedback_discard` | Delete an un-added capture | same path-containment check as upload |
| `/__notlinear_feedback_list` | List parsed `feedback/FEEDBACK.md` entries, newest first | — |
| `/__notlinear_feedback_save` | Append a new `FB-NNN` entry to `feedback/FEEDBACK.md` | auto-increments the id |
| `/__notlinear_runtime_logs` | Sync the browser's runtime request log into a fenced section of `logs.md` | request body capped at 1.5MB (413 beyond); keeps only the last 300 events even if more are sent |

---

## 8. Workspace redesign — in progress (`redesign_product.md`, RD00–RD09)

Presentation-only phases, no schema changes, one phase per session (ADR-014–ADR-022):

- **Tab strip** — closable, per-thread, Notion-style (already landed — see §1 "Tab strip"; originally scoped here, revised in ADR-022).
- **Hand-drawn default icons** — Mind Garden set wired in as the *default* project/thread icon cycle instead of a generic folder/message icon (ADR-015).
- **Spatial branch canvas** — already landed (see §1 "Branch canvas", ADR-019); read-only, no drag-reposition, no branch-state writes.
- **"Product story" release notes** — already landed (see §1); chapters mechanically parsed from `CHANGELOG.md`, never LLM-generated (ADR-018).
- **Projects grid + detail redesign** — card-grid landing before a project's three-section detail (Chats / Project rules / Project files) — landed (see §1 "Projects").
- **Floating cards, not drawers** — Highlights/Context/branch-reply panels as anchored floating cards (top-right, rounded, shadowed) instead of full-height edge drawers (ADR-016) — in progress.
- **Settings as a centered modal** — replacing the right-edge drawer with a dim-scrim centered card — in progress.
- **New-chat button restyle** — gradient fill, inset highlight, hover lift, ⌘N hint.

---

## 9. Known inert / not-yet-wired UI

Worth tracking separately since these look clickable but currently do nothing (or less than expected) — useful to check before assuming a feature "exists":

- Composer **"Tools" chip** — no click handler.
- Selection popover **Bold / Italic / Link** buttons — no handler, just close the popover.
- Branch-canvas edge-connector drawing function exists in code but is force-disabled (`showEdges = false`) — not user-reachable.
- `prefs.thinking` (Extended thinking) is saved but forcibly reset to `false` on every reload — behaves as if it doesn't persist.

---

## 10. Persistence

- **Dexie `notlinear`** — chat/thread/project/branch state, single `kv` store, one `state` record holding the whole serialized app state. One-time migration from legacy `localStorage` key `nl_state_v2` on first load. Static built-in thread ids: `doc-main`, `pricing`, `onboarding`, `planning`.
- **Dexie `notlinear-notes`** — Notes only, single `kv` store, deliberately separate (ADR-007). One-time migration from legacy `nl_notes_v1` localStorage payload.
- **`localStorage` keys**: `nl_side_collapsed_v1` (sidebar section collapse), `nl_tabs_v1` (open tabs), API keys (per-provider, plain).
- **Filesystem** — `feedback/FEEDBACK.md` + `feedback/media/` (Feedback capture, ADR-013), `logs.md` (runtime log sync), `CHANGELOG.md` (Product story / Settings changelog source). None of these touch Dexie.

---

*Last compiled 2026-10-04 (section 6b added for the P3 React shell and extended for P4.1a Settings; section 7 updated for the P2 FastAPI move; the rest 2026-08-02) by direct codebase inspection (`frontend/app.js`, `frontend/views/notes.js`, `frontend/core/*.js`, `frontend/providers/*.js`, `backend/server.py`, `index.html`, `redesign_product.md`, `BUGS.md`, `AGENTS.md`). If you land a feature and don't see it here, add it in the same session — see the update rule at the top of this file.*

- **Chat, P5b–d** (`flags.chat`): select text for Highlight, Branch (⌘B) or Ask; branch panels stack in a right drawer (hidden below 1100px, as legacy), drag-resize from the left/bottom edges, collapse, reader mode, promote to main (with a trail back), delete, per-branch model and mode; Recent branches in the sidebar; Highlights panel, thread map, branch canvas and breadcrumbs. Claude and DeepSeek run web search and page-fetch tools with status lines. Per-message Copy/Download/Retry/Continue, a usage line, attachments and a Context panel, project linked-folder context with a Sources bar and per-chat ranking override. Threads, projects and the title use Mind Garden icons (click to change; stored in `emoji` as `icon:<id>[:hex]`, shared with legacy). Data: `branchSnapshots`, `branchRecents`, `highlights[]` and additive `highlightsV2`.
