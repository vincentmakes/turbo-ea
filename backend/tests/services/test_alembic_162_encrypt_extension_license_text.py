"""Unit tests for migration 162 (encrypt ``extension_licenses.raw_text`` at rest).

These exercise the pure ``plan_rows`` helper — no DB.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

from app.config import settings
from app.core.encryption import decrypt_value, encrypt_value, is_encrypted

_MIG_PATH = (
    Path(__file__).resolve().parents[2]
    / "alembic"
    / "versions"
    / "162_encrypt_extension_license_text.py"
)
_spec = importlib.util.spec_from_file_location("mig162", _MIG_PATH)
mig = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
_spec.loader.exec_module(mig)

ENVELOPE = '{"schema": "turboea-license/1", "payload": "eyJ9", "signature": "c2ln"}'
OTHER = '{"schema": "turboea-license/1", "payload": "e30=", "signature": "b3Ro"}'


def test_revision_chain():
    assert mig.revision == "162"
    assert mig.down_revision == "161"


def test_upgrade_encrypts_every_plaintext_row_active_or_superseded():
    planned = mig.plan_rows([(1, ENVELOPE), (2, OTHER)])
    assert [row_id for row_id, _ in planned] == [1, 2]
    for (_, new_text), original in zip(planned, [ENVELOPE, OTHER], strict=True):
        assert is_encrypted(new_text)
        assert original not in new_text
        assert decrypt_value(new_text) == original  # byte-exact round trip


def test_upgrade_is_idempotent():
    already = encrypt_value(ENVELOPE)
    assert mig.plan_rows([(1, already)]) == []
    first = mig.plan_rows([(1, ENVELOPE), (2, already)])
    assert [row_id for row_id, _ in first] == [1]
    assert mig.plan_rows([(1, first[0][1]), (2, already)]) == []


def test_upgrade_skips_empty_values():
    assert mig.plan_rows([(1, ""), (2, None)]) == []


def test_default_direction_is_upgrade():
    assert [i for i, _ in mig.plan_rows([(1, ENVELOPE)])] == [
        i for i, _ in mig.plan_rows([(1, ENVELOPE)], "upgrade")
    ]


def test_downgrade_restores_plaintext():
    stored = encrypt_value(ENVELOPE)
    assert mig.plan_rows([(7, stored)], "downgrade") == [(7, ENVELOPE)]


def test_downgrade_leaves_plaintext_rows_alone():
    assert mig.plan_rows([(7, ENVELOPE), (8, ""), (9, None)], "downgrade") == []


def test_downgrade_never_writes_an_empty_value(monkeypatch):
    """A row encrypted under a rotated key stays encrypted instead of becoming ''."""
    stored = encrypt_value(ENVELOPE)
    monkeypatch.setattr(settings, "SECRET_KEY", settings.SECRET_KEY + "-rotated")
    readable = encrypt_value(OTHER)
    assert mig.plan_rows([(1, stored), (2, readable)], "downgrade") == [(2, OTHER)]


def test_upgrade_then_downgrade_round_trips():
    rows = [(1, ENVELOPE), (2, OTHER)]
    up = dict(mig.plan_rows(rows))
    down = mig.plan_rows(list(up.items()), "downgrade")
    assert down == rows
