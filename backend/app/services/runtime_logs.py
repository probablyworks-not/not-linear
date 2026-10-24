"""Runtime-log formatting and the logs.md splice.

Moved verbatim from backend/server.py as part of P2. No logic changes: the
contract tests in tests/contract pin this behaviour and must pass unchanged
against both servers.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from ..config import LOG_END, LOG_START, LOGS_PATH, MAX_BODY_BYTES, MAX_EVENTS
import json


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
