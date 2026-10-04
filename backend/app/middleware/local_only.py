"""Origin gating for the ``/__notlinear_*`` endpoints.

Carries over the P0 hotfix from ``backend/server.py``. The reasoning is worth
repeating because the original comment got it wrong for months: binding to
127.0.0.1 stops other *machines* connecting, and does nothing about other
*pages in this user's own browser*. With ``Access-Control-Allow-Origin: *``,
any site visited while notlinear was running could POST to
``/__notlinear_open_files``, pass the preflight, have a native file picker
opened, and read the chosen file's bytes out of the response.

So the allow header is echoed only for the exact loopback origins this server
is bound to, ``Vary: Origin`` is always sent so no cache can hand one origin's
allow header to another, and a preflight from anywhere else is refused with
403 before any handler runs.
"""

from __future__ import annotations

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import PlainTextResponse, Response

from ..config import dev_proxy_enabled

LEGACY_PREFIX = "/__notlinear_"


def allowed_origins(port: int) -> set[str]:
    origins = {
        f"http://127.0.0.1:{port}",
        f"http://localhost:{port}",
        f"http://[::1]:{port}",
    }
    if dev_proxy_enabled():
        # The Vite dev server during P3. Only when explicitly switched on.
        origins.add("http://127.0.0.1:5173")
    return origins


class LocalOriginMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: object, port: int) -> None:
        super().__init__(app)  # type: ignore[arg-type]
        self.port = port

    def _origin_if_allowed(self, request: Request) -> str | None:
        origin = request.headers.get("origin")
        if not origin:
            return None
        # The bound port is authoritative, but a request can arrive on a
        # different port when something proxies to us, so accept the Host
        # header's port too when it is a loopback host.
        ports = {self.port}
        host = request.headers.get("host", "")
        if ":" in host:
            hostname, _, hostport = host.rpartition(":")
            if hostname in {"127.0.0.1", "localhost", "[::1]"} and hostport.isdigit():
                ports.add(int(hostport))
        for port in ports:
            if origin in allowed_origins(port):
                return origin
        return None

    async def dispatch(self, request: Request, call_next: RequestResponseEndpoint) -> Response:
        is_legacy = request.url.path.startswith(LEGACY_PREFIX)
        origin = self._origin_if_allowed(request)

        if request.method == "OPTIONS" and is_legacy:
            if origin is None:
                refused = PlainTextResponse("", status_code=403)
                refused.headers["Vary"] = "Origin"
                return refused
            preflight = PlainTextResponse("", status_code=200)
            preflight.headers["Vary"] = "Origin"
            preflight.headers["Access-Control-Allow-Origin"] = origin
            preflight.headers["Access-Control-Allow-Methods"] = "POST, OPTIONS"
            preflight.headers["Access-Control-Allow-Headers"] = "Content-Type"
            return preflight

        response = await call_next(request)
        response.headers["Vary"] = "Origin"
        if origin is not None:
            response.headers["Access-Control-Allow-Origin"] = origin
        return response
