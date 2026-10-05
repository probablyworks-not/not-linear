"""Pre-write backup of the Notes database (P6b, ADR-042).

The new Notes editor rewrites ``notlinear-notes`` rows, so before it ever writes the
browser sends a full dump here and this puts it on disk. A browser download cannot be
trusted for this: the desktop app's webview silently ignores blob downloads, and the
native save dialog is fire-and-forget. Writing from the server gives the caller a path
and a byte count it can verify before unlocking the editor.

The file is the same ``notlinear-backup/v1`` shape ``tools/export-data.html`` writes, so
``tools/import-data.html`` can restore it.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

BACKUP_DIR = Path.home() / ".notlinear" / "backups"
BACKUP_FORMAT = "notlinear-backup/v1"
NOTES_DB = "notlinear-notes"
MAX_BYTES = 256 * 1024 * 1024  # notes embed images as data URLs, so this can be large


def _validate(backup: Any) -> list[Any]:
    """Returns the Notes record list, or raises ValueError saying what is wrong."""
    if not isinstance(backup, dict) or backup.get("format") != BACKUP_FORMAT:
        raise ValueError(f"backup.format must be {BACKUP_FORMAT!r}")
    dbs = backup.get("databases")
    db = dbs.get(NOTES_DB) if isinstance(dbs, dict) else None
    stores = db.get("stores") if isinstance(db, dict) else None
    kv = stores.get("kv") if isinstance(stores, dict) else None
    records = kv.get("records") if isinstance(kv, dict) else None
    if not isinstance(records, list):
        raise ValueError(f"backup.databases.{NOTES_DB}.stores.kv.records must be a list")
    return records


def save_notes_backup(backup: Any) -> dict[str, Any]:
    records = _validate(backup)
    data = json.dumps(backup, ensure_ascii=False).encode("utf-8")
    if len(data) > MAX_BYTES:
        raise ValueError("backup is too large")

    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = BACKUP_DIR / f"notlinear-notes-backup-{stamp}.json"
    n = 1
    while path.exists():  # two backups in one second must not overwrite each other
        n += 1
        path = BACKUP_DIR / f"notlinear-notes-backup-{stamp}-{n}.json"

    tmp = path.with_name(path.name + ".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)  # private: notes are personal
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise

    written = path.stat().st_size
    if written != len(data):
        raise OSError(f"wrote {written} bytes, expected {len(data)}")
    return {"path": str(path), "bytes": written, "records": len(records)}
