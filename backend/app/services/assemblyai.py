"""Mints a short-lived AssemblyAI streaming token server-side.

Browsers cannot set custom headers on a WebSocket handshake, so AssemblyAI's
Universal-Streaming (v3) API can only be authenticated from a browser with a
temporary token passed as a query parameter — never the permanent API key.
AssemblyAI's documented flow is: the server calls ``GET /v3/token`` with the
real key in the ``Authorization`` header, gets back a token good for a few
minutes and one connection, and hands that token (never the key) to the
frontend. The key itself is user-entered and kept in the browser's
``nl_api_keys`` localStorage like every other provider key — this service
never stores it, it only forwards it once per mic click.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request

TOKEN_URL = "https://streaming.assemblyai.com/v3/token"
EXPIRES_IN_SECONDS = 600  # AssemblyAI's documented max for this param
TIMEOUT_S = 8


def mint_token(api_key: str) -> dict:
    """Returns {"ok": True, "token": ...} or {"ok": False, "error": ...}.

    Never raises — mirrors the other services' best-effort contract so the
    router can wrap it with ``_passthrough``/``ok`` uniformly.
    """
    if not api_key:
        return {"ok": False, "error": "AssemblyAI API key required"}

    url = f"{TOKEN_URL}?expires_in_seconds={EXPIRES_IN_SECONDS}"
    request = urllib.request.Request(url, headers={"Authorization": api_key})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_S) as response:
            body = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        if exc.code in (401, 403):
            return {"ok": False, "error": "AssemblyAI rejected the API key"}
        return {"ok": False, "error": f"AssemblyAI token request failed ({exc.code})"}
    except (urllib.error.URLError, TimeoutError, ValueError, OSError) as exc:
        return {"ok": False, "error": f"could not reach AssemblyAI: {exc}"}

    token = body.get("token")
    if not token:
        return {"ok": False, "error": "AssemblyAI response had no token"}
    return {"ok": True, "token": token}
