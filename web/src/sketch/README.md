# Sketch ownership and regression contract

Sketch is an editable object inside the existing Canvas. Independent saved-document identity does **not** imply a separate navigation destination. Canvas's CTA must not create/activate a Sketch tab.

- `model.js`: DOM-free versioned semantic graph, validated atomic operations, fresh-flow arrangement and parsing. AI batches target a revision; existing positions are preserved.
- `store.ts`: separate `notlinear-sketch` database. V1 documents retain their shape; v2 adds Canvas placement records and initializes message image lists. No existing chat/Notes/Canvas schema changes. Placement removal retains document data.
- `SketchNode.tsx`: outer movable/resizable/collapsible Canvas card; isolates inner pointer/wheel/paste/keyboard events. Explicit gestures save placement; automatic node measurements must not write geometry.
- `SketchView.tsx`: shared editor and chat. Fresh/lone-Start flows create first; existing flows ask first. Reference images can be uploaded, pasted or dropped. Limits and failures are surfaced.
- `ai.ts`: existing desktop model/provider/vision adapters and fallback, separate Sketch output guidance, and the same available research/project tools as Canvas. Do not drop an image silently; text-only models fail clearly.
- `x6-adapter.js`: rendering and event translation only. Layered new flows use orthogonal obstacle-aware routes and side ports for retries. Initial framing keeps text readable; Fit shows all. Old/manual diagrams only rearrange explicitly.

Verification: `pnpm exec vitest run tests/sketch`, `pnpm exec playwright test web-sketch.spec.ts`, typecheck/lint/build and relevant Canvas/HTML/shell regressions. Test actual SVG intersections and Canvas identity; node counts alone cannot establish correctness. Native dictation and live image-model comprehension require separate human verification.

Project context: `project-context.ts` resolves the explicit owning Canvas (or a unique persisted association), loads its project rules/uploads and Canvas memory/files, retrieves linked-folder evidence, and binds tools to that submission's folder root. Never select authority from the globally active project/tab. Ask and Edit have equal source access; only Edit may change the graph. Native providers execute the tool loop, including project-file reads, before final synthesis. No storage migration is needed for context inheritance.
