"""Outbound HTTP that refuses to reach the private network.

``link_preview`` takes a URL from a note and fetches it server-side, because
the browser cannot CORS-fetch arbitrary sites. ADR-023 accepted that with no
private-IP blocking, reasoning that a local single-user server has no such
threat model. That reasoning is the same one that justified
``Access-Control-Allow-Origin: *`` and was wrong for the same reason: content
in a note is not necessarily content the user wrote, and the server sits
inside the user's network with a view of it that a browser deliberately
does not have. ``http://192.168.1.1/admin`` and the cloud metadata endpoint at
``169.254.169.254`` are both one paste away.

Supersedes ADR-023, as ADR-035.

The checks, in the order they matter:

1. Scheme must be http or https.
2. Resolve the hostname and reject if **any** returned address is private,
   loopback, link-local, CGNAT, reserved or unspecified. Any, not the first:
   a name resolving to both a public and a private address is the classic
   bypass.
3. **Connect to the validated IP**, passing the hostname in the Host header
   and, over TLS, as the SNI and certificate name. Re-resolving between check
   and connect is DNS rebinding, and a check that does not pin the address
   does not prevent it — but pinning must not cost certificate validation,
   which is why the connection is made by hostname and only the socket's
   destination address is overridden.
4. Follow at most ``MAX_REDIRECTS`` hops, re-validating every one. Validating
   only the first URL is the most common way this is got wrong.
5. Reject content types that are not HTML or plain text.
"""

from __future__ import annotations

import http.client
import ipaddress
import socket
import ssl
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from urllib.parse import urlparse

MAX_REDIRECTS = 3
ALLOWED_SCHEMES = ("http", "https")
ALLOWED_CONTENT_TYPES = ("text/html", "text/plain", "application/xhtml+xml")


class BlockedURLError(ValueError):
    """Raised when a URL resolves somewhere it must not be fetched from."""


def _address_is_blocked(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    """True for anything inside the machine or its private network.

    ``is_private`` covers RFC1918, loopback, link-local and unique-local, but
    is checked alongside the others rather than relied on alone, because the
    categories overlap inconsistently across address families.
    """
    if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_unspecified:
        return True
    if ip.is_multicast:
        return True
    # CGNAT 100.64.0.0/10 is not flagged private by ipaddress, and is routable
    # inside carrier and some corporate networks.
    if ip.version == 4 and ip in ipaddress.ip_network("100.64.0.0/10"):
        return True
    # IPv4-mapped IPv6 (::ffff:10.0.0.1) would otherwise sneak a private v4
    # address past a v6 check.
    if ip.version == 6:
        mapped = getattr(ip, "ipv4_mapped", None)
        if mapped is not None and _address_is_blocked(mapped):
            return True
    return False


@dataclass
class ResolvedTarget:
    hostname: str
    ip: str
    port: int
    family: int


def resolve_and_validate(url: str) -> ResolvedTarget:
    """Resolves a URL's host and rejects it if any address is non-public."""
    parsed = urlparse(url)
    if parsed.scheme not in ALLOWED_SCHEMES or not parsed.netloc:
        raise BlockedURLError("url must be http(s)")

    hostname = parsed.hostname
    if not hostname:
        raise BlockedURLError("url has no host")

    port = parsed.port or (443 if parsed.scheme == "https" else 80)

    try:
        infos = socket.getaddrinfo(hostname, port, proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        raise BlockedURLError(f"could not resolve host: {exc}") from exc

    if not infos:
        raise BlockedURLError("could not resolve host")

    # Every resolved address must be acceptable. A host that returns one public
    # and one private address is a deliberate bypass, not a coincidence.
    chosen: ResolvedTarget | None = None
    for family, _type, _proto, _canon, sockaddr in infos:
        ip_str = sockaddr[0]
        try:
            ip = ipaddress.ip_address(ip_str)
        except ValueError:
            raise BlockedURLError(f"unparseable address {ip_str!r}") from None
        if _address_is_blocked(ip):
            raise BlockedURLError(f"refusing to fetch a private or local address ({ip_str})")
        if chosen is None:
            chosen = ResolvedTarget(hostname=hostname, ip=ip_str, port=port, family=family)

    assert chosen is not None
    return chosen


def _connect(target: ResolvedTarget, scheme: str, timeout: float) -> http.client.HTTPConnection:
    """A connection addressed to the validated IP but named with the hostname.

    ``http.client`` takes the host it was constructed with for the Host header,
    the TLS SNI and the certificate check, and only uses it as an address in
    ``_create_connection`` — so overriding that one method pins the destination
    without turning the request into a request for an IP. Connecting to
    ``https://<ip>/`` instead (what urlopen on a rewritten URL does) sends the
    IP as SNI, which CDNs answer with a handshake failure, and would fail
    certificate validation even if they did not.
    """
    pinned_ip, port = target.ip, target.port

    def create_connection(address, conn_timeout, source_address=None):  # type: ignore[no-untyped-def]
        return socket.create_connection((pinned_ip, address[1]), conn_timeout, source_address)

    if scheme == "https":
        conn: http.client.HTTPConnection = http.client.HTTPSConnection(
            target.hostname, port, timeout=timeout, context=ssl.create_default_context(),
        )
    else:
        conn = http.client.HTTPConnection(target.hostname, port, timeout=timeout)
    conn._create_connection = create_connection  # type: ignore[method-assign]
    return conn


def fetch_text(url: str, *, max_bytes: int, timeout: float, user_agent: str) -> tuple[str, str]:
    """Fetches a URL safely and returns (text, final_url).

    Redirects are followed manually so each hop can be validated. urllib's
    automatic redirect handling would resolve and connect without any of the
    checks above, which is why ``allow_redirects``-style convenience is not
    used here.
    """
    current = url
    for _hop in range(MAX_REDIRECTS + 1):
        target = resolve_and_validate(current)
        parsed = urlparse(current)
        path = parsed.path or "/"
        if parsed.query:
            path = f"{path}?{parsed.query}"

        conn = _connect(target, parsed.scheme, timeout)
        try:
            conn.request("GET", path, headers={
                "User-Agent": user_agent,
                "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1",
                "Accept-Language": "en-US,en;q=0.9",
            })
            response = conn.getresponse()

            if response.status in (301, 302, 303, 307, 308):
                location = response.headers.get("Location")
                if not location:
                    raise BlockedURLError("redirect without a Location header")
                current = urllib.parse.urljoin(current, location)
                continue

            if response.status >= 400:
                raise urllib.error.HTTPError(current, response.status, response.reason or "", response.headers, None)

            content_type = (response.headers.get_content_type() or "").lower()
            if content_type and content_type not in ALLOWED_CONTENT_TYPES:
                raise BlockedURLError(f"unsupported content type {content_type!r}")
            raw = response.read(max_bytes)
            charset = response.headers.get_content_charset() or "utf-8"
        finally:
            conn.close()

        try:
            return raw.decode(charset, errors="replace"), current
        except LookupError:
            return raw.decode("utf-8", errors="replace"), current

    raise BlockedURLError(f"too many redirects (more than {MAX_REDIRECTS})")
