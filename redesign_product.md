# redesign_product.md — notlinear workspace redesign (PRD)

Source: design handoff bundle `design_handoff_notlinear_redesign/` (prototype: `notlinear-Redesign.dc.html`, spec: its `README.md`). This doc translates that handoff into notlinear's own task/ADR process per `AGENTS.md`.

## What this is

A redesign of the main workspace (doc/chat canvas, sidebar, branching, projects, notes, settings) plus two net-new features: a **spatial branch canvas** and a **"Product story" release-notes experience**. It extends the existing light theme (`tokens.css`) and Space Grotesk/Space Mono type — no new visual system.

**The prototype is a reference, not code to port.** Rebuild in the real stack: vanilla JS view modules under `frontend/views/`, shared state in `frontend/core/state.js`, styling via existing `--token` custom properties in `frontend/styles/*.css`, following the `.side-item` / `.ic-btn` / `.prefs-*` class conventions already in `base.css`.

## Current state (verified in codebase, 2026-07-24)

- Sidebar sections (Projects/Threads/Notes/Updates) render as flat lists via `.side-item` rows — no tab strip exists; the app shows exactly one view at a time via the view registry (`core/registry.js`).
- **Correction (2026-07-25, verified before RD08):** `.thread-map-panel` (`frontend/styles/base.css:302`) is a right-edge drawer, but it lists *threads* (chats) with message/branch counts and an AI-summarize action — not individual branches. The original design handoff's README described it as "a simple right-side list of branch cards," which doesn't match the real code; there is no existing per-branch list/navigator today. RD08's canvas is genuinely net-new, not a materially-bigger version of something that lists branches already.
- `.highlight-panel` (`base.css:284`), `.ctx-panel` (`base.css:248`), and `.prefs` (settings, `base.css:192`) are all the same full-height right-edge drawer pattern, `z-index:100`, sliding from `translateX(100%)`.
- `.changelog-view` (`base.css:224`) is a plain scrollable markdown panel inside Settings, backed by `CHANGELOG.md` + `FALLBACK_CHANGELOG_MD` (bug #007) — not chaptered, no player.
- `.project-grid` (`base.css:84`) is a 2-column (`1.5fr 1fr`) layout reached by navigating directly into a project — no dedicated grid/search/sort landing page.
- Icons default to Tabler webfont (`ti ti-*`) for every project/thread row today — **but a hand-drawn icon system already exists** (`frontend/core/mind-garden.js` + `frontend/mind-garden-icons.html`, 145 SVG icons incl. `iris`/`acorn`/`compass`/`star`/`branch`/`roots`), reachable today only via manual per-item emoji/icon picker (`core/emoji.js`). RD02 wires it in as the *default*, not a new build. See ADR-015.

## What's new vs. today (8 areas)

1. **Tab strip** (browser-style, closable tabs above the breadcrumb: doc / notes / projects / product story / blank). **Structural navigation change — the app currently shows one view at a time; this introduces a multi-tab concept.** Flagged in the source README as needing product confirmation before building. See "Open questions."
2. **Hand-drawn icon system** for projects/threads (iris/acorn/compass/star — OKLCH hues) replacing the single Tabler folder/message icon. Already-decided direction per prototype's own project-rules data ("Icons are hand-drawn line style, not the Tabler font, for anything user-facing") — the prototype just applies it consistently.
3. **Spatial branch canvas** — full-screen pannable 2D map (`canvasOpen`), branch nodes as positioned draggable-canvas cards, curved SVG connectors to parent, dot-grid background, focus/dim states. Materially more than `.thread-map-panel`.
4. **"Product story" release notes** — replaces `.changelog-view` with (a) an inline one-chapter-at-a-time tab (Older/Newer paging, dot indicators) and (b) a full-screen auto-advancing "Play the story" player with per-chapter hero icon animation and tagged change items (Epic/Feature/Improvement/Fix).
5. **Projects — grid view + detail page.** New full card-grid landing (search, sort, "New project" pill) instead of jumping straight into a project; project detail restructured into three stacked sections (Chats / Project rules / Project files) vs. today's two-column `.project-grid`.
6. **Highlights & Context as floating cards, not drawers.** Anchored top-right of the content pane (`top:64px;bottom:16px;right:16px`, rounded all corners, drop shadow) instead of full-height edge drawers. Branch reply panel gets the same treatment.
7. **Settings as a centered modal** (dim scrim, rounded card, internal scroll) replacing the right-edge `.prefs` drawer. Same three groups (Appearance / Tone preset / Default model) as a 3-column segmented-button grid.
8. **New-chat button treatment** — dark gradient fill, inset highlight, hover lift, `⌘N` kbd hint, replacing the plain `.side-item` button style.

## Design tokens — map, don't invent

Reuse `tokens.css`; do not add new hex literals for anything a token already covers.

| Prototype hex | Token |
|---|---|
| `#F8F8F8` | `--bg` |
| `#F4F4F4` / `#F0F0F0` | `--bg-2` |
| `#FFFFFF` (cards/panels) | `--surface` |
| `#E6E6E6` | `--bg-3` |
| `#E2E2E2` / `#E7E7E5` | `--rule` |
| `#CCCCCC` / `#DADADA` | `--rule-2` |
| `#1A1A1A` | `--text` |
| `#555555` / `#666666` | `--text-2` |
| `#999999` / `#AAAAAA` | `--text-3` |
| `#2D6CDF` / `#3E7BD6` (branch blue) | `--branch` (`#58A6FF`) — **reconcile to one blue**, don't carry 3 near-duplicates |
| `#F4B83B` / `#B8862E` fam (highlight amber) | `--highlight` |
| `'Space Grotesk'` / `'Space Mono'` | `--font` / `--mono` (already correct) |

New hues — **correction (2026-07-24):** these are literal color constants, not `tokens.css` custom properties. `frontend/core/mind-garden.js` already renders hand-drawn SVGs (`renderIconSvg`) with a `stroke="<literal>"` attribute that can't resolve `var(--x)`, and already has a precedent for exactly this (`ICON_COLORS`, hardcoded hex). See ADR-015. The hues themselves are unchanged:
- Iris/violet `oklch(55% 0.11 290)` · Acorn/amber `oklch(52% 0.10 55)` · Compass/teal `oklch(48% 0.08 195)` · Star/red `oklch(55% 0.13 25)` — projects, and (compass/roots/star/branch, see below) threads
- Thread cycle (standardized, not pixel-matched to the prototype's one-off examples): branch → `--branch` (`#58A6FF`), compass → teal above, roots → green `oklch(50% 0.10 145)`, star → red above
- Story chapter hues (for RD06): ink `#9A9A9A`, blue `#5B93E0`, violet `#9C82D6`, teal `#4FAA9F`

Spacing/radius: cards/panels `border-radius:10–14px`; pills `999px`; icon chips `6–8px`. Body copy stays `15px/1.7` (matches `.doc p` today).

## Interactions & behavior (from prototype)

- **Tabs:** click to switch; "×" closes (closing the last tab opens a fresh blank one); "+" adds a blank tab. Bar style is a design-time toggle (pills vs. underline).
- **Branch canvas:** background-drag pans (mousedown/move/up, 3px move threshold before it counts as a drag, so clicks aren't swallowed); clicking a card opens that branch's reply panel, or closes the canvas if it's the doc node. Focused node's edges color in; unrelated nodes dim to 40% opacity + slight blur.
- **Product story:** "Play the story" opens full-screen at chapter 0; Prev/Next; Next past the last chapter closes the player (icon swaps to a checkmark on the final chapter); progress segments fill per chapter.
- **Highlights / Context / Branch-reply panels and the canvas are mutually exclusive** — opening one closes the others (single overlay slot).
- **Project rules/files:** inline add (textarea + save/cancel), per-row delete, optimistic in the prototype (no confirm dialog) — **confirm whether the app's existing `.confirm-*` dialog pattern should still gate delete** (see open questions).
- **Projects grid:** client-side text filter + 2-option sort (Last updated / Name).

## State additions needed

Open tabs (list + active id + kind: doc/blank/note/projects/release) · per-section sidebar collapse flags (exist today, reuse) · canvas open/pan-offset/focused-node · which side panel is open (highlights | context | branch-reply | none — single active, extending the existing drawer-exclusivity pattern) · story player open/current-index vs. the separate inline-tab "browsing" index · projects list + search + sort · per-project detail (chats/rules/files) keyed by project · settings selections (reuse existing prefs state).

## Assets

All new icons are hand-drawn inline SVG line art (no icon font, no external images) — trace paths from the prototype source. Tabler webfont stays for plain UI chrome (chevrons, x, search, arrows); only project/thread/story glyphs get the hand-drawn treatment.

## Non-goals / must-not-break

- No IndexedDB/Dexie schema change. Tabs/canvas/story state can live in a new `state.js` slice or `localStorage` (matching Coding Projects' ADR-004 precedent) — **not** a chat/thread schema change.
- Chat, branch creation/reply, and Notes persistence (separate `notlinear-notes` db, ADR-007) are untouched by this redesign; only their **presentation** changes (drawer → floating card, list → canvas).
- Every Fragile area in `BUGS.md` that touches branch panels (#002–#004, #028, #037, #038) must be re-verified against the new floating-panel and canvas presentation.
- No new runtime dependencies, no build step (AGENTS.md).

## Decisions (confirmed by Yash, 2026-07-24)

1. **Tab strip: build it.** In scope for this rollout as RD09 — the multi-view navigation model is approved, not deferred. Extra care required around `core/registry.js`'s mount/unmount lifecycle since this is the first time more than one view can be "open" at once.
2. **Delete confirmation: use the existing confirm dialog.** Project rules/files deletes go through the app's existing `.confirm-*` pattern, not the prototype's optimistic no-confirm delete.
3. **Blue: use the existing `--branch` token (`#58A6FF`).** No new branch-blue token added; every `#2D6CDF`/`#3E7BD6` in the prototype maps to `--branch`.
4. **Style defaults: underline tabs + cards canvas theme.** `tabBarStyle: 'underline'`, `canvasTheme: 'cards'` — not exposed as user-facing settings for v1, just the fixed defaults.

## Rollout — one phase per session (AGENTS.md convention)

See `docs/project-notes/TASKS.md` for the phase breakdown (RD00–RD08) and `docs/project-notes/DECISIONS.md` for the associated ADRs. Each phase: implement → smoke test (AGENTS.md verification list, with extra attention to branch-panel Fragile areas) → update `CHANGELOG.md` / `CHANGES.md` / `RUNS.md` → stop for human review.
