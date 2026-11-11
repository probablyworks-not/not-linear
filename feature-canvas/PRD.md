# Not Linear — Product Requirements Document

Version 2 · 24 October 2026

Agent-readable companion to [the visual PRD](index.html). Implementation guidance is in [engineering.md](engineering.md). Requirements and proposed targets are recommendations; observed screenshots and future behavior are labeled in the document.

## The product we are building

A persistent, multimodal thinking canvas where people can explore a question, branch from any meaningful part, and bring useful paths back together into an output.

Use the **Ink composer** as the interaction reference. Inputs can combine text, voice, images and files. Responses can contain text, images, video, code, reports or HTML. The form should follow the task; HTML is an optional artifact, not a requirement for every reply.

**Recommended core loop**

Capture → ask → inspect → branch → compare / synthesize → save an output → return and revise.

### Primary users

PMs and founders exploring decisions; designers comparing visual directions; researchers synthesizing evidence; developers moving between explanations and code. These are target hypotheses, not validated research findings.

### Job to be done

“Let me pursue a tangent or combine ideas without losing the original context, then turn the useful work into something I can use.”

### Product boundary

A conversation workspace with spatial organization and reusable outputs. This canvas is the shared foundation for future collaboration with PM, coding, QA and other agents. Agent execution can ship later; its identities, context, runs and outputs must fit the foundation now. Full whiteboarding and multiplayer editing remain separate investments.

**Status:** proposed PRD v2 · 24 October 2026. Requirements and numerical targets below are recommendations for review, not claims of existing capability or delivery commitments.

## Reference & observed gaps

Reviewed the requested combined ThinkingCanvas page and the active Conversations prototype. The combined file does not load the composer-variation stylesheet. The implemented Ink reference is [Conversations · Ink](http://127.0.0.1:8937/templates/thinking-canvas/Conversations.dc.html?composer=ink). Browser screenshots in this report come from that page.

The large “Flow Sketch” report inside the canvas is example conversation content. Its library choices, timeline, model names and claims are not requirements or verified product facts. The local implementation notes explicitly identify this as a session-only design prototype with sample replies and image layouts.

| Observed in prototype | What needs to be built / resolved |
| --- | --- |
| Ink composer, settings, voice affordance and source chips | A multiline, draft-safe composer with mixed inputs, visible scope and capability-aware model selection. |
| Selecting a source opens an anchored composer; Shift-click adds another source | Keyboard/touch alternatives, stable selection anchors, explicit distinction between continuing and branching. |
| Draft carried from the new canvas into Flow Sketch during the walkthrough | Store drafts per canvas and per conversation target. Switching projects must never carry private context or text implicitly. |
| Add menu mixes image attachment, notes, links, files and agents | Separate “Attach to message” from “Create on canvas”; retain shortcuts as accelerators. |
| Whole canvas label and contextual islands | Show actual context, ready vs unprocessed files, summarization and omitted content. Canvas visibility must not imply model access. |
| Search returned two AI matches for “decision”; context islands also appeared as AI in recent results | Index semantic entities and excerpts, not concatenated UI text; label result types correctly. |
| Long reports, branches, reading mode and minimap | Resizable cards, accessible reading, collision handling, small-screen layouts and durable view state. |
| Images / voice in sample cards; fallback reply templates | Real provider jobs, upload/transcription pipelines, honest errors, resumable generation, typed outputs and durable storage. |
| Model list contains illustrative names and descriptions | Use a server-managed capability catalog. Do not ship the demo names, retirement dates or “best” claims as authoritative. |
| Agents are separated in DESIGN-FILES.md | Two interfaces over the same workspace model. Build shared actor, task, run, dependency and artifact contracts now; add the agent runtime and interface in the next release. |

## Prototype state walkthrough

Twelve screenshots captured by driving the prototype in a separate browser tab. Click any image to enlarge. No live AI generation, microphone recording or uploads were used to manufacture these states.

![01 · Empty canvas — Not Linear Ink prototype](/Users/yash/Documents/ChatGPT/Random/notlinear-prd/assets/05-zero-state.jpg)

Observed

### 01 · Empty canvas

The current empty state offers a hint and collapsed Ask launcher. Proposed: open composer, three clear starting actions and optional examples. Hide inactive canvas controls until content exists.

![02 · First message draft — Not Linear Ink prototype](/Users/yash/Documents/ChatGPT/Random/notlinear-prd/assets/06-first-draft.jpg)

Observed

### 02 · First message draft

Typing reveals Send. Proposed: multiline input, attachment tray, per-canvas draft restoration and accessible labels.

![03 · Add menu — Not Linear Ink prototype](/Users/yash/Documents/ChatGPT/Random/notlinear-prd/assets/07-add-menu.jpg)

Observed

### 03 · Add menu

Captures the current mixed menu. Proposed: separate attaching material to a message from creating a standalone note or canvas item.

![04 · Ink composer — Not Linear Ink prototype](/Users/yash/Documents/ChatGPT/Random/notlinear-prd/assets/01-ink-composer.jpg)

Observed

### 04 · Ink composer

Compact composer over a populated canvas. Proposed: preserve its visual economy while exposing context and active model without relying on hover.

![05 · Model selection — Not Linear Ink prototype](/Users/yash/Documents/ChatGPT/Random/notlinear-prd/assets/02-model-picker.jpg)

Observed

### 05 · Model selection

Actual prototype picker. Model labels are demo content. Proposed: capability, availability and estimated cost/latency information driven by configuration.

![06 · Branch source selected — Not Linear Ink prototype](/Users/yash/Documents/ChatGPT/Random/notlinear-prd/assets/09-branch-context.jpg)

Observed

### 06 · Branch source selected

The source is highlighted and represented in the composer. Proposed: source version, exact excerpt and a reliable return-to-source action.

![07 · Multiple sources — Not Linear Ink prototype](/Users/yash/Documents/ChatGPT/Random/notlinear-prd/assets/10-multiple-sources.jpg)

Observed

### 07 · Multiple sources

Two selected sources become removable chips. Proposed: a new synthesis thread with links to both originals; no destructive merging.

![08 · Project context — Not Linear Ink prototype](/Users/yash/Documents/ChatGPT/Random/notlinear-prd/assets/03-context-islands.jpg)

Observed

### 08 · Project context

Memory, guiding rules, files and outputs occupy spatial islands. Proposed: equivalent accessible panel/list and clear inclusion rules.

![09 · Reading mode — Not Linear Ink prototype](/Users/yash/Documents/ChatGPT/Random/notlinear-prd/assets/04-reading.jpg)

Observed

### 09 · Reading mode

Linear reading exists alongside the canvas. Proposed: semantic thread ordering and consistent branching actions, including on phones.

![10 · Search — Not Linear Ink prototype](/Users/yash/Documents/ChatGPT/Random/notlinear-prd/assets/08-search.jpg)

Observed

### 10 · Search

Captured query and results. Proposed: result type, excerpt and exact source location; no-results and indexing states.

![11 · Future Agents canvas — Not Linear Ink prototype](/Users/yash/Documents/ChatGPT/Random/notlinear-prd/assets/11-agents-overview.jpg)

Observed prototype

### 11 · Future Agents canvas

PM, engineering, QA and specialist agents share a dependency graph. These are demo statuses, not verified execution.

![12 · Agent conversation — Not Linear Ink prototype](/Users/yash/Documents/ChatGPT/Random/notlinear-prd/assets/12-agent-collaboration.jpg)

Observed prototype

### 12 · Agent conversation

Engineering detail shows addressed PM/QA/browser handoffs, source branches, and Conversation, Activity, Outputs, Changes and Context tabs. Build these on the same underlying objects as Conversations.

## Zero states & first-use experience

| State | Required behavior | Exit / acceptance |
| --- | --- | --- |
| First visit: no canvases | Lead with “What are you thinking about?” and an expanded Ink composer. Actions: type, speak, attach. Optional examples fill a draft; they never auto-send. Account/project setup must not block exploration unnecessarily. | First send creates one canvas and one root conversation. A locally saved draft survives refresh. |
| New canvas in an existing project | Show project name, inherited rules and context indicator. Offer blank start, add existing chat, or add material. Do not copy the previous canvas draft or selection. | No unrelated context included. Title generated after first successful turn remains editable. |
| Material added without a question | Show preview and processing status, then “What would you like to do with this?” Offer summarize, analyze or compare as draft prompts. | Attachment-only send is allowed when intent is inferable; ask one short question when it is not. |
| Voice-first | Request microphone access on explicit activation; display recording state, timer, Stop and Cancel. Show editable transcript before Send. | Permission denied, no speech and transcription failure have text/attachment fallbacks. Never auto-send on recording stop. |
| Returning canvas | Restore saved content, dimensions, viewport and per-thread draft. Show running or completed jobs without forcing camera movement. | User can resume the same branch and return to the last reading position. |
| Nothing in memory/files/outputs | Explain each area with one sentence and one action. Keep empty islands collapsed or reachable via Context. | No empty islands crowding the first question. |
| Search has no results | Show query, scope and Clear filters. Offer an explicit Ask action rather than turning a search into a paid request. | Existing draft is preserved. |
| Offline / session expired | Allow local drafts and local edits where safe; clearly label unsynced work. Offer reconnect/sign-in without resetting the canvas. | No generation claim while disconnected. No silent data loss. |

## Use cases & end-to-end flows

| Use case | Input → action → result | After the result |
| --- | --- | --- |
| Explore a product decision | Text brief → short answer → branch from an assumption → investigate alternatives. | Compare branches, record a decision and generate a linked report. |
| Critique a design | Screenshot + typed question + spoken explanation → annotated critique and optional revised image. | Branch from an image or region; preserve original and generated versions. |
| Research synthesis | Notes + PDFs + question → cited findings. | Select findings across branches; synthesize contradictions and open questions into a report. |
| Debug or implement | Code file + error screenshot + voice explanation → diagnosis and code artifact. | Branch from selected lines; revise a version; copy/download. Running code is a separate controlled action. |
| Create content | Brief + reference image → outline, image, script or HTML preview. | Iterate on the chosen artifact, retain alternatives and export the chosen version. |
| Create video | Text + reference image + optional audio → plan/settings → queued video generation. | Inspect playable output, branch from a timestamp, revise prompt and create a new version. Show cost before starting. |
| Learn a concept | Text or voice question → explanation + diagram when useful. | Branch from an unclear phrase, then return to the source and continue. |
| Think without AI | Create a note or attach a link → organize manually. | Select it later as context. Creating a note incurs no AI request. |
| Compare models | Same frozen prompt/context → explicit “Try another model” → sibling result. | Compare outputs with model labels; select a preferred answer without erasing the others. |
| Resume later | Open saved canvas or deep link → exact thread/artifact version. | Continue with original context or explicitly refresh changed sources. |

### Canonical interaction paths

- **First answer:** open → compose mixed input → inspect model/output/scope → send once → generation state → typed response → continue or branch.
- **Branch:** select text/card/media → Branch → inspect excerpt chip → ask → new linked thread. Further replies continue that thread until the user explicitly branches again.
- **Synthesize:** select two or more sources → Compare or Synthesize → review scope → new thread linked to every source → save the useful output.
- **Revise output:** open artifact → select portion or attach whole artifact → request change → new version → compare → mark preferred → export.

## Multimodal input contract

| Input | Required interactions | Edge cases / model handling |
| --- | --- | --- |
| Text | Multiline editor; Enter sends, Shift+Enter adds newline, configurable alternative. Paste preserves code and paragraphs. IME composition never submits. | Whitespace alone cannot send; attachment-only and voice-only are valid. Long prompts remain editable. |
| Voice | Record, stop, cancel, replay if audio retained; editable transcript; append/insert transcript without replacing typed text. | Permission denied, unsupported browser, interrupted recording, silence and poor transcription. State whether raw audio or transcript reaches the selected model. |
| Images | Paste, file picker and drag/drop; multiple thumbnails; preview, replace, remove and optional region selection. | Upload progress, unsupported format, size limit, corrupt file, model without vision. Never discard an image silently. |
| Documents / code | Filename, type, size, processing status and preview. PDFs retain page references; code retains language and line references. | Encrypted/scanned/empty files; extraction failed; unsupported type. A stored filename is not evidence that AI read the file. |
| Video / audio files | Media metadata, playback and explicit selection of clip or time range. Add transcript where available. | Large-file limits, codecs and duration constraints must be shown before upload. Native media understanding vs sampled frames/transcript must be disclosed. |
| Combination | One message can hold ordered text blocks, edited voice transcript, images and files. Each attachment has independent readiness. | If one item fails, offer retry/remove or explicit send without it. Preserve all successful items and draft text. |

**Scope of attachment:** default to this message/branch. “Add to canvas context” is a separate explicit action. Removing an unsent attachment removes it from the draft; removing a saved source has its own impact preview. Limits are configurable and displayed at selection time; engineering must set tested limits before beta.

## Output types, rendering & model choice

**Output selector:** Auto, Text, Image, Video, Code, Report, HTML, with optional Audio later. Auto chooses the simplest useful format; mixed output parts are allowed. Selecting Report overrides any “short replies” style preference. Expensive image/video work requires visible generation settings and cost disclosure before submission.

| Output | Viewer & actions | Required safeguards / behavior |
| --- | --- | --- |
| Text | Readable Markdown, lists, tables, math and citations; copy, select, branch. | No mandatory HTML artifact or fixed 80-word ceiling. Stream readable partial text. |
| Image | Thumbnail → full viewer; alt text, download, use as reference, branch from whole image/region. | Dimensions/aspect ratio settings where supported. Preserve source image and generation lineage. |
| Video | Poster frame, play/pause/seek, duration, captions where supported, download and timestamp branch. | Queued/running/encoding states; no fake percentage. Reload resumes job tracking. Failed encoding is recoverable separately from generation. |
| Code | Syntax-highlighted source, filename/language, copy/download and revision diff. | Display never executes code. Execution, if added, needs an isolated runtime and separate permission boundary. |
| Report | Structured document with headings, citations, table of contents and full reading view. | Editable derived draft preserves original AI output. Export Markdown/HTML initially; additional formats can follow. |
| HTML | Isolated rendered preview plus source tab and download. | Never inject generated HTML into the app DOM. Sandbox scripts/network/storage; interactive execution is opt-in in an isolated environment. |
| Mixed output | A turn can include explanatory text + image + code/report attachments. | Track each part independently. A failed image must not erase a completed explanation; retry only the failed part. |

### Capability-aware model selection

Separate **model** (provider capability), **mode** (PM, research, coding or custom instructions) and **output type**. Model selection applies to the next run; each response records the model actually used. Mode changes do not silently change provider or permissions.

- Catalog defines accepted input types, generated output types, context limits, enabled tools, availability and billing class. Names in screenshots are illustrative only.
- When inputs/output conflict with a model, explain the incompatibility and offer a compatible model, an explicit conversion (e.g. transcript), or removal. Do not drop input silently.
- Auto routing may use a specialist image/video model; show that routing before costly work and record actual providers afterward. Manual model choices are not silently substituted.
- Persist user defaults, show per-run overrides, preserve draft on switches, and disable unsupported extended-thinking settings.
- Unavailable model, quota exhaustion, rate limit and provider outage offer retry or explicit alternative. No automatic paid fan-out to multiple models.

## What AI sees: context & provenance

A canvas is an organization boundary, not an instruction to send everything. Camera position, hidden cards, proximity and card size never change AI context.

| Scope | Default contents | Excluded unless explicitly added |
| --- | --- | --- |
| New root conversation | Current message and attachments; enabled canvas rules and approved memory. | Other conversations and unrelated files. |
| Continue thread | Current message, thread history and pinned thread sources; enabled canvas rules/memory. | Sibling branches and future edits to frozen source versions. |
| Branch from selection | Exact selection snapshot with source identity/version, plus clearly disclosed parent context. Default: selection-focused, with Include parent thread available. | Whole report/file when only an excerpt is selected; unrelated ancestors. |
| Multiple sources | Selected snapshots in visible order, with labels and version IDs. | Unselected sibling content. |
| Whole canvas / canvas context | Relevant retrieval from accessible canvas material, with a manifest of included excerpts/summaries. | Other canvases; unprocessed files; content exceeding model budget without disclosure. |

- The composer exposes “What AI can see”: current prompt, sources, history scope, rules, memory and processing warnings. If retrieval is used, label it “Relevant canvas context” rather than implying every byte was sent.
- Freeze a context manifest when sending. Record selected ranges, source versions, model, mode and output preference. Long context is summarized with disclosure or requires narrowing; never silently clip the selected evidence.
- Use stable node/block IDs and text quote anchors. Media selections use asset/version ID plus region or timestamp; code uses version and line/range anchors.
- Source edits mark downstream results “Source changed”; they do not rewrite old answers. Offer refresh into a new version.
- Deleted sources leave a tombstone and historical provenance where retention policy permits. A privacy purge removes retained content too; “Forget memory” only prevents future memory use and must explain that distinction.
- Memory is user-approved by default. Auto-memory is optional and off initially. Users can inspect, edit and forget it. Rules apply prospectively and cannot grant tools or account permissions.

## After branching: convergence & lifecycle

| Action | Product behavior | Acceptance rule |
| --- | --- | --- |
| Continue | Reply within the selected branch with local history. Use an inline Reply action or explicit active-thread target. | A normal follow-up does not create a new canvas branch every time. |
| Branch again | Fork from text, a block, image, timestamp, code range or entire card. | New child has visible parent/excerpt and return-to-source navigation. |
| Compare | Select branches or alternate model responses; ask for comparison. | Originals remain intact; comparison cites each input. |
| Synthesize | Combine selected findings into a new result with multiple source edges. | No overwrite or destructive merge. Cycles in ancestry are rejected; general references can be separate edge types. |
| Bring back to main | Insert a selected summary/reference into the main thread after preview. | Does not silently add the full branch history to the main conversation. |
| Promote | Mark a branch as the preferred/main exploration path. | Preserves node IDs, original lineage and existing links. Undo restores prior main path. |
| Save output / decision | Save report, code, image or conclusion into Outputs with a name, version and sources. | One artifact identity with version history; avoid duplicate copies for every view. |
| Collapse / focus / organize | Collapse to title + summary + branch count; focus dims unrelated material. Move, resize, rename, pin and archive. | These are presentation changes only; they do not alter model context. |
| Regenerate / edit prompt | Create an alternate response/run or new prompt revision; descendants stay attached to their historical version. | Never silently replace the premise of existing branches. |
| Delete / restore | Soft-delete selected node; show impact on children and sources. Default preserves child threads with missing-source marker. | Undo restores content, edges and layout. Deleting an entire subtree is a separate, explicit action. |

**Recommended post-response actions:** Reply, Branch, Compare/Synthesize when multi-selected, Save output, Remember, Copy, More. Keep advanced lifecycle controls in More. Avoid turning every card into a toolbar.

## Resizable branches & responsive canvas

**Every branch card must be resizable**, including text, code, reports and media. A branch is a conversation with a resizable canvas representation, not a screenshot with fixed dimensions. The following dimensions are starting specifications to validate, not constraints inherited from the prototype.

| Area | Required behavior |
| --- | --- |
| Resize affordance | Show corner/edge handles on hover, selection and keyboard focus; visible Resize action for touch. Provide keyboard size presets and editable width/height in a menu. |
| Sizing contract | Start chat branches at ~360px wide; minimum 280px, normal maximum 960px in canvas units. Reports/code can open wider or in a full viewer. Minimum height 160px; automatic content height by default, manual height enables an internal scroll region. |
| Reflow | Text wraps as width changes; code/tables preserve structure with internal horizontal scroll. Images/video preserve intrinsic aspect ratio, using contain rather than destructive crop. No stretched media or clipped action buttons. |
| Canvas coordinates | Persist logical width/height independent of zoom. A 360-unit card remains 360 units at every zoom. Resize handles maintain a usable screen-space hit area. |
| Connectors | Recompute connector endpoints during drag/resize and after content reflow. Anchor to the source selection/block when available; use card-level fallback when collapsed. No lines attached to stale pixel positions. |
| Placement / collisions | Keep existing cards stationary during user resize. Allow intentional overlap with bring-to-front. Newly generated cards use nearby free space and avoid current composer; offer undoable Arrange selection to clean up. |
| Streaming growth | Grow until a reasonable display height, then scroll within the card. Do not keep pushing the canvas or jumping the camera while the user reads elsewhere. Show “New response” navigation. |
| Undo & persistence | One completed resize gesture equals one undo operation. Save size, position, collapsed state and preferred view. Reload and cross-device open restore card dimensions; viewport is device-local. |
| Gesture separation | Drag card header to move; drag blank canvas or Space+drag to pan; select text within content. Resize handles must not trigger pan, selection, sending or page scrolling. |
| Composer placement | Anchor near selection where space permits; otherwise dock to available viewport edge. Recalculate for sidebars, keyboard, zoom and window resizing. Never cover the active selection or leave Send offscreen. |

| Viewport proposal | Canvas behavior | Composer & reading |
| --- | --- | --- |
| Desktop ≥1100px | Full spatial canvas, collapsible sidebar, minimap, multi-select, card resizing and side-by-side comparisons. | Anchored Ink composer with expandable multiline input; full artifact viewer. |
| Tablet 700–1099px | Sidebar becomes overlay; compact controls; touch pan/pinch, explicit selection mode and resize action. | Dock composer when anchoring would obscure content; reading view always reachable. |
| Phone <700px | Default to linear thread view with branch breadcrumbs and source links. Optional canvas overview for navigation. No forced tiny-text zoom. | Full-width bottom composer above keyboard; attachment tray scrolls; open branches/artifacts in a sheet/fullscreen viewer. Spatial resizing available through size presets, preserving desktop dimensions. |

**Accessibility:** all essential actions work without dragging or hover. Focus order follows the selected thread; screen readers announce ancestry, source count and generation status. Color is not the only source identifier. Support 200% browser zoom, reduced motion and readable text contrast. Adopt 44px touch targets as a design target. Reading mode is a first-class authoring route, not just an export.

**Performance targets to validate:** test 100 mixed nodes / 200 edges on a representative mid-range laptop, 20 visible media cards, a long report and a deep branch. Target ≥50fps during pan/resize and under 100ms local interaction feedback; use media thumbnails and viewport virtualization as needed. Do not choose a library from the sample report without a production-stack assessment.

## State machine & recovery

| Entity / state | What the person sees | Allowed transition |
| --- | --- | --- |
| Draft: empty → editing → ready | Ink input, source chips and independent attachment status. Voice shown when empty; Send appears for valid content. | Send only after required input is ready; draft autosaves locally. |
| Voice: requesting → recording → transcribing → review | Permission explanation, timer, stop/cancel, then transcript. | Cancel discards recording; retry transcription retains recoverable recording where allowed. |
| Asset: selected → uploading → processing → ready / failed | Per-file progress and retry/remove. | Failure of one asset does not clear the others. |
| Run: validating → queued → generating → completed | Actual phase, elapsed time and Stop. Percent only if measurable. | Stream text; persist job ID before navigating away. |
| Run: cancelled / failed / interrupted | Partial output labeled incomplete; reason and next action. | Retry with same context snapshot, or edit/resubmit as a new run. Never substitute demo output. |
| Mixed run: partially complete | Completed text stays usable; failed media part shows its own error. | Retry failed part without duplicating successful parts or charges. |
| Save: local → syncing → synced / error / conflict | Quiet status with explicit unsynced/error state. | Retry; restore local draft; choose conflict version. Server acknowledgement is required for “Saved”. |
| Source: current → changed / missing | Source badge and original version reference. | Refresh context explicitly; preserve historical result. |
| View: loading / empty / loaded / unavailable | Skeleton, zero state, content, or access/deleted state respectively. | Retry/navigation never masquerades as an empty canvas. |

**Recovery principles**

Submitting is idempotent. Double-click and reconnect produce one run, not duplicate charges. On browser refresh, query the existing job rather than restart it. Cancelling is best-effort, acknowledges the provider state, and explains already-incurred usage. Closing a card never cancels or deletes its run implicitly.

## Proposed states: interactive specification

These are purpose-built product sketches, **not screenshots of implemented functionality**. Choose a state to inspect the missing behavior.

### Empty — proposed

- Context/status: No inherited context
- Primary content: Start with a thought.
- Inputs/parts: Type, record or attach material.
- Controls: ＋ Attach   ◉ Speak

Open the composer immediately. Hide inactive Fit/Latest/Focus controls. A first send creates the root thread. Optional examples fill drafts only.

### Mixed draft — proposed

- Context/status: 2 inputs · This message
- Primary content: Help improve this onboarding flow.
- Inputs/parts: Screenshot.png · Ready; Voice transcript · Reviewed
- Controls: Model: compatible   ↑ Send

Keep typed text, edited transcript and image together. Each part is removable; model compatibility is checked before sending.

### Uploading — proposed

- Context/status: Waiting for 1 input
- Primary content: Help improve this onboarding flow.
- Inputs/parts: Screenshot.png · Uploading; Notes.pdf · Ready
- Controls: Cancel upload   Send unavailable

Show real per-file progress. If upload fails, retain the draft and other files. User can explicitly remove failed input and continue.

### Voice review — proposed

- Context/status: Recording stopped
- Primary content: “Compare these two approaches…”
- Inputs/parts: Transcript · Edit before sending
- Controls: Re-record   ↑ Send

Stopping recording does not submit. Editing transcript preserves other input. Explain whether raw audio is retained or sent.

### Generating — proposed

- Context/status: Run saved · Can leave canvas
- Primary content: Creating the comparison
- Inputs/parts: Text · Streaming; Image · Queued
- Controls: Stop   View context

Keep completed parts visible. Store job identity, allow navigation, and avoid forcing camera focus while user is reading elsewhere.

### Partial failure — proposed

- Context/status: Provider error · No duplicate text run
- Primary content: Comparison ready. Image failed.
- Inputs/parts: Text · Complete; Image · Retry available
- Controls: Retry image   Keep text

Retry only the failed part using the same source snapshot. Explain any additional cost; preserve completed work.

### Synthesis — proposed

- Context/status: 2 sources · New synthesis thread
- Primary content: Combine these into a recommendation.
- Inputs/parts: Branch A · v2; Branch B · v1
- Controls: Output: Report   ↑ Send

Create a new linked result; preserve both originals. Show contradictions and citations. Save a decision or return summary to the main thread.

### Resize — proposed

- Context/status: Resizable · Persistent geometry
- Primary content: A branch that fits your work.
- Inputs/parts: Width 520 · Height auto; Layout only · Context unchanged
- Controls: Size presets   Undo resize

Reflow text and update connectors in real time. Preserve media aspect ratio. On phone use a full-width thread view and saved desktop size presets.

## Build scope & release sequence

| Priority / release | Deliverable | Release condition |
| --- | --- | --- |
| P0 · Foundation | Stable canvas/thread/message and actor IDs; typed multimodal parts; source/version graph; draft and server persistence; run/job state; ownership checks; task, delegation, dependency, approval and event contracts. | Reload, retry and two-tab conflict tests pass with no lost acknowledged edits. |
| P0 · Core beta | Ink composer; text + voice transcript + images/files combined; capability-aware model choice; text/code/report/isolated HTML outputs; branching, continuation, multi-source synthesis; resizing, reading/search; export Markdown/HTML. | People can complete capture → branch → synthesize → save → reopen without coaching. |
| P1 · Multimodal completion | Real generated images and video; media viewers; per-part retries; image-region and timestamp branching; cost controls. | Provider/job reliability, supported limits and costs verified. Video remains a committed product requirement, not a silent omission. |
| P1 · Agent collaboration | Agent templates and task assignment; addressed messages; PM decomposition, coding execution in isolated workspaces, QA evidence; dependencies, approvals and subtree controls. | Runs reuse existing branches/context/artifacts. Permissions, cancellation, replay and handoff tests pass before tools execute. |
| P1 · Organization | Preferred path/promote, saved decisions, richer artifact revisions/diffs, import existing chats, advanced memory and organization. | Preserves source identity and revision lineage across all operations. |
| P2 · Expansion | Shared canvases, human multiplayer editing, deployment and advanced exports. Agent execution has its own next-phase track below. | Separate PRDs and demand evidence. Do not expose nonfunctional controls in core beta. |

**Scope decision:** architecture supports every requested modality from day one; provider capabilities can roll out in gated phases. If launch must include video generation, P1 multimodal completion becomes a launch dependency. Do not advertise complete multimodal support before it works.

**Workstreams:** product/design owns context semantics, zero states and responsive interaction; frontend owns canvas/editor/viewers; backend owns durable graph and assets; AI platform owns capabilities, orchestration and usage; QA owns recovery, accessibility and modality coverage. Estimate after a technical spike against the actual app; the demo’s “six weeks” is not an estimate for this scope.

## Foundation for multi-agent collaboration

Conversations and Agents are two views of the same persistent workspace. A person can think in a branch today and assign that branch to a PM, coding or QA agent later without copying it into a separate system.

Reference: [Agents design](http://127.0.0.1:8937/templates/thinking-canvas/Agents.dc.html) and its agent-workspace detail view. Observed controls include direct/all-agent addressing, Ask versus Give instruction versus Send to another agent, side branches, activity, outputs, changes, context, Pause subtree, Stop subtree and Try an alternative. These are design affordances; production orchestration is not verified.

**Architecture decision — required now**

Do not equate a card with an agent or a branch with an executable job. Cards are views; threads hold conversations; tasks define work; agents are actors; runs are execution attempts. One task can have several attempts, and one agent can work on multiple tasks.

| Shared primitive | Build into the foundation now | Unlocks later |
| --- | --- | --- |
| Actor & agent definition | Every message/output records its author type and ID. Separate human, assistant and agent actors; agent definitions have versioned role, instructions and default model. | PM, coding and QA identities with attribution across handoffs. |
| Task & assignment | Stable task identity; objective, assignee, source branch, input versions, expected outputs and completion criteria. Keep task status separate from run status. | Assign existing thinking to an agent without duplicating the conversation. |
| Run & attempt | Run ID, task ID, attempt, parent run, context manifest, model, permission snapshot, budget and event history. | Restart, alternate models, parallel agents and resumable long-running work. |
| Typed relationships | Keep branched-from, references, assigned-to, spawned-by, depends-on, handed-off-to and produced-by distinct. | Visual hierarchy does not accidentally become execution order. Dependency cycles can be rejected independently of harmless reference links. |
| Addressed messages | Record sender, explicit recipients, intent, task/run association, timestamp and delivery/acknowledgement state. | Human–agent and agent–agent coordination; Ask can stay informational while Give instruction changes work. |
| Versioned outputs | Artifact ID/version, producing run, inputs and review status; code changes reference workspace and revision. | QA tests an exact implementation; PM approves an exact spec; revisions invalidate stale sign-off. |
| Permissions & approvals | Context access and tool authority are separate. Store bounded grants and actionable approval requests with exact scope/version. | Reading a conversation does not grant file writes, execution, publication or delegation. |
| Events & view state | Append durable run/task events and build projections for the canvas, activity and status views. Persist geometry separately. | Updates survive refresh and can drive either Conversations or Agents without DOM inspection. |

### Future flow: brief → PM → coding → QA → user

- **Delegate from a branch.** User selects a brief, chooses an agent/template, sets objective, context, allowed tools, budget and expected output. Review the assignment before starting; role presets alone never grant permissions.
- **PM decomposes the work.** Produce a versioned spec and explicit task graph. Delegation follows the user's configured policy, with bounded child count/depth, duration and spend. The user can inspect and edit the plan.
- **Agents collaborate.** Coding and design can work independently where dependencies permit. Messages target named agents/tasks. Broadcast is explicit and its recipient list is visible; it must not spawn duplicate work automatically.
- **Handoff exact outputs.** Coding publishes an implementation revision plus test/build evidence. QA receives that revision and acceptance criteria. Handoff has sent/accepted/rejected states and an owner; a chat mention alone is not a completed handoff.
- **QA reports evidence.** Findings link to exact code/artifact versions, reproduction steps and test evidence. A failure reopens the relevant task or creates a fix task. Coding revision triggers re-verification; old passing results do not certify new changes.
- **Resolve decisions.** “Needs you” shows the decision, alternatives, impact and blocked work. Answer resumes only affected tasks. User acceptance, QA completion and publication/deployment are distinct events.
- **Return the outcome.** PM summarizes delivered artifacts, unresolved issues and verification. User accepts or requests revision. Outputs remain accessible from both conversation and agent views.

| Control / state | Required semantics |
| --- | --- |
| Agent zero state | No agents yet: show Assign this branch or Create agent; starting an agent is optional. Templates: PM, coding, QA and custom. Save definition separately from Create and run. |
| Task ready / blocked / in progress / in review / accepted | Blocked tasks name the unmet dependency, version and responsible actor. Agent run completed does not automatically mean task accepted. |
| Run queued / running / waiting for input / waiting for approval / pausing / paused / completed / failed / cancelling / cancelled | Show actual transitions and a useful reason. Separate dependency waiting from waiting for a human decision. Progress percentage only when grounded in measurable work. |
| Ask vs instruct vs branch | Ask requests explanation; Give instruction changes the active task prospectively and records a revision; side-branch discussion does not mutate the live task until explicitly applied. |
| Pause / stop subtree | Show affected runs before applying. Pause stops new work at safe checkpoints; already-running external actions may finish. Stop cancels pending work without undoing completed side effects. Shared dependencies outside the subtree remain intact. |
| Retry / try alternative | New attempt links to the same task and frozen inputs. Alternative runs preserve prior output; no duplicate external action without idempotency checks. |
| Concurrent edits | Use isolated coding workspaces or controlled write ownership. Do not let two agents silently overwrite shared files or outputs. Merge conflicts require explicit resolution and re-verification. |
| Shared memory | Agents propose memories/decisions; approved facts are versioned. Run context is a snapshot; important later changes arrive as explicit updates rather than silently altering ongoing work. |
| Activity / outputs / changes / context | Show useful progress summaries, tool actions, evidence and source manifests. Do not depend on private model reasoning being available. Each view points to the same canonical records. |
| Budget / failure | Per-run and aggregate parent limits; timeout, bounded retries, blocked-dependency handling and fail-fast options. Parent cancellation and provider disconnect cannot leave invisible child jobs consuming budget. |
| Responsive agent view | Agent cards use the same resize, collapse, focus and saved geometry contracts. On phones show task/status list → agent detail tabs; retain targeted messaging and approval actions without requiring graph gestures. |

### Foundation acceptance gates

- **AF01:** an existing multimodal branch becomes a task input by stable reference/version; no transcript copy or new canvas is required.
- **AF02:** PM → coding → QA handoffs preserve author, recipient, task, run and artifact revision across reload.
- **AF03:** conversation/source edges never schedule work; only explicit task dependencies do. Cyclic dependencies are rejected with an explanation.
- **AF04:** resuming a run does not replay already-completed tool actions; retries are separate attempts with idempotent external operations where supported.
- **AF05:** changing an artifact invalidates review tied to the earlier version. Approval cannot authorize an unseen later revision.
- **AF06:** one agent cannot read another canvas or gain tools from a role name, a message or a spawned child. Child authority is bounded by the granted policy.
- **AF07:** stopping a subtree updates all affected child states, preserves finished artifacts and reports any action that could not be cancelled.
- **AF08:** switching Conversations ↔ Agents preserves the same context, artifacts and source links; no parallel storage model or copied workspace is introduced.

**Sequencing:** define and validate these contracts during the current foundation phase. Ship the runtime, agent builder, orchestration, tool execution and collaboration controls in the next phase. The future release should extend the canvas, not replace its data model. “Future” here describes sequencing, not a promised delivery date.

## Data, reliability & integration requirements

| Object / service | Minimum contract |
| --- | --- |
| Canvas / thread | Owner/project ID, title, schema version, main-path pointer, lifecycle state; threads reference parent/source set and ordered messages. |
| Message / run | Immutable submitted input parts, context manifest, model/provider/mode, output preference, idempotency key, job state, usage and timestamps. |
| Node / edge | Node refers to semantic content; stores position, width/height, collapse state. Edges distinguish branch, source, synthesis and general reference. Layout is separate from content. |
| Asset / artifact | Storage reference, MIME type, checksum, processing state, derived transcript/thumbnail, access controls; artifacts have stable ID and immutable versions. |
| Selection / provenance | Source ID/version, exact quote plus block/range anchor or media region/time range. Resolve after edits; show missing/changed instead of linking incorrectly. |
| Draft / view state | Draft keyed by user+canvas+thread target; attachment references and pending selection. Per-device viewport; shared saved card dimensions. |
| Persistence / conflict | Local durable queue, debounced server sync, version checks, explicit conflict handling, schema migration and recovery snapshots. Never depend only on unload handlers. |
| AI service | Server-managed providers and secrets, capability validation, streaming/job polling, cancellation, retries, rate/usage limits and actual provider trace. |
| Security / privacy | Owner-only access initially; authorize asset URLs and source retrieval. Sanitize rendered text and sandbox HTML. Uploaded instructions are source data, not authority to grant tools. Explain provider data transmission accurately; do not repeat the demo claim that material “never leaves” the product. |
| Integration | Reuse existing authentication, projects, chats, notes and storage after audit. Import/reuse existing chats with stable backlinks, explicit copy vs reference semantics, and no duplication of private context. |

## Acceptance criteria & QA scenarios

| ID | Given / when | Required result |
| --- | --- | --- |
| AC01 | New user sends text + edited voice transcript + two images. | One message retains all parts in order; actual compatible model sees all approved inputs; original draft recoverable on failure. |
| AC02 | Image is still processing or model cannot read it. | Clear blocking state and compatible choices; no silent text-only submission. |
| AC03 | User selects one sentence and branches. | New thread links to exact source version; unrelated sibling text excluded. Reply continues that thread. |
| AC04 | User selects two branches and synthesizes. | New result links to both snapshots; originals and descendants remain unchanged. |
| AC05 | Source edited/deleted after generation. | Historical output remains interpretable; changed/missing state appears; no automatic regeneration. |
| AC06 | User changes model or output type mid-draft. | Text, uploads and selection stay intact; compatibility revalidated; resulting run records actual provider. |
| AC07 | User resizes a streaming branch at 50% / 100% / 200% canvas zoom. | Logical dimensions are correct; connectors update; text reflows; no stretched media; undo returns prior size. |
| AC08 | Window shrinks or mobile keyboard opens. | Composer and Send stay visible; no trapped controls; phone thread view preserves source navigation and content. |
| AC09 | User switches canvases with an unsent draft. | Each canvas restores its own draft and scope; nothing leaks into the other canvas. |
| AC10 | Network drops, tab refreshes or Send is double-clicked. | One run/job persists; no duplicate charge or lost acknowledged result; reconnect resumes tracking. |
| AC11 | Image/video fails after text succeeds. | Completed text remains; failed part retries independently with usage disclosure. |
| AC12 | Two tabs edit the same report/card. | Conflict is detected and recoverable; no last-write overwrite without warning. |
| AC13 | Generated HTML contains scripts or unsafe external content. | App remains isolated; no access to session/storage; source still downloadable as an artifact. |
| AC14 | Keyboard-only user branches, selects sources, resizes and exports. | Equivalent controls and visible focus exist; no mouse-only dependency. |
| AC15 | Provider errors or quota exhausted. | Honest error with retry/alternative; no sample content represented as actual AI output. |
| AC16 | Canvas reopened next day. | Messages, assets, provenance, card geometry and saved output versions remain intact. |

## Success measures & launch gates

Instrument outcomes rather than raw node creation. Do not collect message bodies, voice transcripts or attachment content in analytics by default.

| Metric | Definition / initial hypothesis |
| --- | --- |
| Primary outcome | Weekly users who branch and later synthesize, save an output, or revisit that branch on a different day. |
| Activation | New canvas creators who complete a first response and one meaningful branch within their first session. Establish baseline before setting a growth target. |
| Usability gate | At least 4 of 5 representative testers complete a first mixed-input ask, branch, synthesis and reopen without coaching; median first successful branch under two minutes. |
| Trust guardrails | Zero known critical data-loss or cross-canvas context-leak defects at launch. ≥99.5% server-save success excluding explicit offline periods, measured in beta. |
| Generation quality | Completion/failure/cancel rates by output type and model; context correction rate; failed-part retry success; user-reported wrong-scope answers. |
| Responsiveness | Measure p95 canvas open, local interactions and resize frame rate on agreed test devices; initial 100-node targets in responsive section. |
| Economics | Cost per completed useful output, duplicate-run rate, failed paid jobs and media retries. Avoid optimizing tokens at the expense of disclosed context. |
| Retention | 7-day reopen-and-edit rate among activated users; compare spatial vs reading-mode workflows without assuming spatial use itself is success. |

**Events:** canvas_created, draft_restored, input_part_added, upload_failed, voice_transcribed, context_changed, run_started/completed/failed/cancelled, branch_created, synthesis_created, source_opened, branch_resized, artifact_saved/exported, save_failed and canvas_reopened. Use IDs, type/count, duration and error category.

**Rollout:** internal dogfood → invite-only beta → limited release behind feature flags. Gate on recovery tests, model compatibility tests and usability. If generation fails, keep saved content and editing available; rollback must not strand canvases or delete assets.

## Decisions to close before implementation

| Decision | Recommended default | Why it matters |
| --- | --- | --- |
| Project vs canvas ownership | Canvas belongs to a project when present; memory is canvas-local unless explicitly inherited. | Avoid ambiguous scopes and cross-project leakage. |
| Scope without selection | New root uses current message + enabled rules/memory; whole-canvas retrieval is opt-in. | Predictable first-use behavior and cost. |
| Voice semantics | Transcript-first, user-reviewed send; raw audio only with explicit support and disclosure. | Combines reliably with text/images and preserves user control. |
| Output routing | Auto defaults to simple useful response; explicit media output routes to a compatible provider with cost visibility. | Do not force every model to generate every modality. |
| Mobile scope | Reading + full conversation authoring first; optional spatial overview and resize presets. | Preserves usefulness on small screens. |
| Retention / limits / credits | Publish tested asset limits, audio retention, deletion behavior and media billing before beta. | These affect UI states and backend design; values cannot be inferred from the prototype. |
| Branch convergence | Synthesis creates a new linked result; promotion changes preferred path only. | Avoid destructive merges and lost provenance. |
| Agent integration | One shared workspace model now; agent runtime and collaboration UI next. | Avoid rebuilding Conversations when PM, coding and QA agents arrive. |

**Research before committing polish:** observe five to eight target users handling a real project. Test whether they understand selected vs canvas context, can distinguish Reply from Branch, find their way back after three levels, and successfully combine two paths. Include at least one touch user and one keyboard-only session.

**Source record:** Conversations.dc.html, Agents.dc.html, agent-workspace.js, ThinkingCanvas.dc.html, composer-variants.css, context-islands.js, DESIGN-FILES.md, IMPLEMENTATION.md and the project design README. This is a product/design assessment, not a production backend or security audit.

