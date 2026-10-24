"""A record of which directories the user has actually agreed to expose.

``scan_project`` reads a directory tree and returns file contents. Before this,
it would scan any absolute path a caller named — and callers are reachable from
the browser. The native folder picker was the only thing standing between a
request and the filesystem, and nothing required the picker to have been used.

The dialog *is* the consent, so the ledger makes that explicit: ``pick_folder``
is the only writer, and ``scan_project`` will only read somewhere the ledger
already names. That keeps the real workflow (pick a folder, then scan it)
working exactly as before while removing "scan an arbitrary path" as a thing
the endpoint can be asked to do.

Part of ADR-035.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

LEDGER_DIR = Path.home() / ".notlinear"
LEDGER_PATH = LEDGER_DIR / "allowed_roots.json"


def _read() -> list[str]:
    try:
        raw = LEDGER_PATH.read_text(encoding="utf-8")
    except (OSError, ValueError):
        return []
    try:
        data = json.loads(raw)
    except ValueError:
        return []
    roots = data.get("roots") if isinstance(data, dict) else data
    return [r for r in roots if isinstance(r, str)] if isinstance(roots, list) else []


def allowed_roots() -> list[Path]:
    return [Path(r) for r in _read()]


def allow(path: str | Path) -> None:
    """Records a directory as user-approved. Only pick_folder should call this."""
    resolved = Path(path).expanduser().resolve()
    if not resolved.is_dir():
        return
    current = _read()
    if str(resolved) in current:
        return
    LEDGER_DIR.mkdir(parents=True, exist_ok=True)
    LEDGER_PATH.write_text(
        json.dumps({"roots": [*current, str(resolved)]}, indent=2) + "\n",
        encoding="utf-8",
    )


def seed_if_empty(path: str | None) -> None:
    """One-time migration for users who already had a project folder set.

    Without this, an existing `prefs.folderName` would stop working the moment
    this ledger landed, and the fix would look like "the folder picker is
    broken" rather than "a new consent record is empty".
    """
    if not path or _read():
        return
    allow(path)


def is_allowed(path: str | Path) -> bool:
    """True when `path` is at, or inside, a directory the user picked.

    Resolves symlinks first: a symlink inside an approved folder pointing at
    /etc would otherwise read as approved.
    """
    try:
        resolved = Path(path).expanduser().resolve(strict=True)
    except (OSError, RuntimeError):
        return False
    for root in allowed_roots():
        try:
            root_resolved = root.resolve(strict=True)
        except (OSError, RuntimeError):
            continue
        if resolved == root_resolved:
            return True
        if root_resolved in resolved.parents:
            return True
    return False


def describe_refusal(path: str | Path) -> str:
    """The message the user sees. Says what to do, not just what failed."""
    if not allowed_roots():
        return (
            "no folders have been approved yet — choose one with the folder picker first"
        )
    return f"path not allowed: {os.fspath(path)!s} is not inside a folder you picked"
