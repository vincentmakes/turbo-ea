"""The maintained-lifecycle gate (SDK 1.22) — pure helpers, no database.

A licensed extension may claim chosen lifecycle phases of a card. The claim
only counts while the extension holds ``core.cards.maintain_lifecycle``
(enabled, loaded, usable entitlement); otherwise the marker is ignored.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from app.services.extensions import lifecycle_gate as lg
from app.services.extensions.license import Entitlement, LicenseDocument
from app.services.extensions.registry import ExtensionInfo, ExtensionRegistry

NOW = datetime(2026, 11, 1, tzinfo=timezone.utc)
KEY = "acme-sync"
GRANTS = ["core.cards.write", lg.MAINTAIN_GRANT]
MARKER = {"ext": KEY, "phases": ["endOfLife", "active"]}


def _registry(
    *,
    expires_in_days: int | None = 90,
    licensed: bool = True,
    grants: list[str] | None = None,
    **info_overrides,
) -> ExtensionRegistry:
    info = dict(
        key=KEY,
        name="Acme Sync",
        version="1.0.0",
        status="installed",
        enabled=True,
        manifest={"grants": GRANTS if grants is None else grants},
    )
    info.update(info_overrides)
    reg = ExtensionRegistry()
    reg.load_installed([ExtensionInfo(**info)])
    if licensed:
        expires = None if expires_in_days is None else NOW + timedelta(days=expires_in_days)
        reg.set_license(
            LicenseDocument(
                licensee="ACME Corp",
                customer_id="cus_1",
                issued_at=NOW - timedelta(days=1),
                grace_days=30,
                entitlements=[Entitlement(extension_key=KEY, expires_at=expires)],
            )
        )
    return reg


LOCK = lg.LifecycleLock(ext=KEY, name="Acme Sync", phases=("active", "endOfLife"))


class TestParseMarker:
    def test_orders_and_dedups_phases(self):
        assert lg.parse_marker({"ext": KEY, "phases": ["endOfLife", "active", "active"]}) == (
            KEY,
            ("active", "endOfLife"),
        )

    @pytest.mark.parametrize(
        "marker",
        [
            None,
            "x",
            [],
            {},
            {"ext": "", "phases": ["active"]},
            {"ext": 3, "phases": ["active"]},
            {"phases": ["active"]},
            {"ext": KEY},
            {"ext": KEY, "phases": []},
            {"ext": KEY, "phases": "active"},
            {"ext": KEY, "phases": ["active", "bogus"]},
            {"ext": KEY, "phases": [1]},
        ],
    )
    def test_malformed_is_none(self, marker):
        assert lg.parse_marker(marker) is None


class TestEffectiveLock:
    def test_effective_while_licensed_with_grant(self):
        lock = lg.effective_lock(MARKER, _registry(), NOW)
        assert lock == lg.LifecycleLock(ext=KEY, name="Acme Sync", phases=("active", "endOfLife"))

    @pytest.mark.parametrize(
        ("reg_kwargs", "effective"),
        [
            ({}, True),
            ({"expires_in_days": -5}, True),  # grace
            ({"expires_in_days": None}, True),  # perpetual
            ({"licensed": False, "manifest": {"free": True, "grants": GRANTS}}, True),
            ({"licensed": False}, False),
            ({"expires_in_days": -40}, False),  # past grace
            ({"enabled": False}, False),
            ({"status": "removed"}, False),
            ({"status": "failed"}, False),
            ({"status": "needs_restart"}, False),
            ({"grants": ["core.cards.write"]}, False),  # no maintain grant
        ],
    )
    def test_truth_table(self, reg_kwargs, effective):
        assert (lg.effective_lock(MARKER, _registry(**reg_kwargs), NOW) is not None) is effective

    def test_missing_extension_is_ineffective(self):
        assert lg.effective_lock(MARKER, ExtensionRegistry(), NOW) is None

    def test_other_extensions_grant_does_not_count(self):
        marker = {"ext": "other-ext", "phases": ["active"]}
        assert lg.effective_lock(marker, _registry(), NOW) is None

    def test_malformed_marker_is_ignored_even_when_licensed(self):
        assert lg.effective_lock({"ext": KEY, "phases": ["nope"]}, _registry(), NOW) is None
        assert lg.effective_lock(None, _registry(), NOW) is None

    def test_name_falls_back_to_key(self):
        lock = lg.effective_lock(MARKER, _registry(name=""), NOW)
        assert lock is not None and lock.name == KEY

    def test_cache_resolves_each_owner_once(self, monkeypatch):
        reg = _registry()
        calls: list[str] = []
        original = reg.grants_for

        def counting(key, now=None):
            calls.append(key)
            return original(key, now=now)

        monkeypatch.setattr(reg, "grants_for", counting)
        cache: dict = {}
        other = {"ext": "other-ext", "phases": ["active"]}
        for marker in (MARKER, MARKER, other, other, None):
            lg.lock_payload(marker, reg, cache=cache)
        assert calls == [KEY, "other-ext"]
        assert cache == {KEY: "Acme Sync", "other-ext": None}
        assert lg.lock_payload(MARKER, reg, cache=cache)["name"] == "Acme Sync"
        assert lg.lock_payload(other, reg, cache=cache) is None

    def test_lock_payload_shape(self):
        reg = _registry(expires_in_days=None)
        assert lg.lock_payload(MARKER, reg) == {
            "ext": KEY,
            "name": "Acme Sync",
            "phases": ["active", "endOfLife"],
        }
        assert lg.lock_payload(MARKER, ExtensionRegistry()) is None


class TestApplyLifecycleLock:
    STORED = {"plan": "2019-01-01", "active": "2020-01-01", "endOfLife": "2030-01-01"}

    def test_absent_locked_phase_is_carried_over(self):
        out, refused = lg.apply_lifecycle_lock(self.STORED, {"plan": "2018-01-01"}, LOCK.phases)
        assert out == {"plan": "2018-01-01", "active": "2020-01-01", "endOfLife": "2030-01-01"}
        assert refused == []

    def test_unchanged_locked_phase_passes(self):
        out, refused = lg.apply_lifecycle_lock(self.STORED, dict(self.STORED), LOCK.phases)
        assert out == self.STORED
        assert refused == []

    def test_changed_locked_phase_is_refused_and_kept(self):
        incoming = {"active": "2021-01-01", "endOfLife": "2031-01-01", "plan": "2019-01-01"}
        out, refused = lg.apply_lifecycle_lock(self.STORED, incoming, ("endOfLife", "active"))
        assert out == self.STORED
        assert refused == ["active", "endOfLife"]

    def test_clearing_a_locked_phase_is_refused(self):
        out, refused = lg.apply_lifecycle_lock(self.STORED, {"active": None}, ("active",))
        assert out["active"] == "2020-01-01"
        assert refused == ["active"]

    def test_empty_equals_absent(self):
        stored = {"plan": "2019-01-01"}
        out, refused = lg.apply_lifecycle_lock(
            stored, {"active": "", "plan": "2019-01-01"}, ("active",)
        )
        assert out == {"plan": "2019-01-01"}
        assert refused == []
        # A whole-dict write: leaving ``plan`` out drops it (it is not locked).
        out, refused = lg.apply_lifecycle_lock(stored, {"active": None}, ("active",))
        assert out == {}
        assert refused == []

    def test_setting_an_absent_locked_phase_is_refused(self):
        out, refused = lg.apply_lifecycle_lock({}, {"active": "2020-01-01"}, ("active",))
        assert out == {}
        assert refused == ["active"]

    def test_none_inputs(self):
        assert lg.apply_lifecycle_lock(None, None, ("active",)) == ({}, [])

    def test_unlocked_phases_pass_through(self):
        out, refused = lg.apply_lifecycle_lock({}, {"plan": "2019-01-01"}, ())
        assert out == {"plan": "2019-01-01"}
        assert refused == []

    def test_does_not_mutate_inputs(self):
        stored = dict(self.STORED)
        incoming = {"active": "2021-01-01"}
        lg.apply_lifecycle_lock(stored, incoming, ("active",))
        assert stored == self.STORED and incoming == {"active": "2021-01-01"}


class TestChangedPhases:
    STORED = {"plan": "2019-01-01", "active": "2020-01-01", "endOfLife": "2030-01-01"}

    def test_a_moved_or_cleared_locked_answer_is_named_in_order(self):
        answers = {"endOfLife": "", "active": "2021-01-01", "plan": "2018-01-01"}
        assert lg.changed_phases(self.STORED, answers, ("endOfLife", "active")) == [
            "active",
            "endOfLife",
        ]

    def test_unchanged_unanswered_and_unlocked_phases_are_not_named(self):
        answers = {"active": "2020-01-01", "plan": "2018-01-01"}
        assert lg.changed_phases(self.STORED, answers, ("active", "endOfLife")) == []
        # Clearing a phase that holds no date changes nothing.
        assert lg.changed_phases({}, {"active": ""}, ("active",)) == []
        assert lg.changed_phases({}, {"active": None}, ("active",)) == []
        assert lg.changed_phases(None, {"active": "2020-01-01"}, ("active",)) == ["active"]


class TestSnapshotLock:
    def test_restores_unlocked_keeps_locked_and_reports(self):
        current = {"plan": "2019-06-01", "active": "2021-01-01"}
        snapshot = {"plan": "2019-01-01", "active": "2020-01-01"}
        out, differing = lg.apply_lifecycle_snapshot_lock(current, snapshot, ("active",))
        assert out == {"plan": "2019-01-01", "active": "2021-01-01"}
        assert differing == ["active"]

    def test_locked_phase_absent_from_snapshot_stays_and_is_reported(self):
        current = {"active": "2021-01-01"}
        out, differing = lg.apply_lifecycle_snapshot_lock(current, {}, ("active",))
        assert out == {"active": "2021-01-01"}
        assert differing == ["active"]

    def test_locked_phase_added_by_snapshot_is_not_restored(self):
        out, differing = lg.apply_lifecycle_snapshot_lock({}, {"active": "2020-01-01"}, ("active",))
        assert out == {}
        assert differing == ["active"]

    def test_equal_locked_phase_is_not_reported(self):
        out, differing = lg.apply_lifecycle_snapshot_lock(
            {"active": "2020-01-01"}, {"active": "2020-01-01", "plan": ""}, ("active",)
        )
        assert out == {"active": "2020-01-01", "plan": ""}
        assert differing == []

    def test_none_inputs(self):
        assert lg.apply_lifecycle_snapshot_lock(None, None, ("active",)) == ({}, [])


class TestClamp:
    @pytest.mark.parametrize(
        ("lifecycle", "phases", "expected"),
        [
            # Manual phaseIn after the maintained active → clamped down to it.
            (
                {"phaseIn": "2021-06-01", "active": "2021-01-01"},
                ("active",),
                {"phaseIn": "2021-01-01", "active": "2021-01-01"},
            ),
            # Manual phaseOut before the maintained active → clamped up to it.
            (
                {"active": "2021-01-01", "phaseOut": "2020-01-01"},
                ("active",),
                {"active": "2021-01-01", "phaseOut": "2021-01-01"},
            ),
            # Manual phaseOut after the maintained endOfLife → clamped down.
            (
                {"phaseOut": "2032-01-01", "endOfLife": "2030-01-01"},
                ("endOfLife",),
                {"phaseOut": "2030-01-01", "endOfLife": "2030-01-01"},
            ),
            # In order → untouched (equal dates are in order).
            (
                {"plan": "2019-01-01", "phaseIn": "2020-01-01", "active": "2020-01-01"},
                ("active",),
                {"plan": "2019-01-01", "phaseIn": "2020-01-01", "active": "2020-01-01"},
            ),
            # Several manual phases at once, both sides of two maintained ones.
            (
                {
                    "plan": "2025-01-01",
                    "phaseIn": "2024-01-01",
                    "active": "2022-01-01",
                    "phaseOut": "2035-01-01",
                    "endOfLife": "2030-01-01",
                },
                ("active", "endOfLife"),
                {
                    "plan": "2022-01-01",
                    "phaseIn": "2022-01-01",
                    "active": "2022-01-01",
                    "phaseOut": "2030-01-01",
                    "endOfLife": "2030-01-01",
                },
            ),
            # The NEAREST bound wins: plan bounded by phaseIn, not only active.
            (
                {"plan": "2021-01-01", "phaseIn": "2020-01-01", "active": "2022-01-01"},
                ("phaseIn", "active"),
                {"plan": "2020-01-01", "phaseIn": "2020-01-01", "active": "2022-01-01"},
            ),
            # Lower bound is the LATEST earlier maintained date.
            (
                {"plan": "2018-01-01", "phaseIn": "2019-01-01", "phaseOut": "2018-06-01"},
                ("plan", "phaseIn"),
                {"plan": "2018-01-01", "phaseIn": "2019-01-01", "phaseOut": "2019-01-01"},
            ),
            # Upper bound is the EARLIEST later maintained date.
            (
                {"plan": "2031-01-01", "phaseOut": "2029-01-01", "endOfLife": "2030-01-01"},
                ("phaseOut", "endOfLife"),
                {"plan": "2029-01-01", "phaseOut": "2029-01-01", "endOfLife": "2030-01-01"},
            ),
            # Contradicting maintained dates: lower applied, then upper wins.
            (
                {"active": "2030-01-01", "phaseOut": "2010-01-01", "endOfLife": "2020-01-01"},
                ("active", "endOfLife"),
                {"active": "2030-01-01", "phaseOut": "2020-01-01", "endOfLife": "2020-01-01"},
            ),
            # Unparseable manual value → left alone.
            (
                {"phaseIn": "soon", "active": "2021-01-01"},
                ("active",),
                {"phaseIn": "soon", "active": "2021-01-01"},
            ),
            # Unparseable maintained value → sets no bound.
            (
                {"phaseIn": "2025-01-01", "active": "garbage"},
                ("active",),
                {"phaseIn": "2025-01-01", "active": "garbage"},
            ),
            # Absent maintained phase → no bound.
            (
                {"phaseIn": "2025-01-01"},
                ("active",),
                {"phaseIn": "2025-01-01"},
            ),
            # No maintained phases → untouched.
            (
                {"phaseIn": "2025-01-01", "active": "2020-01-01"},
                (),
                {"phaseIn": "2025-01-01", "active": "2020-01-01"},
            ),
            # The clamped value is the neighbour's stored string verbatim.
            (
                {"phaseIn": "2021-06-01", "active": "2021-01-01T00:00:00"},
                ("active",),
                {"phaseIn": "2021-01-01T00:00:00", "active": "2021-01-01T00:00:00"},
            ),
        ],
    )
    def test_matrix(self, lifecycle, phases, expected):
        assert lg.clamp_to_maintained(lifecycle, phases) == expected

    def test_does_not_mutate_input(self):
        lifecycle = {"phaseIn": "2021-06-01", "active": "2021-01-01"}
        lg.clamp_to_maintained(lifecycle, ("active",))
        assert lifecycle == {"phaseIn": "2021-06-01", "active": "2021-01-01"}


class TestMergeMaintained:
    def test_sets_and_removes_maintained_keeps_manual(self):
        stored = {"plan": "2019-01-01", "active": "2020-01-01", "endOfLife": "2030-01-01"}
        out = lg.merge_maintained(
            stored, {"active": "2021-01-01", "endOfLife": None}, ("active", "endOfLife")
        )
        assert out == {"plan": "2019-01-01", "active": "2021-01-01"}

    def test_missing_or_empty_value_removes_phase(self):
        stored = {"active": "2020-01-01", "endOfLife": "2030-01-01"}
        assert lg.merge_maintained(stored, {"endOfLife": ""}, ("active", "endOfLife")) == {}

    def test_clamps_manual_against_new_values(self):
        stored = {"phaseOut": "2031-01-01"}
        out = lg.merge_maintained(stored, {"endOfLife": "2030-01-01"}, ("endOfLife",))
        assert out == {"phaseOut": "2030-01-01", "endOfLife": "2030-01-01"}

    def test_values_outside_phases_are_ignored(self):
        out = lg.merge_maintained({}, {"active": "2020-01-01", "plan": "2019-01-01"}, ("active",))
        assert out == {"active": "2020-01-01"}

    def test_none_stored(self):
        assert lg.merge_maintained(None, {"active": "2020-01-01"}, ("active",)) == {
            "active": "2020-01-01"
        }


class TestErrors:
    def test_maintained_error_shape(self):
        err = lg.maintained_error(["active", "endOfLife"], LOCK)
        assert err.status_code == 403
        assert err.detail == {
            "error": "lifecycle_maintained",
            "message": (
                "These lifecycle dates are set automatically by the installed extension "
                "Acme Sync and cannot be edited by hand: Active, End of Life."
            ),
            "phases": ["active", "endOfLife"],
            "extension": "Acme Sync",
        }

    def test_checked_lifecycle_without_lock_is_passthrough(self):
        incoming = {"active": "2099-01-01"}
        out = lg.checked_lifecycle({"active": "2020-01-01"}, incoming, None)
        assert out == incoming and out is not incoming
        assert lg.checked_lifecycle({}, None, None) == {}

    def test_checked_lifecycle_raises_on_change(self):
        with pytest.raises(HTTPException) as exc:
            lg.checked_lifecycle({"active": "2020-01-01"}, {"active": "2021-01-01"}, LOCK)
        assert exc.value.detail["phases"] == ["active"]

    def test_checked_lifecycle_carries_and_clamps(self):
        stored = {"active": "2020-01-01", "endOfLife": "2030-01-01"}
        out = lg.checked_lifecycle(stored, {"phaseOut": "2035-01-01"}, LOCK)
        assert out == {"active": "2020-01-01", "phaseOut": "2030-01-01", "endOfLife": "2030-01-01"}

    def test_checked_lifecycle_does_not_clamp_an_untouched_lifecycle(self):
        # An unchanged (stale, out-of-order) lifecycle is returned as stored.
        stored = {"phaseIn": "2025-01-01", "active": "2020-01-01"}
        assert lg.checked_lifecycle(stored, dict(stored), LOCK) == stored


class TestBulk:
    def test_returns_values_only_for_locked_cards(self):
        reg = _registry()
        rows = [
            ("a", {"active": "2020-01-01"}, MARKER),
            ("b", {"active": "2019-01-01"}, None),
        ]
        out = lg.checked_bulk_lifecycle(rows, {"plan": "2018-01-01"}, reg)
        assert out == {"a": {"plan": "2018-01-01", "active": "2020-01-01"}}

    def test_refuses_whole_call_naming_cards(self):
        reg = _registry()
        rows = [
            ("a", {"active": "2020-01-01", "endOfLife": "2030-01-01"}, MARKER),
            ("b", {"active": "2019-01-01"}, None),
            ("c", {"active": "2021-01-01", "endOfLife": "2031-01-01"}, MARKER),
            ("d", {"active": "2021-01-01", "endOfLife": "2030-01-01"}, MARKER),
        ]
        incoming = {"active": "2021-01-01", "endOfLife": "2030-01-01"}
        with pytest.raises(HTTPException) as exc:
            lg.checked_bulk_lifecycle(rows, incoming, reg)
        assert exc.value.status_code == 403
        assert exc.value.detail["error"] == "lifecycle_maintained"
        assert exc.value.detail["cards"] == ["a", "c"]
        assert exc.value.detail["phases"] == ["active", "endOfLife"]
        assert exc.value.detail["extension"] == "Acme Sync"

    def test_ineffective_markers_are_ignored(self):
        rows = [("a", {"active": "2020-01-01"}, MARKER)]
        assert lg.checked_bulk_lifecycle(rows, {"active": "2021-01-01"}, ExtensionRegistry()) == {}
