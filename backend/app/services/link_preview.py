"""Link preview fetching and HTML parsing.

Moved verbatim from backend/server.py as part of P2. No logic changes —
notably the SSRF hardening ADR-023 declined is still absent here; that lands
as its own commit so the move stays reviewable (planned ADR-035).
"""

from __future__ import annotations

import re
import urllib.error
import urllib.request
from html.parser import HTMLParser
from urllib.parse import urlparse
from ..config import LINK_PREVIEW_MAX_BYTES, LINK_PREVIEW_TIMEOUT_S
from .safe_fetch import BlockedURLError, fetch_text

class _LinkPreviewParser(HTMLParser):
    """Pulls <title>, a description meta tag, and a favicon link out of an
    HTML head. Best-effort — any single missing tag just leaves that field
    blank rather than failing the whole parse."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.title = ""
        self.description = ""
        self.favicon = ""
        self._in_title = False

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "title":
            self._in_title = True
        elif tag == "meta":
            name = (attrs.get("name") or attrs.get("property") or "").lower()
            if name in ("description", "og:description") and not self.description:
                self.description = (attrs.get("content") or "").strip()
        elif tag == "link":
            rel = (attrs.get("rel") or "").lower()
            if "icon" in rel and not self.favicon:
                self.favicon = (attrs.get("href") or "").strip()

    def handle_endtag(self, tag):
        if tag == "title":
            self._in_title = False

    def handle_data(self, data):
        if self._in_title and not self.title:
            self.title = data.strip()


# Called only by the /__notlinear_link_preview POST handler in do_POST.
def link_preview(url):
    """Fetch `url` server-side (the frontend can't CORS-fetch arbitrary
    sites) and return a small preview: title/description/favicon/domain.
    Read-only, best-effort — any failure degrades to {"ok": False}, never
    raises. Trust boundary: this server is local-first/single-user (see
    ADR-023) — only the URL scheme is validated, no private-IP blocking.
    """
    parsed = urlparse(url)

    # Fetching goes through safe_fetch, which validates the scheme, resolves the
    # host and rejects private/loopback/link-local/CGNAT addresses, pins the
    # connection to the validated IP so DNS cannot rebind between check and
    # connect, and re-validates every redirect hop. See ADR-035, which
    # supersedes ADR-023's "no SSRF hardening by design".
    #
    # The failure contract is unchanged: any problem returns {"ok": False,
    # "error": ...}, never raises, so views/notes.js:976 is untouched.
    try:
        html, _final_url = fetch_text(
            url,
            max_bytes=LINK_PREVIEW_MAX_BYTES,
            timeout=LINK_PREVIEW_TIMEOUT_S,
            user_agent="notlinear-link-preview/1",
        )
    except BlockedURLError as exc:
        return {"ok": False, "error": str(exc)}
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, ValueError, OSError) as exc:
        return {"ok": False, "error": str(exc)}

    p = _LinkPreviewParser()
    try:
        p.feed(html)
    except Exception:
        pass  # best-effort — return whatever was parsed before the error

    # Parsed <link rel="icon"> hrefs are often root- or page-relative
    # ("/favicon.png", "favicon.png") rather than absolute — resolve those
    # against the page's own scheme+host so the frontend gets a directly
    # loadable URL. data: URIs and already-absolute URLs pass through as-is.
    favicon = p.favicon
    if favicon and not favicon.startswith(("http://", "https://", "data:")):
        favicon = f"{parsed.scheme}://{parsed.netloc}" + (favicon if favicon.startswith("/") else f"/{favicon}")
    elif not favicon:
        favicon = f"{parsed.scheme}://{parsed.netloc}/favicon.ico"

    return {
        "ok": True,
        "title": p.title or parsed.netloc,
        "description": p.description,
        "domain": parsed.netloc,
        "favicon": favicon,
    }

