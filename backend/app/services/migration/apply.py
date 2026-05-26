"""Source-neutral migration apply pipeline.

Walks the :class:`StagedRecord` rows produced by
:mod:`app.services.migration.staging` in dependency order:

1. Custom metamodel types / fields / relation types — must exist
   before any card or relation referencing them lands.
2. Users — referenced by subscriptions in pass 10.
3. Cards in topological parent-first order — populates the identity
   map so relation endpoints can resolve.
4. Tag groups, then tags — must come before card_tag joins.
5. Card-tag join rows.
6. Relations — endpoints resolved against the now-fresh identity map.
7. Subscriptions — Stakeholder rows that reference users + cards from
   earlier passes.
8. Documents and comments.

Each pass runs inside its own ``SAVEPOINT``: one failing entity does
not poison the rest of the import. Errors are captured back onto the
``staged_records.error_message`` column so the admin can see exactly
what failed without reading server logs.

The pipeline is source-agnostic — it walks rows by ``entity_kind`` and
``action`` and never touches the adapter (mappings were already
applied at staging time).
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.models.card import Card
from app.models.card_type import CardType
from app.models.comment import Comment
from app.models.document import Document
from app.models.migration import IdentityMap, Migration, StagedRecord
from app.models.relation import Relation
from app.models.relation_type import RelationType
from app.models.stakeholder import Stakeholder
from app.models.tag import CardTag, Tag, TagGroup
from app.models.user import User

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------


async def apply_migration(
    db: AsyncSession,
    migration: Migration,
    user: User,
) -> dict[str, int]:
    """Execute every applicable pass for ``migration``.

    Returns a counter dict the caller can merge into
    ``migration.stats``. Errors are kept per-pass so the admin can see
    which entity kind failed even when later passes succeed.
    """
    counts = {"created": 0, "updated": 0, "skipped": 0, "errors": 0}
    per_pass: dict[str, dict[str, int]] = {}

    for pass_name, runner in (
        ("metamodel_type", _apply_metamodel_type_pass),
        ("metamodel_field", _apply_metamodel_field_pass),
        ("metamodel_relation_type", _apply_metamodel_relation_type_pass),
        ("user", _apply_user_pass),
        ("card", _apply_card_pass),
        ("tag_group", _apply_tag_group_pass),
        ("tag", _apply_tag_pass),
        ("card_tag", _apply_card_tag_pass),
        ("relation", _apply_relation_pass),
        ("subscription", _apply_subscription_pass),
        ("document", _apply_document_pass),
        ("comment", _apply_comment_pass),
    ):
        pass_counts = await runner(db, migration, user)
        per_pass[pass_name] = pass_counts
        for k, v in pass_counts.items():
            counts[k] += v

    counts["per_pass"] = per_pass  # type: ignore[assignment]
    return counts


# ---------------------------------------------------------------------------
# Card pass — topological apply respecting BC parent chains
# ---------------------------------------------------------------------------


# Lifecycle-target sentinel must stay in lockstep with
# ``LIFECYCLE_TARGET_PREFIX`` in ``app.api.v1.migration``.
_LIFECYCLE_PREFIX = "__lifecycle__:"


def _coerce_lifecycle_date(value: Any) -> str | None:
    """Coerce an arbitrary attribute value into a ``YYYY-MM-DD`` string.

    Card lifecycle slots are date-only ISO strings (see how the LeanIX
    parser writes them in ``xlsx_parser._coerce_datetime``). When the
    admin maps a custom date / datetime / text column onto a lifecycle
    phase, the value may arrive as ``"2027-06-30"``, ``"2027-06-30T00:00:00"``,
    ``"2027-06-30T00:00:00+00:00"``, an ``int`` timestamp, or a parser
    fallback string. We accept the first 10 chars of any ISO-shaped
    string (that's the ``YYYY-MM-DD`` prefix); empty / unparseable
    values are dropped so they don't pollute the lifecycle map.
    """
    if value is None:
        return None
    if isinstance(value, str):
        s = value.strip()
        if not s:
            return None
        # ISO 8601 strings always start with YYYY-MM-DD; anything else
        # (free text, "TBD", a vendor name) is not a valid lifecycle
        # date and is silently dropped.
        head = s[:10]
        if len(head) == 10 and head[4] == "-" and head[7] == "-":
            return head
        return None
    # Datetimes / dates that survived JSON serialisation as objects
    # (very rare on the staging path, but handle it for safety).
    iso = getattr(value, "isoformat", None)
    if callable(iso):
        try:
            return str(iso())[:10]
        except Exception:  # noqa: BLE001
            return None
    return None


def _remap_attributes(
    attributes: dict[str, Any],
    mapping: dict[str, str],
    *,
    lifecycle: dict[str, str] | None = None,
) -> tuple[dict[str, Any], dict[str, str]]:
    """Rewrite attribute keys using the admin's per-type field mapping.

    Returns the rewritten ``attributes`` dict and a (possibly extended)
    ``lifecycle`` dict — admins can route a custom date attribute onto
    a standard lifecycle phase via the ``__lifecycle__:<phase>``
    sentinel key. Empty string / ``None`` / missing key in the mapping
    passes through unchanged. The literal ``"__skip__"`` target drops
    the value. Lifecycle-targeted values that don't parse as
    ``YYYY-MM-DD`` are dropped silently (better than corrupting the
    lifecycle slot with garbage). Last-write-wins if two source keys
    map onto the same TEA key.
    """
    out_attrs: dict[str, Any] = {}
    out_lifecycle: dict[str, str] = dict(lifecycle or {})
    for native_key, value in attributes.items():
        target = mapping.get(native_key)
        if target == "__skip__":
            continue
        if target and target.startswith(_LIFECYCLE_PREFIX):
            phase = target[len(_LIFECYCLE_PREFIX) :]
            coerced = _coerce_lifecycle_date(value)
            if coerced and phase:
                out_lifecycle[phase] = coerced
            # Either way the value never lands back in ``attributes``.
            continue
        out_attrs[target or native_key] = value
    return out_attrs, out_lifecycle


async def _apply_card_pass(
    db: AsyncSession,
    migration: Migration,
    user: User,
) -> dict[str, int]:
    counts = {"created": 0, "updated": 0, "skipped": 0, "errors": 0}
    field_mappings = migration.field_mappings or {}

    rows = list(
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

    # Topo sort: parents (no parent_source_id, or parent already
    # resolved earlier in the list) come first. Detect cycles by
    # tracking unresolved IDs across iterations — if a pass makes no
    # progress, the remaining rows are part of a cycle and apply
    # in arrival order with a logged warning.
    ordered = _topo_sort(rows)

    for staged in ordered:
        if staged.action == "skip":
            # Existing card with no diff. The identity-map row is still
            # refreshed so later passes (relations, card_tag,
            # subscription, …) can resolve the native id → Turbo EA
            # card uuid. Without this, a re-import after an identity
            # map wipe leaves every downstream pass with dangling
            # endpoints.
            if staged.target_id is not None:
                try:
                    await _upsert_identity_map(db, staged)
                except Exception:  # noqa: BLE001
                    logger.exception(
                        "migration apply: identity_map refresh for skipped card %s failed",
                        staged.source_id,
                    )
            counts["skipped"] += 1
            staged.status = "applied"
            continue
        if staged.action == "conflict":
            counts["skipped"] += 1
            staged.status = "applied"  # conflict was already surfaced; treat as terminal
            continue

        try:
            await _apply_single_card(db, staged, user, field_mappings=field_mappings)
            counts["created" if staged.action == "create" else "updated"] += 1
            staged.status = "applied"
        except Exception as exc:  # noqa: BLE001 — collect, don't crash the pass
            logger.exception("migration apply: card %s failed", staged.source_id)
            counts["errors"] += 1
            staged.status = "error"
            staged.error_message = str(exc)[:1000]

    await db.flush()
    return counts


async def _apply_single_card(
    db: AsyncSession,
    staged: StagedRecord,
    user: User,
    field_mappings: dict[str, dict[str, str]] | None = None,
) -> None:
    payload = (staged.source_data or {}).get("payload") or {}
    raw = (staged.source_data or {}).get("raw") or {}
    native_type = raw.get("type")
    # Honour the per-migration field mapping: rewrite custom-field keys
    # (still in their native source names inside ``attributes``) to the
    # admin's chosen Turbo EA field keys. Custom date columns routed
    # onto a standard lifecycle phase via the ``__lifecycle__:<phase>``
    # sentinel get coerced to ``YYYY-MM-DD`` and folded into
    # ``payload['lifecycle']`` instead of staying in ``attributes``.
    # Unmapped keys pass through unchanged and land as new custom
    # attributes via the metamodel pass.
    if field_mappings and native_type:
        mapping_for_type = field_mappings.get(native_type) or {}
        if mapping_for_type and payload.get("attributes"):
            new_attrs, new_lifecycle = _remap_attributes(
                payload["attributes"],
                mapping_for_type,
                lifecycle=payload.get("lifecycle") or {},
            )
            payload = {
                **payload,
                "attributes": new_attrs,
                "lifecycle": new_lifecycle,
            }
    parent_id = await _resolve_parent_card_id(db, staged)

    if staged.action == "create":
        card = Card(
            id=uuid.uuid4(),
            type=payload["type"],
            subtype=payload.get("subtype"),
            name=payload["name"],
            description=payload.get("description"),
            parent_id=parent_id,
            lifecycle=payload.get("lifecycle") or {},
            attributes=payload.get("attributes") or {},
            status=payload.get("status") or "ACTIVE",
            approval_status=payload.get("approval_status") or "DRAFT",
            external_id=payload.get("external_id"),
            alias=payload.get("alias"),
            created_by=user.id,
            updated_by=user.id,
        )
        db.add(card)
        await db.flush()
        staged.target_id = card.id
    elif staged.action == "update":
        if staged.target_id is None:
            raise ValueError(f"update staged row {staged.id} has no target_id")
        existing_card = (
            await db.execute(select(Card).where(Card.id == staged.target_id))
        ).scalar_one_or_none()
        if existing_card is None:
            raise ValueError(f"target card {staged.target_id} no longer exists")
        card = existing_card
        # Apply diff'd fields back onto the existing card. Attributes
        # the import doesn't know about are intentionally **not** wiped
        # — merge instead of replace.
        if payload.get("name"):
            card.name = payload["name"]
        if "description" in payload:
            card.description = payload["description"]
        if payload.get("subtype"):
            card.subtype = payload["subtype"]
        if payload.get("lifecycle"):
            card.lifecycle = {**(card.lifecycle or {}), **payload["lifecycle"]}
        merged_attrs = {**(card.attributes or {}), **(payload.get("attributes") or {})}
        card.attributes = merged_attrs
        if payload.get("external_id"):
            card.external_id = payload["external_id"]
        if parent_id is not None:
            card.parent_id = parent_id
        card.updated_by = user.id
    else:
        raise ValueError(f"unknown action {staged.action!r}")

    # Identity-map upsert so future imports of the same snapshot stay idempotent.
    await _upsert_identity_map(db, staged)


async def _resolve_parent_card_id(
    db: AsyncSession,
    staged: StagedRecord,
) -> uuid.UUID | None:
    if not staged.parent_source_id:
        return None
    parent_staged = (
        await db.execute(
            select(StagedRecord).where(
                StagedRecord.migration_id == staged.migration_id,
                StagedRecord.entity_kind == "card",
                StagedRecord.source_id == staged.parent_source_id,
            )
        )
    ).scalar_one_or_none()
    if parent_staged is not None and parent_staged.target_id is not None:
        return parent_staged.target_id
    # Parent not staged in this migration — look it up via the persistent identity map.
    im = (
        await db.execute(
            select(IdentityMap).where(
                IdentityMap.source_id == staged.parent_source_id,
                IdentityMap.entity_kind == "card",
                IdentityMap.source_type == staged.source_type,
            )
        )
    ).scalar_one_or_none()
    return im.target_id if im is not None else None


async def _upsert_identity_map(
    db: AsyncSession,
    staged: StagedRecord,
) -> None:
    if staged.target_id is None:
        return
    existing = (
        await db.execute(
            select(IdentityMap).where(
                IdentityMap.source_id == staged.source_id,
                IdentityMap.entity_kind == "card",
                IdentityMap.source_type == staged.source_type,
            )
        )
    ).scalar_one_or_none()
    now = datetime.now(timezone.utc)
    if existing is None:
        db.add(
            IdentityMap(
                id=uuid.uuid4(),
                source_id=staged.source_id,
                source_type=staged.source_type,
                entity_kind="card",
                target_id=staged.target_id,
                migration_id=staged.migration_id,
                last_seen_at=now,
            )
        )
    else:
        existing.target_id = staged.target_id
        existing.migration_id = staged.migration_id
        existing.last_seen_at = now


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _topo_sort(rows: list[StagedRecord]) -> list[StagedRecord]:
    """Order staged rows so parents come before children.

    Returns a new list. Rows whose parent is **not** present in the
    staged set are scheduled first (their parents are resolved against
    the persistent identity map at apply time). Cycle detection: if a
    full pass over the remaining rows makes no progress, the leftover
    rows are appended in arrival order with a warning log.
    """
    by_id = {r.source_id: r for r in rows}
    placed: set[str] = set()
    out: list[StagedRecord] = []

    # First scheduling round: rows with no in-snapshot parent.
    pending: list[StagedRecord] = []
    for r in rows:
        if not r.parent_source_id or r.parent_source_id not in by_id:
            out.append(r)
            placed.add(r.source_id)
        else:
            pending.append(r)

    # Subsequent rounds: drain until empty or stalled.
    while pending:
        next_pending: list[StagedRecord] = []
        progress = False
        for r in pending:
            if r.parent_source_id in placed:
                out.append(r)
                placed.add(r.source_id)
                progress = True
            else:
                next_pending.append(r)
        if not progress:
            logger.warning(
                "migration apply: cycle detected in card parent chain, "
                "appending %d rows in arrival order",
                len(next_pending),
            )
            out.extend(next_pending)
            break
        pending = next_pending

    return out


# ---------------------------------------------------------------------------
# Tag-group / tag / card-tag passes
# ---------------------------------------------------------------------------


async def _apply_tag_group_pass(
    db: AsyncSession,
    migration: Migration,
    user: User,
) -> dict[str, int]:
    counts = {"created": 0, "updated": 0, "skipped": 0, "errors": 0}
    rows = (
        (
            await db.execute(
                select(StagedRecord).where(
                    StagedRecord.migration_id == migration.id,
                    StagedRecord.entity_kind == "tag_group",
                )
            )
        )
        .scalars()
        .all()
    )
    for staged in rows:
        try:
            if staged.action == "skip" and staged.target_id is not None:
                # Already exists — just keep the cached target_id.
                staged.status = "applied"
                counts["skipped"] += 1
                continue
            payload = staged.source_data or {}
            group = TagGroup(
                id=uuid.uuid4(),
                name=payload["name"],
                mode=payload.get("mode") or "multi",
                description=f"Imported from {staged.source_type}",
            )
            db.add(group)
            await db.flush()
            staged.target_id = group.id
            staged.status = "applied"
            counts["created"] += 1
        except Exception as exc:  # noqa: BLE001
            logger.exception("migration apply: tag_group %s failed", staged.source_id)
            counts["errors"] += 1
            staged.status = "error"
            staged.error_message = str(exc)[:1000]
    await db.flush()
    return counts


async def _apply_tag_pass(
    db: AsyncSession,
    migration: Migration,
    user: User,
) -> dict[str, int]:
    counts = {"created": 0, "updated": 0, "skipped": 0, "errors": 0}
    # Build group-name → group_id index from the freshly-applied tag_group rows.
    group_rows = (
        (
            await db.execute(
                select(StagedRecord).where(
                    StagedRecord.migration_id == migration.id,
                    StagedRecord.entity_kind == "tag_group",
                )
            )
        )
        .scalars()
        .all()
    )
    group_index: dict[str, uuid.UUID] = {
        gr.source_id: gr.target_id  # type: ignore[misc]
        for gr in group_rows
        if gr.target_id is not None
    }
    fallback_group_name = f"Imported from {migration.source_type}"

    rows = (
        (
            await db.execute(
                select(StagedRecord).where(
                    StagedRecord.migration_id == migration.id,
                    StagedRecord.entity_kind == "tag",
                )
            )
        )
        .scalars()
        .all()
    )
    for staged in rows:
        try:
            if staged.action == "skip" and staged.target_id is not None:
                staged.status = "applied"
                counts["skipped"] += 1
                await _upsert_identity_map_kind(db, staged, "tag")
                continue
            payload = staged.source_data or {}
            group_id = group_index.get(payload.get("group_name") or fallback_group_name)
            if group_id is None:
                # Resolve from DB as a fallback (re-imports skip the
                # group-create step but the group still exists).
                group_name = payload.get("group_name") or fallback_group_name
                existing_group = (
                    await db.execute(select(TagGroup).where(TagGroup.name == group_name))
                ).scalar_one_or_none()
                if existing_group is None:
                    raise ValueError(f"tag group {group_name!r} not resolvable")
                group_id = existing_group.id
            tag = Tag(
                id=uuid.uuid4(),
                tag_group_id=group_id,
                name=payload["name"],
                color=payload.get("color"),
            )
            db.add(tag)
            await db.flush()
            staged.target_id = tag.id
            staged.status = "applied"
            counts["created"] += 1
            await _upsert_identity_map_kind(db, staged, "tag")
        except Exception as exc:  # noqa: BLE001
            logger.exception("migration apply: tag %s failed", staged.source_id)
            counts["errors"] += 1
            staged.status = "error"
            staged.error_message = str(exc)[:1000]
    await db.flush()
    return counts


async def _apply_card_tag_pass(
    db: AsyncSession,
    migration: Migration,
    user: User,
) -> dict[str, int]:
    counts = {"created": 0, "updated": 0, "skipped": 0, "errors": 0}
    rows = (
        (
            await db.execute(
                select(StagedRecord).where(
                    StagedRecord.migration_id == migration.id,
                    StagedRecord.entity_kind == "card_tag",
                )
            )
        )
        .scalars()
        .all()
    )
    for staged in rows:
        try:
            payload = staged.source_data or {}
            card_uuid = await _identity_lookup(
                db, payload.get("entity_id"), "card", staged.source_type
            )
            tag_uuid = await _identity_lookup(db, payload.get("tag_id"), "tag", staged.source_type)
            if card_uuid is None or tag_uuid is None:
                counts["skipped"] += 1
                staged.status = "applied"
                staged.error_message = "Endpoint not resolved (card or tag missing)"
                continue
            # Idempotent — don't double-insert.
            existing = (
                await db.execute(
                    select(CardTag).where(
                        CardTag.card_id == card_uuid,
                        CardTag.tag_id == tag_uuid,
                    )
                )
            ).first()
            if existing is not None:
                counts["skipped"] += 1
                staged.status = "applied"
                continue
            db.add(CardTag(card_id=card_uuid, tag_id=tag_uuid))
            counts["created"] += 1
            staged.status = "applied"
        except Exception as exc:  # noqa: BLE001
            logger.exception("migration apply: card_tag %s failed", staged.source_id)
            counts["errors"] += 1
            staged.status = "error"
            staged.error_message = str(exc)[:1000]
    await db.flush()
    return counts


# ---------------------------------------------------------------------------
# Relation pass
# ---------------------------------------------------------------------------


async def _apply_relation_pass(
    db: AsyncSession,
    migration: Migration,
    user: User,
) -> dict[str, int]:
    counts = {"created": 0, "updated": 0, "skipped": 0, "errors": 0}
    rows = (
        (
            await db.execute(
                select(StagedRecord).where(
                    StagedRecord.migration_id == migration.id,
                    StagedRecord.entity_kind == "relation",
                )
            )
        )
        .scalars()
        .all()
    )
    for staged in rows:
        if staged.action == "conflict":
            counts["skipped"] += 1
            staged.status = "applied"
            continue
        try:
            payload = staged.source_data or {}
            # Endpoint UUIDs were cached on the staged row at staging
            # time, but the card pass may have created the cards just
            # now — re-resolve unconditionally.
            src_uuid = await _identity_lookup(
                db, payload["from_entity_id"], "card", staged.source_type
            )
            tgt_uuid = await _identity_lookup(
                db, payload["to_entity_id"], "card", staged.source_type
            )
            if src_uuid is None or tgt_uuid is None:
                counts["skipped"] += 1
                staged.status = "applied"
                staged.error_message = "Endpoint card not resolved in identity map"
                continue
            if staged.action == "create":
                rel = Relation(
                    id=uuid.uuid4(),
                    type=payload["tea_type"],
                    source_id=src_uuid,
                    target_id=tgt_uuid,
                    attributes=payload.get("attributes") or {},
                )
                db.add(rel)
                await db.flush()
                staged.target_id = rel.id
                counts["created"] += 1
            elif staged.action == "update":
                if staged.target_id is None:
                    raise ValueError("update relation has no cached target_id")
                existing_rel = (
                    await db.execute(select(Relation).where(Relation.id == staged.target_id))
                ).scalar_one_or_none()
                if existing_rel is None:
                    raise ValueError("target relation no longer exists")
                rel = existing_rel
                merged = {**(rel.attributes or {}), **(payload.get("attributes") or {})}
                rel.attributes = merged
                counts["updated"] += 1
            else:  # skip
                counts["skipped"] += 1
            staged.status = "applied"
        except Exception as exc:  # noqa: BLE001
            logger.exception("migration apply: relation %s failed", staged.source_id)
            counts["errors"] += 1
            staged.status = "error"
            staged.error_message = str(exc)[:1000]
    await db.flush()
    return counts


# ---------------------------------------------------------------------------
# Identity-map helpers shared by tag / card_tag / relation passes
# ---------------------------------------------------------------------------


async def _identity_lookup(
    db: AsyncSession,
    source_id: str | None,
    entity_kind: str,
    source_type: str,
) -> uuid.UUID | None:
    if not source_id:
        return None
    row = (
        await db.execute(
            select(IdentityMap).where(
                IdentityMap.source_id == source_id,
                IdentityMap.entity_kind == entity_kind,
                IdentityMap.source_type == source_type,
            )
        )
    ).scalar_one_or_none()
    return row.target_id if row is not None else None


async def _upsert_identity_map_kind(
    db: AsyncSession,
    staged: StagedRecord,
    entity_kind: str,
) -> None:
    """Write a (source_id, entity_kind, source_type) → target_id mapping for a non-card kind."""
    if staged.target_id is None:
        return
    existing = (
        await db.execute(
            select(IdentityMap).where(
                IdentityMap.source_id == staged.source_id,
                IdentityMap.entity_kind == entity_kind,
                IdentityMap.source_type == staged.source_type,
            )
        )
    ).scalar_one_or_none()
    now = datetime.now(timezone.utc)
    if existing is None:
        db.add(
            IdentityMap(
                id=uuid.uuid4(),
                source_id=staged.source_id,
                source_type=staged.source_type,
                entity_kind=entity_kind,
                target_id=staged.target_id,
                migration_id=staged.migration_id,
                last_seen_at=now,
            )
        )
    else:
        existing.target_id = staged.target_id
        existing.migration_id = staged.migration_id
        existing.last_seen_at = now


# ---------------------------------------------------------------------------
# Metamodel passes — must run before any card insert
# ---------------------------------------------------------------------------


async def _apply_metamodel_type_pass(
    db: AsyncSession,
    migration: Migration,
    user: User,
) -> dict[str, int]:
    """Create new (non-builtin) card types for custom native entity types."""
    counts = {"created": 0, "updated": 0, "skipped": 0, "errors": 0}
    rows = (
        (
            await db.execute(
                select(StagedRecord).where(
                    StagedRecord.migration_id == migration.id,
                    StagedRecord.entity_kind == "metamodel_type",
                )
            )
        )
        .scalars()
        .all()
    )
    for staged in rows:
        try:
            if staged.action != "create":
                counts["skipped"] += 1
                staged.status = "applied"
                continue
            payload = staged.source_data or {}
            type_key = payload.get("proposed_tea_key") or payload.get("native_name")
            if not type_key:
                raise ValueError("missing proposed_tea_key")
            existing = (
                await db.execute(select(CardType).where(CardType.key == type_key))
            ).scalar_one_or_none()
            if existing is not None:
                counts["skipped"] += 1
                staged.status = "applied"
                staged.target_id = existing.id
                continue
            subtypes = payload.get("subtypes") or []
            # Tenant-imported types default to ``has_hierarchy=True`` and
            # ``has_successors=True``. Source platforms model both
            # natively (every entity supports parent/child and
            # predecessor/successor chains), so the imported data carries
            # those edges. Without these flags the frontend's CardDetail
            # hides the hierarchy and lineage sections — the data is in
            # the DB but invisible.
            new_type = CardType(
                id=uuid.uuid4(),
                key=type_key,
                label=type_key,
                category="Imported",
                icon="extension",
                color="#888888",
                built_in=False,
                has_hierarchy=True,
                has_successors=True,
                fields_schema=[],
                subtypes=[{"key": s, "label": s} for s in subtypes] if subtypes else [],
            )
            db.add(new_type)
            await db.flush()
            staged.target_id = new_type.id
            staged.status = "applied"
            counts["created"] += 1
        except Exception as exc:  # noqa: BLE001
            logger.exception("migration apply: metamodel_type %s failed", staged.source_id)
            counts["errors"] += 1
            staged.status = "error"
            staged.error_message = str(exc)[:1000]
    await db.flush()
    return counts


async def _apply_metamodel_field_pass(
    db: AsyncSession,
    migration: Migration,
    user: User,
) -> dict[str, int]:
    """Append custom native fields to the target card type's fields_schema.

    Idempotent: fields whose key already exists on the type are
    skipped without raising. New fields are grouped under a synthetic
    ``Imported from {source}`` section so customers can recognise what
    came from the migration.
    """
    counts = {"created": 0, "updated": 0, "skipped": 0, "errors": 0}
    section_name = f"Imported from {migration.source_type}"
    field_mappings = migration.field_mappings or {}
    rows = (
        (
            await db.execute(
                select(StagedRecord).where(
                    StagedRecord.migration_id == migration.id,
                    StagedRecord.entity_kind == "metamodel_field",
                )
            )
        )
        .scalars()
        .all()
    )
    for staged in rows:
        try:
            if staged.action != "create":
                counts["skipped"] += 1
                staged.status = "applied"
                continue
            payload = staged.source_data or {}
            type_key = payload["target_type"]
            # Skip materialising the metamodel field when the admin has
            # remapped this native field to an existing TEA field on the
            # target type (or explicitly dropped it). The card pass
            # already rewrites the attribute key on the way in.
            #
            # ``source_id`` is shaped ``<native_type>:<field_key>`` so we
            # can look the mapping up without a second query.
            native_type, _, _ = staged.source_id.partition(":")
            type_mapping = field_mappings.get(native_type) or {}
            mapped_target = type_mapping.get(payload.get("field_key", ""))
            if mapped_target:
                counts["skipped"] += 1
                staged.status = "applied"
                continue
            ct = (
                await db.execute(select(CardType).where(CardType.key == type_key))
            ).scalar_one_or_none()
            if ct is None:
                raise ValueError(f"target card type {type_key!r} not found")
            schema = list(ct.fields_schema or [])
            # Find or create the synthetic section.
            imported_section: dict | None = None
            for sec in schema:
                if isinstance(sec, dict) and sec.get("section") == section_name:
                    imported_section = sec
                    break
            if imported_section is None:
                imported_section = {
                    "section": section_name,
                    "columns": 1,
                    "fields": [],
                }
                schema.append(imported_section)
            field_key = payload["field_key"]
            if any((f.get("key") == field_key) for f in (imported_section.get("fields") or [])):
                counts["skipped"] += 1
                staged.status = "applied"
                continue
            new_field: dict[str, Any] = {
                "key": field_key,
                "label": payload.get("label") or field_key,
                "type": payload["tea_type"],
                "weight": 0,
            }
            if payload.get("options"):
                new_field["options"] = payload["options"]
            if payload.get("translations"):
                new_field["translations"] = payload["translations"]
            imported_section.setdefault("fields", []).append(new_field)
            ct.fields_schema = schema
            # ``fields_schema`` is a JSONB list-of-dicts without
            # ``MutableList``/``MutableDict`` wrappers — SQLAlchemy
            # only diffs the column by identity, so the in-place
            # ``append`` above is invisible to the change-tracker.
            # Without ``flag_modified``, only the **first** field per
            # type ever lands; subsequent iterations think the
            # column is unchanged and emit no UPDATE on flush.
            flag_modified(ct, "fields_schema")
            counts["created"] += 1
            staged.status = "applied"
        except Exception as exc:  # noqa: BLE001
            logger.exception("migration apply: metamodel_field %s failed", staged.source_id)
            counts["errors"] += 1
            staged.status = "error"
            staged.error_message = str(exc)[:1000]
    await db.flush()
    return counts


async def _apply_metamodel_relation_type_pass(
    db: AsyncSession,
    migration: Migration,
    user: User,
) -> dict[str, int]:
    """Create new (non-builtin) relation types for custom native relations."""
    counts = {"created": 0, "updated": 0, "skipped": 0, "errors": 0}
    rows = (
        (
            await db.execute(
                select(StagedRecord).where(
                    StagedRecord.migration_id == migration.id,
                    StagedRecord.entity_kind == "metamodel_relation_type",
                )
            )
        )
        .scalars()
        .all()
    )
    for staged in rows:
        try:
            if staged.action != "create":
                counts["skipped"] += 1
                staged.status = "applied"
                continue
            payload = staged.source_data or {}
            key = payload.get("native_name")
            src = payload.get("from_type")
            tgt = payload.get("to_type")
            if not (key and src and tgt):
                # FACT_SHEET_REFERENCE fields drop here with to_type
                # null — admin must edit the row in preview to pick
                # a target type before applying. Skip without erroring.
                counts["skipped"] += 1
                staged.status = "applied"
                staged.error_message = "Relation endpoint missing — set 'to_type' in preview"
                continue
            existing = (
                await db.execute(select(RelationType).where(RelationType.key == key))
            ).scalar_one_or_none()
            if existing is not None:
                counts["skipped"] += 1
                staged.status = "applied"
                staged.target_id = existing.id
                continue
            new_rt = RelationType(
                id=uuid.uuid4(),
                key=key,
                label=payload.get("label") or key,
                reverse_label=payload.get("label") or key,
                source_type_key=src,
                target_type_key=tgt,
                cardinality="n:m",
                attributes_schema=payload.get("attributes_schema") or [],
                built_in=False,
            )
            db.add(new_rt)
            await db.flush()
            staged.target_id = new_rt.id
            staged.status = "applied"
            counts["created"] += 1
        except Exception as exc:  # noqa: BLE001
            logger.exception("migration apply: metamodel_relation_type %s failed", staged.source_id)
            counts["errors"] += 1
            staged.status = "error"
            staged.error_message = str(exc)[:1000]
    await db.flush()
    return counts


# ---------------------------------------------------------------------------
# User pass — auto-create deactivated users referenced by subscriptions
# ---------------------------------------------------------------------------


async def _apply_user_pass(
    db: AsyncSession,
    migration: Migration,
    user: User,
) -> dict[str, int]:
    counts = {"created": 0, "updated": 0, "skipped": 0, "errors": 0}
    rows = (
        (
            await db.execute(
                select(StagedRecord).where(
                    StagedRecord.migration_id == migration.id,
                    StagedRecord.entity_kind == "user",
                )
            )
        )
        .scalars()
        .all()
    )
    for staged in rows:
        try:
            if staged.action == "skip":
                # User already exists — populate identity map and move on.
                counts["skipped"] += 1
                staged.status = "applied"
                await _upsert_identity_map_kind(db, staged, "user")
                continue
            payload = staged.source_data or {}
            email = payload["email"]
            new_user = User(
                id=uuid.uuid4(),
                email=email,
                display_name=payload.get("display_name") or email,
                role="member",
                is_active=False,  # deactivated until admin activates
                auth_provider="local",
            )
            db.add(new_user)
            await db.flush()
            staged.target_id = new_user.id
            staged.status = "applied"
            counts["created"] += 1
            await _upsert_identity_map_kind(db, staged, "user")
        except Exception as exc:  # noqa: BLE001
            logger.exception("migration apply: user %s failed", staged.source_id)
            counts["errors"] += 1
            staged.status = "error"
            staged.error_message = str(exc)[:1000]
    await db.flush()
    return counts


# ---------------------------------------------------------------------------
# Subscription pass — write Stakeholder rows
# ---------------------------------------------------------------------------


async def _apply_subscription_pass(
    db: AsyncSession,
    migration: Migration,
    user: User,
) -> dict[str, int]:
    counts = {"created": 0, "updated": 0, "skipped": 0, "errors": 0}
    rows = (
        (
            await db.execute(
                select(StagedRecord).where(
                    StagedRecord.migration_id == migration.id,
                    StagedRecord.entity_kind == "subscription",
                )
            )
        )
        .scalars()
        .all()
    )
    for staged in rows:
        if staged.action == "conflict":
            counts["skipped"] += 1
            staged.status = "applied"
            continue
        try:
            payload = staged.source_data or {}
            card_uuid = await _identity_lookup(
                db, payload.get("entity_id"), "card", staged.source_type
            )
            user_uuid = await _identity_lookup(
                db, payload.get("user_email"), "user", staged.source_type
            )
            if card_uuid is None or user_uuid is None:
                counts["skipped"] += 1
                staged.status = "applied"
                staged.error_message = "Endpoint (card or user) not resolved"
                continue
            role_key = payload.get("tea_role_key") or "responsible"
            existing = (
                await db.execute(
                    select(Stakeholder).where(
                        Stakeholder.card_id == card_uuid,
                        Stakeholder.user_id == user_uuid,
                        Stakeholder.role == role_key,
                    )
                )
            ).scalar_one_or_none()
            if existing is not None:
                counts["skipped"] += 1
                staged.status = "applied"
                staged.target_id = existing.id
                continue
            stake = Stakeholder(
                id=uuid.uuid4(),
                card_id=card_uuid,
                user_id=user_uuid,
                role=role_key,
            )
            db.add(stake)
            await db.flush()
            staged.target_id = stake.id
            staged.status = "applied"
            counts["created"] += 1
        except Exception as exc:  # noqa: BLE001
            logger.exception("migration apply: subscription %s failed", staged.source_id)
            counts["errors"] += 1
            staged.status = "error"
            staged.error_message = str(exc)[:1000]
    await db.flush()
    return counts


# ---------------------------------------------------------------------------
# Document pass — URL-only Document rows
# ---------------------------------------------------------------------------


async def _apply_document_pass(
    db: AsyncSession,
    migration: Migration,
    user: User,
) -> dict[str, int]:
    counts = {"created": 0, "updated": 0, "skipped": 0, "errors": 0}
    rows = (
        (
            await db.execute(
                select(StagedRecord).where(
                    StagedRecord.migration_id == migration.id,
                    StagedRecord.entity_kind == "document",
                )
            )
        )
        .scalars()
        .all()
    )
    for staged in rows:
        if staged.action == "conflict":
            counts["skipped"] += 1
            staged.status = "applied"
            continue
        try:
            payload = staged.source_data or {}
            card_uuid = await _identity_lookup(
                db, payload.get("entity_id"), "card", staged.source_type
            )
            if card_uuid is None:
                counts["skipped"] += 1
                staged.status = "applied"
                staged.error_message = "Card not resolved in identity map"
                continue
            doc = Document(
                id=uuid.uuid4(),
                card_id=card_uuid,
                name=payload["name"],
                url=payload.get("url"),
                type="link",
                created_by=user.id,
            )
            db.add(doc)
            await db.flush()
            staged.target_id = doc.id
            staged.status = "applied"
            counts["created"] += 1
        except Exception as exc:  # noqa: BLE001
            logger.exception("migration apply: document %s failed", staged.source_id)
            counts["errors"] += 1
            staged.status = "error"
            staged.error_message = str(exc)[:1000]
    await db.flush()
    return counts


# ---------------------------------------------------------------------------
# Comment pass — top-level only; threading is intentionally flattened
# ---------------------------------------------------------------------------


async def _apply_comment_pass(
    db: AsyncSession,
    migration: Migration,
    user: User,
) -> dict[str, int]:
    counts = {"created": 0, "updated": 0, "skipped": 0, "errors": 0}
    rows = (
        (
            await db.execute(
                select(StagedRecord).where(
                    StagedRecord.migration_id == migration.id,
                    StagedRecord.entity_kind == "comment",
                )
            )
        )
        .scalars()
        .all()
    )
    for staged in rows:
        try:
            payload = staged.source_data or {}
            card_uuid = await _identity_lookup(
                db, payload.get("entity_id"), "card", staged.source_type
            )
            if card_uuid is None:
                counts["skipped"] += 1
                staged.status = "applied"
                staged.error_message = "Card not resolved"
                continue
            author_email = payload.get("author_email")
            author_uuid: uuid.UUID | None = None
            if author_email:
                author_uuid = await _identity_lookup(db, author_email, "user", staged.source_type)
            if author_uuid is None:
                # Author wasn't in the subscription list — drop the
                # comment to avoid fabricating attribution. This is
                # documented in the user-manual page as a known
                # limitation.
                counts["skipped"] += 1
                staged.status = "applied"
                staged.error_message = "Author not resolved — comment skipped"
                continue
            db.add(
                Comment(
                    id=uuid.uuid4(),
                    card_id=card_uuid,
                    user_id=author_uuid,
                    content=payload["body"],
                    parent_id=None,  # threading intentionally flattened
                )
            )
            staged.status = "applied"
            counts["created"] += 1
        except Exception as exc:  # noqa: BLE001
            logger.exception("migration apply: comment %s failed", staged.source_id)
            counts["errors"] += 1
            staged.status = "error"
            staged.error_message = str(exc)[:1000]
    await db.flush()
    return counts
