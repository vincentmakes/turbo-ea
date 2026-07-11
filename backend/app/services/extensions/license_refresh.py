"""Automatic license renewal from the extension store.

Store-issued licenses embed a ``renewal_key`` (an HMAC credential the store
derives from the Stripe customer id — nothing the instance ever registers
for). When the active license carries one and an entitlement is close to
expiry, the instance fetches a freshly re-signed composite license from the
store's public renewal endpoint and applies it — so a renewing subscription
extends the license with **zero customer action**. The fetched license goes
through the exact same trusted-key signature verification as a pasted one.

Manually issued (offline / enterprise / air-gapped) licenses have no
``renewal_key``; for them — and whenever the store is unreachable — this
module does nothing and the existing manual paste + grace flow applies.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.extension import ExtensionLicense
from app.services.extensions.instance_id import get_instance_id, license_binding_problem
from app.services.extensions.license import LicenseDocument, LicenseError, parse_and_verify
from app.services.extensions.registry import extension_registry

logger = logging.getLogger(__name__)

# Start trying to renew this many days before the earliest expiry. Wide
# enough to ride out store downtime; the daily loop retries until renewal
# lands (or the entitlement runs through expiry + grace as before).
REFRESH_WINDOW_DAYS = 14

_RENEW_TIMEOUT = 10.0


async def persist_license(
    db: AsyncSession, doc: LicenseDocument, created_by: uuid.UUID | None
) -> ExtensionLicense:
    """Make ``doc`` the active license (supersede previous, keep audit rows)."""
    actives = (
        (
            await db.execute(
                select(ExtensionLicense).where(ExtensionLicense.is_active == True)  # noqa: E712
            )
        )
        .scalars()
        .all()
    )
    for old in actives:
        old.is_active = False
    row = ExtensionLicense(
        raw_text=doc.raw_text,
        key_id=doc.key_id or None,
        licensee=doc.licensee,
        customer_id=doc.customer_id or None,
        issued_at=doc.issued_at,
        grace_days=doc.grace_days,
        entitlements=[
            {
                "extension_key": ent.extension_key,
                "expires_at": ent.expires_at.isoformat() if ent.expires_at else None,
            }
            for ent in doc.entitlements
        ],
        is_active=True,
        created_by=created_by,
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    await extension_registry.refresh_from_db(db)
    return row


def _earliest_expiry(doc: LicenseDocument) -> datetime | None:
    expiries = [e.expires_at for e in doc.entitlements if e.expires_at is not None]
    return min(expiries) if expiries else None


def _extends(new: LicenseDocument, current: LicenseDocument) -> bool:
    """True when applying ``new`` is an improvement over ``current``."""
    new_exp, cur_exp = _earliest_expiry(new), _earliest_expiry(current)
    if new_exp is not None and cur_exp is not None and new_exp > cur_exp:
        return True
    # New entitlements (a later purchase) also count, even at equal expiry.
    return bool(
        {e.extension_key for e in new.entitlements}
        - {e.extension_key for e in current.entitlements}
    )


def should_refresh(doc: LicenseDocument, now: datetime | None = None) -> bool:
    """Renewable license whose earliest expiry is inside the refresh window."""
    if not doc.renewal_key or not doc.customer_id:
        return False
    earliest = _earliest_expiry(doc)
    if earliest is None:
        return False  # perpetual — nothing to renew
    now = now or datetime.now(timezone.utc)
    return earliest <= now + timedelta(days=REFRESH_WINDOW_DAYS)


async def refresh_license_if_due(
    db: AsyncSession, now: datetime | None = None, force: bool = False
) -> bool:
    """One renewal attempt. Returns True when a fresher license was applied.

    ``force=True`` skips the expiry-window gate (the per-row Renew button
    and the after-purchase refetch want an immediate check) but still
    requires a store-issued license carrying a renewal credential.

    Never raises on network/store trouble — air-gapped and offline installs
    hit this daily and must stay silent (debug log only).
    """
    store_url = settings.EXTENSION_STORE_URL.strip()
    if not store_url:
        return False

    row = (
        await db.execute(
            select(ExtensionLicense)
            .where(ExtensionLicense.is_active == True)  # noqa: E712
            .order_by(ExtensionLicense.created_at.desc())
            .limit(1)
        )
    ).scalar_one_or_none()
    if row is None:
        return False

    try:
        current = parse_and_verify(row.raw_text)
    except LicenseError:
        logger.warning("Active license no longer verifies — skipping auto-renewal")
        return False

    if license_binding_problem(current.instance_id):
        # Bound to a different instance (restored DB, cloned volume) —
        # renewing it would perpetuate the wrong identity. The admin
        # banner explains; the vendor re-keys.
        logger.warning("Active license is bound to another instance — skipping auto-renewal")
        return False

    if force:
        if not current.renewal_key or not current.customer_id:
            return False
    elif not should_refresh(current, now=now):
        return False

    url = store_url.rstrip("/") + "/account/renew"
    # POST the renewal credential in the body rather than the query string so it
    # never lands in store/proxy access logs. Instance-keyed issuance (see the
    # instance-id licensing design): the store resolves entitlements by instance
    # ID; customer stays for cross-reference/back-compat.
    body = {"customer": current.customer_id, "key": current.renewal_key}
    instance = get_instance_id()
    if instance:
        body["instance"] = instance
    try:
        async with httpx.AsyncClient(timeout=_RENEW_TIMEOUT) as client:
            resp = await client.post(url, json=body)
            resp.raise_for_status()
            data = resp.json()
            text = data.get("license", "") if isinstance(data, dict) else ""
    except (httpx.HTTPError, ValueError, TypeError) as exc:
        logger.debug("License auto-renewal skipped (store unreachable): %s", exc)
        return False

    try:
        fresh = parse_and_verify(text)
    except LicenseError as exc:
        logger.warning("Store returned a license that does not verify: %s", exc)
        return False

    if license_binding_problem(fresh.instance_id):
        logger.warning("Store returned a license bound to another instance — not applied")
        return False

    if fresh.customer_id != current.customer_id or not _extends(fresh, current):
        return False

    await persist_license(db, fresh, created_by=None)
    logger.info(
        "License auto-renewed from the extension store (licensee=%s, earliest expiry %s)",
        fresh.licensee,
        _earliest_expiry(fresh),
    )
    return True
