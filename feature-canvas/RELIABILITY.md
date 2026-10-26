# Conversation canvas reliability and full-page reading

Implemented on `canvas/tesing-codex`, from `canvas/c0-spike` at `592c0f0`.
`Conversations.html` and `Conversations.dc.html` are functional design references.
Agents, model/role persona controls, and agent orchestration are excluded from this pass.

## User-visible changes

- HTML answers use a stable 880×480 preview, constrained to the card. A thread initializes its reading width when its first HTML answer arrives, then retains later manual resizing. Intrinsic HTML dimensions no longer resize the iframe or repeatedly enlarge the card.
- Scrollable card/iframe content consumes wheel gestures while it can move. At an edge, gestures reach the canvas renderer. Pinch and horizontal gestures retain their separate meanings.
- **View full** is available in the card header. It opens a full-window answer reader with a fixed Back/Save toolbar, a centered Markdown column or a full-height sandboxed HTML document viewport. Selecting a source there returns to the canvas ready to branch.
- Selections preserve paragraph boundaries, formatting, entities and repeated occurrences. Block selections and text dragging share source mapping. Highlights may span several text nodes, including HTML iframe text; connector measurements respond to node movement, content scrolling, fonts and resize.
- Canvas loading never renders another canvas's document. Delayed content, geometry and viewport writes stay scoped to the original canvas. Pending geometry is not overwritten by content saves or discarded on a tab switch.
- The seven missing local JS/CSS dependencies of `Conversations.dc.html` are restored byte-for-byte from the equivalents embedded in `Conversations.html`. Neither reference HTML document was rewritten.

## Compatibility and interfaces

No database version, persisted field name, backend endpoint or runtime dependency changed.
`TextAnchor.quote/start/end` continue to describe raw-source text; `SourceSnapshot.content/label` retain the readable frozen selection. `freezeSelection` accepts an optional raw-source end offset; old callers and records remain compatible. View helpers accept transient source spans, occurrence and zoom-aware geometry. Canvas write methods accept an optional originating canvas ID.

The reader uses the original message and PartView, not another stored representation. HTML keeps `sandbox="allow-scripts"` without same-origin access. Script-created text that does not exist in the stored source is not assigned a fabricated text anchor; whole-card selection remains available.

## Issue register

| Issue | Resolution | Regression evidence |
| --- | --- | --- |
| C01: iframe wheel events miss the renderer | Forward to `.react-flow__renderer` | HTML boundary pan test |
| C02: cards swallow wheel gestures | Consume only when content can scroll | Wheel ownership unit cases |
| C03/C04: formatted/repeated selection mismatch | DOM-aware raw-source mapping and occurrence | Real formatted/backward drag, entities, paragraphs, callouts, reload |
| C05: missing multi-node marks | Preserve formatting while wrapping mark fragments | Native and iframe highlights after reload |
| C06: iframe coordinates ignore zoom | Convert local coordinates using frame scale and border | Zoomed HTML popover position |
| C07: HTML/card growth loop | Stable iframe viewport and no added padded width | Long HTML/100vh settles to Saved; exact dimensions |
| C08: observer/render churn | Scoped/throttled measurements and equality checks | 51-card idle fixture; observer count returns to zero on leave |
| C09: stale/cross-canvas state | Scoped writes, hydration guard, pending layouts | Independent drafts/reload and slow stream across switching |
| C10: broken editable reference | Restore missing embedded assets | Both reference documents boot/open reading mode without script errors |

## Verification

- Complete unit suite: **811 passed**, 82 files.
- Complete Chromium browser suite: **293 passed**. This covered the full change set before the final first-HTML width and typed-code raw-source audit.
- Final focused browser rerun after those audit adjustments: **19 passed**; includes both references, preview dimensions, zoom coordinates, reader branching, connector movement, slow streaming, navigation and populated-canvas cleanup.
- Typecheck, production build and lint for modified source/tests pass. Build retains the existing large-chunk warnings.
- Broad canvas-test lint reports three pre-existing errors in unchanged `exec.test.ts`, `repo.test.ts` and `save-output.test.ts`; they were left outside this change.
- The native desktop installation was not changed. Physical trackpad/WKWebView, live provider fallback, microphone/native picker and native file-watch smoke checks remain manual. WebKit is not installed in the local browser-test cache; Chromium results are not represented as native-desktop verification.

## Review groups

1. Canvas hydration and asynchronous write isolation.
2. HTML/scrolling stability and precise source selection/anchors.
3. Full-page reader, header access and interaction regressions.
4. Reference asset recovery, release notes and this report.

No merge, push, database reset or desktop deployment was performed. Private BUGS/FEATURES/project-memory files are updated locally and retain the repository's existing ignore policy.
