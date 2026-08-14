"""The stored ``data_quality`` score must follow the card-context mutations
that feed it — stakeholders, relations and tags.

All three shape a built-in scoring bucket, but none of them goes through
``PATCH /cards``. Before #944 only saving the card itself recalculated the
score, so assigning an owner or drawing a mandatory relation left the number
frozen at whatever it was on the card's last edit.
"""

from __future__ import annotations

import pytest

from app.core.permissions import MEMBER_PERMISSIONS
from app.models.card import Card
from app.services.data_quality import calc_data_quality
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_relation_type,
    create_role,
    create_stakeholder_role_def,
    create_user,
)


async def _score(db, card_id) -> float:
    """Read the *stored* score straight from the row, bypassing the scorer.

    A column select on purpose: going through ``db.get`` would hand back the
    identity-mapped instance the fixture already holds, which may carry a
    stale in-memory value.
    """
    from sqlalchemy import select

    return (await db.execute(select(Card.data_quality).where(Card.id == card_id))).scalar_one()


async def _set_dq(db, type_key, **buckets):
    """Pin the card type's built-in bucket weights so a test can isolate one."""
    from sqlalchemy import select

    from app.models.card_type import CardType

    ct = (await db.execute(select(CardType).where(CardType.key == type_key))).scalar_one()
    cfg = dict(ct.section_config or {})
    cfg["__dataQuality"] = buckets
    ct.section_config = cfg
    await db.flush()


# ---------------------------------------------------------------------------
# Stakeholders
# ---------------------------------------------------------------------------


@pytest.fixture
async def stake_env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="member", label="Member", permissions=MEMBER_PERMISSIONS)
    await create_card_type(db, key="Application", label="Application", fields_schema=[])
    await create_stakeholder_role_def(
        db, card_type_key="Application", key="responsible", label="Responsible"
    )
    await create_stakeholder_role_def(
        db,
        card_type_key="Application",
        key="observer",
        label="Observer",
        counts_for_quality=False,
    )
    await _set_dq(
        db, "Application", description=0, lifecycle=0, relations=0, tags=0, stakeholders=1
    )
    admin = await create_user(db, email="admin@test.com", role="admin")
    member = await create_user(db, email="member@test.com", role="member")
    card = await create_card(db, card_type="Application", name="Scored App", user_id=admin.id)
    return {"admin": admin, "member": member, "card": card}


class TestStakeholderRescore:
    async def test_assigning_a_stakeholder_raises_the_score(self, client, db, stake_env):
        admin, member, card = stake_env["admin"], stake_env["member"], stake_env["card"]
        assert await _score(db, card.id) == 0.0

        resp = await client.post(
            f"/api/v1/cards/{card.id}/stakeholders",
            json={"user_id": str(member.id), "role": "responsible"},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        assert await _score(db, card.id) == 100.0

    async def test_deleting_a_stakeholder_lowers_the_score(self, client, db, stake_env):
        admin, member, card = stake_env["admin"], stake_env["member"], stake_env["card"]
        created = await client.post(
            f"/api/v1/cards/{card.id}/stakeholders",
            json={"user_id": str(member.id), "role": "responsible"},
            headers=auth_headers(admin),
        )
        assert await _score(db, card.id) == 100.0

        resp = await client.delete(
            f"/api/v1/stakeholders/{created.json()['id']}", headers=auth_headers(admin)
        )
        assert resp.status_code == 204
        assert await _score(db, card.id) == 0.0

    async def test_observing_a_card_does_not_raise_the_score(self, client, db, stake_env):
        """`observer` ships with counts_for_quality off — watching a card must
        never stand in for owning it."""
        admin, card = stake_env["admin"], stake_env["card"]
        resp = await client.post(f"/api/v1/cards/{card.id}/me/observe", headers=auth_headers(admin))
        assert resp.status_code == 201
        assert await _score(db, card.id) == 0.0

    async def test_bulk_rescores_every_touched_card(self, client, db, stake_env):
        admin, member = stake_env["admin"], stake_env["member"]
        card_a = stake_env["card"]
        card_b = await create_card(db, card_type="Application", name="Second App", user_id=admin.id)

        resp = await client.post(
            "/api/v1/stakeholders/bulk",
            json={
                "operations": [
                    {"card_id": str(card_a.id), "user_id": str(member.id), "role": "responsible"},
                    {"card_id": str(card_b.id), "user_id": str(member.id), "role": "responsible"},
                ]
            },
            headers=auth_headers(admin),
        )
        assert resp.json()["added"] == 2
        assert await _score(db, card_a.id) == 100.0
        assert await _score(db, card_b.id) == 100.0

    async def test_bulk_dry_run_leaves_the_score_untouched(self, client, db, stake_env):
        admin, member, card = stake_env["admin"], stake_env["member"], stake_env["card"]
        resp = await client.post(
            "/api/v1/stakeholders/bulk",
            json={
                "operations": [
                    {"card_id": str(card.id), "user_id": str(member.id), "role": "responsible"}
                ],
                "dry_run": True,
            },
            headers=auth_headers(admin),
        )
        assert resp.json()["added"] == 1
        assert await _score(db, card.id) == 0.0


# ---------------------------------------------------------------------------
# Relations
# ---------------------------------------------------------------------------


@pytest.fixture
async def rel_env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_card_type(db, key="Application", label="Application", fields_schema=[])
    await create_card_type(db, key="ITComponent", label="IT Component", fields_schema=[])
    rt = await create_relation_type(
        db,
        key="app_to_itc",
        source_type_key="Application",
        target_type_key="ITComponent",
    )
    # Both sides mandatory, so the relations bucket is non-empty for either card.
    rt.source_mandatory = True
    rt.target_mandatory = True
    await db.flush()
    for type_key in ("Application", "ITComponent"):
        await _set_dq(db, type_key, description=0, lifecycle=0, relations=1, tags=0, stakeholders=0)
    admin = await create_user(db, email="admin@test.com", role="admin")
    app = await create_card(db, card_type="Application", name="App", user_id=admin.id)
    itc = await create_card(db, card_type="ITComponent", name="ITC", user_id=admin.id)
    return {"admin": admin, "app": app, "itc": itc}


class TestRelationRescore:
    async def test_create_and_delete_rescore_both_endpoints(self, client, db, rel_env):
        admin, app, itc = rel_env["admin"], rel_env["app"], rel_env["itc"]
        assert await _score(db, app.id) == 0.0
        assert await _score(db, itc.id) == 0.0

        resp = await client.post(
            "/api/v1/relations",
            json={"type": "app_to_itc", "source_id": str(app.id), "target_id": str(itc.id)},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        assert await _score(db, app.id) == 100.0
        assert await _score(db, itc.id) == 100.0

        deleted = await client.delete(
            f"/api/v1/relations/{resp.json()['id']}", headers=auth_headers(admin)
        )
        assert deleted.status_code == 204
        assert await _score(db, app.id) == 0.0
        assert await _score(db, itc.id) == 0.0

    async def test_bulk_rescores_impacted_cards(self, client, db, rel_env):
        admin, app, itc = rel_env["admin"], rel_env["app"], rel_env["itc"]
        resp = await client.post(
            "/api/v1/relations/bulk",
            json={
                "operations": [
                    {
                        "row_index": 0,
                        "type": "app_to_itc",
                        "source": {"id": str(app.id)},
                        "target": {"id": str(itc.id)},
                    }
                ]
            },
            headers=auth_headers(admin),
        )
        assert resp.json()["upserted"] == 1
        assert await _score(db, app.id) == 100.0
        assert await _score(db, itc.id) == 100.0

    async def test_bulk_dry_run_leaves_scores_untouched(self, client, db, rel_env):
        admin, app, itc = rel_env["admin"], rel_env["app"], rel_env["itc"]
        resp = await client.post(
            "/api/v1/relations/bulk",
            json={
                "operations": [
                    {
                        "row_index": 0,
                        "type": "app_to_itc",
                        "source": {"id": str(app.id)},
                        "target": {"id": str(itc.id)},
                    }
                ],
                "dry_run": True,
            },
            headers=auth_headers(admin),
        )
        assert resp.json()["upserted"] == 1
        assert await _score(db, app.id) == 0.0
        assert await _score(db, itc.id) == 0.0


# ---------------------------------------------------------------------------
# Tags
# ---------------------------------------------------------------------------


@pytest.fixture
async def tag_env(db):
    from app.models.tag import Tag, TagGroup

    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_card_type(db, key="Application", label="Application", fields_schema=[])
    await _set_dq(
        db, "Application", description=0, lifecycle=0, relations=0, tags=1, stakeholders=0
    )
    group = TagGroup(name="Criticality", mode="single", mandatory=True)
    db.add(group)
    await db.flush()
    tag = Tag(tag_group_id=group.id, name="High")
    db.add(tag)
    await db.flush()
    admin = await create_user(db, email="admin@test.com", role="admin")
    card = await create_card(db, card_type="Application", name="Tagged App", user_id=admin.id)
    return {"admin": admin, "card": card, "tag": tag}


class TestTagRescore:
    async def test_assigning_a_mandatory_tag_raises_the_score(self, client, db, tag_env):
        admin, card, tag = tag_env["admin"], tag_env["card"], tag_env["tag"]
        assert await _score(db, card.id) == 0.0

        resp = await client.post(
            f"/api/v1/cards/{card.id}/tags",
            json=[str(tag.id)],
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        assert await _score(db, card.id) == 100.0

    async def test_removing_the_tag_lowers_the_score(self, client, db, tag_env):
        admin, card, tag = tag_env["admin"], tag_env["card"], tag_env["tag"]
        await client.post(
            f"/api/v1/cards/{card.id}/tags", json=[str(tag.id)], headers=auth_headers(admin)
        )
        assert await _score(db, card.id) == 100.0

        resp = await client.delete(
            f"/api/v1/cards/{card.id}/tags/{tag.id}", headers=auth_headers(admin)
        )
        assert resp.status_code == 204
        assert await _score(db, card.id) == 0.0


# ---------------------------------------------------------------------------
# Metamodel: toggling which roles count
# ---------------------------------------------------------------------------


class TestCountsForQualityToggle:
    async def test_turning_a_role_on_rescores_the_type(self, client, db, stake_env):
        """An admin who decides observers *do* count should see every card of
        the type re-score immediately, not on each card's next edit."""
        admin, member, card = stake_env["admin"], stake_env["member"], stake_env["card"]
        await client.post(
            f"/api/v1/cards/{card.id}/stakeholders",
            json={"user_id": str(member.id), "role": "observer"},
            headers=auth_headers(admin),
        )
        assert await _score(db, card.id) == 0.0

        resp = await client.patch(
            "/api/v1/metamodel/types/Application/stakeholder-roles/observer",
            json={"counts_for_quality": True},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 200
        assert resp.json()["counts_for_quality"] is True
        assert await _score(db, card.id) == 100.0

    async def test_calculated_field_is_scored_on_the_first_save(self, client, db):
        """The score must be computed *after* the calculated fields run, or a
        weighted calculated field is scored on its previous (empty) value and
        the card reads low until the next, unrelated save."""
        from app.models.calculation import Calculation

        await create_role(db, key="admin", label="Admin", permissions={"*": True})
        await create_card_type(
            db,
            key="Application",
            label="Application",
            fields_schema=[
                {
                    "section": "Details",
                    "fields": [
                        {"key": "seats", "label": "Seats", "type": "number", "weight": 1},
                        {
                            "key": "derived",
                            "label": "Derived",
                            "type": "number",
                            "weight": 1,
                            "readonly": True,
                        },
                    ],
                }
            ],
        )
        await _set_dq(
            db, "Application", description=0, lifecycle=0, relations=0, tags=0, stakeholders=0
        )
        db.add(
            Calculation(
                name="Double seats",
                target_type_key="Application",
                target_field_key="derived",
                formula="data.seats * 2",
                is_active=True,
            )
        )
        admin = await create_user(db, email="calc@test.com", role="admin")
        await db.flush()

        resp = await client.post(
            "/api/v1/cards",
            json={"type": "Application", "name": "Calc App", "attributes": {"seats": 10}},
            headers=auth_headers(admin),
        )
        assert resp.status_code == 201
        card_id = resp.json()["id"]
        # `derived` is filled by the calculation, so both weighted fields count.
        assert await _score(db, card_id) == 100.0

    async def test_scorer_and_stored_score_agree(self, client, db, stake_env):
        """Whatever the endpoints wrote must equal what the canonical scorer
        would compute — no drift between the two paths."""
        admin, member, card = stake_env["admin"], stake_env["member"], stake_env["card"]
        await client.post(
            f"/api/v1/cards/{card.id}/stakeholders",
            json={"user_id": str(member.id), "role": "responsible"},
            headers=auth_headers(admin),
        )
        fresh = await db.get(Card, card.id)
        assert await _score(db, card.id) == await calc_data_quality(db, fresh)
