"""PDFs in a project's linked folder contribute their text to the folder context.


"""
from __future__ import annotations

from pathlib import Path

import pytest

pytest.importorskip("pypdf")
from backend.app.services import project_scan  # noqa: E402


def _pdf(text: str) -> bytes:
    """A one-page PDF whose text layer is `text` (built by hand so the test needs no PDF writer)."""
    stream = f"BT /F1 12 Tf 72 720 Td ({text}) Tj ET".encode()
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = b"%PDF-1.4\n"
    offsets = []
    for i, body in enumerate(objs, 1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % i + body + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1)
    for off in offsets:
        out += b"%010d 00000 n \n" % off
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, xref)
    return out


def _slot(result: dict, name: str) -> dict:
    return next(f for f in result["contextFiles"] if f["filename"] == name)


def test_a_pdf_in_the_folder_is_read_as_text(tmp_path: Path) -> None:
    (tmp_path / "book.pdf").write_bytes(_pdf("Chapter One begins here"))
    (tmp_path / "notes.md").write_text("plain notes")
    result = project_scan.scan_project(str(tmp_path))
    assert "Chapter One begins here" in _slot(result, "book.pdf")["text"]
    assert _slot(result, "notes.md")["text"] == "plain notes"


def test_a_broken_pdf_is_reported_and_does_not_fail_the_scan(tmp_path: Path) -> None:
    (tmp_path / "bad.pdf").write_bytes(b"not a pdf at all")
    (tmp_path / "ok.md").write_text("fine")
    result = project_scan.scan_project(str(tmp_path))
    assert result["ok"] is True
    bad = _slot(result, "bad.pdf")
    assert bad["text"] == "" and bad["error"]
    assert _slot(result, "ok.md")["text"] == "fine"


def test_a_pdf_over_the_size_cap_is_flagged_not_read(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    (tmp_path / "huge.pdf").write_bytes(_pdf("x"))
    monkeypatch.setattr(project_scan, "CP_MAX_PDF_BYTES", 10)
    slot = _slot(project_scan.scan_project(str(tmp_path)), "huge.pdf")
    assert slot["tooBig"] is True and slot["text"] == ""


def test_an_unchanged_pdf_is_extracted_once(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    project_scan._PDF_TEXT_CACHE.clear()
    (tmp_path / "book.pdf").write_bytes(_pdf("cached text"))
    project_scan.scan_project(str(tmp_path))
    assert len(project_scan._PDF_TEXT_CACHE) == 1
    import pypdf

    monkeypatch.setattr(pypdf, "PdfReader", lambda *_a, **_k: (_ for _ in ()).throw(AssertionError("read again")))
    assert "cached text" in _slot(project_scan.scan_project(str(tmp_path)), "book.pdf")["text"]
