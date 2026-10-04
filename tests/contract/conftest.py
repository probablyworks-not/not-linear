"""Shared fixtures for the legacy endpoint contract tests.

These tests pin the current behaviour of every ``/__notlinear_*`` endpoint so
that P2's move to FastAPI can be proved byte-identical rather than asserted to
be. The ``server`` fixture is parametrised by the ``NOTLINEAR_SERVER``
environment variable so the exact same test file can be run against either
implementation:

    NOTLINEAR_SERVER=legacy  pytest tests/contract    # today (default)
    NOTLINEAR_SERVER=fastapi pytest tests/contract    # P2 onwards

The server runs **in-process** on a thread rather than as a subprocess. That is
deliberate: every native dialog in ``backend/server.py`` goes through
``subprocess.run``, and running in-process is what lets a test replace it. A
subprocess server would pop real macOS dialogs and hang the suite.

Safety: ``backend/server.py`` resolves ``LOGS_PATH``, ``FEEDBACK_DIR`` and
``FEEDBACK_MEDIA_DIR`` at import time, relative to the repo. Left alone, the
tests would append to the developer's real ``logs.md`` and scatter files in
``feedback/media/``. The ``isolated_paths`` fixture is autouse so that cannot
happen by omission — a test has to opt out, not opt in.
"""

from __future__ import annotations

import importlib.util
import socket
import sys
import threading
from http.server import ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable, Iterator

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SERVER_PY = REPO_ROOT / "backend" / "server.py"


def _load_legacy_server() -> Any:
    """Imports backend/server.py as a module without running main()."""
    spec = importlib.util.spec_from_file_location("notlinear_server_under_test", SERVER_PY)
    if spec is None or spec.loader is None:  # pragma: no cover - import plumbing
        raise RuntimeError(f"could not load {SERVER_PY}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


@pytest.fixture(scope="session")
def server_module() -> Any:
    """The imported backend/server.py module."""
    which = __import__("os").environ.get("NOTLINEAR_SERVER", "legacy")
    if which == "legacy":
        return _load_legacy_server()
    # P2 will add the FastAPI app here. Failing loudly beats silently testing
    # the legacy server while believing FastAPI was covered.
    raise pytest.UsageError(
        f"NOTLINEAR_SERVER={which!r} is not available yet; the FastAPI app arrives in P2"
    )


@pytest.fixture(autouse=True)
def isolated_paths(server_module: Any, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Redirects every path the server writes to into a temp directory.

    Autouse on purpose: forgetting it would mean a test appending to the real
    logs.md or writing screenshots into the repo.
    """
    logs = tmp_path / "logs.md"
    feedback = tmp_path / "feedback"
    media = feedback / "media"
    media.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(server_module, "LOGS_PATH", logs, raising=False)
    monkeypatch.setattr(server_module, "FEEDBACK_DIR", feedback, raising=False)
    monkeypatch.setattr(server_module, "FEEDBACK_MEDIA_DIR", media, raising=False)
    # FEEDBACK_PATH was missed on the first pass: feedback_list READ the real
    # feedback/FEEDBACK.md and feedback_save would have WRITTEN to it.
    monkeypatch.setattr(server_module, "FEEDBACK_PATH", feedback / "FEEDBACK.md", raising=False)


@pytest.fixture
def fake_native(server_module: Any, monkeypatch: pytest.MonkeyPatch) -> Callable[..., None]:
    """Replaces ``subprocess.run`` so no real macOS dialog is ever opened.

    Returns a configure function so a test can choose what the fake dialog
    "returns" — a chosen path, an empty string for a cancelled dialog, or a
    non-zero exit for a failure.
    """

    class FakeCompleted:
        def __init__(self, stdout: str = "", stderr: str = "", returncode: int = 0) -> None:
            self.stdout = stdout
            self.stderr = stderr
            self.returncode = returncode

    state: dict[str, Any] = {"stdout": "", "stderr": "", "returncode": 0, "calls": []}

    def fake_run(cmd: Any, *args: Any, **kwargs: Any) -> FakeCompleted:
        state["calls"].append(cmd)
        return FakeCompleted(state["stdout"], state["stderr"], state["returncode"])

    monkeypatch.setattr(server_module.subprocess, "run", fake_run)

    def configure(stdout: str = "", stderr: str = "", returncode: int = 0) -> None:
        state.update(stdout=stdout, stderr=stderr, returncode=returncode)

    configure.calls = state["calls"]  # type: ignore[attr-defined]
    return configure


@pytest.fixture
def server(server_module: Any, isolated_paths: None) -> Iterator[str]:
    """Boots the handler on an ephemeral port; yields the base URL."""
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]

    handler = server_module.NotlinearHandler
    httpd = ThreadingHTTPServer(
        ("127.0.0.1", port),
        lambda *a, **kw: handler(*a, directory=str(REPO_ROOT), **kw),
    )
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{port}"
    finally:
        httpd.shutdown()
        httpd.server_close()
        thread.join(timeout=5)


@pytest.fixture
def origin(server: str) -> str:
    """The server's own origin — the only one CORS now accepts."""
    return server
