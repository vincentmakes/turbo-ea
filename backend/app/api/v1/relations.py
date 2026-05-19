from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_user
from app.database import get_db
from app.models.card import Card
from app.models.card_type import CardType
from app.models.relation import Relation
from app.models.relation_type import RelationType
from app.models.user import User
from app.schemas.relation import (
    CardRef,
    RelationBulkRequest,
    RelationBulkResponse,
    RelationBulkResult,
    RelationCreate,
    RelationResponse,
    RelationUpdate,
)
from app.services.calculation_engine import run_calculations_for_card
from app.services.card_resolver import CardResolver
from app.services.cost_field_filter import cost_field_keys_from_relation_schema
from app.services.event_bus import event_bus
from app.services.permission_service import PermissionService

router = APIRouter(prefix="/relations", tags=["relations"])


async def _resolve_relation_labels(
    db: AsyncSession, type_key: str
) -> tuple[str | None, str | None]:
    """Look up the human-readable label + reverse_label for a relation type.
    Returns (None, None) if the type is unknown — we fall back to the raw key."""
    result = await db.execute(
        select(RelationType.label, RelationType.reverse_label).where(RelationType.key == type_key)
    )
    row = result.first()
    if row is None:
        return None, None
    return row[0], row[1]


async def _emit_relation_events(
    db: AsyncSession,
    *,
    event_type: str,
    rel: Relation,
    source_card: Card | None,
    target_card: Card | None,
    actor_id: uuid.UUID,
    extra: dict | None = None,
) -> None:
    """Fan out a relation mutation event to both endpoints.

    Each side's payload carries the directional label so the history
    timeline reads naturally — the source sees the forward label
    (e.g. "supports → ITComponent X"), the target sees the reverse
    label (e.g. "supported by ← Application Y").
    """
    label, reverse_label = await _resolve_relation_labels(db, rel.type)
    forward = label or rel.type
    backward = reverse_label or label or rel.type

    source_name = source_card.name if source_card else None
    target_name = target_card.name if target_card else None
    source_type = source_card.type if source_card else None
    target_type = target_card.type if target_card else None

    base = {
        "id": str(rel.id),
        "type": rel.type,
        "relation_label": label,
        "relation_reverse_label": reverse_label,
        "source_id": str(rel.source_id),
        "target_id": str(rel.target_id),
        "source_name": source_name,
        "target_name": target_name,
        "source_type": source_type,
        "target_type": target_type,
    }
    if extra:
        base.update(extra)

    await event_bus.publish(
        event_type,
        {
            **base,
            "direction": "outgoing",
            "peer_id": str(rel.target_id),
            "peer_name": target_name,
            "peer_type": target_type,
            "directional_label": forward,
            "summary": f"{forward} → {target_name or str(rel.target_id)}",
        },
        db=db,
        card_id=rel.source_id,
        user_id=actor_id,
    )
    await event_bus.publish(
        event_type,
        {
            **base,
            "direction": "incoming",
            "peer_id": str(rel.source_id),
            "peer_name": source_name,
            "peer_type": source_type,
            "directional_label": backward,
            "summary": f"{backward} ← {source_name or str(rel.source_id)}",
        },
        db=db,
        card_id=rel.target_id,
        user_id=actor_id,
    )


def _rel_to_response(
    r: Relation, *, strip_cost_keys: frozenset[str] = frozenset()
) -> RelationResponse:
    source_ref = (
        CardRef(id=str(r.source.id), type=r.source.type, name=r.source.name) if r.source else None
    )
    target_ref = (
        CardRef(id=str(r.target.id), type=r.target.type, name=r.target.name) if r.target else None
    )
    attrs = r.attributes
    if strip_cost_keys and attrs:
        attrs = {k: v for k, v in attrs.items() if k not in strip_cost_keys}
    return RelationResponse(
        id=str(r.id),
        type=r.type,
        source_id=str(r.source_id),
        target_id=str(r.target_id),
        source=source_ref,
        target=target_ref,
        attributes=attrs,
        description=r.description,
        created_at=r.created_at,
    )


async def _relation_cost_redaction(
    db: AsyncSession, user: User, rels: list[Relation]
) -> dict[uuid.UUID, frozenset[str]]:
    """Map relation_id → cost field keys to strip, based on the user's access
    to the source card (we treat the source card as the authoritative owner
    for cost visibility — most cost-bearing relation attributes describe the
    source card's costs, e.g. relAppToITC.costTotalAnnual)."""
    if not rels:
        return {}
    type_keys = {r.type for r in rels if r.type}
    if not type_keys:
        return {}
    rt_rows = await db.execute(
        select(RelationType.key, RelationType.attributes_schema).where(
            RelationType.key.in_(type_keys)
        )
    )
    cost_keys_per_rt: dict[str, frozenset[str]] = {}
    for k, schema in rt_rows.all():
        keys = cost_field_keys_from_relation_schema(schema)
        if keys:
            cost_keys_per_rt[k] = keys
    if not cost_keys_per_rt:
        return {}
    candidate_source_ids = [r.source_id for r in rels if r.type in cost_keys_per_rt]
    if not candidate_source_ids:
        return {}
    allowed = await PermissionService.card_ids_with_cost_access(db, user, candidate_source_ids)
    redact: dict[uuid.UUID, frozenset[str]] = {}
    for r in rels:
        cost_keys = cost_keys_per_rt.get(r.type)
        if cost_keys and r.source_id not in allowed:
            redact[r.id] = cost_keys
    return redact


@router.get("", response_model=list[RelationResponse])
async def list_relations(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    card_id: str | None = Query(None),
    type: str | None = Query(None),
):
    q = select(Relation)

    # Exclude relations involving cards of hidden types
    hidden_types_sq = select(CardType.key).where(CardType.is_hidden == True)  # noqa: E712
    src_fs = select(Card.id).where(Card.type.in_(hidden_types_sq))
    q = q.where(Relation.source_id.not_in(src_fs), Relation.target_id.not_in(src_fs))

    # Hide relations whose source or target is archived. Rows are kept on
    # archive so they reappear on restore; hard-delete and the 30-day
    # auto-purge clean them up.
    archived_sq = select(Card.id).where(Card.status == "ARCHIVED")
    q = q.where(Relation.source_id.not_in(archived_sq), Relation.target_id.not_in(archived_sq))

    if card_id:
        uid = uuid.UUID(card_id)
        q = q.where((Relation.source_id == uid) | (Relation.target_id == uid))
    if type:
        q = q.where(Relation.type == type)

    q = q.options(selectinload(Relation.source), selectinload(Relation.target))
    result = await db.execute(q)
    rels = list(result.scalars().all())
    redact = await _relation_cost_redaction(db, user, rels)
    return [_rel_to_response(r, strip_cost_keys=redact.get(r.id, frozenset())) for r in rels]


@router.post("", response_model=RelationResponse, status_code=201)
async def create_relation(
    body: RelationCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "relations.manage")
    rel = Relation(
        type=body.type,
        source_id=uuid.UUID(body.source_id),
        target_id=uuid.UUID(body.target_id),
        attributes=body.attributes or {},
        description=body.description,
    )
    db.add(rel)
    await db.flush()

    # Run calculated fields for both source and target cards
    source_card = await db.get(Card, uuid.UUID(body.source_id))
    target_card = await db.get(Card, uuid.UUID(body.target_id))
    if source_card:
        await run_calculations_for_card(db, source_card)
    if target_card:
        await run_calculations_for_card(db, target_card)

    await _emit_relation_events(
        db,
        event_type="relation.created",
        rel=rel,
        source_card=source_card,
        target_card=target_card,
        actor_id=user.id,
    )

    await db.commit()
    result = await db.execute(
        select(Relation)
        .where(Relation.id == rel.id)
        .options(selectinload(Relation.source), selectinload(Relation.target))
    )
    rel = result.scalar_one()
    redact = await _relation_cost_redaction(db, user, [rel])
    return _rel_to_response(rel, strip_cost_keys=redact.get(rel.id, frozenset()))


@router.patch("/{rel_id}", response_model=RelationResponse)
async def update_relation(
    rel_id: str,
    body: RelationUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "relations.manage")
    result = await db.execute(select(Relation).where(Relation.id == uuid.UUID(rel_id)))
    rel = result.scalar_one_or_none()
    if not rel:
        raise HTTPException(404, "Relation not found")
    update_data = body.model_dump(exclude_unset=True)
    # If the user lacks cost access on the source card, preserve any existing
    # cost-typed values on the relation. PATCH replaces `attributes` wholesale,
    # so we merge old cost values back into the incoming payload to prevent a
    # silent wipe of values the user was never allowed to see.
    if "attributes" in update_data and update_data["attributes"] is not None:
        if not await PermissionService.can_view_costs(db, user, rel.source_id):
            rt_row = await db.execute(
                select(RelationType.attributes_schema).where(RelationType.key == rel.type)
            )
            cost_keys = cost_field_keys_from_relation_schema(rt_row.scalar_one_or_none())
            if cost_keys:
                old_attrs = dict(rel.attributes or {})
                merged = {k: v for k, v in update_data["attributes"].items() if k not in cost_keys}
                for key in cost_keys:
                    if key in old_attrs:
                        merged[key] = old_attrs[key]
                update_data["attributes"] = merged
    changed_fields = sorted(update_data.keys())
    for field, value in update_data.items():
        setattr(rel, field, value)

    # Run calculated fields for both source and target cards
    source_card = await db.get(Card, rel.source_id)
    target_card = await db.get(Card, rel.target_id)
    if source_card:
        await run_calculations_for_card(db, source_card)
    if target_card:
        await run_calculations_for_card(db, target_card)

    if changed_fields:
        await _emit_relation_events(
            db,
            event_type="relation.updated",
            rel=rel,
            source_card=source_card,
            target_card=target_card,
            actor_id=user.id,
            extra={"fields": changed_fields},
        )

    await db.commit()
    result = await db.execute(
        select(Relation)
        .where(Relation.id == rel.id)
        .options(selectinload(Relation.source), selectinload(Relation.target))
    )
    rel = result.scalar_one()
    redact = await _relation_cost_redaction(db, user, [rel])
    return _rel_to_response(rel, strip_cost_keys=redact.get(rel.id, frozenset()))


@router.delete("/{rel_id}", status_code=204)
async def delete_relation(
    rel_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "relations.manage")
    result = await db.execute(select(Relation).where(Relation.id == uuid.UUID(rel_id)))
    rel = result.scalar_one_or_none()
    if not rel:
        raise HTTPException(404, "Relation not found")
    source_card = await db.get(Card, rel.source_id)
    target_card = await db.get(Card, rel.target_id)
    await _emit_relation_events(
        db,
        event_type="relation.deleted",
        rel=rel,
        source_card=source_card,
        target_card=target_card,
        actor_id=user.id,
    )
    await db.delete(rel)

    # Run calculated fields for both source and target cards
    if source_card:
        await run_calculations_for_card(db, source_card)
    if target_card:
        await run_calculations_for_card(db, target_card)

    await db.commit()


def _resolve_ref_input(
    ref_input,
    relation_type: RelationType,
    *,
    endpoint: str,
    resolver: CardResolver,
) -> uuid.UUID:
    """Resolve a `RelationRefInput` to a card UUID, raising `HTTPException`
    on ambiguity / miss / type-mismatch. `endpoint` is "source" or "target"
    — used in error messages and to pick the correct type constraint from
    the relation type definition."""
    if ref_input.id:
        try:
            return uuid.UUID(ref_input.id)
        except ValueError as exc:
            raise HTTPException(422, f"Invalid {endpoint} UUID: {ref_input.id}") from exc

    expected_type = (
        relation_type.source_type_key if endpoint == "source" else relation_type.target_type_key
    )
    # Allow callers to omit type and inherit it from the relation type
    # definition. If supplied, it must match — otherwise we silently
    # cross-link types in a way the metamodel doesn't allow.
    ref_type = ref_input.type or expected_type
    if ref_input.type and ref_input.type != expected_type:
        raise HTTPException(
            422,
            f"{endpoint.title()} type '{ref_input.type}' does not match relation type's "
            f"expected {endpoint} '{expected_type}'",
        )
    if not ref_input.name:
        raise HTTPException(422, f"{endpoint.title()} reference is missing a name")

    ref_str = " / ".join(
        [
            *(s.replace("\\", "\\\\").replace("/", "\\/") for s in (ref_input.parent_path or [])),
            ref_input.name.replace("\\", "\\\\").replace("/", "\\/"),
        ]
    )
    outcome = resolver.resolve(ref_type, ref_str)
    if outcome.status == "resolved" and outcome.card_id is not None:
        return outcome.card_id
    if outcome.status == "ambiguous":
        hints = ", ".join(c.display_path for c in (outcome.candidates or [])[:3])
        raise HTTPException(
            422,
            f"{endpoint.title()} reference is ambiguous ({ref_str}). Candidates: {hints}",
        )
    raise HTTPException(422, f"{endpoint.title()} not found: {ref_str}")


@router.post("/bulk", response_model=RelationBulkResponse)
async def bulk_relations(
    body: RelationBulkRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Batched upsert/delete for relations. Used by the spreadsheet importer
    to apply both inline `rel:<key>` columns and the explicit `Relations`
    sheet in one round-trip.

    Each operation independently succeeds or fails; failed rows do not
    roll back successful ones unless every row fails. Source and target
    may be referenced by UUID (when the importer has just created the card)
    or by `(type, parent_path, name)` for human-readable round-trips.

    Permission: `relations.manage`.
    """
    await PermissionService.require_permission(db, user, "relations.manage")

    operations = list(body.operations)

    # Preload every referenced relation type in one query.
    rt_keys: set[str] = {op.type for op in operations}
    rt_rows = await db.execute(select(RelationType).where(RelationType.key.in_(rt_keys)))
    rt_by_key: dict[str, RelationType] = {rt.key: rt for rt in rt_rows.scalars().all()}

    # Preload a resolver scoped to every type that may need name lookup —
    # both the source_type_key and target_type_key of each referenced
    # relation type, even if any individual operation supplies a UUID
    # (we still want the resolver ready in case some operations don't).
    type_keys: set[str] = set()
    for rt in rt_by_key.values():
        type_keys.add(rt.source_type_key)
        type_keys.add(rt.target_type_key)
    resolver = await CardResolver.load(db, type_keys)

    results: list[RelationBulkResult] = []
    upserted = 0
    deleted = 0
    failed = 0
    impacted_cards: set[uuid.UUID] = set()
    events_to_emit: list[tuple[str, Relation, Card | None, Card | None, dict | None]] = []

    for op in operations:
        try:
            # Distinct name from the outer `for rt in rt_by_key.values()`
            # loop above so mypy can keep the non-Optional narrowing intact.
            rt_def = rt_by_key.get(op.type)
            if rt_def is None:
                raise HTTPException(422, f"Unknown relation type: {op.type}")
            source_id = _resolve_ref_input(op.source, rt_def, endpoint="source", resolver=resolver)
            target_id = _resolve_ref_input(op.target, rt_def, endpoint="target", resolver=resolver)

            # Look up an existing relation of this (type, source, target).
            existing = await db.execute(
                select(Relation)
                .where(
                    Relation.type == op.type,
                    Relation.source_id == source_id,
                    Relation.target_id == target_id,
                )
                .options(selectinload(Relation.source), selectinload(Relation.target))
            )
            rel = existing.scalar_one_or_none()

            if op.action == "delete":
                if rel is None:
                    results.append(RelationBulkResult(row_index=op.row_index, status="noop"))
                    continue
                source_card = await db.get(Card, rel.source_id)
                target_card = await db.get(Card, rel.target_id)
                events_to_emit.append(("relation.deleted", rel, source_card, target_card, None))
                await db.delete(rel)
                impacted_cards.add(source_id)
                impacted_cards.add(target_id)
                deleted += 1
                results.append(RelationBulkResult(row_index=op.row_index, status="deleted"))
                continue

            # Upsert path.
            if rel is None:
                # Cardinality guards: 1:1 forbids a second relation of the
                # same type from this source or to this target; 1:n forbids
                # a second relation from the same source.
                if rt_def.cardinality in ("1:1", "1:n"):
                    existing_src = await db.scalar(
                        select(func.count(Relation.id)).where(
                            Relation.type == op.type, Relation.source_id == source_id
                        )
                    )
                    if existing_src and existing_src > 0:
                        raise HTTPException(
                            422,
                            f"Cardinality {rt_def.cardinality} forbids a second '{op.type}' "
                            "relation from this source",
                        )
                if rt_def.cardinality == "1:1":
                    existing_tgt = await db.scalar(
                        select(func.count(Relation.id)).where(
                            Relation.type == op.type, Relation.target_id == target_id
                        )
                    )
                    if existing_tgt and existing_tgt > 0:
                        raise HTTPException(
                            422,
                            f"Cardinality 1:1 forbids a second '{op.type}' relation to this target",
                        )

                rel = Relation(
                    type=op.type,
                    source_id=source_id,
                    target_id=target_id,
                    attributes=op.attributes or {},
                    description=op.description,
                )
                db.add(rel)
                await db.flush()
                # Reload with source/target for the event payload.
                refetched = await db.execute(
                    select(Relation)
                    .where(Relation.id == rel.id)
                    .options(selectinload(Relation.source), selectinload(Relation.target))
                )
                rel = refetched.scalar_one()
                events_to_emit.append(("relation.created", rel, rel.source, rel.target, None))
            else:
                changed: list[str] = []
                if op.attributes is not None and op.attributes != (rel.attributes or {}):
                    rel.attributes = op.attributes
                    changed.append("attributes")
                if op.description is not None and op.description != rel.description:
                    rel.description = op.description
                    changed.append("description")
                if changed:
                    events_to_emit.append(
                        (
                            "relation.updated",
                            rel,
                            rel.source,
                            rel.target,
                            {"fields": changed},
                        )
                    )

            impacted_cards.add(source_id)
            impacted_cards.add(target_id)
            upserted += 1
            results.append(
                RelationBulkResult(
                    row_index=op.row_index,
                    status="upserted",
                    relation_id=str(rel.id),
                )
            )

        except HTTPException as exc:
            failed += 1
            results.append(
                RelationBulkResult(row_index=op.row_index, status="failed", error=exc.detail)
            )
        except Exception as exc:  # noqa: BLE001 — surface anything to the user
            failed += 1
            results.append(
                RelationBulkResult(row_index=op.row_index, status="failed", error=str(exc))
            )

    # Recalculate calculated fields on every card touched by the batch.
    for cid in impacted_cards:
        card = await db.get(Card, cid)
        if card is not None:
            await run_calculations_for_card(db, card)

    # Emit all events after the writes settle so listeners see consistent
    # state if they query back.
    for event_type, rel, source_card, target_card, extra in events_to_emit:
        await _emit_relation_events(
            db,
            event_type=event_type,
            rel=rel,
            source_card=source_card,
            target_card=target_card,
            actor_id=user.id,
            extra=extra,
        )

    if failed > 0 and upserted == 0 and deleted == 0:
        await db.rollback()
    else:
        await db.commit()

    return RelationBulkResponse(results=results, upserted=upserted, deleted=deleted, failed=failed)
