"""Source-neutral migration staging pipeline.

Turns a parsed :class:`MigrationSnapshot` into a set of
:class:`StagedRecord` rows the admin can review before applying.
Covers **cards + relations + tags + users + subscriptions + documents
+ comments + custom metamodel**.

The staging layer is responsible for:

1. **Identity resolution**. For every entity, look up the
   ``migration_identity_map`` first. If miss, fall back to
   ``cards.external_id``. If still miss, fall back to ``(name, type)``.
   The first hit gives a ``target_id`` and ``action='update'``; no hit
   gives ``action='create'``.

2. **Type / relation mapping**. Translate the source's native names
   into matching Turbo EA card-type / relation-type keys via the
   adapter's ``type_mapping`` / ``relation_mapping`` dicts. Unknown
   names are surfaced as ``metamodel_*`` staged rows (the apply
   pipeline's metamodel passes wire them into a new non-builtin type).

3. **Diff computation**. For ``update`` rows, walk the source payload
   and compute a ``{field: {old, new}}`` map so the UI can render a
   three-column diff.

The service is idempotent: running it twice for the same migration
clears and rewrites staged rows so admins can iterate.
"""

from __future__ import annotations

import hashlib
import logging
import uuid
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.models.migration import IdentityMap, Migration, StagedRecord
from app.models.relation import Relation as RelationModel
from app.models.tag import Tag as TagModel
from app.models.tag import TagGroup
from app.models.user import User
from app.services.migration.protocol import MigrationSource
from app.services.migration.snapshot import MigrationSnapshot, SourceEntity

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Mapping helpers (delegate to the adapter)
# ---------------------------------------------------------------------------


def map_type(source: MigrationSource, native_type: str) -> str | None:
    """Return the Turbo EA card-type key for a native type, or ``None`` if unknown."""
    return source.type_mapping.get(native_type)


def map_relation(source: MigrationSource, native_rel: str) -> str | None:
    """Return the Turbo EA relation-type key for a native relation, or ``None``.

    Hierarchy edges (the adapter's ``hierarchy_relations`` set)
    intentionally return ``None`` — the parser already projects them
    onto ``SourceEntity.parent_id`` so they should not be staged as
    relations.
    """
    hierarchy: frozenset[str] = getattr(source, "hierarchy_relations", frozenset())
    if native_rel in hierarchy:
        return None
    return source.relation_mapping.get(native_rel)


def infer_field_type(source: MigrationSource, native_data_type: str) -> str | None:
    """Map a native field dataType to a Turbo EA fields_schema ``type``.

    Reference-style data types (LeanIX's ``FACT_SHEET_REFERENCE``)
    deliberately return ``None`` — the staging pipeline converts them
    into ``metamodel_relation_type`` staged rows.
    """
    if native_data_type == "FACT_SHEET_REFERENCE":
        return None
    return source.field_type_mapping.get((native_data_type or "").upper())


# ---------------------------------------------------------------------------
# Card payload builder
# ---------------------------------------------------------------------------


def build_card_payload(
    source: MigrationSource,
    entity: SourceEntity,
    target_type: str,
) -> dict[str, Any]:
    """Map a SourceEntity to a ``cards`` row create-payload.

    The payload uses the Turbo EA Card model column names directly.
    Custom (un-mapped) fields land in ``attributes`` keyed by their
    native field-name — the metamodel-extension pass is what makes
    those keys first-class on the target card type.

    Source-specific quirks (LeanIX's UserGroup → Organization team
    subtype, etc.) are applied via the adapter's
    ``post_build_card_payload`` hook.
    """
    payload: dict[str, Any] = {
        "type": target_type,
        "name": entity.name or entity.display_name or entity.source_id,
        "description": entity.description,
        "external_id": entity.source_id,
        "lifecycle": entity.lifecycle or {},
        "attributes": dict(entity.custom_fields),
        # An archived entity the admin opted in to (``include_archived``)
        # lands archived, not as a live card.
        "status": "ARCHIVED" if (entity.status or "").upper() == "ARCHIVED" else "ACTIVE",
        "approval_status": "DRAFT",
    }
    if entity.category:
        payload["subtype"] = entity.category
    source.post_build_card_payload(entity, target_type, payload)
    return payload


# ---------------------------------------------------------------------------
# Diff against an existing card
# ---------------------------------------------------------------------------


_DIFF_FIELDS = ("name", "description", "subtype", "external_id")


def compute_card_diff(payload: dict[str, Any], existing: Card) -> dict[str, dict[str, Any]]:
    diff: dict[str, dict[str, Any]] = {}
    for field in _DIFF_FIELDS:
        new = payload.get(field)
        old = getattr(existing, field, None)
        if (new or None) != (old or None):
            diff[field] = {"old": old, "new": new}
    if (payload.get("lifecycle") or {}) != (existing.lifecycle or {}):
        diff["lifecycle"] = {"old": existing.lifecycle, "new": payload.get("lifecycle")}
    # Attribute-level diff — only surface keys that actually changed.
    new_attrs = payload.get("attributes") or {}
    old_attrs = existing.attributes or {}
    attr_diff = {}
    for k, v in new_attrs.items():
        if old_attrs.get(k) != v:
            attr_diff[k] = {"old": old_attrs.get(k), "new": v}
    if attr_diff:
        diff["attributes"] = attr_diff
    return diff


# ---------------------------------------------------------------------------
# Identity resolution
# ---------------------------------------------------------------------------


async def _resolve_existing_card(
    db: AsyncSession,
    source_type: str,
    source_id: str,
    name: str,
    target_type: str,
) -> Card | None:
    # 1. Identity-map hit (fastest, survives across imports).
    im_row = (
        await db.execute(
            select(IdentityMap).where(
                IdentityMap.source_id == source_id,
                IdentityMap.entity_kind == "card",
                IdentityMap.source_type == source_type,
            )
        )
    ).scalar_one_or_none()
    if im_row is not None:
        card = (
            await db.execute(select(Card).where(Card.id == im_row.target_id))
        ).scalar_one_or_none()
        if card is not None:
            return card
        # Dangling pointer — the target card was deleted out from under
        # us (admin bulk-delete in the UI, manual SQL, etc.). Drop the
        # stale identity-map row so this re-import lands as a fresh
        # create instead of silently skipping.
        await db.delete(im_row)
        await db.flush()

    # 2. ``cards.external_id`` fallback (works even if identity map was wiped).
    card = (
        await db.execute(select(Card).where(Card.external_id == source_id))
    ).scalar_one_or_none()
    if card is not None:
        return card

    # 3. ``(name, type)`` last-resort. Only safe if the name happens to
    # be unique within the target type — otherwise we risk overwriting
    # the wrong card. Conservative choice: pick the oldest match.
    rows = (
        (
            await db.execute(
                select(Card)
                .where(Card.name == name, Card.type == target_type)
                .order_by(Card.created_at.asc())
                .limit(1)
            )
        )
        .scalars()
        .all()
    )
    return rows[0] if rows else None


# ---------------------------------------------------------------------------
# Card staging
# ---------------------------------------------------------------------------


async def stage_cards(
    db: AsyncSession,
    migration: Migration,
    source: MigrationSource,
    snapshot: MigrationSnapshot,
    include_archived: bool = False,
) -> dict[str, int]:
    """Stage every entity from the snapshot into ``staged_records``.

    Archived (soft-deleted in the source) entities are **skipped by
    default**. Pass ``include_archived=True`` if the customer wants to
    import them too — they land with Turbo EA ``status='ARCHIVED'``.
    """
    # Reset any prior staging rows for this migration.
    await db.execute(
        delete(StagedRecord).where(
            StagedRecord.migration_id == migration.id,
            StagedRecord.entity_kind == "card",
        )
    )

    stats = {"create": 0, "update": 0, "skip": 0, "conflict": 0, "unknown_type": 0, "archived": 0}

    # Native entity types the parser surfaced as a custom
    # ``MetamodelType`` (i.e. no entry in the adapter's
    # ``type_mapping``) — the ``metamodel_type`` apply pass will create
    # a new Turbo EA card type with ``key = native_type_name``, so
    # staging the cards with ``target_type = entity.type`` in the same
    # migration makes them apply cleanly without a manual second pass.
    synthesised_types: set[str] = {
        mt.name
        for mt in snapshot.metamodel_types
        if mt.is_custom and mt.name not in source.type_mapping
    }

    for entity in snapshot.entities:
        # Skip archived entities by default — admin opts in via include_archived.
        if (entity.status or "").upper() == "ARCHIVED" and not include_archived:
            stats["archived"] += 1
            continue
        target_type = map_type(source, entity.type)
        if target_type is None and entity.type in synthesised_types:
            # New tenant card type — apply pass will create it; route
            # the card to the about-to-be-created key.
            target_type = entity.type
        if target_type is None:
            # Unknown native type that isn't synthesised either (e.g. a
            # type observed only in a relation row but missing from the
            # entity sheets). Stage as conflict so the admin sees it.
            stats["unknown_type"] += 1
            db.add(
                StagedRecord(
                    id=uuid.uuid4(),
                    migration_id=migration.id,
                    source_type=migration.source_type,
                    entity_kind="card",
                    source_id=entity.source_id,
                    source_data=_entity_as_dict(entity),
                    card_type_key=None,
                    action="conflict",
                    diff={"reason": f"Unmapped {source.label} type '{entity.type}'"},
                    parent_source_id=entity.parent_id,
                )
            )
            continue

        payload = build_card_payload(source, entity, target_type)
        existing = await _resolve_existing_card(
            db, migration.source_type, entity.source_id, payload["name"], target_type
        )

        if existing is None:
            action = "create"
            diff = None
            target_id = None
        else:
            action = "update"
            diff = compute_card_diff(payload, existing)
            target_id = existing.id
            if not diff:
                action = "skip"
        stats[action] += 1

        db.add(
            StagedRecord(
                id=uuid.uuid4(),
                migration_id=migration.id,
                source_type=migration.source_type,
                entity_kind="card",
                source_id=entity.source_id,
                source_data={"payload": payload, "raw": _entity_as_dict(entity)},
                card_type_key=target_type,
                action=action,
                diff=diff,
                target_id=target_id,
                parent_source_id=entity.parent_id,
            )
        )

    await db.flush()
    return stats


def _entity_as_dict(entity: SourceEntity) -> dict[str, Any]:
    return {
        "source_id": entity.source_id,
        "type": entity.type,
        "name": entity.name,
        "category": entity.category,
        "lifecycle": entity.lifecycle,
        "custom_fields": entity.custom_fields,
        "parent_id": entity.parent_id,
    }


# ---------------------------------------------------------------------------
# Relation staging
# ---------------------------------------------------------------------------


async def stage_relations(
    db: AsyncSession,
    migration: Migration,
    source: MigrationSource,
    snapshot: MigrationSnapshot,
) -> dict[str, int]:
    """Stage every relation from the snapshot into ``staged_records``.

    A relation is **only** stageable if both endpoints exist as staged
    card rows in this migration (or already resolved via the identity
    map). Dangling endpoints land as ``action='conflict'`` so the
    admin can see what was dropped and why.
    """
    await db.execute(
        delete(StagedRecord).where(
            StagedRecord.migration_id == migration.id,
            StagedRecord.entity_kind == "relation",
        )
    )

    stats = {"create": 0, "update": 0, "skip": 0, "conflict": 0, "unknown_type": 0}

    # Pre-build a fast index of card-staged rows so each relation's
    # source/target can be resolved without a per-relation roundtrip.
    staged_cards = (
        (
            await db.execute(
                select(StagedRecord).where(
                    StagedRecord.migration_id == migration.id,
                    StagedRecord.entity_kind == "card",
                )
            )
        )
        .scalars()
        .all()
    )
    in_snapshot: set[str] = {row.source_id for row in staged_cards}

    # Native relation types the parser surfaced as ``MetamodelRelationType``
    # (custom, not in the adapter's relation_mapping) — when one of these
    # is hit, the ``metamodel_relation_type`` apply pass will create a
    # new Turbo EA relation_type keyed by the native name, so staging
    # the relation with ``tea_type = rel.type`` makes it apply cleanly
    # in the same run.
    synthesised_rel_types: set[str] = {
        rt.name
        for rt in snapshot.metamodel_relation_types
        if rt.is_custom and rt.name not in source.relation_mapping
    }

    hierarchy_relations: frozenset[str] = getattr(source, "hierarchy_relations", frozenset())

    for rel in snapshot.relations:
        # Skip hierarchy edges — already folded into Card.parent_id.
        if rel.type in hierarchy_relations:
            continue

        tea_type = map_relation(source, rel.type)
        if tea_type is None and rel.type in synthesised_rel_types:
            # New tenant relation type — the metamodel pass will create
            # the matching Turbo EA RelationType with ``key = rel.type``.
            tea_type = rel.type
        if tea_type is None:
            stats["unknown_type"] += 1
            db.add(
                StagedRecord(
                    id=uuid.uuid4(),
                    migration_id=migration.id,
                    source_type=migration.source_type,
                    entity_kind="relation",
                    source_id=rel.source_id,
                    source_data={
                        "from_entity_id": rel.from_entity_id,
                        "to_entity_id": rel.to_entity_id,
                        "native_type": rel.type,
                    },
                    action="conflict",
                    diff={"reason": f"Unmapped {source.label} relation type '{rel.type}'"},
                )
            )
            continue

        # Successor relations encode "X has successor Y" with the older
        # entity as ``from`` in the source. Turbo EA's matching
        # ``rel*Successor`` edge is the opposite — ``source succeeds
        # target``. Swap once here so the rest of the pipeline
        # (endpoint resolution, dedup lookup, staged-row preview,
        # apply, frontend) all sees TEA's convention.
        src_native_id, tgt_native_id = rel.from_entity_id, rel.to_entity_id
        if rel.type in source.flip_direction:
            src_native_id, tgt_native_id = tgt_native_id, src_native_id

        # Endpoint resolution: both ends must end up as Turbo EA card UUIDs.
        src_target_id = await _resolve_endpoint_card_id(
            db, migration.source_type, src_native_id, in_snapshot
        )
        tgt_target_id = await _resolve_endpoint_card_id(
            db, migration.source_type, tgt_native_id, in_snapshot
        )
        if src_target_id is None or tgt_target_id is None:
            stats["conflict"] += 1
            missing = []
            if src_target_id is None:
                missing.append(f"source={src_native_id}")
            if tgt_target_id is None:
                missing.append(f"target={tgt_native_id}")
            db.add(
                StagedRecord(
                    id=uuid.uuid4(),
                    migration_id=migration.id,
                    source_type=migration.source_type,
                    entity_kind="relation",
                    source_id=rel.source_id,
                    source_data={
                        "from_entity_id": src_native_id,
                        "to_entity_id": tgt_native_id,
                        "native_type": rel.type,
                        "tea_type": tea_type,
                        "attributes": rel.attributes,
                    },
                    action="conflict",
                    diff={"reason": "Endpoint not staged: " + ", ".join(missing)},
                )
            )
            continue

        # Does an equivalent relation already exist? Match on
        # (type, source_id, target_id) — Turbo EA relations are not
        # multi-edged in the default model.
        existing_rel = (
            await db.execute(
                select(RelationModel).where(
                    RelationModel.type == tea_type,
                    RelationModel.source_id == src_target_id,
                    RelationModel.target_id == tgt_target_id,
                )
            )
        ).scalar_one_or_none()

        action: str
        diff = None
        target_id = None
        if existing_rel is None:
            action = "create"
            stats["create"] += 1
        else:
            target_id = existing_rel.id
            attr_diff = _compare_relation_attrs(rel.attributes, existing_rel.attributes or {})
            if attr_diff:
                action = "update"
                diff = {"attributes": attr_diff}
                stats["update"] += 1
            else:
                action = "skip"
                stats["skip"] += 1

        db.add(
            StagedRecord(
                id=uuid.uuid4(),
                migration_id=migration.id,
                source_type=migration.source_type,
                entity_kind="relation",
                source_id=rel.source_id,
                source_data={
                    "native_type": rel.type,
                    "tea_type": tea_type,
                    "from_entity_id": src_native_id,
                    "to_entity_id": tgt_native_id,
                    "attributes": rel.attributes,
                    # Resolved endpoint UUIDs are cached on the staged
                    # row so the apply pass doesn't have to redo the
                    # identity lookup.
                    "tea_source_card_id": str(src_target_id),
                    "tea_target_card_id": str(tgt_target_id),
                },
                card_type_key=tea_type,
                action=action,
                diff=diff,
                target_id=target_id,
            )
        )

    await db.flush()
    return stats


async def _resolve_endpoint_card_id(
    db: AsyncSession,
    source_type: str,
    source_id: str,
    in_snapshot: set[str],
) -> uuid.UUID | None:
    """Resolve a source entity id to a Turbo EA card UUID.

    Looks in the persistent identity map first, then in the
    staged-row table for this migration (in case the card hasn't been
    applied yet — endpoints will materialise during the apply pass).
    Returns ``None`` if the endpoint is dangling.
    """
    # Identity map first (covers already-applied cards from earlier imports).
    im = (
        await db.execute(
            select(IdentityMap).where(
                IdentityMap.source_id == source_id,
                IdentityMap.entity_kind == "card",
                IdentityMap.source_type == source_type,
            )
        )
    ).scalar_one_or_none()
    if im is not None:
        return im.target_id
    # Card hasn't been applied yet — endpoint will resolve at apply
    # time. Return a stable placeholder UUID (zero-UUID) so the staged
    # row is materialised; apply re-resolves before INSERT.
    if source_id in in_snapshot:
        return uuid.UUID("00000000-0000-0000-0000-000000000000")
    return None


def _compare_relation_attrs(
    new_attrs: dict[str, Any],
    old_attrs: dict[str, Any],
) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for k, v in (new_attrs or {}).items():
        if old_attrs.get(k) != v:
            out[k] = {"old": old_attrs.get(k), "new": v}
    return out


# ---------------------------------------------------------------------------
# Tag staging
# ---------------------------------------------------------------------------


async def stage_tags(
    db: AsyncSession,
    migration: Migration,
    source: MigrationSource,
    snapshot: MigrationSnapshot,
) -> dict[str, int]:
    """Stage tag groups and tags from the snapshot.

    Source platforms typically model tags as ``Tag + TagGroup`` pairs
    (single/multi mode); Turbo EA has the same shape. Tag-group create
    rows are keyed by group name (no group name → fall back to
    ``"Imported from {source label}"``); tag create rows are keyed by
    the native tag id. Apply pass materialises the groups first, then
    tags, then ``card_tags`` joins for every entity that references a
    tag.
    """
    await db.execute(
        delete(StagedRecord).where(
            StagedRecord.migration_id == migration.id,
            StagedRecord.entity_kind.in_(("tag", "tag_group", "card_tag")),
        )
    )

    stats = {"groups_create": 0, "groups_skip": 0, "tags_create": 0, "tags_skip": 0, "links": 0}
    fallback_group_name = f"Imported from {source.label}"

    # ---- Tag groups (deduped on name across the snapshot) ----
    seen_groups: dict[str, dict[str, Any]] = {}
    for tag in snapshot.tags:
        group_name = tag.group_name or fallback_group_name
        existing = seen_groups.get(group_name)
        if existing is None:
            seen_groups[group_name] = {
                "name": group_name,
                "mode": _normalise_tag_group_mode(tag.group_mode),
            }

    for group_name, payload in seen_groups.items():
        existing_group = (
            await db.execute(select(TagGroup).where(TagGroup.name == group_name))
        ).scalar_one_or_none()
        if existing_group is None:
            stats["groups_create"] += 1
            db.add(
                StagedRecord(
                    id=uuid.uuid4(),
                    migration_id=migration.id,
                    source_type=migration.source_type,
                    entity_kind="tag_group",
                    source_id=group_name,
                    source_data=payload,
                    action="create",
                )
            )
        else:
            stats["groups_skip"] += 1
            db.add(
                StagedRecord(
                    id=uuid.uuid4(),
                    migration_id=migration.id,
                    source_type=migration.source_type,
                    entity_kind="tag_group",
                    source_id=group_name,
                    source_data=payload,
                    target_id=existing_group.id,
                    action="skip",
                )
            )

    # ---- Tags ----
    for tag in snapshot.tags:
        group_name = tag.group_name or fallback_group_name
        existing_tag = await _find_existing_tag(db, tag.name, group_name)
        if existing_tag is None:
            stats["tags_create"] += 1
            action = "create"
            target_id = None
        else:
            stats["tags_skip"] += 1
            action = "skip"
            target_id = existing_tag.id
        db.add(
            StagedRecord(
                id=uuid.uuid4(),
                migration_id=migration.id,
                source_type=migration.source_type,
                entity_kind="tag",
                source_id=tag.source_id,
                source_data={
                    "name": tag.name,
                    "group_name": group_name,
                    "color": tag.color,
                },
                action=action,
                target_id=target_id,
            )
        )

    # ---- card_tag joins (one per (entity, tag) link) ----
    for entity in snapshot.entities:
        for tag_id in entity.tags:
            stats["links"] += 1
            db.add(
                StagedRecord(
                    id=uuid.uuid4(),
                    migration_id=migration.id,
                    source_type=migration.source_type,
                    entity_kind="card_tag",
                    source_id=f"{entity.source_id}:{tag_id}",
                    source_data={"entity_id": entity.source_id, "tag_id": tag_id},
                    action="create",
                )
            )

    await db.flush()
    return stats


def _looks_like_email(value: str) -> bool:
    """Lenient ``user@host`` check for the user-staging pass.

    We're not validating deliverability — only catching values that
    obviously aren't email addresses (unsplit delimiter cells like
    ``a@x.com;b@x.com``, free-text display names, header rows that
    leaked into the data). Anything with exactly one ``@``, at least
    one character on either side, and no whitespace or delimiter
    characters passes.
    """
    if not value or "@" not in value:
        return False
    if any(ch in value for ch in (";", ",", " ", "\t", "\n")):
        return False
    local, _, host = value.partition("@")
    if not local or not host or "@" in host:
        return False
    # Require at least one dot in the host (rejects ``a@b`` which is
    # syntactically valid RFC 5321 but never appears in real LeanIX
    # exports and is almost always a parser slip).
    return "." in host


def _normalise_tag_group_mode(native_mode: str | None) -> str:
    if not native_mode:
        return "multi"
    return "single" if native_mode.upper() == "SINGLE" else "multi"


async def _find_existing_tag(db: AsyncSession, name: str, group_name: str) -> TagModel | None:
    return (
        await db.execute(
            select(TagModel)
            .join(TagGroup, TagGroup.id == TagModel.tag_group_id)
            .where(TagModel.name == name, TagGroup.name == group_name)
        )
    ).scalar_one_or_none()


# ---------------------------------------------------------------------------
# User + subscription (stakeholder) staging
# ---------------------------------------------------------------------------


async def stage_users_and_subscriptions(
    db: AsyncSession,
    migration: Migration,
    source: MigrationSource,
    snapshot: MigrationSnapshot,
) -> tuple[dict[str, int], dict[str, int]]:
    """Stage every distinct user referenced in subscriptions + the subscriptions themselves.

    Users land first because subscriptions need a resolvable user UUID
    at apply-time. Users whose email already exists are skipped (the
    importer never touches existing users — re-imports respect
    locally-managed accounts). New users come in as ``is_active=False``
    until the admin manually activates them.
    """
    await db.execute(
        delete(StagedRecord).where(
            StagedRecord.migration_id == migration.id,
            StagedRecord.entity_kind.in_(("user", "subscription")),
        )
    )

    user_stats = {"create": 0, "skip": 0, "missing_email": 0, "invalid_email": 0}
    sub_stats = {"create": 0, "skip": 0, "conflict": 0}

    # ---- User pass: collect every distinct (email, display_name) ----
    distinct_users: dict[str, dict[str, Any]] = {}
    invalid_emails: dict[str, str] = {}  # raw value -> display_name candidate
    for sub in snapshot.subscriptions:
        email = (sub.user_email or "").strip().lower()
        if not email:
            user_stats["missing_email"] += 1
            continue
        if not _looks_like_email(email):
            # A malformed email (no ``@``, or an unsplit delimiter slipped
            # through — e.g. ``a@x.com;b@x.com``) must not land as a
            # user-create row. Stage it as ``conflict`` so the admin
            # sees it in the preview and can fix the source export.
            invalid_emails.setdefault(email, sub.user_display_name or email)
            continue
        if email not in distinct_users:
            distinct_users[email] = {
                "email": email,
                "display_name": sub.user_display_name or email,
            }
    # The snapshot may also expose a top-level users[] section that
    # carries users without active subscriptions — also stage those.
    for u in snapshot.users:
        if not u.email:
            continue
        if not _looks_like_email(u.email):
            invalid_emails.setdefault(u.email, u.display_name or u.email)
            continue
        if u.email not in distinct_users:
            distinct_users[u.email] = {
                "email": u.email,
                "display_name": u.display_name or u.email,
            }

    for email, payload in distinct_users.items():
        existing = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
        if existing is not None:
            user_stats["skip"] += 1
            db.add(
                StagedRecord(
                    id=uuid.uuid4(),
                    migration_id=migration.id,
                    source_type=migration.source_type,
                    entity_kind="user",
                    source_id=email,
                    source_data=payload,
                    action="skip",
                    target_id=existing.id,
                )
            )
        else:
            user_stats["create"] += 1
            db.add(
                StagedRecord(
                    id=uuid.uuid4(),
                    migration_id=migration.id,
                    source_type=migration.source_type,
                    entity_kind="user",
                    source_id=email,
                    source_data=payload,
                    action="create",
                )
            )

    for raw_email, display_name in invalid_emails.items():
        user_stats["invalid_email"] += 1
        db.add(
            StagedRecord(
                id=uuid.uuid4(),
                migration_id=migration.id,
                source_type=migration.source_type,
                entity_kind="user",
                source_id=raw_email,
                source_data={"email": raw_email, "display_name": display_name},
                action="conflict",
                diff={
                    "reason": (
                        "Malformed email — value is not a valid address (missing '@' or "
                        "delimiter not split). Fix the source export and re-upload."
                    )
                },
            )
        )

    # ---- Subscription pass ----
    for sub in snapshot.subscriptions:
        email = (sub.user_email or "").strip().lower()
        if not email or not _looks_like_email(email):
            sub_stats["conflict"] += 1
            reason = (
                "Subscription has no user email — cannot resolve"
                if not email
                else f"Subscription user email {email!r} is malformed — cannot resolve"
            )
            db.add(
                StagedRecord(
                    id=uuid.uuid4(),
                    migration_id=migration.id,
                    source_type=migration.source_type,
                    entity_kind="subscription",
                    source_id=sub.source_id or f"{sub.entity_id}:noemail",
                    source_data={
                        "entity_id": sub.entity_id,
                        "user_email": email or None,
                        "role_name": sub.role_name,
                        "role_type": sub.role_type,
                    },
                    action="conflict",
                    diff={"reason": reason},
                )
            )
            continue
        role_key = source.map_subscription_role(sub.role_name, sub.role_type)
        sub_stats["create"] += 1
        db.add(
            StagedRecord(
                id=uuid.uuid4(),
                migration_id=migration.id,
                source_type=migration.source_type,
                entity_kind="subscription",
                source_id=sub.source_id or f"{sub.entity_id}:{email}:{role_key}",
                source_data={
                    "entity_id": sub.entity_id,
                    "user_email": email,
                    "role_name": sub.role_name,
                    "role_type": sub.role_type,
                    "tea_role_key": role_key,
                },
                action="create",
            )
        )

    await db.flush()
    return user_stats, sub_stats


# ---------------------------------------------------------------------------
# Document staging
# ---------------------------------------------------------------------------


async def stage_documents(
    db: AsyncSession,
    migration: Migration,
    source: MigrationSource,
    snapshot: MigrationSnapshot,
) -> dict[str, int]:
    """Stage source documents as Turbo EA Document (URL) attachments.

    Binaries are not in the snapshot — only URLs. Anything without a
    URL is staged as ``conflict`` so the admin can see what was
    dropped.
    """
    await db.execute(
        delete(StagedRecord).where(
            StagedRecord.migration_id == migration.id,
            StagedRecord.entity_kind == "document",
        )
    )
    stats = {"create": 0, "skip": 0, "conflict": 0}
    for doc in snapshot.documents:
        if not doc.url:
            stats["conflict"] += 1
            db.add(
                StagedRecord(
                    id=uuid.uuid4(),
                    migration_id=migration.id,
                    source_type=migration.source_type,
                    entity_kind="document",
                    source_id=doc.source_id or f"{doc.entity_id}:{doc.name}",
                    source_data={
                        "entity_id": doc.entity_id,
                        "name": doc.name,
                    },
                    action="conflict",
                    diff={"reason": "Document has no URL (binary not in snapshot)"},
                )
            )
            continue
        stats["create"] += 1
        db.add(
            StagedRecord(
                id=uuid.uuid4(),
                migration_id=migration.id,
                source_type=migration.source_type,
                entity_kind="document",
                source_id=doc.source_id or f"{doc.entity_id}:{doc.name}",
                source_data={
                    "entity_id": doc.entity_id,
                    "name": doc.name,
                    "url": doc.url,
                },
                action="create",
            )
        )
    await db.flush()
    return stats


# ---------------------------------------------------------------------------
# Comment staging
# ---------------------------------------------------------------------------


async def stage_comments(
    db: AsyncSession,
    migration: Migration,
    source: MigrationSource,
    snapshot: MigrationSnapshot,
) -> dict[str, int]:
    """Stage comments. Comments whose author cannot be resolved drop with a warning.

    Threading (reply chains) is *not* preserved — every comment lands
    at the top level. Source exports rarely carry enough structural
    detail to reconstruct UI threading reliably.
    """
    await db.execute(
        delete(StagedRecord).where(
            StagedRecord.migration_id == migration.id,
            StagedRecord.entity_kind == "comment",
        )
    )
    stats = {"create": 0, "skip": 0, "conflict": 0}
    for comment in snapshot.comments:
        if not comment.body:
            stats["conflict"] += 1
            continue
        stats["create"] += 1
        db.add(
            StagedRecord(
                id=uuid.uuid4(),
                migration_id=migration.id,
                source_type=migration.source_type,
                entity_kind="comment",
                source_id=comment.source_id or _synth_comment_source_id(comment),
                source_data={
                    "entity_id": comment.entity_id,
                    "author_email": (comment.author_email or "").strip().lower(),
                    "body": comment.body,
                    "created_at": comment.created_at.isoformat() if comment.created_at else None,
                },
                action="create",
            )
        )
    await db.flush()
    return stats


def _synth_comment_source_id(comment: Any) -> str:
    """A stable id for a comment the source gave none.

    Built from the entity and a digest of the body — never ``hash()``,
    which is salted per process, so the id would differ on every parse
    and the apply step could not recognise the comment on a re-import.
    """
    digest = hashlib.sha256((comment.body or "").encode("utf-8")).hexdigest()[:16]
    return f"{comment.entity_id}:{digest}"


# ---------------------------------------------------------------------------
# Custom-metamodel staging
# ---------------------------------------------------------------------------


async def stage_metamodel(
    db: AsyncSession,
    migration: Migration,
    source: MigrationSource,
    snapshot: MigrationSnapshot,
) -> dict[str, int]:
    """Stage tenant-defined metamodel extensions for admin review.

    Three rows per extension kind:

    - ``metamodel_type`` — a native entity type with no Turbo EA
      counterpart. The admin picks a target ``type`` key + layer/icon
      in the preview UI; ``action=create`` until they decide.
    - ``metamodel_field`` — a custom field on any entity type. Inferred
      ``fields_schema`` fragment in ``source_data``; admin can accept
      / edit / remap to an existing TEA field / skip.
    - ``metamodel_relation_type`` — a tenant-defined relation type.
      Inferred endpoints from the native ``from``/``to``.

    Snapshot ``metamodel_types[].is_custom == false`` types contribute
    ONLY their custom fields (not the type itself). Built-in collisions
    flip to ``action='conflict'`` so the importer never silently
    overwrites a Turbo EA built-in type's schema.
    """
    await db.execute(
        delete(StagedRecord).where(
            StagedRecord.migration_id == migration.id,
            StagedRecord.entity_kind.in_(
                ("metamodel_type", "metamodel_field", "metamodel_relation_type")
            ),
        )
    )
    stats = {
        "new_types": 0,
        "new_fields": 0,
        "new_relation_types": 0,
        "field_conflicts": 0,
        "type_conflicts": 0,
    }

    for mm_type in snapshot.metamodel_types:
        is_default_native_type = mm_type.name in source.type_mapping
        # ---- The type itself ----
        if mm_type.is_custom and not is_default_native_type:
            stats["new_types"] += 1
            db.add(
                StagedRecord(
                    id=uuid.uuid4(),
                    migration_id=migration.id,
                    source_type=migration.source_type,
                    entity_kind="metamodel_type",
                    source_id=mm_type.name,
                    source_data={
                        "native_name": mm_type.name,
                        "proposed_tea_key": mm_type.name,  # default — admin can rename
                        "subtypes": mm_type.subtypes,
                    },
                    action="create",
                )
            )
        elif mm_type.is_custom and is_default_native_type:
            # Built-in name collision — never overwrite a TEA built-in.
            stats["type_conflicts"] += 1
            db.add(
                StagedRecord(
                    id=uuid.uuid4(),
                    migration_id=migration.id,
                    source_type=migration.source_type,
                    entity_kind="metamodel_type",
                    source_id=mm_type.name,
                    source_data={"native_name": mm_type.name},
                    action="conflict",
                    diff={
                        "reason": (
                            f"{source.label} custom type {mm_type.name!r} collides with a "
                            "built-in Turbo EA card type; pick a new key or "
                            "remap before applying."
                        )
                    },
                )
            )

        # ---- Custom fields on the type ----
        target_tea_type = source.type_mapping.get(mm_type.name) or mm_type.name
        for f in mm_type.fields:
            if not f.is_custom:
                continue
            tea_field_type = infer_field_type(source, f.data_type)
            if tea_field_type is None and f.data_type.upper() == "FACT_SHEET_REFERENCE":
                # Reference fields don't exist as fields in Turbo EA —
                # they live on the relation_types graph. Stage as a
                # relation_type row instead.
                stats["new_relation_types"] += 1
                db.add(
                    StagedRecord(
                        id=uuid.uuid4(),
                        migration_id=migration.id,
                        source_type=migration.source_type,
                        entity_kind="metamodel_relation_type",
                        source_id=f"{mm_type.name}:{f.key}",
                        source_data={
                            "native_name": f.key,
                            "label": f.label,
                            "from_type": mm_type.name,
                            "to_type": None,  # unknown; admin chooses
                        },
                        action="create",
                    )
                )
                continue
            if tea_field_type is None:
                stats["field_conflicts"] += 1
                db.add(
                    StagedRecord(
                        id=uuid.uuid4(),
                        migration_id=migration.id,
                        source_type=migration.source_type,
                        entity_kind="metamodel_field",
                        source_id=f"{mm_type.name}:{f.key}",
                        source_data={
                            "target_type": target_tea_type,
                            "field_key": f.key,
                            "label": f.label,
                            "native_data_type": f.data_type,
                        },
                        action="conflict",
                        diff={"reason": f"Unmappable {source.label} dataType {f.data_type!r}"},
                    )
                )
                continue
            stats["new_fields"] += 1
            db.add(
                StagedRecord(
                    id=uuid.uuid4(),
                    migration_id=migration.id,
                    source_type=migration.source_type,
                    entity_kind="metamodel_field",
                    source_id=f"{mm_type.name}:{f.key}",
                    card_type_key=target_tea_type,
                    source_data={
                        "target_type": target_tea_type,
                        "field_key": f.key,
                        "label": f.label or f.key,
                        "tea_type": tea_field_type,
                        "options": f.options,
                        "translations": f.translations,
                    },
                    action="create",
                )
            )

    for rt in snapshot.metamodel_relation_types:
        if not rt.is_custom:
            continue
        # Skip relation type names already covered by the adapter's
        # relation_mapping (xlsx-style + GraphQL-style) — those route
        # to a built-in Turbo EA edge and don't need a new
        # relation_type row.
        if rt.name in source.relation_mapping:
            continue
        # Translate native entity type names on the endpoints to Turbo
        # EA card-type keys. For core types the adapter's ``type_mapping``
        # has the answer (``UserGroup`` → ``Organization``,
        # ``Project`` → ``Initiative``); for tenant-custom types the
        # parser-synthesized name is also the key the
        # ``metamodel_type`` apply pass will use, so passing the native
        # name through directly is correct.
        src_key = source.type_mapping.get(rt.source_type, rt.source_type)
        tgt_key = source.type_mapping.get(rt.target_type, rt.target_type)
        stats["new_relation_types"] += 1
        db.add(
            StagedRecord(
                id=uuid.uuid4(),
                migration_id=migration.id,
                source_type=migration.source_type,
                entity_kind="metamodel_relation_type",
                source_id=rt.name,
                source_data={
                    "native_name": rt.name,
                    "label": rt.label or rt.name,
                    "from_type": src_key,
                    "to_type": tgt_key,
                    "attributes_schema": rt.attributes_schema,
                },
                action="create",
            )
        )

    await db.flush()
    return stats
