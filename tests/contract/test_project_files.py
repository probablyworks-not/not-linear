"""Live reads of a linked folder for the model's file tools (ADR-059).

The service is the security boundary: the model supplies only a relative path, so every
way of leaving the folder (``../``, absolute paths, symlinks) and every secrets file
must be refused here, whatever the frontend does.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

import pytest
import requests

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "backend"))

from app.services import consent, project_files  # noqa: E402

LOCAL_HEADER = {"X-Notlinear-Local": "1"}


@pytest.fixture
def folder(tmp_path: Path) -> Path:
    root = tmp_path / "project"
    (root / "src").mkdir(parents=True)
    (root / "node_modules" / "dep").mkdir(parents=True)
    (root / ".git").mkdir()
    (root / "README.md").write_text("# Hello\n", encoding="utf-8")
    (root / "src" / "main.py").write_text("print('hi')\n", encoding="utf-8")
    (root / ".env").write_text("SECRET=1\n", encoding="utf-8")
    (root / "src" / "server.pem").write_text("-----BEGIN-----", encoding="utf-8")
    (root / "node_modules" / "dep" / "index.js").write_text("x", encoding="utf-8")
    return root


class TestListDir:
    def test_lists_one_level_dirs_first(self, folder: Path) -> None:
        result = project_files.list_dir(folder)
        assert result["ok"] is True
        assert [(e["name"], e["type"]) for e in result["entries"]] == [("src", "dir"), ("README.md", "file")]

    def test_hides_secrets_and_skip_dirs(self, folder: Path) -> None:
        names = {e["name"] for e in project_files.list_dir(folder)["entries"]}
        assert not names & {".env", ".git", "node_modules"}
        sub = {e["name"] for e in project_files.list_dir(folder, "src")["entries"]}
        assert sub == {"main.py"}

    def test_subdirectory_path_is_reported_relative(self, folder: Path) -> None:
        assert project_files.list_dir(folder, "src")["path"] == "src"

    def test_dotdot_escape_is_refused(self, folder: Path) -> None:
        result = project_files.list_dir(folder, "../")
        assert result["ok"] is False and "outside" in result["error"]

    def test_absolute_path_cannot_escape(self, folder: Path) -> None:
        # A leading slash is treated as relative to the root, never as the filesystem root.
        result = project_files.list_dir(folder, "/etc")
        assert result["ok"] is False

    def test_symlink_out_of_root_is_not_listed_or_followed(self, folder: Path, tmp_path: Path) -> None:
        outside = tmp_path / "outside"
        outside.mkdir()
        (outside / "loot.txt").write_text("loot", encoding="utf-8")
        (folder / "escape").symlink_to(outside)
        assert "escape" not in {e["name"] for e in project_files.list_dir(folder)["entries"]}
        assert project_files.list_dir(folder, "escape")["ok"] is False

    def test_browsing_a_skip_dir_is_refused(self, folder: Path) -> None:
        assert project_files.list_dir(folder, "node_modules")["ok"] is False
        assert project_files.list_dir(folder, ".git")["ok"] is False


class TestReadFile:
    def test_reads_a_small_file_whole(self, folder: Path) -> None:
        result = project_files.read_file(folder, "src/main.py")
        assert result == {"ok": True, "path": "src/main.py", "text": "print('hi')\n", "start": 0, "end": 12, "total": 12}

    @pytest.mark.parametrize("name", [".env", "src/server.pem"])
    def test_secrets_are_refused_with_a_reason(self, folder: Path, name: str) -> None:
        result = project_files.read_file(folder, name)
        assert result["ok"] is False and "secrets" in result["error"]

    @pytest.mark.parametrize("name", [".env.local", "ID_RSA", "id_rsa.pub", "a/b/prod.KEY"])
    def test_secret_name_patterns(self, name: str) -> None:
        assert project_files.is_secret_name(name.split("/")[-1])

    def test_dotdot_escape_is_refused(self, folder: Path, tmp_path: Path) -> None:
        (tmp_path / "private.txt").write_text("nope", encoding="utf-8")
        result = project_files.read_file(folder, "../private.txt")
        assert result["ok"] is False and "outside" in result["error"]

    def test_symlink_to_outside_file_is_refused(self, folder: Path, tmp_path: Path) -> None:
        (tmp_path / "private.txt").write_text("nope", encoding="utf-8")
        (folder / "link.txt").symlink_to(tmp_path / "private.txt")
        assert project_files.read_file(folder, "link.txt")["ok"] is False

    def test_window_and_offset(self, folder: Path) -> None:
        (folder / "big.txt").write_text("a" * 9000, encoding="utf-8")
        first = project_files.read_file(folder, "big.txt")
        assert (first["start"], first["end"], first["total"]) == (0, project_files.READ_WINDOW_CHARS, 9000)
        nxt = project_files.read_file(folder, "big.txt", offset=first["end"])
        assert nxt["start"] == first["end"] and len(nxt["text"]) == project_files.READ_WINDOW_CHARS

    def test_query_centres_the_window_on_the_match(self, folder: Path) -> None:
        (folder / "big.txt").write_text("a" * 6000 + "NEEDLE" + "b" * 6000, encoding="utf-8")
        result = project_files.read_file(folder, "big.txt", query="needle")
        assert "NEEDLE" in result["text"] and result["start"] > 0

    def test_binary_and_oversized_files_are_refused(self, folder: Path) -> None:
        (folder / "bin.dat").write_bytes(b"\x00\x01\x02")
        assert "binary" in project_files.read_file(folder, "bin.dat")["error"]
        (folder / "huge.txt").write_text("a" * (project_files.CP_MAX_FILE_BYTES + 1), encoding="utf-8")
        assert "too large" in project_files.read_file(folder, "huge.txt")["error"]

    def test_a_directory_is_not_a_file(self, folder: Path) -> None:
        assert project_files.read_file(folder, "src")["ok"] is False


def _post(server: str, path: str, body: Any) -> requests.Response:
    return requests.post(
        f"{server}{path}", data=json.dumps(body),
        headers={"Content-Type": "application/json", **LOCAL_HEADER}, timeout=10,
    )


class TestEndpoints:
    def test_paths_exist(self, server: str) -> None:
        for path in ("/__notlinear_list_dir", "/__notlinear_read_file"):
            assert _post(server, path, {}).status_code != 404

    def test_missing_path_is_400(self, server: str) -> None:
        response = _post(server, "/__notlinear_list_dir", {})
        assert response.status_code == 400 and response.json()["ok"] is False

    def test_unapproved_folder_is_403(self, server: str, folder: Path) -> None:
        assert _post(server, "/__notlinear_list_dir", {"path": str(folder)}).status_code == 403
        assert _post(server, "/__notlinear_read_file", {"path": str(folder), "file": "README.md"}).status_code == 403

    def test_does_not_seed_the_ledger(self, server: str, folder: Path) -> None:
        _post(server, "/__notlinear_list_dir", {"path": str(folder)})
        assert consent.allowed_roots() == []

    def test_approved_folder_lists_and_reads(self, server: str, folder: Path) -> None:
        consent.allow(folder)
        listing = _post(server, "/__notlinear_list_dir", {"path": str(folder), "sub": "src"})
        assert listing.status_code == 200 and listing.json()["entries"] == [{"name": "main.py", "type": "file", "size": 12}]
        read = _post(server, "/__notlinear_read_file", {"path": str(folder), "file": "src/main.py"})
        assert read.status_code == 200 and read.json()["text"] == "print('hi')\n"

    def test_refusals_are_ok_false_with_status_200(self, server: str, folder: Path) -> None:
        # Tool-level refusals (secrets, escapes) are results for the model, not HTTP errors.
        consent.allow(folder)
        response = _post(server, "/__notlinear_read_file", {"path": str(folder), "file": ".env"})
        assert response.status_code == 200
        assert response.json()["ok"] is False
