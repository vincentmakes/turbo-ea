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
    _should_apply,
    should_refresh,
)

NOW = datetime(2026, 7, 8, 12, 0, tzinfo=timezone.utc)


def make_doc(
    *,
    renewal_key: str = "rk_abc",
    customer_id: str = "cus_1",
    expires_in_days: float | None = 5,
    keys: tuple[str, ...] = ("esg-pack",),
    auto_renew: bool | None = None,
    licensee: str = "ACME Corp",
    grace_days: int = 30,
) -> LicenseDocument:
    expires = NOW + timedelta(days=expires_in_days) if expires_in_days is not None else None
    return LicenseDocument(
        licensee=licensee,
        customer_id=customer_id,
        issued_at=NOW - timedelta(days=30),
        grace_days=grace_days,
        entitlements=[
            Entitlement(extension_key=k, expires_at=expires, auto_renew=auto_renew) for k in keys
        ],
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


class TestShouldApply:
    """_should_apply = _extends OR (identical coverage + renewal metadata change).

    The metadata arm is what lets a billing-portal cancellation reach a
    connected instance: the store re-issues the same coverage with
    auto_renew flipped, which the old must-extend rule rejected forever.
    """

    def test_extension_still_applies(self):
        assert _should_apply(make_doc(expires_in_days=35), make_doc(expires_in_days=5)) is True

    def test_identical_license_is_not_applied(self):
        assert (
            _should_apply(
                make_doc(expires_in_days=5, auto_renew=True),
                make_doc(expires_in_days=5, auto_renew=True),
            )
            is False
        )

    def test_auto_renew_flip_applies_at_identical_coverage(self):
        # Cancellation (true → false) and reactivation (false → true) both land.
        assert (
            _should_apply(
                make_doc(expires_in_days=5, auto_renew=False),
                make_doc(expires_in_days=5, auto_renew=True),
            )
            is True
        )
        assert (
            _should_apply(
                make_doc(expires_in_days=5, auto_renew=True),
                make_doc(expires_in_days=5, auto_renew=False),
            )
            is True
        )

    def test_flag_appearing_on_a_pre_field_license_applies(self):
        # Old license has auto_renew=None (pre-field); the store now stamps it.
        assert (
            _should_apply(
                make_doc(expires_in_days=5, auto_renew=True),
                make_doc(expires_in_days=5, auto_renew=None),
            )
            is True
        )

    def test_metadata_change_cannot_shrink_coverage(self):
        # Flag flipped AND a key dropped: not same coverage, not an extension
        # → refused. A metadata refresh can never lose an entitlement.
        narrower = make_doc(keys=("esg-pack",), expires_in_days=5, auto_renew=False)
        current = make_doc(keys=("esg-pack", "other-pack"), expires_in_days=5, auto_renew=True)
        assert _should_apply(narrower, current) is False

    def test_metadata_change_cannot_shorten_expiry(self):
        shorter = make_doc(expires_in_days=2, auto_renew=False)
        assert _should_apply(shorter, make_doc(expires_in_days=5, auto_renew=True)) is False

    def test_licensee_or_grace_change_applies_at_identical_coverage(self):
        assert (
            _should_apply(
                make_doc(expires_in_days=5, licensee="ACME GmbH"),
                make_doc(expires_in_days=5),
            )
            is True
        )
        assert (
            _should_apply(
                make_doc(expires_in_days=5, grace_days=45),
                make_doc(expires_in_days=5),
            )
            is True
        )
