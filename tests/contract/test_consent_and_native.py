"""Filesystem consent, and the AppleScript injection surface.

``scan_project`` reads a directory tree and returns file contents, and it is
reachable from the browser. Before this, it scanned any absolute path it was
given; the native folder picker was the only thing between a request and the
filesystem, and nothing required the picker to have been used.

``save_file`` built its AppleScript with an f-string, so a crafted filename
could close the quoted string and append arbitrary script. The old comment
called that acceptable because the value "originates from this app's own
frontend" — the same assumption the CORS hole had already disproved.

Part of ADR-035.
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "backend"))

from app.services import consent, macos  # noqa: E402


@pytest.fixture
def ledger(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Redirects the consent ledger so tests never touch ~/.notlinear."""
    monkeypatch.setattr(consent, "LEDGER_DIR", tmp_path)
    monkeypatch.setattr(consent, "LEDGER_PATH", tmp_path / "allowed_roots.json")
    return tmp_path


class TestConsentLedger:
    def test_nothing_is_allowed_before_a_folder_is_picked(self, ledger: Path) -> None:
        assert consent.allowed_roots() == []
        assert consent.is_allowed(tempfile.mkdtemp()) is False

    def test_an_approved_root_and_its_children_are_allowed(self, ledger: Path, tmp_path: Path) -> None:
        project = tmp_path / "project"
        (project / "sub" / "deep").mkdir(parents=True)
        consent.allow(project)
        assert consent.is_allowed(project) is True
        assert consent.is_allowed(project / "sub") is True
        assert consent.is_allowed(project / "sub" / "deep") is True

    def test_a_sibling_directory_is_not_allowed(self, ledger: Path, tmp_path: Path) -> None:
        approved = tmp_path / "approved"; approved.mkdir()
        other = tmp_path / "other"; other.mkdir()
        consent.allow(approved)
        assert consent.is_allowed(other) is False

    @pytest.mark.parametrize("path", ["/etc", "/", "/usr/bin"])
    def test_system_directories_are_not_allowed(self, ledger: Path, tmp_path: Path, path: str) -> None:
        approved = tmp_path / "approved"; approved.mkdir()
        consent.allow(approved)
        assert consent.is_allowed(path) is False

    def test_a_symlink_escaping_an_approved_root_is_refused(self, ledger: Path, tmp_path: Path) -> None:
        """Resolution happens before the prefix check, so a link inside an
        approved folder cannot be used to read outside it."""
        approved = tmp_path / "approved"; approved.mkdir()
        outside = tmp_path / "outside"; outside.mkdir()
        consent.allow(approved)
        escape = approved / "escape"
        escape.symlink_to(outside, target_is_directory=True)
        assert consent.is_allowed(escape) is False

    def test_seed_if_empty_trusts_exactly_one_path_and_only_once(self, ledger: Path, tmp_path: Path) -> None:
        """The upgrade path.

        Existing installs already have a project folder chosen through the
        picker in an earlier session, before any ledger existed. Trust-on-
        first-use is weaker than demanding a fresh pick, and is bounded to one
        path while the ledger is empty, because the alternative is breaking
        every existing install on upgrade.
        """
        first = tmp_path / "first"; first.mkdir()
        second = tmp_path / "second"; second.mkdir()
        consent.seed_if_empty(str(first))
        assert consent.is_allowed(first) is True
        consent.seed_if_empty(str(second))
        assert consent.is_allowed(second) is False, "a non-empty ledger must not seed again"

    def test_a_corrupt_ledger_fails_closed(self, ledger: Path) -> None:
        consent.LEDGER_PATH.write_text("{not json", encoding="utf-8")
        assert consent.allowed_roots() == []

    def test_the_refusal_message_says_what_to_do(self, ledger: Path, tmp_path: Path) -> None:
        assert "folder picker" in consent.describe_refusal(tmp_path)


class TestFilenameValidation:
    @pytest.mark.parametrize("name", [
        "../../etc/passwd",
        "/etc/passwd",
        "a/b.md",
        "",
        "x" * 200,
        "with\x00nul",
    ])
    def test_rejected(self, name: str) -> None:
        assert not macos.SAFE_FILENAME.match(name)

    @pytest.mark.parametrize("name", ["response.md", "My Notes 2026.md", "a-b_c.md"])
    def test_accepted(self, name: str) -> None:
        assert macos.SAFE_FILENAME.match(name)

    def test_save_file_refuses_a_path_like_name(self) -> None:
        result = macos.save_file("../../evil.md", "x")
        assert result["ok"] is False
        assert result["error"] == "invalid filename"


class TestNoScriptInterpolation:
    def test_the_filename_is_passed_as_argv_not_built_into_the_script(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The actual fix.

        A quote-heavy name is harmless as argv but would have escaped a quoted
        AppleScript string. Asserting on the command proves the value never
        reaches the script text.
        """
        captured: dict[str, list[str]] = {}

        class Fake:
            returncode = 1
            stdout = ""
            stderr = ""

        def fake_run(cmd, *a, **kw):  # type: ignore[no-untyped-def]
            captured["cmd"] = list(cmd)
            return Fake()

        monkeypatch.setattr(macos.subprocess, "run", fake_run)
        monkeypatch.setattr(macos, "fake_native", lambda: False)
        monkeypatch.setattr(macos.sys, "platform", "darwin")  # the guard skips osascript elsewhere

        # No slash, so it passes SAFE_FILENAME and actually reaches osascript —
        # which is the point. A payload containing a path separator is rejected
        # earlier and would prove nothing about the argv handling.
        nasty = 'a"; do shell script "whoami"; --.md'
        assert macos.SAFE_FILENAME.match(nasty), "payload must survive validation to test argv"
        macos.save_file(nasty, "content")

        cmd = captured["cmd"]
        script = cmd[cmd.index("-e") + 1]
        assert nasty not in script, "the filename reached the AppleScript source"
        assert "item 1 of argv" in script
        assert nasty in cmd, "the filename should be passed as a real argv element"


class TestOffMacOS:
    def test_pickers_report_cancelled_instead_of_failing(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """No osascript off macOS: the UI must fall through to the browser's file input."""
        def boom(*a, **kw):  # type: ignore[no-untyped-def]
            raise AssertionError("osascript must not be run off macOS")

        monkeypatch.setattr(macos.subprocess, "run", boom)
        monkeypatch.setattr(macos, "fake_native", lambda: False)
        monkeypatch.setattr(macos.sys, "platform", "linux")
        assert macos.pick_folder() == {"ok": False, "cancelled": True}
        assert macos.open_files()["ok"] is False


class TestSaveFileEmptyPath:
    def test_an_empty_dialog_result_writes_nothing(self, monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
        """A successful dialog with no path used to write a file named ".md" into the working directory."""
        class Done:
            returncode = 0
            stdout = "\n"
            stderr = ""

        monkeypatch.setattr(macos.subprocess, "run", lambda *a, **kw: Done())
        monkeypatch.setattr(macos, "fake_native", lambda: False)
        monkeypatch.setattr(macos.sys, "platform", "darwin")
        monkeypatch.chdir(tmp_path)
        assert macos.save_file("note.md", "content") == {"ok": False, "cancelled": True}
        assert list(tmp_path.iterdir()) == []
