"""What the server is and is not willing to serve.

Static serving is an explicit allowlist: the built web app under ``/web``, the
backup pages under ``/tools``, ``/logo.svg`` and ``/CHANGELOG.md``. Nothing else
in the repository is reachable over HTTP, so a page in the browser (or anyone
on the machine) cannot simply ask for source, notes or logs.
"""

from __future__ import annotations

import pytest
import requests

TIMEOUT = 10


class TestNotExposed:
    @pytest.mark.parametrize("path", [
        "/BUGS.md",
        "/CLAUDE.md",
        "/AGENTS.md",
        "/plan.md",
        "/logs.md",                              # runtime log, write-only by design
        "/FEATURES.md",
        "/docs/project-notes/DECISIONS.md",
        "/uploads/",
        "/backend/server.py",
        "/web/package.json",                     # only web/dist is served, not web/
        "/.gitignore",
        "/frontend/index.html",                  # the old app is not part of the server
    ])
    def test_repo_files_are_not_served(self, server: str, path: str) -> None:
        response = requests.get(f"{server}{path}", timeout=TIMEOUT)
        assert response.status_code == 404, f"{path} is still being served"

    @pytest.mark.parametrize("path", [
        "/web/../BUGS.md",
        "/web/../../etc/passwd",
        "/tools/../BUGS.md",
    ])
    def test_path_traversal_out_of_a_mount_is_refused(self, server: str, path: str) -> None:
        """StaticFiles normalises these, but the assertion is cheap and the
        consequence of it ever regressing is not."""
        response = requests.get(f"{server}{path}", timeout=TIMEOUT, allow_redirects=False)
        assert response.status_code in (404, 403, 301, 307), \
            f"{path} resolved to something servable ({response.status_code})"


class TestStillServed:
    def test_root_redirects_to_the_web_app(self, server: str) -> None:
        response = requests.get(f"{server}/", timeout=TIMEOUT, allow_redirects=False)
        assert response.status_code in (301, 302, 307, 308)
        assert response.headers["location"] == "/web/"

    def test_the_built_app(self, server: str) -> None:
        from app import config
        if not (config.WEB_DIST_DIR / "index.html").is_file():
            pytest.skip("web/dist is not built (run `pnpm build` in web/)")
        response = requests.get(f"{server}/web/", timeout=TIMEOUT)
        assert response.status_code == 200
        assert "notlinear" in response.text.lower()

    def test_logo(self, server: str) -> None:
        response = requests.get(f"{server}/logo.svg", timeout=TIMEOUT)
        assert response.status_code == 200

    def test_changelog_is_served_or_a_clean_404(self, server: str) -> None:
        """The in-app viewer has a bundled fallback, so a miss is cosmetic, but it must be a 404 not a 500."""
        response = requests.get(f"{server}/CHANGELOG.md", timeout=TIMEOUT)
        assert response.status_code in (200, 404)

    def test_backup_tools_remain_reachable(self, server: str) -> None:
        """They have to work even when the app itself is broken."""
        response = requests.get(f"{server}/tools/export-data.html", timeout=TIMEOUT)
        assert response.status_code == 200

    def test_responses_are_never_cached(self, server: str) -> None:
        """No build-time asset versioning on the API and tool pages: a stale copy would call endpoints without the required header."""
        response = requests.get(f"{server}/tools/export-data.html", timeout=TIMEOUT)
        assert "no-store" in response.headers.get("Cache-Control", "")
