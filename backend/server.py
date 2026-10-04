#!/usr/bin/env python3
"""Entry point for the notlinear server.

Kept at this exact path and with these exact arguments on purpose. Four
launchers and the compiled ``Notlinear.app`` binary invoke
``python3 backend/server.py --port 8765 --host 127.0.0.1`` (some via
``notlinear_server.py``), and the app bundle has that path compiled in. So this
file stays the entry point even though the implementation moved to
``backend/app/`` in P2 — rewriting it as a shim is what keeps every launcher
working untouched, and reverting this one file is the rollback lever for the
whole phase.

The previous stdlib implementation is still here as ``server_legacy.py``. It is
the oracle the contract and parity tests compare against
(``NOTLINEAR_SERVER=legacy``), and it is deleted at the P3 gate once the
FastAPI behaviour has lived through real use.

Unlike the old server, this one has dependencies. If uvicorn is missing we say
so plainly rather than dying in a traceback, because "it used to just run" is
exactly what a returning user will expect.
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

    This matters more than it looks. Every launcher — Notlinear.command,
    Notlinear.applescript, and the compiled app via notlinear_server.py — calls
    the SYSTEM python3, which has no FastAPI. Before P2 that was fine, because
    the server was stdlib-only. Without this, "double-click the app" stops
    working the moment P2 lands, and the failure looks like the app is broken
    rather than like a missing dependency.

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


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve notlinear and accept local runtime log syncs.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=8765, type=int)
    parser.add_argument(
        "--legacy",
        action="store_true",
        help="run the pre-P2 stdlib server instead (no dependencies; serves the whole repo)",
    )
    args = parser.parse_args()

    if args.legacy:
        import runpy
        sys.argv = [str(BACKEND_DIR / "server_legacy.py"), "--host", args.host, "--port", str(args.port)]
        runpy.run_path(str(BACKEND_DIR / "server_legacy.py"), run_name="__main__")
        return

    _reexec_into_venv_if_needed()

    try:
        import uvicorn
    except ImportError:
        sys.stderr.write(
            "notlinear: uvicorn is not installed.\n"
            "\n"
            "Since P2 the server runs on FastAPI, so it has dependencies where it\n"
            "previously had none. Install them with:\n"
            "\n"
            "    python3 -m venv .venv\n"
            "    .venv/bin/pip install -r requirements.txt\n"
            "\n"
            "(A .venv in the repo root is found automatically, so the launchers and\n"
            "Notlinear.app keep working without installing anything system-wide.)\n"
            "\n"
            "Or run the old dependency-free server with:\n"
            "\n"
            f"    python3 {Path(__file__).name} --legacy\n"
        )
        raise SystemExit(1)

    from app.main import create_app

    # Same line the stdlib server printed — the launchers and their logs key
    # off seeing the server come up, and a human looks for this URL.
    print(f"Serving Notlinear on http://{args.host}:{args.port}/frontend/index.html")

    uvicorn.run(
        create_app(args.port),
        host=args.host,
        port=args.port,
        log_level="warning",
        access_log=False,
    )


if __name__ == "__main__":
    main()
