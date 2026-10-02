"""Helpers for the platform-migration pipeline tests.

The pipeline is adapter-driven, so the tests drive it with an in-memory
source whose ``parse()`` returns a hand-built :class:`MigrationSnapshot`
— no workbook, no disk, no LeanIX vocabulary. Importable without a
database; the DB helpers take the session they are given and never
commit it.
"""

from __future__ import annotations

import hashlib
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any

from app.services.migration.snapshot import (
    Comment,
    Document,
    MetamodelField,
    MetamodelRelationType,
    MetamodelType,
    MigrationSnapshot,
    Relation,
    SourceEntity,
    Subscription,
    Tag,
)

# ---------------------------------------------------------------------------
# A complete snapshot in Turbo EA vocabulary
# ---------------------------------------------------------------------------


def sample_snapshot() -> MigrationSnapshot:
    """One of everything: hierarchy, every relation shape (including a
    dangling one), two tag groups, subscriptions, a document, a comment,
    an admin-created type (``Server``) and a field the metamodel lacks."""
    entities = [
        SourceEntity(
            source_id="app-1",
            type="Application",
            name="Salesforce",
            display_name="Salesforce",
            category="businessApplication",
            description="CRM",
            lifecycle={"plan": "2019-01-01", "active": "2020-01-01"},
            tags=["tag-emea", "tag-pilot"],
            custom_fields={
                "costTotalAnnual": 1200.5,
                "hostingType": "cloud",
                "regions": ["emea", "apac"],
                "externalId": "LX-42",
                "alias": "SFDC",
            },
            quality_seal="APPROVED",
            completion=0.85,
            status="ACTIVE",
        ),
        SourceEntity(source_id="app-2", type="Application", name="New CRM", status="ACTIVE"),
        SourceEntity(source_id="bc-1", type="BusinessCapability", name="Sales", status="ACTIVE"),
        SourceEntity(
            source_id="bc-2",
            type="BusinessCapability",
            name="Lead Mgmt",
            display_name="Sales / Lead Mgmt",
            parent_id="bc-1",
            status="ACTIVE",
        ),
        SourceEntity(source_id="proc-1", type="BusinessProcess", name="Order to Cash"),
        SourceEntity(source_id="org-1", type="Organization", name="Sales EMEA", category="team"),
        SourceEntity(source_id="srv-1", type="Server", name="db-01"),  # admin-created type
    ]
    relations = [
        Relation("rel-1", "relAppToBC", "app-1", "bc-2", attributes={}),
        # Turbo EA: source succeeds target → app-2 succeeds app-1.
        Relation("rel-2", "relAppSuccessor", "app-2", "app-1", attributes={}),
        Relation("rel-3", "relProcessToApp", "proc-1", "app-1", attributes={}),
        Relation("rel-4", "relOrgToApp", "org-1", "app-1", attributes={"usageType": "owner"}),
        Relation("rel-5", "relServerToApp", "srv-1", "app-1", attributes={}),
        Relation("rel-6", "relAppToBC", "app-1", "missing", attributes={}),  # dangling
    ]
    subscriptions = [
        Subscription(
            "sub-1", "app-1", "owner@example.com", "Owner", "Application Owner", "RESPONSIBLE"
        ),
        Subscription("sub-2", "app-1", "a@example.com", "A", "Observer", "OBSERVER"),
    ]
    tags = [
        Tag("tag-emea", "EMEA", "Region", "MULTIPLE", "#ff0000"),
        Tag("tag-pilot", "Pilot", "Stage", "SINGLE", None, group_restrict_to_types=["Application"]),
    ]
    documents = [Document("doc-1", "app-1", "Runbook", "https://wiki.example.com/sf")]
    comments = [
        Comment(
            "cmt-1",
            "app-1",
            "owner@example.com",
            "Renewal due in Q3",
            created_at=datetime(2024, 3, 1, 12, 0),
        )
    ]
    metamodel_types = [
        MetamodelType(
            "Application",
            False,
            fields=[
                MetamodelField("Application", "costTotalAnnual", "Total annual cost", "cost"),
                MetamodelField(
                    "Application",
                    "hostingType",
                    "Hosting type",
                    "single_select",
                    options=[{"key": "cloud", "label": "Cloud"}],
                ),
                MetamodelField("Application", "regions", "Regions", "multiple_select"),
                MetamodelField("Application", "unusedField", "Unused", "text"),
            ],
            subtypes=["businessApplication", "microservice"],
        ),
        MetamodelType("BusinessCapability", False),
        MetamodelType("BusinessProcess", False),
        MetamodelType("Organization", False, subtypes=["team"]),
        MetamodelType("Server", True),
    ]
    metamodel_relation_types = [
        MetamodelRelationType("relAppToBC", "Application", "BusinessCapability", "supports"),
        MetamodelRelationType("relAppSuccessor", "Application", "Application", "succeeds"),
        MetamodelRelationType("relProcessToApp", "BusinessProcess", "Application", "uses"),
        MetamodelRelationType("relOrgToApp", "Organization", "Application", "uses"),
        MetamodelRelationType("relServerToApp", "Server", "Application", "hosts"),
    ]
    return MigrationSnapshot(
        version="turbo-ea",
        entities=entities,
        relations=relations,
        subscriptions=subscriptions,
        tags=tags,
        documents=documents,
        comments=comments,
        users=[],
        metamodel_types=metamodel_types,
        metamodel_relation_types=metamodel_relation_types,
    )


def empty_snapshot(version: str = "empty") -> MigrationSnapshot:
    return MigrationSnapshot(
        version=version,
        entities=[],
        relations=[],
        subscriptions=[],
        tags=[],
        documents=[],
        comments=[],
        users=[],
        metamodel_types=[],
        metamodel_relation_types=[],
    )


# ---------------------------------------------------------------------------
# An adapter that needs no file
# ---------------------------------------------------------------------------


class InMemorySource:
    """A :class:`MigrationSource` whose snapshot is handed in.

    Mappings default to the identity over the snapshot's own type and
    relation names, which is what a source already speaking Turbo EA
    vocabulary looks like; pass explicit tables to exercise mapping.
    ``parse_error`` makes ``parse()`` raise, for the failure paths.
    ``key`` must fit ``migrations.source_type`` (``String(20)``).
    """

    label = "In-memory source"
    accepted_extensions: tuple[str, ...] = (".json",)
    auto_mapped_columns: tuple[tuple[str, str], ...] = (("displayName", "Name"),)

    def __init__(
        self,
        snapshot: MigrationSnapshot,
        *,
        key: str = "inmem",
        type_mapping: dict[str, str] | None = None,
        relation_mapping: dict[str, str] | None = None,
        flip_direction: frozenset[str] = frozenset(),
        field_type_mapping: dict[str, str] | None = None,
        hierarchy_relations: frozenset[str] | None = None,
        parse_error: BaseException | None = None,
        role_map: dict[str, str] | None = None,
    ) -> None:
        assert len(key) <= 20, "migrations.source_type is String(20)"
        self.key = key
        self.snapshot = snapshot
        self.parse_error = parse_error
        self.type_mapping = (
            type_mapping
            if type_mapping is not None
            else {t.name: t.name for t in snapshot.metamodel_types}
            | {e.type: e.type for e in snapshot.entities}
        )
        self.relation_mapping = (
            relation_mapping
            if relation_mapping is not None
            else {rt.name: rt.name for rt in snapshot.metamodel_relation_types}
            | {r.type: r.type for r in snapshot.relations}
        )
        self.flip_direction = flip_direction
        self.field_type_mapping = field_type_mapping if field_type_mapping is not None else {}
        if hierarchy_relations is not None:
            self.hierarchy_relations = hierarchy_relations
        self.role_map = role_map or {}
        self.parsed_paths: list[Path] = []

    def validate_payload(self, head: bytes) -> bool:
        return True

    def parse(self, path: str | Path) -> MigrationSnapshot:
        self.parsed_paths.append(Path(path))
        if self.parse_error is not None:
            raise self.parse_error
        return self.snapshot

    def post_build_card_payload(
        self, entity: SourceEntity, target_type: str, payload: dict[str, Any]
    ) -> None:
        return None

    def map_subscription_role(self, role_name: str | None, role_type: str | None) -> str:
        if role_name and role_name.lower() in self.role_map:
            return self.role_map[role_name.lower()]
        if (role_type or "").upper() == "OBSERVER":
            return "observer"
        return "responsible"


# ---------------------------------------------------------------------------
# Database helpers (flush, never commit)
# ---------------------------------------------------------------------------


async def migration_metamodel(db) -> dict[str, Any]:
    """The built-in part of the metamodel :func:`sample_snapshot` lands on:
    four card types, four relation types and the ``responsible`` /
    ``observer`` stakeholder roles on Application."""
    from tests.conftest import create_card_type, create_relation_type, create_stakeholder_role_def

    types = {}
    for key, label, hierarchy in (
        ("Application", "Application", True),
        ("BusinessCapability", "Business Capability", True),
        ("BusinessProcess", "Business Process", True),
        ("Organization", "Organization", True),
    ):
        types[key] = await create_card_type(
            db,
            key=key,
            label=label,
            built_in=True,
            has_hierarchy=hierarchy,
            fields_schema=(
                [
                    {
                        "section": "General",
                        "fields": [
                            {"key": "costTotalAnnual", "label": "Annual cost", "type": "cost"},
                            {
                                "key": "hostingType",
                                "label": "Hosting",
                                "type": "single_select",
                                "options": [{"key": "cloud", "label": "Cloud"}],
                            },
                        ],
                    }
                ]
                if key == "Application"
                else []
            ),
        )
    rels = {}
    for key, src, tgt, label in (
        ("relAppToBC", "Application", "BusinessCapability", "supports"),
        ("relAppSuccessor", "Application", "Application", "succeeds"),
        ("relProcessToApp", "BusinessProcess", "Application", "uses"),
        ("relOrgToApp", "Organization", "Application", "uses"),
    ):
        rels[key] = await create_relation_type(
            db, key=key, label=label, source_type_key=src, target_type_key=tgt, built_in=True
        )
    roles = {}
    for role_key, label in (("responsible", "Responsible"), ("observer", "Observer")):
        roles[role_key] = await create_stakeholder_role_def(
            db, card_type_key="Application", key=role_key, label=label
        )
    return {"types": types, "relation_types": rels, "roles": roles}


async def make_migration(
    db,
    *,
    source_type: str = "inmem",
    status: str = "uploaded",
    user=None,
    include_archived: bool = False,
    name: str = "import.json",
    storage_path: str | None = None,
    field_mappings: dict | None = None,
):
    """Insert a ``migrations`` row the way ``POST /migration/upload`` does."""
    from app.models.migration import Migration

    payload = f"{name}-{uuid.uuid4().hex}".encode()
    m = Migration(
        name=name,
        source_type=source_type,
        file_hash=hashlib.sha256(payload).hexdigest(),
        file_size=len(payload),
        storage_path=storage_path,
        status=status,
        stats={"options": {"include_archived": include_archived}},
        field_mappings=field_mappings or {},
        created_by=user.id if user is not None else None,
    )
    db.add(m)
    await db.flush()
    return m


async def stage_all(db, migration, source, snapshot, *, include_archived: bool = False) -> dict:
    """Run the seven staging passes in the order the parse job runs them
    (``app/api/v1/migration.py``) and mark the migration ``parsed``."""
    from app.services.migration.staging import (
        stage_cards,
        stage_comments,
        stage_documents,
        stage_metamodel,
        stage_relations,
        stage_tags,
        stage_users_and_subscriptions,
    )

    migration.snapshot_version = snapshot.version
    stats = {
        "metamodel": await stage_metamodel(db, migration, source, snapshot),
        "cards": await stage_cards(
            db, migration, source, snapshot, include_archived=include_archived
        ),
        "relations": await stage_relations(db, migration, source, snapshot),
        "tags": await stage_tags(db, migration, source, snapshot),
    }
    stats["users"], stats["subscriptions"] = await stage_users_and_subscriptions(
        db, migration, source, snapshot
    )
    stats["documents"] = await stage_documents(db, migration, source, snapshot)
    stats["comments"] = await stage_comments(db, migration, source, snapshot)
    migration.stats = {**(migration.stats or {}), **stats}
    migration.status = "parsed"
    await db.flush()
    return stats


async def staged_rows(db, migration, entity_kind: str | None = None, *, action: str | None = None):
    """The migration's staged records, optionally filtered, in source-id order."""
    from sqlalchemy import select

    from app.models.migration import StagedRecord

    stmt = select(StagedRecord).where(StagedRecord.migration_id == migration.id)
    if entity_kind is not None:
        stmt = stmt.where(StagedRecord.entity_kind == entity_kind)
    if action is not None:
        stmt = stmt.where(StagedRecord.action == action)
    rows = (await db.execute(stmt)).scalars().all()
    return sorted(rows, key=lambda r: (r.entity_kind, r.source_id))
