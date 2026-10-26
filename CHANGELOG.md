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
