"""Endpoints added after the twelve frozen legacy ones (AGENTS.md: new work is a new endpoint).

Same rules as the legacy router: a bare ``Request``, hand-parsed JSON, ``legacy_json`` for the
error envelope. The ``/__notlinear_`` prefix means ``LocalOriginMiddleware`` gates it too.
"""

from __future__ import annotations

from fastapi import APIRouter, Request

from ..legacy import LegacyJSONResponse, err, legacy_json, ok, read_json
from ..services import notes_backup

router = APIRouter()


@router.post("/__notlinear_backup_notes")
async def backup_notes(request: Request) -> LegacyJSONResponse:
    async def handler() -> LegacyJSONResponse:
        raw = await request.body()
        if len(raw) > notes_backup.MAX_BYTES:
            return err("backup is too large", status=413)
        data = await read_json(request)
        return ok(notes_backup.save_notes_backup(data.get("backup")))
    return await legacy_json(handler)
