"""Dev-only reverse proxy: ``/web/*`` on :8765 → the Vite dev server on :5173.

Why this exists at all. IndexedDB is scoped to an *origin*, and ``localhost`` and
``127.0.0.1`` are different origins, as are different ports. The legacy app and
the React app must read and write the same database, so the React app has to be
served from ``http://127.0.0.1:8765`` too. Developing it on Vite's own port would
open an empty database that looks exactly like data loss (see the handoff doc).
Proxying keeps one origin while keeping Vite's HMR.

Enabled only with ``NOTLINEAR_DEV_PROXY=1``. Without it, ``/web`` serves the
built ``web/dist`` as static files and none of this code is imported.

Fallback if the websocket pump ever proves flaky: leave the proxy off, run
``vite build --watch`` and let the static mount serve ``web/dist``. Slower
reloads, same origin, no moving parts. Recorded as accepted in ADR-039.
"""

from __future__ import annotations

import asyncio
import contextlib

import httpx
from fastapi import FastAPI, Request, Response, WebSocket
from fastapi.responses import PlainTextResponse, StreamingResponse
from starlette.background import BackgroundTask
from websockets.asyncio.client import connect as ws_connect
from websockets.exceptions import ConnectionClosed

from . import config

UPSTREAM = f"http://{config.VITE_HOST}:{config.VITE_PORT}"
WS_UPSTREAM = f"ws://{config.VITE_HOST}:{config.VITE_PORT}"

# RFC 9110 §7.6.1 hop-by-hop headers must not be forwarded by a proxy, and
# content-length/encoding are recomputed by the streaming layer.
_HOP_BY_HOP = {
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te",
    "trailers", "transfer-encoding", "upgrade", "host", "content-length",
}

_NOT_RUNNING = (
    "The Vite dev server is not running on 127.0.0.1:5173.\n"
    "Start it with:  cd web && pnpm dev\n"
)


def install(app: FastAPI) -> None:
    client = httpx.AsyncClient(base_url=UPSTREAM, follow_redirects=False, timeout=httpx.Timeout(30.0, read=None))

    # No explicit shutdown hook: this is a dev-only process and the OS closes
    # the client's sockets on exit.

    @app.api_route("/web", methods=["GET"])
    @app.api_route("/web/{path:path}", methods=["GET", "HEAD", "POST", "PUT", "DELETE", "OPTIONS"])
    async def proxy_http(request: Request, path: str = "") -> Response:
        target = "/web/" + path
        headers = {k: v for k, v in request.headers.items() if k.lower() not in _HOP_BY_HOP}
        try:
            upstream = await client.send(
                client.build_request(
                    request.method, target, params=request.query_params,
                    headers=headers, content=await request.body(),
                ),
                stream=True,
            )
        except httpx.ConnectError:
            return PlainTextResponse(_NOT_RUNNING, status_code=502)

        # Raw bytes + the original content-encoding keep the body untouched;
        # only content-length (recomputed by the streaming layer) is dropped.
        return StreamingResponse(
            upstream.aiter_raw(),
            status_code=upstream.status_code,
            headers={k: v for k, v in upstream.headers.items() if k.lower() not in _HOP_BY_HOP},
            background=BackgroundTask(upstream.aclose),
        )

    @app.websocket("/web/{path:path}")
    async def proxy_ws(ws: WebSocket, path: str) -> None:
        # Vite's HMR client negotiates the "vite-hmr" subprotocol; accepting
        # without echoing it makes the browser drop the connection.
        offered = [p.strip() for p in ws.headers.get("sec-websocket-protocol", "").split(",") if p.strip()]
        query = ws.scope.get("query_string", b"").decode()
        url = f"{WS_UPSTREAM}/web/{path}" + (f"?{query}" if query else "")
        try:
            async with ws_connect(url, subprotocols=offered or None, origin=UPSTREAM) as upstream:
                await ws.accept(subprotocol=upstream.subprotocol)
                await _pump(ws, upstream)
        except (OSError, ConnectionClosed):
            with contextlib.suppress(RuntimeError):
                await ws.close(code=1011)


async def _pump(ws: WebSocket, upstream: object) -> None:
    async def client_to_upstream() -> None:
        while True:
            msg = await ws.receive()
            if msg["type"] == "websocket.disconnect":
                return
            if msg.get("text") is not None:
                await upstream.send(msg["text"])  # type: ignore[attr-defined]
            elif msg.get("bytes") is not None:
                await upstream.send(msg["bytes"])  # type: ignore[attr-defined]

    async def upstream_to_client() -> None:
        async for data in upstream:  # type: ignore[attr-defined]
            if isinstance(data, str):
                await ws.send_text(data)
            else:
                await ws.send_bytes(data)

    tasks = [asyncio.create_task(client_to_upstream()), asyncio.create_task(upstream_to_client())]
    done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    for t in pending:
        t.cancel()
    for t in done:
        with contextlib.suppress(ConnectionClosed, RuntimeError):
            t.result()
