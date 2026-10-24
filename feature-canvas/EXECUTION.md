# Canvas — Execution Plan

Version 1.0 · 24 October 2026 · Target branch `feature-canvas` (from `refactor/p0-repo-hygiene`)

**Status: C0 and C1 done (24 Oct 2026). Everything from C2 on is unbuilt.** The data layer exists
and is tested (56 tests); there is no Canvas UI, no `flags.canvas`, and no model call.
`@xyflow/react@12.12.0` is installed but imported nowhere — its first import is C3. The only
measured numbers in this document are the C0 spike's, in §7 C0 and ADR-067; every other performance
figure, capability and acceptance criterion is still a target, not a result.

This document reconciles the four `feature-canvas/` specs against the actual repository and turns
them into phases an agent can build one session at a time. It is the operating document for the
Canvas feature; the specs remain the product authority.

**Inputs.** [`CANVAS-TECHNICAL-REQUIREMENTS.md`](CANVAS-TECHNICAL-REQUIREMENTS.md) (R1–R9, FR-01–16,
UI-01–10, AC-01–17, packets P0–P5) · [`PRD.md`](PRD.md) (flows, zero states, AC01–AC16) ·
[`engineering.md`](engineering.md) (packets E0–E7) · [`DESIGN.md`](DESIGN.md) (thinking-canvas
visual guide) · [`Conversations.dc.html`](Conversations.dc.html) (the active design) ·
[`index.html`](index.html) (visual PRD) · [`DESIGN-FILES.md`](DESIGN-FILES.md).

**Repository authority that overrides the specs where they disagree.**
[`AGENTS.md`](../AGENTS.md) · [`CLAUDE.md`](../CLAUDE.md) · [`docs/DESIGN.md`](../docs/DESIGN.md) ·
[`docs/REFACTOR-HANDOFF.md`](../docs/REFACTOR-HANDOFF.md) · [`FEATURES.md`](../FEATURES.md) ·
[`BUGS.md`](../BUGS.md).

Task queue: [`docs/project-notes/TASKS.md`](../docs/project-notes/TASKS.md), entries `TASK-C-PRE`
through `TASK-C5`, each linking back to a phase in §7 here.

---

## 1. Scope and the v1 gate

Canvas adds a persistent 2D thinking canvas under Projects. Every canvas belongs to a project. The
loop: ask → inspect the reply → branch from an exact selection → synthesize several sources →
save an output → return later with content, provenance and spatial layout intact.

**Ships as v1 (phases C0–C4).** Project Canvases card and library · canvas tabs · pan/zoom/drag/
resize with persisted layout · minimap · the Ink scoped composer with persisted per-target drafts ·
source selection and snapshots · context islands · reading projection · live **text** ask, continue,
branch and multi-source synthesis through the existing providers · output detail with version
navigation and save-to-Artifacts · Canvas results in the search palette.

**Planned here but outside the v1 gate (phase C5).** Generated images and video · media viewers and
per-part retry · the full accessibility and performance programme · storage-quota drills. C5 is
written down so that nothing in v1 implies these work. Until C5 lands, an unsupported output type
is **explained and disabled**, never faked.

**Not in this feature at all.** Agent orchestration, task assignment, approvals, agent screens or
an agent runtime (§8 reserves the data boundary only) · voice recording and transcription · CRDTs,
multiplayer or shared canvases · whiteboard frameworks · vector databases · Redis · a background
worker runtime · OpenTelemetry or any analytics event pipeline · any hosted service.

---

## 2. Reconciliation ledger

`engineering.md` was written for a hosted multi-tenant product. This repo is a single-user,
local-first macOS app: FastAPI on `127.0.0.1:8765`, no accounts, IndexedDB as the database, the
user's own API keys in `localStorage`. Each row below is a decision, not an open question.

| # | Spec says | Repo reality | Resolution | Recorded in |
| --- | --- | --- | --- | --- |
| 1 | The relational database is authoritative; IndexedDB is a draft cache | There is **no server database**. Five Dexie DBs, each one `kv` store, are the product database | **Local only. No Postgres, no SQLite, no server DB, ever.** One new Dexie DB `notlinear-canvas`; see §4 | §4, ADR-066 |
| 2 | PostgreSQL + object storage + background workers + transactional outbox + leases | None of this infrastructure exists | Not adopted. Durability is a confirmed IndexedDB write plus, for binaries only, the filesystem through existing consent'd endpoints | §4, §7 C5 |
| 3 | "Saved" requires server acknowledgement; ≥99.5 % server-save success | Nothing to acknowledge | **"Saved" = a confirmed local IndexedDB write.** The server-save metric is dropped | §4, §8 |
| 4 | Server-managed providers and secrets; do not place keys client-side | Keys are user-entered, in `localStorage`, proxied by the local server | Unchanged. Keys are never logged; the runtime log's auth redaction stays | §6, AGENTS.md security |
| 5 | Owner/project IDs, ownership checks, cross-user denial, signed asset URLs, tenant model | One user, no auth layer; only `X-Notlinear-Local` and the filesystem consent ledger | No auth or ownership layer is added. Project membership is a plain `projectId` field | §4 |
| 6 | Provider job IDs with authenticated webhooks | A loopback server cannot receive a webhook | **Polling only** | §7 C5 |
| 7 | Budget reservation, usage metering, duplicate-charge enforcement, billing class | No billing system | Local **cost estimates** from the existing pricing tables in `web/src/chat/usage.ts:32` (`responseCost`) and `:61` (`addUsageToBucket`) | §7 C4 |
| 8 | Resumable server-sent streams for text | The browser owns the text stream | Refresh **interrupts** a stream. Partial text is preserved and marked interrupted with an explicit retry. No claim of resumable generation or exactly-once charging | §7 C4 |
| 9 | Isolated per-task tool workspaces; Temporal / LangGraph / BullMQ | No such runtime | Not adopted | §1 |
| 10 | OpenTelemetry, staged rollout, an analytics event pipeline with ~20 event types | No telemetry exists; AGENTS.md leans local-only and redact-everything | Not adopted. **No message bodies, transcripts or attachment content are recorded anywhere** | §1 |
| 11 | Raw hex tokens, Tabler icons, Space Grotesk 15 px bodies with 23–26 px island titles, three-step shadows | `docs/DESIGN.md`: colour only from a token, UI type 12/13/14, `lucide-react`, a two-step shadow ladder, three themes | **The design's literal hex values are adopted verbatim**, declared once in `web/src/styles/tokens.css` and exposed through `web/tailwind.config.ts`. Icons map to `lucide-react`. UI type stays 12/13/14; prose stays the documented `chat.css` exception. See §6.1 | §6.1, ADR-066 |
| 12 | The prototype's dashed `#B4C7E5` connectors | `FEATURES.md` §9 records the existing branch-canvas edge drawer as present but **force-disabled** (`showEdges = false`) | The new renderer supersedes that code; it is not revived. The read-only branch canvas (`web/src/branch/BranchCanvas.tsx`, ADR-019) stays exactly as it is | §7 C3 |
| 13 | `notlinear-canvas/app/model.js`, `agents-model.js`, `reference-integration-wip` | These paths do not exist in this repo | Ignored. `engineering.md`'s E0 ("map the production stack") is the genuinely required first step and is phase C0 | §7 C0 |
| 14 | `R3`: an absent `composer` query parameter selects the base composer | Source inspection of `Conversations.dc.html` shows the default is `ink` | Use **Ink**, consistent with the PRD | §7 C3 |
| 15 | A prototype runtime (`support.js`, `ds-base.js`, `canvas-navigation.js`, `context-islands.js`) | Vendored prototype JS with unverified provenance | **Not transplanted.** The prototype is read as a specification; `ocean-grain.svg` ships only if its rights are verified, else a tokenised theme-aware background | §6 |

### 2.1 Three facts about this repo that shape everything below

- **Adding row keys to a Dexie `kv` store needs no version bump** (`web/src/db/designs.ts:17`).
  That is why the 13 record families of the requirements doc become key-prefixed row families in
  one store rather than 13 Dexie tables.
- **`web/src/chat/run-and-persist.ts` is not reusable as-is.** It dual-writes rendered legacy HTML
  through `web/src/chat/stream-html.ts` (ADR-038, so the vanilla app can re-read threads) and
  mutates `useChatStore`'s live maps. Canvas calls `runTurn` directly — the precedent ADR-065 set
  for the designs pipeline: "`runTurn` directly, NOT a third `TurnHost`".
- **Nothing in this app persists an x/y coordinate today.** The existing spatial surface
  (`web/src/branch/BranchCanvas.tsx`) is read-only by design and derives positions on every render
  from `web/src/branch/canvas-layout.ts:26` (`canvasLayout`). Editable, persisted layout is
  genuinely new.

---

## 3. Architecture

Five layers. The rule from the requirements doc §8 holds: **UI components never own a provider
request or a database write**, and React Flow nodes reference domain IDs — removing a card is a
different command from deleting content.

```
web/src/canvas/
  types.ts            record families, typed message parts, IDs + revisions
  domain/             pure commands: create, branch, continue, synthesize, saveOutput
  canvas-repo.ts      the ONLY writer to notlinear-canvas
  context/            context resolver: snapshots, inheritance, retrieval, manifest
  exec/               run lifecycle; calls chat/run-turn.ts directly
  view/               React Flow adapter, frames, Ink composer, islands, minimap, reading view
web/src/db/canvas.ts  the Dexie database definition
```

| Layer | Owns | Must not import |
| --- | --- | --- |
| `types.ts` + `domain/` | Entity shapes and the commands over them | React, Dexie, any provider, React Flow |
| `canvas-repo.ts` | Every durable read and write, revision checks, import/export | React, any provider |
| `context/` | Frozen sources, inherited project context, budget, the disclosed manifest | React, React Flow |
| `exec/` | Submission/attempt identity, streaming, cancellation, usage | React Flow, DOM |
| `view/` | Spatial and reading presentation, layout rows, viewport | Dexie, any provider |

**Reuse, not reimplementation.** `exec/` consumes the `ProviderEvent` union
(`web/src/providers/types.ts:65`), the `ChatProvider` interface (`:117`), `ErrorKind` (`:80`), the
Claude→DeepSeek rate-limit fallback (`web/src/chat/run-turn.ts:54`, `FALLBACK_STATUS` at `:33`),
`runTurn` itself (`:37`), `AbortController` cancellation (the pattern at
`web/src/chat/run-and-persist.ts:123`), `TurnUsage`/`responseCost`/`addUsageToBucket`
(`web/src/chat/usage.ts:24`, `:32`, `:61`) and `createDebouncedWriter`
(`web/src/lib/debounced-writer.ts`) for stream coalescing. `context/` reuses
`buildProjectFolderContext`, `linkedFolderFor` (`web/src/chat/project-context.ts:203`),
`folderContextFor` (`:210`) and `sourcesLabel` (`:198`), plus
`web/src/chat/system-prompt.ts`.

**AC-16 is an architectural test, not a feature.** A test consumer under `web/tests/canvas/` must
resolve the same context manifests and output versions without importing React Flow or anything
under `canvas/view/`. If it cannot, the boundary is wrong.

---

## 4. Data model

### 4.1 The database

New Dexie database **`notlinear-canvas`, version 1, one store `kv: 'key'`**, defined in
`web/src/db/canvas.ts`, mirroring `web/src/db/designs.ts`. Written only by
`web/src/canvas/canvas-repo.ts`, which exposes a `mutate()` read-modify-write inside a single `rw`
transaction and a `resetCanvasDbForTests(name)` seam — the shape proven by
`web/src/designs/designs-repo.ts:12` and `web/src/db/artifacts-repo.ts:15`.

Two row weights, for the reason ADR-065 gives: a light index that every list view loads, and heavy
per-canvas documents so editing one canvas never re-serialises the others.

| Row key | Weight | Holds |
| --- | --- | --- |
| `canvas_index_v1` | light | every canvas: id, projectId, title, counts, timestamps, revision |
| `canvas_doc_v1:<canvasId>` | heavy | that canvas's threads, messages, sourceSnapshots, contextManifests, relations, layouts, outputVersions, runs |
| `canvas_draft_v1:<canvasId>` | small, hot | drafts keyed by target — text, selected sources, pending attachments, model and output preference |
| `canvas_view_v1:<canvasId>` | small, hot, device-local | viewport and reading position; never exported |
| `canvas_ops_v1` | small | pending cross-boundary operations awaiting reconciliation |
| `canvas_assets_v1:<canvasId>` | heavy | **declared in C1, unused until C5** |

Drafts and view state are separate rows precisely because they change on every keystroke and every
pan; they must not force a rewrite of the canvas document.

### 4.2 The 13 families of the requirements doc §10.1, as implemented

`canvases` → the index row. `threads`, `messages`, `sourceSnapshots`, `contextManifests`,
`relations`, `layouts`, `outputVersions`, `runs` → collections inside the canvas document, each
keyed by id with the query patterns the requirements doc names (thread + order; source + revision;
canvas + relation type; canvas + layout + entity uniqueness; unique submission attempt).
`drafts`, `viewState`, `operations`, `assets` → their own rows, above.

Rules that hold across all of them:

- Every durable record has a **stable ID**; every editable record has a **revision and timestamps**.
  A write checks the revision it read and surfaces a conflict rather than overwriting (AC-12).
- **Messages hold ordered typed parts**, never rendered HTML. A future audio or transcript part
  must be addable without changing the envelope.
- **Layout is separate from content.** Moving, resizing, collapsing, hiding or panning writes only
  to `layouts` / `canvas_view_v1` and can never change a context manifest (FR-06, AC-06).
- A message **references** an output version; it does not duplicate a mutable output body.
- Streamed content is explicitly **provisional** until finalised.
- **Text source anchors** = immutable source revision + semantic block/part identity + quote or
  range. A resolver reports *changed* or *missing* rather than mislinking, and never regenerates
  automatically (AC-05).
- **Write cadence**: stream deltas and drag geometry are coalesced through `createDebouncedWriter`;
  status transitions and completed edits flush immediately. Never rely on an unload handler.

### 4.3 Impact on the existing databases

| Database / contract | Treatment |
| --- | --- |
| `notlinear` (chat, v1, one `state` row, shared with the legacy app) | **No schema or object-shape change.** A canvas's own `projectId` establishes membership |
| `notlinear-notes` (ADR-007) | Stays separate. No version bump for Canvas. Notes are read through the Notes repo and its server-confirmed backup gate |
| `notlinear-skills`, `notlinear-designs` | No change |
| `notlinear-artifacts` | **Additive, backward-compatible extension only**: an explicit Canvas origin and a discriminated media representation. Canvas IDs never go in `chatId`. Tagged `[SCHEMA]`, with old-record round-trip tests and a backup before the first write. Existing artifacts keep their exact behaviour |
| `nl_tabs_v1` (localStorage, a compatibility contract with the legacy app — `web/src/state/tabs.ts:1-4`) | Envelope shape unchanged. A new `canvas:<id>` identity is added with tested parsing, restoration, closing and missing/deleted handling |
| The twelve frozen `/__notlinear_*` endpoints | Unchanged. Anything new is additive |

**Saving a Canvas output to project Artifacts crosses two databases, so it cannot be one Dexie
transaction.** It uses the `canvas_ops_v1` row: record intent with a deterministic operation ID →
perform the artifact save → record completion and the link. A retry therefore cannot create a
second artifact. The saved artifact is a snapshot pinned to one Canvas output version; later Canvas
edits never silently rewrite it.

**Project deletion.** Canvases are preserved under an **Unassigned** listing until moved or
explicitly deleted, consistent with how project chats are preserved. No orphaned, unreachable work.
Removing a card, deleting content and deleting an asset are three distinct commands.

---

## 5. Surfaces and reuse

| ID | Surface | Where it attaches |
| --- | --- | --- |
| UI-01 | Project overview Canvases card | a `CanvasesCard` using `SectionCard` / `EmptyBody` (`web/src/projects/cards/SectionCard.tsx:12`, `:39`) with a new `canvas` accent added to the `Accent` union at `:3` and `TEXT` map at `:5` |
| UI-02 | Canvas library | a `'canvas'` member of `ProjectView` (`web/src/state/ui-store.ts:23`) and an early return in `web/src/projects/ProjectOverview.tsx` alongside the existing `notes` / `files` / `artifacts` drill-ins |
| UI-03 | Canvas tab + workspace | `canvas:<id>` in `web/src/state/tabs.ts`, `viewForTab` (`web/src/shell/TabStrip.tsx:15`), a lazy route in `web/src/shell/AppShell.tsx:81-85`, a `registerView` descriptor in `web/src/registry/views.ts` |
| UI-04 | Ink composer | primitives extracted from `web/src/chat/Composer.tsx` and `web/src/chat/ComposerMenus.tsx`; attachments from `web/src/attachments/` |
| UI-05 | Conversation / branch cards | the typed part renderer; `WorkingStatus` and the message metadata/actions row reused as presentation |
| UI-06 | Reading view | the same threads and messages, linear, sharing one renderer. **No content duplication** |
| UI-07 | Context islands | Rules, Files, Outputs and optional **manual** canvas memory as world-space objects |
| UI-08 | Output detail | adapted from `web/src/projects/views/ArtifactDetail.tsx` |
| UI-09 | Search | Canvas result types in `web/src/search/SearchPalette`. **Never triggers a paid request** |
| UI-10 | Settings / recovery | capability configuration, storage and job errors, retry and export — existing patterns. Largely C5 |

Canvas is a project feature, not a new global navigation system. The project screen is a full-screen
Radix dialog at `z-[150]`; opening a canvas tab must resolve that ownership so the panel cannot
obscure the tab.

### 5.1 Component reuse matrix

| Existing | Category | Required work |
| --- | --- | --- |
| `shell/Sidebar`, `shell/TabStrip`, breadcrumbs | extend | canvas tab identity, navigation, project return path |
| `projects/cards/SectionCard`, `EmptyBody` | direct reuse | new accent token + Canvas empty-state copy |
| `chat/Composer.tsx` | **extract primitives** | textarea behaviour, IME, paste, skills, Send/Stop. Its draft text is component-local today and must become persisted per canvas + target (FR-05, AC09) |
| `chat/ComposerMenus.tsx` | adapt | its `branchId` discriminator needs a Canvas-target analogue so a Canvas model choice never changes an ordinary chat (FR-16, AC-16 of the requirements doc) |
| `attachments/AttachmentRow`, readers, pickers | adapt | asset references, explicit readiness and failure, canvas-scoped ownership |
| `chat/SelectionPopover.tsx` | adapt **presentation only** | its writes go through `chat/marking.ts` against legacy threads and are not reused |
| `lib/markdown.ts` + highlight.js / KaTeX / Mermaid | reuse behind a typed renderer | render **parts**; never parse layout back out of saved HTML, unlike `web/src/chat/ChatView.tsx:95` (`parseStream`) |
| `WorkingStatus`, metadata and action rows | reuse presentation | bind to Canvas run and part status |
| `ui/FilePreview`, `ui/ImagePreview` | reuse isolation patterns | canvas source references, frame lifecycle |
| `projects/views/ArtifactDetail.tsx` | adapt | Canvas origin, exact-version navigation. Its sandboxing is the model to copy: `<iframe sandbox>` with **no** `allow-same-origin` (`:31`) and SVG as a `data:` URL (`:35`) |
| BlockNote integration | reuse on demand | report and manual-note editing only. **Never an editor instance per streamed reply** |
| `search/SearchPalette` | adapt | Canvas result sources and destinations |
| Confirm / toast / glyph primitives | direct reuse | existing accessibility, copy and theme conventions |
| `branch/BranchCanvas.tsx`, `branch/canvas-layout.ts` | **behavioural reference only** | the read-only legacy branch map is preserved unchanged (ADR-019). Its solved problems are worth copying: text-selection opt-out via a `data-bc-id` ancestor check, and claiming ⌘+ / ⌘− / ⌘0 so browser zoom does not fire |

**Build new:** canvas library, viewport adapter, spatial frames, context and source chips,
persisted drafts, layout operations and undo, synthesis commands, reading projection, the
source-version resolver.

---

## 6. Dependencies

| Need | Selection | Gate |
| --- | --- | --- |
| Spatial UI | **`@xyflow/react`**, pinned, MIT | the C0 spike. MIT passes the allowlist in `web/scripts/check-licenses.mjs` |
| State, storage, styling | existing Zustand, Dexie, Tailwind + tokens | no replacement frameworks |
| Editing and rendering | existing BlockNote, `lib/markdown.ts`, highlight.js, KaTeX, Mermaid | safe rendering, stable source anchors |
| Menus, dialogs, icons | existing Radix primitives, `lucide-react` | focus and Escape integration preserved |
| Media preview | native browser elements | C5 |

React Flow is a **renderer and interaction adapter** — not the workspace database, not the AI
execution engine, not an automatic layout policy.

**Attribution badge.** React Flow renders a visible "React Flow" badge by default, removed with
`proOptions.hideAttribution`. Its licence is plain MIT with no visible-attribution clause — the
obligation is to carry the copyright notice, which `THIRD_PARTY_NOTICES.md` does. Keeping or hiding
the badge is therefore a product decision for the maintainer, not a legal constraint. Decide at C3.

Constraints on adding it: `web/` only, **never `frontend/`**, which bans build steps and runtime
dependencies. The route must be lazy-loaded; `web/dist` already splits `NotesView` into a ~970 kB
chunk and Canvas must not inflate the initial bundle. `pnpm check:licenses` must pass and
`THIRD_PARTY_NOTICES.md` is updated in the same commit. No `@blocknote/xl-*` package, ever
(GPL/commercial).

**Deferred, with no part in v1:** whiteboard frameworks, CRDT or multiplayer infrastructure, vector
databases, Redis, agent frameworks, provider SDKs beyond the existing adapters.

### 6.1 Colour — the decision

The thinking-canvas design's **literal hex values are adopted verbatim** as the Canvas palette:

```
canvas #F5F6F4 · surface #FFFFFF · surface-warm #F6F5F2 · surface-inset #F0EEEA
ink #1A1A1A · ink-control #262626 · ink-muted #666666 · border #D2CFC8 · divider #E3E1DC
link #1F6FD0 · success #1E8A4A · waiting #A56F00
highlights  blue #CCE0FF · pink #F6CCE3 · brown #E6CFBA · green #CEE5C7 · yellow #F7E7A5 · orange #F7D0AC
islands     memory #AFC5A0 · rules #D5B4C7 · files #9DBBCE · outputs #DCBE82
connector   #B4C7E5
```

They are written **once**, as literal hex, in `web/src/styles/tokens.css`, with `dark-mono`, `grey`
and `light` variants, and exposed as Tailwind classes through `web/tailwind.config.ts`. That is
exactly the two-place rule `docs/DESIGN.md` §3 states for a new colour, and `tokens.css` is CSS —
outside `eslint src` — so no rule is bent and no exception is needed.

What remains forbidden is a **literal colour inside a component**: `pnpm lint`'s
`no-restricted-syntax` rule (`web/eslint.config.js:34`) and `web/tests/shell/no-literal-colours.test.ts`
both fail on one, and bug #022 — unreadable light-mode highlight text from a hardcoded colour — is
why. Components use the Tailwind class or `var(--…)`.

Two further `docs/DESIGN.md` rules are unchanged and are not colour: icons are **`lucide-react`**
(the design's Tabler glyphs are mapped, with the Mind Garden set as the alternative), and UI type is
**12 / 13 / 14 px** with prose remaining the documented `chat.css` exception. The design's 15 px
body is prose and therefore legitimate; its 23–26 px island titles are UI and must be re-expressed
in the existing scale. Motion follows the app's 120 / 220 ms conventions, not the prototype's
150–260 ms overrides. The pastel highlight tones must keep the app's existing semantic distinction
between **selection**, **saved highlight** and **branch source** — the `--branch` blue and
`--highlight` amber families already carry meaning and may not be spent elsewhere.

Every token, pattern, layer and screenshot above is documented in `docs/DESIGN.md` **in place**, in
the same commit as the code, with `cd web && pnpm shots` re-run when a screenshot changes.

---

## 7. Phases

Each phase is **one session**, lands behind `flags.canvas` (new in `web/src/flags.ts`, default
`false`), and ends by stopping for the maintainer's smoke test. Do not bundle phases. The full gate
in §8 must be green before each stop.

### C-PRE — Commit refactor P6 (Notes) → [`TASK-C-PRE`](../docs/project-notes/TASKS.md)

> **Resolved 24 Oct 2026 — no work was needed.** P6 was already committed on 2026-10-05 as
> `2b48250`, `flags.notesV2` is `true`, and all four contended files were last touched by `1daf8f6`.
> The handoff docs describing P6 as uncommitted are stale. **C2 is unblocked.** The paragraph below
> records the blocker as it was understood when the plan was written.

Refactor P6 is built and automated-green but **uncommitted**, and it owns
`web/src/projects/ProjectOverview.tsx`, `web/src/state/ui-store.ts`, `web/src/flags.ts` and
`web/src/projects/cards/` — the same files C2 edits. The designs pipeline's P2 is already blocked on
it. The maintainer smoke-tests and commits P6 first.

No Canvas code. **C0 and C1 touch only new files and may run before this.** C2 onward are blocked
on it.

### C0 — Reconciliation and the React Flow spike *(no product code ships)* → [`TASK-C0`](../docs/project-notes/TASKS.md)

A throwaway harness at `web/src/canvas/__spike__/`, ~60 nodes with long prose and one simulated
stream. The pass bar is the requirements doc's P0 exit gate, and all of it must hold **at once**:

1. Text inside a node is selectable; a drag that starts on text does not pan the canvas.
2. `NodeResizer` yields correct **logical** dimensions at 50 %, 100 % and 200 % zoom, connectors
   follow, text reflows, media is not stretched, and the resize commits **one** undo step.
3. A simulated token stream updates one node without re-rendering the scene.
4. A nested scrollable panel consumes its own wheel events.
5. The scoped composer stays in screen space while the world transforms, and stays in the viewport
   when its source is near an edge.
6. Branch, source selection and resize are all reachable **keyboard-only**, with visible focus.

Measure first paint and interaction latency and record the numbers. Also complete `engineering.md`'s
E0: this ledger (§2) reviewed and the architecture and schema in §3–§4 agreed.

**Exit:** a go/no-go ADR in `docs/project-notes/DECISIONS.md`, numbered above **ADR-065**. On
no-go, the fallback is extending `web/src/branch/canvas-layout.ts` and a new editable sibling of
`BranchCanvas.tsx` — §7 is otherwise unchanged. The spike directory is deleted in the same commit.
**Closes:** the renderer decision.

> **Result — GO ([ADR-067](../docs/project-notes/DECISIONS.md)).** All six gates passed together at
> 60 cards / 59 edges, driven by Playwright against real Chromium. Resize produced logical deltas of
> exactly 200/120, 100/60 and 50/30 at 50/100/200%, each one undo entry, each undo restoring. A
> token stream re-rendered only the streamed subtree (1 → 91) while the scene held at 68 and a
> neighbouring card at 3. Pan ran at a locked 60fps (16.7ms mean / 17.4ms worst); first paint 65ms.
> Bundle 52kB gzip JS + 3kB CSS. The harness and both runs are archived at
> [`spike-c0/`](spike-c0/) and the spike was removed from `web/src`. The PRD's 100-node / 200-edge
> target remains unmeasured and is still a C3/C5 obligation.

### C1 — Domain, repository, database *(no UI, no model call)* → [`TASK-C1`](../docs/project-notes/TASKS.md)

New files only; mirrors the designs-pipeline P0 precedent.

- `web/src/db/canvas.ts` — the database of §4.1.
- `web/src/canvas/types.ts` — the record families of §4.2: stable IDs, revisions, timestamps,
  typed message parts, typed relations (branch / reference / synthesis), anchor representation.
- `web/src/canvas/canvas-repo.ts` — the sole writer; `mutate()` in one `rw` transaction;
  revision checks; `resetCanvasDbForTests(name)`.
- `web/src/canvas/domain/` — pure commands: create canvas, create root thread, continue, branch from
  a snapshot, synthesize from several snapshots, save an output version.
- Export and import: records plus a manifest, checksums, ID remapping and a format version.

**Deliberately not done:** no UI, no provider call, no `flags.ts` edit, no React Flow import.

**Exit:** `web/tests/canvas/` green under `fake-indexeddb` — persistence round-trip, revision
conflict, schema fixture validation, import/export with ID remapping, and the AC-16 consumer test
that resolves context and output versions without importing React Flow.
**Closes:** FR-01 identity contracts, AC-12, AC-13, AC-16.

> **Result — done ([ADR-068](../docs/project-notes/DECISIONS.md)), 56 tests.** The document is five
> row families in one `kv` store, not one row and not thirteen tables: drafts and viewport are
> separate rows so a keystroke or a pan never re-serialises a canvas full of replies. The domain
> layer is pure and the AC-16 boundary is asserted over the import graph, not assumed. Revision
> checks are opt-in per write and hand back the document that was actually found. Idempotency is by
> submission id, so a double-click or a replayed send cannot duplicate accepted work, and a retry
> preserves the earlier attempt's partial text. Two defects surfaced during the phase: version
> dedupe was comparing freshly-minted part ids rather than content, and an anchor fixture confirmed
> the resolver refuses to relink a quote that moved. **Deliberately deferred:** `flags.canvas` (C2,
> when there is a surface to put behind it), project-context resolution (C4), assets (C5).

### C2 — Tokens, Canvas library, canvas tabs *(first visible surface — blocked on C-PRE)* → [`TASK-C2`](../docs/project-notes/TASKS.md)

- `web/src/styles/tokens.css` + `web/tailwind.config.ts` — the palette of §6.1, all three themes.
- `web/src/lib/keyboard.ts` — new `ESC_PRIORITY` entries, plus matching `z-[…]` paint order. **Name
  collision warning:** `ui-store.canvasOpen` already means the *branch* canvas; Canvas must not
  reuse that key.
- `web/src/flags.ts` — `canvas: false`.
- Project overview: `CanvasesCard` with count, recents, New and View all; the `canvas` accent;
  `'canvas'` in `ProjectView`; the drill-in early return.
- Canvas library: search and filter, create, rename, **duplicate** (remapping internal IDs and
  provenance correctly), delete, reopen. Empty state that feels inviting, not broken.
- Tabs: `canvas:<id>` prefix and predicate in `web/src/state/tabs.ts`, a keep branch in
  `parseTabs`, a `viewForTab` case, a lazy route in `AppShell`, a label/icon branch in `TabStrip`,
  a `registerView` descriptor. The `nl_tabs_v1` envelope is unchanged.
- Project deletion → the Unassigned listing.

**Exit:** reopen restores the library and the tab set; a deleted canvas's tab is handled; the Notes
tab-identity regression passes (**#042 / #043** — open A → open B → back to A → reload with both
tabs open). `docs/DESIGN.md` updated in place, `cd web && pnpm shots` re-run.
**Closes:** UI-01, UI-02, the identity half of UI-03, AC-17.

### C3 — Spatial workspace, Ink composer, reading projection *(still no model call)* → [`TASK-C3`](../docs/project-notes/TASKS.md)

- `web/src/canvas/view/` — the React Flow adapter: pan and zoom in **world** coordinates with
  controls in **screen** space, drag, `NodeResizer`, minimap, selection, a tokenised theme-aware
  background, title and save state. Positions, sizes and collapse state persist to `layouts`;
  viewport to the device-local view row. **Never auto-rearrange what the user placed** — a new card
  appears beside its source with vertical jitter and nothing else moves (FR-06).
- Ink composer: shared primitives from `Composer.tsx`; drafts **persisted per canvas + target** so
  switching canvases carries no text, attachments or context (FR-05, AC09); context chips removable
  individually with the selection state kept in sync (FR-04); a Canvas-target model/output
  preference that never changes an ordinary chat (FR-16).
- Source capture: `SelectionPopover`'s presentation and placement, with Canvas-specific commands;
  snapshots frozen at an immutable revision with a semantic anchor (§4.2).
- Context islands — Rules, Files, Outputs and optional **manual, labelled** canvas memory — as
  world-space objects with explicit included / excluded / processing states. Project *automatic*
  memory stays disabled (`flags.projectMemory` is `false`); FR-13 forbids implying it exists.
- Reading projection: the same threads and messages in linear order, with source navigation,
  authoring and branching, sharing one renderer and duplicating no content.
- The typed part renderer (markdown, code, math, diagrams). Note **bug #056** — a reply beginning
  with a heading renders a stray `#` — as a known pre-existing defect in `lib/markdown.ts`, not a
  Canvas regression.
- Performance discipline from the start: narrow Zustand subscriptions, memoised cards, batched
  connector measurement, lazy editors and viewers. Pointer movement must not re-render the scene.

**Three defects C0 found, which are acceptance criteria here, not discoveries to make late:**

1. **React Flow's stylesheet sets `user-select: none` on `.react-flow__node`.** Out of the box, text
   inside a card cannot be selected at all — the gesture the whole product rests on. The card body
   must set `user-select: text`, and a test must assert a non-empty selection.
2. **Undo snapshots at gesture start, never at gesture end.** Snapshotting when a resize reports
   `resizing: false` captures the already-resized geometry and makes undo a silent no-op. Gate on a
   ref so intermediate frames add no entries, and assert exactly one entry per gesture.
3. **A resize handle must stay reachable.** At 200% a 660×480 logical card is 1320×960 on screen and
   its bottom-right handle leaves the viewport, so the drag silently does nothing. Zoom-correct
   maths is necessary but not sufficient; the keyboard path is the fallback.

Also from C0: a branch card placed beside its source with jitter can land on top of an existing
card. FR-06 forbids moving anything else, so overlap is the accepted cost unless C3 adds
collision-aware placement — decide explicitly rather than by default.

**Exit:** desktop, tablet and a 390 px phone walkthrough; a keyboard-only walkthrough; reduced
motion honoured; drafts proven not to leak between canvases; all three themes looked at.
`docs/DESIGN.md` and `pnpm shots` updated.
**Closes:** UI-03, UI-04, UI-06, UI-07, FR-04–FR-09, AC-07, AC-08, AC-09, AC-14.

### C4 — Live text: ask, branch, synthesize, save *(this is where v1 ships)* → [`TASK-C4`](../docs/project-notes/TASKS.md)

- `web/src/canvas/exec/` calling `runTurn` directly (§2.1), reusing the provider event stream, the
  tool loop and its limits, the rate-limit fallback, timeout and redaction helpers, abort-based
  cancellation and usage accounting.
- `web/src/canvas/context/` — the resolver: frozen snapshots, ancestor history, enabled inherited
  project rules and files through the existing project services, folder retrieval, a token budget
  and a **disclosed manifest** with truncation stated. A filename alone never counts as
  model-ready content (FR-12). A new root defaults to the message inputs plus enabled inherited
  rules; whole-canvas retrieval is **opt-in** (FR-11). Context is visible before submission.
- Run lifecycle: one **submission ID** per send, so a double-click or a refresh cannot duplicate
  accepted work (FR-01, AC-10). Terminal states: completed, failed, cancelled, interrupted. Stop is
  best effort and cannot reverse completed provider work. Retry creates an **attempt** and preserves
  prior partial text and completed tool results (AC-08). Errors surface in the card where they
  happened — never swallowed, never a sample response presented as model output (AC-15).
- Commands: continue appends to the target thread; branch creates a new thread linked to one exact
  snapshot; **multi-source synthesis** creates a new thread linked to every selected source with
  originals and descendants untouched (FR-02, FR-03, AC-03, AC-04). Adding an existing chat or note
  creates a labelled snapshot with a return link — one-way in v1 (FR-10).
- Output detail: preview and source, exact-version navigation, copy and download, **save to project
  Artifacts** through the operation-ID protocol of §4.3. Untrusted HTML in an isolated iframe with
  no app-origin access, scripts off by default, plus an explicit network policy — an opaque origin
  alone does not stop external requests (AC-11). Generated code is readable and downloadable;
  execution is never implicit.
- Canvas result types in the search palette, with exact source navigation and **no** automatic paid
  request.
- `FEATURES.md` edited in place.

**Exit:** the whole loop with a real provider — capture → ask → branch → nested branch →
synthesize → save an output → reload → everything intact — plus the full §8 gate and the 10-step
manual smoke test, with branch items **#002–#009** and tool-status items **#010–#019 / #023**
exercised hard, because Canvas sits next to that code.
**Closes:** UI-05, UI-08, UI-09, FR-01–FR-03, FR-10–FR-13, FR-16, AC-01, AC-02, AC-05, AC-06,
AC-08, AC-10, AC-11.

### C5 — Media and hardening *(planned; outside the v1 gate)* → [`TASK-C5`](../docs/project-notes/TASKS.md)

Written down so nothing in v1 reads as shipped. Each sub-slice is its own flag-gated phase.

- Typed image, report, code and HTML part surfaces; media preview with native elements; codec,
  lifecycle, accessible-control and file-size testing.
- Live image and video adapters **gated on real capability checks**, validated before send and again
  at the execution boundary. An unsupported modality is explained and disabled, never simulated.
  Cost information appears before submission where available; unknown estimates are labelled.
- Partial failure: a successful text part survives a failed media part, and the failed part retries
  independently with usage disclosure (AC-10 of the PRD).
- Binaries that must outlive the browser are written to the filesystem through existing consent'd
  endpoints. **No backend job table, no SQLite, no worker runtime** (ledger rows 1–2, 6). Recovery
  after an app quit is explicit reconciliation on next open, not a promise of continuous execution.
- Accessibility pass; the PRD's 100-node / 200-edge performance target **measured and recorded**,
  not asserted; storage-quota handling with export options preserved; rollback that disables new
  writes while keeping Canvas data readable and exportable.

**Closes:** UI-10, FR-14, FR-15, AC-09, AC-15 of the requirements doc; AC02, AC11, AC15 of the PRD.

---

## 8. Verification

The repository gate, unchanged, run before every phase's stop:

```bash
NOTLINEAR_SERVER=fastapi .venv/bin/python -m pytest tests/contract
NOTLINEAR_SERVER=legacy  .venv/bin/python -m pytest tests/contract
.venv/bin/python -m pytest tests/proxy
cd web && pnpm test && pnpm typecheck && pnpm lint && pnpm check:licenses
cd web && pnpm e2e          # builds web/ first — check $? before trusting the result
```

> **The e2e suite was red when this plan was written; it is green now.** It stood at 19 failed /
> 256 passed, and as of 24 Oct 2026 it is **274 passed / 0 failed** (bugs #057, #058). Neither cause
> was a product regression: three specs asserted behaviour `1daf8f6` deliberately changed, and ~14
> Notes specs clicked a sidebar row that has no click handler, so they passed only when the click
> point happened to land on the inner name button. **One caveat for Canvas:** those Notes tests were
> not exercising what their names claimed for however long they had drifted, so the Notes editor's
> real e2e coverage is thinner than the count implies — do not lean on it as a regression oracle
> without reading the assertions. Everything else is green: typecheck, lint, licences, 657 vitest,
> 158+158 contract, 7 proxy.

New Canvas tests:

- `web/tests/canvas/` — Vitest with `fake-indexeddb` (`web/tests/setup.ts`), per-test database
  isolation through `resetCanvasDbForTests(name)`. Covers persistence, revision conflict, schema
  fixtures, import/export, context-manifest resolution, the anchor resolver's changed/missing
  cases, and the AC-16 no-React-Flow consumer.
- `web/tests/e2e/web-canvas*.spec.ts` — Playwright, `workers: 1` (one IndexedDB origin),
  `NOTLINEAR_FAKE_NATIVE=1`, against the real backend.
- `web/tests/shell/no-literal-colours.test.ts` must stay green — it is the §6.1 guard.
- Fake providers stay deterministic and test-only. Real-provider checks separately establish
  capability, cancellation and fallback behaviour.

Then the 10-step manual smoke test from `AGENTS.md`, recorded in `docs/project-notes/RUNS.md`.
Canvas phases additionally re-exercise, by hand: branch create → nested child → close all → reopen
→ switch chats and back (#002–#004, #008, #009); a search-backed branch question with status
clearing when text arrives and results never lost (#010–#018); the attach menu's file and folder
pickers in the desktop webview (#021); light-mode legibility of every new surface (#022); and the
Claude→DeepSeek fallback after a rate limit (#023).

---

## 9. Acceptance trace

Requirements-doc criteria (AC-01–17):

| ID | Phase | Proven by |
| --- | --- | --- |
| AC-01 one root, recoverable after reload | C4 | e2e: create → send → reload |
| AC-02 branch and nested branch survive close/reopen/project switch | C4 | e2e + manual (#002–#009) |
| AC-03 synthesize two sources; originals intact | C4 | unit (domain) + e2e |
| AC-04 two canvases, different drafts/model/context; no leakage | C3 | unit (drafts) + e2e, both tabs open, reload |
| AC-05 resize a streaming card at 50/100/200 %; one undo step | C0 spike, C3 | spike measurement, then e2e |
| AC-06 move/hide a source without changing the manifest; edited source still resolves its version | C3, C4 | unit (anchor resolver, manifest immutability) |
| AC-07 search → exact source → reading mode → canvas keeps identity | C4 | e2e |
| AC-08 timeout/cancel preserves partial text and tool results | C4 | unit (exec) + manual (#010–#019) |
| AC-09 no duplicate accepted media jobs; unknown outcomes reconcile | **C5 — outside the v1 gate** | — |
| AC-10 text succeeds, media fails; only the failed part retries | **C5 — outside the v1 gate** | — |
| AC-11 HTML cannot reach app storage; declared network policy | C4 | e2e isolation spec |
| AC-12 two tabs edit one record; conflict recovered, no silent overwrite | C1 | unit (revision check) |
| AC-13 export/import restores assets, links, sources, layout, versions | C1 (records), C5 (asset bytes) | unit fixtures |
| AC-14 all themes, keyboard-only, narrow screen, focus/Escape, reduced motion | C2, C3; full pass in C5 | manual walkthrough + `pnpm shots` |
| AC-15 existing chats, notes, branches, tools, settings, attachments regress clean | every phase | the §8 gate + manual smoke test |
| AC-16 a non-Canvas consumer resolves context and output versions without React Flow | C1 | unit (the boundary test) |
| AC-17 project deletion, canvas duplication and deletion obey retention rules | C2 | unit + e2e |

PRD criteria: **AC03, AC04, AC05, AC06, AC12, AC16** → C1/C3/C4 as above. **AC07, AC08, AC09,
AC14** → C3. **AC10, AC13** → C4. **AC01, AC02, AC11, AC15** involve voice, image processing or
generated media and are **outside the v1 gate** — AC01's voice half is not in this feature at all.

No criterion may be marked met without a recorded test result or a recorded manual check.

---

## 10. Remaining open decisions

Decisions 1–3 (storage, colour, scope and renderer) are **closed** — see §2, §6.1, §1. These remain:

| Decision | Proposed default | Must close by |
| --- | --- | --- |
| Anchor representation detail | source revision + semantic block/part identity + quote or range; media by version + region or timestamp | C1 |
| Per-modality storage limits and the backup path | tested limits per modality; a complete export with an asset manifest; browser persistence requested where supported | C1, revisited in C5 |
| Artifact compatibility strategy | additive Canvas origin and media variant, backward-compatible reader, backup before the first write | before any shared artifact write (C4) |
| HTML preview network policy | scripts off by default, a constrained network policy, stated in the UI | before the HTML surface ships (C4) |
| Media provider selection | chosen from actual capability and cost tests, not from library availability | C5 |
| React Flow attribution badge | maintainer's call; MIT imposes no visible-attribution requirement | C3 |
| Branch-card placement overlap | accept overlap (FR-06 forbids moving other cards), or add collision-aware placement | C3 |
| Legacy-app coexistence | a stale legacy tab can already overwrite a `/web/` change (`FEATURES.md` §6b). Canvas's own database is unaffected, but the artifact extension is shared — gate those writes until compatibility is established | C4 |

---

## 11. Memory obligations for every Canvas session

Per `CLAUDE.md` and `AGENTS.md` "Project memory":

- `docs/CHANGELOG.private.md` **and** `docs/project-notes/CHANGES.md` — always. The root
  `CHANGELOG.md` is the short public changelog; agent logs do not go there.
- `docs/project-notes/RUNS.md` — the commands run and the smoke-test outcome.
- `docs/project-notes/DECISIONS.md` — an ADR for every architectural choice. **Canvas ADRs start
  above ADR-065.**
- `docs/project-notes/TASKS.md` — statuses kept current for `TASK-C-PRE`…`TASK-C5`.
- `BUGS.md` — an entry per fix, in the required shape, with the Fragile-areas list updated if a
  failure recurs.
- `FEATURES.md` — edited **in place** when a feature is added, removed or materially changed. It is
  a current-state snapshot, not a changelog.
- `docs/DESIGN.md` — edited **in place** for any token, theme, type, spacing, motion, component
  pattern, layered surface or anything visible in a screenshot, in the **same commit**; then
  `cd web && pnpm shots` when a screenshot is affected.

Definition of done for the v1 gate: the declared C0–C4 scope works in Notlinear, passes the recorded
regression and recovery checks, reuses the established UI system through tokens, and leaves a tested
shared-data boundary that a future separate Agents interface could read. A prototype that merely
matches the screenshots is not done.
