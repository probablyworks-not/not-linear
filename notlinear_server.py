#!/usr/bin/env python3
import argparse
import base64
import json
import mimetypes
import subprocess
import os
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


APP_DIR = Path(__file__).resolve().parent
LOGS_PATH = APP_DIR / "logs.md"
LOG_START = "<!-- notlinear-runtime-log:start -->"
LOG_END = "<!-- notlinear-runtime-log:end -->"
MAX_BODY_BYTES = 1_500_000
MAX_EVENTS = 300


def runtime_log_block(events):
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    payload = json.dumps(events[-MAX_EVENTS:], indent=2, ensure_ascii=True)
    return (
        f"{LOG_START}\n"
        "## Latest runtime log\n\n"
        f"_Last synced: {now}_\n\n"
        f"_Event count: {len(events[-MAX_EVENTS:])}_\n\n"
        "```json\n"
        f"{payload}\n"
        "```\n"
        f"{LOG_END}"
    )


def replace_runtime_log_section(existing, block):
    if LOG_START in existing and LOG_END in existing:
        before = existing.split(LOG_START, 1)[0].rstrip()
        after = existing.split(LOG_END, 1)[1].lstrip()
        return f"{before}\n\n{block}\n\n{after}".rstrip() + "\n"
    return existing.rstrip() + "\n\n" + block + "\n"


class NotlinearHandler(SimpleHTTPRequestHandler):
    def _json(self, code, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self):
        path = self.path.split("?", 1)[0]

        if path == "/__notlinear_open_files":
            try:
                length = int(self.headers.get("content-length", "0"))
                body = self.rfile.read(length) if length else b"{}"
                data = json.loads(body.decode("utf-8"))
                is_folder = data.get("folder", False)

                MAX_FILE_BYTES = 20 * 1024 * 1024  # 20 MB per file

                def file_entry(filepath, display_name):
                    size = os.path.getsize(filepath)
                    mime = mimetypes.guess_type(filepath)[0] or "application/octet-stream"
                    if size > MAX_FILE_BYTES:
                        return {"name": display_name, "type": mime, "size": size, "tooBig": True}
                    with open(filepath, "rb") as fh:
                        b64 = base64.b64encode(fh.read()).decode("ascii")
                    return {"name": display_name, "type": mime, "size": size, "base64": b64}

                if is_folder:
                    script = 'POSIX path of (choose folder with prompt "Select folder to attach")'
                    result = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=120)
                    if result.returncode != 0:
                        self._json(200, {"ok": False, "cancelled": True})
                        return
                    folder_path = result.stdout.strip()
                    files = []
                    for root, dirs, filenames in os.walk(folder_path):
                        dirs[:] = sorted(d for d in dirs if not d.startswith("."))
                        for filename in sorted(filenames):
                            if filename.startswith("."):
                                continue
                            filepath = os.path.join(root, filename)
                            rel_name = os.path.relpath(filepath, os.path.dirname(folder_path))
                            try:
                                files.append(file_entry(filepath, rel_name))
                            except OSError:
                                pass
                    self._json(200, {"ok": True, "files": files})
                else:
                    script = (
                        "set selectedFiles to choose file "
                        "with prompt \"Select files to attach\" "
                        "with multiple selections allowed\n"
                        "set thePaths to \"\"\n"
                        "repeat with aFile in selectedFiles\n"
                        "  set thePaths to thePaths & POSIX path of aFile & linefeed\n"
                        "end repeat\n"
                        "return thePaths"
                    )
                    result = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=120)
                    if result.returncode != 0:
                        self._json(200, {"ok": False, "cancelled": True})
                        return
                    paths = [p.strip() for p in result.stdout.split("\n") if p.strip()]
                    files = []
                    for p in paths:
                        try:
                            files.append(file_entry(p, os.path.basename(p)))
                        except OSError:
                            pass
                    self._json(200, {"ok": True, "files": files})
            except Exception as exc:
                self._json(500, {"ok": False, "error": str(exc)})
            return

        if path == "/__notlinear_save_file":
            try:
                length = int(self.headers.get("content-length", "0"))
                body = self.rfile.read(length)
                data = json.loads(body.decode("utf-8"))
                filename = data.get("filename", "response.md")
                content = data.get("content", "")
                # Use osascript to show native Save dialog
                script = f'POSIX path of (choose file name with prompt "Save Markdown file" default name "{filename}")'
                result = subprocess.run(["osascript", "-e", script], capture_output=True, text=True, timeout=120)
                if result.returncode != 0:
                    # User cancelled
                    self._json(200, {"ok": False, "cancelled": True})
                    return
                save_path = result.stdout.strip()
                if not save_path.endswith(".md"):
                    save_path += ".md"
                Path(save_path).write_text(content, encoding="utf-8")
                self._json(200, {"ok": True, "path": save_path})
            except Exception as exc:
                self._json(500, {"ok": False, "error": str(exc)})
            return

        if path != "/__notlinear_runtime_logs":
            self.send_error(404)
            return

        try:
            length = int(self.headers.get("content-length", "0"))
        except ValueError:
            self.send_error(400, "Invalid content length")
            return
        if length > MAX_BODY_BYTES:
            self.send_error(413, "Runtime log payload too large")
            return

        try:
            body = self.rfile.read(length)
            data = json.loads(body.decode("utf-8") or "{}")
            events = data.get("events", [])
            if not isinstance(events, list):
                raise ValueError("events must be a list")
            block = runtime_log_block(events)
            existing = LOGS_PATH.read_text(encoding="utf-8") if LOGS_PATH.exists() else "# Runtime logs\n"
            LOGS_PATH.write_text(replace_runtime_log_section(existing, block), encoding="utf-8")
        except Exception as exc:
            self.send_error(400, f"Could not write runtime logs: {exc}")
            return

        response = json.dumps({"ok": True, "events": min(len(events), MAX_EVENTS)}).encode("utf-8")
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(response)))
        self.end_headers()
        self.wfile.write(response)


def main():
    parser = argparse.ArgumentParser(description="Serve Notlinear and accept local runtime log syncs.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", default=8765, type=int)
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.host, args.port), lambda *a, **kw: NotlinearHandler(*a, directory=str(APP_DIR), **kw))
    print(f"Serving Notlinear on http://{args.host}:{args.port}/notlinear.html")
    server.serve_forever()


if __name__ == "__main__":
    main()
