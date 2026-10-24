"""/__notlinear_backup_notes: the mandatory pre-write Notes backup (P6b, ADR-042).

An added endpoint, not one of the twelve frozen ones, so it exists on the FastAPI server only.
"""

from __future__ import annotations

import json
import os
import stat
from pathlib import Path
from typing import Any

import pytest
import requests

PATH = "/__notlinear_backup_notes"
HEADERS = {"Content-Type": "application/json", "X-Notlinear-Local": "1"}


def backup_body(records: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    records = records if records is not None else [{"key": "nl_notes_v1", "value": [{"id": "n1", "blocks": []}]}]
    return {
        "format": "notlinear-backup/v1",
        "createdAt": "2026-10-05T00:00:00.000Z",
        "databases": {
            "notlinear-notes": {
                "version": 1,
                "stores": {"kv": {"keyPath": "key", "autoIncrement": False, "records": records}},
            }
        },
    }


def post(server: str, body: Any, headers: dict[str, str] | None = None) -> requests.Response:
    return requests.post(f"{server}{PATH}", data=json.dumps(body), headers=headers or HEADERS, timeout=10)


def backup_dir() -> Path:
    from app.services import notes_backup
    return notes_backup.BACKUP_DIR


def test_writes_the_backup_and_reports_where(server: str) -> None:
    body = backup_body([{"key": "nl_notes_v1", "value": [{"id": "n1", "title": "é 😀", "blocks": []}]}])
    r = post(server, {"backup": body})
    assert r.status_code == 200
    out = r.json()
    assert out["ok"] is True and out["records"] == 1
    written = Path(out["path"])
    assert written.parent == backup_dir()
    assert written.stat().st_size == out["bytes"]
    assert json.loads(written.read_text(encoding="utf-8")) == body


def test_the_file_is_private(server: str) -> None:
    path = Path(post(server, {"backup": backup_body()}).json()["path"])
    assert stat.S_IMODE(os.stat(path).st_mode) == 0o600


def test_two_backups_never_overwrite_each_other(server: str) -> None:
    a = post(server, {"backup": backup_body()}).json()["path"]
    b = post(server, {"backup": backup_body()}).json()["path"]
    assert a != b and Path(a).exists() and Path(b).exists()


def test_leaves_no_temp_file_behind(server: str) -> None:
    post(server, {"backup": backup_body()})
    assert [p.name for p in backup_dir().iterdir() if p.name.endswith(".tmp")] == []


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"backup": "nope"},
        {"backup": {"format": "something-else", "databases": {}}},
        {"backup": {"format": "notlinear-backup/v1", "databases": {}}},
        {"backup": {"format": "notlinear-backup/v1", "databases": {"notlinear-notes": {"stores": {"kv": {"records": "x"}}}}}},
    ],
)
def test_rejects_anything_that_is_not_a_notes_backup_and_writes_nothing(server: str, body: dict[str, Any]) -> None:
    r = post(server, body)
    assert r.status_code == 400 and r.json()["ok"] is False
    assert not backup_dir().exists() or list(backup_dir().iterdir()) == []


def test_requires_the_local_header(server: str) -> None:
    r = post(server, {"backup": backup_body()}, headers={"Content-Type": "application/json"})
    assert r.status_code == 403
    assert not backup_dir().exists() or list(backup_dir().iterdir()) == []


def test_the_restore_tool_accepts_what_this_writes(server: str) -> None:
    """tools/_backup-lib.js validateBackup: format, databases, and a records array per store."""
    written = json.loads(Path(post(server, {"backup": backup_body()}).json()["path"]).read_text(encoding="utf-8"))
    assert written["format"] == "notlinear-backup/v1"
    for db in written["databases"].values():
        for store in db["stores"].values():
            assert isinstance(store["records"], list)
