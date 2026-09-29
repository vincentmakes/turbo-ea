"""``build_export_snapshot`` reads the workspace into the importer's dataclasses.

Database-backed: the snapshot is assembled from real rows created with
the conftest factories, then checked field by field in Turbo EA
vocabulary (card-type keys, relation keys). The LeanIX spelling is the
adapter's job and is covered by ``test_migration_leanix_xlsx_exporter.py``.
"""

from __future__ import annotations

from app.models.comment import Comment
from app.models.document import Document
from app.models.stakeholder import Stakeholder
from app.models.tag import CardTag, Tag, TagGroup
from app.services.migration.export_snapshot import build_export_snapshot
from tests.conftest import (
    create_card,
    create_card_type,
    create_relation,
    create_relation_type,
    create_stakeholder_role_def,
    create_user,
)


async def _world(db):
    await create_card_type(
        db,
        key="Application",
        label="Application",
        built_in=True,
        subtypes=[{"key": "businessApplication", "label": "Business Application"}],
        fields_schema=[
            {
                "section": "Details",
                "fields": [
                    {"key": "costTotalAnnual", "label": "Total annual cost", "type": "cost"},
                    {
                        "key": "hostingType",
                        "label": "Hosting type",
                        "type": "single_select",
                        "options": [{"key": "cloud", "label": "Cloud"}],
                    },
                ],
            }
        ],
    )
    await create_card_type(
        db, key="BusinessCapability", label="Business Capability", has_hierarchy=True
    )
    await create_relation_type(
        db,
        key="relAppToBC",
        label="supports",
        source_type_key="Application",
        target_type_key="BusinessCapability",
        attributes_schema=[{"key": "weight", "type": "number"}],
    )
    await create_stakeholder_role_def(
        db, card_type_key="Application", key="responsible", label="Application Owner"
    )
    await create_stakeholder_role_def(
        db, card_type_key="Application", key="observer", label="Observer"
    )
    owner = await create_user(db, email="owner@example.com", display_name="Owner")
    watcher = await create_user(db, email="watcher@example.com", display_name="Watcher")

    bc_root = await create_card(db, card_type="BusinessCapability", name="Sales")
    bc_child = await create_card(
        db, card_type="BusinessCapability", name="Lead Mgmt", parent_id=bc_root.id
    )
    app = await create_card(
        db,
        card_type="Application",
        name="Salesforce",
        subtype="businessApplication",
        description="CRM",
        lifecycle={"active": "2020-01-01", "endOfLife": None},
        attributes={"costTotalAnnual": 1200, "hostingType": "cloud"},
        approval_status="APPROVED",
        data_quality=85.0,
        alias="SFDC",
    )
    app.external_id = "LX-42"
    archived = await create_card(db, card_type="Application", name="Old CRM", status="ARCHIVED")
    await create_relation(
        db, type_key="relAppToBC", source_id=app.id, target_id=bc_child.id, attributes={"weight": 3}
    )
    await create_relation(db, type_key="relAppToBC", source_id=archived.id, target_id=bc_root.id)

    group = TagGroup(name="Region", mode="multi", restrict_to_types=["Application"])
    db.add(group)
    await db.flush()
    tag = Tag(tag_group_id=group.id, name="EMEA", color="#ff0000")
    db.add(tag)
    await db.flush()
    db.add(CardTag(card_id=app.id, tag_id=tag.id))
    db.add(CardTag(card_id=archived.id, tag_id=tag.id))
    db.add(Stakeholder(card_id=app.id, user_id=owner.id, role="responsible"))
    db.add(Stakeholder(card_id=app.id, user_id=watcher.id, role="observer"))
    db.add(Stakeholder(card_id=archived.id, user_id=owner.id, role="responsible"))
    db.add(Document(card_id=app.id, name="Runbook", url="https://wiki.example.com/sf"))
    db.add(Comment(card_id=app.id, user_id=owner.id, content="Renewal due"))
    await db.flush()
    return {"app": app, "archived": archived, "bc_root": bc_root, "bc_child": bc_child, "tag": tag}


class TestBuildExportSnapshot:
    async def test_cards_carry_the_columns_the_importer_reads(self, db):
        w = await _world(db)
        snap = await build_export_snapshot(db)

        by_id = {e.source_id: e for e in snap.entities}
        assert set(by_id) == {str(w["app"].id), str(w["bc_root"].id), str(w["bc_child"].id)}
        app = by_id[str(w["app"].id)]
        assert app.type == "Application"
        assert app.category == "businessApplication"
        assert app.description == "CRM"
        assert app.lifecycle == {"active": "2020-01-01"}  # empty phases dropped
        assert app.quality_seal == "APPROVED"
        assert app.completion == 0.85
        assert app.status == "ACTIVE"
        assert app.tags == [str(w["tag"].id)]
        assert app.custom_fields == {
            "costTotalAnnual": 1200,
            "hostingType": "cloud",
            "externalId": "LX-42",
            "alias": "SFDC",
        }
        assert app.raw["createdAt"]

    async def test_display_name_is_the_hierarchy_path(self, db):
        w = await _world(db)
        snap = await build_export_snapshot(db)
        by_id = {e.source_id: e for e in snap.entities}
        child = by_id[str(w["bc_child"].id)]
        assert child.display_name == "Sales / Lead Mgmt"
        assert child.parent_id == str(w["bc_root"].id)
        assert by_id[str(w["bc_root"].id)].display_name == "Sales"

    async def test_relations_stakeholders_tags_documents_comments(self, db):
        w = await _world(db)
        snap = await build_export_snapshot(db)

        assert [
            (r.type, r.from_entity_id, r.to_entity_id, r.attributes) for r in snap.relations
        ] == [("relAppToBC", str(w["app"].id), str(w["bc_child"].id), {"weight": 3})]
        subs = sorted((s.user_email, s.role_name, s.role_type) for s in snap.subscriptions)
        assert subs == [
            ("owner@example.com", "Application Owner", "RESPONSIBLE"),
            ("watcher@example.com", "Observer", "OBSERVER"),
        ]
        assert [
            (t.name, t.group_name, t.group_mode, t.color, t.group_restrict_to_types)
            for t in snap.tags
        ] == [("EMEA", "Region", "MULTIPLE", "#ff0000", ["Application"])]
        assert [(d.entity_id, d.name, d.url) for d in snap.documents] == [
            (str(w["app"].id), "Runbook", "https://wiki.example.com/sf")
        ]
        assert [(c.entity_id, c.author_email, c.body) for c in snap.comments] == [
            (str(w["app"].id), "owner@example.com", "Renewal due")
        ]
        assert sorted(u.email for u in snap.users) == ["owner@example.com", "watcher@example.com"]

    async def test_metamodel_describes_fields_options_and_subtypes(self, db):
        await _world(db)
        snap = await build_export_snapshot(db)
        app_type = next(m for m in snap.metamodel_types if m.name == "Application")
        assert app_type.subtypes == ["businessApplication"]
        fields = {f.key: f for f in app_type.fields}
        assert fields["costTotalAnnual"].data_type == "cost"
        assert fields["hostingType"].options == [{"key": "cloud", "label": "Cloud"}]
        rel_type = next(r for r in snap.metamodel_relation_types if r.name == "relAppToBC")
        assert (rel_type.source_type, rel_type.target_type) == ("Application", "BusinessCapability")
        assert rel_type.attributes_schema == [{"key": "weight", "type": "number"}]

    async def test_archived_cards_and_everything_hanging_off_them_are_excluded_by_default(self, db):
        w = await _world(db)
        snap = await build_export_snapshot(db)
        archived_id = str(w["archived"].id)
        assert archived_id not in {e.source_id for e in snap.entities}
        assert all(archived_id not in (r.from_entity_id, r.to_entity_id) for r in snap.relations)
        assert all(s.entity_id != archived_id for s in snap.subscriptions)

    async def test_include_archived_brings_them_back_with_status_archived(self, db):
        w = await _world(db)
        snap = await build_export_snapshot(db, include_archived=True)
        by_id = {e.source_id: e for e in snap.entities}
        archived = by_id[str(w["archived"].id)]
        assert archived.status == "ARCHIVED"
        assert archived.tags == [str(w["tag"].id)]
        assert len(snap.relations) == 2
        assert sum(1 for s in snap.subscriptions if s.entity_id == archived.source_id) == 1
