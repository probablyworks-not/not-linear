"""Paths, limits and feature flags, moved verbatim from backend/server.py.

Every value here keeps the meaning it had in the stdlib server. Changing one
changes behaviour the contract tests pin, so treat this as transcription
rather than a place to tidy things up.
"""

from __future__ import annotations

import os
from pathlib import Path

# This file is <repo>/backend/app/config.py, so:
#   parents[0] = backend/app   parents[1] = backend   parents[2] = <repo>
# APP_DIR keeps the meaning it had in backend/server.py (the backend/ dir).
APP_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = Path(__file__).resolve().parents[2]

FRONTEND_DIR = REPO_ROOT / "frontend"
WEB_DIST_DIR = REPO_ROOT / "web" / "dist"
TOOLS_DIR = REPO_ROOT / "tools"

LOGS_PATH = REPO_ROOT / "logs.md"
CHANGELOG_PATH = REPO_ROOT / "CHANGELOG.md"
LOGO_PATH = REPO_ROOT / "logo.svg"
# The compiled Notlinear.app binary loads http://127.0.0.1:8765/notlinear.html
# (confirmed with `strings` on the bundle). It is a meta-refresh shim to
# frontend/index.html, and the app shows a 404 without it.
NOTLINEAR_HTML_PATH = REPO_ROOT / "notlinear.html"

FEEDBACK_DIR = REPO_ROOT / "feedback"
FEEDBACK_MEDIA_DIR = FEEDBACK_DIR / "media"
FEEDBACK_PATH = FEEDBACK_DIR / "FEEDBACK.md"

# Caps on the runtime-log POST body and stored event count.
MAX_BODY_BYTES = 1_500_000
MAX_EVENTS = 300

# Link preview limits — values copied from backend/server.py:337-338. The
# timeout is 6s, not 8: transcribing it from memory is exactly how behaviour
# drifts during a "verbatim" move.
LINK_PREVIEW_TIMEOUT_S = 6   # give up fast rather than hang a request on a slow/unresponsive site
LINK_PREVIEW_MAX_BYTES = 512_000  # only need the <head>; avoids downloading huge pages in full

# Runtime-log section markers in logs.md (server.py:84-85).
LOG_START = "<!-- notlinear-runtime-log:start -->"
LOG_END = "<!-- notlinear-runtime-log:end -->"

DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8765


def dev_proxy_enabled() -> bool:
    """True when /web/* should be proxied to the Vite dev server (P3)."""
    return os.environ.get("NOTLINEAR_DEV_PROXY") == "1"


def fake_native() -> bool:
    """True when osascript/screencapture should be stubbed (tests, CI)."""
    return os.environ.get("NOTLINEAR_FAKE_NATIVE") == "1"


def native_allowed() -> bool:
    """False disables every endpoint that shells out to a native dialog."""
    return os.environ.get("NOTLINEAR_ALLOW_NATIVE", "1") != "0"
