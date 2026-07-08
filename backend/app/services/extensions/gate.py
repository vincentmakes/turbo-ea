"""Per-request soft-disable gate for extension API surfaces.

Extension routers are mounted at import time (routes are static once the
app starts), so activation is enforced here on every request instead:

- extension not installed          → 404 (surface indistinguishable from
  a route that never existed — same philosophy as the ops API)
- extension disabled by the admin  → 403
- no usable entitlement (expired past grace, or unlicensed) → 403

``active`` and ``grace`` entitlements both pass — grace is a warning
state, never an outage. The check reads the in-memory registry only; it
never touches the database.
"""

from __future__ import annotations

from fastapi import HTTPException

from app.services.extensions.registry import extension_registry


def require_extension(key: str):
    """Dependency factory gating every route of extension ``key``."""

    async def _check() -> None:
        info = extension_registry.get(key)
        if info is None or info.status == "removed":
            raise HTTPException(status_code=404, detail="Not found")
        if not info.enabled or info.status == "disabled":
            raise HTTPException(status_code=403, detail="Extension is disabled")
        if not extension_registry.entitlement(key).usable:
            raise HTTPException(
                status_code=403,
                detail="Extension license is expired or missing",
            )

    return _check
