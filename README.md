# not-linear

A non-linear, chat-based system for research. Chat with Claude (or DeepSeek), highlight any phrase in a response, and branch off a follow-up that keeps the full context of where it came from.

## Ways to run it

| Mode | Platforms | Best for |
|---|---|---|
| **Browser** (recommended default) | macOS, Windows, Linux | Everyday use, any machine with Python 3 |
| **macOS desktop app** (`Notlinear.app`) | macOS only | Same app in its own window, double-click launch |

Both run the same code. The desktop app is just a window around the local server that the browser mode starts by hand.

## Quick start (browser)

**Requirements:** Python 3 (3.9 or newer) and a modern browser (Chrome, Edge, Firefox or Safari). Nothing else: no `pip install`, no Node, no build step.

1. Open a terminal in the repo folder.
2. Start the server:
   ```bash
   python3 backend/server.py        # macOS / Linux
   python backend/server.py         # Windows (or: py backend/server.py)
   ```
3. Open **http://127.0.0.1:8765/frontend/index.html** in your browser.
4. Click the gear (⚙) → **API Keys** and paste your Anthropic key (and optionally DeepSeek, Serper, Firecrawl, OpenAI or Google keys).
5. Start chatting. Highlight text in a response to branch from it.

Keep the terminal open while you use the app. Press `Ctrl+C` to stop the server.

### Options

```bash
python3 backend/server.py --port 9000          # use a different port
python3 backend/server.py --host 127.0.0.1     # default; local-only
```

If you change the port, use it in the URL too. Keep the host at `127.0.0.1` unless you understand the risk: the server has no authentication, so binding to `0.0.0.0` exposes it to your network.

### Port already in use

Another copy is probably running (or something else holds port 8765). Either open the URL above directly, or start on a different port with `--port`.

## macOS desktop app

Double-click `Notlinear.app` (built from `launchers/`). It starts the same local server and opens Notlinear in its own window, so you never need to open the URL yourself. A lighter alternative is `launchers/Notlinear.command`, which starts the server and opens your default browser.

The launchers contain the repo path hard-coded (`/Users/yash/Downloads/notlinear`). If you move the folder, rebuild with `launchers/build-macos-app.command`.

## Platform differences

The core app (chat, branching, notes, providers, search, persistence) works the same in every browser and OS. A few conveniences depend on macOS, because the server uses `osascript` and `screencapture`:

| Feature | macOS | Windows / Linux |
|---|---|---|
| Chat, branches, highlights, Notes | ✅ | ✅ |
| Native file / folder picker (`+` menu), native save dialog | ✅ | ⚠️ not available through the server; use the browser's own file handling where offered |
| Feedback screenshots / screen recording | ✅ | ❌ |

Windows and Linux support for the core app comes from the server using only the Python standard library. It hasn't been smoke-tested on those systems, so report anything that breaks.

## Where your data lives

- **Chats, branches, projects, notes** are stored in your browser's IndexedDB for the address `http://127.0.0.1:8765`. Use the same browser profile and the same host and port each time. Clearing site data, switching browsers or changing the port will make chats appear missing.
- **API keys** are stored in the browser's `localStorage` and sent only to their own provider's API.
- Nothing is sent to any server other than the AI providers you configure.

## Updating

Edit files and the running app notices: a **New update, refresh** button appears in the bottom-right corner. Click it to reload.

## Repo map

- `frontend/` is the app (`index.html`, `app.js`, `core/`, `providers/`, `views/`, `styles/`).
- `backend/server.py` is the local server (static files, runtime log sync, native pickers on macOS).
- `launchers/` holds the macOS app and launcher scripts.
- `AGENTS.md`, `FEATURES.md`, `CHANGELOG.md`, `BUGS.md` and `docs/project-notes/` hold contributor and agent documentation.
