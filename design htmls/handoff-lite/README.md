# Handoff: Project Details v2

Source: `Project Details v2.dc.html`. High-fidelity; recreate in the app's stack using `tokens.css` variables. Inline styles and the class component in the prototype are reference only.

## Files (each opens standalone; `.html` = offline bundle, `.dc.html` = editable source)
| File | State / view |
|---|---|
| `active.*` | Active project, overview (all cards populated) |
| `chats-only.*` | Project with 3 chats, no notes/artifacts/rules/files |
| `new-project.*` | Brand new, 0 chats, all empty states |
| `notes.*` | Notes list view (drill-in from Notes card) |
| `files.*` | Files list view (drill-in from Files card) |
| `artifacts.*` | AI artifacts grid view (drill-in) |

The dark "Preview state" pill bar at top is **design-review only — do not build**.

## Layout
Top bar (52px): back arrow + project icon + title. Content: `max-width:1040px`, padding `32 32 80`.
Overview = 6-col grid, gap 12, cards `radius:14`, `padding:16`:
- Chats — span 6
- Notes (span 3), AI artifacts (span 3)
- Rules, Files, Memory — span 2 each
Header: 52px icon tile, mono eyebrow (meta), h2 28/600, **New chat** (dark, `⌘N` hint), `+`, `…` buttons (40px).
Filled cards: solid `#fff` bg + solid border. Empty cards: transparent bg + **dashed** border. Memory is always dashed/violet with a "Soon" pill (non-functional).

## State matrix
| Element | Active | Chats only | New |
|---|---|---|---|
| Meta eyebrow | `61 items · active 2h ago` | `3 items · active 1d ago` | `Just created · nothing here yet` |
| Chats | list of 5, "View all 18", branch chip when `branches>0` | 3 rows, no chips, "View all 3" | Empty: "Plant the first chat" + New chat / Add existing chat |
| Notes | 2×2 note tiles, `+` | "No notes yet" + New note / Add existing | same |
| Artifacts | 3 tiles (type + title) | "Nothing generated yet" | same |
| Rules | text + Edit | hint + "+ Add rules" | same |
| Files | linked folder + "+ N more" | hint + Add files / Link folder | same |
| Delete project | hidden | hidden | **shown** (red, centered, below grid) |

Drill-in views (Notes/Files/Artifacts) are reachable only from the Active state by clicking the card header; back link returns to overview.

## Data shapes
```ts
Project   { id, title, iconKey, createdAt, lastActiveAt, rules?: string }
Chat      { id, title, subtitle, branchCount, updatedAt }
Note      { id, title, body, iconKey, pinned, updatedAt, chatIds[] }
Artifact  { id, title, type:'SVG'|'MD'|'TSX'|'HTML', kind, version, chatId, updatedAt }
File      { id, name, kind:'pdf'|'md'|'img'|'csv'|'code'|'doc', source:'Uploaded'|'Linked', sizeBytes, usedInChats, updatedAt }
LinkedFolder { path, syncedCount, lastSyncedAt }
```
Derived: item count = chats+notes+artifacts+files; empty flags per section drive the empty/filled variants above. Relative times: `2h`, `Mon`, `Oct 14`.

## Drill-in views
- **Notes**: header + "Add existing"/"New note"; filter pills (All, Pinned, Linked to chats); 3-col grid, cards min-h 170, pin icon, chat count, one card may span 2.
- **Files**: header + "Link folder"/"+ Add files"; green linked-folder banner (sync count, Unlink); filter pills (All, Uploaded, Linked folder, Unused); table rows: type icon tile, name, "Used in N chats", source pill, size, age; "Showing 8 of 14" (paginate/infinite scroll).
- **Artifacts**: header + "Export all"; filters (All, Documents, Diagrams, Code); 3-col cards: preview area (striped placeholder → real thumbnail), type pill, version, title, source chat, age.
Active filter pill = `#1A1A1A` bg / white text; inactive = white, `#E2E2E2` border.

## Section accent colors
Chats/Rules neutral `#555` · Notes `#B8862E` (card tint `#FBF6EC`, border `#F0E4C8`) · Artifacts `#8161C9` (tint `#F4F1FA`) · Files `#3E8E6A` · Project icon `oklch(48% 0.08 195)` · Links/branch chip `#3E7BD6`. Map to tokens per `design_handoff_notlinear_redesign/README.md` (`--bg #F8F8F8`, `--surface #fff`, `--rule #E2E2E2`, `--text #1A1A1A`, `--text-3 #999`). Fonts: Space Grotesk (UI), Space Mono (eyebrows, times, sizes, pills — 9–11px, uppercase, tracked).

## Interactions
- Row hover: bg `#FAFAF8`. Card/artifact hover: border `#BDBDBD`.
- Clicking section header (Notes/Artifacts/Files) → drill-in. Chat row → open chat. "View all" → full chat list.
- New chat: `⌘N`. `+` = add menu (chat/note/file). `…` = project menu (rename, rules, delete).
- Delete project needs the app's existing confirm dialog.
- Text truncates with ellipsis (chat title/sub, file names); chat time column fixed 52px.

## Icons
Hand-drawn 64×64 line SVGs (stroke 3.6, round caps) for compass, tree (chat), branch, journal, lantern, basket, sign, gate, roots, sapling, plus note glyphs (thought, candle, seed, leaf). Paths are in the `MG` object in each `.dc.html`. Chrome icons (arrow, plus, dots, pencil, pin, trash) use Tabler.

## Responsive
Prototype is fluid ≥ ~640px; below that collapse the 6-col grid to a single column and the 3-col grids to 1–2 cols. Not designed in detail — confirm.

## Open questions
- Reconcile blues (`#3E7BD6` / `#2D6CDF` / `--branch`).
- Is Memory shipping? (currently a "Soon" placeholder.)
- Artifact thumbnails: real renders or type icons?
