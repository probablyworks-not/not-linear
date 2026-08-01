# notes_new_feature.md — Notes v2 requirements (Blocks · Editing · Databases)

**Status:** proposed (2026-07-24)
**Owner:** Yash
**Source:** `docs/notion-feature-comparison.md`, sections 1–3 only (Blocks, Databases, Editing & formatting). Sections 4–7 of that doc (AI, collaboration, search/organization, platform) are **not** covered here.
**Scope:** `frontend/views/notes.js` + `frontend/styles/notes.css` only. Strictly additive — must not change chat/threads/branches/coding-projects, and must not touch the `notlinear` Dexie db.

This is a requirements doc for an implementing agent (Claude Code or equivalent). It defines *what* to build and the acceptance bar for each piece. It does not prescribe function-level implementation — follow `AGENTS.md` code style and read the current `notes.js` block-render / slash-menu / persistence sections before touching anything.

---

## Read first

- `AGENTS.md` — non-negotiables, Do-not-touch list, memory-file requirements.
- `CLAUDE.md` — plan mode for anything touching persistence, one phase per session, ask before destructive actions.
- `docs/project-notes/DECISIONS.md` — ADR-007 (separate `notlinear-notes` Dexie db) and ADR-009 (additive comment persistence) set the precedent for how schema changes here should be justified and tagged.
- `docs/project-notes/TASKS.md` — existing Notes task history (`TASK-NOTES-01..03`, `TASK-NT01..02`). New tasks below continue that numbering from `TASK-NT03`.

## Constraints (non-negotiable, inherited from AGENTS.md)

- No framework, no bundler, no new runtime dependency beyond what's already CDN-loaded (Dexie, Tabler Icons, Mermaid). If a phase genuinely needs a new library (e.g. KaTeX for equations, a lightweight highlighter for code blocks), it must be a CDN `<script>` tag added to `index.html`, called out explicitly as a new dependency, and approved before use — don't silently add one.
- Persists only to the `notlinear-notes` Dexie db (ADR-007). Any change to the persisted block/note shape is a **schema change** — needs a migration path for existing saved notes and a `[SCHEMA]` tag in `CHANGELOG.md`. The `notlinear` (chat) db is never touched.
- Vanilla JS, matches existing patterns in `notes.js` (`SLASH_ITEMS`, `applyType`, `renderBlock`, drag-to-reorder). Theming via existing CSS variables only.
- **One phase per session.** Stop after each phase below for a human smoke test before starting the next. Do not bundle phases.
- Plan mode first for any phase that changes persisted shape (all of Part C, plus A9/A12/A13 in Part A).

## Non-goals (explicitly out of scope for this doc)

- Real-time collaboration, multiplayer cursors, page permissions, sharing/public links — notlinear Notes is local-first single-user by design (see `plan.md`).
- @mentions of *people* — no multi-user concept exists. @page and @date mentions (self-referential) are in scope; @person is not.
- The literal "500+ app rich embeds" from Notion — scoped down below to one generic URL-embed block instead of an integrations marketplace.
- Search, favorites, templates, trash/restore, import/export — these are comparison-doc sections 4–7, tracked separately, not in this doc.

---

## Part A — New / improved blocks

Each item: what to build, acceptance criteria.

**A1. Real syntax highlighting for code blocks**
Code block currently stores plain text + a language tag but doesn't highlight. Add real highlighting (e.g. a small CDN highlighter). Acceptance: existing code blocks with a `lang` still render and are editable; highlighting updates live as you type or on blur; no layout shift when switching languages via the block's language picker.

**A2. LaTeX rendering for equation blocks**
`eq` block type exists but likely renders as plain text. Render actual LaTeX (e.g. via a CDN math renderer). Acceptance: typing valid LaTeX in an equation block renders formatted math; invalid LaTeX shows a clear inline error state rather than breaking the block; inline equations (not just block-level) supported from the floating toolbar or a `$$` shortcut.

**A3. Image block improvements**
Currently: dataURL only, stored inline in Dexie, no resize. Add: paste/drop an external image URL without re-encoding to dataURL, and a drag handle to resize width. Acceptance: existing dataURL images still load; external-URL images persist as a URL string (not a giant dataURL) with graceful fallback if the URL 404s; resize persists across reload.

**A4. Video / audio embed block**
New slash-menu item. Accepts a direct file URL or a common host link (YouTube/Vimeo pattern matched to an embeddable player). Acceptance: pasting a supported link auto-converts to a playable embed; unsupported links fall back to a plain link block with a clear message, not a broken frame.

**A5. File attachment block**
New slash-menu item. Stores a file reference (name, size, and either a dataURL for small files or an explicit "too large to embed, use a link instead" cap) with a download affordance. Acceptance: define and enforce a size cap (proposal: 5MB, matching the existing image dataURL risk noted in `docs/project-notes/CHANGES.md`); block shows filename/size/icon and a working download.

**A6. Web bookmark / link-preview block**
Pasting a bare URL on its own line offers "create bookmark" from the slash menu or an auto-prompt. Fetches title/description/favicon via the existing backend (`backend/server.py` — new additive endpoint if needed, following the `__notlinear_*` naming convention) since the frontend can't CORS-fetch arbitrary sites directly. Acceptance: bookmark shows title + domain + favicon at minimum; failed fetch degrades to a plain link block, never a broken card.

**A7. Generic embed block (replaces Notion's 500+ app integrations)**
An `iframe`-based embed block for a pasted URL that isn't otherwise recognized (e.g. Figma, CodePen, Google Maps — anything with a public embed URL pattern). Acceptance: supports at least a documented allowlist of a few common embed patterns; unrecognized URLs fall back to a bookmark block (A6), never a raw unsandboxed iframe of arbitrary origin (security: sandbox the iframe).

**A8. Table of contents block**
Auto-generates from the current page's headings (h1–h4), clickable to scroll/jump. Acceptance: live-updates as headings are added/removed/edited without needing to reinsert the block; nested by heading level.

**A9. Synced block**
A block whose content is shared across every instance of it (edit once, updates everywhere it's referenced). `[SCHEMA]`: needs a new block type storing a reference to a shared content id plus a registry of shared blocks per note-store. Acceptance: editing one instance updates all others live (or on next render, if live cross-instance sync is out of scope for v1 — state which); deleting one instance doesn't delete the shared source unless explicitly "delete original."

**A10. @page mention**
Typing `@` opens an inline autocomplete over existing note titles; selecting inserts an inline mention chip that navigates to that page on click. Acceptance: renaming the target page updates the mention's display text; deleting the target page degrades the mention to plain text (not a dead link/crash).

**A11. @date mention**
Typing `@` + date-like text (or a small date picker) inserts a formatted, persisted date chip. Acceptance: stored as an ISO date, not a formatted string, so display format can change later without a data migration.

**A12. Page cover image**
There's currently a `.cover-spacer` div with no actual feature behind it. Build the real thing: click to upload/choose a cover image, drag to reposition vertically, remove-cover option. `[SCHEMA]`: adds a `cover` field to the note object. Acceptance: cover persists and reloads; notes without a cover render exactly as today (empty spacer), migration is additive-only.

**A13. Page icon: custom image, not just emoji**
Currently `n.emoji` only. Extend the existing emoji picker to also accept an uploaded image as the page icon. `[SCHEMA]`: `n.emoji` field needs to support either an emoji string or an image reference — define the shape explicitly (e.g. `{type:'emoji'|'image', value}`) and migrate existing plain-string emoji values on load. Acceptance: all existing notes' emoji icons render unchanged after migration; sidebar tree icons also reflect image icons at small size.

**A14. Button / template block**
A block that, on click, inserts a predefined set of blocks (e.g. a "meeting notes" starter layout) at that point in the page. v1 can ship with a small number of hardcoded templates; user-defined templates are out of scope here (tracked separately under the "templates" gap in section 6 of the comparison doc). Acceptance: clicking inserts a fresh copy of the template blocks (with new block ids) below the button, doesn't mutate the button block itself.

---

## Part B — Editing & formatting fixes

**B1. Drag-to-nest (indent via drag)**
Dragging a block onto/into another (not just above/below) makes it a child, mirroring Notion's nesting-by-drag. Current drag-to-reorder only reorders siblings. Acceptance: dropping a block onto the right two-thirds of another block's row nests it as a child (for block types that support children, e.g. toggle/page); dropping on the left indicates reorder-only, per Notion's convention; existing reorder behavior for non-nesting drops is unchanged.

**B2. Bulk multi-block actions**
The existing ⌘A ⌘A page-wide select supports copy; extend to delete and to applying a format (color/highlight) across the whole selection in one action. Acceptance: selecting all + delete removes every block and leaves one empty text block (matching existing single-block-delete-to-empty behavior); bulk format only applies to blocks whose type supports it, others are skipped without erroring.

**B3. Duplicate page**
Sidebar row currently has add-subpage and delete only. Add a duplicate action that deep-copies a page (and, by choice, its subpages — decide and document which) with fresh ids. Acceptance: duplicated page appears as a sibling immediately after the original in the sidebar tree; deep copy doesn't share any block ids with the source (no accidental synced-block-style coupling unless A9 duplication semantics are deliberately reused).

**B4. Drag-to-reparent pages in the sidebar tree**
Drag a page row onto another page row to make it a subpage (or onto blank space to make it top-level). Acceptance: circular reparenting (dragging a page onto its own descendant) is blocked with a clear no-drop indicator; `openIds`/expand-state persists sensibly after a reparent.

---

## Part C — Databases

This is the largest gap and the one with the most product judgment involved — read this whole section before starting any C-task, and confirm the phase boundaries with the human before implementing, per CLAUDE.md's plan-mode rule for persistence-touching work.

### C0. Data model

A new block type, `database`, distinct from the existing static `table` block (which stays as-is for quick simple tables — don't collapse the two). Proposed persisted shape (subject to review in the plan step, not to be treated as final):

- A database block has: an id, a name, an ordered list of **properties** (each with id, name, type, and type-specific config — e.g. select options), an ordered list of **rows** (each a map of property-id → value, plus its own id), and an ordered list of **views** (each with id, name, view-type, filter rules, sort rules, group-by property, and visible-property list).
- Row content: at minimum, each row needs a title/primary property. Decide during planning whether a database row can *also* be a full sub-page (Notion's model — every database row is secretly a page) or stays a flat record. Recommendation: flat record for v1 (much simpler, avoids conflating with the existing page-tree model); revisit page-backed rows as a later phase if needed.

`[SCHEMA]`: this is a new, additive block type — existing notes/blocks are unaffected, so no migration of old data is needed, but it must still be documented as a schema addition per AGENTS.md.

### C1. Property types

text, number, select (single), multi-select, date, checkbox, URL, email, phone, created-time (auto), last-edited-time (auto). (Notion's "person" property is dropped — no multi-user concept; consider a plain free-text "owner" tag instead if wanted.)

### C2. Table view (default, build first)

Inline-editable grid: add/remove/reorder columns (=properties), add/remove/reorder rows, edit cells inline by type (checkbox renders as a checkbox, select renders as a dropdown chip picker, etc.). This is the foundation every other view reads from — build and stabilize before starting C3+.

### C3. Board view (kanban)

Groups rows into columns by a chosen select property. Drag a row card between columns to change that property's value. Acceptance: works off the same underlying rows as the table view — editing a card updates the table view live and vice versa.

### C4. Calendar view

Groups/positions rows by a chosen date property, month grid with rows shown on their date. Acceptance: dragging a row to a different day updates its date property.

### C5. Gallery view

Card grid, optionally showing an image property as the card cover.

### C6. Timeline view (Gantt-lite)

Rows plotted as horizontal bars against a date-range (two date properties: start/end). Acceptance: v1 can be read-mostly (drag to adjust bar length/position is a stretch goal, not required for acceptance).

### C7. List view

Simple vertical list of rows showing only the primary property + a couple of chosen secondary properties.

### C8. Multiple views + view switcher

A database block can have more than one view (e.g. a "Table" and a "Board" view over the same rows), switchable via tabs at the top of the block. Acceptance: adding/removing a view doesn't affect the underlying rows; each view's filter/sort/group state persists independently.

### C9. Filters

Per-view filter rules (property + condition + value), combinable with AND (OR support is a stretch goal, not required for v1 acceptance).

### C10. Sorts

Per-view, multi-level (sort by property A then B).

### C11. Grouping

Board/list views group by a select or checkbox property; collapsible groups.

### C12. Relation property

Links a row in one database to one or more rows in another database (which may live on a different page). This is the highest-complexity property type — requires resolving cross-page/cross-database references inside the single `notlinear-notes` Dexie store. Acceptance: deleting a related row cleans up the relation on the other side (no dangling references); relation picker only lets you pick from the target database's actual rows.

### C13. Rollup property

Aggregates a value across a relation's linked rows (count, sum, min, max, earliest date, latest date). Depends on C12 — do not start before relations work.

### C14. Formula property

A small expression engine over other properties in the same row: arithmetic, string concatenation, basic conditionals (if/else), and references to other property values by name. Acceptance: scope the operator set explicitly during planning rather than open-endedly matching Notion's full formula language — start with arithmetic + string + if/else, document what's excluded.

### C15. Linked database view

Embed an existing database's view (optionally filtered further) on a different page than where the database itself lives. Acceptance: it's a live view, not a copy — edits made through the linked view affect the original database's rows.

---

## Suggested phase order (one Claude Code session each, per CLAUDE.md)

Continues task numbering from `docs/project-notes/TASKS.md`'s `TASK-NT02`.

1. **TASK-NT03** — A3 (image URL support), A8 (table of contents) — low-risk, no schema change, good warm-up.
2. **TASK-NT04** — A1 (code highlighting), A2 (LaTeX) — adds CDN dependencies, no schema change.
3. **TASK-NT05** — B1 (drag-to-nest), B3 (duplicate page), B4 (drag-to-reparent) — editing/UX cluster, no schema change.
4. **TASK-NT06** — A12 (page cover), A13 (custom image page icon) — `[SCHEMA]`, plan mode required.
5. **TASK-NT07** — A10/A11 (mentions) — `[SCHEMA]` (new inline chip type in stored HTML), plan mode required.
6. **TASK-NT08** — A4/A5/A6/A7 (video/audio, file, bookmark, generic embed) — may need a new additive backend endpoint for link-preview fetching; plan mode required for the backend piece.
7. **TASK-NT09** — A9 (synced blocks) — `[SCHEMA]`, plan mode required, isolated cluster.
8. **TASK-NT10** — A14 (button/template block) — no schema change beyond the new block type.
9. **TASK-NT11** — C0 + C2 — database block foundation + table view. Largest single phase; plan mode required; do not proceed past this until it's solid and smoke-tested.
10. **TASK-NT12** — C8, C9, C10, C11 — multi-view, filters, sorts, grouping (still table-view-only rendering).
11. **TASK-NT13** — C3 (board view).
12. **TASK-NT14** — C5 (gallery view), C7 (list view) — similar complexity, bundled.
13. **TASK-NT15** — C4 (calendar view).
14. **TASK-NT16** — C6 (timeline view).
15. **TASK-NT17** — C12 (relations).
16. **TASK-NT18** — C13 (rollups) — depends on NT17.
17. **TASK-NT19** — C14 (formulas).
18. **TASK-NT20** — C15 (linked database views) — depends on NT11+.

Each task, when picked up, should get its own entry in `docs/project-notes/TASKS.md` (ID, Status, Goal, Context, Files likely involved, Acceptance criteria, Verification) before work starts, and its own `CHANGELOG.md` + `docs/project-notes/CHANGES.md` entries on completion, per AGENTS.md's memory policy. Schema-changing phases also need a `docs/project-notes/DECISIONS.md` ADR.
