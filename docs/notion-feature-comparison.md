# Notion feature list vs. notlinear Notes — comparison

Research date: 2026-07-24. Notion feature list compiled from Notion's own help docs and current (2026) product coverage. notlinear column verified directly against `frontend/views/notes.js` (1,515 lines), not assumed.

Legend: ✅ have · 🟡 partial · ❌ missing

## 1. Blocks

| Feature | Notion | notlinear |
|---|---|---|
| Text paragraph | ✅ | ✅ |
| Headings (H1–H3) | ✅ | ✅ (H1–H4, one extra level) |
| Bulleted list | ✅ | ✅ |
| Numbered list | ✅ | ✅ |
| To-do / checkbox list | ✅ | ✅ |
| Toggle list | ✅ | ✅ |
| Toggle heading (collapsible H1–H3) | ✅ | ✅ |
| Quote | ✅ | ✅ |
| Callout | ✅ | ✅ (fixed 💡 icon, no color variants) |
| Divider | ✅ | ✅ |
| Code block | ✅ (syntax highlighting, many langs) | 🟡 (block exists, language tagging present but no real syntax highlighting) |
| Inline equation + block equation (LaTeX) | ✅ | 🟡 (block equation type exists; unclear if LaTeX actually renders vs. plain text) |
| Image | ✅ (upload, embed, resize, captions) | 🟡 (image block + caption; stored as dataURL in Dexie, no external embed/resize handles) |
| Video / audio embed | ✅ | ❌ |
| File attachment | ✅ | ❌ |
| Web bookmark (link preview card) | ✅ | ❌ |
| Rich embeds (500+ apps: Figma, YouTube, Google Drive, etc.) | ✅ | ❌ |
| Table (simple) | ✅ | ✅ (static rows/cols, text only) |
| Table of contents block | ✅ | ❌ |
| Columns (2–3 up) | ✅ | ✅ |
| Synced blocks (edit once, updates everywhere) | ✅ | ❌ |
| Sub-page / page link block | ✅ | ✅ |
| Breadcrumb | ✅ | ✅ |
| Mentions (@person, @date, @page) | ✅ | ❌ |
| Page cover image | ✅ | ❌ (a cover spacer div exists in markup but no actual cover-image feature) |
| Page icon (emoji/image) | ✅ | ✅ (emoji only, no custom image icon) |
| Buttons / templates-as-blocks | ✅ | ❌ |

## 2. Databases (the big Notion differentiator)

| Feature | Notion | notlinear |
|---|---|---|
| Database as first-class object (separate from a plain table block) | ✅ | ❌ — only has a static table **block**, not a queryable database |
| Views: Table | ✅ | 🟡 (table block only, no "view" concept) |
| Views: Board (kanban) | ✅ | ❌ |
| Views: Calendar | ✅ | ❌ |
| Views: Gallery | ✅ | ❌ |
| Views: Timeline / Gantt | ✅ | ❌ |
| Views: List | ✅ | ❌ |
| Multiple views of same data | ✅ | ❌ |
| Filters | ✅ | ❌ |
| Sorts | ✅ | ❌ |
| Grouping | ✅ | ❌ |
| Property types: text, number, select, multi-select, date, person, checkbox, URL, email, phone | ✅ | ❌ |
| Relation (link rows across databases) | ✅ | ❌ |
| Rollup (aggregate from a relation) | ✅ | ❌ |
| Formula (computed property) | ✅ | ❌ |
| Linked database views | ✅ | ❌ |

## 3. Editing & formatting

| Feature | Notion | notlinear |
|---|---|---|
| Bold / italic / underline / strikethrough | ✅ | ✅ |
| Inline code | ✅ | ✅ |
| Text color | ✅ | ✅ |
| Highlight color | ✅ | ✅ |
| "Turn into" (change block type from toolbar) | ✅ | ✅ |
| Inline link | ✅ | ✅ |
| Slash command menu | ✅ | ✅ (filtered, keyboard nav, markdown shortcuts) |
| Markdown shortcuts (`#`, `-`, `1.`, `[]`, `>`, etc.) | ✅ | ✅ |
| Drag-to-reorder blocks | ✅ | ✅ |
| Drag-to-nest (indent via drag) | ✅ | ❌ (indent likely keyboard-only if present) |
| Multi-block select & bulk actions | ✅ | 🟡 (⌘A ⌘A → ⌘C page-wide select & copy exists; unclear if delete/format applies in bulk) |
| Duplicate block | ✅ | ✅ (block menu: delete/duplicate via prompt) |
| Duplicate page | ✅ | ❌ (sidebar row only has add-subpage and delete) |
| Move page (drag in sidebar tree) | ✅ | ❌ (sidebar has expand/collapse, add, delete — no drag-to-reparent) |

## 4. AI

| Feature | Notion (2026) | notlinear |
|---|---|---|
| Ask AI about a page/selection | ✅ | ✅ ("Ask AI about this note" CTA + per-block "branch" threads anchored to text) |
| Cross-page / workspace-wide AI context | ✅ (up to 50-page context) | ❌ (scoped to one note) |
| AI autofill of database properties | ✅ | n/a (no databases) |
| Custom AI agents / scheduled agent workers | ✅ | ❌ |
| Voice input | ✅ | ❌ |

## 5. Collaboration & sharing

| Feature | Notion | notlinear |
|---|---|---|
| Real-time multiplayer editing + live cursors | ✅ | ❌ (single-user, local Dexie only) |
| Comments (page/block-level threads) | ✅ | ✅ (branch/comment threads on selected text, resolve + reply, per TASKS.md ADR-009) |
| @mention people | ✅ | ❌ (no multi-user concept at all) |
| Page/row-level permissions | ✅ | ❌ |
| Public share links | ✅ | ❌ |
| Version history | ✅ | ❌ |

## 6. Organization & navigation

| Feature | Notion | notlinear |
|---|---|---|
| Sidebar page tree (nested, collapsible) | ✅ | ✅ |
| Search (full-text, across workspace) | ✅ | ❌ (no search bar found in notes.js) |
| Tags | ✅ (as a database property) | ✅ (freeform per-page tags, not database-backed) |
| Favorites / starred pages | ✅ | ❌ |
| Templates (page templates, template button) | ✅ (huge community library) | ❌ |
| Teamspaces / workspace switching | ✅ | n/a (single local workspace) |
| Trash / restore deleted pages | ✅ | 🟡 (delete exists via confirm dialog; no evidence of a restore/trash-bin view) |
| Index / overview of all pages | ✅ (as a database view) | ✅ (dedicated index render of all pages) |

## 7. Platform

| Feature | Notion | notlinear |
|---|---|---|
| Web app | ✅ | ✅ (this is the whole thing) |
| Desktop app | ✅ | ❌ |
| Mobile apps | ✅ | ❌ |
| Offline support | ✅ | ✅ (Dexie/IndexedDB is inherently local-first/offline) |
| Import (Word, Markdown, CSV, etc.) | ✅ | ❌ |
| Export (Markdown, PDF, HTML) | ✅ | ❌ |
| API for integrations | ✅ | n/a |

## Summary

notlinear's Notes already covers the **single-page authoring experience** solidly: most block types, slash menu, drag-to-reorder, inline formatting, per-block AI threads, tags, breadcrumbs, nested page tree. That part is close to parity with Notion's editor.

The categories almost entirely missing are the ones that make Notion "Notion" rather than just a block editor:

1. **Databases with views** (board/calendar/gallery/timeline, filters, sorts, properties, relations) — the single biggest gap, and a different feature class from a table block.
2. **Search** — no way to find a page/block by text today.
3. **Collaboration** — no multiplayer, no permissions, no sharing (notlinear is explicitly local-first/single-user, so this may be out of scope by design).
4. **Rich embeds/media** — video, files, bookmarks, third-party embeds.
5. **Templates, favorites, trash/restore, duplicate, import/export** — the smaller "quality of life" layer around the core editor.

Given notlinear's stated architecture (no bundler, local Dexie persistence, single-user), a "database" block with basic table+board views and filter/sort would likely be the highest-leverage next step toward Notion parity — everything else (search, favorites, templates) is smaller and more self-contained.
