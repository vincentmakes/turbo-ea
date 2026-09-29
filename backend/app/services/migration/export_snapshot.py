"""Collect the workspace into a :class:`MigrationSnapshot` for a platform export.

The importer reads a foreign platform's export into the source-neutral
dataclasses in :mod:`app.services.migration.snapshot` and stages them.
The exporter is the mirror image: this module reads the Turbo EA
inventory into the **same** dataclasses — in Turbo EA vocabulary, i.e.
``SourceEntity.type`` is a card-type key and ``Relation.type`` is a
relation-type key — and a source adapter's ``export()`` hook translates
that snapshot into the foreign platform's file format. Keeping the
database read here and the platform spelling in the adapter is what
lets a second exporter (Ardoq, HOPEX, …) reuse everything but the
writer.

Read-scope posture: like the workspace bundle export (``build_bundle``),
this is a full-landscape administrative export gated on
``admin.export_workspace`` and deliberately outside ``CardReadScope`` —
the file is the whole workspace or it is not an export.
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.models.card_type import CardType
from app.models.comment import Comment as CommentRow
from app.models.document import Document as DocumentRow
from app.models.relation import Relation as RelationRow
from app.models.relation_type import RelationType
from app.models.stakeholder import Stakeholder
from app.models.stakeholder_role_definition import StakeholderRoleDefinition
from app.models.tag import CardTag, TagGroup
from app.models.tag import Tag as TagRow
from app.models.user import User
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
    UserRef,
)

SNAPSHOT_VERSION = "turbo-ea"

# LeanIX names the hierarchy path with this separator in ``displayName``
# ("Sales / Lead Management"). It is also what makes a
# ``(displayName, type)`` relation endpoint unique: Turbo EA enforces
# unique names among siblings, so the full path is unique per type.
DISPLAY_PATH_SEPARATOR = " / "

# ``approval_status`` → the quality-seal vocabulary the importer's
# ``qualitySeal`` column carries.
_QUALITY_SEAL = {
    "APPROVED": "APPROVED",
    "BROKEN": "BROKEN_QUALITY_SEAL",
}


async def build_export_snapshot(
    db: AsyncSession, *, include_archived: bool = False
) -> MigrationSnapshot:
    """Read the inventory, metamodel, tags, stakeholders, documents and comments.

    A handful of whole-table ``select`` calls, no per-row queries.
    Archived cards are left out unless ``include_archived`` is set, and
    so is every relation, tag link, stakeholder, document or comment
    that hangs off an excluded card.
    """
    card_types = list((await db.execute(select(CardType).order_by(CardType.sort_order))).scalars())
    relation_types = list(
        (await db.execute(select(RelationType).order_by(RelationType.sort_order))).scalars()
    )

    card_query = select(Card)
    if not include_archived:
        card_query = card_query.where(Card.status != "ARCHIVED")
    cards = list((await db.execute(card_query.order_by(Card.type, Card.name))).scalars())
    card_by_id = {c.id: c for c in cards}

    relations = list((await db.execute(select(RelationRow))).scalars())
    tag_groups = list((await db.execute(select(TagGroup).order_by(TagGroup.name))).scalars())
    tags = list(
        (await db.execute(select(TagRow).order_by(TagRow.sort_order, TagRow.name))).scalars()
    )
    card_tags = list((await db.execute(select(CardTag))).scalars())
    stakeholders = list((await db.execute(select(Stakeholder))).scalars())
    role_defs = list((await db.execute(select(StakeholderRoleDefinition))).scalars())
    documents = list((await db.execute(select(DocumentRow))).scalars())
    comments = list(
        (await db.execute(select(CommentRow).order_by(CommentRow.created_at))).scalars()
    )
    users = list((await db.execute(select(User))).scalars())

    return build_snapshot_from_rows(
        card_types=card_types,
        relation_types=relation_types,
        cards=cards,
        relations=[r for r in relations if r.source_id in card_by_id and r.target_id in card_by_id],
        tag_groups=tag_groups,
        tags=tags,
        card_tags=[ct for ct in card_tags if ct.card_id in card_by_id],
        stakeholders=[s for s in stakeholders if s.card_id in card_by_id],
        role_defs=role_defs,
        documents=[d for d in documents if d.card_id in card_by_id],
        comments=[c for c in comments if c.card_id in card_by_id],
        users=users,
    )


def build_snapshot_from_rows(
    *,
    card_types: list[CardType],
    relation_types: list[RelationType],
    cards: list[Card],
    relations: list[RelationRow],
    tag_groups: list[TagGroup],
    tags: list[TagRow],
    card_tags: list[CardTag],
    stakeholders: list[Stakeholder],
    role_defs: list[StakeholderRoleDefinition],
    documents: list[DocumentRow],
    comments: list[CommentRow],
    users: list[User],
) -> MigrationSnapshot:
    """Pure assembly step — separated from the queries so it can be unit-tested."""
    card_by_id = {c.id: c for c in cards}
    user_by_id = {u.id: u for u in users}
    type_by_key = {t.key: t for t in card_types}

    # ---- Cards -----------------------------------------------------------
    tags_of_card: dict[uuid.UUID, list[str]] = defaultdict(list)
    for ct in card_tags:
        tags_of_card[ct.card_id].append(str(ct.tag_id))

    display_names = _display_paths(cards)
    entities: list[SourceEntity] = []
    for card in cards:
        custom_fields: dict[str, Any] = dict(card.attributes or {})
        if card.external_id:
            custom_fields["externalId"] = card.external_id
        if card.alias:
            custom_fields["alias"] = card.alias
        entities.append(
            SourceEntity(
                source_id=str(card.id),
                type=card.type,
                name=card.name,
                display_name=display_names[card.id],
                category=card.subtype,
                description=card.description,
                lifecycle={k: v for k, v in (card.lifecycle or {}).items() if v},
                tags=tags_of_card.get(card.id, []),
                parent_id=(
                    str(card.parent_id) if card.parent_id and card.parent_id in card_by_id else None
                ),
                custom_fields=custom_fields,
                quality_seal=_QUALITY_SEAL.get(card.approval_status or "", "DRAFT"),
                completion=round((card.data_quality or 0.0) / 100.0, 4),
                status=card.status or "ACTIVE",
                raw={
                    "createdAt": card.created_at.isoformat() if card.created_at else None,
                    "updatedAt": card.updated_at.isoformat() if card.updated_at else None,
                },
            )
        )

    # ---- Relations -------------------------------------------------------
    rel_out: list[Relation] = []
    for rel in relations:
        attributes = dict(rel.attributes or {})
        if rel.description:
            attributes["description"] = rel.description
        rel_out.append(
            Relation(
                source_id=str(rel.id),
                type=rel.type,
                from_entity_id=str(rel.source_id),
                to_entity_id=str(rel.target_id),
                attributes=attributes,
            )
        )

    # ---- Stakeholders → subscriptions ----------------------------------
    role_label = _role_label_index(card_types, role_defs)
    subscriptions: list[Subscription] = []
    for sh in stakeholders:
        user = user_by_id.get(sh.user_id)
        card = card_by_id.get(sh.card_id)
        if user is None or card is None or not user.email:
            continue
        role_type = "OBSERVER" if sh.role == "observer" else "RESPONSIBLE"
        role_name = role_label.get((card.type, sh.role)) or _humanise_key(sh.role)
        subscriptions.append(
            Subscription(
                source_id=str(sh.id),
                entity_id=str(sh.card_id),
                user_email=user.email,
                user_display_name=user.display_name,
                role_name=role_name,
                role_type=role_type,
            )
        )

    # ---- Tags ------------------------------------------------------------
    group_by_id = {g.id: g for g in tag_groups}
    tag_out: list[Tag] = []
    for tag in tags:
        group = group_by_id.get(tag.tag_group_id)
        if group is None:
            continue
        tag_out.append(
            Tag(
                source_id=str(tag.id),
                name=tag.name,
                group_name=group.name,
                group_mode="SINGLE" if group.mode == "single" else "MULTIPLE",
                color=tag.color,
                group_restrict_to_types=list(group.restrict_to_types or []) or None,
            )
        )

    # ---- Documents + comments -------------------------------------------
    doc_out = [
        Document(
            source_id=str(d.id),
            entity_id=str(d.card_id),
            name=d.name,
            url=d.url,
            raw={"type": d.type},
        )
        for d in documents
    ]
    comment_out: list[Comment] = []
    for c in comments:
        author = user_by_id.get(c.user_id)
        comment_out.append(
            Comment(
                source_id=str(c.id),
                entity_id=str(c.card_id),
                author_email=author.email if author else None,
                body=c.content,
                created_at=c.created_at,
                raw={"parent_id": str(c.parent_id)} if c.parent_id else {},
            )
        )

    # ---- Users referenced anywhere ---------------------------------------
    seen_emails: dict[str, UserRef] = {}
    for sub in subscriptions:
        email = (sub.user_email or "").lower()
        if email and email not in seen_emails:
            seen_emails[email] = UserRef(
                source_id=email, email=email, display_name=sub.user_display_name
            )
    for cm in comment_out:
        email = (cm.author_email or "").lower()
        if email and email not in seen_emails:
            author = next((u for u in users if (u.email or "").lower() == email), None)
            seen_emails[email] = UserRef(
                source_id=email,
                email=email,
                display_name=author.display_name if author else None,
            )

    # ---- Metamodel -------------------------------------------------------
    used_types = {e.type for e in entities}
    metamodel_types = [
        _metamodel_type(t) for t in card_types if t.key in used_types or not t.is_hidden
    ]
    used_relation_types = {r.type for r in rel_out}
    metamodel_relation_types = [
        MetamodelRelationType(
            name=rt.key,
            source_type=rt.source_type_key,
            target_type=rt.target_type_key,
            label=rt.label,
            attributes_schema=list(rt.attributes_schema or []),
            is_custom=not rt.built_in,
        )
        for rt in relation_types
        if rt.key in used_relation_types or not rt.is_hidden
    ]
    # A card whose type row is gone (should not happen, but a snapshot
    # must never be internally inconsistent) still gets a type entry.
    for key in sorted(used_types - set(type_by_key)):
        metamodel_types.append(MetamodelType(name=key, is_custom=True))

    return MigrationSnapshot(
        version=SNAPSHOT_VERSION,
        entities=entities,
        relations=rel_out,
        subscriptions=subscriptions,
        tags=tag_out,
        documents=doc_out,
        comments=comment_out,
        users=list(seen_emails.values()),
        metamodel_types=metamodel_types,
        metamodel_relation_types=metamodel_relation_types,
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _display_paths(cards: list[Card]) -> dict[uuid.UUID, str]:
    """``displayName`` per card: the ancestor names joined with `` / ``.

    Ancestors outside the exported set (an archived parent when archived
    cards are excluded) are skipped, so the path stays a chain of names
    the file actually contains. A cycle — impossible through the API,
    but a snapshot must not hang on bad data — stops the walk.
    """
    by_id = {c.id: c for c in cards}
    out: dict[uuid.UUID, str] = {}
    for card in cards:
        parts = [card.name]
        seen = {card.id}
        cursor = card.parent_id
        while cursor is not None and cursor in by_id and cursor not in seen:
            seen.add(cursor)
            parent = by_id[cursor]
            parts.append(parent.name)
            cursor = parent.parent_id
        out[card.id] = DISPLAY_PATH_SEPARATOR.join(reversed(parts))
    return out


def _role_label_index(
    card_types: list[CardType], role_defs: list[StakeholderRoleDefinition]
) -> dict[tuple[str, str], str]:
    """``(card_type_key, role_key) → label`` — definition table first, legacy JSONB second."""
    index: dict[tuple[str, str], str] = {}
    for ct in card_types:
        for role in ct.stakeholder_roles or []:
            key = role.get("key") if isinstance(role, dict) else None
            label = role.get("label") if isinstance(role, dict) else None
            if key and label:
                index[(ct.key, key)] = label
    for rd in role_defs:
        index[(rd.card_type_key, rd.key)] = rd.label
    return index


def _humanise_key(key: str) -> str:
    """``itProjectManager`` → ``It Project Manager`` (fallback when no label exists)."""
    out: list[str] = []
    for ch in key:
        if ch.isupper() and out and not out[-1].isspace():
            out.append(" ")
        out.append(ch)
    text = "".join(out).replace("_", " ").strip()
    return " ".join(w[:1].upper() + w[1:] for w in text.split())


def _metamodel_type(ct: CardType) -> MetamodelType:
    fields: list[MetamodelField] = []
    for section in ct.fields_schema or []:
        for f in section.get("fields") or []:
            key = f.get("key")
            if not key:
                continue
            fields.append(
                MetamodelField(
                    type_name=ct.key,
                    key=key,
                    label=f.get("label") or key,
                    data_type=f.get("type") or "text",
                    options=[
                        {"key": o.get("key"), "label": o.get("label") or o.get("key")}
                        for o in (f.get("options") or [])
                        if isinstance(o, dict) and o.get("key")
                    ],
                    translations=dict(f.get("translations") or {}),
                    is_custom=not ct.built_in,
                )
            )
    return MetamodelType(
        name=ct.key,
        is_custom=not ct.built_in,
        fields=fields,
        subtypes=[
            s.get("key") for s in (ct.subtypes or []) if isinstance(s, dict) and s.get("key")
        ],
    )
