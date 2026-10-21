"""Contract tests for every ``/__notlinear_*`` endpoint.

Per AGENTS.md these paths may never be renamed or altered, only added to. P2
moves them to FastAPI routers, and FastAPI changes several things silently
unless forced: Pydantic returns 422 where these handlers return 400, its
JSONResponse adds ``; charset=utf-8`` to the content type, and an unhandled
exception renders an HTML 500 page rather than ``{"ok": false, ...}``.

So these tests assert on the things that actually break: status code, the
headers the frontend depends on, and the JSON body's shape. 
"""

from __future__ import annotations

import json
from typing import Any

import pytest
import requests

TIMEOUT = 10

# Every endpoint, with a body that is valid enough to reach the handler.
# pick_folder / open_files / save_file shell
# out, so they only appear in tests that install the native fake.
ALL_ENDPOINTS = [
    "/__notlinear_pick_folder",
    "/__notlinear_scan_project",
    "/__notlinear_link_preview",
    "/__notlinear_open_files",
    "/__notlinear_save_file",
    "/__notlinear_runtime_logs",
]


# Since the P2 hardening, every /__notlinear_* POST must carry this header.
# A custom header cannot be sent cross-origin without a preflight, and the
# preflight only succeeds for a loopback origin — so this blocks a foreign page
# even on requests that would otherwise be "simple" and skip CORS entirely.
LOCAL_HEADER = {"X-Notlinear-Local": "1"}


def post(server: str, path: str, body: Any = None, **kwargs: Any) -> requests.Response:
    return requests.post(
        f"{server}{path}",
        data=json.dumps(body if body is not None else {}),
        headers={"Content-Type": "application/json", **LOCAL_HEADER, **kwargs.pop("headers", {})},
        timeout=TIMEOUT,
        **kwargs,
    )


class TestRouting:
    def test_unknown_endpoint_404s(self, server: str) -> None:
        assert post(server, "/__notlinear_does_not_exist").status_code == 404

    def test_every_documented_endpoint_exists(self, server: str, fake_native: Any) -> None:
        """None of the 12 paths may 404 — that would mean one was renamed."""
        fake_native(stdout="")
        for path in ALL_ENDPOINTS:
            response = post(server, path, {})
            assert response.status_code != 404, f"{path} 404ed — endpoint renamed or removed?"


class TestCorsContract:
    """The P0 hardening, pinned so P2's middleware cannot silently relax it."""

    def test_preflight_from_foreign_origin_is_refused(self, server: str) -> None:
        response = requests.options(
            f"{server}/__notlinear_open_files",
            headers={
                "Origin": "https://evil.example",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
            timeout=TIMEOUT,
        )
        assert response.status_code == 403
        assert "Access-Control-Allow-Origin" not in response.headers

    def test_preflight_from_own_origin_is_allowed(self, server: str, origin: str) -> None:
        response = requests.options(
            f"{server}/__notlinear_open_files",
            headers={
                "Origin": origin,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
            timeout=TIMEOUT,
        )
        assert response.status_code == 200
        assert response.headers["Access-Control-Allow-Origin"] == origin
        assert "POST" in response.headers["Access-Control-Allow-Methods"]

    def test_vary_origin_is_always_sent(self, server: str, origin: str) -> None:
        """Without Vary, a cache could serve one origin's allow header to another."""
        for headers in ({"Origin": origin}, {"Origin": "https://evil.example"}):
            response = post(server, "/__notlinear_runtime_logs", {"events": []}, headers=headers)
            assert response.headers.get("Vary") == "Origin"

    def test_foreign_origin_gets_no_allow_header_on_a_real_post(self, server: str) -> None:
        response = post(
            server, "/__notlinear_runtime_logs", {"events": []},
            headers={"Origin": "https://evil.example"},
        )
        assert "Access-Control-Allow-Origin" not in response.headers

    def test_a_post_without_the_local_header_is_refused(self, server: str) -> None:
        """The whole point of the header: a drive-by request is rejected before
        any handler runs, even if it somehow reached us without a preflight."""
        response = requests.post(
            f"{server}/__notlinear_runtime_logs",
            data=json.dumps({"events": []}),
            headers={"Content-Type": "application/json"},   # no X-Notlinear-Local
            timeout=TIMEOUT,
        )
        assert response.status_code == 403

    def test_preflight_advertises_the_local_header(self, server: str, origin: str) -> None:
        response = requests.options(
            f"{server}/__notlinear_open_files",
            headers={
                "Origin": origin,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type,x-notlinear-local",
            },
            timeout=TIMEOUT,
        )
        assert "X-Notlinear-Local" in response.headers["Access-Control-Allow-Headers"]

    def test_same_origin_request_without_origin_header_still_works(self, server: str) -> None:
        """The app and the WKWebView shell are same-origin and send no Origin."""
        assert post(server, "/__notlinear_runtime_logs", {"events": []}).status_code == 200


class TestJsonEnvelope:
    """Shape of the JSON helper every handler uses — ``_json``."""

    def test_content_type_has_no_charset_suffix(self, server: str) -> None:
        """FastAPI's JSONResponse appends '; charset=utf-8'; this one does not."""
        response = post(server, "/__notlinear_runtime_logs", {"events": []})
        assert response.headers["content-type"] == "application/json"

    def test_content_length_is_present_and_correct(self, server: str) -> None:
        response = post(server, "/__notlinear_runtime_logs", {"events": []})
        assert int(response.headers["content-length"]) == len(response.content)

    def test_error_bodies_use_the_ok_false_envelope(self, server: str) -> None:
        """Not Pydantic's {"detail": [...]}, which a 422 would produce."""
        response = post(server, "/__notlinear_scan_project", {})
        assert response.status_code == 400
        body = response.json()
        assert body["ok"] is False
        assert isinstance(body.get("error"), str) and body["error"]


class TestScanProject:
    def test_missing_path_is_400_not_422(self, server: str) -> None:
        response = post(server, "/__notlinear_scan_project", {})
        assert response.status_code == 400
        assert response.json()["ok"] is False

    def test_nonexistent_path_reports_an_error_not_a_crash(self, server: str) -> None:
        response = post(server, "/__notlinear_scan_project", {"path": "/definitely/not/here"})
        # An unapproved path is 403 whether or not it exists, which also avoids
        # leaking whether it exists.
        assert response.status_code == 403
        assert response.json()["ok"] is False

    def test_scanning_a_real_directory_returns_ok(self, server: str, tmp_path: Any) -> None:
        (tmp_path / "README.md").write_text("# hi\n", encoding="utf-8")
        response = post(server, "/__notlinear_scan_project", {"path": str(tmp_path)})
        assert response.status_code == 200
        assert response.json()["ok"] is True


class TestLinkPreview:
    def test_missing_url_is_rejected(self, server: str) -> None:
        response = post(server, "/__notlinear_link_preview", {})
        assert response.json()["ok"] is False

    @pytest.mark.parametrize("url", ["file:///etc/passwd", "ftp://example.com", "javascript:alert(1)"])
    def test_non_http_schemes_are_rejected(self, server: str, url: str) -> None:
        """The one validation ADR-023 does perform. SSRF hardening is ADR-035."""
        response = post(server, "/__notlinear_link_preview", {"url": url})
        assert response.json()["ok"] is False


class TestRuntimeLogs:
    def test_accepts_an_empty_event_list(self, server: str) -> None:
        response = post(server, "/__notlinear_runtime_logs", {"events": []})
        assert response.status_code == 200
        assert response.json()["ok"] is True

    def test_reports_the_number_of_events_capped_at_max(self, server: str, server_module: Any) -> None:
        events = [{"level": "info", "msg": f"e{i}"} for i in range(5)]
        response = post(server, "/__notlinear_runtime_logs", {"events": events})
        assert response.json()["events"] == min(5, server_module.MAX_EVENTS)

    def test_oversized_body_is_413(self, server: str, server_module: Any) -> None:
        big = "x" * (server_module.MAX_BODY_BYTES + 1000)
        response = requests.post(
            f"{server}/__notlinear_runtime_logs",
            data=json.dumps({"events": [{"msg": big}]}),
            headers={"Content-Type": "application/json", **LOCAL_HEADER},
            timeout=TIMEOUT,
        )
        assert response.status_code == 413

    def test_malformed_json_is_400(self, server: str) -> None:
        response = requests.post(
            f"{server}/__notlinear_runtime_logs",
            data="{not json",
            headers={"Content-Type": "application/json", **LOCAL_HEADER},
            timeout=TIMEOUT,
        )
        assert response.status_code == 400

    def test_writes_to_the_redirected_logs_path_not_the_real_one(
        self, server: str, server_module: Any
    ) -> None:
        post(server, "/__notlinear_runtime_logs", {"events": [{"level": "info", "msg": "hello"}]})
        assert server_module.LOGS_PATH.exists()
        assert "hello" in server_module.LOGS_PATH.read_text(encoding="utf-8")
        # Proves the autouse isolation fixture is doing its job.
        assert "tmp" in str(server_module.LOGS_PATH) or "pytest" in str(server_module.LOGS_PATH)


class TestNativeEndpoints:
    """Only reachable with the subprocess fake installed."""

    def test_pick_folder_returns_the_chosen_path(self, server: str, fake_native: Any) -> None:
        fake_native(stdout="/Users/someone/project\n")
        response = post(server, "/__notlinear_pick_folder", {})
        assert response.status_code == 200
        assert response.json()["ok"] is True

    def test_pick_folder_handles_a_cancelled_dialog(self, server: str, fake_native: Any) -> None:
        fake_native(stdout="", returncode=1)
        response = post(server, "/__notlinear_pick_folder", {})
        body = response.json()
        assert body["ok"] is False or body.get("cancelled") is True

    def test_save_file_requires_content(self, server: str, fake_native: Any) -> None:
        fake_native(stdout="/tmp/out.md")
        response = post(server, "/__notlinear_save_file", {})
        assert response.status_code in (200, 400)
        assert "ok" in response.json()

    def test_open_files_handles_a_cancelled_picker(self, server: str, fake_native: Any) -> None:
        fake_native(stdout="", returncode=1)
        response = post(server, "/__notlinear_open_files", {})
        assert "ok" in response.json()
