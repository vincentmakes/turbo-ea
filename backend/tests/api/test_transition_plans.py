"""Integration tests for the /transition-plans endpoints.

These tests require a PostgreSQL test database and an HTTP test client.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.api.v1.transition_plans import CAP_TRANSITION_PLANNING
from app.core.permissions import MEMBER_PERMISSIONS, VIEWER_PERMISSIONS
from app.services.extensions.registry import extension_registry
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_relation_type,
    create_role,
    create_user,
)


@pytest.fixture(autouse=True)
def _grant_transition_planning(monkeypatch):
    """Authoring is extension-gated (see test_transition_plan_gating.py); the
    behavioural tests here run with the grant active."""
    monkeypatch.setattr(
        extension_registry,
        "granted_capabilities",
        lambda now=None: {CAP_TRANSITION_PLANNING},
    )


@pytest.fixture
async def plan_env(db):
    """Prerequisite data shared by all architecture-plan tests."""
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="member", label="Member", permissions=MEMBER_PERMISSIONS)
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    admin = await create_user(db, email="admin@test.com", role="admin")
    member = await create_user(db, email="member@test.com", role="member")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")

    await create_card_type(
        db,
        key="Application",
        label="Application",
        fields_schema=[
            {
                "section": "Costs",
                "fields": [{"key": "costTotalAnnual", "label": "Cost", "type": "cost"}],
            }
        ],
    )
    await create_card_type(db, key="ITComponent", label="IT Component")
    await create_card_type(db, key="Initiative", label="Initiative")
    await create_card_type(db, key="Objective", label="Objective")
    await create_card_type(db, key="BusinessCapability", label="Business Capability")
    await create_relation_type(
        db,
        key="relAppToITC",
        label="uses",
        source_type_key="Application",
        target_type_key="ITComponent",
    )
    await create_relation_type(
        db,
        key="relAppToBC",
        label="supports",
        source_type_key="Application",
        target_type_key="BusinessCapability",
    )
    await create_relation_type(
        db,
        key="relInitiativeToApp",
        label="affects",
        source_type_key="Initiative",
        target_type_key="Application",
    )
    await create_relation_type(
        db,
        key="relInitiativeToObjective",
        label="supports",
        source_type_key="Initiative",
        target_type_key="Objective",
    )

    app_a = await create_card(
        db,
        card_type="Application",
        name="Legacy CRM",
        lifecycle={"active": "2020-01-01"},
    )
    itc = await create_card(db, card_type="ITComponent", name="Postgres")
    objective = await create_card(db, card_type="Objective", name="Reduce cost")

    return {
        "admin": admin,
        "member": member,
        "viewer": viewer,
        "app_a": app_a,
        "itc": itc,
        "objective": objective,
    }


def _baseline(env) -> dict:
    return {
        "nodes": [
            {"id": str(env["app_a"].id), "name": "Legacy CRM", "type": "Application"},
            {"id": str(env["itc"].id), "name": "Postgres", "type": "ITComponent"},
        ],
        "edges": [
            {
                "source": str(env["app_a"].id),
                "target": str(env["itc"].id),
                "type": "relAppToITC",
                "label": "uses",
            }
        ],
    }


def _replace_plan_data(env, *, remove_relation: bool = False) -> dict:
    changes: list[dict] = [
        {
            "op": "replace_card",
            "predecessorId": str(env["app_a"].id),
            "successor": {
                "proposed": {
                    "tempId": "tmp:succ",
                    "name": "New CRM",
                    "cardTypeKey": "Application",
                }
            },
        }
    ]
    if remove_relation:
        changes.append(
            {
                "op": "remove_relation",
                "sourceId": str(env["app_a"].id),
                "targetId": str(env["itc"].id),
                "relationType": "relAppToITC",
            }
        )
    return {"baseline": _baseline(env), "changes": changes}


async def _create_plan(client, env, plan_data: dict, user_key: str = "admin") -> dict:
    resp = await client.post(
        "/api/v1/transition-plans",
        json={"title": "Test plan", "description": "Plan description", "plan_data": plan_data},
        headers=auth_headers(env[user_key]),
    )
    assert resp.status_code == 201
    return resp.json()


COMMIT_BODY = {
    "initiative_name": "CRM Replacement",
    "start_date": "2026-08-01",
    "end_date": "2027-01-31",
}


# -------------------------------------------------------------------
# CRUD
# -------------------------------------------------------------------


class TestCrud:
    async def test_admin_can_create(self, client, db, plan_env):
        data = await _create_plan(client, plan_env, {"baseline": _baseline(plan_env)})
        assert data["title"] == "Test plan"
        assert data["status"] == "draft"
        assert data["plan_data"]["baseline"]["nodes"]

    async def test_member_can_create_viewer_cannot(self, client, db, plan_env):
        resp = await client.post(
            "/api/v1/transition-plans",
            json={"title": "Member plan"},
            headers=auth_headers(plan_env["member"]),
        )
        assert resp.status_code == 201
        resp = await client.post(
            "/api/v1/transition-plans",
            json={"title": "Blocked"},
            headers=auth_headers(plan_env["viewer"]),
        )
        assert resp.status_code == 403

    async def test_unknown_field_rejected(self, client, db, plan_env):
        resp = await client.post(
            "/api/v1/transition-plans",
            json={"title": "X", "bogus_field": "y"},
            headers=auth_headers(plan_env["admin"]),
        )
        assert resp.status_code == 422

    async def test_list_is_summary_and_filters_by_initiative(self, client, db, plan_env):
        plan = await _create_plan(client, plan_env, _replace_plan_data(plan_env))
        initiative = await create_card(db, card_type="Initiative", name="Init")
        await db.commit()
        resp = await client.patch(
            f"/api/v1/transition-plans/{plan['id']}",
            json={"initiative_id": str(initiative.id)},
            headers=auth_headers(plan_env["admin"]),
        )
        assert resp.status_code == 200

        resp = await client.get(
            "/api/v1/transition-plans", headers=auth_headers(plan_env["viewer"])
        )
        assert resp.status_code == 200
        rows = resp.json()
        assert len(rows) == 1
        assert "plan_data" not in rows[0]  # summary serializer
        assert rows[0]["change_count"] == 1

        resp = await client.get(
            f"/api/v1/transition-plans?initiative_id={initiative.id}",
            headers=auth_headers(plan_env["admin"]),
        )
        assert len(resp.json()) == 1
        resp = await client.get(
            f"/api/v1/transition-plans?initiative_id={uuid.uuid4()}",
            headers=auth_headers(plan_env["admin"]),
        )
        assert len(resp.json()) == 0

    async def test_get_returns_full_plan_data(self, client, db, plan_env):
        plan = await _create_plan(client, plan_env, _replace_plan_data(plan_env))
        resp = await client.get(
            f"/api/v1/transition-plans/{plan['id']}",
            headers=auth_headers(plan_env["viewer"]),
        )
        assert resp.status_code == 200
        assert resp.json()["plan_data"]["changes"]

    async def test_delete(self, client, db, plan_env):
        plan = await _create_plan(client, plan_env, {})
        resp = await client.delete(
            f"/api/v1/transition-plans/{plan['id']}",
            headers=auth_headers(plan_env["admin"]),
        )
        assert resp.status_code == 204
        resp = await client.get(
            f"/api/v1/transition-plans/{plan['id']}",
            headers=auth_headers(plan_env["admin"]),
        )
        assert resp.status_code == 404

    async def test_get_unknown_id_404(self, client, db, plan_env):
        resp = await client.get(
            "/api/v1/transition-plans/not-a-uuid",
            headers=auth_headers(plan_env["admin"]),
        )
        assert resp.status_code == 404


# -------------------------------------------------------------------
# Commit
# -------------------------------------------------------------------


class TestCommit:
    async def test_commit_proposed_add_card(self, client, db, plan_env):
        from app.models.card import Card
        from app.models.relation import Relation

        plan_data = {
            "baseline": _baseline(plan_env),
            "changes": [
                {
                    "op": "add_card",
                    "card": {
                        "proposed": {
                            "tempId": "tmp:new1",
                            "name": "New Portal",
                            "cardTypeKey": "Application",
                        }
                    },
                }
            ],
        }
        plan = await _create_plan(client, plan_env, plan_data)
        resp = await client.post(
            f"/api/v1/transition-plans/{plan['id']}/commit",
            json={**COMMIT_BODY, "objective_ids": [str(plan_env["objective"].id)]},
            headers=auth_headers(plan_env["admin"]),
        )
        assert resp.status_code == 200
        result = resp.json()
        assert result["card_count"] == 1
        assert result["adr_reference"] is not None

        # New card exists with lifecycle from the commit dates
        row = await db.execute(select(Card).where(Card.name == "New Portal"))
        new_card = row.scalar_one()
        assert new_card.lifecycle["phaseIn"] == "2026-08-01"

        initiative_id = uuid.UUID(result["initiative_id"])
        # Initiative → new card link
        row = await db.execute(
            select(Relation).where(
                Relation.type == "relInitiativeToApp",
                Relation.source_id == initiative_id,
                Relation.target_id == new_card.id,
            )
        )
        assert row.scalar_one_or_none() is not None
        # Initiative → objective link
        row = await db.execute(
            select(Relation).where(
                Relation.type == "relInitiativeToObjective",
                Relation.source_id == initiative_id,
            )
        )
        assert row.scalar_one_or_none() is not None

        # Plan flipped to committed and linked
        resp = await client.get(
            f"/api/v1/transition-plans/{plan['id']}",
            headers=auth_headers(plan_env["admin"]),
        )
        body = resp.json()
        assert body["status"] == "committed"
        assert body["initiative_id"] == result["initiative_id"]

    async def test_commit_existing_add_card_links_only(self, client, db, plan_env):
        from app.models.relation import Relation

        plan_data = {
            "baseline": _baseline(plan_env),
            "changes": [{"op": "add_card", "card": {"existingCardId": str(plan_env["app_a"].id)}}],
        }
        plan = await _create_plan(client, plan_env, plan_data)
        resp = await client.post(
            f"/api/v1/transition-plans/{plan['id']}/commit",
            json=COMMIT_BODY,
            headers=auth_headers(plan_env["admin"]),
        )
        assert resp.status_code == 200
        result = resp.json()
        assert result["card_count"] == 0  # nothing created
        row = await db.execute(
            select(Relation).where(
                Relation.type == "relInitiativeToApp",
                Relation.source_id == uuid.UUID(result["initiative_id"]),
                Relation.target_id == plan_env["app_a"].id,
            )
        )
        assert row.scalar_one_or_none() is not None

    async def test_commit_replace_derives_relations_and_stamps_eol(self, client, db, plan_env):
        from app.models.card import Card
        from app.models.relation import Relation

        plan = await _create_plan(client, plan_env, _replace_plan_data(plan_env))
        resp = await client.post(
            f"/api/v1/transition-plans/{plan['id']}/commit",
            json=COMMIT_BODY,
            headers=auth_headers(plan_env["admin"]),
        )
        assert resp.status_code == 200
        result = resp.json()
        assert result["card_count"] == 1
        assert result["retired_count"] == 1

        # Successor inherits the predecessor's relation to the IT component
        row = await db.execute(select(Card).where(Card.name == "New CRM"))
        successor = row.scalar_one()
        row = await db.execute(
            select(Relation).where(
                Relation.type == "relAppToITC",
                Relation.source_id == successor.id,
                Relation.target_id == plan_env["itc"].id,
            )
        )
        assert row.scalar_one_or_none() is not None

        # Predecessor got an end-of-life stamp, existing phases preserved
        await db.refresh(plan_env["app_a"])
        assert plan_env["app_a"].lifecycle["endOfLife"] == "2027-01-31"
        assert plan_env["app_a"].lifecycle["active"] == "2020-01-01"

    async def test_commit_replace_honors_remove_relation(self, client, db, plan_env):
        from app.models.card import Card
        from app.models.relation import Relation

        plan = await _create_plan(
            client, plan_env, _replace_plan_data(plan_env, remove_relation=True)
        )
        resp = await client.post(
            f"/api/v1/transition-plans/{plan['id']}/commit",
            json=COMMIT_BODY,
            headers=auth_headers(plan_env["admin"]),
        )
        assert resp.status_code == 200

        row = await db.execute(select(Card).where(Card.name == "New CRM"))
        successor = row.scalar_one()
        row = await db.execute(
            select(Relation).where(
                Relation.type == "relAppToITC",
                Relation.source_id == successor.id,
            )
        )
        assert row.scalar_one_or_none() is None  # cut relation not inherited

    async def test_commit_skips_invalid_relation_type(self, client, db, plan_env):
        plan_data = {
            "baseline": _baseline(plan_env),
            "changes": [
                {
                    "op": "add_relation",
                    "sourceId": str(plan_env["app_a"].id),
                    "targetId": str(plan_env["itc"].id),
                    "relationType": "relDoesNotExist",
                }
            ],
        }
        plan = await _create_plan(client, plan_env, plan_data)
        resp = await client.post(
            f"/api/v1/transition-plans/{plan['id']}/commit",
            json=COMMIT_BODY,
            headers=auth_headers(plan_env["admin"]),
        )
        assert resp.status_code == 200
        assert resp.json()["relation_count"] == 0

    async def test_commit_without_adr(self, client, db, plan_env):
        from app.models.architecture_decision import ArchitectureDecision

        plan = await _create_plan(client, plan_env, _replace_plan_data(plan_env))
        resp = await client.post(
            f"/api/v1/transition-plans/{plan['id']}/commit",
            json={**COMMIT_BODY, "create_adr": False},
            headers=auth_headers(plan_env["admin"]),
        )
        assert resp.status_code == 200
        assert resp.json()["adr_id"] is None
        row = await db.execute(select(ArchitectureDecision))
        assert row.scalars().first() is None

    async def test_commit_creates_adr_documenting_changes(self, client, db, plan_env):
        from app.models.architecture_decision import ArchitectureDecision

        plan = await _create_plan(
            client, plan_env, _replace_plan_data(plan_env, remove_relation=True)
        )
        resp = await client.post(
            f"/api/v1/transition-plans/{plan['id']}/commit",
            json=COMMIT_BODY,
            headers=auth_headers(plan_env["admin"]),
        )
        assert resp.status_code == 200
        adr_id = resp.json()["adr_id"]
        adr = await db.get(ArchitectureDecision, uuid.UUID(adr_id))
        assert adr is not None
        assert adr.status == "draft"
        assert "Replace 'Legacy CRM' with 'New CRM'" in (adr.decision or "")
        assert "Cut relation" in (adr.decision or "")
        assert adr.related_decisions[0]["type"] == "transition_plan"
        assert adr.related_decisions[0]["id"] == plan["id"]
        # v1.1: the ADR now carries the gap analysis + cost insight lines.
        assert "Gap analysis" in (adr.consequences or "")
        assert "Estimated annual cost" in (adr.consequences or "")

    async def test_commit_proposed_estimated_cost_lands_on_card(self, client, db, plan_env):
        from app.models.card import Card

        # The Application type carries a `costTotalAnnual` cost field (see fixture),
        # so the proposed card's estimate lands on that attribute at commit.
        plan_data = {
            "baseline": _baseline(plan_env),
            "changes": [
                {
                    "op": "add_card",
                    "card": {
                        "proposed": {
                            "tempId": "tmp:new",
                            "name": "Estimated App",
                            "cardTypeKey": "Application",
                            "estimatedCost": 42000,
                        }
                    },
                }
            ],
        }
        plan = await _create_plan(client, plan_env, plan_data)
        resp = await client.post(
            f"/api/v1/transition-plans/{plan['id']}/commit",
            json=COMMIT_BODY,
            headers=auth_headers(plan_env["admin"]),
        )
        assert resp.status_code == 200
        row = await db.execute(select(Card).where(Card.name == "Estimated App"))
        card = row.scalar_one()
        assert card.attributes.get("costTotalAnnual") == 42000

    async def test_commit_adr_flags_capability_coverage_gap(self, client, db, plan_env):
        from app.models.architecture_decision import ArchitectureDecision

        cap = await create_card(db, card_type="BusinessCapability", name="Billing")
        await db.commit()
        plan_data = {
            "baseline": {
                "nodes": [
                    {"id": str(plan_env["app_a"].id), "name": "Legacy CRM", "type": "Application"},
                    {"id": str(cap.id), "name": "Billing", "type": "BusinessCapability"},
                ],
                "edges": [
                    {
                        "source": str(plan_env["app_a"].id),
                        "target": str(cap.id),
                        "type": "relAppToBC",
                        "label": "supports",
                    }
                ],
            },
            # Decommission the only application supporting the Billing capability.
            "changes": [{"op": "remove_card", "cardId": str(plan_env["app_a"].id)}],
        }
        plan = await _create_plan(client, plan_env, plan_data)
        resp = await client.post(
            f"/api/v1/transition-plans/{plan['id']}/commit",
            json=COMMIT_BODY,
            headers=auth_headers(plan_env["admin"]),
        )
        assert resp.status_code == 200
        adr = await db.get(ArchitectureDecision, uuid.UUID(resp.json()["adr_id"]))
        assert "Capability coverage gap" in (adr.consequences or "")
        assert "Billing" in (adr.consequences or "")

    async def test_viewer_cannot_commit(self, client, db, plan_env):
        plan = await _create_plan(client, plan_env, _replace_plan_data(plan_env))
        resp = await client.post(
            f"/api/v1/transition-plans/{plan['id']}/commit",
            json=COMMIT_BODY,
            headers=auth_headers(plan_env["viewer"]),
        )
        assert resp.status_code == 403

    async def test_second_commit_conflicts(self, client, db, plan_env):
        plan = await _create_plan(client, plan_env, _replace_plan_data(plan_env))
        resp = await client.post(
            f"/api/v1/transition-plans/{plan['id']}/commit",
            json=COMMIT_BODY,
            headers=auth_headers(plan_env["admin"]),
        )
        assert resp.status_code == 200
        resp = await client.post(
            f"/api/v1/transition-plans/{plan['id']}/commit",
            json=COMMIT_BODY,
            headers=auth_headers(plan_env["admin"]),
        )
        assert resp.status_code == 409

    async def test_patch_committed_plan_conflicts(self, client, db, plan_env):
        plan = await _create_plan(client, plan_env, _replace_plan_data(plan_env))
        resp = await client.post(
            f"/api/v1/transition-plans/{plan['id']}/commit",
            json=COMMIT_BODY,
            headers=auth_headers(plan_env["admin"]),
        )
        assert resp.status_code == 200
        resp = await client.patch(
            f"/api/v1/transition-plans/{plan['id']}",
            json={"title": "Nope"},
            headers=auth_headers(plan_env["admin"]),
        )
        assert resp.status_code == 409

    async def test_commit_without_changes_rejected(self, client, db, plan_env):
        plan = await _create_plan(client, plan_env, {"baseline": _baseline(plan_env)})
        resp = await client.post(
            f"/api/v1/transition-plans/{plan['id']}/commit",
            json=COMMIT_BODY,
            headers=auth_headers(plan_env["admin"]),
        )
        assert resp.status_code == 400
