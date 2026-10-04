"""The twelve ``/__notlinear_*`` endpoints.

One router rather than four files: these are frozen legacy paths that will
never grow, and splitting twelve thin wrappers across four modules buys
nothing but imports. Each handler below replaces exactly one ``if path == ...``
block from ``backend/server.py``'s ``do_POST`` chain and keeps its status
codes and body shape.

Per AGENTS.md these paths may never be renamed; new functionality is a new
endpoint. ``tests/contract`` pins every one of them.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import PlainTextResponse

from .. import config
from ..legacy import LegacyJSONResponse, err, legacy_json, ok, read_json
from ..services import consent, feedback_store, link_preview as link_preview_service
from ..services import macos, project_scan, runtime_logs

router = APIRouter()


def _passthrough(result: dict[str, Any]) -> LegacyJSONResponse:
    """Returns a service dict as-is, honouring an optional ``_status`` hint.

    The services mirror the old handlers, which sometimes paired an
    ``{"ok": false}`` body with a non-200 status (409 for a double start, 500
    for a screencapture failure). ``_status`` carries that out of the service
    without making every caller branch.
    """
    status = result.pop("_status", 200)
    return LegacyJSONResponse(result, status_code=status)


@router.post("/__notlinear_pick_folder")
async def pick_folder(request: Request) -> LegacyJSONResponse:
    async def handler() -> LegacyJSONResponse:
        if not config.native_allowed():
            return err("native dialogs are disabled (NOTLINEAR_ALLOW_NATIVE=0)")
        result = macos.pick_folder()
        # The native dialog IS the consent, so this is the only place that
        # records a directory as approved (ADR-035).
        if result.get("ok") and result.get("path"):
            consent.allow(result["path"])
        return _passthrough(result)
    return await legacy_json(handler)


@router.post("/__notlinear_scan_project")
async def scan_project(request: Request) -> LegacyJSONResponse:
    async def handler() -> LegacyJSONResponse:
        data = await read_json(request)
        folder_path = (data.get("path") or "").strip()
        if not folder_path:
            return err("path required")
        # One-time migration. Anyone upgrading already has a project folder in
        # prefs, chosen through the picker in an earlier session — before any
        # ledger existed to record it. Without this they would hit 403 on the
        # first scan and it would look like the picker had broken.
        #
        # So: an EMPTY ledger trusts the first path it is given and records it.
        # That is trust-on-first-use, and it is weaker than requiring a fresh
        # pick. It is bounded to exactly one path, only while the ledger is
        # empty, and the alternative is breaking every existing install on
        # upgrade. Once seeded, every later path must be inside an approved
        # root.
        consent.seed_if_empty(folder_path)
        if not consent.is_allowed(folder_path):
            return err(consent.describe_refusal(folder_path), status=403)
        return _passthrough(project_scan.scan_project(folder_path))
    return await legacy_json(handler)


@router.post("/__notlinear_link_preview")
async def link_preview(request: Request) -> LegacyJSONResponse:
    async def handler() -> LegacyJSONResponse:
        data = await read_json(request)
        url = (data.get("url") or "").strip()
        if not url:
            return err("url required")
        return _passthrough(link_preview_service.link_preview(url))
    return await legacy_json(handler)


@router.post("/__notlinear_open_files")
async def open_files(request: Request) -> LegacyJSONResponse:
    async def handler() -> LegacyJSONResponse:
        if not config.native_allowed():
            return err("native dialogs are disabled (NOTLINEAR_ALLOW_NATIVE=0)")
        data = await read_json(request)
        return _passthrough(macos.open_files(bool(data.get("folder", False))))
    return await legacy_json(handler)


@router.post("/__notlinear_save_file")
async def save_file(request: Request) -> LegacyJSONResponse:
    async def handler() -> LegacyJSONResponse:
        if not config.native_allowed():
            return err("native dialogs are disabled (NOTLINEAR_ALLOW_NATIVE=0)")
        data = await read_json(request)
        filename = data.get("filename", "response.md")
        content = data.get("content", "")
        return _passthrough(macos.save_file(filename, content))
    return await legacy_json(handler)


@router.post("/__notlinear_feedback_shot")
async def feedback_shot(request: Request) -> LegacyJSONResponse:
    async def handler() -> LegacyJSONResponse:
        if not config.native_allowed():
            return err("native dialogs are disabled (NOTLINEAR_ALLOW_NATIVE=0)")
        data = await read_json(request)
        mode = (data.get("mode") or "full").strip()
        shot_path = feedback_store._feedback_media_path("shot", "png")
        return _passthrough(macos.screenshot(shot_path, mode))
    return await legacy_json(handler)


@router.post("/__notlinear_feedback_record")
async def feedback_record(request: Request) -> LegacyJSONResponse:
    async def handler() -> LegacyJSONResponse:
        if not config.native_allowed():
            return err("native dialogs are disabled (NOTLINEAR_ALLOW_NATIVE=0)")
        data = await read_json(request)
        action = (data.get("action") or "").strip()
        if action == "start":
            rec_path = feedback_store._feedback_media_path("rec", "mov")
            return _passthrough(macos.start_recording(rec_path, (data.get("mode") or "full")))
        if action == "stop":
            return _passthrough(macos.stop_recording())
        return err("action must be start or stop")
    return await legacy_json(handler)


@router.post("/__notlinear_feedback_upload")
async def feedback_upload(request: Request) -> LegacyJSONResponse:
    async def handler() -> LegacyJSONResponse:
        import base64
        data = await read_json(request)
        # _media_file_from_rel raises if the path escapes feedback/media/ —
        # the only guard between a client string and a server-side write.
        target = feedback_store._media_file_from_rel(data.get("path"))
        target.write_bytes(base64.b64decode(data.get("base64") or ""))
        return ok({"path": str(target.relative_to(config.REPO_ROOT))})
    return await legacy_json(handler)


@router.post("/__notlinear_feedback_discard")
async def feedback_discard(request: Request) -> LegacyJSONResponse:
    async def handler() -> LegacyJSONResponse:
        data = await read_json(request)
        target = feedback_store._media_file_from_rel(data.get("path"))
        if target.exists():
            target.unlink()
        return ok()
    return await legacy_json(handler)


@router.post("/__notlinear_feedback_list")
async def feedback_list(request: Request) -> LegacyJSONResponse:
    async def handler() -> LegacyJSONResponse:
        return ok({"entries": feedback_store._feedback_parse_entries()})
    return await legacy_json(handler)


@router.post("/__notlinear_feedback_save")
async def feedback_save(request: Request) -> LegacyJSONResponse:
    async def handler() -> LegacyJSONResponse:
        data = await read_json(request)
        fb_id = feedback_store._feedback_append_entry(data)
        return ok({"id": fb_id, "path": str(config.FEEDBACK_PATH.relative_to(config.REPO_ROOT))})
    return await legacy_json(handler)


@router.post("/__notlinear_runtime_logs")
async def post_runtime_logs(request: Request) -> Any:
    """The odd one out.

    The stdlib handler used ``send_error`` for its failure paths, which emits
    an HTML error page rather than the JSON envelope every other endpoint
    returns. Status codes are reproduced exactly; the error-path *bodies* are
    explicitly out of contract (see the P2 ADR), because reproducing
    BaseHTTPRequestHandler's HTML is not worth it and nothing parses it.
    """
    raw = await request.body()
    if len(raw) > config.MAX_BODY_BYTES:
        return PlainTextResponse("Runtime log payload too large", status_code=413)
    try:
        data = await read_json(request) if raw else {}
        events = data.get("events", [])
        if not isinstance(events, list):
            raise ValueError("events must be a list")
        block = runtime_logs.runtime_log_block(events)
        logs_path = runtime_logs.LOGS_PATH
        existing = logs_path.read_text(encoding="utf-8") if logs_path.exists() else "# Runtime logs\n"
        logs_path.write_text(runtime_logs.replace_runtime_log_section(existing, block), encoding="utf-8")
    except Exception as exc:  # noqa: BLE001 - parity with the old handler
        return PlainTextResponse(f"Could not write runtime logs: {exc}", status_code=400)
    return ok({"events": min(len(events), config.MAX_EVENTS)})
