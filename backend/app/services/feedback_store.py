"""Feedback entry storage and media paths.

Moved verbatim from backend/server.py as part of P2. No logic changes.
_media_file_from_rel keeps its path-traversal guard exactly as written; it is
the only thing between a client-supplied path string and the server touching
that file, and tests/contract covers it.
"""

from __future__ import annotations

import os
import re
from datetime import datetime
from pathlib import Path
from ..config import FEEDBACK_DIR, FEEDBACK_MEDIA_DIR, FEEDBACK_PATH, REPO_ROOT

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
