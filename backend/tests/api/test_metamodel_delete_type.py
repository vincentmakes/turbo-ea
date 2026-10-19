"""Permanent deletion of a custom card type (``DELETE /metamodel/types/{key}``).

A custom type can be removed with everything that hangs off it once the caller
opts in with ``delete_cards=true``; a built-in type is only ever hidden. The
``delete-impact`` read is what the confirmation dialog shows first.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select

from app.core.permissions import VIEWER_PERMISSIONS
from app.models.calculation import Calculation
from app.models.card import Card
from app.models.card_type import CardType
from app.models.event import Event
from app.models.relation import Relation
from app.models.relation_type import RelationType
from app.models.stakeholder_role_definition import StakeholderRoleDefinition
from app.services.card_type_delete import delete_type_dependents, leaves_first
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

TYPE = "Gadget"


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    await create_role(db, key="viewer", label="Viewer", permissions=VIEWER_PERMISSIONS)
    # Holds the metamodel but not the inventory delete.
    await create_role(
        db,
        key="modeller",
        label="Modeller",
        permissions={"admin.metamodel": True, "inventory.view": True},
    )
    admin = await create_user(db, email="admin@test.com", role="admin")
    viewer = await create_user(db, email="viewer@test.com", role="viewer")
    modeller = await create_user(db, email="modeller@test.com", role="modeller")
    return {"admin": admin, "viewer": viewer, "modeller": modeller}


async def _landscape(db):
    """A custom type with a hierarchy, an archived card, two relation types
    (one to Application, one self-referencing), a calculation and a role —
    plus an Application that must survive the deletion."""
    await create_card_type(db, key=TYPE, label="Gadget", built_in=False, has_hierarchy=True)
    await create_card_type(db, key="Application", label="Application", built_in=True)
    root = await create_card(db, card_type=TYPE, name="Root gadget")
    child = await create_card(db, card_type=TYPE, name="Child gadget", parent_id=root.id)
    grandchild = await create_card(db, card_type=TYPE, name="Grandchild", parent_id=child.id)
    archived = await create_card(db, card_type=TYPE, name="Old gadget", status="ARCHIVED")
    app = await create_card(db, card_type="Application", name="App")
    app2 = await create_card(db, card_type="Application", name="Other app")
    # sort_order runs against insertion order so the impact's ordering is observable.
    await create_relation_type(
        db,
        key="relGadgetToApp",
        label="powers",
        source_type_key=TYPE,
        target_type_key="Application",
        sort_order=2,
    )
    await create_relation_type(
        db,
        key="relGadgetSelf",
        label="feeds",
        source_type_key=TYPE,
        target_type_key=TYPE,
        sort_order=1,
    )
    # The type at the TARGET end only, with no rows: touched all the same.
    await create_relation_type(
        db,
        key="relAppToGadget",
        label="configures",
        source_type_key="Application",
        target_type_key=TYPE,
        sort_order=0,
    )
    await create_relation_type(
        db,
        key="relAppSelf",
        label="calls",
        source_type_key="Application",
        target_type_key="Application",
    )
    await create_relation(db, type_key="relGadgetToApp", source_id=root.id, target_id=app.id)
    await create_relation(db, type_key="relGadgetToApp", source_id=child.id, target_id=app.id)
    await create_relation(db, type_key="relGadgetSelf", source_id=root.id, target_id=grandchild.id)
    # A row of a relation type that never touches the deleted type must survive.
    await create_relation(db, type_key="relAppSelf", source_id=app.id, target_id=app2.id)
    db.add(
        Calculation(
            name="Gadget score",
            target_type_key=TYPE,
            target_field_key="score",
            formula="1",
        )
    )
    # Two of each on the other type, so "everything but this type" never counts the same.
    for name in ("App score", "App health"):
        db.add(
            Calculation(
                name=name,
                target_type_key="Application",
                target_field_key="score",
                formula="1",
            )
        )
    await create_stakeholder_role_def(db, card_type_key=TYPE, key="keeper", label="Keeper")
    await create_stakeholder_role_def(db, card_type_key="Application", key="owner", label="Owner")
    await create_stakeholder_role_def(db, card_type_key="Application", key="deputy", label="Deputy")
    await db.flush()
    return {
        "root": root,
        "child": child,
        "grandchild": grandchild,
        "archived": archived,
        "app": app,
        "app2": app2,
    }


async def _count(db, model, *where):
    return (await db.execute(select(model).where(*where))).scalars().all()


class TestDeleteImpact:
    async def test_counts_everything_the_delete_would_take(self, client, db, env):
        await _landscape(db)
        resp = await client.get(
            f"/api/v1/metamodel/types/{TYPE}/delete-impact", headers=auth_headers(env["admin"])
        )
        assert resp.status_code == 200, resp.text
        assert resp.json() == {
            "key": TYPE,
            "label": "Gadget",
            "built_in": False,
            "card_count": 4,
            "active_card_count": 3,
            "archived_card_count": 1,
            "relation_count": 3,
            "relation_types": [
                {"key": "relAppToGadget", "label": "configures", "relation_count": 0},
                {"key": "relGadgetSelf", "label": "feeds", "relation_count": 1},
                {"key": "relGadgetToApp", "label": "powers", "relation_count": 2},
            ],
            "calculation_count": 1,
            "stakeholder_role_count": 1,
        }

    async def test_a_type_nothing_depends_on_reports_zeros(self, client, db, env):
        await create_card_type(db, key="Lonely", label="Lonely", built_in=False)
        resp = await client.get(
            "/api/v1/metamodel/types/Lonely/delete-impact", headers=auth_headers(env["admin"])
        )
        body = resp.json()
        assert body["card_count"] == 0
        assert body["relation_types"] == []
        assert body["relation_count"] == 0
        assert body["calculation_count"] == 0
        assert body["stakeholder_role_count"] == 0

    async def test_reports_a_built_in_type_as_such(self, client, db, env):
        await create_card_type(db, key="Application", label="Application", built_in=True)
        resp = await client.get(
            "/api/v1/metamodel/types/Application/delete-impact", headers=auth_headers(env["admin"])
        )
        assert resp.json()["built_in"] is True

    async def test_requires_the_metamodel_permission(self, client, db, env):
        await create_card_type(db, key=TYPE, label="Gadget", built_in=False)
        resp = await client.get(
            f"/api/v1/metamodel/types/{TYPE}/delete-impact", headers=auth_headers(env["viewer"])
        )
        assert resp.status_code == 403

    async def test_unknown_type_is_404(self, client, db, env):
        resp = await client.get(
            "/api/v1/metamodel/types/Nope/delete-impact", headers=auth_headers(env["admin"])
        )
        assert resp.status_code == 404


class TestDeleteCustomType:
    async def test_refuses_a_type_with_cards_unless_asked_to_delete_them(self, client, db, env):
        await _landscape(db)
        resp = await client.delete(
            f"/api/v1/metamodel/types/{TYPE}", headers=auth_headers(env["admin"])
        )
        assert resp.status_code == 409
        detail = resp.json()["detail"]
        assert detail["error"] == "cards_present"
        assert detail["card_count"] == 4
        assert detail["key"] == TYPE
        # Nothing was touched.
        assert len(await _count(db, Card, Card.type == TYPE)) == 4
        assert len(await _count(db, CardType, CardType.key == TYPE)) == 1
        assert len(await _count(db, RelationType, RelationType.key == "relGadgetToApp")) == 1

    async def test_deletes_the_type_with_everything_that_hangs_off_it(self, client, db, env):
        cards = await _landscape(db)
        resp = await client.delete(
            f"/api/v1/metamodel/types/{TYPE}?delete_cards=true", headers=auth_headers(env["admin"])
        )
        assert resp.status_code == 200, resp.text
        assert resp.json() == {
            "status": "deleted",
            "key": TYPE,
            "cards_removed": 4,
            "relations_removed": 3,
            "relation_types_removed": ["relAppToGadget", "relGadgetSelf", "relGadgetToApp"],
            "calculations_removed": 1,
            "stakeholder_roles_removed": 1,
        }

        assert await _count(db, CardType, CardType.key == TYPE) == []
        assert await _count(db, Card, Card.type == TYPE) == []
        gone = ["relGadgetToApp", "relGadgetSelf", "relAppToGadget"]
        assert await _count(db, Relation, Relation.type.in_(gone)) == []
        assert await _count(db, RelationType, RelationType.key.in_(gone)) == []
        assert await _count(db, Calculation, Calculation.target_type_key == TYPE) == []
        assert (
            await _count(
                db, StakeholderRoleDefinition, StakeholderRoleDefinition.card_type_key == TYPE
            )
            == []
        )

        # The other type keeps everything of its own.
        assert len(await _count(db, Card, Card.id == cards["app"].id)) == 1
        assert len(await _count(db, RelationType, RelationType.key == "relAppSelf")) == 1
        assert len(await _count(db, Relation, Relation.type == "relAppSelf")) == 1
        assert len(await _count(db, Calculation, Calculation.target_type_key == "Application")) == 2
        assert (
            len(
                await _count(
                    db,
                    StakeholderRoleDefinition,
                    StakeholderRoleDefinition.card_type_key == "Application",
                )
            )
            == 2
        )

        # Every deleted card is on record, archived one included, by id and name.
        events = await _count(db, Event, Event.event_type == "card.deleted")
        names = sorted(e.data["name"] for e in events)
        assert names == ["Child gadget", "Grandchild", "Old gadget", "Root gadget"]
        assert {e.data["id"] for e in events} == {
            str(cards[k].id) for k in ("root", "child", "grandchild", "archived")
        }
        assert {e.data["type"] for e in events} == {TYPE}
        assert {e.user_id for e in events} == {env["admin"].id}

    async def test_the_service_returns_what_was_there_before(self, db, env):
        """`delete_type_dependents` reports the pre-deletion counts, not the empty after."""
        await _landscape(db)
        [t] = await _count(db, CardType, CardType.key == TYPE)
        impact = await delete_type_dependents(db, t, actor_id=env["admin"].id)
        assert (impact.card_count, impact.relation_count) == (4, 3)
        assert [rt.key for rt in impact.relation_types] == [
            "relAppToGadget",
            "relGadgetSelf",
            "relGadgetToApp",
        ]
        assert await _count(db, Card, Card.type == TYPE) == []

    async def test_the_type_is_gone_from_the_list(self, client, db, env):
        await _landscape(db)
        headers = auth_headers(env["admin"])
        await client.delete(f"/api/v1/metamodel/types/{TYPE}?delete_cards=true", headers=headers)
        resp = await client.get("/api/v1/metamodel/types?include_hidden=true", headers=headers)
        assert TYPE not in [t["key"] for t in resp.json()]

    async def test_a_type_without_cards_needs_no_flag(self, client, db, env):
        await create_card_type(db, key="Lonely", label="Lonely", built_in=False)
        resp = await client.delete(
            "/api/v1/metamodel/types/Lonely", headers=auth_headers(env["admin"])
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "deleted"
        assert resp.json()["cards_removed"] == 0
        assert await _count(db, CardType, CardType.key == "Lonely") == []

    async def test_deleting_cards_needs_the_inventory_delete_permission(self, client, db, env):
        await _landscape(db)
        resp = await client.delete(
            f"/api/v1/metamodel/types/{TYPE}?delete_cards=true",
            headers=auth_headers(env["modeller"]),
        )
        assert resp.status_code == 403
        assert len(await _count(db, Card, Card.type == TYPE)) == 4
        assert len(await _count(db, CardType, CardType.key == TYPE)) == 1

    async def test_the_metamodel_permission_alone_still_deletes_an_empty_type(
        self, client, db, env
    ):
        await create_card_type(db, key="Lonely", label="Lonely", built_in=False)
        resp = await client.delete(
            "/api/v1/metamodel/types/Lonely", headers=auth_headers(env["modeller"])
        )
        assert resp.status_code == 200

    async def test_built_in_type_is_hidden_even_when_asked_to_delete_cards(self, client, db, env):
        await create_card_type(db, key="Application", label="Application", built_in=True)
        app = await create_card(db, card_type="Application", name="App")
        resp = await client.delete(
            "/api/v1/metamodel/types/Application?delete_cards=true",
            headers=auth_headers(env["admin"]),
        )
        assert resp.status_code == 200
        assert resp.json() == {"status": "hidden", "key": "Application", "instance_count": 1}
        assert len(await _count(db, Card, Card.id == app.id)) == 1
        [t] = await _count(db, CardType, CardType.key == "Application")
        assert t.is_hidden is True

    async def test_viewer_cannot_delete(self, client, db, env):
        await create_card_type(db, key="Lonely", label="Lonely", built_in=False)
        resp = await client.delete(
            "/api/v1/metamodel/types/Lonely?delete_cards=true", headers=auth_headers(env["viewer"])
        )
        assert resp.status_code == 403
        assert len(await _count(db, CardType, CardType.key == "Lonely")) == 1

    async def test_audit_entry_names_what_was_removed(self, client, db, env):
        from app.models.audit_log import AuditLogEntry

        await _landscape(db)
        await client.delete(
            f"/api/v1/metamodel/types/{TYPE}?delete_cards=true", headers=auth_headers(env["admin"])
        )
        await db.rollback()
        rows = (
            (
                await db.execute(
                    select(AuditLogEntry).where(
                        AuditLogEntry.action == "admin.metamodel.type.deleted"
                    )
                )
            )
            .scalars()
            .all()
        )
        [row] = rows
        assert row.details == {
            "context": {
                "mode": "deleted",
                "card_count": 4,
                "relation_count": 3,
                "relation_types_removed": ["configures", "feeds", "powers"],
                "calculation_count": 1,
                "stakeholder_role_count": 1,
            }
        }


class TestLeavesFirst:
    """The pure ordering the deletion relies on."""

    class _C:
        def __init__(self, id, parent_id=None):
            self.id = id
            self.parent_id = parent_id

    def test_children_come_before_their_parents(self):
        root, child, grandchild = self._C(1), self._C(2, 1), self._C(3, 2)
        ordered = leaves_first([root, child, grandchild])
        assert [c.id for c in ordered] == [3, 2, 1]

    def test_a_parent_outside_the_set_makes_a_root(self):
        orphan, child = self._C(2, 99), self._C(3, 2)
        assert [c.id for c in leaves_first([orphan, child])] == [3, 2]

    def test_ties_keep_input_order(self):
        a, b, c = self._C(1), self._C(2), self._C(3)
        assert [x.id for x in leaves_first([a, b, c])] == [1, 2, 3]

    def test_a_cycle_does_not_recurse_forever(self):
        a, b = self._C(1, 2), self._C(2, 1)
        assert sorted(x.id for x in leaves_first([a, b])) == [1, 2]
