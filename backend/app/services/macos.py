"""Native macOS dialogs and screen capture.

Extracted from the ``do_POST`` chain in ``backend/server.py``, where these
``osascript``/``screencapture`` calls were inline. Behaviour is unchanged — in
particular the ``save_file`` AppleScript still interpolates the filename
directly, exactly as before. That is a known injection surface and fixing it
here would make the P2 move diff unreadable, so it lands as its own commit
(planned ADR-035) with its own test.

``NOTLINEAR_FAKE_NATIVE=1`` replaces every dialog with a canned result, which
is what lets the contract tests and CI exercise these endpoints without a
macOS GUI popping real windows and blocking the run.
"""

from __future__ import annotations

import base64
import mimetypes
import re
import os
import signal
import subprocess
import threading
from pathlib import Path
from typing import Any

from ..config import REPO_ROOT, fake_native

# 20 MB per file. Was a local inside the open_files handler; a module constant
# here so the cap is visible and testable rather than buried mid-function.
MAX_FILE_BYTES = 20 * 1024 * 1024

OSASCRIPT_TIMEOUT_S = 120

# Tracks the one in-flight `screencapture -v` process. start and stop arrive on
# different request threads, hence the lock — carried over from server.py:78-80.
_recording_lock = threading.Lock()
_recording: dict[str, Any] = {"proc": None, "path": None}


class NativeUnavailable(RuntimeError):
    """Raised when a native dialog is requested but cannot be shown."""


def _run_osascript(
    script: str,
    timeout: int = OSASCRIPT_TIMEOUT_S,
    args: list[str] | None = None,
) -> subprocess.CompletedProcess[str]:
    """Runs an AppleScript, passing any user-controlled values as real argv.

    `args` exists so a filename never has to be interpolated into the script
    text. See save_file: building the script with an f-string let a crafted
    name close the quoted string and append arbitrary AppleScript, which the
    old comment waved away as acceptable because the value "originates from
    this app's own frontend" — which is exactly the assumption the CORS hole
    had already broken.
    """
    if fake_native():
        return subprocess.CompletedProcess(args=["osascript"], returncode=1, stdout="", stderr="")
    cmd = ["osascript", "-e", script]
    if args:
        cmd.append("-")          # end of options; what follows is argv
        cmd.extend(args)
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)


def pick_folder(prompt: str = "Select a coding project folder") -> dict[str, Any]:
    """Shows a native folder picker. Cancelled dialogs are not errors."""
    script = f'POSIX path of (choose folder with prompt "{prompt}")'
    result = _run_osascript(script)
    if result.returncode != 0:
        return {"ok": False, "cancelled": True}
    return {"ok": True, "path": result.stdout.strip()}


def _file_entry(filepath: str, display_name: str) -> dict[str, Any]:
    """One picked file in the {name, type, size, base64} shape the UI expects."""
    size = os.path.getsize(filepath)
    mime = mimetypes.guess_type(filepath)[0] or "application/octet-stream"
    if size > MAX_FILE_BYTES:
        return {"name": display_name, "type": mime, "size": size, "tooBig": True}
    with open(filepath, "rb") as fh:
        b64 = base64.b64encode(fh.read()).decode("ascii")
    return {"name": display_name, "type": mime, "size": size, "base64": b64}


def open_files(is_folder: bool = False) -> dict[str, Any]:
    """Native Open dialog, in file or folder mode, returning file contents."""
    if is_folder:
        script = 'POSIX path of (choose folder with prompt "Select folder to attach")'
        result = _run_osascript(script)
        if result.returncode != 0:
            return {"ok": False, "cancelled": True}
        folder_path = result.stdout.strip()
        files: list[dict[str, Any]] = []
        for root, dirs, filenames in os.walk(folder_path):
            dirs[:] = sorted(d for d in dirs if not d.startswith("."))
            for filename in sorted(filenames):
                if filename.startswith("."):
                    continue
                filepath = os.path.join(root, filename)
                # relpath against the folder's *parent*, so the chosen folder's
                # own name stays as the first path segment — the frontend shows
                # "myfolder/sub/file.js", not "sub/file.js".
                rel_name = os.path.relpath(filepath, os.path.dirname(folder_path))
                try:
                    files.append(_file_entry(filepath, rel_name))
                except OSError:
                    pass
        return {"ok": True, "files": files}

    # Multi-line AppleScript because `choose file ... with multiple selections`
    # returns a list and AppleScript has no join; this builds the
    # newline-delimited string that the split below parses back apart.
    script = (
        "set selectedFiles to choose file "
        'with prompt "Select files to attach" '
        "with multiple selections allowed\n"
        'set thePaths to ""\n'
        "repeat with aFile in selectedFiles\n"
        "  set thePaths to thePaths & POSIX path of aFile & linefeed\n"
        "end repeat\n"
        "return thePaths"
    )
    result = _run_osascript(script)
    if result.returncode != 0:
        return {"ok": False, "cancelled": True}
    paths = [p.strip() for p in result.stdout.split("\n") if p.strip()]
    files = []
    for p in paths:
        try:
            files.append(_file_entry(p, os.path.basename(p)))
        except OSError:
            pass
    return {"ok": True, "files": files}


# Conservative: no path separators, no NUL, bounded length. A save dialog's
# default name is a name, not a path.
SAFE_FILENAME = re.compile(r"^[^/\x00]{1,120}$")


def save_file(filename: str, content: str) -> dict[str, Any]:
    """Native Save dialog, then writes the content where the user chose.

    The filename is passed as argv and read with `item 1 of argv`, never
    interpolated into the script text, so no quoting is involved and there is
    nothing to escape out of.
    """
    if not SAFE_FILENAME.match(filename or ""):
        return {"ok": False, "error": "invalid filename"}
    script = (
        "on run argv\n"
        "  return POSIX path of (choose file name "
        'with prompt "Save Markdown file" default name (item 1 of argv))\n'
        "end run"
    )
    result = _run_osascript(script, args=[filename])
    if result.returncode != 0:
        return {"ok": False, "cancelled": True}
    save_path = result.stdout.strip()
    if not save_path.endswith(".md"):
        save_path += ".md"
    Path(save_path).write_text(content, encoding="utf-8")
    return {"ok": True, "path": save_path}


def screenshot(shot_path: Path, mode: str = "full") -> dict[str, Any]:
    """One-shot screenshot via `screencapture`. Returns a repo-relative path."""
    cmd = ["screencapture", "-x", "-t", "png", str(shot_path)]  # -x: no shutter sound
    if mode == "area":
        cmd.insert(1, "-i")  # interactive selection; Escape cancels
    if fake_native():
        shot_path.parent.mkdir(parents=True, exist_ok=True)
        shot_path.write_bytes(b"\x89PNG\r\n\x1a\n")  # minimal PNG signature
        result = subprocess.CompletedProcess(args=cmd, returncode=0, stdout="", stderr="")
    else:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=240 if mode == "area" else 30)
    if not shot_path.exists():
        if mode == "area":
            return {"ok": False, "cancelled": True}
        err = (result.stderr or "").strip() or \
            "screencapture failed — check Screen Recording permission in System Settings"
        return {"ok": False, "error": err, "_status": 500}
    return {"ok": True, "path": str(shot_path.relative_to(REPO_ROOT))}


def start_recording(rec_path: Path, mode: str = "full") -> dict[str, Any]:
    with _recording_lock:
        if _recording["proc"] and _recording["proc"].poll() is None:
            return {"ok": False, "error": "already recording", "_status": 409}
        cmd = ["screencapture", "-v", "-x", str(rec_path)]
        if mode == "area":
            cmd.insert(1, "-i")  # select area first, then recording starts
        if fake_native():
            rec_path.parent.mkdir(parents=True, exist_ok=True)
            rec_path.write_bytes(b"")
            _recording["proc"], _recording["path"] = None, rec_path
            return {"ok": True, "recording": True}
        proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        _recording["proc"], _recording["path"] = proc, rec_path
        return {"ok": True, "recording": True}


def stop_recording() -> dict[str, Any]:
    with _recording_lock:
        proc, rec_path = _recording["proc"], _recording["path"]
        _recording["proc"], _recording["path"] = None, None
        if not proc or proc.poll() is not None:
            # area mode: Escape during selection ends the process with no file
            if rec_path and not rec_path.exists():
                return {"ok": False, "cancelled": True}
            if fake_native() and rec_path and rec_path.exists():
                return {"ok": True, "path": str(rec_path.relative_to(REPO_ROOT))}
            return {"ok": False, "error": "not recording", "_status": 409}
        proc.send_signal(signal.SIGINT)
        proc.wait(timeout=15)
        if not rec_path.exists():
            return {"ok": False, "cancelled": True,
                    "error": "no recording captured — selection cancelled or Screen Recording permission missing"}
        return {"ok": True, "path": str(rec_path.relative_to(REPO_ROOT))}
