---
name: canvas-branch-system
description: Maintain current Canvas threads, branching and synthesis, source anchors, React Flow cards, reading views, model runs, and branch notifications in web/src/canvas. Distinct from chat side-panel branches under web/src/branch and historical frontend/ branch snapshots.
---

# Canvas branch system

The current application is React/TypeScript, Zustand, Dexie, React Flow and Vite under `web/`. The historical vanilla-JS no-build instructions describe a different application. Run existing `web/package.json` checks; do not port Canvas back into `frontend/`.

## Ownership and entry points

- `canvas/view/CanvasWorkspace.tsx`: orchestrates selection, composer targets, run submission, card sizing, camera navigation, reading and detail overlays. `send` is shared by Canvas and reading-view composers.
- `canvas/domain/commands.ts`: content operations including `createRootThread`, `branchFrom`, `continueThread`, `synthesize`, `freezeSelection`, `freezeWholeThread`; inspect actual signatures and callers before editing.
- `canvas/types.ts`: authoritative persisted shapes. A branch is a `CanvasThread` joined to messages, snapshots and relations; it is not a legacy branch-panel snapshot.
- `canvas/canvas-doc-store.ts`: currently open document, content writes, geometry debounce, viewport and geometry undo. Pass expected Canvas identity to async mutations; delayed work must never land in the next opened Canvas.
- `canvas/canvas-repo.ts` and `db/canvas.ts`: persistence boundary. Inspect both before saved-shape changes. Do not change schema versions or stored shapes without migration and a `[SCHEMA]` entry.
- `canvas/exec/run-canvas-turn.ts`: run lifecycle and provider streaming. It returns terminal status, run/message IDs and text; cancellation is separate from failure. `view/live-text.ts` owns transient streaming text; final persisted content remains authoritative.
- `canvas/anchors.ts` and `context/`: source resolution and model-visible context. Preserve exact source spans, immutable revisions, and changed/missing-source states. Geometry must not change model context.
- `canvas/view/ThreadNode.tsx`, `ReadingView.tsx`, `OutputDetailView.tsx`: different renderers of the same content; preserve text selection and branch source identity across them.
- `canvas/open-canvas.ts` and `view/canvas-bridge.ts`: tab activation and mounted workspace handoff. Bridge calls target only the matching mounted Canvas; a cross-Canvas jump needs an explicit handoff after loading, not an immediate blind focus call.

## Notifications

`canvas/notifications.ts` holds bounded session-only activity, separate from document state. `view/CanvasNotifications.tsx` renders the bell, All/Unread history, and brief activity cards using `ui/Glyph.tsx` and the existing Mind Garden sheet. Current history is scoped to the open Canvas and resets on reload.

Publish once after a completed or failed/unknown run; deduplicate by run identity. Do not notify for cancellation or expose provider error payloads, keys, prompts beyond the displayed thread title, or generated answer bodies. Existing error display and partial-output recovery still own the detailed failure.

A notification activates the exact thread, expands a minimized card, closes reading/detail/context overlays, and frames its card. Do not create a new thread or rewrite its source. A notification marked read stays in history until the bounded session history evicts it.

## Verification

Inspect callers before editing shared helpers. Check both Canvas and reading-view paths when changing shared workspace code. Verify successful completion, failed run, cancellation, deduplication, unread filters, mark-all-read, brief dismissal, keyboard Escape/focus, minimized-card navigation, and Canvas isolation. Run typecheck and relevant Canvas unit tests; use browser checks for actual card/camera behavior. State any unavailable desktop/provider checks explicitly.

Historical chat bugs remain useful lessons about identity and data loss, but legacy `openBranch`, `captureBranchSnapshot`, `threadState` and `persistAll` are not Canvas APIs. Do not impose their contracts on this implementation.
