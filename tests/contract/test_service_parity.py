"""Differential parity between the old stdlib server and the new services.

P2 moves the business logic out of ``backend/server.py`` into
``backend/app/services/*``. The claim is that the move is verbatim. This file
is what makes that claim checkable rather than asserted: both implementations
are imported into one process and fed the same inputs.

It caught two real regressions while the move was being made — a
``LINK_PREVIEW_TIMEOUT_S`` transcribed as 8 when the real value is 6, and the
``CP_*`` scan caps missing entirely — so it stays in the suite until
``backend/server.py``'s implementation is deleted (P3), at which point there is
no longer an oracle to compare against and this file goes with it.
"""

from __future__ import annotations

import importlib.util
import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Any

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "backend"))


@pytest.fixture(scope="module")
def old() -> Any:
    """The original stdlib server module."""
    spec = importlib.util.spec_from_file_location("old_server_parity", REPO_ROOT / "backend" / "server_legacy.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def canon(value: Any) -> str:
    return json.dumps(value, sort_keys=True, default=str)


class TestConstants:
    """Transcribed constants are where a 'verbatim' move quietly stops being one."""

    @pytest.mark.parametrize("name", [
        "LINK_PREVIEW_TIMEOUT_S", "LINK_PREVIEW_MAX_BYTES",
        "MAX_BODY_BYTES", "MAX_EVENTS", "LOG_START", "LOG_END",
    ])
    def test_config_constants_match(self, old: Any, name: str) -> None:
        from app import config
        assert getattr(config, name) == getattr(old, name), f"{name} drifted during the move"

    @pytest.mark.parametrize("name", [
        "CP_CONVENTION_STEMS", "CP_MAX_FILE_BYTES", "CP_MAX_LISTING",
        "CP_MAX_MARKDOWN_FILES", "CP_MAX_CONTEXT_FILES",
        "CP_SKIP_DIRS", "CP_SKIP_FILES", "CP_TEXT_EXTENSIONS",
    ])
    def test_scan_constants_match(self, old: Any, name: str) -> None:
        from app.services import project_scan
        assert getattr(project_scan, name) == getattr(old, name), f"{name} drifted during the move"


class TestProjectScan:
    def test_scanning_a_real_tree_is_identical(self, old: Any) -> None:
        from app.services import project_scan
        d = tempfile.mkdtemp()
        (Path(d) / "README.md").write_text("# Title\n\nbody text\n", encoding="utf-8")
        (Path(d) / "CHANGELOG.md").write_text("## 2026-01-01\n- thing\n", encoding="utf-8")
        (Path(d) / "notes.txt").write_text("plain\n", encoding="utf-8")
        os.makedirs(Path(d) / "sub", exist_ok=True)
        (Path(d) / "sub" / "deep.md").write_text("# Deep\n", encoding="utf-8")
        assert canon(project_scan.scan_project(d)) == canon(old.scan_project(d))

    def test_missing_directory_is_identical(self, old: Any) -> None:
        from app.services import project_scan
        assert canon(project_scan.scan_project("/no/such/dir")) == canon(old.scan_project("/no/such/dir"))


class TestLinkPreview:
    @pytest.mark.parametrize("url", ["file:///etc/passwd", "ftp://x", "javascript:alert(1)", "notaurl", ""])
    def test_rejected_schemes_are_identical(self, old: Any, url: str) -> None:
        """No network: these are all rejected before any request is made."""
        from app.services import link_preview
        assert canon(link_preview.link_preview(url)) == canon(old.link_preview(url))


class TestRuntimeLogs:
    def test_log_block_payload_is_identical(self, old: Any) -> None:
        from app.services import runtime_logs
        events = [{"level": "info", "msg": "hello"}, {"level": "error", "msg": "boom"}]
        # Line 0 carries a generated timestamp; everything after it must match.
        assert runtime_logs.runtime_log_block(events).splitlines()[1:] == \
               old.runtime_log_block(events).splitlines()[1:]

    def test_section_replacement_is_identical(self, old: Any) -> None:
        from app.services import runtime_logs
        existing = "# Runtime logs\n"
        assert runtime_logs.replace_runtime_log_section(existing, "BLOCK") == \
               old.replace_runtime_log_section(existing, "BLOCK")


class TestFeedbackStore:
    @pytest.mark.parametrize("rel", ["../../CHANGELOG.md", "/etc/passwd", "feedback/media/../../BUGS.md"])
    def test_traversal_guard_behaves_identically(self, old: Any, rel: str) -> None:
        """The only thing between a client path string and the server touching it."""
        from app.services import feedback_store

        def outcome(fn: Any) -> str:
            try:
                fn(rel)
            except Exception as exc:  # noqa: BLE001 - the type IS the assertion
                return type(exc).__name__
            return "no-raise"

        assert outcome(feedback_store._media_file_from_rel) == outcome(old._media_file_from_rel)
