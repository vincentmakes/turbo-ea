"""Unit tests for the automatic license-renewal decision logic (no DB).

The network + persistence path is exercised via the API/loop integration;
these cover the pure rules: when a refresh is due, and when a fetched
license actually counts as an extension of the current one.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.services.extensions.license import Entitlement, LicenseDocument
from app.services.extensions.license_refresh import (
    REFRESH_WINDOW_DAYS,
    _extends,
    should_refresh,
)

NOW = datetime(2026, 7, 8, 12, 0, tzinfo=timezone.utc)


def make_doc(
    *,
    renewal_key: str = "rk_abc",
    customer_id: str = "cus_1",
    expires_in_days: float | None = 5,
    keys: tuple[str, ...] = ("esg-pack",),
) -> LicenseDocument:
    expires = NOW + timedelta(days=expires_in_days) if expires_in_days is not None else None
    return LicenseDocument(
        licensee="ACME Corp",
        customer_id=customer_id,
        issued_at=NOW - timedelta(days=30),
        grace_days=30,
        entitlements=[Entitlement(extension_key=k, expires_at=expires) for k in keys],
        renewal_key=renewal_key,
    )


class TestShouldRefresh:
    def test_due_inside_window(self):
        assert should_refresh(make_doc(expires_in_days=5), now=NOW) is True

    def test_already_expired_still_tries(self):
        """Expired-but-in-grace licenses keep retrying (payment may have resumed)."""
        assert should_refresh(make_doc(expires_in_days=-3), now=NOW) is True

    def test_not_due_outside_window(self):
        assert should_refresh(make_doc(expires_in_days=REFRESH_WINDOW_DAYS + 1), now=NOW) is False

    def test_manually_issued_license_never_refreshes(self):
        assert should_refresh(make_doc(renewal_key=""), now=NOW) is False

    def test_missing_customer_id_never_refreshes(self):
        assert should_refresh(make_doc(customer_id=""), now=NOW) is False

    def test_perpetual_license_never_refreshes(self):
        assert should_refresh(make_doc(expires_in_days=None), now=NOW) is False


class TestExtends:
    def test_later_expiry_extends(self):
        assert _extends(make_doc(expires_in_days=35), make_doc(expires_in_days=5)) is True

    def test_same_or_earlier_expiry_does_not(self):
        assert _extends(make_doc(expires_in_days=5), make_doc(expires_in_days=5)) is False
        assert _extends(make_doc(expires_in_days=2), make_doc(expires_in_days=5)) is False

    def test_cancelled_subscription_never_shrinks_the_license(self):
        """A reissued license with the entitlement gone must not be applied."""
        cancelled = make_doc(keys=(), expires_in_days=None)
        assert _extends(cancelled, make_doc(expires_in_days=5)) is False

    def test_new_extension_counts_as_extension(self):
        wider = make_doc(keys=("esg-pack", "other-pack"), expires_in_days=5)
        assert _extends(wider, make_doc(expires_in_days=5)) is True
