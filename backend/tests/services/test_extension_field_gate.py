"""The write gate on extension-contributed card fields (no database).

A field an extension contributed (stamped ``ext: <key>``) may only change
while that extension is installed, enabled and holds a usable entitlement
(active, grace or free). A failed or restart-pending load never locks it.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from app.services.extensions import field_gate
from app.services.extensions.license import Entitlement, LicenseDocument
from app.services.extensions.registry import ExtensionInfo, ExtensionRegistry

NOW = datetime(2026, 7, 8, tzinfo=timezone.utc)
KEY = "sample-ext"


def _license(*entitlements: Entitlement) -> LicenseDocument:
    return LicenseDocument(
        licensee="ACME Corp",
        customer_id="cus_1",
        issued_at=NOW - timedelta(days=1),
        grace_days=30,
        entitlements=list(entitlements),
    )


def _registry(
    *,
    expires_in_days: int | None = 90,
    licensed: bool = True,
    **info_overrides,
) -> ExtensionRegistry:
    info = dict(key=KEY, name="Sample", version="1.0.0", status="installed", enabled=True)
    info.update(info_overrides)
    reg = ExtensionRegistry()
    reg.load_installed([ExtensionInfo(**info)])
    if licensed:
        expires = None if expires_in_days is None else NOW + timedelta(days=expires_in_days)
        reg.set_license(_license(Entitlement(extension_key=KEY, expires_at=expires)))
    return reg


def _schema(*fields: dict, section: str = "Extra") -> list:
    return [{"section": section, "fields": list(fields)}]


STAMPED = {"key": "score", "label": "Score", "type": "number", "ext": KEY}
OWN = {"key": "note", "label": "Note", "type": "text"}


class TestWritablePredicate:
    @pytest.mark.parametrize(
        ("reg_kwargs", "writable"),
        [
            ({}, True),  # active
            ({"expires_in_days": -5}, True),  # grace
            ({"expires_in_days": None}, True),  # perpetual
            ({"licensed": False, "manifest": {"free": True}}, True),  # free
            ({"licensed": False}, False),  # unlicensed
            ({"expires_in_days": -40}, False),  # expired past grace
            ({"enabled": False}, False),
            ({"status": "disabled"}, False),
            ({"status": "removed"}, False),
            ({"status": "failed"}, True),  # a broken load never locks data
            ({"status": "needs_restart"}, True),
        ],
    )
    def test_truth_table(self, reg_kwargs, writable):
        reg = _registry(**reg_kwargs)
        assert field_gate.extension_fields_writable(KEY, reg, NOW) is writable

    def test_not_installed_is_not_writable(self):
        assert field_gate.extension_fields_writable(KEY, ExtensionRegistry(), NOW) is False


class TestLockedFields:
    def test_licensed_extension_locks_nothing(self):
        assert field_gate.locked_fields("App", _schema(STAMPED, OWN), _registry(), NOW) == {}

    def test_unlicensed_extension_locks_its_stamped_fields_only(self):
        locked = field_gate.locked_fields(
            "App", _schema(STAMPED, OWN), _registry(licensed=False), NOW
        )
        assert locked == {"score": "Score"}

    def test_an_orphaned_stamp_is_locked(self):
        assert field_gate.locked_fields("App", _schema(STAMPED), ExtensionRegistry(), NOW) == {
            "score": "Score"
        }

    def test_label_falls_back_to_the_key(self):
        field = {"key": "score", "type": "number", "ext": KEY}
        assert field_gate.locked_fields("App", _schema(field), ExtensionRegistry(), NOW) == {
            "score": "score"
        }

    def test_malformed_schema_entries_are_ignored(self):
        schema = ["junk", {"section": "S", "fields": ["x", {"key": ""}, {"label": "no key"}]}]
        assert field_gate.locked_fields("App", schema, ExtensionRegistry(), NOW) == {}
        assert field_gate.locked_fields("App", None, ExtensionRegistry(), NOW) == {}

    def test_disabled_extension_manifest_keys_are_locked(self):
        manifest = {
            "metamodel": {
                "field_sections": [
                    {
                        "card_type": "App",
                        "section": "Extra",
                        "fields": [
                            {"key": "score", "label": "Score"},
                            {"key": "rank"},
                        ],
                    },
                    {"card_type": "Other", "section": "X", "fields": [{"key": "elsewhere"}]},
                ]
            }
        }
        reg = _registry(enabled=False, manifest=manifest)
        # The disable stripped the fields from the schema; the values stay locked.
        assert field_gate.locked_fields("App", _schema(OWN), reg, NOW) == {
            "score": "Score",
            "rank": "rank",
        }

    def test_manifest_key_the_admin_owns_is_not_locked(self):
        manifest = {
            "metamodel": {
                "field_sections": [{"card_type": "App", "fields": [{"key": "note"}]}],
            }
        }
        reg = _registry(enabled=False, manifest=manifest)
        assert field_gate.locked_fields("App", _schema(OWN), reg, NOW) == {}

    def test_manifest_of_a_writable_or_removed_extension_locks_nothing(self):
        manifest = {
            "metamodel": {"field_sections": [{"card_type": "App", "fields": [{"key": "x"}]}]}
        }
        assert field_gate.locked_fields("App", [], _registry(manifest=manifest), NOW) == {}
        removed = _registry(status="removed", manifest=manifest)
        assert field_gate.locked_fields("App", [], removed, NOW) == {}

    def test_malformed_manifest_is_ignored(self):
        for manifest in (
            {},
            {"metamodel": "x"},
            {"metamodel": {"field_sections": "x"}},
            {"metamodel": {"field_sections": ["x", {"card_type": "App", "fields": ["y"]}]}},
        ):
            reg = _registry(enabled=False, manifest=manifest)
            assert field_gate.locked_fields("App", [], reg, NOW) == {}


LOCKED = {"score": "Score"}


class TestApplyFieldLock:
    def test_absent_locked_key_is_carried_over(self):
        attrs, refused = field_gate.apply_field_lock(
            {"score": 4, "note": "a"}, {"note": "b"}, LOCKED
        )
        assert attrs == {"score": 4, "note": "b"}
        assert refused == []

    def test_unchanged_value_passes(self):
        attrs, refused = field_gate.apply_field_lock({"score": 4}, {"score": 4, "x": 1}, LOCKED)
        assert attrs == {"score": 4, "x": 1}
        assert refused == []

    def test_changed_value_is_refused_and_kept_at_the_stored_value(self):
        attrs, refused = field_gate.apply_field_lock({"score": 4}, {"score": 5}, LOCKED)
        assert refused == ["score"]
        assert attrs == {"score": 4}

    def test_clearing_is_a_change(self):
        _, refused = field_gate.apply_field_lock({"score": 4}, {"score": None}, LOCKED)
        assert refused == ["score"]

    def test_empty_matches_absent(self):
        for empty in (None, "", []):
            attrs, refused = field_gate.apply_field_lock({}, {"score": empty}, LOCKED)
            assert refused == []
            assert attrs == {}

    def test_create_refuses_a_filled_locked_value(self):
        attrs, refused = field_gate.apply_field_lock(None, {"score": 1, "note": "n"}, LOCKED)
        assert refused == ["score"]
        assert attrs == {"note": "n"}

    def test_no_lock_returns_a_copy(self):
        incoming = {"score": 9}
        attrs, refused = field_gate.apply_field_lock({}, incoming, {})
        assert attrs == {"score": 9} and attrs is not incoming
        assert refused == []


class TestMaintainedKeys:
    def test_maintained_locked_key_is_kept_silently(self):
        attrs, refused = field_gate.apply_field_lock(
            {"score": 4, "calc": 1}, {"score": 4, "calc": 9}, {**LOCKED, "calc": "Calc"}, {"calc"}
        )
        assert refused == []
        assert attrs == {"score": 4, "calc": 1}

    def test_maintained_key_absent_from_stored_is_dropped(self):
        attrs, refused = field_gate.apply_field_lock({}, {"calc": 9}, {"calc": "Calc"}, {"calc"})
        assert refused == []
        assert attrs == {}

    def test_other_locked_keys_are_still_refused(self):
        _, refused = field_gate.apply_field_lock(
            {"score": 4, "calc": 1}, {"score": 5, "calc": 9}, {**LOCKED, "calc": "Calc"}, {"calc"}
        )
        assert refused == ["score"]

    def test_checked_attributes_passes_maintained_through(self):
        assert field_gate.checked_attributes({"calc": 1}, {"calc": 2}, {"calc": "C"}, {"calc"}) == {
            "calc": 1
        }

    def test_maintained_keys_are_locked_calculated_or_readonly(self):
        schema = _schema(
            {"key": "auto", "ext": "x", "readonly": True},
            {"key": "calc", "ext": "x"},
            {"key": "plain", "ext": "x"},
            {"key": "own_ro", "readonly": True},
        )
        locked = {"auto": "A", "calc": "C", "plain": "P"}
        assert field_gate.maintained_keys(schema, locked, {"calc", "own_ro", "other"}) == {
            "auto",
            "calc",
        }

    def test_maintained_keys_needs_a_lock(self):
        assert field_gate.maintained_keys(
            _schema({"key": "auto", "readonly": True}), {}, {"x"}
        ) == (set())


class TestApplySnapshotLock:
    def test_locked_key_absent_from_snapshot_is_kept_and_reported(self):
        attrs, differing = field_gate.apply_snapshot_lock(
            {"score": 4, "note": "b"}, {"note": "a"}, LOCKED
        )
        assert attrs == {"score": 4, "note": "a"}
        assert differing == ["score"]

    def test_changed_locked_key_is_kept_and_reported(self):
        attrs, differing = field_gate.apply_snapshot_lock({"score": 4}, {"score": 1}, LOCKED)
        assert attrs == {"score": 4}
        assert differing == ["score"]

    def test_locked_key_only_in_snapshot_stays_absent_and_is_reported(self):
        attrs, differing = field_gate.apply_snapshot_lock({"note": "b"}, {"score": 1}, LOCKED)
        assert attrs == {}
        assert differing == ["score"]

    def test_equal_or_both_empty_is_not_reported(self):
        for current, snapshot in (({"score": 4}, {"score": 4}), ({}, {}), ({"score": ""}, {})):
            attrs, differing = field_gate.apply_snapshot_lock(current, snapshot, LOCKED)
            assert differing == []
            assert attrs == dict(current)

    def test_none_current_and_unlocked_keys_restore(self):
        attrs, differing = field_gate.apply_snapshot_lock(None, {"note": "a"}, LOCKED)
        assert attrs == {"note": "a"}
        assert differing == []


class TestCheckedAttributes:
    def test_passes_carried_over_state(self):
        assert field_gate.checked_attributes({"score": 4}, None, LOCKED) == {"score": 4}

    def test_raises_the_structured_403(self):
        with pytest.raises(HTTPException) as exc:
            field_gate.checked_attributes({"score": 4}, {"score": 5}, LOCKED)
        assert exc.value.status_code == 403
        detail = exc.value.detail
        assert detail["error"] == "extension_fields_locked"
        assert detail["fields"] == ["score"]
        assert detail["message"] == (
            "These fields are read-only because the extension that provides them "
            "is not active or licensed: Score."
        )

    def test_error_names_unknown_keys_by_key(self):
        err = field_gate.locked_error(["a", "b"], {"a": "Alpha"})
        assert err.detail["message"].endswith(": Alpha, b.")
        assert err.detail["fields"] == ["a", "b"]
