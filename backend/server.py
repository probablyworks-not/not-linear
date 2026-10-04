#!/usr/bin/env python3
# backend/server.py — Notlinear's local HTTP server.
#
# What this is: a Python-3-standard-library-only (no pip deps) HTTP server
# built on `http.server` / `ThreadingHTTPServer`. It has two jobs:
#   1. Serve the static frontend — it runs with `directory=REPO_ROOT` (see
#      `main()`), so any request for a plain path (e.g. `/frontend/index.html`,
#      `/frontend/core/api-client.js`) is handled by the stdlib
#      `SimpleHTTPRequestHandler` file-serving behavior, unmodified.
#   2. Expose a small set of local-only POST endpoints, all prefixed
#      `/__notlinear_*`, that the frontend cannot do itself from the browser
#      sandbox: native macOS file/folder pickers, screen capture, writing
#      feedback/log files to disk, and one server-side outbound fetch (link
#      preview, to dodge CORS). Per AGENTS.md, these endpoint paths/behavior
#      must never be renamed — only added to additively. The only frontend
#      module allowed to call them is `frontend/core/api-client.js`.
#
# How it's invoked:
#   - Desktop: double-click `Notlinear.app`, which launches this file as a
#     subprocess and opens a window pointed at the URL it prints.
#   - Manual: `python3 backend/server.py` (optionally `--host`/`--port`),
#     then open the printed URL. Plain `python3 -m http.server` also serves
#     the static files but skips these endpoints (no native pickers, no
#     runtime-log file sync).
#   - macOS-only: several endpoints below shell out to `osascript` (AppleScript)
#     for native Open/Save dialogs and to `screencapture` for screenshots/
#     screen recording. Neither exists on other platforms.
#
# Role relative to frontend/: this process serves `../frontend` as static
# files (see `REPO_ROOT` / `APP_DIR` below) and otherwise stays out of the
# way — all app state (chat, threads, branches, notes) lives in the browser's
# IndexedDB, not here. This file only touches the filesystem for: syncing
# runtime logs into `logs.md`, writing feedback into `feedback/FEEDBACK.md`
# (+ `feedback/media/`), and reading project folders read-only.
#
# Security note (AGENTS.md): never log API keys or auth headers. This server
# does not read or forward any provider API keys — those stay client-side —
# and nothing here logs request headers or bodies.
import argparse
import base64
import json
import mimetypes
import re
import signal
import subprocess
import threading
import os
import urllib.error
import urllib.request
from datetime import datetime, timezone
from html.parser import HTMLParser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


# APP_DIR = backend/, REPO_ROOT = repo root one level up. REPO_ROOT is what
# gets handed to SimpleHTTPRequestHandler as the served `directory` (see
# main()), which is why relative paths like "frontend/index.html" and
# "logs.md" resolve as they do from the browser.
APP_DIR = Path(__file__).resolve().parent
REPO_ROOT = APP_DIR.parent
# logs.md — root-level runtime-log target. AGENTS.md: "server syncs the
# latest events into the marked section" (see LOG_START/LOG_END below and
# the /__notlinear_runtime_logs handler in do_POST). Path is intentionally
# root-relative and must not move without updating the frontend's fetch of
# the same relative path (see AGENTS.md "Relative paths to root docs").
LOGS_PATH = REPO_ROOT / "logs.md"
FEEDBACK_DIR = REPO_ROOT / "feedback"
FEEDBACK_MEDIA_DIR = FEEDBACK_DIR / "media"
FEEDBACK_PATH = FEEDBACK_DIR / "FEEDBACK.md"

# Screen recording (used by /__notlinear_feedback_record) launches a
# `screencapture` subprocess that outlives a single request — "start" spawns
# it, a later "stop" request signals it. Handler methods run on separate
# server threads (ThreadingHTTPServer), so this shared dict of in-flight
# recording state must be guarded by a lock to avoid two requests racing on
# start/stop.
_recording_lock = threading.Lock()
_recording = {"proc": None, "path": None}
# Sentinel HTML comments marking the runtime-log section inside logs.md, so
# repeated syncs replace just that block instead of appending forever (see
# replace_runtime_log_section below).
LOG_START = "<!-- notlinear-runtime-log:start -->"
LOG_END = "<!-- notlinear-runtime-log:end -->"
# Caps on the /__notlinear_runtime_logs POST body and stored event count —
# keeps a runaway frontend logger from writing an unbounded logs.md or
# accepting an oversized request body.
MAX_BODY_BYTES = 1_500_000
MAX_EVENTS = 300


# Renders the synced runtime-log events into the markdown block that gets
# spliced into logs.md. Called only by the /__notlinear_runtime_logs POST
# handler in do_POST. Only keeps the most recent MAX_EVENTS entries — older
# events are dropped, not appended, since this replaces (not accumulates)
# the log section on every sync.
def runtime_log_block(events):
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    payload = json.dumps(events[-MAX_EVENTS:], indent=2, ensure_ascii=True)
    return (
        f"{LOG_START}\n"
        "## Latest runtime log\n\n"
        f"_Last synced: {now}_\n\n"
        f"_Event count: {len(events[-MAX_EVENTS:])}_\n\n"
        "```json\n"
        f"{payload}\n"
        "```\n"
        f"{LOG_END}"
    )


# Splices a freshly rendered runtime_log_block into the existing logs.md
# text, replacing any prior block delimited by LOG_START/LOG_END (or
# appending one if this is the first sync). Called only from the
# /__notlinear_runtime_logs POST handler.
def replace_runtime_log_section(existing, block):
    if LOG_START in existing and LOG_END in existing:
        before = existing.split(LOG_START, 1)[0].rstrip()
        after = existing.split(LOG_END, 1)[1].lstrip()
        return f"{before}\n\n{block}\n\n{after}".rstrip() + "\n"
    return existing.rstrip() + "\n\n" + block + "\n"


# ---------- Project folder scan (read-only) ----------
# Backs the /__notlinear_scan_project POST endpoint used by chat
# Projects' linked-folder context (the standalone Coding Projects view was removed). Every
# function below is read-only — it only stats/reads files under a
# user-chosen folder (picked via /__notlinear_pick_folder) — nothing here
# writes, deletes, or executes anything in the scanned project.
#
# The four convention files notlinear reads per project. Match is case-insensitive
# on the stem, with or without a .md extension.
CP_CONVENTION_STEMS = ("readme", "changelog", "bugs", "tasks")
CP_MAX_FILE_BYTES = 1_000_000   # cap per file we read into text
CP_MAX_LISTING = 500            # cap the shallow top-level listing
CP_MAX_MARKDOWN_FILES = 200     # cap recursive markdown previews
CP_MAX_CONTEXT_FILES = 300      # cap for the combined markdown+code context list
CP_SKIP_DIRS = {
    ".git", ".hg", ".svn", ".idea", ".vscode",
    "node_modules", ".venv", "venv", "__pycache__",
    "dist", "build", ".next", ".turbo", "coverage",
}
# Lock files and generated files that are not useful as context
CP_SKIP_FILES = {
    "package-lock.json", "yarn.lock", "pnpm-lock.yaml",
    "composer.lock", "gemfile.lock", "poetry.lock", "cargo.lock",
}
CP_TEXT_EXTENSIONS = {
    ".md", ".txt", ".rst",
    ".py", ".js", ".ts", ".tsx", ".jsx", ".mjs", ".cjs",
    ".go", ".rs", ".rb", ".java", ".php", ".c", ".cpp", ".h", ".cs", ".swift",
    ".sh", ".bash", ".zsh",
    ".json", ".yaml", ".yml", ".toml",
    ".sql", ".graphql",
    ".css", ".scss", ".sass", ".html", ".xml",
}


# Small stat() wrapper shared by the listing and file-slot builders below —
# mtime is converted to milliseconds to match the JS Date epoch the frontend
# expects.
def _cp_entry_meta(entry_path):
    st = os.stat(entry_path)
    return {"size": st.st_size, "mtime": int(st.st_mtime * 1000)}


# Reads one file's text content (with size metadata) into the JSON shape the
# chat Projects frontend expects for a single convention/markdown/context
# file slot. Used by scan_project (convention files), _cp_markdown_files, and
# _cp_context_files. Caps read size at CP_MAX_FILE_BYTES — oversized files are
# flagged "tooBig" rather than read in full, so one huge file can't blow up
# response size or memory. OSError (permissions, races) degrades to an
# "error" field rather than raising, keeping the scan best-effort.
def _cp_read_text_slot(file_path, filename):
    slot = {"present": True, "filename": filename}
    try:
        slot.update(_cp_entry_meta(file_path))
        if slot["size"] <= CP_MAX_FILE_BYTES:
            with open(file_path, "r", encoding="utf-8", errors="replace") as fh:
                slot["text"] = fh.read()
        else:
            slot["tooBig"] = True
            slot["text"] = ""
    except OSError as exc:
        slot["error"] = str(exc)
        slot["text"] = ""
    return slot


# Recursively collects every markdown file under `base` (for the Coding
# Projects preview list). Called by scan_project. `dirs[:] = ...` prunes
# os.walk's traversal in place (skips dotdirs and CP_SKIP_DIRS like
# node_modules/.git) so it never descends into those — both for relevance
# and to avoid pathological walk times in huge dependency trees.
def _cp_markdown_files(base):
    markdown_files = []
    truncated = False
    for root, dirs, filenames in os.walk(base):
        dirs[:] = sorted(
            d for d in dirs
            if not d.startswith(".") and d not in CP_SKIP_DIRS
        )
        for filename in sorted(filenames, key=str.lower):
            if filename.startswith(".") or not filename.lower().endswith(".md"):
                continue
            file_path = Path(root) / filename
            try:
                # resolve() follows symlinks; relative_to(base) then verifies
                # the resolved target still lives under `base`. This is the
                # guard against a symlink inside the project folder pointing
                # outside it — without it a crafted symlink could make the
                # scan read arbitrary files elsewhere on disk. ValueError
                # from relative_to (outside base) or OSError from resolve()
                # (broken link) both just skip the entry.
                resolved = file_path.resolve()
                resolved.relative_to(base)
            except (OSError, ValueError):
                continue
            rel_path = os.path.relpath(resolved, base)
            slot = _cp_read_text_slot(resolved, filename)
            slot["relativePath"] = rel_path
            markdown_files.append(slot)
            if len(markdown_files) >= CP_MAX_MARKDOWN_FILES:
                truncated = True
                return markdown_files, truncated
    return markdown_files, truncated


# Called by scan_project. Same os.walk pruning/symlink-escape guard pattern
# as _cp_markdown_files, but broader: any recognized text/code extension
# (CP_TEXT_EXTENSIONS), skipping known lockfiles (CP_SKIP_FILES) and
# minified files (".min." in the name) since those add bulk without useful
# signal for an LLM reading project context.
def _cp_context_files(base):
    """Recursively collect all readable text/code files under base for LLM context injection."""
    context_files = []
    truncated = False
    for root, dirs, filenames in os.walk(base):
        dirs[:] = sorted(
            d for d in dirs
            if not d.startswith(".") and d not in CP_SKIP_DIRS
        )
        for filename in sorted(filenames, key=str.lower):
            if filename.startswith("."):
                continue
            if filename.lower() in CP_SKIP_FILES:
                continue
            if ".min." in filename.lower():
                continue
            ext = os.path.splitext(filename)[1].lower()
            if ext not in CP_TEXT_EXTENSIONS:
                continue
            file_path = Path(root) / filename
            try:
                # Same symlink-escape guard as _cp_markdown_files above:
                # resolve() then relative_to(base) rejects anything that
                # resolves outside the scanned project folder.
                resolved = file_path.resolve()
                resolved.relative_to(base)
            except (OSError, ValueError):
                continue
            rel_path = os.path.relpath(resolved, base)
            slot = _cp_read_text_slot(resolved, filename)
            slot["relativePath"] = rel_path
            context_files.append(slot)
            if len(context_files) >= CP_MAX_CONTEXT_FILES:
                truncated = True
                return context_files, truncated
    return context_files, truncated


# Called only by the /__notlinear_scan_project POST handler in do_POST,
# which is triggered from chat Projects after a folder is chosen
# (via /__notlinear_pick_folder, which itself shells out to osascript).
def scan_project(folder_path):
    """Read-only scan of a single project folder.

    Returns the display name, a shallow (non-recursive) listing of the folder's
    top-level entries, the parsed text + metadata of the four convention files,
    capped markdown previews for project folders, and a combined
    markdown+code file list (contextFiles) for LLM folder context injection.
    Reads are confined to `folder_path`.
    """
    base = Path(folder_path).expanduser().resolve()
    if not base.exists() or not base.is_dir():
        return {"ok": False, "error": "not a directory: %s" % folder_path}

    listing = []
    files = {stem: {"present": False} for stem in CP_CONVENTION_STEMS}

    with os.scandir(base) as it:
        entries = sorted(it, key=lambda e: e.name.lower())
    for entry in entries:
        if entry.name.startswith("."):
            continue
        if len(listing) < CP_MAX_LISTING:
            try:
                meta = _cp_entry_meta(entry.path)
            except OSError:
                meta = {"size": 0, "mtime": 0}
            listing.append({
                "name": entry.name,
                "isDir": entry.is_dir(),
                "size": meta["size"],
                "mtime": meta["mtime"],
            })
        if not entry.is_file():
            continue
        stem = entry.name.lower()
        if stem.endswith(".md"):
            stem = stem[:-3]
        if stem in CP_CONVENTION_STEMS and not files[stem]["present"]:
            files[stem] = _cp_read_text_slot(entry.path, entry.name)

    markdown_files, markdown_files_truncated = _cp_markdown_files(base)
    context_files, context_files_truncated = _cp_context_files(base)

    return {
        "ok": True,
        "name": base.name,
        "path": str(base),
        "listing": listing,
        "files": files,
        "markdownFiles": markdown_files,
        "markdownFilesTruncated": markdown_files_truncated,
        "contextFiles": context_files,
        "contextFilesTruncated": context_files_truncated,
    }


# ---------- Notes link preview (read-only outbound fetch — see ADR-023) ----------
# Backs the /__notlinear_link_preview POST endpoint used by the Notes view
# (frontend/views/notes.js) when a link block is inserted — the browser
# can't fetch arbitrary third-party URLs itself due to CORS, so this server
# fetches server-side instead and hands back a small parsed preview.
LINK_PREVIEW_TIMEOUT_S = 6   # give up fast rather than hang a request on a slow/unresponsive site
LINK_PREVIEW_MAX_BYTES = 512_000  # only need the <head>; avoids downloading huge pages in full


class _LinkPreviewParser(HTMLParser):
    """Pulls <title>, a description meta tag, and a favicon link out of an
    HTML head. Best-effort — any single missing tag just leaves that field
    blank rather than failing the whole parse."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.title = ""
        self.description = ""
        self.favicon = ""
        self._in_title = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "title":
            self._in_title = True
        elif tag == "meta":
            name = (attrs.get("name") or attrs.get("property") or "").lower()
            if name in ("description", "og:description") and not self.description:
                self.description = (attrs.get("content") or "").strip()
        elif tag == "link":
            rel = (attrs.get("rel") or "").lower()
            if "icon" in rel and not self.favicon:
                self.favicon = (attrs.get("href") or "").strip()

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False

    def handle_data(self, data):
        if self._in_title and not self.title:
            self.title = data.strip()


# Called only by the /__notlinear_link_preview POST handler in do_POST.
def link_preview(url):
    """Fetch `url` server-side (the frontend can't CORS-fetch arbitrary
    sites) and return a small preview: title/description/favicon/domain.
    Read-only, best-effort — any failure degrades to {"ok": False}, never
    raises. Trust boundary: this server is local-first/single-user (see
    ADR-023) — only the URL scheme is validated, no private-IP blocking.
    """
    parsed = urlparse(url)
    # Only allow http(s) — blocks file://, javascript:, etc. from being
    # handed to urlopen. This is the only input validation; per ADR-023 this
    # server assumes a trusted single local user, so there is deliberately
    # no SSRF/private-IP-range blocking here (a malicious note link could
    # still make this server hit an internal address).
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return {"ok": False, "error": "url must be http(s)"}

    try:
        req = urllib.request.Request(url, headers={"User-Agent": "notlinear-link-preview/1"})
        with urllib.request.urlopen(req, timeout=LINK_PREVIEW_TIMEOUT_S) as resp:
            raw = resp.read(LINK_PREVIEW_MAX_BYTES)
            charset = resp.headers.get_content_charset() or "utf-8"
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, ValueError) as exc:
        return {"ok": False, "error": str(exc)}

    try:
        html = raw.decode(charset, errors="replace")
    except LookupError:
        html = raw.decode("utf-8", errors="replace")

    p = _LinkPreviewParser()
    try:
        p.feed(html)
    except Exception:
        pass  # best-effort — return whatever was parsed before the error

    # Parsed <link rel="icon"> hrefs are often root- or page-relative
    # ("/favicon.png", "favicon.png") rather than absolute — resolve those
    # against the page's own scheme+host so the frontend gets a directly
    # loadable URL. data: URIs and already-absolute URLs pass through as-is.
    favicon = p.favicon
    if favicon and not favicon.startswith(("http://", "https://", "data:")):
        favicon = f"{parsed.scheme}://{parsed.netloc}" + (favicon if favicon.startswith("/") else f"/{favicon}")
    elif not favicon:
        favicon = f"{parsed.scheme}://{parsed.netloc}/favicon.ico"

    return {
        "ok": True,
        "title": p.title or parsed.netloc,
        "description": p.description,
        "domain": parsed.netloc,
        "favicon": favicon,
    }


# Scans feedback/FEEDBACK.md for the highest existing "## FB-NNN" heading
# and returns the next sequential id. Called by _feedback_append_entry.
# Regex matches only headings anchored at line-start (re.M) so it can't
# false-match an "FB-###" mentioned in body text.
def _feedback_next_id():
    if not FEEDBACK_PATH.exists():
        return 1
    ids = re.findall(r"^## FB-(\d+)", FEEDBACK_PATH.read_text(encoding="utf-8"), flags=re.M)
    return max((int(i) for i in ids), default=0) + 1


# Builds a unique destination path under feedback/media/ for a screenshot
# ("shot") or recording ("rec"), timestamped to the second. Called by the
# /__notlinear_feedback_shot and /__notlinear_feedback_record handlers. The
# while-loop suffixes "-1", "-2", ... on collision (e.g. two screenshots
# taken within the same second) so a fast double-capture never overwrites
# the first file.
def _feedback_media_path(kind, ext):
    FEEDBACK_MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    path = FEEDBACK_MEDIA_DIR / f"{stamp}_{kind}.{ext}"
    n = 1
    while path.exists():
        path = FEEDBACK_MEDIA_DIR / f"{stamp}_{kind}-{n}.{ext}"
        n += 1
    return path


# Formats one feedback submission (bug/idea, text, optional media refs,
# view/thread context) as a markdown "## FB-NNN" section and appends it to
# feedback/FEEDBACK.md, creating the file/dir if needed. Called only by the
# /__notlinear_feedback_save POST handler.
def _feedback_append_entry(data):
    kind = "Bug" if data.get("type") == "bug" else "Idea"
    text = (data.get("text") or "").strip()
    media = [m for m in data.get("media") or [] if isinstance(m, str)]
    ctx = data.get("context") or {}
    fb_id = f"FB-{_feedback_next_id():03d}"
    stamp = datetime.now().strftime("%Y-%m-%d %H:%M")
    lines = [f"## {fb_id} · {kind} · {stamp} · status: open"]
    view = ctx.get("view") or "?"
    thread = ctx.get("thread")
    lines.append(f"- View: {view}" + (f", thread `{thread}`" if thread else ""))
    for m in media:
        lines.append(f"- Media: {m}")
    lines.append("")
    lines.append(text or "(no description)")
    lines.append("")
    FEEDBACK_DIR.mkdir(parents=True, exist_ok=True)
    existing = FEEDBACK_PATH.read_text(encoding="utf-8") if FEEDBACK_PATH.exists() else "# Feedback log\n"
    FEEDBACK_PATH.write_text(existing.rstrip("\n") + "\n\n" + "\n".join(lines), encoding="utf-8")
    return fb_id


# Called by the /__notlinear_feedback_upload and /__notlinear_feedback_discard
# handlers, both of which take a client-supplied relative path string.
def _media_file_from_rel(rel):
    """Resolve a repo-relative path and require it to live inside feedback/media/."""
    p = (REPO_ROOT / (rel or "")).resolve()
    FEEDBACK_MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    # Security check: resolve() collapses any ".." segments, then this
    # prefix check confirms the resolved path still lands inside
    # feedback/media/. Without it, a crafted `rel` like "../../etc/passwd"
    # could let a client read/write/delete arbitrary files on disk via these
    # two endpoints — this is the only thing standing between "client sends
    # a path string" and "server touches that path".
    if not str(p).startswith(str(FEEDBACK_MEDIA_DIR.resolve()) + os.sep):
        raise ValueError("path outside feedback media dir")
    return p


# Parses feedback/FEEDBACK.md back into structured entries for the
# /__notlinear_feedback_list endpoint (drives the in-app feedback list in
# Settings). Splitting on "^## " assumes _feedback_append_entry's own output
# format — the two functions must stay in sync.
def _feedback_parse_entries():
    if not FEEDBACK_PATH.exists():
        return []
    entries = []
    for block in re.split(r"^## ", FEEDBACK_PATH.read_text(encoding="utf-8"), flags=re.M)[1:]:
        lines = block.splitlines()
        m = re.match(r"(FB-\d+) · (\w+) · (.+?) · status: (\S+)", lines[0])
        if not m:
            continue
        entry = {"id": m[1], "type": m[2].lower(), "date": m[3], "status": m[4],
                 "view": "", "thread": "", "media": [], "text": ""}
        body = []
        for ln in lines[1:]:
            if ln.startswith("- View: "):
                vm = re.match(r"([^,]+)(?:, thread `(.*)`)?$", ln[len("- View: "):])
                if vm:
                    entry["view"], entry["thread"] = vm[1].strip(), (vm[2] or "")
            elif ln.startswith("- Media: "):
                entry["media"].append(ln[len("- Media: "):].strip())
            else:
                body.append(ln)
        entry["text"] = "\n".join(body).strip()
        entries.append(entry)
    entries.reverse()  # newest first for the settings list
    return entries


# Request handler for ThreadingHTTPServer (see main()). Extends the stdlib
# SimpleHTTPRequestHandler, which already implements do_GET/do_HEAD for
# static file serving out of `directory=REPO_ROOT` — this class only adds
# the no-cache header behavior and the POST endpoint routing below. Every
# `/__notlinear_*` path is additive-only per AGENTS.md: existing endpoints
# must not be renamed or have their request/response shape changed.
class NotlinearHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # No build step and no versioned asset URLs (see CLAUDE.md) — always
        # revalidate so edited frontend files show up without guessing which
        # cache (browser, WKWebView) is holding a stale copy.
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

    # Small helper used by nearly every /__notlinear_* handler below to send
    # a JSON response with the right headers. CORS header is permissive
    # (Access-Control-Allow-Origin: *) since this server only ever binds to
    # 127.0.0.1 for a single local user — see the trust-boundary note on
    # link_preview above for the same reasoning applied elsewhere.
    def _json(self, code, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    # Handles CORS preflight requests the browser sends before a POST with a
    # JSON content-type to any /__notlinear_* endpoint.
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    # Routes every POST request. Triggered on any HTTP POST to this server;
    # each `if path == "/__notlinear_..."` block below is one endpoint,
    # matched by exact path (query string stripped first). Falls through to
    # the /__notlinear_runtime_logs handler at the bottom, then 404s for
    # anything else. Per AGENTS.md, only frontend/core/api-client.js should
    # be calling these paths, and none of them may be renamed — add new
    # endpoints as new `if` blocks instead of touching existing ones.
    def do_POST(self):
        path = self.path.split("?", 1)[0]

        # POST /__notlinear_pick_folder — shows a native
        # macOS folder-picker dialog and returns the chosen POSIX path (or
        # {"cancelled": true} if the user dismissed it). macOS-only: relies
        # on `osascript` running an inline AppleScript one-liner; there is
        # no cross-platform fallback. The browser has no API for a native
        # folder picker with a filesystem path, hence shelling out.
        if path == "/__notlinear_pick_folder":
            try:
                script = 'POSIX path of (choose folder with prompt "Select a coding project folder")'
                result = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=120)
                if result.returncode != 0:
                    self._json(200, {"ok": False, "cancelled": True})
                    return
                self._json(200, {"ok": True, "path": result.stdout.strip()})
            except Exception as exc:
                self._json(500, {"ok": False, "error": str(exc)})
            return

        # POST /__notlinear_scan_project — given a folder
        # path (normally chosen via /__notlinear_pick_folder), runs the
        # read-only scan_project() above and returns its JSON result
        # directly. Body: {"path": "<folder>"}.
        if path == "/__notlinear_scan_project":
            try:
                length = int(self.headers.get("content-length", "0"))
                body = self.rfile.read(length) if length else b"{}"
                data = json.loads(body.decode("utf-8"))
                folder_path = (data.get("path") or "").strip()
                if not folder_path:
                    self._json(400, {"ok": False, "error": "path required"})
                    return
                self._json(200, scan_project(folder_path))
            except Exception as exc:
                self._json(500, {"ok": False, "error": str(exc)})
            return

        # POST /__notlinear_link_preview — Notes: given {"url": "..."},
        # fetches it server-side and returns a parsed title/description/
        # favicon/domain preview (see link_preview() above for the trust-
        # boundary caveat: no SSRF protection, by design, for this
        # local-first single-user server).
        if path == "/__notlinear_link_preview":
            try:
                length = int(self.headers.get("content-length", "0"))
                body = self.rfile.read(length) if length else b"{}"
                data = json.loads(body.decode("utf-8"))
                url = (data.get("url") or "").strip()
                if not url:
                    self._json(400, {"ok": False, "error": "url required"})
                    return
                self._json(200, link_preview(url))
            except Exception as exc:
                self._json(500, {"ok": False, "error": str(exc)})
            return

        # POST /__notlinear_open_files — chat file/folder attachment: shows a
        # native macOS Open dialog (file or folder mode per {"folder": bool})
        # via osascript, reads the chosen file(s) off disk, and returns each
        # as base64 + mime type for the frontend to attach to a chat message.
        # macOS-only (osascript). Oversized files are flagged "tooBig"
        # instead of read, so a huge attachment can't balloon the response.
        if path == "/__notlinear_open_files":
            try:
                length = int(self.headers.get("content-length", "0"))
                body = self.rfile.read(length) if length else b"{}"
                data = json.loads(body.decode("utf-8"))
                is_folder = data.get("folder", False)

                MAX_FILE_BYTES = 20 * 1024 * 1024  # 20 MB per file

                # Reads one picked file into the {name, type, size, base64}
                # shape the frontend expects; shared by both the folder and
                # single-file branches below.
                def file_entry(filepath, display_name):
                    size = os.path.getsize(filepath)
                    mime = mimetypes.guess_type(filepath)[0] or "application/octet-stream"
                    if size > MAX_FILE_BYTES:
                        return {"name": display_name, "type": mime, "size": size, "tooBig": True}
                    with open(filepath, "rb") as fh:
                        b64 = base64.b64encode(fh.read()).decode("ascii")
                    return {"name": display_name, "type": mime, "size": size, "base64": b64}

                if is_folder:
                    script = 'POSIX path of (choose folder with prompt "Select folder to attach")'
                    result = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=120)
                    if result.returncode != 0:
                        self._json(200, {"ok": False, "cancelled": True})
                        return
                    folder_path = result.stdout.strip()
                    files = []
                    for root, dirs, filenames in os.walk(folder_path):
                        dirs[:] = sorted(d for d in dirs if not d.startswith("."))
                        for filename in sorted(filenames):
                            if filename.startswith("."):
                                continue
                            filepath = os.path.join(root, filename)
                            # relpath against the folder's *parent* (not the
                            # folder itself) so rel_name keeps the chosen
                            # folder's own name as its first path segment —
                            # gives the frontend an attachment name like
                            # "myfolder/sub/file.js" instead of "sub/file.js".
                            rel_name = os.path.relpath(filepath, os.path.dirname(folder_path))
                            try:
                                files.append(file_entry(filepath, rel_name))
                            except OSError:
                                pass
                    self._json(200, {"ok": True, "files": files})
                else:
                    # Multi-line AppleScript (vs. the one-liners elsewhere)
                    # because it needs a loop: `choose file` with multiple
                    # selections returns a list, and AppleScript has no
                    # built-in "join with newline" — this builds the
                    # newline-delimited path string by hand, which the
                    # result.stdout.split("\n") below then parses back apart.
                    script = (
                        "set selectedFiles to choose file "
                        "with prompt \"Select files to attach\" "
                        "with multiple selections allowed\n"
                        "set thePaths to \"\"\n"
                        "repeat with aFile in selectedFiles\n"
                        "  set thePaths to thePaths & POSIX path of aFile & linefeed\n"
                        "end repeat\n"
                        "return thePaths"
                    )
                    result = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=120)
                    if result.returncode != 0:
                        self._json(200, {"ok": False, "cancelled": True})
                        return
                    paths = [p.strip() for p in result.stdout.split("\n") if p.strip()]
                    files = []
                    for p in paths:
                        try:
                            files.append(file_entry(p, os.path.basename(p)))
                        except OSError:
                            pass
                    self._json(200, {"ok": True, "files": files})
            except Exception as exc:
                self._json(500, {"ok": False, "error": str(exc)})
            return

        # POST /__notlinear_save_file — "export chat/response as markdown":
        # shows a native macOS Save dialog pre-filled with {"filename"},
        # then writes {"content"} to wherever the user picked. macOS-only
        # (osascript). Note the filename is interpolated directly into the
        # AppleScript string below — acceptable only because this server is
        # local-only and the value originates from this app's own frontend,
        # not an untrusted network caller.
        if path == "/__notlinear_save_file":
            try:
                length = int(self.headers.get("content-length", "0"))
                body = self.rfile.read(length)
                data = json.loads(body.decode("utf-8"))
                filename = data.get("filename", "response.md")
                content = data.get("content", "")
                # Use osascript to show native Save dialog
                script = f'POSIX path of (choose file name with prompt "Save Markdown file" default name "{filename}")'
                result = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=120)
                if result.returncode != 0:
                    # User cancelled
                    self._json(200, {"ok": False, "cancelled": True})
                    return
                save_path = result.stdout.strip()
                if not save_path.endswith(".md"):
                    save_path += ".md"
                Path(save_path).write_text(content, encoding="utf-8")
                self._json(200, {"ok": True, "path": save_path})
            except Exception as exc:
                self._json(500, {"ok": False, "error": str(exc)})
            return

        # POST /__notlinear_feedback_shot — feedback capture: takes a
        # one-shot screenshot via the macOS `screencapture` CLI (mode "full"
        # or interactive "area" selection) and saves it under
        # feedback/media/, returning its repo-relative path for later
        # attaching via /__notlinear_feedback_save. macOS-only.
        if path == "/__notlinear_feedback_shot":
            try:
                length = int(self.headers.get("content-length", "0"))
                body = self.rfile.read(length) if length else b"{}"
                mode = (json.loads(body.decode("utf-8")).get("mode") or "full").strip()
                shot_path = _feedback_media_path("shot", "png")
                cmd = ["screencapture", "-x", "-t", "png", str(shot_path)]  # -x: no camera shutter sound
                if mode == "area":
                    cmd.insert(1, "-i")  # interactive selection; Escape cancels
                result = subprocess.run(cmd, capture_output=True, text=True,
                                        timeout=240 if mode == "area" else 30)
                if not shot_path.exists():
                    if mode == "area":
                        self._json(200, {"ok": False, "cancelled": True})
                    else:
                        err = result.stderr.strip() or "screencapture failed — check Screen Recording permission in System Settings"
                        self._json(500, {"ok": False, "error": err})
                    return
                self._json(200, {"ok": True, "path": str(shot_path.relative_to(REPO_ROOT))})
            except Exception as exc:
                self._json(500, {"ok": False, "error": str(exc)})
            return

        # POST /__notlinear_feedback_record — feedback capture: start/stop a
        # screen recording. {"action": "start"} launches a background
        # `screencapture -v` subprocess (non-blocking, tracked in the
        # module-level `_recording` dict guarded by `_recording_lock` since
        # start/stop can arrive on different request threads);
        # {"action": "stop"} sends SIGINT to end the capture cleanly (the
        # only way to stop `screencapture -v` short of killing it) and waits
        # for the file to finish writing. macOS-only.
        if path == "/__notlinear_feedback_record":
            try:
                length = int(self.headers.get("content-length", "0"))
                body = self.rfile.read(length) if length else b"{}"
                data = json.loads(body.decode("utf-8"))
                action = (data.get("action") or "").strip()
                with _recording_lock:
                    if action == "start":
                        if _recording["proc"] and _recording["proc"].poll() is None:
                            self._json(409, {"ok": False, "error": "already recording"})
                            return
                        rec_path = _feedback_media_path("rec", "mov")
                        cmd = ["screencapture", "-v", "-x", str(rec_path)]
                        if (data.get("mode") or "full") == "area":
                            cmd.insert(1, "-i")  # select area first, then recording starts
                        proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                        _recording["proc"], _recording["path"] = proc, rec_path
                        self._json(200, {"ok": True, "recording": True})
                    elif action == "stop":
                        proc, rec_path = _recording["proc"], _recording["path"]
                        _recording["proc"], _recording["path"] = None, None
                        if not proc or proc.poll() is not None:
                            # area mode: Escape during selection ends the process with no file
                            if rec_path and not rec_path.exists():
                                self._json(200, {"ok": False, "cancelled": True})
                                return
                            self._json(409, {"ok": False, "error": "not recording"})
                            return
                        proc.send_signal(signal.SIGINT)
                        proc.wait(timeout=15)
                        if not rec_path.exists():
                            self._json(200, {"ok": False, "cancelled": True,
                                             "error": "no recording captured — selection cancelled or Screen Recording permission missing"})
                            return
                        self._json(200, {"ok": True, "path": str(rec_path.relative_to(REPO_ROOT))})
                    else:
                        self._json(400, {"ok": False, "error": "action must be start or stop"})
            except Exception as exc:
                self._json(500, {"ok": False, "error": str(exc)})
            return

        # POST /__notlinear_feedback_upload — feedback capture: saves a
        # base64-encoded media blob (e.g. a pasted image) to a client-chosen
        # relative path under feedback/media/. `_media_file_from_rel`
        # enforces that the path can't escape that directory (see its
        # comment above) — this is the endpoint that guard exists for.
        if path == "/__notlinear_feedback_upload":
            try:
                length = int(self.headers.get("content-length", "0"))
                data = json.loads(self.rfile.read(length).decode("utf-8"))
                target = _media_file_from_rel(data.get("path"))
                target.write_bytes(base64.b64decode(data.get("base64") or ""))
                self._json(200, {"ok": True, "path": str(target.relative_to(REPO_ROOT))})
            except Exception as exc:
                self._json(500, {"ok": False, "error": str(exc)})
            return

        # POST /__notlinear_feedback_discard — feedback capture: deletes a
        # previously captured/uploaded media file (e.g. user cancels before
        # submitting feedback) at a client-given relative path, again
        # confined to feedback/media/ via `_media_file_from_rel`.
        if path == "/__notlinear_feedback_discard":
            try:
                length = int(self.headers.get("content-length", "0"))
                data = json.loads(self.rfile.read(length).decode("utf-8"))
                target = _media_file_from_rel(data.get("path"))
                if target.exists():
                    target.unlink()
                self._json(200, {"ok": True})
            except Exception as exc:
                self._json(500, {"ok": False, "error": str(exc)})
            return

        # POST /__notlinear_feedback_list — feedback capture: returns all
        # entries currently in feedback/FEEDBACK.md (parsed by
        # _feedback_parse_entries), used to populate the in-app feedback
        # list in Settings. (POST rather than GET only for consistency with
        # the other /__notlinear_* endpoints; it takes no body.)
        if path == "/__notlinear_feedback_list":
            try:
                self._json(200, {"ok": True, "entries": _feedback_parse_entries()})
            except Exception as exc:
                self._json(500, {"ok": False, "error": str(exc)})
            return

        # POST /__notlinear_feedback_save — feedback capture: final submit
        # step. Appends a new "## FB-NNN" entry (via _feedback_append_entry)
        # to feedback/FEEDBACK.md with the bug/idea text, any attached media
        # paths (already uploaded via /__notlinear_feedback_upload), and
        # view/thread context.
        if path == "/__notlinear_feedback_save":
            try:
                length = int(self.headers.get("content-length", "0"))
                body = self.rfile.read(length) if length else b"{}"
                data = json.loads(body.decode("utf-8"))
                fb_id = _feedback_append_entry(data)
                self._json(200, {"ok": True, "id": fb_id, "path": str(FEEDBACK_PATH.relative_to(REPO_ROOT))})
            except Exception as exc:
                self._json(500, {"ok": False, "error": str(exc)})
            return

        # Fallthrough: everything above was a distinct endpoint with its own
        # `if`/`return`, so reaching here means the path is either
        # /__notlinear_runtime_logs (handled below) or unknown (404).
        #
        # POST /__notlinear_runtime_logs — the frontend's runtime logger
        # periodically syncs its in-memory event buffer here so it survives
        # a reload; this writes the events into the marked section of
        # logs.md (see LOG_START/LOG_END, runtime_log_block,
        # replace_runtime_log_section above). Security: the frontend logger
        # already redacts auth headers/API keys before sending — this
        # handler just persists whatever JSON it's given and must not be
        # changed to add any additional logging of the raw request.
        if path != "/__notlinear_runtime_logs":
            self.send_error(404)
            return

        try:
            length = int(self.headers.get("content-length", "0"))
        except ValueError:
            self.send_error(400, "Invalid content length")
            return
        if length > MAX_BODY_BYTES:
            self.send_error(413, "Runtime log payload too large")
            return

        try:
            body = self.rfile.read(length)
            data = json.loads(body.decode("utf-8") or "{}")
            events = data.get("events", [])
            if not isinstance(events, list):
                raise ValueError("events must be a list")
            block = runtime_log_block(events)
            existing = LOGS_PATH.read_text(encoding="utf-8") if LOGS_PATH.exists() else "# Runtime logs\n"
            LOGS_PATH.write_text(replace_runtime_log_section(existing, block), encoding="utf-8")
        except Exception as exc:
            self.send_error(400, f"Could not write runtime logs: {exc}")
            return

        response = json.dumps({"ok": True, "events": min(len(events), MAX_EVENTS)}).encode("utf-8")
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(response)))
        self.end_headers()
        self.wfile.write(response)


# Entry point — invoked directly (`python3 backend/server.py`) or by the
# Notlinear.app wrapper. Defaults bind to 127.0.0.1:8765, matching the
# hardcoded local-only URL described in AGENTS.md/README.md. `directory`
# passed to NotlinearHandler is REPO_ROOT, not APP_DIR — this is what makes
# both `/frontend/*` static assets and root docs like `logs.md`/`CHANGELOG.md`
# resolve relative to the repo root rather than to backend/.
def main():
    parser = argparse.ArgumentParser(description="Serve Notlinear and accept local runtime log syncs.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=8765, type=int)
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.host, args.port), lambda *a, **kw: NotlinearHandler(*a, directory=str(REPO_ROOT), **kw))
    print(f"Serving Notlinear on http://{args.host}:{args.port}/frontend/index.html")
    server.serve_forever()


if __name__ == "__main__":
    main()
