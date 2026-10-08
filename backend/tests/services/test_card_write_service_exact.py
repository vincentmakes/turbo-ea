"""``card_write_service``'s writes pinned to exact values.

``test_card_write_service.py`` and the REST tests show each write path works;
these pin what it writes and what it says about it — the row a create builds,
the ``changes`` a ``card.updated`` event carries, the notification an edit
sends, which side effects run in which order, the sets an archive resolves and
flips, and both halves of a relation event — because the nightly mutation run
showed those were the values no test compared.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

import pytest
from fastapi import BackgroundTasks, HTTPException
from sqlalchemy import select

from app.models.relation import Relation
from app.models.stakeholder import Stakeholder
from app.models.tag import CardTag, Tag, TagGroup
from app.services import card_write_service as svc
from app.services.card_write_service import WriteActor
from tests.conftest import (
    create_budget_line,
    create_card,
    create_card_type,
    create_relation,
    create_relation_type,
    create_user,
)

APP_SCHEMA = [
    {
        "section": "Main",
        "fields": [
            {"key": "website", "label": "Website", "type": "url"},
            {"key": "progress", "label": "Progress", "type": "percentage"},
            {"key": "owner", "label": "Owner", "type": "text", "required": True},
            {
                "key": "criticality",
                "label": "Criticality",
                "type": "single_select",
                "options": [{"key": "high"}, {"key": "low"}],
            },
        ],
    }
]


@pytest.fixture
async def env(db):
    await create_card_type(
        db,
        key="Application",
        label="Application",
        has_hierarchy=True,
        fields_schema=APP_SCHEMA,
        hierarchy_labels=[{"key": "commercial"}, {"key": "sales"}],
    )
    await create_card_type(db, key="ITComponent", label="IT Component")
    await create_card_type(db, key="Initiative", label="Initiative")
    await create_card_type(
        db, key="BusinessCapability", label="Business Capability", has_hierarchy=True
    )
    await create_relation_type(db, key="app_to_itc", label="uses", reverse_label="is used by")
    user = await create_user(db, email="writer@test.com", display_name="Wendy Writer")
    return {"user": user, "actor": WriteActor.from_user(user)}


def ext_actor() -> WriteActor:
    return WriteActor(user_id=None, display_name="Sync Bot", ext_key="sync")


@pytest.fixture
def published(monkeypatch):
    calls = []

    async def fake(event_type, data, db=None, card_id=None, user_id=None, batch_id=None):
        calls.append(
            {"type": event_type, "data": data, "db": db, "card_id": card_id, "user_id": user_id}
        )

    monkeypatch.setattr(svc.event_bus, "publish", fake)
    return calls


@pytest.fixture
def notified(monkeypatch):
    calls = []

    async def subscribers(db, **kwargs):
        calls.append({"kind": "card_updated", "db": db, **kwargs})
        return []

    async def broken(db, **kwargs):
        calls.append({"kind": "approval_broken", "db": db, **kwargs})

    monkeypatch.setattr(
        svc.notification_service, "create_notifications_for_subscribers", subscribers
    )
    monkeypatch.setattr(svc.card_approval, "notify_approval_broken", broken)
    return calls


@pytest.fixture
def steps(monkeypatch):
    """Record the calculation, descendant-recalc and scoring steps in order."""
    calls = []
    real_recalc = svc._recalc_changed_descendants

    async def calc(db_, card, exclude_fields=None):
        calls.append(("calc", card.id, exclude_fields))

    async def score(db_, card):
        calls.append(("score", card.id))
        return 73.0

    async def recalc(db_, changed, primary_id):
        calls.append(("descendants", [c.id for c in changed], primary_id))
        await real_recalc(db_, changed, primary_id)

    monkeypatch.setattr(svc, "run_calculations_for_card", calc)
    monkeypatch.setattr(svc, "calc_data_quality", score)
    monkeypatch.setattr(svc, "_recalc_changed_descendants", recalc)
    return calls


# ── create ──────────────────────────────────────────────────────────────────


async def test_a_created_card_carries_every_given_field(db, env):
    parent = await create_card(db, name="Parent")
    card = await svc.create_card(
        db,
        env["actor"],
        type_key="Application",
        name="Billing",
        subtype="saas",
        description="Bills",
        parent_id=parent.id,
        parent_label="sales",
        lifecycle={"active": "2024-01-01"},
        attributes={"website": "https://billing", "owner": "Ann"},
        external_id="ext-1",
        alias="BIL",
    )
    assert (card.type, card.subtype, card.name, card.description) == (
        "Application",
        "saas",
        "Billing",
        "Bills",
    )
    assert (card.parent_id, card.parent_label) == (parent.id, "sales")
    assert card.lifecycle == {"active": "2024-01-01"}
    assert card.attributes == {"website": "https://billing", "owner": "Ann", "hierarchyLevel": 2}
    assert (card.external_id, card.alias) == ("ext-1", "BIL")
    assert card.approval_status == "DRAFT"
    assert card.created_by == card.updated_by == env["user"].id
    assert card.id is not None and card.reference is None


async def test_a_bare_create_takes_the_defaults(db, env):
    card = await svc.create_card(db, ext_actor(), type_key="ITComponent", name="Server")
    assert card.lifecycle == {} and card.attributes == {}
    assert card.parent_id is None and card.parent_label is None
    assert card.created_by is None and card.updated_by is None


async def test_an_empty_label_without_a_parent_is_dropped(db, env):
    card = await svc.create_card(
        db, env["actor"], type_key="ITComponent", name="Server", parent_label=""
    )
    assert card.parent_label is None


async def test_a_create_announces_itself(db, env, published):
    card = await svc.create_card(db, env["actor"], type_key="ITComponent", name="Server")
    assert published == [
        {
            "type": "card.created",
            "data": {"id": str(card.id), "type": "ITComponent", "name": "Server"},
            "db": db,
            "card_id": card.id,
            "user_id": env["user"].id,
        }
    ]


async def test_an_extension_create_is_stamped_and_a_dry_run_is_silent(db, env, published):
    card = await svc.create_card(db, ext_actor(), type_key="ITComponent", name="Server")
    assert published[0]["data"] == {
        "id": str(card.id),
        "type": "ITComponent",
        "name": "Server",
        "ext": "sync",
    }
    assert published[0]["user_id"] is None
    await svc.create_card(db, ext_actor(), type_key="ITComponent", name="Preview", dry_run=True)
    assert len(published) == 1


async def test_a_create_calculates_then_scores(db, env, steps):
    parent = await create_card(db, name="Parent", attributes={"hierarchyLevel": 1})
    card = await svc.create_card(
        db, env["actor"], type_key="Application", name="Child", parent_id=parent.id
    )
    assert steps == [
        ("calc", card.id, set()),
        ("descendants", [card.id], card.id),
        ("score", card.id),
    ]
    assert card.data_quality == 73.0


async def test_a_create_assigns_an_auto_reference(db, env):
    ct = (
        await db.execute(select(svc.CardType).where(svc.CardType.key == "ITComponent"))
    ).scalar_one()
    ct.reference_config = {"mode": "auto", "prefix": "IT-", "start": 1, "padding": 2}
    await db.flush()
    card = await svc.create_card(db, env["actor"], type_key="ITComponent", name="Server")
    assert card.reference == "IT-01"


async def test_a_create_under_a_too_deep_capability_is_refused(db, env):
    parent = None
    for level in range(5):
        parent = await create_card(
            db,
            card_type="BusinessCapability",
            name=f"L{level + 1}",
            parent_id=parent.id if parent else None,
        )
    with pytest.raises(HTTPException) as exc:
        await svc.create_card(
            db, env["actor"], type_key="BusinessCapability", name="L6", parent_id=parent.id
        )
    assert exc.value.status_code == 400
    assert "maximum depth of 5 levels" in exc.value.detail


@pytest.mark.parametrize(
    "kwargs,status,marker",
    [
        ({"attributes": {"website": "ftp://x"}}, 422, "must use http://"),
        ({"attributes": {"progress": 101}}, 422, "between 0 and 100"),
        ({"attributes": {"criticality": "mid"}}, 422, "invalid_option_value"),
        ({"parent_label": "sales"}, 422, "hierarchy_label_without_parent"),
        ({"attributes": {"made_up": 1}, "strict_attributes": True}, 422, "unknown_attribute"),
    ],
)
async def test_a_create_runs_every_validation(db, env, kwargs, status, marker):
    with pytest.raises(HTTPException) as exc:
        await svc.create_card(db, env["actor"], type_key="Application", name="Bad", **kwargs)
    assert exc.value.status_code == status
    assert marker in str(exc.value.detail)


async def test_a_create_checks_the_label_against_the_vocabulary(db, env):
    parent = await create_card(db, name="Parent")
    with pytest.raises(HTTPException) as exc:
        await svc.create_card(
            db,
            env["actor"],
            type_key="Application",
            name="Bad",
            parent_id=parent.id,
            parent_label="legal",
        )
    assert exc.value.detail["code"] == "invalid_hierarchy_label"


async def test_undeclared_attributes_are_kept_unless_strict(db, env):
    card = await svc.create_card(
        db, env["actor"], type_key="ITComponent", name="Server", attributes={"made_up": 1}
    )
    assert card.attributes == {"made_up": 1}


async def test_undeclared_attributes_on_a_typed_card_need_strict_mode_to_fail(db, env):
    card = await svc.create_card(
        db, env["actor"], type_key="Application", name="Loose", attributes={"made_up": 1}
    )
    assert card.attributes["made_up"] == 1


async def test_a_name_taken_at_the_root_is_free_under_a_parent(db, env):
    await create_card(db, name="Twin")
    parent = await create_card(db, name="Parent")
    card = await svc.create_card(
        db, env["actor"], type_key="Application", name="Twin", parent_id=parent.id
    )
    assert card.parent_id == parent.id


async def test_a_create_refuses_a_sibling_with_the_same_name(db, env):
    parent = await create_card(db, name="Parent")
    await create_card(db, name="Twin", parent_id=parent.id)
    await svc.create_card(db, env["actor"], type_key="Application", name="Twin")  # other level
    with pytest.raises(HTTPException) as exc:
        await svc.create_card(
            db, env["actor"], type_key="Application", name="Twin", parent_id=parent.id
        )
    assert exc.value.status_code == 409


# ── update ──────────────────────────────────────────────────────────────────


async def test_an_update_that_changes_nothing_reports_false_and_stays_silent(
    db, env, published, notified
):
    card = await create_card(db, name="Same", description="d", attributes={"hierarchyLevel": 1})
    assert await svc.update_card(db, env["actor"], card, {"name": "Same", "description": "d"}) is (
        False
    )
    assert card.updated_by is None
    assert published == [] and notified == []


async def test_the_reference_is_never_updated_and_the_payload_is_not_mutated(db, env):
    card = await create_card(db, name="Old")
    card.reference = "APP-1"
    updates = {"reference": "HACK", "name": "New"}
    assert await svc.update_card(db, env["actor"], card, updates) is True
    assert card.reference == "APP-1"
    assert updates == {"reference": "HACK", "name": "New"}


async def test_an_update_records_every_change_and_announces_it(db, env, published, notified):
    parent = await create_card(db, name="Parent", attributes={"hierarchyLevel": 1})
    card = await create_card(
        db,
        name="Old",
        approval_status="APPROVED",
        lifecycle={"plan": "2024-01-01"},
        attributes={"owner": "Ann", "hierarchyLevel": 1},
    )
    when = datetime(2026, 1, 2, 3, 4, 5, tzinfo=timezone.utc)
    changed = await svc.update_card(
        db,
        env["actor"],
        card,
        {
            "name": "New",
            "parent_id": str(parent.id),
            "lifecycle": {"plan": "2024-01-01", "active": "2025-01-01"},
            "attributes": {"owner": "Bob"},
            "archived_at": when,
            "description": None,
        },
    )
    assert changed is True
    assert card.updated_by == env["user"].id
    assert card.approval_status == "BROKEN"
    assert published[0] == {
        "type": "card.updated",
        "data": {
            "id": str(card.id),
            "changes": {
                "name": {"old": "Old", "new": "New"},
                "parent_id": {"old": None, "new": str(parent.id)},
                "lifecycle": {
                    "old": {"plan": "2024-01-01"},
                    "new": {"plan": "2024-01-01", "active": "2025-01-01"},
                },
                "attributes": {
                    "old": {"owner": "Ann", "hierarchyLevel": 1},
                    "new": {"owner": "Bob"},
                },
                "archived_at": {"old": None, "new": "2026-01-02T03:04:05+00:00"},
                "approval_status": {"old": "APPROVED", "new": "BROKEN"},
            },
        },
        "db": db,
        "card_id": card.id,
        "user_id": env["user"].id,
    }
    assert card.attributes == {"owner": "Bob", "hierarchyLevel": 2}
    assert notified == [
        {
            "kind": "card_updated",
            "db": db,
            "card_id": card.id,
            "actor_id": env["user"].id,
            "notif_type": "card_updated",
            "title": "New Updated",
            "message": (
                'Wendy Writer updated "New" '
                "(name, parent_id, lifecycle, attributes, archived_at, approval_status)"
            ),
            "link": f"/cards/{card.id}",
            "data": {
                "changes": [
                    "name",
                    "parent_id",
                    "lifecycle",
                    "attributes",
                    "archived_at",
                    "approval_status",
                ]
            },
        },
        {
            "kind": "approval_broken",
            "db": db,
            "card": card,
            "actor_id": env["user"].id,
            "actor_display_name": "Wendy Writer",
        },
    ]


async def test_a_change_that_keeps_the_approval_sends_no_break_notice(db, env, notified):
    card = await create_card(db, name="Kept", approval_status="APPROVED")
    await svc.update_card(db, env["actor"], card, {"external_id": "x-1"})
    assert card.approval_status == "APPROVED"
    assert [n["kind"] for n in notified] == ["card_updated"]
    assert notified[0]["data"] == {"changes": ["external_id"]}


async def test_an_extension_update_is_stamped(db, env, published, notified):
    card = await create_card(db, name="Old", attributes={"hierarchyLevel": 1})
    await svc.update_card(db, ext_actor(), card, {"name": "New"})
    assert published[0]["data"] == {
        "id": str(card.id),
        "changes": {"name": {"old": "Old", "new": "New"}},
        "ext": "sync",
    }
    assert published[0]["user_id"] is None
    assert card.updated_by is None
    assert notified[0]["message"] == 'Sync Bot updated "New" (name)'


async def test_a_dry_run_update_changes_the_row_but_stays_silent(db, env, published, notified):
    card = await create_card(db, name="Old", approval_status="APPROVED")
    assert await svc.update_card(db, env["actor"], card, {"name": "New"}, dry_run=True) is True
    assert card.name == "New" and card.approval_status == "BROKEN"
    assert published == [] and notified == []


async def test_an_update_calculates_then_scores(db, env, steps):
    card = await create_card(db, name="C", attributes={"hierarchyLevel": 1})
    await svc.update_card(db, env["actor"], card, {"name": "D"})
    assert steps == [("calc", card.id, set()), ("descendants", [], card.id), ("score", card.id)]
    assert card.data_quality == 73.0


@pytest.mark.parametrize(
    "updates,status,marker",
    [
        ({"attributes": {"owner": "x", "website": "ftp://x"}}, 422, "must use http://"),
        ({"attributes": {"owner": "x", "progress": -1}}, 422, "between 0 and 100"),
        ({"attributes": {"owner": "x", "criticality": "mid"}}, 422, "invalid_option_value"),
        ({"attributes": {}}, 422, "required_field_empty"),
        ({"attributes": None}, 422, "required_field_empty"),
        ({"attributes": {"owner": "x", "made": 1}, "strict": True}, 422, "unknown_attribute"),
    ],
)
async def test_an_update_runs_every_attribute_validation(db, env, updates, status, marker):
    card = await create_card(db, name="C", attributes={"owner": "Ann"})
    updates = dict(updates)
    strict = updates.pop("strict", False)
    with pytest.raises(HTTPException) as exc:
        await svc.update_card(db, env["actor"], card, updates, strict_attributes=strict)
    assert exc.value.status_code == status
    assert marker in str(exc.value.detail)


async def test_an_update_keeps_a_legacy_option_and_undeclared_keys_unless_strict(db, env):
    card = await create_card(db, name="C", attributes={"owner": "Ann", "criticality": "legacy"})
    await svc.update_card(
        db, env["actor"], card, {"attributes": {"owner": "Bob", "criticality": "legacy", "z": 1}}
    )
    assert card.attributes["z"] == 1


async def test_an_initiative_keeps_the_cost_fields_its_ppm_lines_manage(db, env):
    ini = await create_card(
        db,
        card_type="Initiative",
        name="Programme",
        attributes={"costBudget": 100, "costActual": 40, "x": 1},
    )
    await create_budget_line(db, initiative_id=ini.id, amount=100)
    await svc.update_card(
        db, env["actor"], ini, {"attributes": {"costBudget": 5, "costActual": 6, "x": 2}}
    )
    assert ini.attributes == {"costBudget": 100, "costActual": 6, "x": 2}


async def test_a_managed_field_absent_before_stays_absent(db, env):
    ini = await create_card(db, card_type="Initiative", name="Programme", attributes={"x": 1})
    await create_budget_line(db, initiative_id=ini.id, amount=100)
    await svc.update_card(db, env["actor"], ini, {"attributes": {"x": 2}})
    assert ini.attributes == {"x": 2}


async def test_cost_fields_are_free_without_ppm_lines_or_on_other_types(db, env):
    ini = await create_card(db, card_type="Initiative", name="P", attributes={"costBudget": 1})
    await svc.update_card(db, env["actor"], ini, {"attributes": {"costBudget": 9}})
    assert ini.attributes == {"costBudget": 9}
    comp = await create_card(db, card_type="ITComponent", name="S", attributes={"costBudget": 1})
    await create_budget_line(db, initiative_id=comp.id, amount=100)
    await svc.update_card(db, env["actor"], comp, {"attributes": {"costBudget": 9}})
    assert comp.attributes == {"costBudget": 9}


async def test_a_reparent_into_its_own_subtree_is_refused(db, env):
    top = await create_card(db, name="Top")
    below = await create_card(db, name="Below", parent_id=top.id)
    with pytest.raises(HTTPException) as exc:
        await svc.update_card(db, env["actor"], top, {"parent_id": str(below.id)})
    assert exc.value.status_code == 400
    assert top.parent_id is None


async def test_a_reparent_that_is_too_deep_is_refused(db, env):
    parent = None
    for level in range(5):
        parent = await create_card(
            db,
            card_type="BusinessCapability",
            name=f"L{level + 1}",
            parent_id=parent.id if parent else None,
        )
    cap = await create_card(db, card_type="BusinessCapability", name="Cap")
    with pytest.raises(HTTPException) as exc:
        await svc.update_card(db, env["actor"], cap, {"parent_id": str(parent.id)})
    assert "maximum depth of 5 levels" in exc.value.detail


async def test_an_initiative_update_without_attributes_leaves_them_alone(db, env):
    ini = await create_card(
        db, card_type="Initiative", name="Programme", attributes={"costBudget": 100}
    )
    await create_budget_line(db, initiative_id=ini.id, amount=100)
    assert await svc.update_card(db, env["actor"], ini, {"name": "Renamed"}) is True
    assert ini.attributes["costBudget"] == 100


async def test_any_other_value_is_announced_as_text(db, env, published, notified, steps):
    card = await create_card(
        db, card_type="ITComponent", name="Server", attributes={"hierarchyLevel": 1}
    )
    await svc.update_card(db, env["actor"], card, {"archived_at": date(2026, 1, 2)})
    assert published[0]["data"]["changes"] == {"archived_at": {"old": None, "new": "2026-01-02"}}


async def test_the_parent_guards_run_only_when_the_parent_moves(db, env, monkeypatch):
    guarded = []

    async def cycle(db_, ids, pid):
        guarded.append(("cycle", ids, pid))

    async def depth(db_, card, pid):
        guarded.append(("depth", card.id, pid))

    monkeypatch.setattr(svc, "_check_parent_not_descendant", cycle)
    monkeypatch.setattr(svc, "_check_hierarchy_depth", depth)
    parent = await create_card(db, name="Parent")
    card = await create_card(db, name="C", parent_id=parent.id)
    await svc.update_card(db, env["actor"], card, {"parent_id": str(parent.id)})
    assert guarded == []
    await svc.update_card(db, env["actor"], card, {"parent_id": None})
    assert guarded == [("cycle", {card.id}, None), ("depth", card.id, None)]


async def test_dropping_the_parent_drops_its_label(db, env, published):
    parent = await create_card(db, name="Parent")
    card = await create_card(db, name="C", parent_id=parent.id, parent_label="sales")
    await svc.update_card(db, env["actor"], card, {"parent_id": None})
    assert card.parent_label is None
    assert published[0]["data"]["changes"]["parent_label"] == {"old": "sales", "new": None}


async def test_a_card_without_a_parent_cannot_take_a_label(db, env):
    card = await create_card(db, name="C", parent_label="stale")
    await svc.update_card(db, env["actor"], card, {"parent_label": "sales"})
    assert card.parent_label is None


async def test_a_new_label_is_checked_against_the_final_parent(db, env):
    parent = await create_card(db, name="Parent")
    card = await create_card(db, name="C")
    await svc.update_card(
        db, env["actor"], card, {"parent_id": str(parent.id), "parent_label": "commercial"}
    )
    assert (card.parent_id, card.parent_label) == (parent.id, "commercial")
    with pytest.raises(HTTPException) as exc:
        await svc.update_card(db, env["actor"], card, {"parent_label": "legal"})
    assert exc.value.detail["code"] == "invalid_hierarchy_label"


async def test_an_unchanged_stale_label_survives_an_edit(db, env):
    parent = await create_card(db, name="Parent")
    card = await create_card(db, name="C", parent_id=parent.id, parent_label="retired")
    await svc.update_card(db, env["actor"], card, {"parent_label": "retired", "name": "D"})
    assert card.parent_label == "retired"


async def test_the_sibling_check_runs_only_for_a_new_name_or_parent(db, env, monkeypatch):
    checked = []

    async def unique(db_, **kwargs):
        checked.append(kwargs)

    monkeypatch.setattr(svc, "check_sibling_name_unique", unique)
    parent = await create_card(db, name="Parent")
    card = await create_card(db, name="C", parent_id=parent.id)
    await svc.update_card(db, env["actor"], card, {"name": "C", "description": "x"})
    await svc.update_card(db, env["actor"], card, {"parent_id": str(parent.id)})
    assert checked == []
    await svc.update_card(db, env["actor"], card, {"name": "D"})
    await svc.update_card(db, env["actor"], card, {"parent_id": None})
    await svc.update_card(db, env["actor"], card, {"name": "E", "parent_id": str(parent.id)})
    base = {"type_key": "Application", "exclude_card_id": card.id}
    assert checked == [
        {**base, "parent_id": parent.id, "name": "D"},
        {**base, "parent_id": None, "name": "D"},
        {**base, "parent_id": parent.id, "name": "E"},
    ]


async def test_a_rename_onto_a_sibling_is_refused(db, env):
    await create_card(db, name="Taken")
    card = await create_card(db, name="Free")
    with pytest.raises(HTTPException) as exc:
        await svc.update_card(db, env["actor"], card, {"name": "Taken"})
    assert exc.value.status_code == 409


async def test_levels_are_resynced_only_when_needed(db, env, monkeypatch):
    synced = []
    real = svc._sync_hierarchy_levels

    async def spy(db_, card, *, previous=None):
        synced.append(card.name)
        return await real(db_, card, previous=previous)

    monkeypatch.setattr(svc, "_sync_hierarchy_levels", spy)
    placed = await create_card(db, name="Placed", attributes={"hierarchyLevel": 1})
    await svc.update_card(db, env["actor"], placed, {"description": "x"})
    assert synced == []
    unplaced = await create_card(db, name="Unplaced")
    await svc.update_card(db, env["actor"], unplaced, {"description": "x"})
    cap = await create_card(
        db, card_type="BusinessCapability", name="Cap", attributes={"hierarchyLevel": 1}
    )
    await svc.update_card(db, env["actor"], cap, {"description": "x"})
    leveled = await create_card(
        db,
        card_type="BusinessCapability",
        name="Leveled",
        attributes={"hierarchyLevel": 1, "capabilityLevel": "L1"},
    )
    await svc.update_card(db, env["actor"], leveled, {"description": "x"})
    await svc.update_card(db, env["actor"], placed, {"parent_id": str(leveled.id)})
    assert synced == ["Unplaced", "Cap", "Placed"]
    assert cap.attributes["capabilityLevel"] == "L1"


async def test_a_reparent_records_each_moved_descendant(db, env, published):
    new_top = await create_card(db, name="NewTop", attributes={"hierarchyLevel": 1})
    card = await create_card(db, name="Moving", attributes={"hierarchyLevel": 1})
    child = await create_card(db, name="Child", parent_id=card.id, attributes={"hierarchyLevel": 2})
    await svc.update_card(db, env["actor"], card, {"parent_id": str(new_top.id)})
    cascade = [p for p in published if p["data"].get("source") == "hierarchy_cascade"]
    assert cascade == [
        {
            "type": "card.updated",
            "data": {
                "id": str(child.id),
                "source": "hierarchy_cascade",
                "changes": {
                    "attributes": {"old": {"hierarchyLevel": 2}, "new": {"hierarchyLevel": 3}}
                },
            },
            "db": db,
            "card_id": child.id,
            "user_id": env["user"].id,
        }
    ]
    assert published[0]["card_id"] == card.id


# ── archive: what is affected ───────────────────────────────────────────────


@pytest.mark.parametrize("raw,shown", [("nope", "'nope'"), (None, "None"), (7, "7")])
async def test_a_malformed_related_id_is_refused(db, env, raw, shown):
    card = await create_card(db, name="P")
    with pytest.raises(HTTPException) as exc:
        await svc.resolve_archive_delete_set(
            db, card, child_strategy=None, related_card_ids=[raw], cascade_all_related=False
        )
    assert (exc.value.status_code, exc.value.detail) == (
        422,
        f"Invalid related_card_ids entry: {shown}",
    )


async def test_related_ids_are_deduplicated_and_never_the_primary(db, env):
    primary = await create_card(db, name="P")
    b, c = uuid.uuid4(), uuid.uuid4()
    result = await svc.resolve_archive_delete_set(
        db,
        primary,
        child_strategy="disconnect",
        related_card_ids=[str(b), str(primary.id), str(b), str(c)],
        cascade_all_related=False,
    )
    assert result == ([], [b, c], [b, c])


async def test_a_cascade_takes_the_subtree_deepest_first_and_drops_overlaps(db, env):
    primary = await create_card(db, name="P")
    child = await create_card(db, name="C", parent_id=primary.id)
    grandchild = await create_card(db, name="G", parent_id=child.id)
    peer = uuid.uuid4()
    descendants, related, full = await svc.resolve_archive_delete_set(
        db,
        primary,
        child_strategy="cascade",
        related_card_ids=[str(child.id), str(peer)],
        cascade_all_related=False,
    )
    assert descendants == [grandchild.id, child.id]
    assert related == [peer]
    assert full == [grandchild.id, child.id, peer]


async def test_cascade_all_related_adds_the_peers_it_was_not_given(db, env, monkeypatch):
    primary = await create_card(db, name="P")
    given, extra = uuid.uuid4(), uuid.uuid4()
    asked = []

    async def expand(db_, primary_id, read_scope):
        asked.append((primary_id, read_scope))
        return [primary_id, given, extra]

    monkeypatch.setattr(svc.card_lifecycle, "expand_cascade_all_related", expand)
    scope = object()
    result = await svc.resolve_archive_delete_set(
        db,
        primary,
        child_strategy=None,
        related_card_ids=[str(given)],
        cascade_all_related=True,
        read_scope=scope,
    )
    assert asked == [(primary.id, scope)]
    assert result == ([], [given, extra], [given, extra])


async def test_a_peer_reported_twice_is_taken_once(db, env, monkeypatch):
    primary = await create_card(db, name="P")
    peer = uuid.uuid4()

    async def expand(db_, primary_id, read_scope):
        return [peer, peer]

    monkeypatch.setattr(svc.card_lifecycle, "expand_cascade_all_related", expand)
    assert await svc.resolve_archive_delete_set(
        db, primary, child_strategy=None, related_card_ids=[], cascade_all_related=True
    ) == ([], [peer], [peer])


async def test_without_cascade_all_related_no_peers_are_looked_up(db, env, monkeypatch):
    async def expand(*a, **k):
        raise AssertionError("expanded")

    monkeypatch.setattr(svc.card_lifecycle, "expand_cascade_all_related", expand)
    primary = await create_card(db, name="P")
    assert await svc.resolve_archive_delete_set(
        db, primary, child_strategy=None, related_card_ids=[], cascade_all_related=False
    ) == ([], [], [])


async def test_cascade_all_related_reads_the_relations(db, env):
    primary = await create_card(db, name="P")
    itc = await create_card(db, card_type="ITComponent", name="S")
    await create_relation(db, source_id=primary.id, target_id=itc.id)
    assert await svc.resolve_archive_delete_set(
        db, primary, child_strategy=None, related_card_ids=[], cascade_all_related=True
    ) == ([], [itc.id], [itc.id])


# ── archive: the flip ───────────────────────────────────────────────────────


@pytest.fixture
def effects(monkeypatch):
    calls = []

    async def record(db, **kwargs):
        calls.append(kwargs)

    monkeypatch.setattr(svc.card_approval, "record_child_strategy_effects", record)
    return calls


async def archive(db, actor, primary, **kwargs):
    defaults = {
        "child_strategy": None,
        "descendants": [],
        "related_card_ids": [],
        "full_affected": [],
        "direct_children": [],
    }
    return await svc.archive_card_set(db, actor, primary, **{**defaults, **kwargs})


@pytest.mark.parametrize("strategy,new_parent", [("disconnect", None), ("reparent", "grand")])
async def test_children_are_moved_out_of_the_way(db, env, effects, strategy, new_parent):
    grand = await create_card(db, name="Grand")
    primary = await create_card(db, name="P", parent_id=grand.id)
    child = await create_card(db, name="C", parent_id=primary.id)
    tasks = BackgroundTasks()
    flipped, children, related = await archive(
        db,
        env["actor"],
        primary,
        child_strategy=strategy,
        direct_children=[child],
        background_tasks=tasks,
    )
    assert child.parent_id == (grand.id if new_parent else None)
    assert child.status == "ACTIVE"
    assert flipped == [primary] and children == [] and related == []
    (call,) = effects
    assert [r.strategy for r in call["results"]] == [strategy]
    assert call["results"][0].disconnected_ids == [child.id]
    assert call["actor_id"] == env["user"].id
    assert call["actor_display_name"] == "Wendy Writer"
    assert call["archived_ids"] == frozenset({primary.id})
    assert call["background_tasks"] is tasks


@pytest.mark.parametrize("strategy", ["cascade", None])
async def test_other_strategies_leave_the_children_in_place(db, env, effects, strategy):
    primary = await create_card(db, name="P")
    child = await create_card(db, name="C", parent_id=primary.id)
    await archive(db, env["actor"], primary, child_strategy=strategy, direct_children=[child])
    assert child.parent_id == primary.id
    assert effects[0]["results"] == []


async def test_no_listed_children_means_no_strategy_is_applied(db, env, effects):
    primary = await create_card(db, name="P")
    child = await create_card(db, name="C", parent_id=primary.id)
    await archive(db, env["actor"], primary, child_strategy="disconnect", direct_children=[])
    assert child.parent_id == primary.id
    assert effects[0]["results"] == []


async def test_each_active_related_card_loses_its_children_first(db, env, effects):
    primary = await create_card(db, name="P")
    related = await create_card(db, name="R")
    kid = await create_card(db, name="K", parent_id=related.id)
    shelved = await create_card(db, name="Shelved", status="ARCHIVED")
    shelved_kid = await create_card(db, name="SK", parent_id=shelved.id)
    missing = uuid.uuid4()
    flipped, _, affected_related = await archive(
        db,
        env["actor"],
        primary,
        related_card_ids=[related.id, shelved.id, missing],
        full_affected=[related.id, shelved.id, missing],
    )
    assert kid.parent_id is None
    assert shelved_kid.parent_id == shelved.id
    (call,) = effects
    assert [(r.strategy, r.disconnected_ids) for r in call["results"]] == [("disconnect", [kid.id])]
    assert {c.id for c in flipped} == {primary.id, related.id}
    assert affected_related == [related.id]
    assert call["archived_ids"] == frozenset({primary.id, related.id})


async def test_the_flip_archives_and_reports_what_it_took(db, env, effects, published):
    primary = await create_card(db, name="P")
    child = await create_card(db, name="C", parent_id=primary.id)
    already = await create_card(db, name="Gone", parent_id=primary.id, status="ARCHIVED")
    peer = await create_card(db, card_type="ITComponent", name="Peer")
    flipped, children, related = await archive(
        db,
        env["actor"],
        primary,
        child_strategy="cascade",
        descendants=[already.id, child.id],
        related_card_ids=[peer.id],
        full_affected=[already.id, child.id, peer.id],
    )
    assert {c.id for c in flipped} == {primary.id, child.id, peer.id}
    assert all(c.status == "ARCHIVED" and c.archived_at for c in flipped)
    assert children == [child.id]
    assert related == [peer.id]
    archived = sorted(
        (p for p in published if p["type"] == "card.archived"), key=lambda p: p["data"]["name"]
    )
    assert archived == [
        {
            "type": "card.archived",
            "data": {"id": str(c.id), "type": c.type, "name": c.name},
            "db": db,
            "card_id": c.id,
            "user_id": env["user"].id,
        }
        for c in (child, primary, peer)
    ]
    (batch,) = [p for p in published if p["type"] == "card.archived.batch"]
    assert batch == {
        "type": "card.archived.batch",
        "data": {
            "id": str(primary.id),
            "type": "Application",
            "name": "P",
            "child_strategy": "cascade",
            "affected_children_ids": [str(child.id)],
            "affected_related_card_ids": [str(peer.id)],
        },
        "db": db,
        "card_id": primary.id,
        "user_id": env["user"].id,
    }


@pytest.mark.parametrize("strategy", ["disconnect", "reparent"])
async def test_every_card_the_archive_touches_is_signed_by_the_actor(db, env, effects, strategy):
    primary = await create_card(db, name="P")
    child = await create_card(db, name="C", parent_id=primary.id)
    related = await create_card(db, name="R")
    kid = await create_card(db, name="K", parent_id=related.id)
    await archive(
        db,
        env["actor"],
        primary,
        child_strategy=strategy,
        direct_children=[child],
        related_card_ids=[related.id],
        full_affected=[related.id],
    )
    user_id = env["user"].id
    assert (primary.updated_by, related.updated_by) == (user_id, user_id)
    assert (child.updated_by, kid.updated_by) == (user_id, user_id)


async def test_the_archived_cards_come_back_with_tags_and_stakeholders(db, env, effects):
    primary = await create_card(db, name="P")
    group = TagGroup(name="Domain")
    db.add(group)
    await db.flush()
    tag = Tag(tag_group_id=group.id, name="Finance")
    db.add(tag)
    await db.flush()
    db.add(CardTag(card_id=primary.id, tag_id=tag.id))
    db.add(Stakeholder(card_id=primary.id, user_id=env["user"].id, role="owner"))
    await db.flush()
    (flipped,), _, _ = await archive(db, env["actor"], primary)
    assert [(t.name, t.group.name) for t in flipped.tags] == [("Finance", "Domain")]
    assert [(s.role, s.user.email) for s in flipped.stakeholders] == [("owner", "writer@test.com")]


async def test_a_lone_archive_sends_no_batch_event(db, env, effects, published):
    primary = await create_card(db, name="P")
    await archive(db, ext_actor(), primary)
    assert [p["type"] for p in published] == ["card.archived"]
    assert published[0]["data"]["ext"] == "sync"
    assert published[0]["user_id"] is None


async def test_an_extension_batch_event_is_stamped(db, env, effects, published):
    primary = await create_card(db, name="P")
    peer = await create_card(db, card_type="ITComponent", name="Peer")
    await archive(db, ext_actor(), primary, related_card_ids=[peer.id], full_affected=[peer.id])
    (batch,) = [p for p in published if p["type"] == "card.archived.batch"]
    assert batch["data"]["ext"] == "sync"
    assert batch["data"]["child_strategy"] is None


async def test_a_dry_run_archive_flips_but_stays_silent(db, env, effects, published):
    primary = await create_card(db, name="P")
    flipped, _, _ = await archive(db, env["actor"], primary, dry_run=True)
    assert flipped == [primary] and primary.status == "ARCHIVED"
    assert effects == [] and published == []


# ── relations ───────────────────────────────────────────────────────────────


async def test_relation_labels_come_from_the_type(db, env):
    assert await svc._resolve_relation_labels(db, "app_to_itc") == ("uses", "is used by")
    assert await svc._resolve_relation_labels(db, "unknown") == (None, None)


async def test_a_relation_event_goes_to_both_ends_in_their_own_words(db, env, published):
    app = await create_card(db, name="Billing")
    itc = await create_card(db, card_type="ITComponent", name="Server")
    rel = await create_relation(db, source_id=app.id, target_id=itc.id)
    actor = uuid.uuid4()
    await svc._emit_relation_events(
        db,
        event_type="relation.updated",
        rel=rel,
        source_card=app,
        target_card=itc,
        actor_id=actor,
        extra={"fields": ["description"]},
        ext_key="sync",
    )
    base = {
        "id": str(rel.id),
        "type": "app_to_itc",
        "relation_label": "uses",
        "relation_reverse_label": "is used by",
        "source_id": str(app.id),
        "target_id": str(itc.id),
        "source_name": "Billing",
        "target_name": "Server",
        "source_type": "Application",
        "target_type": "ITComponent",
        "ext": "sync",
        "fields": ["description"],
    }
    assert published == [
        {
            "type": "relation.updated",
            "data": {
                **base,
                "direction": "outgoing",
                "peer_id": str(itc.id),
                "peer_name": "Server",
                "peer_type": "ITComponent",
                "directional_label": "uses",
                "summary": "uses → Server",
            },
            "db": db,
            "card_id": app.id,
            "user_id": actor,
        },
        {
            "type": "relation.updated",
            "data": {
                **base,
                "direction": "incoming",
                "peer_id": str(app.id),
                "peer_name": "Billing",
                "peer_type": "Application",
                "directional_label": "is used by",
                "summary": "is used by ← Billing",
            },
            "db": db,
            "card_id": itc.id,
            "user_id": actor,
        },
    ]


async def test_a_relation_event_falls_back_to_keys_and_ids(db, env, published):
    rel = Relation(id=uuid.uuid4(), type="mystery", source_id=uuid.uuid4(), target_id=uuid.uuid4())
    await svc._emit_relation_events(
        db,
        event_type="relation.deleted",
        rel=rel,
        source_card=None,
        target_card=None,
        actor_id=None,
    )
    out, into = (p["data"] for p in published)
    assert out["relation_label"] is None and out["relation_reverse_label"] is None
    assert (out["source_name"], out["target_type"]) == (None, None)
    assert "ext" not in out and "fields" not in out
    assert (out["directional_label"], out["summary"]) == ("mystery", f"mystery → {rel.target_id}")
    assert (into["directional_label"], into["summary"]) == (
        "mystery",
        f"mystery ← {rel.source_id}",
    )


async def test_without_a_reverse_label_the_target_reads_the_forward_one(db, env, published):
    await create_relation_type(
        db, key="one_way", label="feeds", reverse_label=None, source_type_key="Application"
    )
    app = await create_card(db, name="A")
    itc = await create_card(db, card_type="ITComponent", name="I")
    rel = await create_relation(db, type_key="one_way", source_id=app.id, target_id=itc.id)
    await svc._emit_relation_events(
        db, event_type="relation.created", rel=rel, source_card=app, target_card=itc, actor_id=None
    )
    assert published[1]["data"]["directional_label"] == "feeds"
    assert published[1]["data"]["summary"] == "feeds ← A"


async def test_a_new_relation_is_created_and_announced(db, env, published):
    app = await create_card(db, name="Billing")
    itc = await create_card(db, card_type="ITComponent", name="Server")
    rel, reused, changed = await svc.upsert_relation(
        db,
        env["actor"],
        type_key="app_to_itc",
        source_id=app.id,
        target_id=itc.id,
        description="runs on",
    )
    assert (reused, changed) == (False, [])
    assert (rel.type, rel.source_id, rel.target_id) == ("app_to_itc", app.id, itc.id)
    assert (rel.attributes, rel.description) == ({}, "runs on")
    assert [(p["type"], p["data"]["direction"], p["card_id"]) for p in published] == [
        ("relation.created", "outgoing", app.id),
        ("relation.created", "incoming", itc.id),
    ]
    assert published[0]["user_id"] == env["user"].id
    assert "ext" not in published[0]["data"] and "fields" not in published[0]["data"]


async def test_a_relation_sent_backwards_is_stored_the_right_way_round(db, env, published):
    app = await create_card(db, name="Billing")
    itc = await create_card(db, card_type="ITComponent", name="Server")
    rel, _, _ = await svc.upsert_relation(
        db, ext_actor(), type_key="app_to_itc", source_id=itc.id, target_id=app.id
    )
    assert (rel.source_id, rel.target_id) == (app.id, itc.id)
    again, reused, changed = await svc.upsert_relation(
        db,
        ext_actor(),
        type_key="app_to_itc",
        source_id=itc.id,
        target_id=app.id,
        attributes={"k": 1},
    )
    assert again.id == rel.id and reused is True and changed == ["attributes"]
    assert published[0]["data"]["ext"] == "sync"
    assert published[-1]["data"]["fields"] == ["attributes"]


@pytest.mark.parametrize(
    "kwargs,changed",
    [
        ({"attributes": {"k": 2}, "description": "new"}, ["attributes", "description"]),
        ({"attributes": {"k": 2}}, ["attributes"]),
        ({"description": "new"}, ["description"]),
        ({"attributes": {"k": 1}, "description": "old"}, []),
        ({}, []),
        ({"attributes": None, "description": None}, []),
    ],
)
async def test_an_existing_relation_takes_only_what_changed(db, env, published, kwargs, changed):
    app = await create_card(db, name="Billing")
    itc = await create_card(db, card_type="ITComponent", name="Server")
    existing = await create_relation(db, source_id=app.id, target_id=itc.id, attributes={"k": 1})
    existing.description = "old"
    await db.flush()
    rel, reused, got = await svc.upsert_relation(
        db, env["actor"], type_key="app_to_itc", source_id=app.id, target_id=itc.id, **kwargs
    )
    assert rel.id == existing.id and reused is True and got == changed
    assert rel.attributes == (kwargs.get("attributes") or {"k": 1})
    assert rel.description == (kwargs.get("description") or "old")
    if changed:
        assert [p["type"] for p in published] == ["relation.updated", "relation.updated"]
        assert published[0]["data"]["fields"] == changed
    else:
        assert published == []


async def test_both_relation_events_carry_the_cards_and_the_actor(db, env, published):
    app = await create_card(db, name="Billing")
    itc = await create_card(db, card_type="ITComponent", name="Server")
    actor = ext_actor()
    await svc.upsert_relation(db, actor, type_key="app_to_itc", source_id=app.id, target_id=itc.id)
    await svc.upsert_relation(
        db, actor, type_key="app_to_itc", source_id=app.id, target_id=itc.id, description="d"
    )
    assert [p["type"] for p in published] == ["relation.created"] * 2 + ["relation.updated"] * 2
    for event in published:
        data = event["data"]
        assert (data["source_name"], data["target_name"]) == ("Billing", "Server")
        assert (data["source_type"], data["target_type"]) == ("Application", "ITComponent")
        assert data["ext"] == "sync"
        assert event["user_id"] is None
    user_actor = env["actor"]
    await svc.upsert_relation(
        db, user_actor, type_key="app_to_itc", source_id=app.id, target_id=itc.id, description="e"
    )
    assert {p["user_id"] for p in published[-2:]} == {env["user"].id}
    assert "ext" not in published[-1]["data"]


async def test_the_existing_row_must_match_type_source_and_target(db, env):
    await create_relation_type(db, key="app_hosts_itc", label="hosts", reverse_label="hosted by")
    app = await create_card(db, name="Billing")
    other_app = await create_card(db, name="Payroll")
    itc = await create_card(db, card_type="ITComponent", name="Server")
    other_itc = await create_card(db, card_type="ITComponent", name="Backup")
    taken = await create_relation(db, source_id=app.id, target_id=itc.id)
    for type_key, source, target in [
        ("app_hosts_itc", app, itc),  # same ends, another type
        ("app_to_itc", other_app, itc),  # same type and target, another source
        ("app_to_itc", app, other_itc),  # same type and source, another target
    ]:
        rel, reused, _ = await svc.upsert_relation(
            db, env["actor"], type_key=type_key, source_id=source.id, target_id=target.id
        )
        assert reused is False and rel.id != taken.id
        assert (rel.type, rel.source_id, rel.target_id) == (type_key, source.id, target.id)


async def test_clearing_relation_attributes_counts_as_a_change(db, env):
    app = await create_card(db, name="Billing")
    itc = await create_card(db, card_type="ITComponent", name="Server")
    await create_relation(db, source_id=app.id, target_id=itc.id, attributes={"k": 1})
    rel, _, changed = await svc.upsert_relation(
        db, env["actor"], type_key="app_to_itc", source_id=app.id, target_id=itc.id, attributes={}
    )
    assert changed == ["attributes"] and rel.attributes == {}


async def test_both_ends_are_recalculated_then_rescored(db, env, steps):
    app = await create_card(db, name="Billing")
    itc = await create_card(db, card_type="ITComponent", name="Server")
    await svc.upsert_relation(
        db, env["actor"], type_key="app_to_itc", source_id=app.id, target_id=itc.id
    )
    assert steps == [
        ("calc", app.id, None),
        ("score", app.id),
        ("calc", itc.id, None),
        ("score", itc.id),
    ]
    assert app.data_quality == itc.data_quality == 73.0


async def test_a_dry_run_relation_is_written_but_not_announced(db, env, published):
    app = await create_card(db, name="Billing")
    itc = await create_card(db, card_type="ITComponent", name="Server")
    rel, reused, _ = await svc.upsert_relation(
        db, env["actor"], type_key="app_to_itc", source_id=app.id, target_id=itc.id, dry_run=True
    )
    assert reused is False and rel.id is not None
    await svc.upsert_relation(
        db,
        env["actor"],
        type_key="app_to_itc",
        source_id=app.id,
        target_id=itc.id,
        description="x",
        dry_run=True,
    )
    assert published == []
