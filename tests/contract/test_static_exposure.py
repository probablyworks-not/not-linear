"""What the server is and is not willing to serve.

The stdlib server ran ``ThreadingHTTPServer(..., directory=REPO_ROOT)``, so the
**entire repository** was reachable over HTTP: ``GET /BUGS.md`` returned 96 KB
of private triage, ``/uploads/`` returned personal screenshots, and
``/docs/project-notes/`` was fully browsable. Nothing malicious was needed —
any page in the browser, or anyone on the machine, could just ask.

These tests are therefore FastAPI-only: they describe the allowlist that
replaced that behaviour, and they would correctly fail against the old server,
which is the point. They run under ``NOTLINEAR_SERVER=fastapi`` and skip
otherwise rather than being quietly weakened to pass both.
"""

from __future__ import annotations

import pytest
import requests

from conftest import server_flavour

TIMEOUT = 10

pytestmark = pytest.mark.skipif(
    server_flavour() != "fastapi",
    reason="describes the P2 static allowlist; the legacy server serves the whole repo by design",
)


class TestNoLongerExposed:
    """Each of these was readable over HTTP before P2."""

    @pytest.mark.parametrize("path", [
        "/BUGS.md",                              # 96 KB of private bug triage
        "/CLAUDE.md",
        "/AGENTS.md",
        "/plan.md",
        "/logs.md",                              # runtime log, write-only by design
        "/FEATURES.md",
        "/docs/project-notes/DECISIONS.md",
        "/docs/project-notes/RUNS.md",
        "/feedback/FEEDBACK.md",                 # the log itself, not its media
        "/uploads/",
        "/backend/server.py",
        "/.gitignore",
    ])
    def test_repo_files_are_not_served(self, server: str, path: str) -> None:
        response = requests.get(f"{server}{path}", timeout=TIMEOUT)
        assert response.status_code == 404, f"{path} is still being served"

    @pytest.mark.parametrize("path", [
        "/frontend/../BUGS.md",
        "/frontend/../../etc/passwd",
        "/tools/../BUGS.md",
        "/feedback/media/../FEEDBACK.md",
    ])
    def test_path_traversal_out_of_a_mount_is_refused(self, server: str, path: str) -> None:
        """StaticFiles normalises these, but the assertion is cheap and the
        consequence of it ever regressing is not."""
        response = requests.get(f"{server}{path}", timeout=TIMEOUT, allow_redirects=False)
        assert response.status_code in (404, 403, 301, 307), \
            f"{path} resolved to something servable ({response.status_code})"


class TestStillServed:
    """The allowlist has to stay useful, not just safe."""

    def test_the_app_itself(self, server: str) -> None:
        response = requests.get(f"{server}/frontend/index.html", timeout=TIMEOUT)
        assert response.status_code == 200
        assert "notlinear" in response.text.lower()

    def test_changelog_for_the_in_app_viewer(self, server: str) -> None:
        """app.js:4443 fetches this. It has a hardcoded fallback, so a miss is
        cosmetic rather than fatal — but it should not be missing."""
        response = requests.get(f"{server}/CHANGELOG.md", timeout=TIMEOUT)
        assert response.status_code == 200
        assert response.text.startswith("# Changelog")

    def test_feedback_media_is_same_origin(self, server: str, server_module: object) -> None:
        """feedback.js:317,322 set img.src/video.src to these paths. They must
        be same-origin or the annotate canvas is tainted and toDataURL throws."""
        media_dir = server_module.FEEDBACK_MEDIA_DIR  # type: ignore[attr-defined]
        media_dir.mkdir(parents=True, exist_ok=True)
        (media_dir / "probe.png").write_bytes(b"\x89PNG\r\n\x1a\n")
        response = requests.get(f"{server}/feedback/media/probe.png", timeout=TIMEOUT)
        assert response.status_code == 200

    def test_backup_tools_remain_reachable(self, server: str) -> None:
        """They have to work even when the app is mid-migration or broken."""
        response = requests.get(f"{server}/tools/export-data.html", timeout=TIMEOUT)
        assert response.status_code == 200

    def test_the_url_the_desktop_app_bundle_loads(self, server: str) -> None:
        """Regression guard.

        `strings` on launchers/Notlinear.app/Contents/MacOS/Notlinear shows the
        compiled binary loads http://127.0.0.1:8765/notlinear.html. The first
        cut of the P2 allowlist omitted it and the desktop app rendered a 404 —
        invisible to every other test, because nothing else requests that path.
        """
        response = requests.get(f"{server}/notlinear.html", timeout=TIMEOUT)
        assert response.status_code == 200
        assert "frontend/index.html" in response.text

    def test_root_redirects_to_the_legacy_app(self, server: str) -> None:
        """One line, and the rollback switch between the two apps at the P6 gate."""
        response = requests.get(f"{server}/", timeout=TIMEOUT, allow_redirects=False)
        assert response.status_code in (301, 302, 307, 308)
        assert response.headers["location"] == "/frontend/index.html"
