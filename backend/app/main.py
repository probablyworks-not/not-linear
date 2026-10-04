"""The FastAPI application.

Replaces ``ThreadingHTTPServer(..., directory=REPO_ROOT)``, which served the
**entire repository** over HTTP — ``GET /BUGS.md`` returned 96 KB of private
triage, ``/uploads/`` returned personal screenshots, and
``/docs/project-notes/`` was fully browsable. Static serving here is an
explicit allowlist instead: ``/frontend``, ``/tools``, ``/feedback/media``, and
two single files the app actually fetches.

Only two paths outside ``/frontend`` were ever needed:
  * ``/CHANGELOG.md`` — the in-app changelog viewer (app.js:4443), which has a
    hardcoded fallback, so a miss here is cosmetic rather than fatal.
  * ``/feedback/media/*`` — feedback.js:317,322 set ``img.src``/``video.src``
    to these, and they must be same-origin or the annotate canvas is tainted
    and ``toDataURL`` throws.
``logs.md`` is write-only (POST ``/__notlinear_runtime_logs``) and needs no
static route at all.
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from . import config
from .middleware.local_only import LocalOriginMiddleware
from .routers.endpoints import router as legacy_router


def create_app(port: int = config.DEFAULT_PORT) -> FastAPI:
    app = FastAPI(
        title="notlinear",
        docs_url=None,       # no public API surface; this is a local app server
        redoc_url=None,
        openapi_url=None,
    )

    app.add_middleware(LocalOriginMiddleware, port=port)
    app.include_router(legacy_router)

    @app.get("/CHANGELOG.md")
    async def changelog() -> FileResponse:
        return FileResponse(config.CHANGELOG_PATH, media_type="text/markdown")

    @app.get("/notlinear.html")
    async def notlinear_html() -> FileResponse:
        """The entry point the compiled Notlinear.app binary loads.

        A 13-line meta-refresh to frontend/index.html. Dropping it from the
        allowlist made the desktop app render a 404 — caught only because the
        shim was exercised against the URL the bundle actually requests.
        """
        return FileResponse(config.NOTLINEAR_HTML_PATH, media_type="text/html")

    @app.get("/logo.svg")
    async def logo() -> FileResponse:
        return FileResponse(config.LOGO_PATH, media_type="image/svg+xml")

    @app.get("/")
    async def root() -> RedirectResponse:
        # Flipped to /web/ at the P6 gate. This single line is the rollback
        # switch between the legacy app and the React one.
        return RedirectResponse("/frontend/index.html")

    # Mounted last so the explicit routes above win on any overlap.
    app.mount("/frontend", StaticFiles(directory=config.FRONTEND_DIR), name="frontend")
    if config.TOOLS_DIR.exists():
        # The backup/restore pages. Kept reachable because they must work even
        # when the app itself is mid-migration or broken.
        app.mount("/tools", StaticFiles(directory=config.TOOLS_DIR), name="tools")
    config.FEEDBACK_MEDIA_DIR.mkdir(parents=True, exist_ok=True)
    app.mount("/feedback/media", StaticFiles(directory=config.FEEDBACK_MEDIA_DIR), name="feedback-media")
    if config.WEB_DIST_DIR.exists():
        app.mount("/web", StaticFiles(directory=config.WEB_DIST_DIR, html=True), name="web")

    return app


app = create_app()
