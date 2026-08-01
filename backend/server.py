#!/usr/bin/env python3
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


APP_DIR = Path(__file__).resolve().parent
REPO_ROOT = APP_DIR.parent
LOGS_PATH = REPO_ROOT / "logs.md"
FEEDBACK_DIR = REPO_ROOT / "feedback"
FEEDBACK_MEDIA_DIR = FEEDBACK_DIR / "media"
FEEDBACK_PATH = FEEDBACK_DIR / "FEEDBACK.md"

# One screen recording at a time; handlers run on server threads, so guard with a lock.
_recording_lock = threading.Lock()
_recording = {"proc": None, "path": None}
LOG_START = "<!-- notlinear-runtime-log:start -->"
LOG_END = "<!-- notlinear-runtime-log:end -->"
MAX_BODY_BYTES = 1_500_000
MAX_EVENTS = 300


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


def replace_runtime_log_section(existing, block):
    if LOG_START in existing and LOG_END in existing:
        before = existing.split(LOG_START, 1)[0].rstrip()
        after = existing.split(LOG_END, 1)[1].lstrip()
        return f"{before}\n\n{block}\n\n{after}".rstrip() + "\n"
    return existing.rstrip() + "\n\n" + block + "\n"


# ---------- Coding Projects scan (read-only) ----------
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


def _cp_entry_meta(entry_path):
    st = os.stat(entry_path)
    return {"size": st.st_size, "mtime": int(st.st_mtime * 1000)}


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


def scan_project(folder_path):
    """Read-only scan of a single project folder.

    Returns the display name, a shallow (non-recursive) listing of the folder's
    top-level entries, the parsed text + metadata of the four convention files,
    capped markdown previews for the Coding Projects view, and a combined
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
LINK_PREVIEW_TIMEOUT_S = 6
LINK_PREVIEW_MAX_BYTES = 512_000


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


def link_preview(url):
    """Fetch `url` server-side (the frontend can't CORS-fetch arbitrary
    sites) and return a small preview: title/description/favicon/domain.
    Read-only, best-effort — any failure degrades to {"ok": False}, never
    raises. Trust boundary: this server is local-first/single-user (see
    ADR-023) — only the URL scheme is validated, no private-IP blocking.
    """
    parsed = urlparse(url)
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


def _feedback_next_id():
    if not FEEDBACK_PATH.exists():
        return 1
    ids = re.findall(r"^## FB-(\d+)", FEEDBACK_PATH.read_text(encoding="utf-8"), flags=re.M)
    return max((int(i) for i in ids), default=0) + 1


def _feedback_media_path(kind, ext):
    FEEDBACK_MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y-%m-%d_%H%M%S")
    path = FEEDBACK_MEDIA_DIR / f"{stamp}_{kind}.{ext}"
    n = 1
    while path.exists():
        path = FEEDBACK_MEDIA_DIR / f"{stamp}_{kind}-{n}.{ext}"
        n += 1
    return path


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


def _media_file_from_rel(rel):
    """Resolve a repo-relative path and require it to live inside feedback/media/."""
    p = (REPO_ROOT / (rel or "")).resolve()
    FEEDBACK_MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    if not str(p).startswith(str(FEEDBACK_MEDIA_DIR.resolve()) + os.sep):
        raise ValueError("path outside feedback media dir")
    return p


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


class NotlinearHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # No build step and no versioned asset URLs (see CLAUDE.md) — always
        # revalidate so edited frontend files show up without guessing which
        # cache (browser, WKWebView) is holding a stale copy.
        self.send_header("Cache-Control", "no-store, must-revalidate")
        super().end_headers()

    def _json(self, code, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self):
        path = self.path.split("?", 1)[0]

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

        if path == "/__notlinear_open_files":
            try:
                length = int(self.headers.get("content-length", "0"))
                body = self.rfile.read(length) if length else b"{}"
                data = json.loads(body.decode("utf-8"))
                is_folder = data.get("folder", False)

                MAX_FILE_BYTES = 20 * 1024 * 1024  # 20 MB per file

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
                            rel_name = os.path.relpath(filepath, os.path.dirname(folder_path))
                            try:
                                files.append(file_entry(filepath, rel_name))
                            except OSError:
                                pass
                    self._json(200, {"ok": True, "files": files})
                else:
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

        if path == "/__notlinear_feedback_shot":
            try:
                length = int(self.headers.get("content-length", "0"))
                body = self.rfile.read(length) if length else b"{}"
                mode = (json.loads(body.decode("utf-8")).get("mode") or "full").strip()
                shot_path = _feedback_media_path("shot", "png")
                cmd = ["screencapture", "-x", "-t", "png", str(shot_path)]
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

        if path == "/__notlinear_feedback_list":
            try:
                self._json(200, {"ok": True, "entries": _feedback_parse_entries()})
            except Exception as exc:
                self._json(500, {"ok": False, "error": str(exc)})
            return

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
