# notlinear

A local-first, non-linear chat workspace. A conversation is a document you can branch from any highlighted
passage into a side thread, and every branch keeps the full context of where it came from.

> notlinear is not affiliated with or endorsed by Linear, Anthropic, OpenAI, Google or DeepSeek.
> Product and company names belong to their owners and are used only to name the integrations.

## What it does

- **Branch from a highlight.** Select a phrase in a reply, press **Cmd/Ctrl+Shift+B**, ask a follow-up in a side
  panel. Branches nest, reopen after a reload, and show up on a zoomable thread map.
- **Projects.** Group chats and notes with their own rules, knowledge files and an optional linked folder
  (text and PDFs become context).
- **Bring your own model.** Claude, DeepSeek, OpenAI and Gemini. Switch the model per message.
- **Research tools.** Web search (Serper, Firecrawl or SearXNG), Wikipedia, and a fetch-URL tool.
- **Notes.** A block editor (headings, lists, to-dos, callouts, code, equations, tables, columns, bookmarks,
  page links). Branch from a note selection, or let a chat file a long answer as a note.
- **Modes and skills.** Response modes plus a bundled library of reasoning skills (`notlinear-skills/`).
- **Clarify first.** The model can ask a few multiple-choice questions before answering (optional).

Your chats and notes live in your browser's IndexedDB. There is no account and no hosted backend.

## Quick start

Requirements: Python 3.12+ (CI runs 3.12), Node 22+, [pnpm](https://pnpm.io) 10, and a modern browser.

```bash
# 1. Server dependencies
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

# 2. Build the web app
cd web && pnpm install && pnpm build && cd ..

# 3. Run
python3 backend/server.py          # then open http://127.0.0.1:8765/web/
```

Open **Settings → API keys** and paste at least one provider key (e.g. Anthropic). Keys are stored in your
browser's localStorage and sent only to that provider (and, for the local helpers below, to your own machine).

Options: `--port 9000`, `--host 127.0.0.1` (default). **Keep the host on `127.0.0.1`.** The server has no
authentication; binding it to `0.0.0.0` exposes your files and keys to your network.

### Development

```bash
NOTLINEAR_DEV_PROXY=1 python3 backend/server.py   # serves the API and proxies /web/ to Vite
cd web && pnpm dev                                 # Vite on 127.0.0.1:5173, open http://127.0.0.1:8765/web/
```

Use the `8765` URL, not `5173`: IndexedDB is per origin, so a different port is an empty database.

```bash
pytest tests                                      # server: endpoint contract, static allowlist, proxy
cd web && pnpm typecheck && pnpm lint && pnpm test
cd web && pnpm e2e                                # builds, then Playwright against the built app
```

## What the local server is for

A small FastAPI server (`backend/`) does the few things a browser can't: serve the built app, scan a linked
project folder, fetch pages for the fetch tool without CORS, write runtime logs, and (on macOS) show native
file and folder pickers.

- **macOS-only:** the native file/folder pickers use `osascript`. On Linux and Windows they report
  "cancelled", so attachments fall back to the browser's file input; the linked-folder picker is unavailable.
  A cross-platform picker is a welcome contribution.
- **Network use:** besides your chosen provider, the page loads Google Fonts and the Tabler icon font from CDNs,
  and pdf.js from jsDelivr when you attach a PDF. Self-hosting these is on the to-do list.

## Layout

```
web/             React + TypeScript app (Vite, Zustand, Dexie, BlockNote)
backend/         local FastAPI server
notlinear-skills/ bundled skills library (Markdown)
tools/           standalone backup/restore pages for the two IndexedDB databases
tests/           server tests (pytest)
```

## Contributing, security, licence

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md). Licensed under the terms in
[LICENSE](LICENSE); third-party notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).


### Sketch inside Canvas

Open a Canvas and click **Sketch** in its toolbar. The flow editor opens as a card in that Canvas. Describe a flow or attach/paste/drop a reference image, then choose **Create Sketch**. Use **Ask** for questions and **Edit** for graph changes. Drag the grip header to move the card; resize, collapse or remove it without deleting the saved Sketch. Pan/zoom inside the flow; **Fit** gives an overview and **Arrange** cleans up an existing layout.

The **Sketches** library retains existing independent documents; **Add to current Canvas** places one on the Canvas last opened. Image input requires a vision-capable model (Claude, OpenAI or Gemini); text-only providers report that limitation rather than ignoring the image. System dictation uses the standard text field; native transcription and workflow execution are not included.

Sketch inherits its Canvas's project knowledge: project rules and uploaded files, Canvas memory/files, linked-folder context and the same configured research/repository tools. Use Ask to inspect the project without changing the graph, or Edit to build the flow from that evidence. The chat shows the project name. A Sketch reused across projects uses the Canvas where you opened it; library-only ambiguous associations must be opened from the intended Canvas.

### Subscription agents (test build)

The isolated desktop test build supports connecting Claude and ChatGPT subscriptions in **Settings → Models & keys → Subscriptions**. Choose a subscription model from the composer; the list is refreshed from connected accounts. First install the optional companion with `python3 backend/agent_runtime/setup.py` and restart the server. Claude uses its own official sign-in; ChatGPT uses the official browser authorization flow. Existing API-key connections remain available.

This integration is a prototype: full verification of Notes, branches, canvas, attachments and cancellation is pending. The subscription request path does not silently switch to paid API usage. See [SUBSCRIPTIONS.md](SUBSCRIPTIONS.md) for the verification and performance plan.
