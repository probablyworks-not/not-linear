"""/__notlinear_assemblyai_token: mints a short-lived AssemblyAI streaming token.

An added endpoint, not one of the twelve frozen ones, so it exists on the FastAPI server only.
Never hits the real AssemblyAI API — ``app.services.assemblyai``'s own urlopen call is faked.
"""

from __future__ import annotations

import json
from typing import Any, Callable

import pytest
import requests

PATH = "/__notlinear_assemblyai_token"
HEADERS = {"Content-Type": "application/json", "X-Notlinear-Local": "1"}


def post(server: str, body: Any, headers: dict[str, str] | None = None) -> requests.Response:
    return requests.post(f"{server}{PATH}", data=json.dumps(body), headers=headers or HEADERS, timeout=10)


class FakeResponse:
    def __init__(self, body: dict[str, Any]) -> None:
        self._raw = json.dumps(body).encode("utf-8")

    def read(self) -> bytes:
        return self._raw

    def __enter__(self) -> "FakeResponse":
        return self

    def __exit__(self, *exc: Any) -> None:
        return None


@pytest.fixture
def fake_assemblyai(monkeypatch: pytest.MonkeyPatch) -> Callable[..., None]:
    import urllib.error

    from app.services import assemblyai

    state: dict[str, Any] = {"mode": "ok", "captured_key": None}

    def fake_urlopen(request: Any, timeout: float) -> FakeResponse:
        state["captured_key"] = request.get_header("Authorization")
        if state["mode"] == "unauthorized":
            raise urllib.error.HTTPError(request.full_url, 401, "Unauthorized", None, None)
        if state["mode"] == "down":
            raise urllib.error.URLError("connection refused")
        return FakeResponse({"token": "fake-token-123"})

    monkeypatch.setattr(assemblyai.urllib.request, "urlopen", fake_urlopen)

    def configure(mode: str = "ok") -> None:
        state["mode"] = mode

    configure.captured_key = lambda: state["captured_key"]  # type: ignore[attr-defined]
    return configure


def test_missing_key_is_rejected_without_calling_assemblyai(server: str, fake_assemblyai: Any) -> None:
    r = post(server, {})
    assert r.status_code == 400 and r.json()["ok"] is False
    assert fake_assemblyai.captured_key() is None


def test_mints_a_token_and_sends_the_key_as_authorization(server: str, fake_assemblyai: Any) -> None:
    r = post(server, {"key": "test-aai-key"})
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True and body["token"] == "fake-token-123"
    assert fake_assemblyai.captured_key() == "test-aai-key"


def test_an_invalid_key_is_reported_as_a_clean_error(server: str, fake_assemblyai: Any) -> None:
    fake_assemblyai(mode="unauthorized")
    r = post(server, {"key": "bad-key"})
    assert r.status_code == 400
    assert r.json() == {"ok": False, "error": "AssemblyAI rejected the API key"}


def test_a_network_failure_is_reported_not_raised(server: str, fake_assemblyai: Any) -> None:
    fake_assemblyai(mode="down")
    r = post(server, {"key": "test-aai-key"})
    assert r.status_code == 400
    assert r.json()["ok"] is False
    assert "could not reach assemblyai" in r.json()["error"].lower()


def test_requires_the_local_header(server: str, fake_assemblyai: Any) -> None:
    r = post(server, {"key": "test-aai-key"}, headers={"Content-Type": "application/json"})
    assert r.status_code == 403
    assert fake_assemblyai.captured_key() is None
