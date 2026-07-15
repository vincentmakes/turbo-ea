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

EntitlementStateWithUnlicensed = Literal["active", "grace", "expired", "unlicensed", "free"]


@dataclass(frozen=True)
class EntitlementStatus:
    state: EntitlementStateWithUnlicensed
    expires_at: datetime | None = None
    grace_until: datetime | None = None

    @property
    def usable(self) -> bool:
        """Whether the extension may run (grace and free both count as usable)."""
        return self.state in ("active", "grace", "free")


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
        # Human-readable reason the stored license is not in effect (failed
        # verification or bound to a different instance) — surfaced on the
        # admin page so a restored/copied DB explains itself.
        self._license_problem: str | None = None

    # ── population ──────────────────────────────────────────────────────

    def load_installed(self, infos: list[ExtensionInfo]) -> None:
        self._extensions = {info.key: info for info in infos}

    def set_license(self, doc: LicenseDocument | None) -> None:
        self._license = doc
        self._license_problem = None

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
            self._license_problem = None
            return
        try:
            doc = parse_and_verify(license_row.raw_text)
        except LicenseError as exc:
            logger.error("Stored extension license failed verification: %s", exc)
            self._license = None
            self._license_problem = str(exc)
            return

        # Instance binding: a license issued for another instance (e.g. a DB
        # restored onto a fresh install with a new ID) is not in effect —
        # everything evaluates as unlicensed until the vendor re-keys it.
        # Data is never touched; same soft-disable semantics as expiry.
        from app.services.extensions.instance_id import license_binding_problem

        problem = license_binding_problem(doc.instance_id)
        if problem:
            logger.error("Stored extension license rejected: %s", problem)
            self._license = None
            self._license_problem = problem
            return
        self._license = doc
        self._license_problem = None

    # ── queries ─────────────────────────────────────────────────────────

    def get(self, key: str) -> ExtensionInfo | None:
        return self._extensions.get(key)

    def all(self) -> list[ExtensionInfo]:
        return list(self._extensions.values())

    @property
    def license(self) -> LicenseDocument | None:
        return self._license

    @property
    def license_problem(self) -> str | None:
        return self._license_problem

    def entitlement(self, key: str, now: datetime | None = None) -> EntitlementStatus:
        # Free extensions require no license: the manifest's ``free`` flag rides
        # inside the Ed25519-signed bundle, so this is anchored to verified
        # provenance, not spoofable config. Checked before the license path so a
        # free extension is usable even on an instance with no license at all.
        info = self._extensions.get(key)
        if info is not None and (info.manifest or {}).get("free") is True:
            return EntitlementStatus(state="free")
        if self._license is None:
            return EntitlementStatus(state="unlicensed")
        ent = self._license.entitlement_for(key)
        if ent is None:
            return EntitlementStatus(state="unlicensed")
        return EntitlementStatus(
            state=entitlement_state(ent, self._license.grace_days, now=now),
            expires_at=ent.expires_at,
            grace_until=grace_until(ent, self._license.grace_days),
        )

    def grants_for(self, key: str, now: datetime | None = None) -> list[str]:
        """Core capabilities an extension *unlocks*, only while it is usable.

        An extension declares ``"grants": ["metamodel.field_help", ...]`` in its
        manifest to light up an otherwise-inert core capability (help text,
        custom field types, …). Grants count only when the extension is enabled,
        not failed/removed, and holds a usable (active or grace) entitlement — a
        lapse withdraws the authoring affordance without touching stored data.
        """
        info = self._extensions.get(key)
        if (
            info is None
            or not info.enabled
            or info.status in ("removed", "failed", "needs_restart")
        ):
            return []
        if not self.entitlement(key, now=now).usable:
            return []
        grants = (info.manifest or {}).get("grants") or []
        return [str(g) for g in grants] if isinstance(grants, list) else []

    def granted_capabilities(self, now: datetime | None = None) -> set[str]:
        """Union of every core capability unlocked by an enabled, licensed extension."""
        out: set[str] = set()
        for key in self._extensions:
            out.update(self.grants_for(key, now=now))
        return out

    def clear(self) -> None:
        """Reset to empty — test helper."""
        self._extensions = {}
        self._license = None
        self._license_problem = None


extension_registry = ExtensionRegistry()
