"""Native macOS file and folder dialogs (``osascript``).

``NOTLINEAR_FAKE_NATIVE=1`` replaces every dialog with a canned result, which
is what lets the contract tests and CI exercise these endpoints without a
macOS GUI popping real windows and blocking the run.
"""

from __future__ import annotations

import base64
import mimetypes
import re
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

from ..config import fake_native

# 20 MB per file. Was a local inside the open_files handler; a module constant
# here so the cap is visible and testable rather than buried mid-function.
MAX_FILE_BYTES = 20 * 1024 * 1024

OSASCRIPT_TIMEOUT_S = 120

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
    if fake_native() or sys.platform != "darwin":
        # Off macOS there is no osascript: report "cancelled" so the UI falls
        # through to the browser's own file input instead of showing an error.
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
