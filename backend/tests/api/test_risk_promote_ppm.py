"""Integration tests for promoting a PPM project risk into the GRC register.

Covers `POST /risks/promote/ppm/{ppm_risk_id}`:

* Creates a register risk with `source_type="ppm"` / `source_ref=<ppm id>`,
  an `R-NNNNNN` reference, and the initiative card linked.
* Maps the 1-5 probability × impact scales onto the register vocabulary.
* Spawns a one-shot mitigation task from the PPM `mitigation` text.
* Idempotent — a second promote returns the same risk.
* Owner carries over and produces the owner's system Todo.
* 404 on unknown ids, 403 without `risks.manage`.

The back-link surfaced by `GET /ppm/initiatives/{id}/risks` is covered in
`test_ppm.py` (`TestRiskPromotionBackLink`).
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import func, select

from app.core.permissions import VIEWER_PERMISSIONS
from app.models.ppm_risk import PpmRisk
from app.models.risk import Risk, RiskCard
from app.models.risk_mitigation_task import RiskMitigationTask
from app.models.todo import Todo
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_role,
    create_user,
)


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="viewer", label="Viewer", permissions={**VIEWER_PERMISSIONS})
    await create_card_type(db, key="Initiative", label="Initiative")
    admin = await create_user(db, email="admin@test.com", role="admin")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    initiative = await create_card(
        db, card_type="Initiative", name="Migration Programme", user_id=admin.id
    )
    return {"admin": admin, "viewer": viewer, "initiative": initiative}


async def _mk_ppm_risk(db, initiative_id, **kwargs) -> PpmRisk:
    risk = PpmRisk(
        id=uuid.uuid4(),
        initiative_id=initiative_id,
        title=kwargs.get("title", "Vendor may slip"),
        description=kwargs.get("description", "Key vendor is overcommitted."),
        probability=kwargs.get("probability", 4),
        impact=kwargs.get("impact", 4),
        risk_score=kwargs.get("probability", 4) * kwargs.get("impact", 4),
        mitigation=kwargs.get("mitigation"),
        owner_id=kwargs.get("owner_id"),
        status=kwargs.get("status", "open"),
    )
    db.add(risk)
    await db.flush()
    return risk


async def _promote(client, env, ppm_id, expected=200):
    resp = await client.post(
        f"/api/v1/risks/promote/ppm/{ppm_id}", json={}, headers=auth_headers(env["admin"])
    )
    assert resp.status_code == expected, resp.text
    return resp.json() if expected == 200 else None


async def test_promote_creates_linked_register_risk(client, db, env):
    ppm_risk = await _mk_ppm_risk(db, env["initiative"].id)
    body = await _promote(client, env, ppm_risk.id)

    assert body["source_type"] == "ppm"
    assert body["title"] == "Vendor may slip"
    assert body["reference"].startswith("R-")
    assert body["category"] == "operational"
    assert body["status"] == "identified"
    # The initiative card is linked as an affected card.
    assert [c["card_id"] for c in body["cards"]] == [str(env["initiative"].id)]

    risk = await db.get(Risk, uuid.UUID(body["id"]))
    assert risk.source_ref == str(ppm_risk.id)
    link = (await db.execute(select(RiskCard).where(RiskCard.risk_id == risk.id))).scalar_one()
    assert link.card_id == env["initiative"].id


async def test_score_mapping_extremes(client, db, env):
    worst = await _mk_ppm_risk(db, env["initiative"].id, probability=5, impact=5, title="Worst")
    best = await _mk_ppm_risk(db, env["initiative"].id, probability=1, impact=1, title="Best")

    worst_out = await _promote(client, env, worst.id)
    assert worst_out["initial_probability"] == "very_high"
    assert worst_out["initial_impact"] == "critical"
    assert worst_out["initial_level"] == "critical"

    best_out = await _promote(client, env, best.id)
    assert best_out["initial_probability"] == "low"
    assert best_out["initial_impact"] == "low"
    assert best_out["initial_level"] == "low"


async def test_mitigation_text_spawns_one_shot_task(client, db, env):
    ppm_risk = await _mk_ppm_risk(db, env["initiative"].id, mitigation="Line up a second vendor.")
    body = await _promote(client, env, ppm_risk.id)

    tasks = (
        (
            await db.execute(
                select(RiskMitigationTask).where(
                    RiskMitigationTask.risk_id == uuid.UUID(body["id"])
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(tasks) == 1
    assert tasks[0].description == "Line up a second vendor."
    assert tasks[0].recurrence_unit == "none"


async def test_no_mitigation_no_task(client, db, env):
    ppm_risk = await _mk_ppm_risk(db, env["initiative"].id, mitigation=None)
    body = await _promote(client, env, ppm_risk.id)
    count = (
        await db.execute(
            select(func.count())
            .select_from(RiskMitigationTask)
            .where(RiskMitigationTask.risk_id == uuid.UUID(body["id"]))
        )
    ).scalar_one()
    assert count == 0


async def test_promote_is_idempotent(client, db, env):
    ppm_risk = await _mk_ppm_risk(db, env["initiative"].id)
    first = await _promote(client, env, ppm_risk.id)
    second = await _promote(client, env, ppm_risk.id)
    assert second["id"] == first["id"]

    count = (
        await db.execute(
            select(func.count())
            .select_from(Risk)
            .where(Risk.source_type == "ppm", Risk.source_ref == str(ppm_risk.id))
        )
    ).scalar_one()
    assert count == 1


async def test_owner_carries_over_with_todo(client, db, env):
    owner = await create_user(db, email="owner@test.com", role="viewer")
    ppm_risk = await _mk_ppm_risk(db, env["initiative"].id, owner_id=owner.id)
    body = await _promote(client, env, ppm_risk.id)
    assert body["owner_id"] == str(owner.id)

    todo = (
        await db.execute(
            select(Todo).where(
                Todo.assigned_to == owner.id,
                Todo.is_system.is_(True),
                Todo.link == f"/ea-delivery/risks/{body['id']}",
            )
        )
    ).scalar_one_or_none()
    assert todo is not None


async def test_unknown_ppm_risk_404(client, db, env):
    await _promote(client, env, uuid.uuid4(), expected=404)


async def test_malformed_id_400(client, db, env):
    resp = await client.post(
        "/api/v1/risks/promote/ppm/not-a-uuid", json={}, headers=auth_headers(env["admin"])
    )
    assert resp.status_code == 400


async def test_viewer_cannot_promote(client, db, env):
    ppm_risk = await _mk_ppm_risk(db, env["initiative"].id)
    resp = await client.post(
        f"/api/v1/risks/promote/ppm/{ppm_risk.id}",
        json={},
        headers=auth_headers(env["viewer"]),
    )
    assert resp.status_code == 403
