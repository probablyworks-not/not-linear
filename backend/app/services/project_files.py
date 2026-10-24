"""Live, on-demand reads of a project's linked folder, for the model's file tools.

``project_scan`` snapshots a whole folder in one response. These two functions are the
other half: list one directory, or read one window of one file, straight from disk at
call time, so the model sees edits the moment they are saved.

The caller supplies the folder root (already approved by ``consent``) and a path
*relative* to it. Every path is resolved and must stay inside the root, which closes
``../`` and symlink escapes. Secrets are refused by name rather than hidden, so the
model is told why instead of guessing at paths.
"""

from __future__ import annotations

import fnmatch
import os
from pathlib import Path
from typing import Any

from .project_scan import CP_MAX_FILE_BYTES, CP_MAX_LISTING, CP_SKIP_DIRS

READ_WINDOW_CHARS = 4000
SECRET_MESSAGE = "blocked: looks like a secrets file"
# Matched case-insensitively against a single path component.
SECRET_PATTERNS = (".env", ".env.*", "*.pem", "*.key", "*.p12", "*.pfx", "id_rsa*", "id_ed25519*", ".netrc", ".npmrc")


def is_secret_name(name: str) -> bool:
    lowered = name.lower()
    return any(fnmatch.fnmatch(lowered, pattern) for pattern in SECRET_PATTERNS)


def _hidden_dir(name: str) -> bool:
    return name in CP_SKIP_DIRS or name == ".git"


def _resolve_inside(root: str | Path, rel: str) -> tuple[Path, Path] | dict[str, Any]:
    """The resolved (root, target) pair, or an ``{"ok": False, ...}`` refusal."""
    base = Path(root).expanduser().resolve()
    if not base.is_dir():
        return {"ok": False, "error": "linked folder not found: %s" % root}
    rel = (rel or "").strip().lstrip("/")
    target = (base / rel).resolve() if rel else base
    try:
        parts = target.relative_to(base).parts
    except ValueError:
        return {"ok": False, "error": "path is outside the linked folder"}
    for part in parts:
        if _hidden_dir(part):
            return {"ok": False, "error": "blocked: %s is not browsable" % part}
        if is_secret_name(part):
            return {"ok": False, "error": SECRET_MESSAGE}
    return base, target


def list_dir(root: str | Path, sub: str = "") -> dict[str, Any]:
    """One level of ``sub`` inside ``root``: directories first, secrets and skip dirs left out."""
    resolved = _resolve_inside(root, sub)
    if isinstance(resolved, dict):
        return resolved
    base, target = resolved
    if not target.is_dir():
        return {"ok": False, "error": "not a directory: %s" % (sub or ".")}
    entries: list[dict[str, Any]] = []
    truncated = False
    try:
        with os.scandir(target) as it:
            found = sorted(it, key=lambda e: (not e.is_dir(follow_symlinks=False), e.name.lower()))
    except OSError as exc:
        return {"ok": False, "error": "cannot read directory: %s" % exc.strerror}
    for entry in found:
        if _hidden_dir(entry.name) or is_secret_name(entry.name):
            continue
        # A symlink that leaves the root is skipped, not followed.
        try:
            Path(entry.path).resolve().relative_to(base)
        except (ValueError, OSError):
            continue
        if len(entries) >= CP_MAX_LISTING:
            truncated = True
            break
        is_dir = entry.is_dir()
        item: dict[str, Any] = {"name": entry.name, "type": "dir" if is_dir else "file"}
        if not is_dir:
            try:
                item["size"] = entry.stat().st_size
            except OSError:
                pass
        entries.append(item)
    rel = str(target.relative_to(base)) if target != base else ""
    return {"ok": True, "path": "" if rel == "." else rel, "entries": entries, "truncated": truncated}


def read_file(root: str | Path, rel: str, offset: int = 0, query: str = "") -> dict[str, Any]:
    """A window of one text file. ``query`` centres the window on its first match."""
    resolved = _resolve_inside(root, rel)
    if isinstance(resolved, dict):
        return resolved
    base, target = resolved
    if not target.is_file():
        return {"ok": False, "error": "not a file: %s" % rel}
    try:
        size = target.stat().st_size
    except OSError as exc:
        return {"ok": False, "error": "cannot read file: %s" % exc.strerror}
    if size > CP_MAX_FILE_BYTES:
        return {"ok": False, "error": "file is too large to read (%d bytes, limit %d)" % (size, CP_MAX_FILE_BYTES)}
    try:
        raw = target.read_bytes()
    except OSError as exc:
        return {"ok": False, "error": "cannot read file: %s" % exc.strerror}
    if b"\x00" in raw[:8192]:
        return {"ok": False, "error": "binary file, cannot be shown as text"}
    text = raw.decode("utf-8", errors="replace")
    start = max(0, int(offset or 0))
    if query:
        hit = text.lower().find(query.lower())
        if hit != -1:
            start = max(0, hit - READ_WINDOW_CHARS // 4)
    start = min(start, max(0, len(text) - 1))
    end = min(start + READ_WINDOW_CHARS, len(text))
    return {
        "ok": True,
        "path": str(target.relative_to(base)),
        "text": text[start:end],
        "start": start,
        "end": end,
        "total": len(text),
    }
