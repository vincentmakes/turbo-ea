"""Write gate on extension-contributed card fields ("gate the pen, never the page").

An extension that contributes field sections to an existing card type (its
manifest's ``metamodel.field_sections``, see ``field_contributions``) stamps
every contributed field ``"ext": "<key>"``; the values live in
``cards.attributes``. Those values may only CHANGE while that extension is
enabled and holds a usable entitlement (active, grace or free). Otherwise they
stay visible and are never deleted, but every user-driven writer — REST, the
bulk endpoints, MCP, the extension data bridge, survey apply — refuses a
change to them, and the bulk importers (ServiceNow, platform migration,
rollback) keep the stored value and report the field as skipped.

The predicate is deliberately NOT tied to ``failed`` / ``needs_restart``: a
backend that failed to load is an operational problem, and it must never lock
a paying customer's data. Only what the admin or the licence decides counts —
installed, enabled, not disabled, usable entitlement.

Pure helpers first (unit-tested without a database), then two thin async
loaders that read a card type's ``fields_schema``. This module imports neither
``field_contributions`` nor ``bundle``: ``card_write_service`` imports it, and
``bundle`` closes an import cycle through ``catalogue_common``.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from datetime import datetime
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.extensions.registry import ExtensionRegistry, extension_registry

#: ``detail.error`` of the 403 a refused write answers with.
LOCKED_ERROR = "extension_fields_locked"

#: Statuses in which the admin has taken the extension out of service.
_INACTIVE_STATUSES = ("removed", "disabled")


def extension_fields_writable(
    key: str, registry: ExtensionRegistry | None = None, now: datetime | None = None
) -> bool:
    """May the fields extension ``key`` contributed be changed right now?

    True when it is installed, enabled, not disabled or removed, and its
    entitlement is usable (active, grace or free). ``failed`` and
    ``needs_restart`` do not lock: a broken load is not a licence decision.
    """
    reg = extension_registry if registry is None else registry
    info = reg.get(key)
    if info is None or not info.enabled or info.status in _INACTIVE_STATUSES:
        return False
    return reg.entitlement(key, now=now).usable


def _schema_fields(fields_schema: Any) -> Iterable[dict]:
    for section in fields_schema if isinstance(fields_schema, list) else []:
        if not isinstance(section, dict):
            continue
        for field in section.get("fields") or []:
            if isinstance(field, dict) and isinstance(field.get("key"), str) and field["key"]:
                yield field


def _manifest_fields(manifest: Any, type_key: str) -> Iterable[dict]:
    """Fields a manifest contributes to ``type_key`` (``metamodel.field_sections``)."""
    block = manifest.get("metamodel") if isinstance(manifest, dict) else None
    sections = block.get("field_sections") if isinstance(block, dict) else None
    for section in sections if isinstance(sections, list) else []:
        if not isinstance(section, dict) or section.get("card_type") != type_key:
            continue
        for field in section.get("fields") or []:
            if isinstance(field, dict) and isinstance(field.get("key"), str) and field["key"]:
                yield field


def locked_fields(
    type_key: str,
    fields_schema: Any,
    registry: ExtensionRegistry | None = None,
    now: datetime | None = None,
) -> dict[str, str]:
    """Attribute keys of ``type_key`` that may not be changed, mapped to their label.

    Two sources:

    - a field of ``fields_schema`` stamped ``ext: <key>`` whose extension is
      not writable (see :func:`extension_fields_writable`);
    - a field the manifest of an installed but not writable extension
      contributes to this type, while the schema does not carry that key at
      all — a disabled extension's fields are stripped from the schema while
      their values stay on the cards, and those values stay read-only. A key
      the schema does carry (an admin's own field of the same name) is never
      locked this way.
    """
    reg = extension_registry if registry is None else registry
    writable: dict[str, bool] = {}

    def _writable(key: str) -> bool:
        if key not in writable:
            writable[key] = extension_fields_writable(key, reg, now)
        return writable[key]

    locked: dict[str, str] = {}
    present: set[str] = set()
    for field in _schema_fields(fields_schema):
        key = field["key"]
        present.add(key)
        owner = field.get("ext")
        if isinstance(owner, str) and owner and not _writable(owner):
            locked[key] = str(field.get("label") or key)

    for info in reg.all():
        if info.status == "removed" or _writable(info.key):
            continue
        for field in _manifest_fields(info.manifest, type_key):
            key = field["key"]
            if key in present or key in locked:
                continue
            locked[key] = str(field.get("label") or key)
    return locked


def _is_empty(value: Any) -> bool:
    """The app-wide "not filled" predicate (mirrors ``card_write_service``)."""
    return value is None or value == "" or value == []


def _same(old: Any, new: Any) -> bool:
    return old == new or (_is_empty(old) and _is_empty(new))


def apply_field_lock(
    stored: Mapping[str, Any] | None,
    incoming: Mapping[str, Any],
    locked: Mapping[str, str],
) -> tuple[dict[str, Any], list[str]]:
    """What a write may store over ``stored``, and which locked keys it tried to change.

    ``incoming`` is a whole ``attributes`` dict (a write replaces the column).
    Every locked key comes back at its stored state: absent from ``incoming``
    → carried over (so a full-replace PATCH or a shared bulk map that never
    mentions the field cannot wipe it); present and unchanged (empty counts
    as equal to absent) → passes; present and changed → kept at the stored
    value and named in the second element. On create ``stored`` is empty, so
    any non-empty locked value is refused. Shape of
    ``cost_field_filter.keep_stored_cost_values``.
    """
    current = stored or {}
    out = dict(incoming)
    refused: list[str] = []
    for key in locked:
        if key in out and not _same(current.get(key), out[key]):
            refused.append(key)
        if key in current:
            out[key] = current[key]
        else:
            out.pop(key, None)
    return out, refused


def locked_error(refused: list[str], locked: Mapping[str, str]) -> HTTPException:
    """The 403 a user-driven write answers with when it changed a locked field."""
    labels = ", ".join(locked.get(key) or key for key in refused)
    return HTTPException(
        status_code=403,
        detail={
            "error": LOCKED_ERROR,
            "message": (
                "These fields are read-only because the extension that provides them "
                f"is not active or licensed: {labels}."
            ),
            "fields": list(refused),
        },
    )


def checked_attributes(
    stored: Mapping[str, Any] | None,
    incoming: Mapping[str, Any] | None,
    locked: Mapping[str, str],
) -> dict[str, Any]:
    """:func:`apply_field_lock` for a user-driven write: raise on a change."""
    attrs, refused = apply_field_lock(stored, incoming or {}, locked)
    if refused:
        raise locked_error(refused, locked)
    return attrs


async def locked_fields_for_type(db: AsyncSession, type_key: str) -> dict[str, str]:
    """:func:`locked_fields` for a card type read from the database."""
    from app.models.card_type import CardType

    schema = (
        await db.execute(select(CardType.fields_schema).where(CardType.key == type_key))
    ).scalar_one_or_none()
    return locked_fields(type_key, schema)


async def enforce_field_lock(
    db: AsyncSession,
    type_key: str,
    stored: Mapping[str, Any] | None,
    incoming: Mapping[str, Any] | None,
) -> Any:
    """Gate one user-driven attribute write. Returns ``incoming`` untouched
    when the type has no locked field, else the carried-over dict; raises the
    403 of :func:`locked_error` when a locked value would change."""
    locked = await locked_fields_for_type(db, type_key)
    if not locked:
        return incoming
    return checked_attributes(stored, incoming, locked)
