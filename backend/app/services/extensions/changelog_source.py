"""Where an extension's release notes come from, and what they look like.

Core answers "what changed in this release?" about *itself* from the
``CHANGELOG.md`` baked into its own image (``app.services.changelog``). An
extension needs the same answer, and has two places to get it — neither of
which is available in every situation, which is why both are here:

* **The bundle.** ``CHANGELOG.md`` sits at the root of the signed ``.teax``.
  Every member of a bundle must appear in the signed manifest's ``files`` map
  (``bundle._verify_zip``), so a changelog that is present is signature-covered
  by construction — no manifest field, no asset route and no ``teax`` change
  were needed to make it trustworthy. It is the only source that works
  air-gapped, and the only one that exists for a manually uploaded bundle.
  It is also the *newer* half of the story: per-extension changelogs are recent,
  so bundles published before they existed simply do not carry one.
* **The store.** The storefront publishes ``/changelogs/{key}.json`` beside
  ``catalog.json``, regenerated on every release and checked at publish time to
  lead with the version being sold. It covers every listed extension including
  the ones whose bundle predates the convention, and — the reason it matters
  most — it can be read *before* an update is applied, which is what lets an
  administrator decide whether to apply it.

Both are normalised to one thing: Keep-a-Changelog markdown, which
``app.services.changelog`` already slices by version range and the frontend
already renders. The store feed is JSON, so it is converted rather than given
its own renderer — one shape downstream means the pre-install dialog and the
post-update notification cannot drift.

Nothing here invents notes. When neither source has anything to say the answer
is an empty string and the caller shows an honest empty state.
"""

from __future__ import annotations

import json
import logging
import zipfile
from pathlib import Path

import httpx

from app.services.changelog import section_for, sections_between
from app.services.extensions.bundle import KEY_PATTERN
from app.services.extensions.installer import EXTENSIONS_DIR
from app.services.extensions.store_catalog import classify_store_error, store_client

logger = logging.getLogger(__name__)

#: The file an extension ships its release notes in, at the bundle root. A
#: convention rather than a manifest field: the signature already covers every
#: member, so declaring it would add a validation surface and buy nothing.
CHANGELOG_NAME = "CHANGELOG.md"

#: Read cap. An extension changelog is a few KB; core's own is ~480 KB after
#: years of releases. This bounds a hostile or accidentally huge file without
#: getting anywhere near a real one — and it is applied to the *bundle* member
#: too, where the signature proves provenance but says nothing about size.
MAX_CHANGELOG_BYTES = 1_000_000

#: Same reasoning as the catalogue fetch: a store slow to answer is, for our
#: purposes, a store that is down.
STORE_CHANGELOG_TIMEOUT = 6.0


# ---------------------------------------------------------------------------
# The bundle
# ---------------------------------------------------------------------------


def bundle_changelog(key: str, extensions_dir: Path | None = None) -> str:
    """The installed extension's ``CHANGELOG.md``, or ``""``.

    Absent is the normal case for anything packaged before per-extension
    changelogs existed, so it is never an error.
    """
    root = extensions_dir if extensions_dir is not None else EXTENSIONS_DIR
    path = root / key / CHANGELOG_NAME
    try:
        if not path.is_file() or path.stat().st_size > MAX_CHANGELOG_BYTES:
            return ""
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        logger.debug("Could not read the changelog for extension %s", key, exc_info=True)
        return ""


def bundle_changelog_from_zip(bundle_path: Path) -> str:
    """The same file, read out of a ``.teax`` that has not been applied yet.

    Call this only on a bundle ``bundle.read_bundle`` has already verified:
    that is what makes the member's bytes the ones the vendor signed. The read
    mirrors ``content_pack.load_content_from_zip``, which is the existing
    precedent for pulling one member out of a verified bundle.
    """
    try:
        with zipfile.ZipFile(bundle_path) as zf:
            try:
                info = zf.getinfo(CHANGELOG_NAME)
            except KeyError:
                return ""
            if info.file_size > MAX_CHANGELOG_BYTES:
                return ""
            return zf.read(CHANGELOG_NAME).decode("utf-8", errors="replace")
    except (OSError, zipfile.BadZipFile):
        logger.debug("Could not read the changelog from %s", bundle_path, exc_info=True)
        return ""


# ---------------------------------------------------------------------------
# The store
# ---------------------------------------------------------------------------


async def fetch_store_changelog(base_url: str, key: str) -> list[dict] | None:
    """GET ``{base_url}/changelogs/{key}.json``.

    ``None`` means "no published payload for this key" — a 404 is the ordinary
    answer for an extension that is installed but not listed, so it is not an
    error. Raises ``httpx.HTTPError`` for anything else; background callers
    want ``store_changelog_safe``.
    """
    if not KEY_PATTERN.match(key):
        # The key becomes a path segment. It is ours, not user input, but the
        # one cheap check that keeps it that way costs nothing.
        return None
    url = f"{base_url.rstrip('/')}/changelogs/{key}.json"
    async with store_client(STORE_CHANGELOG_TIMEOUT) as client:
        resp = await client.get(url)
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        if len(resp.content) > MAX_CHANGELOG_BYTES:
            return None
        try:
            payload = resp.json()
        except (json.JSONDecodeError, ValueError):
            return None
    return payload if isinstance(payload, list) else None


async def store_changelog_safe(base_url: str, key: str) -> list[dict] | None:
    """``fetch_store_changelog`` that never raises.

    Air-gapped and egress-restricted installs take this path and must stay
    quiet about it — exactly as ``fetch_store_catalog_safe`` does.
    """
    if not base_url.strip():
        return None
    try:
        return await fetch_store_changelog(base_url, key)
    except (httpx.HTTPError, ValueError) as exc:
        reason, status = classify_store_error(exc)
        if reason == "blocked":
            logger.warning(
                "Extension store changelog refused the request (%s): HTTP %s", key, status
            )
        else:
            logger.debug("Extension store changelog unreachable (%s): %s", key, exc)
        return None


def store_json_to_markdown(payload: list[dict]) -> str:
    """The published feed rendered as Keep-a-Changelog markdown.

    The feed is ``[{version, date, categories: [{name, items: [...]}]}]``,
    newest first, and its items still carry inline markdown (``**bold**``), so
    emitting the headings back around them lands on exactly the format
    ``sections_between`` slices and the frontend renders. Converting here
    rather than teaching the frontend a second shape is what keeps the
    pre-install dialog and the notification identical.

    Anything malformed is skipped rather than raising: this is vendor data
    fetched over the network, and a broken entry must not cost the reader the
    entries around it.
    """
    out: list[str] = []
    for section in payload:
        if not isinstance(section, dict):
            continue
        version = str(section.get("version") or "").strip()
        if not version:
            continue
        date = str(section.get("date") or "").strip()
        out.append(f"## [{version}]{f' - {date}' if date else ''}")

        categories = section.get("categories")
        for category in categories if isinstance(categories, list) else []:
            if not isinstance(category, dict):
                continue
            items = category.get("items")
            items = [str(i) for i in items if isinstance(i, str)] if isinstance(items, list) else []
            if not items:
                continue
            name = str(category.get("name") or "").strip()
            if name:
                out.append(f"### {name}")
            out.extend(f"- {item}" for item in items)
        out.append("")
    return "\n".join(out).strip()


# ---------------------------------------------------------------------------
# Resolving a span
# ---------------------------------------------------------------------------


def notes_between(text: str, *, version: str, from_version: str | None) -> str:
    """Markdown for ``(from_version, version]`` in ``text``, or ``""``.

    ``section_for`` runs first as the existence test, and this is not a
    micro-optimisation: ``sections_between`` treats ``upto`` as a *bound*, so a
    version the changelog has never heard of matches everything below it and
    would dump the entire file. Core's ``release_notes`` module makes the same
    move for the same reason.
    """
    if not text.strip() or not section_for(text, version):
        return ""
    if from_version and from_version != version:
        span = sections_between(text, after=from_version, upto=version)
        if span:
            return span
    return section_for(text, version)


async def resolve_extension_notes(
    *,
    key: str,
    version: str,
    from_version: str | None = None,
    prefer_store: bool = True,
) -> dict:
    """Release notes for one extension version, from whichever source has them.

    Returns ``{key, version, from_version, notes, source}`` where ``source`` is
    ``"store"``, ``"bundle"`` or ``"none"``.

    The store is tried first by default because it is the complete half — it
    carries every listed extension, including those whose published bundle
    predates per-extension changelogs — and the bundle answers when the store
    is unreachable, the key is unlisted, or the instance is air-gapped.

    Pass ``prefer_store=False`` when the bundle is the authority for the
    question being asked: the notes of the version *currently installed* should
    describe the bytes on disk, not whatever the catalogue has moved on to.
    """
    from app.config import settings

    async def from_store() -> str:
        payload = await store_changelog_safe(settings.EXTENSION_STORE_URL.strip(), key)
        if not payload:
            return ""
        return notes_between(
            store_json_to_markdown(payload), version=version, from_version=from_version
        )

    async def from_bundle() -> str:
        return notes_between(bundle_changelog(key), version=version, from_version=from_version)

    order = [("store", from_store), ("bundle", from_bundle)]
    if not prefer_store:
        order.reverse()

    for source, resolve in order:
        notes = await resolve()
        if notes:
            return {
                "key": key,
                "version": version,
                "from_version": from_version,
                "notes": notes,
                "source": source,
            }

    return {
        "key": key,
        "version": version,
        "from_version": from_version,
        "notes": "",
        "source": "none",
    }
