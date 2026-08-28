"""Downloading a card logo from a URL the agent supplies.

This is the one place in the MCP server that reaches somewhere other than the
Turbo EA backend, so every rule it enforces is written out rather than implied.

**Why it exists.** The bundled packs carry a few thousand well-known brands,
which is not every product a customer runs — an in-house system, a niche
vendor, a rebranded product are all ordinary misses. The old answer, "fetch the
mark yourself and send the bytes", turned out to be advice many agents cannot
take: a sandboxed assistant commonly reaches its package registries and nothing
else, so it reported the logo as impossible rather than fetching it. The server
runs on the customer's own network and usually can.

**Why here and not in the backend.** The bytes this returns go up the ordinary
`POST /cards/{id}/logo` upload route, so the backend's permission check, the
per-type "custom logos" switch, the size cap, the magic-byte sniff and the SVG
refusal all still run, unchanged, on a fetched image exactly as on one the user
pasted. Nothing about the URL reaches the process that holds the database.

The guards, in the order they run: the kill switch, the host allowlist (exact
match), the URL's own shape, the addresses that host resolves to, then a
streamed read with a byte cap and a signature check. A redirect starts the list
again from the allowlist.
"""

from __future__ import annotations

import asyncio
import ipaddress
import socket
import time
from collections.abc import Callable
from urllib.parse import urlsplit

import httpx

from .config import (
    APP_VERSION,
    MCP_LOGO_FETCH_ENABLED,
    MCP_LOGO_FETCH_HOSTS,
)

# Mirrors the backend's cap. A courtesy so a doomed upload is not attempted,
# never the control — `POST /cards/{id}/logo` enforces its own.
MAX_LOGO_BYTES = 1 * 1024 * 1024

# Per-operation budget (httpx applies it to connect, read, write and pool
# separately, so it is a stall limit rather than a total). Short on purpose: a
# batch of 50 rows must not hang a tool call for minutes because one host is
# black-holing packets. What bounds the whole transfer is the byte cap below.
FETCH_TIMEOUT_S = 10.0

# A redirect is common on a CDN (jsDelivr in particular), so a couple are
# allowed — each re-validated from scratch. More than that is a redirect chain
# nobody needs to serve a PNG.
MAX_REDIRECTS = 2

USER_AGENT = f"TurboEA-MCP/{APP_VERSION} (+https://turbo-ea.org; card-logo)"

#: A magic-byte reader: the accepted-format list belongs with the upload path,
#: not here, so the caller passes its own.
SniffFn = Callable[[bytes], str | None]


class LogoFetchError(Exception):
    """A refusal or failure, carrying the row status the caller reports.

    `status` names the condition, matching the taxonomy `set_card_logos`
    already uses, and `remedy` is set where the next step is not obvious from
    the status alone.
    """

    def __init__(self, status: str, message: str, remedy: str | None = None) -> None:
        super().__init__(message)
        self.status = status
        self.message = message
        self.remedy = remedy


def allowed_hosts() -> tuple[str, ...]:
    """The hosts a logo may come from, for error messages and tests."""
    return MCP_LOGO_FETCH_HOSTS


def _check_url(url: str) -> str:
    """Validate one URL's shape and host. Returns the lower-cased host."""
    try:
        parts = urlsplit(url)
    except ValueError as exc:  # pragma: no cover — urlsplit is very forgiving
        raise LogoFetchError("image_url_invalid", f"Not a URL: {exc}") from exc

    if parts.scheme != "https":
        raise LogoFetchError(
            "image_url_invalid",
            "Only https:// URLs are fetched. Plain http is refused because the "
            "bytes would be modifiable in transit.",
        )
    if parts.username or parts.password:
        raise LogoFetchError(
            "image_url_invalid", "A URL carrying credentials is refused."
        )
    host = (parts.hostname or "").lower()
    if not host:
        raise LogoFetchError("image_url_invalid", "The URL has no host.")
    if parts.port not in (None, 443):
        raise LogoFetchError(
            "image_url_invalid", f"Only port 443 is fetched, not {parts.port}."
        )
    if host not in allowed_hosts():
        raise LogoFetchError(
            "image_url_not_allowed",
            f"'{host}' is not an allowed logo source.",
            remedy=(
                "Logos may be fetched from: "
                + ", ".join(allowed_hosts())
                + ". Point image_url at one of those, or fetch the image "
                "yourself and send it as image_base64 instead."
            ),
        )
    return host


def _check_addresses(host: str) -> None:
    """Refuse a host that resolves into private space.

    Belt-and-braces behind the allowlist, and the thing that makes a poisoned
    or hijacked DNS answer inert: 169.254.169.254 is the cloud metadata
    service, and the RFC1918 / ULA / loopback ranges are the customer's own
    network, which is exactly what an SSRF is trying to reach.
    """
    try:
        infos = socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)
    except OSError as exc:
        raise LogoFetchError(
            "image_url_unreachable", f"Could not resolve '{host}': {exc}"
        ) from exc
    for info in infos:
        addr = info[4][0]
        try:
            ip = ipaddress.ip_address(addr)
        except ValueError:  # pragma: no cover — getaddrinfo returns literals
            continue
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_reserved
            or ip.is_multicast
            or ip.is_unspecified
        ):
            raise LogoFetchError(
                "image_url_blocked",
                f"'{host}' resolves to {addr}, which is not a public address.",
            )


async def _read_capped(response: httpx.Response) -> bytes:
    """Read a response body, stopping the moment it exceeds the cap.

    Streamed rather than `response.content` so a host answering with a
    multi-gigabyte body cannot be used to exhaust this container's memory —
    the read stops at the first chunk that crosses the line.
    """
    chunks: list[bytes] = []
    total = 0
    async for chunk in response.aiter_bytes():
        total += len(chunk)
        if total > MAX_LOGO_BYTES:
            raise LogoFetchError(
                "too_large",
                f"The image at this URL is larger than the {MAX_LOGO_BYTES} byte cap.",
            )
        chunks.append(chunk)
    return b"".join(chunks)


async def fetch_logo(url: str, sniff: SniffFn) -> tuple[bytes, str]:
    """Download `url` and return `(bytes, sniffed_mime)`.

    `sniff` is the caller's magic-byte reader, passed in rather than imported
    so this module has no opinion about which formats the product accepts —
    that list lives with the upload path.

    Raises `LogoFetchError` for every refusal and every failure; a caller turns
    it into one reported row and keeps going with the rest of the batch.
    """
    if not MCP_LOGO_FETCH_ENABLED:
        raise LogoFetchError(
            "image_url_disabled",
            "Fetching logos by URL is switched off on this instance "
            "(MCP_LOGO_FETCH_ENABLED=false).",
            remedy=(
                "Send the image as image_base64, or use an icon_slug from the "
                "bundled packs."
            ),
        )

    current = url
    for hop in range(MAX_REDIRECTS + 1):
        host = _check_url(current)
        # Blocking, but bounded and cached by the resolver; a thread keeps a
        # slow DNS answer from stalling the event loop for the whole batch.
        await asyncio.to_thread(_check_addresses, host)
        try:
            async with httpx.AsyncClient(
                timeout=FETCH_TIMEOUT_S,
                follow_redirects=False,
                headers={"User-Agent": USER_AGENT, "Accept": "image/*"},
            ) as client:
                async with client.stream("GET", current) as response:
                    if response.is_redirect:
                        location = response.headers.get("location", "")
                        if not location or hop == MAX_REDIRECTS:
                            raise LogoFetchError(
                                "image_url_unreachable",
                                "Too many redirects, or a redirect with no target.",
                            )
                        # Re-validated from the top of the loop: a redirect off
                        # the allowlist is exactly how one would be bypassed.
                        current = str(httpx.URL(current).join(location))
                        continue
                    if response.status_code != 200:
                        raise LogoFetchError(
                            "image_url_unreachable",
                            f"The URL answered {response.status_code}.",
                        )
                    data = await _read_capped(response)
        except LogoFetchError:
            raise
        except httpx.HTTPError as exc:
            raise LogoFetchError(
                "image_url_unreachable", f"Could not fetch the URL: {exc}"
            ) from exc

        if not data:
            raise LogoFetchError("empty_image", "The URL returned no bytes.")
        mime = sniff(data[:16])
        if mime is None:
            raise LogoFetchError(
                "missing_mime",
                "What came back is not a PNG, JPEG, WebP or GIF — an SVG or an "
                "error page, most likely. Check the URL points straight at a "
                "raster image file.",
            )
        return data, mime

    # Unreachable: the loop either returns or raises.
    raise LogoFetchError("image_url_unreachable", "Too many redirects.")


class _FetchCache:
    """Bytes already fetched in this process, so a commit re-uses the preview.

    A dry run fetches so it can tell the caller *now* whether the URL yields a
    usable image; without this the commit that follows would download every one
    of them a second time. Small and short-lived on purpose — it exists to join
    one preview to the commit right after it, not to be a logo store.
    """

    def __init__(self, max_entries: int = 64, ttl_s: float = 600.0) -> None:
        self._max = max_entries
        self._ttl = ttl_s
        self._items: dict[str, tuple[float, bytes, str]] = {}

    def get(self, url: str) -> tuple[bytes, str] | None:
        hit = self._items.get(url)
        if hit is None:
            return None
        stamped, data, mime = hit
        if time.monotonic() - stamped > self._ttl:
            self._items.pop(url, None)
            return None
        return data, mime

    def put(self, url: str, data: bytes, mime: str) -> None:
        if len(self._items) >= self._max:
            # Plain FIFO: the working set is "the batch being previewed".
            oldest = next(iter(self._items), None)
            if oldest is not None:
                self._items.pop(oldest, None)
        self._items[url] = (time.monotonic(), data, mime)

    def clear(self) -> None:
        self._items.clear()


FETCH_CACHE = _FetchCache()


async def fetch_logo_cached(url: str, sniff: SniffFn) -> tuple[bytes, str]:
    """`fetch_logo`, reusing what a dry run in this process already downloaded."""
    hit = FETCH_CACHE.get(url)
    if hit is not None:
        return hit
    data, mime = await fetch_logo(url, sniff)
    FETCH_CACHE.put(url, data, mime)
    return data, mime
