"""Integration tests for the BPMN element → EA relation sync service.

Tests sync_element_relations() — creating additive-only relations between
BusinessProcess cards and linked Application/DataObject/ITComponent/
Organization cards — and collect_effective_org_ids() (lane inheritance).
Requires a PostgreSQL test database.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import select

from app.models.relation import Relation
from app.services.element_relation_sync import (
    ELEMENT_LINK_RELATION_MAP,
    collect_effective_org_ids,
    sync_element_relations,
)
from tests.conftest import (
    create_card,
    create_card_type,
    create_relation_type,
    create_role,
    create_user,
)


async def _setup_types(db):
    """Create card types and relation types needed for element sync."""
    await create_role(db, key="admin", permissions={"*": True})
    user = await create_user(db, email="admin@test.com", role="admin")
    await create_card_type(db, key="BusinessProcess", label="Business Process")
    await create_card_type(db, key="Application", label="Application")
    await create_card_type(db, key="DataObject", label="Data Object")
    await create_card_type(db, key="ITComponent", label="IT Component")
    await create_card_type(db, key="Organization", label="Organization")

    await create_relation_type(
        db,
        key="relProcessToApp",
        label="Process to App",
        source_type_key="BusinessProcess",
        target_type_key="Application",
    )
    await create_relation_type(
        db,
        key="relProcessToDataObj",
        label="Process to Data Object",
        source_type_key="BusinessProcess",
        target_type_key="DataObject",
    )
    await create_relation_type(
        db,
        key="relProcessToITC",
        label="Process to IT Component",
        source_type_key="BusinessProcess",
        target_type_key="ITComponent",
    )
    await create_relation_type(
        db,
        key="relProcessToOrg",
        label="Process to Organization",
        source_type_key="BusinessProcess",
        target_type_key="Organization",
    )
    return user


# ---------------------------------------------------------------------------
# sync_element_relations
# ---------------------------------------------------------------------------


class TestSyncElementRelations:
    async def test_creates_single_application_relation(self, db):
        """Linking one application creates one relation."""
        user = await _setup_types(db)
        process = await create_card(
            db, card_type="BusinessProcess", name="Order Flow", user_id=user.id
        )
        app = await create_card(db, card_type="Application", name="CRM", user_id=user.id)

        count = await sync_element_relations(
            db,
            process_id=process.id,
            linked_ids={"application_id": {app.id}},
        )

        assert count == 1
        result = await db.execute(
            select(Relation).where(
                Relation.type == "relProcessToApp",
                Relation.source_id == process.id,
                Relation.target_id == app.id,
            )
        )
        assert result.scalar_one_or_none() is not None

    async def test_creates_multiple_relations(self, db):
        """Multiple linked cards create multiple relations."""
        user = await _setup_types(db)
        process = await create_card(db, card_type="BusinessProcess", name="Flow", user_id=user.id)
        app1 = await create_card(db, card_type="Application", name="App 1", user_id=user.id)
        app2 = await create_card(db, card_type="Application", name="App 2", user_id=user.id)

        count = await sync_element_relations(
            db,
            process_id=process.id,
            linked_ids={"application_id": {app1.id, app2.id}},
        )

        assert count == 2

    async def test_idempotent_no_duplicates(self, db):
        """Syncing the same links twice should not create duplicates."""
        user = await _setup_types(db)
        process = await create_card(db, card_type="BusinessProcess", name="Flow", user_id=user.id)
        app = await create_card(db, card_type="Application", name="CRM", user_id=user.id)

        linked = {"application_id": {app.id}}
        count1 = await sync_element_relations(db, process_id=process.id, linked_ids=linked)
        count2 = await sync_element_relations(db, process_id=process.id, linked_ids=linked)

        assert count1 == 1
        assert count2 == 0  # Already exists

        # Only one relation in DB
        result = await db.execute(
            select(Relation).where(
                Relation.type == "relProcessToApp",
                Relation.source_id == process.id,
            )
        )
        assert len(result.scalars().all()) == 1

    async def test_mixed_fields(self, db):
        """Multiple FK fields create relations of different types."""
        user = await _setup_types(db)
        process = await create_card(db, card_type="BusinessProcess", name="Flow", user_id=user.id)
        app = await create_card(db, card_type="Application", name="CRM", user_id=user.id)
        data = await create_card(db, card_type="DataObject", name="Customer", user_id=user.id)
        itc = await create_card(db, card_type="ITComponent", name="Server", user_id=user.id)
        org = await create_card(db, card_type="Organization", name="Sales", user_id=user.id)

        count = await sync_element_relations(
            db,
            process_id=process.id,
            linked_ids={
                "application_id": {app.id},
                "data_object_id": {data.id},
                "it_component_id": {itc.id},
                "organization_id": {org.id},
            },
        )

        assert count == 4

        # Check each relation type
        for rel_type in (
            "relProcessToApp",
            "relProcessToDataObj",
            "relProcessToITC",
            "relProcessToOrg",
        ):
            result = await db.execute(
                select(Relation).where(
                    Relation.type == rel_type,
                    Relation.source_id == process.id,
                )
            )
            assert result.scalar_one_or_none() is not None

    async def test_empty_linked_ids(self, db):
        """Empty linked_ids dict creates no relations."""
        user = await _setup_types(db)
        process = await create_card(db, card_type="BusinessProcess", name="Flow", user_id=user.id)

        count = await sync_element_relations(
            db,
            process_id=process.id,
            linked_ids={},
        )

        assert count == 0

    async def test_empty_target_set(self, db):
        """Empty set for a field creates no relations."""
        user = await _setup_types(db)
        process = await create_card(db, card_type="BusinessProcess", name="Flow", user_id=user.id)

        count = await sync_element_relations(
            db,
            process_id=process.id,
            linked_ids={"application_id": set()},
        )

        assert count == 0

    async def test_unknown_field_key_ignored(self, db):
        """Unknown field key (not in ELEMENT_LINK_RELATION_MAP) is ignored."""
        user = await _setup_types(db)
        process = await create_card(db, card_type="BusinessProcess", name="Flow", user_id=user.id)

        count = await sync_element_relations(
            db,
            process_id=process.id,
            linked_ids={"unknown_field": {uuid.uuid4()}},
        )

        assert count == 0

    async def test_relation_description_set(self, db):
        """Auto-created relations should have the descriptive auto-created text."""
        user = await _setup_types(db)
        process = await create_card(db, card_type="BusinessProcess", name="Flow", user_id=user.id)
        app = await create_card(db, card_type="Application", name="CRM", user_id=user.id)

        await sync_element_relations(
            db,
            process_id=process.id,
            linked_ids={"application_id": {app.id}},
        )

        result = await db.execute(
            select(Relation).where(
                Relation.source_id == process.id,
                Relation.target_id == app.id,
            )
        )
        rel = result.scalar_one()
        assert "Auto-created" in rel.description

    async def test_element_link_relation_map_correct(self):
        """Verify the mapping dict has expected entries."""
        assert ELEMENT_LINK_RELATION_MAP == {
            "application_id": "relProcessToApp",
            "data_object_id": "relProcessToDataObj",
            "it_component_id": "relProcessToITC",
            "organization_id": "relProcessToOrg",
        }

    async def test_lane_inherited_org_relation_created(self, db):
        """Effective (lane-inherited) org ids sync to relProcessToOrg relations."""
        user = await _setup_types(db)
        process = await create_card(db, card_type="BusinessProcess", name="Flow", user_id=user.id)
        org = await create_card(db, card_type="Organization", name="Sales", user_id=user.id)

        elements = [_Elem(organization_id=None, lane_name="Sales Lane")]
        org_ids = collect_effective_org_ids(elements, {"Sales Lane": str(org.id)})
        count = await sync_element_relations(
            db, process_id=process.id, linked_ids={"organization_id": org_ids}
        )

        assert count == 1
        result = await db.execute(
            select(Relation).where(
                Relation.type == "relProcessToOrg",
                Relation.source_id == process.id,
                Relation.target_id == org.id,
            )
        )
        assert result.scalar_one_or_none() is not None

    async def test_additive_only_does_not_delete(self, db):
        """Sync is additive — removing a card from linked_ids does not delete."""
        user = await _setup_types(db)
        process = await create_card(db, card_type="BusinessProcess", name="Flow", user_id=user.id)
        app1 = await create_card(db, card_type="Application", name="App 1", user_id=user.id)
        app2 = await create_card(db, card_type="Application", name="App 2", user_id=user.id)

        # First sync with both apps
        await sync_element_relations(
            db,
            process_id=process.id,
            linked_ids={"application_id": {app1.id, app2.id}},
        )

        # Second sync with only app1 (app2 removed)
        count = await sync_element_relations(
            db,
            process_id=process.id,
            linked_ids={"application_id": {app1.id}},
        )

        assert count == 0  # No new relations

        # Both relations should still exist (additive only)
        result = await db.execute(
            select(Relation).where(
                Relation.type == "relProcessToApp",
                Relation.source_id == process.id,
            )
        )
        assert len(result.scalars().all()) == 2


# ---------------------------------------------------------------------------
# collect_effective_org_ids (pure logic — no database needed)
# ---------------------------------------------------------------------------


@dataclass
class _Elem:
    """Duck-typed stand-in for a ProcessElement row."""

    organization_id: uuid.UUID | None = None
    lane_name: str | None = None


class TestCollectEffectiveOrgIds:
    def test_explicit_override_wins_over_lane(self):
        explicit = uuid.uuid4()
        lane_org = uuid.uuid4()
        elements = [_Elem(organization_id=explicit, lane_name="Sales")]

        result = collect_effective_org_ids(elements, {"Sales": lane_org})

        assert result == {explicit}

    def test_lane_binding_inherited_when_no_override(self):
        lane_org = uuid.uuid4()
        elements = [_Elem(lane_name="Sales"), _Elem(lane_name="Sales")]

        result = collect_effective_org_ids(elements, {"Sales": lane_org})

        assert result == {lane_org}

    def test_element_without_lane_or_override_contributes_nothing(self):
        elements = [_Elem(), _Elem(lane_name="Unbound Lane")]

        result = collect_effective_org_ids(elements, {"Other Lane": uuid.uuid4()})

        assert result == set()

    def test_string_org_ids_are_normalized_to_uuid(self):
        lane_org = uuid.uuid4()
        elements = [_Elem(lane_name="Sales")]

        result = collect_effective_org_ids(elements, {"Sales": str(lane_org)})

        assert result == {lane_org}

    def test_mixed_lanes_and_overrides(self):
        explicit = uuid.uuid4()
        sales_org = uuid.uuid4()
        finance_org = uuid.uuid4()
        elements = [
            _Elem(lane_name="Sales"),
            _Elem(lane_name="Finance"),
            _Elem(organization_id=explicit, lane_name="Finance"),
        ]

        result = collect_effective_org_ids(elements, {"Sales": sales_org, "Finance": finance_org})

        assert result == {sales_org, finance_org, explicit}

    def test_empty_or_none_lane_links(self):
        elements = [_Elem(lane_name="Sales")]

        assert collect_effective_org_ids(elements, {}) == set()
        assert collect_effective_org_ids(elements, {"Sales": None}) == set()
        assert collect_effective_org_ids([], {"Sales": uuid.uuid4()}) == set()
