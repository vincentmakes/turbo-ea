"""Composite license issuance.

Turbo EA cores hold exactly ONE active license, so the store always
issues a **composite** license covering every usable entitlement a
customer currently has — one entitlement per subscribed extension, with
``expires_at`` mirroring the Stripe ``current_period_end``. Licenses are
regenerated on demand from subscription rows, so there is nothing to
invalidate: cancel/renew in Stripe, and the next refresh reflects it.

The signing format matches ``teax sign-license`` /
``backend/app/services/extensions/license.py`` exactly: Ed25519 over the
raw payload bytes, wrapped in the ``turboea-license/1`` envelope with
this store's ``key_id``.
"""

from __future__ import annotations

import base64
import json
from datetime import datetime, timezone

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from turbo_ea_store.config import settings
from turbo_ea_store.models import Customer, Product, Subscription

LICENSE_SCHEMA = "turboea-license/1"

# Subscription states that keep an entitlement alive. ``past_due`` stays
# entitled — Stripe is still retrying payment and the license's own grace
# window is the real cushion.
ENTITLED_STATUSES = {"active", "trialing", "past_due"}


def signing_key() -> Ed25519PrivateKey:
    if not settings.STORE_SIGNING_KEY:
        raise RuntimeError("STORE_SIGNING_KEY is not configured")
    return Ed25519PrivateKey.from_private_bytes(base64.b64decode(settings.STORE_SIGNING_KEY))


def entitled_subscriptions(subscriptions: list[Subscription]) -> list[Subscription]:
    """Newest entitled subscription per extension key."""
    best: dict[str, Subscription] = {}
    for sub in subscriptions:
        if sub.status not in ENTITLED_STATUSES:
            continue
        current = best.get(sub.extension_key)
        if current is None or (
            sub.current_period_end or datetime.min.replace(tzinfo=timezone.utc)
        ) > (current.current_period_end or datetime.min.replace(tzinfo=timezone.utc)):
            best[sub.extension_key] = sub
    return sorted(best.values(), key=lambda s: s.extension_key)


def build_license(
    customer: Customer,
    subscriptions: list[Subscription],
    products: dict[str, Product],
) -> str:
    """Sign and return the customer's current composite license text."""
    entitlements = []
    for sub in entitled_subscriptions(subscriptions):
        product = products.get(sub.extension_key)
        entitlements.append(
            {
                "extension_key": sub.extension_key,
                "plan": product.plan if product else "standard",
                "expires_at": (
                    sub.current_period_end.astimezone(timezone.utc)
                    .replace(microsecond=0)
                    .isoformat()
                    .replace("+00:00", "Z")
                    if sub.current_period_end
                    else None
                ),
            }
        )

    payload = {
        "licensee": customer.email,
        "customer_id": customer.stripe_customer_id,
        "issued_at": datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z"),
        "grace_days": settings.LICENSE_GRACE_DAYS,
        "entitlements": entitlements,
    }
    payload_bytes = json.dumps(payload, ensure_ascii=False).encode()
    private = signing_key()
    envelope = {
        "schema": LICENSE_SCHEMA,
        "key_id": settings.STORE_SIGNING_KEY_ID,
        "payload": base64.b64encode(payload_bytes).decode(),
        "signature": base64.b64encode(private.sign(payload_bytes)).decode(),
    }
    return json.dumps(envelope, indent=2)
