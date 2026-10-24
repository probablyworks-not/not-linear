"""The FastAPI application.

Static serving is an explicit allowlist, never the repository root: the built
web app under ``/web``, the backup/restore pages under ``/tools``, and two
single files the app fetches (``/CHANGELOG.md`` and ``/logo.svg``). Everything
else is a 404. ``logs.md`` is write-only (POST ``/__notlinear_runtime_logs``) and
needs no static route at all.
"""

from __future__ import annotations

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from . import config
from .middleware.local_only import LocalOriginMiddleware
from .routers.endpoints import router as legacy_router
from .routers.notes import router as notes_router


def create_app(port: int = config.DEFAULT_PORT) -> FastAPI:
    app = FastAPI(
        title="notlinear",
        docs_url=None,       # no public API surface; this is a local app server
        redoc_url=None,
        openapi_url=None,
    )

    app.add_middleware(LocalOriginMiddleware, port=port)
    app.include_router(legacy_router)
    app.include_router(notes_router)

    @app.get("/CHANGELOG.md")
    async def changelog() -> FileResponse:
        # The in-app changelog viewer has a bundled fallback, so a miss is cosmetic.
        if not config.CHANGELOG_PATH.is_file():
            raise HTTPException(status_code=404)
        return FileResponse(config.CHANGELOG_PATH, media_type="text/markdown")

    @app.get("/logo.svg")
    async def logo() -> FileResponse:
        return FileResponse(config.LOGO_PATH, media_type="image/svg+xml")

    @app.get("/")
    async def root() -> RedirectResponse:
        return RedirectResponse("/web/")

    # Mounted last so the explicit routes above win on any overlap.
    if config.TOOLS_DIR.exists():
        # The backup/restore pages. Kept reachable because they must work even
        # when the app itself is mid-migration or broken.
        app.mount("/tools", StaticFiles(directory=config.TOOLS_DIR), name="tools")
    if config.dev_proxy_enabled():
        # Imported lazily so the production path carries no websocket/httpx
        # proxy code. Registers /web routes; must come before nothing else
        # claims /web, hence instead of (not alongside) the static mount.
        from . import dev_proxy
        dev_proxy.install(app)
    elif config.WEB_DIST_DIR.exists():
        app.mount("/web", StaticFiles(directory=config.WEB_DIST_DIR, html=True), name="web")

    return app


app = create_app()
