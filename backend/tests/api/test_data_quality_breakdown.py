"""``GET /cards/{id}/data-quality`` — the score's breakdown (#1334).

What the pill's tooltip and popover read: every slot with its weight, whether
it counts, the score the card would reach by filling it, and the required
fields that pin the score at 0. Gated like the card's other sub-reads, and it
names no other card.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.core.permissions import MEMBER_PERMISSIONS
from app.models.card_type import CardType
from app.models.tag import Tag, TagGroup
from app.services.permission_service import PermissionService
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_relation,
    create_relation_type,
    create_role,
    create_stakeholder_role_def,
    create_user,
)

_SCHEMA = [
    {
        "section": "Details",
        "fields": [
            {"key": "team", "label": "Team", "type": "text", "weight": 1},
            {"key": "cost", "label": "Cost", "type": "number", "weight": 2},
        ],
    }
]


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="member", label="Member", permissions=MEMBER_PERMISSIONS)
    await create_role(db, key="nobody", label="Nobody", permissions={})
    await create_card_type(
        db,
        key="Application",
        fields_schema=_SCHEMA,
        section_config={
            "__dataQuality": {
                "description": 1,
                "lifecycle": 1,
                "relations": 1,
                "tags": 1,
                "stakeholders": 1,
            }
        },
    )
    await create_card_type(db, key="Organization")
    rt = await create_relation_type(
        db,
        key="relAppToOrg",
        label="is owned by",
        source_type_key="Application",
        target_type_key="Organization",
    )
    rt.source_mandatory = True
    group = TagGroup(name="Criticality", mandatory=True, restrict_to_types=["Application"])
    db.add(group)
    await db.flush()
    db.add(Tag(tag_group_id=group.id, name="High"))
    await create_stakeholder_role_def(db, card_type_key="Application", key="owner", label="Owner")
    org = await create_card(db, card_type="Organization", name="Acme Holding")
    app = await create_card(
        db,
        card_type="Application",
        name="Billing",
        attributes={"team": "Ops"},
        description="Bills customers",
    )
    await create_relation(db, type_key="relAppToOrg", source_id=app.id, target_id=org.id)
    await db.flush()
    return {
        "app": app,
        "org": org,
        "group": group,
        "admin": await create_user(db, email="admin@t.com", role="admin"),
        "member": await create_user(db, email="member@t.com", role="member"),
        "nobody": await create_user(db, email="nobody@t.com", role="nobody"),
    }


def _url(card_id) -> str:
    return f"/api/v1/cards/{card_id}/data-quality"


async def test_lists_every_slot_and_what_filling_it_would_reach(client, env):
    resp = await client.get(_url(env["app"].id), headers=auth_headers(env["admin"]))
    assert resp.status_code == 200
    body = resp.json()
    # team 1 + cost 2 + description + lifecycle + relation + tag + stakeholder = 8;
    # team, description and the relation are filled.
    assert body["total_weight"] == 8.0
    assert body["filled_weight"] == 3.0
    assert body["score"] == body["ungated_score"] == 37.5
    assert body["blocked_by_required"] == []

    rows = {(f["kind"], f["key"]): f for f in body["factors"]}
    assert set(rows) == {
        ("field", "team"),
        ("field", "cost"),
        ("description", "description"),
        ("lifecycle", "lifecycle"),
        ("relation", "relAppToOrg"),
        ("tag_group", str(env["group"].id)),
        ("stakeholders", "stakeholders"),
    }
    assert {k: f["score_if_filled"] for k, f in rows.items() if not f["filled"]} == {
        ("field", "cost"): 62.5,  # (3 + 2) / 8
        ("lifecycle", "lifecycle"): 50.0,
        ("tag_group", str(env["group"].id)): 50.0,
        ("stakeholders", "stakeholders"): 50.0,
    }
    # What each unmet slot adds: its weight over the total of 8.
    assert {k: f["gain"] for k, f in rows.items() if not f["filled"]} == {
        ("field", "cost"): 25.0,
        ("lifecycle", "lifecycle"): 12.5,
        ("tag_group", str(env["group"].id)): 12.5,
        ("stakeholders", "stakeholders"): 12.5,
    }
    # A slot that already counts has nothing to gain.
    assert rows[("field", "team")]["score_if_filled"] is None
    assert rows[("field", "team")]["gain"] is None
    assert rows[("field", "team")]["section"] == "Details"
    rel = rows[("relation", "relAppToOrg")]
    assert rel["filled"] is True
    assert (rel["side"], rel["other_type_key"], rel["label"]) == (
        "source",
        "Organization",
        "is owned by",
    )
    assert rows[("tag_group", str(env["group"].id))]["name"] == "Criticality"


async def test_names_no_other_card(client, env):
    resp = await client.get(_url(env["app"].id), headers=auth_headers(env["admin"]))
    assert "Acme Holding" not in resp.text
    assert str(env["org"].id) not in resp.text


async def test_an_empty_required_field_pins_the_score_and_is_named(client, db, env):
    ct = (await db.execute(select(CardType).where(CardType.key == "Application"))).scalar_one()
    ct.fields_schema = [
        {
            "section": "Details",
            "fields": [*_SCHEMA[0]["fields"], {"key": "code", "type": "text", "required": True}],
        }
    ]
    await db.flush()
    resp = await client.get(_url(env["app"].id), headers=auth_headers(env["admin"]))
    body = resp.json()
    assert body["score"] == 0.0
    assert body["blocked_by_required"] == ["code"]
    # team, description and the relation of 9 slots.
    assert body["ungated_score"] == 33.3
    assert len(body["factors"]) == 8


async def test_a_member_reads_it(client, env):
    resp = await client.get(_url(env["app"].id), headers=auth_headers(env["member"]))
    assert resp.status_code == 200
    assert resp.json()["score"] == 37.5


async def test_a_role_without_inventory_view_is_refused(client, env):
    resp = await client.get(_url(env["app"].id), headers=auth_headers(env["nobody"]))
    assert resp.status_code == 403


async def test_a_card_hidden_by_a_type_deny_does_not_exist(client, db, env):
    ct = (await db.execute(select(CardType).where(CardType.key == "Application"))).scalar_one()
    ct.role_permissions = {"member": {"inventory.view": False}}
    await db.flush()
    PermissionService.invalidate_type_permission_cache()
    resp = await client.get(_url(env["app"].id), headers=auth_headers(env["member"]))
    assert resp.status_code == 404
    assert "Billing" not in resp.text


async def test_an_unknown_card_is_404(client, env):
    resp = await client.get(_url(uuid.uuid4()), headers=auth_headers(env["admin"]))
    assert resp.status_code == 404


async def test_a_malformed_id_is_422(client, env):
    resp = await client.get(_url("not-a-uuid"), headers=auth_headers(env["admin"]))
    assert resp.status_code == 422
