"""Unit tests for the per-instance licensing identity (TEA-XXXX-XXXX-XXXX)."""

from __future__ import annotations

import pytest

from app.config import settings
from app.services.extensions.instance_id import (
    ensure_instance_id,
    generate_instance_id,
    get_instance_id,
    license_binding_problem,
    set_instance_id,
    validate_instance_id,
)


@pytest.fixture(autouse=True)
def _reset_cache():
    set_instance_id(None)
    yield
    set_instance_id(None)


class TestFormat:
    def test_generate_shape_and_checksum(self):
        for _ in range(50):
            iid = generate_instance_id()
            assert validate_instance_id(iid), iid
            parts = iid.split("-")
            assert parts[0] == "TEA" and len(parts) == 4
            assert all(len(p) == 4 for p in parts[1:])

    def test_ids_are_unique(self):
        ids = {generate_instance_id() for _ in range(200)}
        assert len(ids) == 200

    def test_single_char_error_is_caught(self):
        iid = generate_instance_id()
        body = iid.replace("TEA-", "").replace("-", "")
        alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
        # Flip the first data char to a different symbol — checksum must fail.
        wrong = alphabet[(alphabet.index(body[0]) + 1) % 32]
        tampered = f"TEA-{wrong}{body[1:4]}-{body[4:8]}-{body[8:12]}"
        assert not validate_instance_id(tampered)

    def test_adjacent_transposition_is_caught(self):
        # Find an ID whose first two data chars differ, then swap them.
        while True:
            iid = generate_instance_id()
            body = iid.replace("TEA-", "").replace("-", "")
            if body[0] != body[1]:
                break
        swapped = body[1] + body[0] + body[2:]
        tampered = f"TEA-{swapped[0:4]}-{swapped[4:8]}-{swapped[8:12]}"
        assert not validate_instance_id(tampered)

    @pytest.mark.parametrize(
        "bad",
        [
            None,
            "",
            "TEA-1234-5678",  # too short
            "TEB-1234-5678-9ABC",  # wrong prefix
            "TEA-1234-5678-9ABI",  # I not in alphabet
            "tea-1234-5678-9abc",  # lowercase
            123,
        ],
    )
    def test_validate_rejects_garbage(self, bad):
        assert not validate_instance_id(bad)


class TestBinding:
    def test_uninitialised_instance_skips_binding_in_dev(self):
        assert get_instance_id() is None
        assert license_binding_problem("TEA-0000-0000-0000") is None

    def test_uninitialised_instance_fails_closed_in_production(self, monkeypatch):
        set_instance_id(None)
        monkeypatch.setattr(settings, "ENVIRONMENT", "production")
        # A silent init failure must not fail open into accepting a foreign ID.
        assert license_binding_problem("TEA-0000-0000-0000") is not None

    def test_matching_id_is_fine(self):
        iid = generate_instance_id()
        set_instance_id(iid)
        assert license_binding_problem(iid) is None

    def test_mismatch_is_refused_and_names_both_ids(self):
        ours, theirs = generate_instance_id(), generate_instance_id()
        set_instance_id(ours)
        problem = license_binding_problem(theirs)
        assert problem is not None
        assert ours in problem and theirs in problem

    def test_unbound_license_allowed_in_development_only(self, monkeypatch):
        set_instance_id(generate_instance_id())
        monkeypatch.setattr(settings, "ENVIRONMENT", "development")
        assert license_binding_problem("") is None
        monkeypatch.setattr(settings, "ENVIRONMENT", "production")
        assert license_binding_problem("") is not None


class TestEnsure:
    async def test_mints_once_and_is_idempotent(self, db):
        first = await ensure_instance_id(db)
        assert validate_instance_id(first)
        assert get_instance_id() == first
        # Second call returns the stored value, never regenerates.
        set_instance_id(None)
        second = await ensure_instance_id(db)
        assert second == first

    async def test_invalid_stored_value_is_replaced(self, db):
        from sqlalchemy import select

        from app.models.app_settings import AppSettings

        first = await ensure_instance_id(db)
        row = (await db.execute(select(AppSettings))).scalars().first()
        general = dict(row.general_settings or {})
        general["instanceId"] = "corrupted"
        row.general_settings = general
        await db.commit()

        fresh = await ensure_instance_id(db)
        assert fresh != first and validate_instance_id(fresh)
