"""Reading the extension store's public catalogue, and comparing its versions.

The "store" is not a service the instance connects to: it is a static
``catalog.json`` plus public ``.teax`` bundles on vendor hosting
(``settings.EXTENSION_STORE_URL``, a baked-in code constant — see
``config.py``). There is no account, token or session; the instance only ever
reads public files.

This module owns the one function that reads that file and the one comparator
that decides whether a catalogue entry is newer than what is installed. Both
live in the service layer rather than in ``api/v1/extensions.py`` because two
callers need them and only one of them is a route: the Store tab's catalogue
proxy, and the daily ``app.services.extension_store_check`` probe that notifies
administrators about new and updated extensions. A background service importing
from the API layer would invert the dependency direction.

Keeping the *comparator* shared matters as much as the fetch: the "Update to X"
button on the Store tab and the notification in the bell must never disagree
about what counts as newer.
"""

from __future__ import annotations

import logging

import httpx

from app.config import APP_VERSION
from app.services.catalogue_common import version_tuple

logger = logging.getLogger(__name__)

#: The catalogue is a small static JSON file, so a short timeout is right — a
#: store that is slow to answer is, for our purposes, a store that is down.
STORE_CATALOG_TIMEOUT = 6.0

#: Identifies this instance to the store — and to anything in front of it.
#: httpx's default user agent is rejected outright by bot-protection products
#: that gate on non-browser clients, which is exactly how every cloud-hosted
#: instance came to see an empty Store tab (#958). The same block hits license
#: auto-renewal, where it is invisible, so the fix belongs on every store call
#: rather than on the catalogue alone.
STORE_USER_AGENT = f"TurboEA/{APP_VERSION} (+https://turbo-ea.org; extension-store)"


def store_client(timeout: float) -> httpx.AsyncClient:
    """The one HTTP client for every outbound call to the extension store.

    A single, stable, distinctive user agent is what lets a store operator — or
    a customer's own proxy — allowlist Turbo EA by name instead of by IP. It is
    trivially spoofable, and that costs nothing here: every store path an
    instance reads is public, and provenance comes from the Ed25519 signature on
    the bundle and the license, never from who served the bytes.

    ``app.services.sso_service`` sets a user agent on its JWKS fetch for the
    same reason; this is that lesson applied to the store surface.
    """
    return httpx.AsyncClient(timeout=timeout, headers={"User-Agent": STORE_USER_AGENT})


def classify_store_error(exc: Exception) -> tuple[str, int | None]:
    """``("blocked", status)`` or ``("offline", None)`` for a failed store call.

    The distinction is the whole point: an instance that got an HTTP response
    reached the store and was turned away — by bot protection, a WAF, a corporate
    proxy — while one that failed at the transport has no route to it at all.
    Reporting the first as the second is what sent #958's reporter auditing
    security groups and NAT for a problem that was never on his side.
    """
    if isinstance(exc, httpx.HTTPStatusError):
        return "blocked", exc.response.status_code
    return "offline", None


async def fetch_store_catalog(base_url: str) -> list[dict]:
    """GET ``{base_url}/catalog.json`` and return its ``extensions`` list.

    Raises ``httpx.HTTPError`` when the store is unreachable and ``ValueError``
    when the payload is not the expected shape — the route degrades those to an
    offline hint. Background callers want ``fetch_store_catalog_safe`` instead.

    Entries with no ``key`` are dropped: a catalogue row we cannot identify is
    one we can neither install nor annotate.
    """
    url = base_url.rstrip("/") + "/catalog.json"
    async with store_client(STORE_CATALOG_TIMEOUT) as client:
        resp = await client.get(url)
        resp.raise_for_status()
        data = resp.json()
    items = data.get("extensions") if isinstance(data, dict) else None
    if not isinstance(items, list):
        raise ValueError("catalog.json has no 'extensions' list")
    return [item for item in items if isinstance(item, dict) and item.get("key")]


async def fetch_store_catalog_safe(base_url: str) -> tuple[list[dict] | None, str | None]:
    """``(items, error)`` — never raises.

    A background loop that dies on a DNS hiccup is worse than one that records
    the hiccup, so this mirrors ``update_check.fetch_latest_release``. Air-gapped
    and egress-restricted installs take this path every day and must stay quiet.
    """
    try:
        return await fetch_store_catalog(base_url), None
    except (httpx.HTTPError, ValueError) as exc:
        reason, status = classify_store_error(exc)
        if reason == "blocked":
            # The store answered, so this is not an egress problem: something in
            # front of it turned us away. Say so at a level an operator sees.
            logger.warning(
                "Extension store catalogue refused the request (%s): HTTP %s", base_url, status
            )
            return None, f"The extension store refused the request (HTTP {status})"
        logger.debug("Extension store catalogue unreachable (%s): %s", base_url, exc)
        return None, "Could not reach the extension store"


def parsed_version(value: str | None) -> tuple[int, ...] | None:
    """Tolerant version tuple, or ``None`` when the string carries no digit.

    ``version_tuple`` degrades every unparseable chunk to ``0``, so on its own
    ``version_tuple("nightly") == (0,)`` — a value that compares *equal* to
    ``"0"`` and greater than nothing at all. Requiring at least one digit before
    trusting the parse means a non-version tag can never take part in a
    comparison in either direction, which is what stops a rolling ``nightly``
    tag from either announcing itself or masking a real release.
    """
    if not value or not any(ch.isdigit() for ch in value):
        return None
    return version_tuple(value)


def store_update_available(store_version: str | None, installed_version: str | None) -> bool:
    """Whether the catalogue carries a strictly newer version than the install.

    The single comparator behind both the Store tab's "Update to X" button and
    the daily notification. Unknown on either side means "no update": we would
    rather stay silent than announce an upgrade that isn't one.
    """
    store = parsed_version(store_version)
    installed = parsed_version(installed_version)
    return store is not None and installed is not None and store > installed
