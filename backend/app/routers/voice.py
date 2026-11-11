"""Voice-input endpoint: mints an AssemblyAI streaming token.

Added after the twelve frozen legacy endpoints (AGENTS.md: new work is a new
endpoint). Same conventions as ``notes.py``: a bare ``Request``, hand-parsed
JSON, ``legacy_json`` for the error envelope. The ``/__notlinear_`` prefix
means ``LocalOriginMiddleware`` gates it too.
"""

from __future__ import annotations

from fastapi import APIRouter, Request

from ..legacy import LegacyJSONResponse, err, legacy_json, ok, read_json
from ..services import assemblyai

router = APIRouter()


@router.post("/__notlinear_assemblyai_token")
async def assemblyai_token(request: Request) -> LegacyJSONResponse:
    async def handler() -> LegacyJSONResponse:
        data = await read_json(request)
        key = (data.get("key") or "").strip()
        result = assemblyai.mint_token(key)
        if not result.get("ok"):
            return err(result.get("error", "could not mint token"))
        return ok({"token": result["token"]})
    return await legacy_json(handler)
