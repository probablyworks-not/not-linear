# HTML pagination prototype — test before integration

2026-10-27 · Codex · isolated prototype; production canvas remains unchanged.

## Acceptance gates

1. A short report produces one content-sized page; longer reports produce bounded pages and a content-sized last page.
2. Page planning preserves block order and identity without modifying the input document or creating duplicate messages.
3. A heading travels with the following block when both can fit together.
4. An indivisible oversized chart has an explicit oversized page; never silently clip it or generate empty pages.
5. Table-row and paragraph boundaries supplied by the renderer remain valid break opportunities.
6. Invalid or unbounded measurements fail explicitly rather than entering a growth loop.
7. Identical measurements produce identical plans. An empty generation starts with one loading placeholder.
8. Browser prototype: selection can cross the visible page gap in one live document; a script-backed chart is initialized once; delayed assets cause at most one settled reflow per change.
9. Browser prototype: completed text remains readable while a themed diagonal shimmer occupies only unfinished content; reduced motion disables the sweep.

## Before production integration

Real browser checks are mandatory for arbitrary HTML, nested grids/flex, tables, fonts, images, generated scripts, and CSS viewport units. DOM layout cannot be validated by jsdom measurement mocks. Also verify original-source selection offsets, highlight connectors, streaming cancellation/error cleanup, reload and canvas isolation. No production renderer replacement until these checks pass.

## Commands

From web/: `node node_modules/vitest/vitest.mjs run tests/canvas/pagination-prototype.test.ts --maxWorkers=2 --minWorkers=1`

Typecheck: `node node_modules/typescript/bin/tsc --noEmit`

## Prototype status

- Planner: 18 unit cases passed (2026-10-27).
- Visual fixtures: short, long, table, single-initialization chart, simulated block streaming, Stop, reduced-motion shimmer.
- Run `node feature-canvas/pagination-prototype/browser-smoke.mjs` from the repo root. It injects the local demo into an isolated browser page and does not require a server.
- Browser execution attempted but blocked by macOS sandbox `bootstrap_check_in … Permission denied`; not passed. No escalation requested in this side conversation.
- This is a prototype, NOT an app feature. No edits to PartView, ThreadNode, bridge, streaming, schemas, or installed desktop app.
- Open `demo.html` through an existing local static server to inspect it; ES modules need HTTP rather than file://.
- Remaining gates: real mouse selection across pages, sandboxed arbitrary generated HTML/CSS/scripts, nested tables/grids, row splitting/repeated headers, late images and viewport-unit layouts, stable completed-page streaming and app source/highlight/connector integration.
- Prototype exception: indivisible oversized blocks get an explicitly oversized page; production policy remains unresolved. Tables currently remain indivisible. Theme variables fall back to browser system colors in this standalone fixture.


## Integration spike results — 2026-10-27

Supersedes the earlier browser-launch limitation: Chromium checks now execute with sandbox escalation. `browser-smoke.mjs` had an incorrect `../../../web` dependency path; corrected to `../../web`.

- PASS: curated short/long pages, original block order/identity, actual mouse selection crossing a section gap, DOM range continuity, chart node identity after resize AND click behavior, pending shimmer, Stop and reduced motion.
- PASS: 18 planner unit tests.
- NOT READY: `node feature-canvas/pagination-prototype/integration-gates.mjs` exits 2 intentionally when production gates fail. These are real browser measurements in a sandboxed iframe, not mocked dimensions.

| Gate | Actual result | Required correction |
| --- | --- | --- |
| Ancestor-dependent CSS | Moving a paragraph into a section inside its original ancestor changed 24px text/72px block to 16px/18px; delegated clicks survived | Pagination must preserve ancestor and direct-child styling, or use an explicit supported-layout boundary; retaining nodes alone is insufficient |
| Long paragraph | One 6,752px paragraph became a 6,800px section | Add line-aware paragraph fragmentation, retaining source positions and formatting |
| Long table | 36 rows became one 1,538px section | Add row-boundary fragmentation; repeat decorative headers without duplicating source text |
| Viewport units | Resizing iframe to content produced 690 → 740 → 790 → 840px | Separate logical layout viewport from expanded scene geometry; do not feed expanded height into `vh` layout |

Production renderer, stored answers, schemas, streaming, and desktop installation remain unchanged. This spike does NOT test app selection provenance, highlight connectors, large-canvas performance, or native trackpads. It is not production acceptance.

Next engineering work: implement an explicit DOM fragmentation adapter with source tracking; test style/viewport preservation before wiring it to PartView. Keep the existing renderer as a fallback for unsupported layouts. Do not hide the failed gates by weakening bounds or accepting arbitrary oversized prose/table pages.


## Production resolution — 2026-10-27

- CSS ancestry: resolved by preserving original parents, not page-wrapper reparenting.
- Long prose: resolved with rendered-line boundaries and original text-node spans.
- Tables: resolved at row boundaries without duplicating source rows/headers; rowspan tables are indivisible and explicitly labeled.
- Viewport feedback: CSS height units use a 640px logical reading viewport; repeated script-driven height feedback falls back to bounded scrolling.
- Added real engine checks in production-smoke.mjs; integration-gates.mjs now runs those checks. The earlier failing experiment remains in legacy-integration-gates.mjs for comparison.
- Canvas browser regressions exercise pre-token shimmer, streamed blocks, reduced motion, completion cleanup/short final height, cross-page selection/branch/reload, zoom coordinates, panning, source highlights, canvas isolation, and idle observer teardown.
- Native desktop real providers, physical trackpad/pinch, microphone and native dialogs are not represented by the browser mocks; record these separately when manually verified.
