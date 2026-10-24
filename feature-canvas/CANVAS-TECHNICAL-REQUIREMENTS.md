# Notlinear Canvas — Technical Requirements

Version 1.0 · 24 October 2026 · Target branch: `feature-canvas`

Status: implementation proposal for review. This document consolidates the requested Canvas scope; it is not evidence that any feature, migration, dependency, or performance target has been implemented or verified.

## 1. Objective and scope

Add a persistent 2D thinking canvas under Notlinear Projects. Users can ask questions, inspect multimodal responses, branch from meaningful selections, combine sources, edit useful outputs, and return without losing content or spatial organization.

Build Canvas now. Preserve a shared foundation so a separate Agents interface can later operate on the same conversations, sources, runs, and output versions. Do not implement agent orchestration, task assignment, approval workflows, agent tools, or agent screens in this release.

Current input scope: text, with existing image/file attachment capabilities adapted where supported. Voice recording/transcription is deferred. Required output architecture: text, report, code, HTML/SVG, images, and video. Live image/video generation ships through explicit provider integrations; unsupported modalities remain unavailable rather than producing sample results.

## 2. Reference documents and authority

The paths below identify the supplied local references. They are absolute links for this handoff; copy approved references into repository documentation before relying on them in an open-source distribution.

| ID | Reference | Responsibility |
| --- | --- | --- |
| R1 | [Product PRD](/Users/yash/Documents/ChatGPT/Random/notlinear-prd/PRD.md) | Product flows, multimodal contracts, scope, provenance, recovery, acceptance scenarios, and future agent foundation. |
| R2 | [Engineering build guide](/Users/yash/Documents/ChatGPT/Random/notlinear-prd/engineering.md) | Proposed system boundaries, execution durability, provider integration, schema evolution, and implementation packets. |
| R3 | [Thinking Canvas design guide](/Users/yash/Documents/ChatGPT/Random/notlinear-design/templates/thinking-canvas/DESIGN.md) | Spatial composition, cards, source highlights, scoped composer, context islands, and interaction rules. |
| R4 | [Notlinear design system](/Users/yash/Downloads/notlinear/docs/DESIGN.md) | Existing themes, tokens, typography, icons, reusable patterns, layering, keyboard behavior, and screenshot process. |
| R5 | [Design file map](/Users/yash/Documents/ChatGPT/Random/notlinear-design/templates/thinking-canvas/DESIGN-FILES.md) | Distinguishes Conversations, Agents, and the combined reference. |
| R6 | [Prototype implementation notes](/Users/yash/Documents/ChatGPT/Random/notlinear-design/templates/thinking-canvas/IMPLEMENTATION.md) | Documents prototype interactions, session-only persistence, and simulated outputs. |
| R7 | [Notlinear README](/Users/yash/.codex/worktrees/9c32/notlinear/README.md) | Current application stack, local deployment, origin, and verification commands. |
| R8 | [Repository AGENTS instructions](/Users/yash/Downloads/notlinear/AGENTS.md) and [CLAUDE notes](/Users/yash/Downloads/notlinear/CLAUDE.md) | Repository conventions and review process; read alongside the human-supplied instructions. |
| R9 | [Refactor handoff](/Users/yash/Downloads/notlinear/docs/REFACTOR-HANDOFF.md), [migration plan](/Users/yash/Downloads/notlinear/MIGRATION.md), [feature inventory](/Users/yash/Downloads/notlinear/FEATURES.md), [bug memory](/Users/yash/Downloads/notlinear/BUGS.md) | Historical constraints, current feature descriptions, and regression risks; historical phase/status claims require reconciliation with active source. |

### 2.1 Actual design files

All files in this table live in the supplied [thinking-canvas directory](/Users/yash/Documents/ChatGPT/Random/notlinear-design/templates/thinking-canvas/).

| Reference | Use |
| --- | --- |
| [Conversations.dc.html](/Users/yash/Documents/ChatGPT/Random/notlinear-design/templates/thinking-canvas/Conversations.dc.html) | Primary Canvas interaction and visual reference. Inspect at matching viewport, zoom, and composer variant. |
| [Agents.dc.html](/Users/yash/Documents/ChatGPT/Random/notlinear-design/templates/thinking-canvas/Agents.dc.html) | Future interface reference only; informs shared boundaries without adding agent scope. |
| [ThinkingCanvas.dc.html](/Users/yash/Documents/ChatGPT/Random/notlinear-design/templates/thinking-canvas/ThinkingCanvas.dc.html) | Combined historical reference; does not supersede the separate active designs. |
| [composer-variants.css](/Users/yash/Documents/ChatGPT/Random/notlinear-design/templates/thinking-canvas/composer-variants.css) | Final Ink styles and variant overrides. |
| [canvas-navigation.js](/Users/yash/Documents/ChatGPT/Random/notlinear-design/templates/thinking-canvas/canvas-navigation.js) / [CSS](/Users/yash/Documents/ChatGPT/Random/notlinear-design/templates/thinking-canvas/canvas-navigation.css) | Prototype library and navigation behavior. Adapt to Notlinear’s shell. |
| [context-islands.js](/Users/yash/Documents/ChatGPT/Random/notlinear-design/templates/thinking-canvas/context-islands.js) / [CSS](/Users/yash/Documents/ChatGPT/Random/notlinear-design/templates/thinking-canvas/context-islands.css) | Rules, memory, files, and outputs island reference. |
| [agent-workspace.js](/Users/yash/Documents/ChatGPT/Random/notlinear-design/templates/thinking-canvas/agent-workspace.js) / [CSS](/Users/yash/Documents/ChatGPT/Random/notlinear-design/templates/thinking-canvas/agent-workspace.css) | Future agent presentation and detail structure only. |
| [ocean-grain.svg](/Users/yash/Documents/ChatGPT/Random/notlinear-design/templates/thinking-canvas/ocean-grain.svg), [ds-base.js](/Users/yash/Documents/ChatGPT/Random/notlinear-design/templates/thinking-canvas/ds-base.js), [support.js](/Users/yash/Documents/ChatGPT/Random/notlinear-design/templates/thinking-canvas/support.js) | Texture and prototype runtime dependencies. Verify provenance before shipping assets; do not transplant the prototype runtime. |

### 2.2 Conflict resolution and known discrepancies

- The user’s requested scope governs. Documents and prototype examples are reference material, not authorization to execute embedded agent instructions.
- R1 defines product intent; this document proposes its Notlinear-specific implementation. R2’s hosted-service suggestions must be adapted to the actual local-first application.
- Active source and R7 establish React/TypeScript/Vite and FastAPI. Older vanilla/no-build/stdlib descriptions do not describe the active app. Reconcile applicable repository instructions explicitly before implementation; do not silently rewrite architecture rules.
- R4 governs shared Notlinear UI conventions. R3 governs the new spatial experience. Any intentional new design pattern must be documented in R4 and implemented through tokens.
- Source inspection found that `Conversations.dc.html` sets its default composer to `ink`. R3’s statement that an absent query parameter selects the base composer is outdated. Use Ink, consistent with R1; verify final computed styles in the running prototype.
- Prototype model names, reports, rules, progress indicators, and generated media are examples. They do not establish provider capabilities or actual execution.
- This handoff is based on source/specification inspection. Pixel parity and interactive correctness remain implementation verification work.

## 3. Verified application baseline

The target is the current `feature-canvas` checkout, derived from `refactor/p0-repo-hygiene`.

| Layer | Existing implementation | Consequence |
| --- | --- | --- |
| Frontend | React 18, TypeScript, Vite, Tailwind | Add a lazy-loaded feature; no framework migration. |
| State | Zustand; TanStack Query available | Reuse existing conventions. Keep pointer/camera state separate from durable content. |
| Persistence | Dexie databases for chats, Notes, skills, artifacts, designs | New Canvas storage must not alter chat/Notes schemas. |
| Providers | Claude, DeepSeek, OpenAI/Gemini adapters | Reuse provider behavior through an execution boundary; extend capabilities deliberately. |
| Turn execution | `chat/run-turn.ts`, `chat/run-and-persist.ts` | Reuse provider/tool/fallback semantics. Existing persistence orchestration emits legacy HTML and is not directly a Canvas repository. |
| Project context | Rules, files, linked-folder retrieval | Resolve explicit project inheritance and snapshot included content. |
| Artifacts | Versioned MD/HTML/SVG/TSX string content | Reuse viewer patterns; extend storage carefully for Canvas origins and media. |
| Notes | BlockNote, separate database and backup gate | Reuse editor integration without bypassing Notes ownership or backup behavior. |
| Backend | Local FastAPI, origin middleware, filesystem consent, static allowlist | Add services through existing boundaries. Never expose arbitrary repository or filesystem paths. |
| Verification | Vitest, fake-indexeddb, Playwright, pytest | Extend the existing verification system. |

Key source areas: `web/src/projects`, `shell`, `chat`, `branch`, `providers`, `attachments`, `notes`, `db`, `ui`, `styles`, and `backend/app`.

## 4. Implementation instructions

1. Add Canvas under Projects. Every Canvas in this release belongs to an existing project.
2. Preserve existing chat, branch, Notes, settings, tool, and attachment behavior.
3. Read callers before changing shared functions; record affected consumers and verify them.
4. Share UI primitives and execution semantics through explicit interfaces. Do not make Canvas masquerade as a legacy chat or branch.
5. Keep canonical content independent of React Flow, DOM markup, and either feature’s UI.
6. Distinguish visual selection, model context, saved highlights, and branch ancestry.
7. Freeze selected source revisions before generation. Panning, resizing, hiding, or moving a card must not affect model context.
8. Preserve successful content and tool results through cancellation or partial failures.
9. Add backend endpoints without renaming or changing existing `/__notlinear_*` contracts. Use existing API/logging helpers and local-origin protections.
10. No hardcoded secrets; redact credentials and avoid logging full prompts/assets by default.
11. Introduce dependencies only for the assigned slice, pin compatible versions, and update third-party notices/license checks.
12. Document schema changes with `[SCHEMA]`, migrations, backward compatibility, and recovery/rollback behavior.
13. Update feature/design documentation, required project memory, and screenshots as applicable during implementation. Do not treat this proposal as a completed ADR or completed test run.

## 5. Pages and user-facing surfaces

| ID | Surface | Required behavior |
| --- | --- | --- |
| UI-01 | Project overview | Canvases section card with count, recent items, New and View all. |
| UI-02 | Project canvas library | Search/filter, create, rename, duplicate, delete, reopen. Duplication remaps internal IDs and provenance correctly. |
| UI-03 | Canvas tab/workspace | Stable tab identity; pan/zoom; movable/resizable content; minimap; selection; title and save state. |
| UI-04 | Ink composer | Explicit target/scope, per-target draft, context chips, attachments, model, output type, Send/Stop. |
| UI-05 | Conversation/branch cards | Readable replies, source rail, streaming/error/usage state, branch/continue actions. |
| UI-06 | Reading view | Same threads/messages, source navigation, authoring, and branching; no content duplication. |
| UI-07 | Context panel/islands | Rules, files, outputs, and optional manual canvas memory. Clear included/excluded and processing states. |
| UI-08 | Output detail | Preview/source, version navigation, copy/download, save to project Artifacts, return to origin. |
| UI-09 | Search | Canvas/thread/message/output types with exact source navigation; no automatic paid request. |
| UI-10 | Settings/recovery | Capability configuration, storage/job errors, retry and export/recovery actions using existing patterns. |

Canvas is a project feature, not a new global navigation system. Reuse existing shell/tab conventions. The project overview’s modal/panel ownership must be resolved when opening a normal Canvas tab so it cannot obscure that tab.

## 6. Design comparison and reuse requirements

| Area | Reference difference | Required direction |
| --- | --- | --- |
| Sidebar | Prototype is 236px; app has existing shell dimensions | Reuse app sidebar and project hierarchy. |
| Palette | Prototype is light-first | Tokenized dark, grey, and light support; no literal colors in components. |
| Fonts/type | Same families; prototype has some differing sizes | Existing UI scale and prose hierarchy first. New values become documented patterns. |
| Icons | Prototype Tabler; app Lucide | Use `lucide-react`. |
| Composer | Ink differs from the current chat frame | New Canvas arrangement with shared input/control primitives. |
| Highlights | Prototype pastel relationships; app distinguishes selection/branch/highlight | Preserve semantic distinctions; add Canvas relationship tokens only if needed. |
| Islands | Prototype uses asymmetric floating frames | Reuse data/edit controls, add Canvas-specific wrappers; document new shapes. |
| Motion | Prototype contains historical overrides | Reuse app motion/reduced-motion rules; spatial movement must explain a state change. |
| Background | Ocean texture versus existing plain/dotted surfaces | Use a subtle theme-aware Canvas treatment with verified asset rights. |
| Overlays | Prototype’s layering is independent | Register Canvas surfaces in app Escape/focus/layer systems and verify stacking; copied z-indices are not a contract. |

### 6.1 Component reuse matrix

| Existing component/module | Reuse category | Required work |
| --- | --- | --- |
| `shell/Sidebar`, `TabStrip`, breadcrumbs | Extend | Canvas tab identity/navigation and project return path. |
| `projects/cards/SectionCard`, `EmptyBody` | Direct presentation reuse | New Canvases section and appropriate empty-state copy. |
| `chat/Composer` | Extract shared primitives | Reuse textarea behavior, IME, paste, skills, Send/Stop. Current text is component-local and not persisted. |
| `chat/ComposerMenus` | Adapt | Controlled preference values/actions. Existing menus mutate global prefs or legacy branch state. |
| `attachments/AttachmentRow`, readers/pickers | Adapt | Asset references, explicit readiness/failure, Canvas-scoped ownership. |
| `chat/SelectionPopover` | Adapt | Shared presentation/positioning; Canvas-specific source capture and commands. Existing actions address legacy threads. |
| Markdown/code/KaTeX/Mermaid renderer | Reuse behind typed renderer | Render content parts without parsing layout/state from saved HTML. |
| `WorkingStatus`, metadata/actions | Reuse presentation | Bind to Canvas run/part status and usage. |
| `ui/FilePreview`, `ImagePreview` | Reuse isolation/control patterns | Canvas source references, media support, frame lifecycle. |
| `projects/views/ArtifactDetail` | Adapt shared rendering/actions | Canvas origin, media types, exact-version navigation. |
| BlockNote integration | Reuse on demand | Report/manual-note editing; no editor instance in every streamed reply. |
| `search/SearchPalette` | Adapt | Reuse shell/keyboard behavior; add semantic Canvas result sources and destinations. |
| Confirm/toast/glyph primitives | Direct reuse | Existing accessibility, copy, and theme conventions. |
| `branch/BranchCanvas` | Behavioral reference only | Preserve its read-only legacy branch map. New editor has different scope and persistence. |

Build new: Canvas library, viewport adapter, spatial frames, context/source chips, persistent drafts, layout operations/history, synthesis commands, reading projection, source-version resolver, and media-job surfaces.

## 7. Technologies and dependency decisions

| Need | Selection | Adoption gate |
| --- | --- | --- |
| Spatial UI | `@xyflow/react` / React Flow | Spike: selectable long prose, zoom-aware resize, nested scroll, streamed updates, scoped composer, keyboard use. |
| State/storage/style | Existing Zustand, Dexie, Tailwind/tokens | No replacement frameworks. |
| Editing/rendering | Existing BlockNote, markdown, highlight.js, KaTeX, Mermaid | Confirm safe rendering and stable source anchors. |
| Menus/dialogs/icons | Existing Radix/shared primitives/Lucide | Preserve focus and Escape integration. |
| Media preview | Native browser elements initially | Test codecs, lifecycle, accessible controls and file limits. |
| Backend/media jobs | Existing FastAPI; SQLite and managed files when needed | Restart/reconcile/cancel tests before claiming durable generation. |
| Voice later | MediaRecorder and provider transcription adapter | Separate future scope; user-reviewed transcript before send. |

React Flow is a renderer/interaction adapter, not the workspace database, AI execution engine, or automatic layout policy. Its MIT core supports custom React nodes, resizers, and interaction utilities: [custom nodes](https://reactflow.dev/learn/customization/custom-nodes), [NodeResizer](https://reactflow.dev/api-reference/components/node-resizer), [utility classes](https://reactflow.dev/learn/customization/utility-classes), [performance](https://reactflow.dev/learn/advanced-use/performance), [license](https://xyflow.com/open-source).

Defer whiteboard frameworks, CRDT/multiplayer infrastructure, vector databases, Redis, and agent frameworks. None is necessary to establish the requested local Canvas foundation. Provider SDK adoption is optional behind existing adapter boundaries; library choice does not establish model modality support.

## 8. Shared architecture and future Agents compatibility

### 8.1 Boundaries

- **Domain:** canvases, threads, messages, source snapshots, relationships, output versions, run identities.
- **Repositories:** durable read/write, schema validation, revision checks and import/export.
- **Commands/services:** create, branch, continue, synthesize, revise, save output, submit/retry/cancel generation.
- **Context resolver:** exact sources, history, inherited project rules, retrieval, budgets, and manifest.
- **Execution adapters:** existing text providers/tools and new image/video job adapters.
- **Presentation adapters:** Canvas now; reading view now; separate Agents UI later.

UI components must not directly own provider requests or canonical database writes. React Flow nodes reference domain IDs; deleting a visual representation is a distinct command from deleting content.

### 8.2 Contracts required now

| Contract | Canvas now | Agents later |
| --- | --- | --- |
| Stable entity IDs and revisions | Reopen, provenance, links | Assignments and exact-version review |
| Author/producer reference | Human and model identity | Agent identity without changing message structure |
| Typed message parts | Text/code/report/HTML/media | Same deliverables and communications |
| Source snapshot/context manifest | Frozen branch/synthesis evidence | Frozen task inputs |
| Submission/run/attempt identity | Duplicate-send protection, retry, usage | Execution attempts/checkpoints |
| Versioned output reference | Revisions/export | Handoff and QA evidence |
| Typed relationship | Branch/reference/synthesis | Separate dependency/delegation relations |
| Independent layout | Spatial/reading views | Agent UI’s own layout over shared entities |

Do not create agent tasks, approval tables, agent schedulers, or agent UI now. Reserve extension points rather than speculative empty infrastructure. Future tasks reference existing entities and output versions; they do not migrate or duplicate Canvas messages.

Reference edges may be cyclic. Future execution-dependency edges will require separate validation. No visual edge grants filesystem/network authority or starts work.

## 9. Functional contracts

| ID | Requirement |
| --- | --- |
| FR-01 | First send creates one root thread and one submission; repeated activation cannot duplicate accepted work. |
| FR-02 | Continue appends to the target thread. Branch creates a new thread linked to an exact source snapshot. |
| FR-03 | Multi-source synthesis creates a new thread linked to every selected source; originals remain intact. |
| FR-04 | Context chips show source/excerpt and can be removed independently. Context is visible before submission. |
| FR-05 | Drafts are scoped to project/canvas/target. Switching canvases never carries text, attachments, or context implicitly. |
| FR-06 | Moving/resizing/panning changes layout only. New cards do not rearrange user-positioned content. |
| FR-07 | Selection, editors, menus, and nested scrolling remain usable without initiating canvas dragging. |
| FR-08 | Pan/zoom operate in world coordinates; controls remain screen-space. Resize is zoom-correct and commits one undo operation. |
| FR-09 | Canvas, reading, search, and output detail preserve object identity and return-to-source navigation. |
| FR-10 | Adding an existing chat/note initially creates a labeled source snapshot with a return link. Live bidirectional editing is separate scope. |
| FR-11 | New-root context defaults to message inputs and enabled inherited rules. Whole-canvas retrieval requires explicit scope. |
| FR-12 | Rules/files are resolved through existing project services; copied context is revisioned. A filename alone never means model-ready content. |
| FR-13 | Project automatic memory is not an existing capability: `projectMemory` is disabled. Any Canvas memory in this release is explicit/manual and labeled. |
| FR-14 | Empty, loading, offline, incompatible-model, partial, failed, cancelled, interrupted, and missing-source states preserve recoverable work. |
| FR-15 | Output selection supports Auto/Text/Report/Code/HTML/Image/Video as capabilities become live. Unavailable choices are explained/gated. |
| FR-16 | Settings/model changes are target-scoped with explicit inheritance; changing a Canvas model must not silently change ordinary chats. |

### 9.1 Input/output and safety

Messages contain ordered typed parts. Text, file/image attachments, code, report, HTML, image, and video have explicit metadata and independent processing state. Future audio/transcript parts can be added without changing the message envelope.

Use existing prose/code/math/diagram rendering. HTML is an optional artifact, never the mandatory format for all replies. Preview untrusted HTML in an isolated iframe without app-origin access; scripts remain off by default. Add an explicit network policy for previews, because an opaque origin alone does not prevent external requests. Generated code is readable/downloadable; execution is not implicit.

Media generation requires an actual compatible provider adapter. Validate capabilities before send and again at the execution boundary. Preserve successful parts when another fails; retry failed parts independently with usage disclosure. Paid media settings/cost information appear before submission where available; unknown estimates are labeled.

## 10. Database requirements and migration

### 10.1 New browser database: `notlinear-canvas`, proposed version 1

Use individual indexed records rather than one whole-workspace JSON row. All durable records have stable IDs; editable records have revision and timestamp metadata. The final Dexie index declarations must be reviewed with query patterns before implementation.

| Store | Purpose / principal fields | Main query/index requirements |
| --- | --- | --- |
| `canvases` | Project ID, title, timestamps, revision | Project + updated time |
| `threads` | Canvas ID, title, thread kind, timestamps | Canvas membership |
| `messages` | Thread ID, author/producer, sequence, typed parts, revision, producing run | Thread + order; run |
| `sourceSnapshots` | Source ID/type/revision, frozen selected content, semantic anchor, source hash | Source + revision; canvas ownership |
| `contextManifests` | Run, ordered snapshot references, inherited context, budget/truncation disclosure | Run; referenced snapshots |
| `relations` | Typed endpoints: branch/reference/synthesis initially | Canvas + type; endpoint lookups |
| `layouts` | Layout/view identity, entity ID, world position, dimensions, collapsed state | Canvas + layout + entity uniqueness |
| `drafts` | Target, text, selected sources, pending assets, model/output preference | Canvas + target uniqueness |
| `runs` | Submission/attempt IDs, thread, provider/model, status, usage, output/error refs | Unique submission attempt; canvas/status |
| `assets` | Asset ID, MIME, size/hash, location, dimensions/duration, processing state | Ownership; storage state; hash when useful |
| `outputVersions` | Output family ID, immutable version ID, typed parts/assets, producing run | Output family + version; canvas/run |
| `viewState` | Device-local viewport and reading position | Canvas + view + local device scope |
| `operations` | Durable pending/reconciliable cross-boundary operations | Unique operation ID; pending status |

Messages may reference output versions; do not duplicate mutable output bodies independently in both stores. Pending stream content is explicitly provisional until finalized. Text source anchors combine semantic block/part identity, range/quote, and immutable revision; media anchors use source version plus region/timestamp.

Store ordinary text in records. Keep large binaries outside JSON: bounded draft blobs may use IndexedDB, while durable generated media uses the managed backend asset store. Never persist an object URL as the asset’s identity. Establish tested quotas/limits and recovery before release.

### 10.2 Existing database impact

| Database/contract | Required treatment |
| --- | --- |
| Chat `notlinear`, version 1 | No schema or object-shape migration for Canvas. A Canvas’s own `projectId` establishes membership. |
| `notlinear-notes` | Keep separate; no version bump for Canvas. Reads/saves through existing Notes repositories and backup gate. |
| `notlinear-artifacts` | Backward-compatible extension for Canvas provenance and media references when saving Canvas outputs. |
| Skills/design databases | No Canvas-driven schema changes. |
| Tabs `nl_tabs_v1` | Preserve envelope; introduce a distinct `canvas:<id>` identity with tested parsing, restoration, closing, and missing/deleted handling. |

Current artifacts support MD/HTML/SVG/TSX string content and version history. Add a discriminated media representation and explicit Canvas origin rather than putting Canvas IDs in `chatId`. Old artifacts must retain their existing behavior. Migrate artifact values deliberately with versioned payload validation and backup; a value-format migration may be necessary even if the underlying Dexie `kv` table needs no version bump.

Canvas output versions hold working history. Saving to project Artifacts creates/updates an explicit saved snapshot linked to a specific Canvas output version. Subsequent Canvas edits do not silently rewrite that saved snapshot. Reuse existing viewers through a common renderer; do not let two independently editable copies claim the same canonical version.

Cross-database saves cannot be one Dexie transaction. Use operation IDs, deterministic save identities, and reconciliation: record intent, perform the artifact save, then record completion/link. A retry cannot create another saved artifact accidentally.

### 10.3 Durable backend jobs and assets

Introduce SQLite-backed media-job records and an app-managed asset directory when asynchronous image/video generation requires recovery outside the browser request. This is media infrastructure, not agent infrastructure.

Backend records own accepted durable job status, provider job IDs, attempts, event sequence/cursor, usage metadata, and asset completion. IndexedDB owns Canvas edits and drafts and caches job projections. Do not create competing authorities for the same lifecycle.

New API capabilities: asset registration/upload/read, job submission/status/events/cancel/reconcile. Exact additive route names and payloads are a design gate, not established existing endpoints. Reads must use opaque asset IDs, local-origin checks, bounded access, and explicit allowlisting rather than raw host paths.

Backend jobs must persist the required frozen input themselves: a worker cannot depend on reading browser IndexedDB. Persist acceptance and pending work transactionally. Workers claim jobs with recoverable leases. Reconnect resumes by job identity/cursor; duplicate deliveries must not create duplicate accepted outputs.

Keep current browser text-provider integration for the first slice. Refresh interrupts a browser-owned stream; recover partial text as interrupted and offer an explicit retry. Do not claim resumable text generation or exactly-once charging. Backend-owned media jobs survive browser closure while the local service remains running. App quit/Mac sleep requires later reconciliation; continuous offline execution is not promised.

### 10.4 Migration, backup, deletion and rollback

- Add schema/version validation and migration fixtures before writes ship.
- Use transactional revision checks for stale tabs; preserve conflicts for user recovery.
- Coalesce stream/geometry writes. Flush important transitions and completed edits promptly.
- Request/report browser persistence where supported; quota failure must leave recoverable content and export options.
- Export records plus asset bytes with a manifest, checksums, ID remapping, and format version. Existing backup tools must explicitly include Canvas or state their limited scope.
- New storage has no existing records to migrate. Extending artifacts requires backup and old-record round-trip tests.
- Define project deletion behavior explicitly. Recommended: preserve canvases under an Unassigned recovery listing until moved or explicitly deleted, consistent with preserving project chats. Do not leave inaccessible orphaned work.
- Distinguish removing a card, deleting content, and deleting an asset. Keep assets referenced by historical outputs/sources until their retention policy permits cleanup.
- Rollback disables new writes/generation while preserving readable/exportable Canvas data. Older app versions must not corrupt new artifact variants; gate shared-format writes until compatibility is established.

## 11. Execution, recovery and performance

Use the existing provider event stream, fallback rules, tool limits, timeout/redaction helpers, and usage accounting behind a Canvas execution service. `runAndPersist` currently couples these to legacy HTML snapshots and chat live state; extract or adapt the shared core with regression coverage rather than routing Canvas through fake legacy threads.

Submission acceptance, attempts, outputs, and partial failures need explicit transitions. Terminal statuses include completed, failed, cancelled, interrupted, and unknown-outcome where provider reconciliation is required. Stop is best effort and cannot reverse completed provider work. Retry creates an attempt while preserving prior partial output and successful tool evidence.

Use narrow Zustand subscriptions and memoized card/render components. Pointer movement and each streamed token must not rerender the entire scene. Batch connector measurement, lazy-load editors/viewers, and use compact previews for heavy media. Automatic layout is opt-in; adding content never repositions existing user cards.

Performance target, to measure: PRD’s 100 nodes / 200 edges with a long report, mixed media and one active stream remains usable on an agreed representative laptop. Aim for local feedback under 100ms; record measurements rather than claiming compliance in advance.

Verify desktop, tablet, and a 390px phone view. On small screens prioritize reading/thread authoring, source navigation, safe composer placement, touch targets, and keyboard behavior. Accessibility requires keyboard alternatives for branch, source selection, resize and export, visible focus, meaningful status announcements, and reduced motion.

## 12. Delivery packets

| Packet | Scope | Exit gate |
| --- | --- | --- |
| P0 | Audit reconciliation, UI reuse plan, React Flow spike, architecture/schema proposals | Text selection, resize, streaming, nesting/scroll and Ink controls work together; decisions reviewed. |
| P1 | Shared domain/repositories, new Canvas DB, source/output versioning, drafts/export | Persistence, conflict, import/export and revision fixtures pass. |
| P2 | Project card/library, Canvas tabs, spatial editing, reading projection | Reopen restores content, layout, viewport, and independent drafts. |
| P3 | Live text ask/branch/synthesis, project context, output saving | Complete useful loop with real provider and preserved regression behavior. |
| P4 | Typed image/HTML/code/report/media surfaces; assets; live image/video adapters | Supported modalities truthfully gated; backend jobs recover and partial outputs survive failure. |
| P5 | Hardening and release review | Accessibility, performance, compatibility, recovery and live-provider evidence recorded. |

Each packet is reviewable and feature-flagged. P3 is the first complete vertical slice; P4 is required before claiming live image/video generation is included. Agent UI/runtime and voice remain separate follow-up releases.

## 13. Acceptance and verification

| ID | Scenario / required result | Trace |
| --- | --- | --- |
| AC-01 | Project → create Canvas → send → reload: one root and recoverable content. | R1 zero states, FR-01 |
| AC-02 | Create branch and nested branch; close/reopen/switch projects; correct content and source remain. | R1 branching; BUGS #002–#009 |
| AC-03 | Select two sources and synthesize: new linked thread, originals intact, exact snapshots available. | R1 convergence, FR-03 |
| AC-04 | Switch two canvases with different drafts/model/context; no leakage. Open both tabs and reload. | R1 AC09; Notes tab regression lessons |
| AC-05 | Resize a streaming card at 50/100/200% zoom; correct dimensions/edges; one undo step. | R1 AC07, R3 interactions |
| AC-06 | Move/hide sources without changing context manifest; edit source and old answer still resolves its version. | R1 provenance, R2 contracts |
| AC-07 | Search → exact source → reading mode → Canvas preserves identity and navigation. | R1 search/reading, UI-06/09 |
| AC-08 | Provider timeout/cancel preserves partial text and completed tool results; status clears on text arrival. | BUGS #010–#019/#023 |
| AC-09 | Double-send and backend restart/reconnect do not duplicate accepted media jobs; unknown outcomes reconcile. | R1 AC10, R2 recovery |
| AC-10 | Text succeeds, image/video fails: successful output remains; only failed part retries. | R1 AC11 |
| AC-11 | HTML cannot access app storage; external resource behavior follows declared preview policy. | R1 AC13, existing preview boundary |
| AC-12 | Two tabs edit same record: conflict recovered without silent stale overwrite. | R1 AC12 |
| AC-13 | Export/import restores assets, links, sources, layout and versions; quota/storage errors preserve recovery. | R1 durability, §10 |
| AC-14 | All themes, keyboard-only flow, narrow screen/phone keyboard, focus/Escape and reduced motion verified. | R3/R4 accessibility |
| AC-15 | Existing chats/Notes/branches/tools/settings and attachments pass regression and manual smoke checks. | Human AGENTS instructions |
| AC-16 | A non-Canvas test consumer can resolve the same context and output versions without importing React Flow or Canvas components. | Future Agents boundary, §8 |
| AC-17 | Project deletion and Canvas duplication/deletion obey reference/retention rules without inaccessible data. | §5/10 |

Use existing `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm e2e`, relevant pytest suites, and design screenshots. Record actual results and manual checks in project memory. Fake providers must be deterministic and test-only; real-provider checks must separately establish capability, cancellation, fallback and media-job behavior. No tests were run as part of authoring this document.

## 14. Decisions required before the affected packet

| Decision | Proposed default | Gate |
| --- | --- | --- |
| Prototype/app design conflicts | Notlinear tokens/primitives; Ink/spatial reference with documented extensions | P0 |
| Renderer | React Flow if the integration spike passes | P0 |
| Source/part anchor representation | Version + semantic identity + quote/range; media timestamp/region | P1 |
| Storage limits and backup path | Tested per-modality limits; complete export/asset manifest | P1/P4 |
| Artifact compatibility | Additive Canvas origins and media variants with backward-compatible reader/migration | Before shared artifact writes |
| Model capabilities/providers | Existing text adapters; choose media providers from actual capability/cost tests | P3/P4 |
| Job ownership and credentials | Backend durable media owner; explicit local credential lifecycle, no logs/URLs | P4 |
| Preview network access | Constrained policy, scripts off by default | Before HTML release |
| Project deletion recovery | Unassigned listing and explicit move/delete | P2 |

Definition of done: the declared Canvas release scope works in Notlinear, passes recorded regression/recovery checks, reuses the established UI system, and leaves a tested shared-data boundary for the future separate Agents interface. A prototype matching the screenshots alone is insufficient.
