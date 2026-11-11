# Stacked HTML reading prototype

This is an isolated milestone, not the production renderer.

- `TEST-PLAN.md`: acceptance and remaining integration gates, written before implementation.
- `plan-pages.mjs`: deterministic planner, measured block identities in and section plans out.
- `demo.html` / `demo.mjs`: curated visual fixtures; original nodes move into stacked fixed-width sections, last section fits content, and simulated generation shows diagonal shimmer. Browser system theme fallback and reduced motion included.
- `browser-smoke.mjs`: local headless browser checks without a server or app data.
- `../../web/tests/canvas/pagination-prototype.test.ts`: 18 passing planning tests.

Serve demo.html through an HTTP static server. Do not open via file:// because ES modules need HTTP. The browser smoke injects the same local files directly, so it requires no server.

## What is not implemented

Actual app View full replacement, sandboxed arbitrary HTML, preserving arbitrary ancestor CSS during reparenting, splitting tables/long paragraphs, app streaming lifecycle, original-source selection/highlight/connector integration, and persisted expansion state. The demo's streaming reflows the curated report; it does not guarantee stable earlier pages in arbitrary HTML. An oversized indivisible block gets a labeled oversized page, pending a product decision on scaling versus exceptional page height.

Browser smoke was blocked at Chromium launch by sandbox permissions. It and real mouse selection must pass before production integration.


## Latest verification (2026-10-27)

The browser smoke now passes, including real mouse selection across page gaps and chart interaction after movement. The earlier sandbox limitation above is historical.

`integration-gates.mjs` adds real sandboxed HTML stress checks and currently exits **2**, correctly blocking production integration: direct-child CSS changes after reparenting, long prose/tables remain oversized, and a `100vh` document grows when iframe height follows content. See TEST-PLAN.md for measurements and required next work. Passing the curated smoke does not imply arbitrary HTML support.


## Production integration — 2026-10-27

The app now uses `web/src/canvas/view/html-pagination.js` inside one opaque iframe. Original ancestor hierarchy is retained; line gaps and table-cell padding introduce reading breaks. The parent masks page gaps and draws section outlines. Sections are a grouped answer, not independently saved messages or draggable nodes. Width is constrained by the report card; 640px is the ordinary page budget. The final section fits content.

`node feature-canvas/pagination-prototype/integration-gates.mjs` now runs the production stress checks (the original failing experiment is preserved as `legacy-integration-gates.mjs`). Checks cover source ancestor styles, long formatted prose, row breaks, logical viewport units, chart node/runtime identity, deferred streaming while selecting, inert partial markup, and responsive-JavaScript growth fallback.

Limits are explicit: indivisible charts, grids, rowspans and complex widgets can receive a labeled taller section; positioned content, opaque external styles, oversized documents or unstable responsive layouts use a labeled 640px scrolling fallback. Tables keep original rows; headers are not duplicated. Generated scripts execute only once the reply settles. No schema, endpoint or runtime dependency change.

Progressive generation uses one live preview and a themed diagonal shimmer tail. The shell begins before the first token, completed blocks appear incrementally, and selection defers reconciliation. Completion/error/cancellation clear the message-local HTML cache. Native desktop/WKWebView acceptance remains separate from Chromium automation.
