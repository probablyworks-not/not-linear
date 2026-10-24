# Not Linear — Engineering Build Guide

High-level CTO direction · 24 October 2026 · Proposed v1

Companion product PRD: index.html

## CTO direction

Build one persistent workspace engine with two interfaces: Conversations for thinking, Agents for delegated work. Keep the domain model independent of the canvas library, AI provider and workflow framework.

This document gives high-level implementation instructions to coding agents. It accompanies the product PRD (index.html); it contains no application code, database definitions or API payload examples. Recommendations are proposed decisions, not evidence of deployed infrastructure.

Recommended starting architecture
A modular application backend, a transactional database, object storage, background workers, a provider adapter layer and one shared frontend model. Start with a small number of deployable services. Use the existing production stack wherever it already solves the problem.

- Preserve existing prototype behavior and migrate it deliberately into durable services.

- Ship one complete path first: mixed-input question → answer → branch → synthesis → saved output → reopen.

- Define task, actor, run, dependency, permission and artifact identities now so agents can extend this path later.

- Introduce libraries for difficult infrastructure; retain ownership of product semantics, permissions, context and version lineage.

Document: Engineering direction v1 · 24 October 2026 · audience: technical lead and coding agents. Library documentation checked on this date; confirm exact package versions and licenses when dependencies are pinned.

## Start from the actual repository

The available local application is a standalone vanilla JavaScript prototype, not a confirmed React production app. Its README and sampled source show a separation between project model, IndexedDB storage, UI rendering and simulated agent lifecycle. The design files use their own rendering machinery; that is not evidence of the website’s production stack.

 | Available material | Engineering treatment

 | notlinear-canvas/app/model.js and agents-model.js | Use as behavioral references for objects, source snapshots, revision checks, task states, handoffs and alternative outputs. Review rather than transplant the whole model unchanged.

 | notlinear-canvas/app/store.js | Preserve local draft/media recovery and stale-write detection. Add server synchronization through a clear storage boundary.

 | notlinear-canvas/app/app.js, agents.js and styles | Reuse interaction knowledge, responsive layouts and accessible controls. Keep semantic state outside DOM manipulation.

 | notlinear-canvas/tests | Retain useful model and DOM checks. Existing checks are not proof of live AI, provider integration, network recovery or browser rendering.

 | Conversations.dc.html, composer-variants.css and Agents.dc.html | Visual and interaction references for Ink, branching, resizing and future collaboration. Do not use demo model names or artificial progress as real configuration.

 | Production authentication, API, database and deployment | Not established by this review. The first coding task must map these before choosing replacements.

Instruction: produce a short repository map and a gap list before modifying application architecture. Identify the canonical entry point, existing backend boundaries, test commands and deployment owner. Preserve unrelated work and avoid editing the quarantined reference-integration-wip files as if they were active source.

## System boundaries & ownership

Conversations · Agents · Reading viewShared workspace model, drafts, typed renderers, canvas adapter
↓ Commands   ↑ Durable updates
Application backendAuthorization · workspace · context · runs · artifacts · usage
↓ Durable work
Background workers / workflow runtimeProviders · extraction · media · tools · future agent tasks
↕
Database + object storageCanonical records, event history, versions, source assets and outputs

 | Boundary | Owns | Must not own

 | Workspace domain | Canvases, threads, messages, source references, artifacts, actor/task/run identities and allowed transitions. | Provider-specific payloads or a particular canvas engine’s document format.

 | Canvas / reader adapters | Geometry, pan/zoom, selection, resize and accessible projections of the same objects. | The only copy of conversation or agent state.

 | Context service | Authorized source resolution, frozen versions, retrieval, token budget and disclosed context manifest. | Tool permission decisions based on source text or canvas proximity.

 | Run service | Submission, validation, idempotency, usage reservation, state transitions, cancellation and output persistence. | Long jobs that exist only for the lifetime of an HTTP request.

 | Asset / artifact service | Upload completion, extraction, derived media, immutable output versions, access and retention. | Large binaries embedded in ordinary project database rows.

 | Agent orchestration | Task assignment, dependencies, bounded delegation, handoff, approvals and checkpoints. | A second conversation/artifact storage system.

 | Tool execution boundary | Scoped filesystem/browser/terminal capabilities in isolated environments. | Direct access to production credentials or arbitrary host execution.

Start as a modular backend with separately runnable workers. Extract microservices only when ownership, load or isolation justifies them. Keep HTTP commands for mutations and a resumable server-to-client event stream for progress; use polling fallback. Add WebSockets only where genuine two-way real-time collaboration requires them.

## Data contracts to agree before coding

| Concept | Required agreement

 | Canvas / conversation / visual card | Canvas contains semantic objects. A thread orders messages. A card references one of those objects and stores its layout. A task or agent may have multiple visual representations without duplicated content.

 | Actor / task / run | An actor is a human or agent identity. A task is an objective with an assignee and completion criteria. A run is one attempt to execute work; retries create new attempts, not new agent identities.

 | Input and output parts | One message contains ordered typed parts: text, image, audio/transcript, file, video, code, report or HTML. Every part has independent readiness and failure state. Rendering is selected by type, not by parsing arbitrary generated HTML.

 | Source selection | Source ID plus immutable revision and exact selection. Text uses block identity and quote/range anchors; media uses regions/timestamps; code uses revision and line/range. Historical interpretation must survive source edits.

 | Artifact / review | Stable artifact identity, immutable versions and producing run. Acceptance and QA evidence target an exact version. Updated code or report invalidates prior version-specific approval.

 | Relationships | Branch lineage, general reference, task dependency, delegation and handoff are different relationships. Reject cycles in execution dependencies; ordinary reference links may be cyclic.

 | Events / current state | Persist important transitions and current projections together. Events record identity, sequence, actor, attempt and time. Use a pragmatic audit/event log; full event sourcing is not required.

 | Layout / drafts | Save card dimensions and positions separately from content. Drafts are scoped by user, canvas and target thread; viewport and reading position are device-local.

 | Schema evolution | Version durable records and exports. Add migration tests and a compatibility window. Validate imports and reference remapping before accepting data.

Ownership rule: the database is authoritative for accepted runs, approvals and server-saved content. IndexedDB is the durable client draft/cache and pending-edit queue. No provider SDK, CRDT document or graph checkpoint becomes the sole product database.

## Canvas engine decision

Recommendation: keep the current renderer until a focused spike proves that a library meaningfully reduces risk. If the production frontend is React, React Flow is the leading candidate for connected, resizable conversation and agent cards. It provides a documented resize component and supports serializable graph/view state. Its core is MIT-licensed; paid examples and services have separate terms. See xyflow licensing (https://xyflow.com/open-source), NodeResizer (https://reactflow.dev/api-reference/components/node-resizer) and save/restore (https://reactflow.dev/examples/interaction/save-and-restore).

 | Option | Fit | Decision

 | Existing DOM/SVG renderer | Closest to the current vanilla implementation; no framework migration. We own geometry, selection, touch and accessibility maintenance. | Baseline in the spike. Keep it if it meets interaction and performance gates at reasonable maintenance cost.

 | React Flow / xyflow | Custom DOM cards, graph links, resize and minimap align with the feature. Text selection and large streaming cards still need integration work. | Preferred if React is already present or an isolated React canvas boundary is justified. Do not migrate the whole site just to adopt it.

 | Excalidraw | Embedded drawing/whiteboard component; MIT project. Its drawing model is less natural for rich conversation and execution records. | Consider only for a later drawing artifact, not the primary workspace. Official repository (https://github.com/excalidraw/excalidraw).

 | tldraw | Broad infinite-canvas SDK. Source available, but production use requires an appropriate license; it is not a permissive open-source default. | Evaluate only if whiteboarding becomes central and licensing is accepted. Official license terms (https://tldraw.dev/community/license).

Spike gate: compare the existing renderer and the candidate using the same long report, text selection, nested branch, image, video placeholder and streaming card. Verify resizing at several zoom levels, connector re-anchoring, composer placement, keyboard controls and touch. Test 100 mixed nodes / 200 edges at representative desktop/tablet/phone sizes. Record implementation cost, bundle impact and measured latency; do not select by demo appearance.

Keep logical dimensions independent of camera zoom. Reflow text, contain media without distortion, and anchor edges to semantic sources. Make Arrange selection explicit and undoable; moving or resizing never changes AI context. The phone interface should use the shared reader/thread projection, not just reduce canvas scale. React Flow’s own performance guidance (https://reactflow.dev/learn/advanced-use/performance) makes clear that rendering discipline remains application work.

## Open-source shortlist: adopt selectively

| Need | Candidate / source | Engineering direction

 | Rich documents and selection | ProseMirror · official editor-state project (https://github.com/ProseMirror/prosemirror-state) | Evaluate for editable reports, structured blocks and transaction-aware selection. Start the basic composer with the current editor if it meets needs. Product source IDs remain ours.

 | Code viewer/editor | CodeMirror · official project (https://github.com/codemirror/dev) | Use a dedicated editor when editing code becomes real; do not build code editing with contenteditable. Lazy-load inside focused viewers.

 | Local durable cache | Dexie.js · official repository (https://github.com/dexie/Dexie.js) | Optional wrapper over IndexedDB. Existing transactional storage may be sufficient; adopt only if migration and query complexity justify it. Dexie Cloud is a separate service decision.

 | Upload pipeline | Uppy · official documentation (https://uppy.io/docs/) | MIT modular uploader. Use its headless/modular pieces behind Ink UI. Pair resumable uploads with matching server/object-store support; a frontend library alone does not make uploads resumable.

 | PDF preview / text access | PDF.js · official project (https://mozilla.github.io/pdf.js/) | Apache 2.0 PDF parsing/rendering. Retain page anchors; scanned documents require a separate OCR path. Parsing does not automatically provide model-ready evidence.

 | Video/audio processing | FFmpeg · official licensing (https://ffmpeg.org/legal.html) | Worker-side thumbnails, duration and transcoding where needed. Base license is LGPL with optional GPL components; review the exact distributed build. This does not generate AI video.

 | Semantic retrieval | pgvector · official project (https://github.com/pgvector/pgvector) | Optional Postgres extension after ordinary text search and explicit selection. Keep authorization and revision filters authoritative; embeddings are not permission controls.

 | Future human collaboration | Yjs · official documentation (https://docs.yjs.dev/) | CRDT building blocks for shared editing. Defer until concurrent human editing is required. Agent handoffs and immutable artifacts do not require collaborative text CRDTs.

 | Browser verification | Playwright · official documentation (https://playwright.dev/docs/intro) | Real browser scenarios across Chromium/WebKit/Firefox and mobile emulation. Retain fast model/DOM tests; neither replaces the other.

 | Operational visibility | OpenTelemetry · official documentation (https://opentelemetry.io/docs/) | Trace commands, jobs, provider calls and tool actions under stable run IDs. Use existing observability backend where available; avoid logging private content by default.

Dependency rule for coding agents: choose only the packages needed for the assigned slice. Pin versions, retain notices, check maintenance and transitive dependencies, record the decision and own the adapter. A permissive library license does not cover every hosted service, optional extension, model weight or third-party codec.

## Jobs and future agents: choose one durable owner

There are two distinct problems: executing retryable background work and coordinating long-running agent work across handoffs, human input and failures. Do not install multiple frameworks that all believe they own the same run lifecycle.

 | Option | Where it helps | Selection rule

 | Existing queue + application state machine | Best if the production backend already has dependable jobs. Keep run/task state and transitions in the application database. | Reuse first. Validate leases, duplicate delivery, retries, cancellation and restart recovery.

 | BullMQ | Background jobs and dependency flows in a supported backend environment. Work still needs idempotent design. Official guidance (https://docs.bullmq.io/patterns/idempotent-jobs). | Candidate for media/extraction and early AI jobs if it matches the stack. A queue is not the whole PM/coding/QA orchestration system.

 | LangGraph | Agent-oriented state graphs and persisted checkpoints. Distinguishes thread checkpoints from cross-thread stores. Official persistence documentation (https://docs.langchain.com/oss/javascript/langgraph/persistence). | Candidate for future agent coordination if checkpoint/resume and bounded task flows fit. Map it behind application-owned run IDs and keep product artifacts outside graph state.

 | Temporal | Durable workflows with event history, activities and child workflows. Official workflow overview (https://docs.temporal.io/workflow-execution). | Evaluate when multi-day tasks, approvals and external side effects are near-term requirements and operational capacity supports it. More infrastructure than a short generation job.

Default path: use an existing reliable queue if available. Otherwise evaluate a simple worker/queue solution against the current backend. Before production agent execution, run one restart-and-approval spike to choose the durable coordinator. If Temporal is chosen, it owns outer task lifecycle; any inner model planner stays bounded. If LangGraph owns agent flow, checkpoint persistence and tool idempotency still need deliberate design. Do not launch with two competing retry or cancellation authorities.

Spike scenario: a PM creates coding and QA tasks; coding publishes a version; QA blocks on that version; a user decision pauses the flow; the worker restarts; the decision resumes only the affected work; duplicate delivery creates no second external change. Include budget exhaustion, child cancellation and a provider timeout with unknown outcome.

## Persistence, synchronization & recovery

Prefer the current production relational database. If no backend exists, PostgreSQL plus compatible object storage is a sensible proposed baseline: relational records for ownership, tasks and versions; object storage for originals and generated media. No graph database or separate vector database is required for the first release.

- Local editing: write drafts and meaningful edits to IndexedDB promptly. Keep UI state responsive while synchronizing.

- Server acceptance: validate access and expected revision. Commit the mutation and a durable work/event record in the same transaction.

- Dispatch: publish pending work through a transactional outbox or equivalent reliable mechanism so a database commit cannot be stranded between persistence and enqueue.

- Conflict: reject stale writes with recoverable local state. Apply granular mutations to reduce needless conflicts; do not replace whole canvases blindly.

- Progress: events carry run identity and ordered sequence/cursor. Reconnect deduplicates and resumes; if history is unavailable, fetch the canonical current projection.

- Completion: persist output metadata and assets before announcing durable success. Partial output stays marked incomplete until the server confirms completion.

Delivery assumption: background work can be delivered more than once. Use stable submission and operation identities, transactional transitions and provider idempotency where supported. If a request may have succeeded but acknowledgement was lost, reconcile the provider job before retrying. When reconciliation is impossible, expose the unknown outcome rather than promise exactly-once execution.

Store large media separately. Track references from messages, drafts and context snapshots before cleanup. Deletion and retention must cover source bytes, derived transcripts, thumbnails, embeddings and backups according to policy. Browser quota failure preserves recoverable work; refresh is never the only recovery action.

## Multimodal and provider integration

One input model, multiple provider adapters. Keep raw provider request/response shapes behind the backend. Begin with one live provider and one end-to-end path; add a second provider to prove the boundary before building a universal routing system.

 | Path | Instructions to coding agents

 | Capability catalog | Configure models by supported inputs/outputs, tools, context limits and availability. Record actual model and provider per attempt. Validate on the server; UI filtering is only assistance.

 | Mixed input | Preserve typed text, editable voice transcript and image/file parts together. Validate uploads, authorize assets, then freeze the context manifest. Do not silently convert or omit unsupported parts.

 | Voice | Use browser recording for capture with explicit user activation; make transcription a separate recoverable job. Preserve typed text during transcript insertion. Decide raw-audio retention before implementing storage.

 | Asset ingestion | Use signed upload grants and server-side completion validation. Extract/thumbnail in constrained workers, preserve source references, and distinguish stored from processed and model-ready.

 | Context assembly | Resolve exact selected versions first; add declared history/rules/memory within budget. Summaries/retrieval disclose what was included. Never infer scope from what is on screen.

 | Outputs | Persist structured parts and route them to trusted text/code/report/media renderers. Do not request HTML for every answer. Treat HTML as an isolated artifact with source and preview.

 | Image / video | Use asynchronous provider jobs where required. Store provider job IDs, poll or authenticate callbacks, deduplicate completion and move outputs into controlled storage. Each media part can fail/retry independently.

 | Billing / cancellation | Reserve/check budget before expensive work, record usage after reconciliation and enforce parent limits. Stop is best-effort; hiding a card does not cancel. Cancellation cannot reverse completed external actions.

Provider selection remains open: choose live vendors based on capability tests, latency, cost, privacy requirements and reliability. Open-source UI libraries do not supply production image/video generation. Self-hosted models are an optional later evaluation that also requires compute, serving expertise and model-specific license review.

## PM, coding and QA collaboration

Agent collaboration extends the same messages, sources and artifacts. The scheduler reads task dependencies; the canvas displays them. A visual edge must never execute work by itself.

- Assignment: attach a selected branch or artifact version to a task with expected outputs, acceptance criteria and bounded authority.

- Planning: PM proposes tasks and dependencies. Enforce delegation depth, child count, total spend and concurrency on the server.

- Execution: coding agents work in isolated workspaces and produce versioned patches/artifacts. Serialize ownership or use separate branches for concurrent writers.

- Handoff: messages have explicit recipients and intent. Handoff is accepted/rejected/acknowledged against a specific output, not inferred from a chat mention.

- Verification: QA runs checks against the exact revision. Findings include reproduction and evidence. Changes invalidate earlier revision-specific approval.

- Decision: persist approval scope, version and requester; resume only work covered by the answer. Side-branch discussion changes a task only through an explicit Apply instruction action.

- Completion: distinguish run completed, task accepted, artifact integrated and deployed. Keep cancellation and pause semantics consistent across subtrees.

The agent detail tabs—Conversation, Activity, Outputs, Changes and Context—are projections of canonical records. Activity contains useful summaries, tool actions and evidence; it must not rely on private model reasoning. Parent and child runs stay visible after failure, refresh and cancellation.

Trust boundary: tools run outside the application process with scoped filesystem/network access, time/resource limits and no ambient production secrets. Read access to a canvas does not imply terminal, browser, write or publication authority. Imported source instructions cannot expand permissions.

## Frontend performance & responsive engineering

| Concern | Implementation direction

 | Shared state | One domain store or projection layer feeds canvas, reader and agents. Separate transient pointer/camera state from durable content. Avoid global rerenders for each stream token or drag movement.

 | Resize and text selection | Keep selection anchors semantic; screen coordinates are derived. Batch geometry measurement and connector updates. One completed resize is one undo entry. Editor input must not be captured as canvas shortcuts.

 | Large documents / media | Use compact previews, lazy-loaded viewers and bounded rendering. Virtualize carefully: source anchors and keyboard navigation must still resolve when a card is offscreen.

 | Streaming | Coalesce updates for rendering and durable checkpoints; do not store every token as an independent database transaction. Retain enough progress to recover from interruption.

 | Small screens | Desktop uses spatial view; tablet adds explicit touch modes; phone defaults to thread/agent detail. Use the same underlying identities. Keep composer above software keyboard and restore focus on close.

 | Accessibility | Support keyboard equivalents for branch, multi-source selection, resize, source navigation and task controls. Announce real status changes; maintain contrast and reduced-motion behavior.

 | Search | Start with indexed text and metadata; preserve semantic result types and exact source navigation. Add embeddings only when retrieval quality tests show a need.

Proposed performance gate: the PRD’s 100-node / 200-edge scenario with mixed media, a long report and active streaming should maintain usable pan/resize on a representative mid-range laptop, with under 100ms local feedback as an initial target. Measure rather than claim compliance. Test phone at 390px plus tablet and desktop; include browser zoom and on-screen keyboard behavior.

## Implementation packets for coding agents

Each packet should be independently reviewable and end with working behavior, migration/rollback notes and evidence. This is a proposed assignment plan, not a request to launch agents automatically.

 | Packet / dependency | Scope | Done when

 | E0 · Repository audit & decisions | Map production stack and prototype boundaries. Compare canvas options and durable workflow options. Record short architecture decisions. | Canonical app, integration seams, selected dependencies and unresolved decisions are documented.

 | E1 · Domain & contracts · after E0 | Agree shared entities, typed parts, source versions, task/run state and authority boundaries. Add validation and migration fixtures. | Conversation and future agent examples use the same contracts without UI-specific storage assumptions.

 | E2 · Persistence & assets · after E1 | Server ownership/revision checks, local draft queue, object storage, upload lifecycle and outbox. | Refresh, stale tab, offline recovery and imported media references work without data loss.

 | E3 · Canvas / reader / Ink · after E1 | Bind shared records to spatial and reading views; implement source selection, resizing, draft isolation and responsive composer. | Core interactions pass desktop/tablet/phone and keyboard walkthroughs using persisted fixtures.

 | E4 · Live multimodal conversation · after E2/E3 | One real provider; capability checks, context snapshots, streaming, retry, cancel and trusted output renderers. | Mixed input → branch → synthesis → output → reopen succeeds; failure never yields sample output presented as live.

 | E5 · Media & alternate provider · after E4 | Image/video jobs, transcription/extraction, independent part retries and second provider integration. | Completion survives page closure and duplicate callbacks; incompatible model/input is explicit.

 | E6 · Agent runtime · after E1/E2/E4 and coordinator decision | Task assignment, dependencies, checkpoints, addressed handoffs, tools, limits and approvals. | PM → coding → QA survives restart and respects exact-version review and subtree controls.

 | E7 · Release hardening · throughout, final after E5/E6 as scoped | Observability, isolation tests, recovery drills, accessibility, cost limits and staged rollout. | Release scope passes documented gates; unsupported modalities/features are truthfully gated.

Critical path: E0 → E1 → E2 → E4. E3 can progress once contracts are stable; media and agent runtime build on the same foundation. Assign owners for shared contracts and schema changes so multiple coding agents do not independently redefine them.

Every coding-agent instruction must include: objective, relevant PRD requirement, allowed modules, upstream contract versions, explicit exclusions, failure cases, verification, and required handoff artifacts. Agents should surface contract changes before implementation, preserve unrelated edits and report actual test evidence. New dependencies require a written reason; visual prototypes alone are not completion evidence.

## Verification, operations & rollout

| Gate | Evidence required

 | Domain correctness | Branches preserve exact source versions; synthesis keeps originals; layout never changes context; task dependency cycles rejected.

 | Durability | Crash after database commit/before enqueue, restart during provider request, reconnect and duplicate send/callback all recover without duplicate accepted work.

 | Isolation | Cross-user/canvas access denied on server, private asset URLs scoped, HTML preview sandboxed, tool process isolated and stale approvals rejected.

 | Media reliability | One failed attachment/output does not erase successful parts. Unknown provider outcome reconciles rather than blindly restarting paid work.

 | Agent lifecycle | Pause/stop children, bound delegation, wait for input, persist approvals and resume exact attempts. QA evidence matches the reviewed revision.

 | User experience | Real browser screenshots/traces for zero state, mixed input, branch, resize, phone composer, artifact viewer, failure and reopening.

 | Operational readiness | Trace run/task/attempt IDs across backend and workers; monitor queue age, save failures, provider latency, orphan jobs, spend and cancellation failures.

 | Release & rollback | Feature flags gate live providers/media/tools separately. Old clients remain compatible during deployment. Rollback disables new execution while preserving readable work and existing assets.

Maintain deterministic fake providers for tests and explicit demo mode; keep them separate from production behavior. Run a small controlled set of live-provider checks in staging. Add a representative context-quality set to detect wrong-source answers, omitted selected evidence and unsupported modality conversions.

Use structured traces with identifiers and redacted metadata. Do not log full prompts, transcripts, source files or credentials by default. Set storage/backup/retention policy and alerts before exposing long-running agents.

## Decisions the technical lead must close

| Decision | Recommended direction | Evidence needed

 | Production stack | Integrate with existing website/backend; no framework rewrite by default. | Repository and deployment audit.

 | Canvas engine | Existing renderer baseline; React Flow if the integration spike wins. | Text-selection, resize, performance, touch and maintenance comparison.

 | Durable execution | One owner for run/task lifecycle; reuse existing jobs first. | Restart, approval and unknown-side-effect spike.

 | Data & assets | Existing transactional DB and object store; Postgres as new-backend baseline. | Tenant model, backup/recovery and asset limits.

 | Providers & billing | Capability-driven adapters and explicit usage limits. | Real compatibility tests and per-modality cost/latency measurements.

 | Execution environment | Isolated per-task workspaces with bounded grants. | File/network isolation, cancellation and concurrent-write tests.

 | Collaboration timing | Versioned records first; CRDTs only when human concurrent editing is in scope. | Actual multiplayer requirements and conflict examples.

First instruction to the implementation lead
Complete E0 and publish the architecture decisions. Then implement E1–E4 as one durable vertical slice before widening provider or tool coverage. Preserve the future agent contracts during every schema decision. Return a working walkthrough plus recovery evidence, not just matching screens.

Reference sources are linked beside the relevant decisions. Local references: the product PRD, Conversations and Agents design files, and the notlinear-canvas app README/model/storage/agent modules. This document assesses available local prototypes; it does not certify the production website’s infrastructure.
