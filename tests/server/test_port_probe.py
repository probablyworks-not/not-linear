"""backend/server.py's port probe must not be stricter than the server it guards.

Regression for the "already in use" that appeared for about a minute after
every server stop: the probe did a plain bind(), which fails on TIME_WAIT
sockets, while uvicorn (SO_REUSEADDR) binds fine. Touches no filesystem path.
"""

from __future__ import annotations

import importlib.util
import socket
from pathlib import Path

import pytest

SERVER_PY = Path(__file__).resolve().parents[2] / "backend" / "server.py"


def _load():
    spec = importlib.util.spec_from_file_location("notlinear_server_probe_under_test", SERVER_PY)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def probe():
    return _load().port_is_free


def _listen(port: int = 0) -> socket.socket:
    s = socket.socket()
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)  # what uvicorn does
    s.bind(("127.0.0.1", port))
    s.listen()
    return s


def test_a_free_port_is_free(probe) -> None:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    assert probe("127.0.0.1", port) is True


def test_a_live_listener_is_still_detected(probe) -> None:
    # The fix must not turn the guard off: a genuine second copy has to be caught.
    srv = _listen()
    try:
        assert probe("127.0.0.1", srv.getsockname()[1]) is False
    finally:
        srv.close()


def test_time_wait_after_a_server_stops_does_not_block_a_restart(probe) -> None:
    srv = _listen()
    port = srv.getsockname()[1]
    client = socket.create_connection(("127.0.0.1", port))
    conn, _ = srv.accept()
    conn.close()      # the server closes first, so ITS side lingers in TIME_WAIT...
    client.close()
    srv.close()       # ...and then the listener goes away: nothing is listening now.
    assert probe("127.0.0.1", port) is True
    # And a real server can bind it, which is the property the probe is supposed to predict.
    again = _listen(port)
    again.close()


def test_the_old_plain_bind_really_did_refuse_that_state() -> None:
    """Proves the test above can fail: reproduce the pre-fix behaviour directly."""
    srv = _listen()
    port = srv.getsockname()[1]
    client = socket.create_connection(("127.0.0.1", port))
    conn, _ = srv.accept()
    conn.close()
    client.close()
    srv.close()
    plain = socket.socket()
    try:
        with pytest.raises(OSError):
            plain.bind(("127.0.0.1", port))
    finally:
        plain.close()
