# Changelog

Notable changes to notlinear. Newest first.

## 0.1.0 (2026-10-21)

- Summary: **First public release.** notlinear is a local-first, non-linear chat workspace: a conversation is a document you can branch from any highlighted passage, and every branch keeps the full context of where it came from.
- Summary: **Branching from highlights.** Select a phrase in a reply, press Cmd/Ctrl+Shift+B and ask a follow-up in a side panel. Branches nest, reopen after a reload, and appear as a thread map you can zoom and pan.
- Summary: **Projects.** Group chats and notes under a project with its own rules, knowledge files and an optional linked folder whose text and PDFs become searchable context.
- Summary: **Bring your own model.** Claude, DeepSeek, OpenAI and Gemini, with your own API keys stored only in your browser. Switch the model per message.
- Summary: **Research tools.** Web search through Serper, Firecrawl or SearXNG, Wikipedia, and a fetch-URL tool the model can call while it answers.
- Summary: **Notes.** A block editor with headings, lists, to-dos, callouts, code, equations, tables, columns, bookmarks and page links. Branch from a selection in a note, and let a chat file a long answer as a note.
- Summary: **Modes and skills.** Pick a response mode and let a bundled library of reasoning skills shape the system prompt for the question at hand.
- Summary: **Clarify first.** For a fresh prompt the model can ask a few multiple-choice questions before it answers; turn it off in Settings.
- Summary: **Fix and polish.** Light, grey and dark themes, a command palette (Cmd/Ctrl+K), a shortcuts sheet (Cmd/Ctrl+/), auto-hiding bars, and a local runtime log viewer.


## 2026-10-27 · Canvas reliability and full-page reading

- Agent: Codex
- Summary: Stabilized HTML previews and canvas geometry, restored scrolling at content boundaries, corrected formatted/repeated-text selection and highlights, added a full-window answer reader, and isolated delayed writes across canvases. Restored the seven local assets required by Conversations.dc.html from Conversations.html.
- Files changed: `web/src/canvas/` (document store, anchors/commands, workspace, renderers/readers and selection/HTML bridge helpers), canvas unit/browser regression tests, `feature-canvas/` support assets, this changelog and its generated fallback; private BUGS/FEATURES/project memory updated locally.
- Behavior changes: HTML previews use a stable 880×480 viewport constrained to the card width; content scrolls internally and gestures pass to the canvas at its edge. View full in the card header opens a full-window reader with a fixed toolbar. Reader selections return to the canvas with the source ready to branch. Frozen content keeps readable text while anchors retain exact raw-source spans; persisted field names and database versions are unchanged. Delayed content/geometry/viewport writes remain associated with their original canvas.
- Observed: broad linting of existing canvas tests reports pre-existing errors in exec.test.ts (require-yield), repo.test.ts (unused textPart), and save-output.test.ts (unused getCanvas); these unrelated files were not changed. Agents remain out of scope. Desktop provider/microphone/native-picker smoke tests are not claimed.
- Verification: final results are recorded in docs/project-notes/RUNS.md; no merge or desktop deployment.

## 2026-10-27 · Codex · Prototype stacked HTML reading before canvas integration

- Files changed: `feature-canvas/pagination-prototype/{TEST-PLAN.md,plan-pages.mjs,demo.html,demo.mjs,browser-smoke.mjs}`, `web/tests/canvas/pagination-prototype.test.ts`.
- Added a test-first page planner and isolated visual fixtures for content-sized final sections, original DOM block identity, an interactive chart, simulated generation, diagonal shimmer and reduced motion.
- Behavior changes: prototype only; the app renderer and installed desktop remain unchanged. No database or dependency changes.
- Verification: 18 planner cases pass; visual browser execution blocked by sandbox and is not marked passed. Production integration awaits browser/selection/layout acceptance gates.


## 2026-10-27 · Codex · Exercise HTML pagination integration gates

- Files changed: `feature-canvas/pagination-prototype/{browser-smoke.mjs,integration-gates.mjs,README.md,TEST-PLAN.md}`; private bug and project memory updated locally.
- Corrected the prototype browser runner dependency path and added real mouse selection across sections plus interaction checks for moved charts. Added sandboxed generated-HTML gates for ancestor CSS, long prose/tables and viewport-height feedback.
- Behavior changes: prototype/testing only. The production HTML renderer and desktop installation are unchanged; integration is gated on four failing layout checks.
- Verification: curated Chromium smoke and 18 planner cases pass. Arbitrary-HTML integration gates intentionally return failure (exit 2); measured results recorded in TEST-PLAN.md. This is not a completed production pagination feature.


## 2026-10-27 · Codex · Paginated HTML reading and generation shimmer in the canvas

- Files changed: `web/src/canvas/view/{html-pagination.js,html-stream.js,html-bridge.ts,PartView.tsx,ThreadNode.tsx,CanvasWorkspace.tsx,InkComposer.tsx,live-text.ts,section-layout.ts}`, `web/src/styles/canvas.css`, canvas unit/browser tests, pagination prototype stress harness/documentation and generated changelog fallback.
- HTML answers now flow through fixed-width stacked reading sections in the canvas, with rendered-line/row breaks and a short final section. Source hierarchy and the single sandbox/runtime are retained. The generation shell and diagonal shimmer begin before the first token, completed blocks appear progressively, and updates pause while text is selected. Partial scripts stay inert until completion.
- Behavior changes: HTML cards no longer offer the full-window View full action; the complete answer is present in the canvas. Ordinary sections target 640px; indivisible widgets can be explicitly taller, while positioned/unsupported/unstable documents use a labeled scrollable fallback. Viewport units use a fixed logical page height. Expanding reports make room below, selections/composers stay within the visible window, and cards fit final content rather than retaining a loading-height floor. Existing Markdown reading/detail behavior is retained. No persisted shape, DB version, endpoint or dependency changes.
- Observed: repeated table headers are intentionally not cloned; cross-page selection/provenance uses original source text. The installed desktop update is a local branch fast-forward/build, with the existing Vite config edit preserved. Physical trackpad and real-provider native smoke are recorded separately, not implied by Chromium results.
- Verification: detailed final commands/results are in private project-notes/RUNS.md and feature-canvas/pagination-prototype/TEST-PLAN.md. No merge or remote push.

## 2026-10-27 · Codex · Preserve report width through delayed geometry writes

- Files changed: `web/src/canvas/view/CanvasWorkspace.tsx`, `web/tests/e2e/web-canvas.spec.ts`, generated changelog fallback.
- Geometry callbacks queued before HTML settles now resolve the chosen report width from the document at write time. A stale provisional closure cannot overwrite the committed 880px width. Browser assertions wait for React Flow to apply the settled layout rather than sampling an intermediate render frame.
- Behavior changes: delayed automatic measurements preserve the chosen width; explicit resizing remains supported. Persistence fields remain unchanged.
