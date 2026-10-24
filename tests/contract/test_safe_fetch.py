"""SSRF protection for the one endpoint that fetches a user-supplied URL.

ADR-023 declined this, reasoning that a local single-user server has no such
threat model. That is the same reasoning that justified
``Access-Control-Allow-Origin: *``, and it is wrong the same way: text in a
note is not necessarily text the user wrote, and this server sits inside the
user's network with a view of it the browser deliberately does not have.
``http://192.168.1.1/admin`` and the cloud metadata address are one paste away.

Superseded by ADR-035. These tests are the specification.
"""

from __future__ import annotations

import http.client
import inspect
import socket
import sys
from pathlib import Path
from unittest import mock

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "backend"))

from app.services import link_preview as link_preview_service  # noqa: E402
from app.services import safe_fetch  # noqa: E402


class TestBlockedDestinations:
    """Every one of these resolves somewhere the server must not reach."""

    @pytest.mark.parametrize("url,why", [
        ("http://127.0.0.1:8765/", "the app's own backend"),
        ("http://127.0.0.1/__notlinear_open_files", "its own endpoints"),
        ("http://localhost/", "loopback by name"),
        ("http://[::1]/", "IPv6 loopback"),
        ("http://10.0.0.1/", "RFC1918 class A"),
        ("http://172.16.0.1/", "RFC1918 class B"),
        ("http://192.168.1.1/admin", "a home router admin page"),
        ("http://169.254.169.254/latest/meta-data/", "cloud instance metadata"),
        ("http://100.64.0.1/", "CGNAT, which ipaddress does not call private"),
        ("http://0.0.0.0/", "unspecified"),
        ("http://[::ffff:10.0.0.1]/", "IPv4-mapped IPv6, the classic v6 bypass"),
    ])
    def test_private_and_local_addresses_are_refused(self, url: str, why: str) -> None:
        with pytest.raises(safe_fetch.BlockedURLError):
            safe_fetch.resolve_and_validate(url)

    @pytest.mark.parametrize("url", [
        "file:///etc/passwd",
        "ftp://example.com/",
        "javascript:alert(1)",
        "data:text/html,<h1>x",
        "notaurl",
        "",
    ])
    def test_non_http_schemes_are_refused(self, url: str) -> None:
        with pytest.raises(safe_fetch.BlockedURLError):
            safe_fetch.resolve_and_validate(url)


class TestAddressClassification:
    """The predicate itself, without needing DNS."""

    @pytest.mark.parametrize("ip", [
        "127.0.0.1", "10.1.2.3", "172.20.0.5", "192.168.0.10",
        "169.254.169.254", "100.64.1.1", "::1", "fc00::1", "fe80::1", "0.0.0.0",
    ])
    def test_blocked(self, ip: str) -> None:
        import ipaddress
        assert safe_fetch._address_is_blocked(ipaddress.ip_address(ip)) is True

    @pytest.mark.parametrize("ip", ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700::1111"])
    def test_allowed(self, ip: str) -> None:
        import ipaddress
        assert safe_fetch._address_is_blocked(ipaddress.ip_address(ip)) is False


class TestLinkPreviewContract:
    """The endpoint's failure contract must not change shape.

    views/notes.js:976 reads {"ok": false, "error": ...} and renders the error.
    Hardening must not turn a refusal into an exception or a different shape.
    """

    @pytest.mark.parametrize("url", [
        "http://127.0.0.1:8765/",
        "http://169.254.169.254/",
        "http://192.168.1.1/",
        "file:///etc/passwd",
        "notaurl",
    ])
    def test_refusals_still_return_the_ok_false_envelope(self, url: str) -> None:
        result = link_preview_service.link_preview(url)
        assert result["ok"] is False
        assert isinstance(result["error"], str) and result["error"]

    def test_scheme_rejection_message_is_unchanged(self) -> None:
        """Pinned because it is user-visible in the Notes link-preview UI."""
        assert link_preview_service.link_preview("ftp://x")["error"] == "url must be http(s)"


class TestRedirectPolicy:
    def test_redirect_limit_is_small_and_declared(self) -> None:
        assert safe_fetch.MAX_REDIRECTS == 3

    def test_redirects_are_followed_manually_not_by_a_library(self) -> None:
        """Validating only the first URL is the usual way this is got wrong.

        fetch_text drives http.client directly and loops itself, so every hop
        goes back through resolve_and_validate. Nothing may hand redirect
        following to a library that would resolve and connect unchecked.
        """
        src = inspect.getsource(safe_fetch.fetch_text)
        assert "resolve_and_validate" in src
        assert "urljoin" in src and "continue" in src
        assert "urlopen" not in src and "build_opener" not in src


class TestPinnedConnection:
    """Pinning the address must not cost TLS identity.

    Connecting to https://<ip>/ sends the IP as SNI — CDNs answer that with a
    handshake failure, and the certificate would not validate either. The
    connection is made by hostname, with only the socket's destination
    overridden, so SNI and the certificate check still see the real host.
    """

    def test_https_connection_is_named_by_host_and_addressed_by_ip(self) -> None:
        target = safe_fetch.ResolvedTarget(hostname="example.com", ip="93.184.216.34", port=443, family=socket.AF_INET)
        conn = safe_fetch._connect(target, "https", timeout=1.0)
        try:
            assert isinstance(conn, http.client.HTTPSConnection)
            assert conn.host == "example.com"  # SNI + cert check + Host header
            captured: list[tuple[str, int]] = []
            with mock.patch.object(socket, "create_connection", lambda addr, *a, **k: captured.append(addr)):
                conn._create_connection(("example.com", 443), 1.0, None)
            assert captured == [("93.184.216.34", 443)]  # but the socket goes to the validated IP
        finally:
            conn.close()

    def test_plain_http_is_pinned_the_same_way(self) -> None:
        target = safe_fetch.ResolvedTarget(hostname="example.com", ip="93.184.216.34", port=80, family=socket.AF_INET)
        conn = safe_fetch._connect(target, "http", timeout=1.0)
        try:
            assert isinstance(conn, http.client.HTTPConnection)
            assert not isinstance(conn, http.client.HTTPSConnection)
            assert conn.host == "example.com"
        finally:
            conn.close()
