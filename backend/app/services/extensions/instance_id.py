"""Per-instance identity for extension licensing.

Every install mints a single **instance ID** — ``TEA-XXXX-XXXX-XXXX``,
twelve Crockford-base32 characters (no I/L/O/U) where the last one is a
position-weighted checksum — persisted in
``app_settings.general_settings["instanceId"]`` and generated exactly once
at startup (:func:`ensure_instance_id`). Purchases carry it (the in-app Buy
button appends it to the Stripe ``client_reference_id``; the public
storefront asks for it in a required checkout field), so the store can
aggregate every entitlement bought for this instance into one composite
license regardless of which admin/email paid. Licenses embed it and core
**binds** on it: a license issued for a different instance is refused.

Two rules the rest of the code relies on:

- **The ID identifies; it never authenticates.** Claim tokens and the
  license ``renewal_key`` remain the only download credentials, so a leaked
  ID (invoice, screenshot) cannot fetch anyone's license.
- **The ID travels with workspace transfer** (it lives in the settings
  sheet and must never be added to the secret-strip lists), so a host
  migration keeps the license valid. Binding is to the ID, not hardware.
"""

from __future__ import annotations

import logging
import secrets

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings

logger = logging.getLogger(__name__)

# Crockford base32: unambiguous when read aloud or retyped (no I, L, O, U).
_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
_PREFIX = "TEA"
_DATA_CHARS = 11  # + 1 check char = 12, grouped XXXX-XXXX-XXXX


def _check_char(data: str) -> str:
    """Position-weighted mod-32 check symbol over the data chars.

    Catches every single-character error and adjacent transpositions —
    the mistakes people actually make when retyping an ID into a
    checkout field. Mirrored in the storefront's validator; change both
    together or not at all.
    """
    total = sum((idx + 1) * _ALPHABET.index(ch) for idx, ch in enumerate(data))
    return _ALPHABET[total % 32]


def generate_instance_id() -> str:
    data = "".join(secrets.choice(_ALPHABET) for _ in range(_DATA_CHARS))
    body = data + _check_char(data)
    return f"{_PREFIX}-{body[0:4]}-{body[4:8]}-{body[8:12]}"


def validate_instance_id(value: object) -> bool:
    if not isinstance(value, str):
        return False
    parts = value.split("-")
    if len(parts) != 4 or parts[0] != _PREFIX or any(len(p) != 4 for p in parts[1:]):
        return False
    body = "".join(parts[1:])
    if any(ch not in _ALPHABET for ch in body):
        return False
    return _check_char(body[:_DATA_CHARS]) == body[-1]


# ── process-wide cache (set once at startup, read on the license hot path) ──

_instance_id: str | None = None


def get_instance_id() -> str | None:
    return _instance_id


def set_instance_id(value: str | None) -> None:
    """Set the cached ID — startup and tests."""
    global _instance_id
    _instance_id = value


async def ensure_instance_id(db: AsyncSession) -> str:
    """Load the persisted instance ID, minting it on first boot.

    Idempotent: an existing (valid) ID is never regenerated — entitlements
    hang off it. An invalid stored value (hand-edited DB) is replaced and
    logged loudly, since a broken ID can never match a license anyway.
    """
    from app.models.app_settings import AppSettings

    row = (await db.execute(select(AppSettings))).scalars().first()
    general = dict((row.general_settings if row else None) or {})
    current = general.get("instanceId")
    if isinstance(current, str) and validate_instance_id(current):
        set_instance_id(current)
        return current

    fresh = generate_instance_id()
    if current:
        logger.error("Stored instance ID %r is invalid — replacing with %s", current, fresh)
    general["instanceId"] = fresh
    if row is None:
        row = AppSettings(id="default", general_settings=general, email_settings={})
        db.add(row)
    else:
        row.general_settings = general
    await db.commit()
    set_instance_id(fresh)
    logger.info("Instance ID: %s", fresh)
    return fresh


def license_binding_problem(license_instance_id: str) -> str | None:
    """Why a license may not be used on this instance — ``None`` when it may.

    Bound licenses must match our ID exactly. Unbound licenses (no
    ``instance_id`` in the payload) are a development convenience only —
    the vendor pipeline and ``teax sign-license`` always stamp one — and
    are refused in production. When our own ID is not initialised yet
    (unit tests without a DB), binding cannot be evaluated and is skipped.
    """
    ours = get_instance_id()
    if ours is None:
        # Our ID isn't initialised. In tests (no DB) binding cannot be evaluated
        # and is skipped; in production a silent init failure must NOT fail open
        # into accepting a foreign-bound license.
        if settings.ENVIRONMENT == "development":
            return None
        return "Instance identity is not initialised — license binding cannot be verified."
    if not license_instance_id:
        if settings.ENVIRONMENT == "development":
            return None
        return (
            "This license is not bound to an instance ID. "
            "Ask your vendor for a license issued for instance "
            f"{ours}."
        )
    if license_instance_id != ours:
        return (
            f"This license was issued for instance {license_instance_id}; "
            f"this instance is {ours}. Ask your vendor to re-issue the "
            "license for this instance."
        )
    return None
