"""The /web/* dev proxy (P3, ADR-039).

Runs a tiny fake "Vite" on a free port and drives the proxy through Starlette's
TestClient. Not a contract test of the legacy endpoints, so it lives apart from
tests/contract and needs no server fixture. Touches no filesystem path, which
is what BUGS.md #053 is about.
"""

from __future__ import annotations

import socket
import sys
import threading
import time
from pathlib import Path
from typing import Iterator

import pytest
import uvicorn
from fastapi import FastAPI
from fastapi.responses import HTMLResponse, PlainTextResponse
from fastapi.testclient import TestClient
from starlette.websockets import WebSocket

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))
from app import dev_proxy  # noqa: E402


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _fake_vite() -> FastAPI:
    up = FastAPI()
    seen: dict[str, str] = {}
    up.state.seen = seen

    @up.get("/web/", response_class=HTMLResponse)
    async def index() -> str:
        return "<!doctype html><title>fake vite</title>"

    @up.get("/web/src/main.tsx")
    async def module() -> PlainTextResponse:
        return PlainTextResponse("export {}", headers={"content-type": "text/javascript", "x-from-vite": "1"})

    @up.get("/web/echo-query")
    async def echo_query(q: str = "") -> PlainTextResponse:
        return PlainTextResponse(q)

    @up.get("/web/missing")
    async def missing() -> PlainTextResponse:
        return PlainTextResponse("nope", status_code=404)

    @up.websocket("/web/@vite-hmr")
    async def hmr(ws: WebSocket) -> None:
        await ws.accept(subprotocol="vite-hmr")
        await ws.send_text('{"type":"connected"}')
        while True:
            msg = await ws.receive_text()
            await ws.send_text("echo:" + msg)

    return up


@pytest.fixture(scope="module")
def upstream_port() -> Iterator[int]:
    port = _free_port()
    server = uvicorn.Server(uvicorn.Config(_fake_vite(), host="127.0.0.1", port=port, log_level="error"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    for _ in range(100):
        if server.started:
            break
        time.sleep(0.05)
    yield port
    server.should_exit = True
    thread.join(timeout=5)


@pytest.fixture()
def client(upstream_port: int, monkeypatch: pytest.MonkeyPatch) -> Iterator[TestClient]:
    monkeypatch.setattr(dev_proxy, "UPSTREAM", f"http://127.0.0.1:{upstream_port}")
    monkeypatch.setattr(dev_proxy, "WS_UPSTREAM", f"ws://127.0.0.1:{upstream_port}")
    app = FastAPI()
    dev_proxy.install(app)
    with TestClient(app) as c:
        yield c


def test_proxies_html_and_modules_with_upstream_headers(client: TestClient) -> None:
    r = client.get("/web/")
    assert r.status_code == 200 and "fake vite" in r.text
    m = client.get("/web/src/main.tsx")
    assert m.text == "export {}"
    assert m.headers["x-from-vite"] == "1"
    assert m.headers["content-type"].startswith("text/javascript")


def test_bare_web_path_reaches_the_index(client: TestClient) -> None:
    # Vite redirects /web → /web/ itself; the proxy must at least not 404 or hang.
    assert client.get("/web", follow_redirects=True).status_code == 200


def test_query_string_survives(client: TestClient) -> None:
    assert client.get("/web/echo-query", params={"q": "a b&c"}).text == "a b&c"


def test_upstream_status_is_preserved(client: TestClient) -> None:
    r = client.get("/web/missing")
    assert r.status_code == 404 and r.text == "nope"


def test_hmr_websocket_negotiates_subprotocol_and_pumps_both_ways(client: TestClient) -> None:
    with client.websocket_connect("/web/@vite-hmr", subprotocols=["vite-hmr"]) as ws:
        assert ws.accepted_subprotocol == "vite-hmr"
        assert ws.receive_text() == '{"type":"connected"}'
        ws.send_text("ping")
        assert ws.receive_text() == "echo:ping"
        ws.send_text("again")
        assert ws.receive_text() == "echo:again"


def test_vite_not_running_is_a_calm_502(monkeypatch: pytest.MonkeyPatch) -> None:
    dead = _free_port()  # bound then released: nothing is listening
    monkeypatch.setattr(dev_proxy, "UPSTREAM", f"http://127.0.0.1:{dead}")
    app = FastAPI()
    dev_proxy.install(app)
    with TestClient(app) as c:
        r = c.get("/web/")
    assert r.status_code == 502
    assert "pnpm dev" in r.text


def test_does_not_shadow_legacy_endpoints(client: TestClient) -> None:
    # Only /web is proxied; anything else on the app is untouched.
    assert client.get("/frontend/index.html").status_code == 404
