# Conversation canvas reliability — current delivery

2026-10-28 · Codex · branch `canvas/tesing-codex`. This current report supersedes the original 880×480/full-window HTML reader design and the historical prototype status. Agents remain excluded.

## Implemented behavior

HTML stays in the canvas in fixed-width reading sections (640px logical height budget, content-sized final section, 8px gaps). One live sandboxed document preserves original DOM ancestry, charts and source identity. Long prose splits at line boundaries and tables at rows; indivisible charts and rowspan tables may be explicitly oversized. Unsupported positioned/external/unstable layouts use a labeled bounded scrolling fallback. The same stored answer drives all surfaces. Markdown keeps its full reader.

Generation displays an unfinished-section shell and diagonal shimmer before first content, progressively reveals complete safe blocks, pauses reconciliation during selection and stops shimmer on completion/cancellation/failure. Partial scripts are inert; authored scripts run on settlement. Reduced motion stops the sweep. Cards and Reading View share LiveReply, including root and branch HTML.

Geometry updates compare actual values, retain the current width and settle saves. HTML horizontal scrollers retain horizontal wheel events at their boundaries; vertical boundaries hand off to canvas and pinch remains distinct. Canvas loads, writes, drafts and viewports stay scoped to their originating document.

Selections retain readable branch excerpts with original raw-source offsets. Repeated/formatted text, entities, multiple text nodes, zoom coordinates and cross-section branches are covered. HTML elements can be inspected/drilled into; img/SVG/canvas selections retain opening-tag provenance rather than inventing visible text marks. Branches minimize/reopen on canvas and can be read beside the unchanged source in Reading View. Stored schemas and database versions are unchanged.

Ordinary follow-ups request Markdown; explicit HTML or improved reading enables HTML. Token-limited HTML continues in the same answer, up to three extra requests, retaining partial output and reporting exhaustion. Both reference documents retain their content and recovered dependencies.

## Issue register

| Issue | Reproduction | Resolution / verification |
| --- | --- | --- |
| Growth / stuck Saving | Long report or 100vh HTML; wait idle | Stable logical viewport, geometry equality, iframe measurement handshake; unit/browser/stress pass |
| Wheel ownership | Scroll long content, boundaries, horizontal table and empty canvas | Explicit handoff/containment; browser/unit checks pass, physical trackpad remains manual |
| Disconnected HTML View full | Open a long HTML answer | HTML sections remain inside canvas; no HTML View full detour |
| Missing pre-token shimmer | Start HTML, switch to Read before first token | Reproduced failure; shared live renderer fixes root and branch reader; browser regression passes |
| Wrong selection / source occurrence | Drag backward through repeated formatted text or across pages; branch/reload | Source spans and multi-node marks; browser checks pass |
| Cross-canvas contamination | Different drafts, slow reply then switch/reload | Scoped loads/writes and independent viewports; browser checks pass |
| Truncated HTML | Provider ends mid-table with max_tokens | Same-answer continuation; deterministic provider mock and reload pass |
| Follow-up accidentally HTML | Ask ordinary child question after HTML | Current-turn text instruction; request payload browser check passes |
| Inspector styling lint | Select an HTML element | Existing document palette variables; scoped lint passes |
| Broken reference dependencies | Load both Conversations references | Seven embedded equivalents restored; browser reference tests |

## Verification and limits

- Final unit suite: **846/846**, 85 files.
- Final Canvas browser suite: **27/27**, including Reading View pre-token shimmer, branch persistence, cross-page selection and isolated drafts.
- Production pagination stress checks: pass for CSS ancestry, line/row fragmentation, chart identity, viewport stability, streaming selection pause and explicit fallback.
- TypeScript, production build, scoped source lint and diff whitespace checks: pass. Existing large-chunk build warning remains.
- Complete desktop-source application browser suite: **303/303** (6.8 minutes). After the final shared-renderer/palette correction, the complete Canvas suite **27/27** and both reference documents **2/2** passed on the final compiled assets.
- Native desktop: waited for the user’s active generation to complete; confirmed Saved, reopened `/Users/yash/Desktop/Notlinear.app`, verified the same 10-thread canvas and tabs restored, opened Reading View and returned to canvas. No user prompt submitted or stored data reset.
- Desktop server response and final index asset match SHA-256 `b961ad14ece1de4d20e72c85d1c67d57d6ce8c8eb86729771c10e39e43f17e94`. Local Vite configuration preserved.

Physical mouse/trackpad/pinch behavior, microphone permission/audio capture, live provider rate-limit fallback and native file/folder dialogs require real hardware/provider checks. Automated provider and picker tests use controlled responses; they are not represented as live checks. No database reset, main-branch merge or remote push.
