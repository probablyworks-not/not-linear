#!/usr/bin/env python3
"""Entry point for the notlinear server: ``python3 backend/server.py --port 8765``.

The server needs its dependencies (``pip install -r requirements.txt``). If
uvicorn is missing we say so plainly rather than dying in a traceback. A ``.venv``
in the repo root is found automatically.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))


def _reexec_into_venv_if_needed() -> None:
    """Re-runs this script under the project venv when the current Python lacks uvicorn.

    Launchers call the SYSTEM python3, which has no FastAPI. Without this, a
    double-click launch fails in a way that looks like the app is broken rather
    than like a missing dependency.

    macOS system Python is also usually externally managed (PEP 668), so
    "just pip install it" is not reliably available either.
    """
    try:
        import uvicorn  # noqa: F401
        return
    except ImportError:
        pass

    venv_dir = BACKEND_DIR.parent / ".venv"
    venv_python = venv_dir / "bin" / "python"
    if not venv_python.exists():
        return
    # Compare sys.prefix, NOT the resolved executable path: .venv/bin/python is
    # a symlink that resolve() follows all the way back to the base interpreter,
    # so comparing resolved paths reports "already in the venv" when running
    # under the very interpreter the venv was built from, and the re-exec never
    # happens. sys.prefix is the venv directory only when actually inside it.
    if Path(sys.prefix).resolve() == venv_dir.resolve():
        return  # already there; avoid an exec loop

    import subprocess
    probe = subprocess.run(
        [str(venv_python), "-c", "import uvicorn"],
        capture_output=True,
    )
    if probe.returncode != 0:
        return

    import os
    os.execv(str(venv_python), [str(venv_python), str(Path(__file__).resolve()), *sys.argv[1:]])


def port_is_free(host: str, port: int) -> bool:
    """True if a server could bind ``host:port`` right now.

    Sets SO_REUSEADDR, as uvicorn does when it really binds. Without it this
    probe was STRICTER than the server it guards: after a server stops, its
    connections linger in TIME_WAIT for up to a minute, and a plain bind()
    refuses the port even though nothing is listening and uvicorn would start
    fine. That made "restart the server" fail with "already in use" for a
    minute after every stop. A live listener still fails the bind, so a genuine
    second copy is still caught.
    """
    import socket

    probe = socket.socket()
    try:
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        probe.bind((host, port))
        return True
    except OSError:
        return False
    finally:
        probe.close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve notlinear and accept local runtime log syncs.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=8765, type=int)
    args = parser.parse_args()

    _reexec_into_venv_if_needed()

    try:
        import uvicorn
    except ImportError:
        sys.stderr.write(
            "notlinear: uvicorn is not installed.\n"
            "\n"
            "The server runs on FastAPI. Install its dependencies with:\n"
            "\n"
            "    python3 -m venv .venv\n"
            "    .venv/bin/pip install -r requirements.txt\n"
            "\n"
            "(A .venv in the repo root is found automatically.)\n"
        )
        raise SystemExit(1)

    from app.main import create_app

    # Fail loudly and early if the port is taken, BEFORE printing the "serving"
    # line. Printing first meant a failed bind still announced success, which
    # is exactly how a stale server on :8765 gets mistaken for the new one.
    if not port_is_free(args.host, args.port):
        sys.stderr.write(
            f"notlinear: {args.host}:{args.port} is already in use.\n"
            "\n"
            "Another copy is probably running (check with:\n"
            f"    lsof -nP -iTCP:{args.port} -sTCP:LISTEN\n"
            ").\n"
            "Quit it, or start this one on a different port with --port.\n"
        )
        raise SystemExit(1)

    # The URL a human looks for when the server comes up.
    print(f"Serving Notlinear on http://{args.host}:{args.port}/web/")

    uvicorn.run(
        create_app(args.port),
        host=args.host,
        port=args.port,
        log_level="warning",
        access_log=False,
    )


if __name__ == "__main__":
    main()
