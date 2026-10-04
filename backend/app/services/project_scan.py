"""Project folder scanning.

Moved verbatim from backend/server.py as part of P2. No logic changes.
"""

from __future__ import annotations

import os
import re
from datetime import datetime, timezone
from pathlib import Path
from ..config import REPO_ROOT

# Scan caps and skip lists, copied verbatim from backend/server.py:134-159.
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


