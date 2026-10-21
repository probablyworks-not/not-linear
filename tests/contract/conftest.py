"""Shared fixtures for the endpoint contract tests.

These tests pin the behaviour of every ``/__notlinear_*`` endpoint. The server
runs **in-process** on a thread rather than as a subprocess. That is
deliberate: every native dialog goes through ``subprocess.run``, and running
in-process is what lets a test replace it. A subprocess server would pop real
macOS dialogs and hang the suite.

Safety: the app resolves its log path at import time, relative to the repo.
Left alone, the tests would append to the developer's real ``logs.md``. ``isolated_paths`` is autouse so
that cannot happen by omission.
"""

from __future__ import annotations

import socket
import sys
import threading
from pathlib import Path
from typing import Any, Callable, Iterator

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "backend"))


@pytest.fixture(scope="session")
def server_module() -> Any:
    """A small shim exposing the constants the tests read, sourced from backend/app."""
    from app import config
    from app.services import runtime_logs

    class FastApiFacade:
        """Presents backend/app under the names the tests already use."""
        subprocess = __import__("app.services.macos", fromlist=["subprocess"]).subprocess
        REPO_ROOT = config.REPO_ROOT

        @property
        def LOGS_PATH(self) -> Path:
            return runtime_logs.LOGS_PATH

        @property
        def MAX_BODY_BYTES(self) -> int:
            return config.MAX_BODY_BYTES

        @property
        def MAX_EVENTS(self) -> int:
            return config.MAX_EVENTS

    return FastApiFacade()


@pytest.fixture(autouse=True)
def isolated_paths(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Redirects every path either implementation writes to into a temp dir.

    Autouse on purpose. See BUGS.md #053: a sweep that POSTs to all twelve
    endpoints also POSTs to runtime_logs, which writes a real entry.
    """
    logs = tmp_path / "logs.md"

    # Each service holds its own imported copy of the path, and the
    # routers read them off the module at call time, so patching the service
    # module is what takes effect.
    from app import config as app_config
    from app.services import consent, notes_backup, runtime_logs

    # The consent ledger lives in ~/.notlinear by default. Without this a test
    # run writes into the developer's home directory — which it did, once,
    # before this line existed. Same failure as BUGS.md #053: a new
    # module-level path was added without extending this fixture.
    monkeypatch.setattr(consent, "LEDGER_DIR", tmp_path / "consent", raising=False)
    monkeypatch.setattr(consent, "LEDGER_PATH", tmp_path / "consent" / "allowed_roots.json", raising=False)

    # Added with /__notlinear_backup_notes (ADR-042): the default is ~/.notlinear/backups.
    monkeypatch.setattr(notes_backup, "BACKUP_DIR", tmp_path / "backups", raising=False)

    monkeypatch.setattr(runtime_logs, "LOGS_PATH", logs, raising=False)
    monkeypatch.setattr(app_config, "LOGS_PATH", logs, raising=False)


@pytest.fixture
def fake_native(server_module: Any, monkeypatch: pytest.MonkeyPatch) -> Callable[..., None]:
    """Replaces ``subprocess.run`` so no real macOS dialog is ever opened."""

    class FakeCompleted:
        def __init__(self, stdout: str = "", stderr: str = "", returncode: int = 0) -> None:
            self.stdout, self.stderr, self.returncode = stdout, stderr, returncode

    state: dict[str, Any] = {"stdout": "", "stderr": "", "returncode": 0, "calls": []}

    def fake_run(cmd: Any, *args: Any, **kwargs: Any) -> FakeCompleted:
        state["calls"].append(cmd)
        return FakeCompleted(state["stdout"], state["stderr"], state["returncode"])

    from app.services import macos
    monkeypatch.setattr(macos.subprocess, "run", fake_run)

    def configure(stdout: str = "", stderr: str = "", returncode: int = 0) -> None:
        state.update(stdout=stdout, stderr=stderr, returncode=returncode)

    configure.calls = state["calls"]  # type: ignore[attr-defined]
    return configure


@pytest.fixture
def server(server_module: Any, isolated_paths: None) -> Iterator[str]:
    """Boots the server under test on an ephemeral port; yields the base URL."""
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]

    import uvicorn
    from app.main import create_app

    config = uvicorn.Config(create_app(port), host="127.0.0.1", port=port, log_level="error")
    uvi = uvicorn.Server(config)
    thread = threading.Thread(target=uvi.run, daemon=True)
    thread.start()
    # uvicorn needs a moment before it accepts connections.
    for _ in range(100):
        if uvi.started:
            break
        threading.Event().wait(0.05)
    try:
        yield f"http://127.0.0.1:{port}"
    finally:
        uvi.should_exit = True
        thread.join(timeout=5)


@pytest.fixture
def origin(server: str) -> str:
    """The server's own origin — the only one CORS now accepts."""
    return server
