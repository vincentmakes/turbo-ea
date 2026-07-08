"""Process-wide registry of installed extensions and the active license.

The registry is an in-memory snapshot loaded from the ``extensions`` and
``extension_licenses`` tables during application startup and refreshed by
the admin mutations (license upload, enable/disable, install, uninstall).
Keeping it in memory means the per-request ``require_extension`` gate
never touches the database on the hot path.

Single-container assumption: license or enable/disable changes made on
one backend replica are not pushed to others — today Turbo EA deploys a
single backend container, so this is fine; scale-out would need a
restart per replica (documented limitation).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.extensions.license import (
    LicenseDocument,
    LicenseError,
    entitlement_state,
    grace_until,
    parse_and_verify,
)

logger = logging.getLogger(__name__)

EntitlementStateWithUnlicensed = Literal["active", "grace", "expired", "unlicensed"]


@dataclass(frozen=True)
class EntitlementStatus:
    state: EntitlementStateWithUnlicensed
    plan: str = ""
    expires_at: datetime | None = None
    grace_until: datetime | None = None

    @property
    def usable(self) -> bool:
        """Whether the extension may run (grace still counts as licensed)."""
        return self.state in ("active", "grace")


@dataclass
class ExtensionInfo:
    key: str
    name: str
    version: str
    status: str  # installed | needs_restart | disabled | failed | removed
    enabled: bool
    capabilities: list[str] = field(default_factory=list)
    manifest: dict = field(default_factory=dict)


class ExtensionRegistry:
    def __init__(self) -> None:
        self._extensions: dict[str, ExtensionInfo] = {}
        self._license: LicenseDocument | None = None

    # ── population ──────────────────────────────────────────────────────

    def load_installed(self, infos: list[ExtensionInfo]) -> None:
        self._extensions = {info.key: info for info in infos}

    def set_license(self, doc: LicenseDocument | None) -> None:
        self._license = doc

    async def refresh_from_db(self, db: AsyncSession) -> None:
        """Reload extensions + active license from the database.

        Called during startup and after every admin mutation. A stored
        license that no longer verifies (e.g. the vendor key changed
        between releases) is treated as absent — fail closed, log loud.
        """
        from app.models.extension import Extension, ExtensionLicense

        rows = (
            (await db.execute(select(Extension).where(Extension.status != "removed")))
            .scalars()
            .all()
        )
        self.load_installed(
            [
                ExtensionInfo(
                    key=row.key,
                    name=row.name,
                    version=row.version,
                    status=row.status,
                    enabled=row.enabled,
                    capabilities=list(row.capabilities or []),
                    manifest=dict(row.manifest or {}),
                )
                for row in rows
            ]
        )

        license_row = (
            await db.execute(
                select(ExtensionLicense)
                .where(ExtensionLicense.is_active == True)  # noqa: E712
                .order_by(ExtensionLicense.created_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        if license_row is None:
            self._license = None
            return
        try:
            self._license = parse_and_verify(license_row.raw_text)
        except LicenseError as exc:
            logger.error("Stored extension license failed verification: %s", exc)
            self._license = None

    # ── queries ─────────────────────────────────────────────────────────

    def get(self, key: str) -> ExtensionInfo | None:
        return self._extensions.get(key)

    def all(self) -> list[ExtensionInfo]:
        return list(self._extensions.values())

    @property
    def license(self) -> LicenseDocument | None:
        return self._license

    def entitlement(self, key: str, now: datetime | None = None) -> EntitlementStatus:
        if self._license is None:
            return EntitlementStatus(state="unlicensed")
        ent = self._license.entitlement_for(key)
        if ent is None:
            return EntitlementStatus(state="unlicensed")
        return EntitlementStatus(
            state=entitlement_state(ent, self._license.grace_days, now=now),
            plan=ent.plan,
            expires_at=ent.expires_at,
            grace_until=grace_until(ent, self._license.grace_days),
        )

    def clear(self) -> None:
        """Reset to empty — test helper."""
        self._extensions = {}
        self._license = None


extension_registry = ExtensionRegistry()
