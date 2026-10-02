"""The migration staging and apply pipelines, driven end to end with an
in-memory source (``tests/migration_helpers.py``) — no workbook, no disk.

Staging: identity resolution, type / relation mapping, diffs and the
conflict rows the preview shows. Apply: every pass in dependency order,
the identity map, idempotent re-imports and per-row error isolation.
"""

from __future__ import annotations

import hashlib
import uuid

import pytest
from sqlalchemy import select

from app.models.card import Card
from app.models.card_type import CardType
from app.models.comment import Comment
from app.models.document import Document
from app.models.event import Event
from app.models.migration import IdentityMap, StagedRecord
from app.models.relation import Relation as RelationModel
from app.models.relation_type import RelationType
from app.models.stakeholder import Stakeholder
from app.models.tag import CardTag, Tag, TagGroup
from app.models.user import User
from app.services.migration.apply import apply_migration
from app.services.migration.snapshot import (
    Comment as SnapComment,
)
from app.services.migration.snapshot import (
    Document as SnapDocument,
)
from app.services.migration.snapshot import (
    MetamodelField,
    MetamodelRelationType,
    MetamodelType,
    Relation,
    SourceEntity,
    Subscription,
    UserRef,
)
from app.services.migration.snapshot import (
    Tag as SnapTag,
)
from app.services.migration.staging import (
    stage_cards,
    stage_comments,
    stage_documents,
    stage_metamodel,
    stage_relations,
    stage_tags,
    stage_users_and_subscriptions,
)
from tests.conftest import create_card, create_role, create_user
from tests.migration_helpers import (
    InMemorySource,
    empty_snapshot,
    make_migration,
    migration_metamodel,
    sample_snapshot,
    stage_all,
    staged_rows,
)

BUILTIN_TYPES = ("Application", "BusinessCapability", "BusinessProcess", "Organization")
BUILTIN_RELS = ("relAppToBC", "relAppSuccessor", "relProcessToApp", "relOrgToApp")
FIELD_TYPES = {
    "COST": "cost",
    "SINGLE_SELECT": "single_select",
    "MULTIPLE_SELECT": "multiple_select",
    "TEXT": "text",
    "DATE": "date",
}
ZERO = "00000000-0000-0000-0000-000000000000"
EMPTY = {"created": 0, "updated": 0, "skipped": 0, "errors": 0, "conflicts": 0}


def source_for(snapshot, **kw) -> InMemorySource:
    """The sample snapshot's source: the four built-in types and relation
    types map onto themselves; ``Server`` / ``relServerToApp`` are left to
    the metamodel passes to synthesise."""
    kw.setdefault("type_mapping", {k: k for k in BUILTIN_TYPES})
    kw.setdefault("relation_mapping", {k: k for k in BUILTIN_RELS})
    kw.setdefault("field_type_mapping", FIELD_TYPES)
    return InMemorySource(snapshot, **kw)


@pytest.fixture
async def env(db):
    await create_role(db, key="admin", label="Admin", permissions={"*": True})
    # The user pass creates ``member`` accounts.
    await create_role(db, key="member", label="Member", permissions={})
    admin = await create_user(db, email="admin@test.com", role="admin")
    mm = await migration_metamodel(db)
    return {"admin": admin, **mm}


async def _migration(db, env, **kw):
    return await make_migration(db, user=env["admin"], **kw)


async def _one(db, model, **where):
    stmt = select(model)
    for k, v in where.items():
        stmt = stmt.where(getattr(model, k) == v)
    return (await db.execute(stmt)).scalar_one_or_none()


async def _all(db, model, **where):
    stmt = select(model)
    for k, v in where.items():
        stmt = stmt.where(getattr(model, k) == v)
    return (await db.execute(stmt)).scalars().all()


def _identity(source_id: str, target_id) -> IdentityMap:
    return IdentityMap(
        source_id=source_id, source_type="inmem", entity_kind="card", target_id=target_id
    )


async def _staged_sample(db, env, snap=None, **source_kw):
    snap = snap if snap is not None else sample_snapshot()
    m = await _migration(db, env)
    src = source_for(snap, **source_kw)
    await stage_all(db, m, src, snap)
    return m, snap, src


# ---------------------------------------------------------------------------
# Staging
# ---------------------------------------------------------------------------


class TestStageCards:
    async def test_every_mapped_entity_is_staged_as_a_create(self, db, env):
        snap = sample_snapshot()
        m = await _migration(db, env)
        src = source_for(snap)
        await stage_metamodel(db, m, src, snap)
        stats = await stage_cards(db, m, src, snap)
        assert stats == {
            "create": 7,
            "update": 0,
            "skip": 0,
            "conflict": 0,
            "unknown_type": 0,
            "archived": 0,
        }
        rows = {r.source_id: r for r in await staged_rows(db, m, "card")}
        assert rows["srv-1"].card_type_key == "Server"  # synthesised by the metamodel pass
        assert rows["bc-2"].parent_source_id == "bc-1"
        payload = rows["app-1"].source_data["payload"]
        assert payload["subtype"] == "businessApplication"
        assert payload["external_id"] == "app-1" and payload["status"] == "ACTIVE"
        assert payload["attributes"]["costTotalAnnual"] == 1200.5
        assert rows["app-1"].source_data["raw"]["type"] == "Application"
        assert all(r.status == "pending" for r in rows.values())

    async def test_an_unmapped_type_with_no_metamodel_entry_is_a_conflict(self, db, env):
        snap = empty_snapshot()
        snap.entities.append(SourceEntity("w-1", "Widget", "Gizmo"))
        m = await _migration(db, env)
        stats = await stage_cards(db, m, source_for(snap), snap)
        assert stats["unknown_type"] == 1 and stats["create"] == 0
        (row,) = await staged_rows(db, m, "card")
        assert row.action == "conflict" and row.card_type_key is None
        assert row.diff["reason"] == "Unmapped In-memory source type 'Widget'"

    async def test_archived_entities_are_skipped_unless_opted_in(self, db, env):
        snap = empty_snapshot()
        snap.entities.append(SourceEntity("old-1", "Application", "Retired", status="ARCHIVED"))
        m = await _migration(db, env)
        src = source_for(snap)
        assert (await stage_cards(db, m, src, snap))["archived"] == 1
        assert await staged_rows(db, m, "card") == []

        stats = await stage_cards(db, m, src, snap, include_archived=True)
        assert stats["create"] == 1 and stats["archived"] == 0
        (row,) = await staged_rows(db, m, "card")
        assert row.source_data["payload"]["status"] == "ARCHIVED"

    async def test_a_card_with_the_external_id_is_an_update_with_a_diff(self, db, env):
        existing = await create_card(
            db, card_type="Application", name="Old name", user_id=env["admin"].id
        )
        existing.external_id = "app-1"
        existing.description = "CRM"
        await db.flush()
        snap = sample_snapshot()
        m = await _migration(db, env)
        stats = await stage_cards(db, m, source_for(snap), snap)
        assert stats["update"] == 1 and stats["create"] == 6
        row = next(r for r in await staged_rows(db, m, "card") if r.source_id == "app-1")
        assert row.action == "update" and row.target_id == existing.id
        assert row.diff["name"] == {"old": "Old name", "new": "Salesforce"}
        assert "description" not in row.diff  # unchanged fields are not in the diff
        assert row.diff["attributes"]["costTotalAnnual"] == {"old": None, "new": 1200.5}
        assert row.diff["lifecycle"]["new"] == {"plan": "2019-01-01", "active": "2020-01-01"}

    async def test_an_identical_card_is_a_skip(self, db, env):
        snap = empty_snapshot()
        snap.entities.append(
            SourceEntity(
                "app-9",
                "Application",
                "Same",
                description="d",
                lifecycle={"active": "2020-01-01"},
                custom_fields={"k": "v"},
            )
        )
        card = await create_card(db, card_type="Application", name="Same", user_id=env["admin"].id)
        card.external_id = "app-9"
        card.description = "d"
        card.lifecycle = {"active": "2020-01-01"}
        card.attributes = {"k": "v", "extra": 1}  # extra local keys do not count as a diff
        await db.flush()
        m = await _migration(db, env)
        stats = await stage_cards(db, m, source_for(snap), snap)
        assert stats["skip"] == 1 and stats["update"] == 0
        (row,) = await staged_rows(db, m, "card")
        assert row.action == "skip" and row.target_id == card.id and row.diff == {}

    async def test_the_identity_map_wins_over_the_external_id(self, db, env):
        by_map = await create_card(
            db, card_type="Application", name="Mapped", user_id=env["admin"].id
        )
        by_ext = await create_card(
            db, card_type="Application", name="By id", user_id=env["admin"].id
        )
        by_ext.external_id = "app-1"
        db.add(_identity("app-1", by_map.id))
        await db.flush()
        snap = sample_snapshot()
        m = await _migration(db, env)
        await stage_cards(db, m, source_for(snap), snap)
        row = next(r for r in await staged_rows(db, m, "card") if r.source_id == "app-1")
        assert row.target_id == by_map.id

    async def test_a_dangling_identity_map_row_is_dropped(self, db, env):
        db.add(_identity("app-1", uuid.uuid4()))
        await db.flush()
        snap = sample_snapshot()
        m = await _migration(db, env)
        stats = await stage_cards(db, m, source_for(snap), snap)
        assert stats["create"] == 7
        assert await _one(db, IdentityMap, source_id="app-1") is None

    async def test_name_and_type_is_the_last_resort(self, db, env):
        same = await create_card(
            db, card_type="Application", name="Salesforce", user_id=env["admin"].id
        )
        await create_card(db, card_type="Organization", name="Salesforce", user_id=env["admin"].id)
        snap = sample_snapshot()
        m = await _migration(db, env)
        await stage_cards(db, m, source_for(snap), snap)
        row = next(r for r in await staged_rows(db, m, "card") if r.source_id == "app-1")
        assert row.action == "update" and row.target_id == same.id

    async def test_restaging_replaces_the_rows(self, db, env):
        snap = sample_snapshot()
        m = await _migration(db, env)
        src = source_for(snap)
        await stage_metamodel(db, m, src, snap)
        await stage_cards(db, m, src, snap)
        first = {r.id for r in await staged_rows(db, m, "card")}
        await stage_cards(db, m, src, snap)
        second = {r.id for r in await staged_rows(db, m, "card")}
        assert len(second) == 7 and first.isdisjoint(second)


class TestStageRelations:
    async def _staged(self, db, env, snap, **kw):
        m = await _migration(db, env)
        src = source_for(snap, **kw)
        await stage_metamodel(db, m, src, snap)
        await stage_cards(db, m, src, snap)
        stats = await stage_relations(db, m, src, snap)
        return m, stats, {r.source_id: r for r in await staged_rows(db, m, "relation")}

    async def test_every_relation_resolves_against_the_staged_cards(self, db, env):
        _, stats, rows = await self._staged(db, env, sample_snapshot())
        assert stats == {"create": 5, "update": 0, "skip": 0, "conflict": 1, "unknown_type": 0}
        rel = rows["rel-4"]
        assert rel.action == "create" and rel.card_type_key == "relOrgToApp"
        assert rel.source_data["tea_source_card_id"] == ZERO  # the card lands at apply time
        assert rel.source_data["attributes"] == {"usageType": "owner"}
        assert rows["rel-5"].card_type_key == "relServerToApp"  # synthesised relation type
        dangling = rows["rel-6"]
        assert dangling.action == "conflict"
        assert dangling.diff["reason"] == "Endpoint not staged: target=missing"
        assert dangling.source_data["tea_type"] == "relAppToBC"

    async def test_an_unmapped_relation_type_is_a_conflict(self, db, env):
        snap = sample_snapshot()
        snap.relations.append(Relation("rel-x", "relMystery", "app-1", "bc-1"))
        _, stats, rows = await self._staged(db, env, snap)
        assert stats["unknown_type"] == 1
        assert rows["rel-x"].action == "conflict"
        assert rows["rel-x"].diff["reason"] == (
            "Unmapped In-memory source relation type 'relMystery'"
        )

    async def test_flip_direction_swaps_the_endpoints(self, db, env):
        _, _, rows = await self._staged(
            db, env, sample_snapshot(), flip_direction=frozenset({"relAppSuccessor"})
        )
        data = rows["rel-2"].source_data
        assert (data["from_entity_id"], data["to_entity_id"]) == ("app-1", "app-2")

    async def test_hierarchy_relations_are_never_staged(self, db, env):
        _, stats, rows = await self._staged(
            db, env, sample_snapshot(), hierarchy_relations=frozenset({"relAppToBC"})
        )
        assert "rel-1" not in rows and "rel-6" not in rows
        assert stats["create"] == 4 and stats["conflict"] == 0

    async def test_an_existing_relation_is_a_skip_or_an_attribute_update(self, db, env):
        app = await create_card(
            db, card_type="Application", name="Salesforce", user_id=env["admin"].id
        )
        org = await create_card(
            db, card_type="Organization", name="Sales EMEA", user_id=env["admin"].id
        )
        db.add(_identity("app-1", app.id))
        db.add(_identity("org-1", org.id))
        db.add(
            RelationModel(
                type="relOrgToApp",
                source_id=org.id,
                target_id=app.id,
                attributes={"usageType": "user"},
            )
        )
        await db.flush()
        snap = sample_snapshot()
        snap.relations = [r for r in snap.relations if r.source_id == "rel-4"]

        _, stats, rows = await self._staged(db, env, snap)
        assert stats["update"] == 1
        assert rows["rel-4"].diff == {"attributes": {"usageType": {"old": "user", "new": "owner"}}}
        assert rows["rel-4"].source_data["tea_source_card_id"] == str(org.id)

        snap.relations[0].attributes = {"usageType": "user"}
        _, stats, rows = await self._staged(db, env, snap)
        assert stats["skip"] == 1 and rows["rel-4"].action == "skip"


class TestStageTags:
    async def test_groups_tags_and_links(self, db, env):
        snap = sample_snapshot()
        snap.tags.append(SnapTag("tag-loose", "Loose", None, None))
        m = await _migration(db, env)
        stats = await stage_tags(db, m, source_for(snap), snap)
        assert stats == {
            "groups_create": 3,
            "groups_skip": 0,
            "tags_create": 3,
            "tags_skip": 0,
            "links": 2,
        }
        groups = {r.source_id: r for r in await staged_rows(db, m, "tag_group")}
        assert groups["Region"].source_data == {"name": "Region", "mode": "multi"}
        assert groups["Stage"].source_data["mode"] == "single"
        assert groups["Imported from In-memory source"].action == "create"
        tags = {r.source_id: r for r in await staged_rows(db, m, "tag")}
        assert tags["tag-loose"].source_data["group_name"] == "Imported from In-memory source"
        assert tags["tag-emea"].source_data == {
            "name": "EMEA",
            "group_name": "Region",
            "color": "#ff0000",
        }
        links = await staged_rows(db, m, "card_tag")
        assert {r.source_id for r in links} == {"app-1:tag-emea", "app-1:tag-pilot"}
        assert links[0].source_data == {"entity_id": "app-1", "tag_id": "tag-emea"}

    async def test_existing_groups_and_tags_are_skipped(self, db, env):
        group = TagGroup(name="Region", mode="multi")
        db.add(group)
        await db.flush()
        tag = Tag(tag_group_id=group.id, name="EMEA")
        db.add(tag)
        await db.flush()
        snap = sample_snapshot()
        m = await _migration(db, env)
        stats = await stage_tags(db, m, source_for(snap), snap)
        assert stats["groups_skip"] == 1 and stats["groups_create"] == 1
        assert stats["tags_skip"] == 1 and stats["tags_create"] == 1
        groups = {r.source_id: r for r in await staged_rows(db, m, "tag_group")}
        assert groups["Region"].action == "skip" and groups["Region"].target_id == group.id
        tags = {r.source_id: r for r in await staged_rows(db, m, "tag")}
        assert tags["tag-emea"].action == "skip" and tags["tag-emea"].target_id == tag.id


class TestStageUsersAndSubscriptions:
    async def test_distinct_users_and_their_subscriptions(self, db, env):
        snap = sample_snapshot()
        m = await _migration(db, env)
        src = source_for(snap, role_map={"application owner": "responsible"})
        users, subs = await stage_users_and_subscriptions(db, m, src, snap)
        assert users == {"create": 2, "skip": 0, "missing_email": 0, "invalid_email": 0}
        assert subs == {"create": 2, "skip": 0, "conflict": 0}
        rows = {r.source_id: r for r in await staged_rows(db, m, "user")}
        assert rows["owner@example.com"].source_data == {
            "email": "owner@example.com",
            "display_name": "Owner",
        }
        sub_rows = {r.source_id: r for r in await staged_rows(db, m, "subscription")}
        assert sub_rows["sub-1"].source_data["tea_role_key"] == "responsible"
        assert sub_rows["sub-2"].source_data["tea_role_key"] == "observer"

    async def test_an_existing_user_is_skipped_and_never_touched(self, db, env):
        existing = await create_user(
            db, email="owner@example.com", role="member", display_name="Keep me"
        )
        snap = sample_snapshot()
        m = await _migration(db, env)
        users, _ = await stage_users_and_subscriptions(db, m, source_for(snap), snap)
        assert users["skip"] == 1 and users["create"] == 1
        row = next(
            r for r in await staged_rows(db, m, "user") if r.source_id == "owner@example.com"
        )
        assert row.action == "skip" and row.target_id == existing.id

    async def test_malformed_and_missing_emails_are_conflicts(self, db, env):
        snap = empty_snapshot()
        snap.entities.append(SourceEntity("app-1", "Application", "A"))
        snap.subscriptions += [
            Subscription("s-1", "app-1", "a@x.com;b@x.com", "Pair", "Owner", "RESPONSIBLE"),
            Subscription("s-2", "app-1", "  ", None, "Owner", "RESPONSIBLE"),
            Subscription("", "app-1", None, None, "Owner", "RESPONSIBLE"),
        ]
        snap.users += [
            UserRef("u-1", "Just A Name", "Name"),
            UserRef("u-2", "", None),
            UserRef("u-3", "top@x.com", "Top"),
        ]
        m = await _migration(db, env)
        users, subs = await stage_users_and_subscriptions(db, m, source_for(snap), snap)
        assert users == {"create": 1, "skip": 0, "missing_email": 2, "invalid_email": 2}
        assert subs == {"create": 0, "skip": 0, "conflict": 3}
        rows = {r.source_id: r for r in await staged_rows(db, m, "user")}
        assert rows["a@x.com;b@x.com"].action == "conflict"
        assert "Malformed email" in rows["a@x.com;b@x.com"].diff["reason"]
        assert rows["Just A Name"].action == "conflict"
        assert rows["top@x.com"].action == "create"
        sub_rows = {r.source_id: r for r in await staged_rows(db, m, "subscription")}
        assert "malformed" in sub_rows["s-1"].diff["reason"]
        assert sub_rows["s-2"].diff["reason"] == "Subscription has no user email — cannot resolve"
        assert sub_rows["app-1:noemail"].action == "conflict"


class TestStageDocumentsAndComments:
    async def test_documents_without_a_url_are_conflicts(self, db, env):
        snap = sample_snapshot()
        snap.documents.append(SnapDocument("", "app-1", "Binary", None))
        m = await _migration(db, env)
        stats = await stage_documents(db, m, source_for(snap), snap)
        assert stats == {"create": 1, "skip": 0, "conflict": 1}
        rows = {r.source_id: r for r in await staged_rows(db, m, "document")}
        assert rows["doc-1"].source_data == {
            "entity_id": "app-1",
            "name": "Runbook",
            "url": "https://wiki.example.com/sf",
        }
        assert rows["app-1:Binary"].action == "conflict"
        assert rows["app-1:Binary"].diff["reason"].startswith("Document has no URL")

    async def test_comments_without_a_body_are_dropped_and_ids_are_stable(self, db, env):
        snap = sample_snapshot()
        snap.comments += [
            SnapComment("", "app-1", "Owner@Example.com ", "no id"),
            SnapComment("c-empty", "app-1", "x@y.com", ""),
        ]
        m = await _migration(db, env)
        stats = await stage_comments(db, m, source_for(snap), snap)
        assert stats == {"create": 2, "skip": 0, "conflict": 1}
        rows = {r.source_id: r for r in await staged_rows(db, m, "comment")}
        assert rows["cmt-1"].source_data["created_at"] == "2024-03-01T12:00:00"
        # A comment the source gave no id gets one derived from its body —
        # a digest, never ``hash()``, so a re-import recognises it.
        synthetic = f"app-1:{hashlib.sha256(b'no id').hexdigest()[:16]}"
        assert rows[synthetic].source_data["author_email"] == "owner@example.com"
        assert rows[synthetic].source_data["created_at"] is None


class TestStageMetamodel:
    async def test_types_fields_and_relation_types(self, db, env):
        snap = sample_snapshot()
        app_type = snap.metamodel_types[0]
        app_type.fields += [
            MetamodelField("Application", "owner", "Owner", "FACT_SHEET_REFERENCE"),
            MetamodelField("Application", "blob", "Blob", "WEIRD"),
            MetamodelField("Application", "name", "Name", "TEXT", is_custom=False),
        ]
        snap.metamodel_types.append(MetamodelType("Application", True))  # collides
        snap.metamodel_relation_types.append(
            MetamodelRelationType("relBuiltin", "Application", "Application", is_custom=False)
        )
        m = await _migration(db, env)
        stats = await stage_metamodel(db, m, source_for(snap), snap)
        assert stats == {
            "new_types": 1,
            "new_fields": 4,
            "new_relation_types": 2,
            "field_conflicts": 1,
            "type_conflicts": 1,
        }
        types = {r.source_id: r for r in await staged_rows(db, m, "metamodel_type")}
        assert types["Server"].action == "create"
        assert types["Server"].source_data["proposed_tea_key"] == "Server"
        assert types["Application"].action == "conflict"
        assert "collides with a built-in" in types["Application"].diff["reason"]

        fields = {r.source_id: r for r in await staged_rows(db, m, "metamodel_field")}
        hosting = fields["Application:hostingType"]
        assert hosting.source_data["tea_type"] == "single_select"
        assert hosting.source_data["options"] == [{"key": "cloud", "label": "Cloud"}]
        assert hosting.card_type_key == "Application"
        assert fields["Application:blob"].action == "conflict"
        assert fields["Application:blob"].diff["reason"] == (
            "Unmappable In-memory source dataType 'WEIRD'"
        )
        assert "Application:name" not in fields  # not custom

        rels = {r.source_id: r for r in await staged_rows(db, m, "metamodel_relation_type")}
        assert rels["relServerToApp"].source_data == {
            "native_name": "relServerToApp",
            "label": "hosts",
            "from_type": "Server",
            "to_type": "Application",
            "attributes_schema": [],
        }
        assert rels["Application:owner"].source_data["to_type"] is None  # a reference field
        assert "relAppToBC" not in rels and "relBuiltin" not in rels


# ---------------------------------------------------------------------------
# Apply
# ---------------------------------------------------------------------------


class TestApply:
    async def test_a_full_import_lands_every_kind_in_order(self, db, env):
        m, _, _ = await _staged_sample(db, env)
        counts = await apply_migration(db, m, env["admin"])
        per = counts["per_pass"]
        assert per["metamodel_type"]["created"] == 1
        assert per["metamodel_field"] == {**EMPTY, "created": 2, "skipped": 2}
        assert per["metamodel_relation_type"]["created"] == 1
        assert per["user"]["created"] == 2
        assert per["card"]["created"] == 7
        assert per["tag_group"]["created"] == 2 and per["tag"]["created"] == 2
        assert per["card_tag"]["created"] == 2
        assert per["relation"] == {**EMPTY, "created": 5, "conflicts": 1}
        assert per["subscription"]["created"] == 2
        assert per["document"]["created"] == 1 and per["comment"]["created"] == 1
        assert counts["errors"] == 0 and counts["conflicts"] == 1
        assert all(r.status == "applied" for r in await staged_rows(db, m))

        # Custom metamodel first, so the cards and relations below could land.
        server = await _one(db, CardType, key="Server")
        assert server is not None and not server.built_in and server.has_hierarchy
        rt = await _one(db, RelationType, key="relServerToApp")
        assert (rt.source_type_key, rt.target_type_key, rt.built_in) == (
            "Server",
            "Application",
            False,
        )
        app_type = await _one(db, CardType, key="Application")
        imported = next(s for s in app_type.fields_schema if s["section"] == "Imported from inmem")
        by_key = {f["key"]: f for f in imported["fields"]}
        assert set(by_key) == {"regions", "unusedField"}  # the two not already on the type
        assert by_key["regions"]["type"] == "multiple_select" and by_key["regions"]["weight"] == 0

        cards = {c.external_id: c for c in await _all(db, Card)}
        assert set(cards) == {"app-1", "app-2", "bc-1", "bc-2", "proc-1", "org-1", "srv-1"}
        assert cards["bc-2"].parent_id == cards["bc-1"].id
        assert cards["app-1"].subtype == "businessApplication"
        assert cards["app-1"].attributes["hostingType"] == "cloud"
        assert cards["app-1"].lifecycle == {"plan": "2019-01-01", "active": "2020-01-01"}
        assert cards["app-1"].created_by == env["admin"].id
        assert cards["org-1"].subtype == "team"
        assert cards["srv-1"].type == "Server"
        events = await _all(db, Event, event_type="card.created")
        assert len(events) == 7
        assert all(
            e.data["source"] == "migration" and e.data["source_type"] == "inmem" for e in events
        )

        groups = {g.name: g for g in await _all(db, TagGroup)}
        assert groups["Stage"].mode == "single"
        assert groups["Region"].description == "Imported from inmem"
        tags = {t.name: t for t in await _all(db, Tag)}
        assert tags["EMEA"].tag_group_id == groups["Region"].id and tags["EMEA"].color == "#ff0000"
        links = await _all(db, CardTag, card_id=cards["app-1"].id)
        assert {link.tag_id for link in links} == {tags["EMEA"].id, tags["Pilot"].id}

        rels = {(r.type, r.source_id, r.target_id): r for r in await _all(db, RelationModel)}
        assert len(rels) == 5
        assert ("relAppToBC", cards["app-1"].id, cards["bc-2"].id) in rels
        assert ("relAppSuccessor", cards["app-2"].id, cards["app-1"].id) in rels
        assert ("relServerToApp", cards["srv-1"].id, cards["app-1"].id) in rels
        owner_rel = rels[("relOrgToApp", cards["org-1"].id, cards["app-1"].id)]
        assert owner_rel.attributes == {"usageType": "owner"}

        owner = await _one(db, User, email="owner@example.com")
        assert owner.is_active is False and owner.role == "member"
        assert owner.display_name == "Owner" and owner.auth_provider == "local"
        observer = await _one(db, User, email="a@example.com")
        stakes = {
            (s.user_id, s.role) for s in await _all(db, Stakeholder, card_id=cards["app-1"].id)
        }
        assert stakes == {(owner.id, "responsible"), (observer.id, "observer")}

        (doc,) = await _all(db, Document, card_id=cards["app-1"].id)
        assert (doc.name, doc.url, doc.type, doc.created_by) == (
            "Runbook",
            "https://wiki.example.com/sf",
            "link",
            env["admin"].id,
        )
        (comment,) = await _all(db, Comment, card_id=cards["app-1"].id)
        assert comment.content == "Renewal due in Q3" and comment.user_id == owner.id
        assert comment.parent_id is None

        im = {
            (r.entity_kind, r.source_id): r
            for r in await _all(db, IdentityMap, source_type="inmem")
        }
        assert im[("card", "app-1")].target_id == cards["app-1"].id
        assert im[("card", "app-1")].migration_id == m.id
        assert im[("user", "owner@example.com")].target_id == owner.id
        assert im[("tag", "tag-emea")].target_id == tags["EMEA"].id
        assert im[("document", "doc-1")].target_id == doc.id
        assert im[("comment", "cmt-1")].target_id == comment.id

    async def test_a_second_import_of_the_same_export_changes_nothing(self, db, env):
        m1, snap, src = await _staged_sample(db, env)
        await apply_migration(db, m1, env["admin"])
        models = (Card, RelationModel, Document, Comment, Stakeholder, Tag, TagGroup, CardTag, User)
        before = {model: len(await _all(db, model)) for model in models}

        m2 = await _migration(db, env)
        stats = await stage_all(db, m2, src, snap)
        assert stats["cards"]["skip"] == 7 and stats["relations"]["skip"] == 5
        assert stats["tags"] == {
            "groups_create": 0,
            "groups_skip": 2,
            "tags_create": 0,
            "tags_skip": 2,
            "links": 2,
        }
        assert stats["users"]["skip"] == 2
        counts = await apply_migration(db, m2, env["admin"])
        assert counts["created"] == 0 and counts["updated"] == 0 and counts["errors"] == 0
        per = counts["per_pass"]
        assert per["metamodel_type"]["skipped"] == 1 and per["metamodel_field"]["skipped"] == 4
        assert per["card"]["skipped"] == 7 and per["card_tag"]["skipped"] == 2
        assert per["subscription"]["skipped"] == 2
        assert per["document"]["skipped"] == 1 and per["comment"]["skipped"] == 1
        assert {model: len(await _all(db, model)) for model in models} == before
        # The skipped rows still refreshed their identity-map rows.
        card_rows = await _all(db, IdentityMap, entity_kind="card")
        assert {r.migration_id for r in card_rows} == {m2.id}

    async def test_a_changed_export_updates_in_place(self, db, env):
        m1, snap, src = await _staged_sample(db, env)
        await apply_migration(db, m1, env["admin"])
        app1 = next(e for e in snap.entities if e.source_id == "app-1")
        app1.description = "CRM, now with AI"
        app1.custom_fields["costTotalAnnual"] = 2000
        snap.documents[0].name = "Runbook v2"
        snap.comments[0].body = "Renewal postponed"

        m2 = await _migration(db, env)
        await stage_all(db, m2, src, snap)
        counts = await apply_migration(db, m2, env["admin"])
        per = counts["per_pass"]
        assert per["card"] == {**EMPTY, "updated": 1, "skipped": 6}
        assert per["document"] == {**EMPTY, "updated": 1}
        assert per["comment"] == {**EMPTY, "updated": 1}

        card = await _one(db, Card, external_id="app-1")
        assert card.description == "CRM, now with AI"
        assert card.attributes["costTotalAnnual"] == 2000
        assert card.attributes["regions"] == ["emea", "apac"]  # untouched keys survive the merge
        assert card.updated_by == env["admin"].id
        (event,) = await _all(db, Event, event_type="card.updated")
        assert event.data["changes"]["description"] == {"old": "CRM", "new": "CRM, now with AI"}
        assert event.data["changes"]["attributes"]["old"]["costTotalAnnual"] == 1200.5
        (doc,) = await _all(db, Document, card_id=card.id)
        assert doc.name == "Runbook v2"
        (comment,) = await _all(db, Comment, card_id=card.id)
        assert comment.content == "Renewal postponed"

    async def test_documents_and_comments_survive_an_identity_map_wipe(self, db, env):
        m1, snap, src = await _staged_sample(db, env)
        await apply_migration(db, m1, env["admin"])
        for row in await _all(db, IdentityMap):
            if row.entity_kind in ("document", "comment"):
                await db.delete(row)
        await db.flush()

        m2 = await _migration(db, env)
        await stage_all(db, m2, src, snap)
        counts = await apply_migration(db, m2, env["admin"])
        assert counts["per_pass"]["document"]["skipped"] == 1
        assert counts["per_pass"]["comment"]["skipped"] == 1
        assert len(await _all(db, Document)) == 1 and len(await _all(db, Comment)) == 1
        assert len(await _all(db, IdentityMap, entity_kind="document")) == 1

    async def test_a_document_deleted_by_hand_is_landed_again(self, db, env):
        m1, snap, src = await _staged_sample(db, env)
        await apply_migration(db, m1, env["admin"])
        (doc,) = await _all(db, Document)
        await db.delete(doc)  # the identity map still points at it
        await db.flush()

        m2 = await _migration(db, env)
        await stage_all(db, m2, src, snap)
        counts = await apply_migration(db, m2, env["admin"])
        assert counts["per_pass"]["document"] == {**EMPTY, "created": 1}
        (fresh,) = await _all(db, Document)
        assert fresh.id != doc.id and fresh.name == "Runbook"
        (row,) = await _all(db, IdentityMap, entity_kind="document")
        assert row.target_id == fresh.id  # re-pointed, never a second row

    async def test_a_malformed_email_never_becomes_a_user(self, db, env):
        snap = empty_snapshot()
        snap.entities.append(SourceEntity("app-1", "Application", "A"))
        snap.subscriptions.append(
            Subscription("s-1", "app-1", "a@x.com;b@x.com", "Pair", "Owner", "RESPONSIBLE")
        )
        m, _, _ = await _staged_sample(db, env, snap)
        counts = await apply_migration(db, m, env["admin"])
        assert counts["per_pass"]["user"] == {**EMPTY, "conflicts": 1}
        assert counts["per_pass"]["subscription"] == {**EMPTY, "conflicts": 1}
        assert await _one(db, User, email="a@x.com;b@x.com") is None
        (row,) = await staged_rows(db, m, "user")
        assert row.status == "applied" and row.action == "conflict"

    async def test_an_archived_entity_lands_archived(self, db, env):
        snap = empty_snapshot()
        snap.entities.append(SourceEntity("old-1", "Application", "Retired", status="ARCHIVED"))
        m = await _migration(db, env)
        await stage_all(db, m, source_for(snap), snap, include_archived=True)
        await apply_migration(db, m, env["admin"])
        card = await _one(db, Card, external_id="old-1")
        assert card.status == "ARCHIVED"

    async def test_field_mappings_remap_attributes_and_route_lifecycle_dates(self, db, env):
        snap = sample_snapshot()
        app1 = next(e for e in snap.entities if e.source_id == "app-1")
        app1.custom_fields["retire"] = "2030-06-30T00:00:00+00:00"
        snap.metamodel_types[0].fields.append(
            MetamodelField("Application", "retire", "Retire", "DATE")
        )
        m = await _migration(
            db,
            env,
            field_mappings={
                "Application": {
                    "alias": "__skip__",
                    "externalId": "sourceRef",
                    "retire": "__lifecycle__:endOfLife",
                    "regions": "regions",
                }
            },
        )
        await stage_all(db, m, source_for(snap), snap)
        counts = await apply_migration(db, m, env["admin"])

        card = await _one(db, Card, external_id="app-1")
        assert "alias" not in card.attributes and "externalId" not in card.attributes
        assert card.attributes["sourceRef"] == "LX-42"
        assert card.lifecycle == {
            "plan": "2019-01-01",
            "active": "2020-01-01",
            "endOfLife": "2030-06-30",
        }
        # A mapped field is not materialised in the Imported section.
        app_type = await _one(db, CardType, key="Application")
        imported = next(s for s in app_type.fields_schema if s["section"] == "Imported from inmem")
        assert {f["key"] for f in imported["fields"]} == {"unusedField"}
        assert counts["per_pass"]["metamodel_field"] == {**EMPTY, "created": 1, "skipped": 4}

    async def test_a_parent_outside_the_snapshot_resolves_through_the_identity_map(self, db, env):
        root = await create_card(
            db, card_type="BusinessCapability", name="Root", user_id=env["admin"].id
        )
        db.add(_identity("bc-root", root.id))
        snap = empty_snapshot()
        snap.entities.append(
            SourceEntity("bc-child", "BusinessCapability", "Child", parent_id="bc-root")
        )
        m, _, _ = await _staged_sample(db, env, snap)
        await apply_migration(db, m, env["admin"])
        child = await _one(db, Card, external_id="bc-child")
        assert child.parent_id == root.id

    async def test_relations_are_stored_in_their_types_direction(self, db, env):
        snap = empty_snapshot()
        snap.entities += [
            SourceEntity("app-1", "Application", "A"),
            SourceEntity("proc-1", "BusinessProcess", "P"),
        ]
        snap.relations += [
            # The source's own convention runs against the type's direction.
            Relation("rel-back", "relProcessToApp", "app-1", "proc-1", attributes={"a": 1}),
            Relation("rel-fwd", "relProcessToApp", "proc-1", "app-1", attributes={"b": 2}),
        ]
        m, _, _ = await _staged_sample(db, env, snap)
        counts = await apply_migration(db, m, env["admin"])
        assert counts["per_pass"]["relation"] == {**EMPTY, "created": 1, "updated": 1}
        (rel,) = await _all(db, RelationModel)
        app = await _one(db, Card, external_id="app-1")
        proc = await _one(db, Card, external_id="proc-1")
        assert (rel.source_id, rel.target_id) == (proc.id, app.id)
        assert rel.attributes == {"a": 1, "b": 2}

    async def test_relation_updates_and_the_rows_that_cannot_be_updated(self, db, env):
        app = await create_card(
            db, card_type="Application", name="Salesforce", user_id=env["admin"].id
        )
        bc = await create_card(
            db, card_type="BusinessCapability", name="Sales", user_id=env["admin"].id
        )
        org = await create_card(
            db, card_type="Organization", name="Sales EMEA", user_id=env["admin"].id
        )
        proc = await create_card(
            db, card_type="BusinessProcess", name="Order to Cash", user_id=env["admin"].id
        )
        for sid, card in (("app-1", app), ("bc-1", bc), ("org-1", org), ("proc-1", proc)):
            db.add(_identity(sid, card.id))
        for type_key, src, tgt in (
            ("relAppToBC", app, bc),
            ("relOrgToApp", org, app),
            ("relProcessToApp", proc, app),
        ):
            db.add(
                RelationModel(
                    type=type_key, source_id=src.id, target_id=tgt.id, attributes={"v": 0}
                )
            )
        await db.flush()
        snap = sample_snapshot()
        snap.relations = [
            Relation("r-bc", "relAppToBC", "app-1", "bc-1", attributes={"v": 1}),
            Relation("r-org", "relOrgToApp", "org-1", "app-1", attributes={"v": 1}),
            Relation("r-proc", "relProcessToApp", "proc-1", "app-1", attributes={"v": 1}),
        ]
        m, _, _ = await _staged_sample(db, env, snap)
        rows = {r.source_id: r for r in await staged_rows(db, m, "relation")}
        assert all(r.action == "update" for r in rows.values())
        rows["r-org"].target_id = None
        rows["r-proc"].target_id = uuid.uuid4()
        await db.flush()

        counts = await apply_migration(db, m, env["admin"])
        assert counts["per_pass"]["relation"] == {**EMPTY, "updated": 1, "errors": 2}
        updated = await _one(db, RelationModel, type="relAppToBC")
        assert updated.attributes == {"v": 1}
        assert rows["r-org"].error_message == "update relation has no cached target_id"
        assert rows["r-proc"].error_message == "target relation no longer exists"

    async def test_a_row_the_pipeline_cannot_place_is_isolated(self, db, env):
        m, _, _ = await _staged_sample(db, env)
        broken = next(r for r in await staged_rows(db, m, "card") if r.source_id == "app-1")
        broken.action = "update"
        broken.target_id = None
        await db.flush()
        counts = await apply_migration(db, m, env["admin"])
        assert counts["per_pass"]["card"] == {**EMPTY, "created": 6, "errors": 1}
        assert counts["errors"] == 1
        assert broken.status == "error" and "has no target_id" in broken.error_message
        # Everything hanging off app-1 degrades to a skip with a reason, never an error.
        assert counts["per_pass"]["relation"] == {**EMPTY, "skipped": 5, "conflicts": 1}
        rel = next(r for r in await staged_rows(db, m, "relation") if r.source_id == "rel-1")
        assert rel.status == "applied"
        assert rel.error_message == "Endpoint card not resolved in identity map"
        reasons = {
            kind: {r.error_message for r in await staged_rows(db, m, kind)}
            for kind in ("card_tag", "subscription", "document", "comment")
        }
        assert reasons == {
            "card_tag": {"Endpoint not resolved (card or tag missing)"},
            "subscription": {"Endpoint (card or user) not resolved"},
            "document": {"Card not resolved in identity map"},
            "comment": {"Card not resolved"},
        }

    async def test_card_rows_with_a_bad_action_or_a_vanished_target(self, db, env):
        m, _, _ = await _staged_sample(db, env)
        rows = {r.source_id: r for r in await staged_rows(db, m, "card")}
        rows["srv-1"].action = "merge"
        rows["app-2"].action = "update"
        rows["app-2"].target_id = uuid.uuid4()
        await db.flush()
        counts = await apply_migration(db, m, env["admin"])
        assert counts["per_pass"]["card"] == {**EMPTY, "created": 5, "errors": 2}
        assert rows["srv-1"].error_message == "unknown action 'merge'"
        assert rows["app-2"].error_message.startswith("target card ")
        assert rows["app-2"].error_message.endswith(" no longer exists")

    async def test_a_comment_whose_author_is_unknown_is_skipped(self, db, env):
        snap = sample_snapshot()
        snap.comments[0].author_email = "stranger@example.com"
        snap.comments.append(SnapComment("c-2", "app-1", None, "anonymous"))
        m, _, _ = await _staged_sample(db, env, snap)
        counts = await apply_migration(db, m, env["admin"])
        assert counts["per_pass"]["comment"] == {**EMPTY, "skipped": 2}
        assert await _all(db, Comment) == []
        assert {r.error_message for r in await staged_rows(db, m, "comment")} == {
            "Author not resolved — comment skipped"
        }

    async def test_tag_group_resolution_falls_back_to_the_database(self, db, env):
        ghost = TagGroup(name="Ghost", mode="multi")
        db.add(ghost)
        await db.flush()
        m = await _migration(db, env)
        for sid, group in (("t-ghost", "Ghost"), ("t-nope", "Nope")):
            db.add(
                StagedRecord(
                    migration_id=m.id,
                    source_type="inmem",
                    entity_kind="tag",
                    source_id=sid,
                    source_data={"name": sid, "group_name": group, "color": None},
                    action="create",
                )
            )
        await db.flush()
        counts = await apply_migration(db, m, env["admin"])
        assert counts["per_pass"]["tag"] == {**EMPTY, "created": 1, "errors": 1}
        tag = await _one(db, Tag, name="t-ghost")
        assert tag.tag_group_id == ghost.id
        nope = next(r for r in await staged_rows(db, m, "tag") if r.source_id == "t-nope")
        assert nope.status == "error" and nope.error_message == "tag group 'Nope' not resolvable"

    async def test_metamodel_rows_that_cannot_be_placed(self, db, env):
        m = await _migration(db, env)
        rows = [
            # exists → skipped with the target id
            ("metamodel_type", "Application", {"proposed_tea_key": "Application"}, "create"),
            ("metamodel_type", "blank", {}, "create"),  # no key → error
            ("metamodel_type", "Nope", {"native_name": "Nope"}, "conflict"),  # skipped
            (
                "metamodel_relation_type",
                "relAppToBC",
                {"native_name": "relAppToBC", "from_type": "Application", "to_type": "BC"},
                "create",
            ),  # exists → skipped
            (
                "metamodel_relation_type",
                "Application:owner",
                {"native_name": "owner", "from_type": "Application", "to_type": None},
                "create",
            ),  # endpoint missing → skipped with a hint
            (
                "metamodel_field",
                "Ghost:x",
                {"target_type": "Ghost", "field_key": "x", "tea_type": "text"},
                "create",
            ),  # type missing → error
            (
                "metamodel_field",
                "Application:y",
                {"target_type": "Application", "field_key": "y", "tea_type": "text"},
                "conflict",
            ),  # skipped
        ]
        for kind, sid, data, action in rows:
            db.add(
                StagedRecord(
                    migration_id=m.id,
                    source_type="inmem",
                    entity_kind=kind,
                    source_id=sid,
                    source_data=data,
                    action=action,
                )
            )
        await db.flush()
        counts = await apply_migration(db, m, env["admin"])
        per = counts["per_pass"]
        assert per["metamodel_type"] == {**EMPTY, "skipped": 2, "errors": 1}
        assert per["metamodel_relation_type"] == {**EMPTY, "skipped": 2}
        assert per["metamodel_field"] == {**EMPTY, "skipped": 1, "errors": 1}
        by_id = {r.source_id: r for r in await staged_rows(db, m)}
        assert by_id["Application"].target_id == env["types"]["Application"].id
        assert by_id["blank"].error_message == "missing proposed_tea_key"
        assert by_id["relAppToBC"].target_id == env["relation_types"]["relAppToBC"].id
        assert by_id["Application:owner"].error_message == (
            "Relation endpoint missing — set 'to_type' in preview"
        )
        assert by_id["Ghost:x"].error_message == "target card type 'Ghost' not found"
