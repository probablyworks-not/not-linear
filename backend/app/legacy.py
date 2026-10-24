"""Response shapes that FastAPI would otherwise change silently.

The stdlib handler's ``_json`` sends exactly ``content-type: application/json``
with a content-length and the CORS headers, and every handler wraps its body in
``try/except`` returning ``{"ok": false, "error": str(exc)}`` with status 500.
FastAPI does none of that by default:

* ``JSONResponse`` appends ``; charset=utf-8`` to the content type.
* A Pydantic model returns ``422`` with ``{"detail": [...]}`` where these
  handlers return ``400`` with ``{"ok": false, "error": "..."}``.
* An unhandled exception renders an HTML 500 page.

So the routers take a bare ``Request``, parse the body themselves, and wrap
their handler in ``legacy_json``. No ``response_model`` anywhere.
"""

from __future__ import annotations

import json
from typing import Any, Awaitable, Callable

from fastapi import Request
from fastapi.responses import JSONResponse


class LegacyJSONResponse(JSONResponse):
    """JSONResponse without the ``; charset=utf-8`` suffix.

    ``media_type`` alone is not enough — Starlette appends the charset for any
    JSON media type unless ``charset`` is cleared too.
    """

    media_type = "application/json"

    def render(self, content: Any) -> bytes:
        return json.dumps(content, separators=(",", ":"), ensure_ascii=False).encode("utf-8")

    def init_headers(self, headers: dict[str, str] | None = None) -> None:
        super().init_headers(headers)
        # Starlette has already written "application/json; charset=utf-8".
        self.raw_headers = [
            (b"content-type", b"application/json") if k.lower() == b"content-type" else (k, v)
            for k, v in self.raw_headers
        ]


def ok(payload: dict[str, Any] | None = None, status: int = 200) -> LegacyJSONResponse:
    body: dict[str, Any] = {"ok": True}
    if payload:
        body.update(payload)
    return LegacyJSONResponse(body, status_code=status)


def err(message: str, status: int = 400, **extra: Any) -> LegacyJSONResponse:
    body: dict[str, Any] = {"ok": False, "error": message}
    body.update(extra)
    return LegacyJSONResponse(body, status_code=status)


async def read_json(request: Request) -> dict[str, Any]:
    """Parses the body by hand so malformed JSON is a 400, not a 422."""
    raw = await request.body()
    if not raw:
        return {}
    try:
        data = json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError) as exc:
        raise ValueError(f"invalid JSON body: {exc}") from exc
    return data if isinstance(data, dict) else {}


async def legacy_json(
    handler: Callable[[], Awaitable[LegacyJSONResponse]],
) -> LegacyJSONResponse:
    """Reproduces the stdlib handler's blanket try/except.

    Every endpoint in the old server ends with
    ``except Exception as exc: self._json(500, {"ok": False, "error": str(exc)})``.
    Without this an unhandled exception would render FastAPI's HTML 500 page,
    which the frontend cannot parse.
    """
    try:
        return await handler()
    except ValueError as exc:
        return err(str(exc), status=400)
    except Exception as exc:  # noqa: BLE001 - deliberate parity with the old server
        return err(str(exc), status=500)
