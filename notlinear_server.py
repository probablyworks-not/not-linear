#!/usr/bin/env python3
# Compatibility shim for launchers that reference this path directly
# (e.g. the compiled Notlinear.app binary). Immediately hands off to
# backend/server.py, which is the canonical server entry point.
import os, sys
_backend = os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend", "server.py")
os.execv(sys.executable, [sys.executable, _backend] + sys.argv[1:])
