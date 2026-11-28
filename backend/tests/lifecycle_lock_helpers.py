"""A licensed extension holding the maintained-lifecycle grant, for tests.

Loads the in-memory registry with one invented extension (``acme-sync``) that
holds ``core.cards.write`` + ``core.cards.maintain_lifecycle`` and a perpetual
entitlement, so a card's ``lifecycle_maintained`` claim naming it is in force.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.services.extensions.license import Entitlement, LicenseDocument
from app.services.extensions.registry import ExtensionInfo, extension_registry

MAINTAINER = "acme-sync"
MAINTAIN_GRANTS = ["core.cards.write", "core.cards.maintain_lifecycle"]


def load_maintainer(key: str = MAINTAINER, **overrides) -> None:
    values = dict(
        key=key,
        name="Acme Sync",
        version="1.0.0",
        status="installed",
        enabled=True,
        manifest={"grants": MAINTAIN_GRANTS},
    )
    values.update(overrides)
    extension_registry.clear()
    extension_registry.load_installed([ExtensionInfo(**values)])
    extension_registry.set_license(
        LicenseDocument(
            licensee="ACME",
            customer_id="cus_1",
            issued_at=datetime.now(timezone.utc) - timedelta(days=1),
            grace_days=30,
            entitlements=[Entitlement(extension_key=key, expires_at=None)],
        )
    )
