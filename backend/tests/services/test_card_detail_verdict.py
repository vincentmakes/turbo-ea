"""The card-detail read rule, asked directly: ``card_detail_verdict``,
``card_detail_readable_ids`` and the per-type core they share.

``GET /cards/{id}`` and the live-update watch gate both answer through these,
so every branch is pinned here on its own value — readable through a
stakeholder role, readable through ``ppm.view`` on an Initiative, hidden by a
View deny (``"missing"``), refused (``"forbidden"``) — and once more with the
permission caches switched off, so the answer is proved to come from the
database the caller handed in, not from what an earlier check left cached.
"""

from __future__ import annotations

import uuid

import pytest

from app.models.stakeholder import Stakeholder
from app.services.card_read_scope import (
    _card_detail_verdict_for_type,
    card_detail_readable_ids,
    card_detail_verdict,
)
from app.services.permission_service import PermissionService
from tests.conftest import (
    create_card,
    create_card_type,
    create_role,
    create_stakeholder_role_def,
    create_user,
)


@pytest.fixture
async def env(db):
    # "outsider" holds nothing on the landscape: whatever it reads, it reads
    # as a stakeholder of that one card.
    await create_role(db, key="outsider", label="Outsider", permissions={"inventory.view": False})
    await create_role(db, key="viewer", label="Viewer", permissions={"inventory.view": True})
    await create_role(
        db,
        key="ppm_only",
        label="PPM only",
        permissions={"ppm.view": True, "inventory.view": False},
    )
    await create_card_type(db, key="Application", label="Application")
    await create_card_type(db, key="Initiative", label="Initiative")
    await create_card_type(
        db,
        key="Vault",
        label="Vault",
        role_permissions={"viewer": {"inventory.view": False}},
    )
    await create_card_type(
        db,
        key="Program",
        label="Program",
        role_permissions={"ppm_only": {"inventory.view": False}},
    )
    await create_stakeholder_role_def(
        db, card_type_key="Application", key="reader", permissions={"card.view": True}
    )
    PermissionService.invalidate_type_permission_cache()
    outsider = await create_user(db, email="outsider@verdict.test", role="outsider")
    viewer = await create_user(db, email="viewer@verdict.test", role="viewer")
    ppm_user = await create_user(db, email="ppm@verdict.test", role="ppm_only")
    shared = await create_card(db, card_type="Application", name="Shared App")
    other = await create_card(db, card_type="Application", name="Other App")
    initiative = await create_card(db, card_type="Initiative", name="An Initiative")
    vault = await create_card(db, card_type="Vault", name="A Vault")
    db.add(Stakeholder(card_id=shared.id, user_id=outsider.id, role="reader"))
    await db.flush()
    return {
        "outsider": outsider,
        "viewer": viewer,
        "ppm_user": ppm_user,
        "shared": shared,
        "other": other,
        "initiative": initiative,
        "vault": vault,
    }


@pytest.fixture
def no_permission_cache(monkeypatch):
    """Every permission lookup goes to the database it is handed."""
    monkeypatch.setattr(PermissionService, "CACHE_TTL", -1)


class TestCardDetailVerdict:
    async def test_a_stakeholder_with_card_view_reads_that_card(self, db, env):
        assert await card_detail_verdict(db, env["outsider"], env["shared"].id) == (
            "Application",
            "readable",
        )

    async def test_the_stakeholder_role_reads_only_its_own_card(self, db, env):
        assert await card_detail_verdict(db, env["outsider"], env["other"].id) == (
            "Application",
            "forbidden",
        )

    async def test_an_unknown_card_is_missing(self, db, env):
        assert await card_detail_verdict(db, env["viewer"], uuid.uuid4()) == (None, "missing")

    async def test_a_view_denied_type_is_missing_not_forbidden(self, db, env):
        assert await card_detail_verdict(db, env["viewer"], env["vault"].id) == (
            "Vault",
            "missing",
        )

    async def test_ppm_view_reads_an_initiative(self, db, env):
        assert await card_detail_verdict(db, env["ppm_user"], env["initiative"].id) == (
            "Initiative",
            "readable",
        )

    async def test_ppm_view_reads_no_other_type(self, db, env):
        assert await card_detail_verdict(db, env["ppm_user"], env["shared"].id) == (
            "Application",
            "forbidden",
        )


class TestVerdictForType:
    async def test_no_type_is_missing(self, db, env):
        assert await _card_detail_verdict_for_type(db, env["viewer"], env["shared"].id, None) == (
            "missing"
        )

    async def test_the_type_given_decides_not_the_stored_one(self, db, env):
        """The caller has resolved the type already; a View deny on *that*
        type hides the card even though the row says Application."""
        assert (
            await _card_detail_verdict_for_type(db, env["viewer"], env["shared"].id, "Vault")
            == "missing"
        )
        assert (
            await _card_detail_verdict_for_type(db, env["viewer"], env["shared"].id, "Application")
            == "readable"
        )

    async def test_a_view_deny_beats_ppm_view_on_an_initiative_type(self, db, env):
        """``ppm.view`` reads an Initiative only where the type does not deny
        the role View: the PPM fallback is asked per type."""
        verdict = await _card_detail_verdict_for_type(
            db, env["ppm_user"], env["initiative"].id, "Initiative"
        )
        assert verdict == "readable"
        await _deny_view(db, "Initiative", "ppm_only")
        verdict = await _card_detail_verdict_for_type(
            db, env["ppm_user"], env["initiative"].id, "Initiative"
        )
        assert verdict == "missing"

    async def test_a_deny_on_the_given_type_is_missing(self, db, env):
        assert (
            await _card_detail_verdict_for_type(
                db, env["ppm_user"], env["initiative"].id, "Program"
            )
            == "missing"
        )


class TestWithoutTheCache:
    async def test_ppm_fallback_reads_from_the_session(self, db, env, no_permission_cache):
        assert await card_detail_verdict(db, env["ppm_user"], env["initiative"].id) == (
            "Initiative",
            "readable",
        )

    async def test_type_deny_reads_from_the_session(self, db, env, no_permission_cache):
        assert await card_detail_verdict(db, env["viewer"], env["vault"].id) == (
            "Vault",
            "missing",
        )

    async def test_forbidden_reads_from_the_session(self, db, env, no_permission_cache):
        assert await card_detail_verdict(db, env["outsider"], env["other"].id) == (
            "Application",
            "forbidden",
        )


class TestReadableIds:
    async def test_keeps_the_stakeholder_card_and_drops_the_rest(self, db, env):
        ids = [env["other"].id, env["shared"].id, uuid.uuid4(), env["shared"].id]
        assert await card_detail_readable_ids(db, env["outsider"], ids) == [env["shared"].id]

    async def test_order_given_and_no_duplicates(self, db, env):
        ids = [env["other"].id, env["shared"].id, env["other"].id, env["vault"].id]
        assert await card_detail_readable_ids(db, env["viewer"], ids) == [
            env["other"].id,
            env["shared"].id,
        ]

    async def test_nothing_asked_is_nothing_readable(self, db, env):
        assert await card_detail_readable_ids(db, env["viewer"], []) == []


async def _deny_view(db, type_key: str, role_key: str) -> None:
    from sqlalchemy import select

    from app.models.card_type import CardType

    ct = (await db.execute(select(CardType).where(CardType.key == type_key))).scalar_one()
    ct.role_permissions = {role_key: {"inventory.view": False}}
    await db.flush()
    PermissionService.invalidate_type_permission_cache()
