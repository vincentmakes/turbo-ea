from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import case, exists, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased, selectinload

from app.api.deps import get_current_user
from app.database import get_db
from app.models.card import Card
from app.models.card_type import CardType
from app.models.relation import Relation
from app.models.relation_type import RelationType
from app.models.user import User
from app.schemas.relation import (
    CardRef,
    RelationBulkOperation,
    RelationBulkRequest,
    RelationBulkResponse,
    RelationBulkResult,
    RelationCreate,
    RelationResponse,
    RelationUpdate,
)
from app.services import card_write_service
from app.services.calculation_engine import run_calculations_for_card
from app.services.card_read_scope import CardReadScope, require_card_readable
from app.services.card_resolver import CardResolver
from app.services.cost_field_filter import cost_field_keys_from_relation_schema
from app.services.data_quality import calc_data_quality
from app.services.permission_service import PermissionService
from app.services.relation_orientation import orient_endpoints

router = APIRouter(prefix="/relations", tags=["relations"])

# Upper bound on `GET /relations?card_ids=`. Callers that need more (the Excel
# exporter walks the whole filtered inventory) chunk client-side; rejecting is
# deliberate so an over-long list can never be silently truncated into a
# partial answer that reads as complete.
MAX_CARD_IDS_PER_QUERY = 500


# Relation event emission lives in the shared card write service (B0
# extraction); re-exported here for legacy lazy importers (surveys.py).
from app.services.card_write_service import _emit_relation_events  # noqa: E402, F401


def _rel_to_response(
    r: Relation,
    *,
    strip_cost_keys: frozenset[str] = frozenset(),
    source_ref: CardRef | None = None,
    target_ref: CardRef | None = None,
) -> RelationResponse:
    """Serialise a relation.

    ``source_ref`` / ``target_ref`` let a caller supply the card refs it already
    selected (see ``list_relations``, which joins the two cards and pulls only
    the four ``CardRef`` columns). When omitted we fall back to the eagerly
    loaded ``r.source`` / ``r.target`` relationships — note both are
    ``lazy="noload"``, so an un-eager-loaded relation yields ``None`` rather
    than emitting a query.
    """
    if source_ref is None and r.source:
        source_ref = CardRef(
            id=str(r.source.id),
            type=r.source.type,
            name=r.source.name,
            subtype=r.source.subtype,
        )
    if target_ref is None and r.target:
        target_ref = CardRef(
            id=str(r.target.id),
            type=r.target.type,
            name=r.target.name,
            subtype=r.target.subtype,
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


async def _relation_readable(db: AsyncSession, user: User, rel: Relation) -> bool:
    """Both ends of ``rel`` are readable by ``user`` (module mode)."""
    read_scope = await CardReadScope.load(db, user)
    readable = await read_scope.readable_card_ids(db, {rel.source_id, rel.target_id}, mode="module")
    return rel.source_id in readable and rel.target_id in readable


@router.get("", response_model=list[RelationResponse])
async def list_relations(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    card_id: str | None = Query(None),
    type: str | None = Query(None),
    card_type: str | None = Query(
        None,
        description=(
            "Card-type key. Keeps relations whose source **or** target card is "
            "of this type — what the inventory grid needs to populate the "
            "relation columns of the selected type in one round trip."
        ),
    ),
    types: str | None = Query(
        None,
        description=(
            "Comma-separated relation-type keys. Superset of `type`, which "
            "stays for backwards compatibility."
        ),
    ),
    card_ids: str | None = Query(
        None,
        description=(
            "Comma-separated card UUIDs. Keeps relations whose source **or** "
            f"target is one of them. At most {MAX_CARD_IDS_PER_QUERY} ids per "
            "request — chunk larger sets client-side."
        ),
    ),
):
    # Join both endpoint cards up front. Every visibility guard below then
    # becomes a predicate on an already-joined row (reached by primary key)
    # instead of a `NOT IN (SELECT ...)` subplan — Postgres cannot turn those
    # into anti-joins, and `cards.status` is unindexed, so the previous form
    # scanned the whole card table twice per request.
    #
    # The joins also let us select just the four `CardRef` columns instead of
    # `selectinload`-ing two complete `Card` rows (whose `attributes` /
    # `lifecycle` JSONB and `description` were fetched, hydrated and then
    # discarded), and they carry the `card_type` filter for free.
    #
    # INNER JOIN is safe: `source_id` / `target_id` are NOT NULL FKs with
    # ON DELETE CASCADE, so a relation without both cards cannot exist.
    src = aliased(Card)
    tgt = aliased(Card)
    hidden_types_sq = select(CardType.key).where(CardType.is_hidden == True)  # noqa: E712
    # Module mode: this route is ungated, so only an explicit card-type View
    # deny subtracts. Both ends are filtered — a relation to a card the caller
    # may not read does not exist for them.
    read_scope = await CardReadScope.load(db, user)

    q = (
        select(
            Relation,
            src.id,
            src.type,
            src.name,
            src.subtype,
            tgt.id,
            tgt.type,
            tgt.name,
            tgt.subtype,
        )
        .join(src, Relation.source_id == src.id)
        .join(tgt, Relation.target_id == tgt.id)
        # Exclude relations involving cards of hidden types.
        .where(src.type.not_in(hidden_types_sq), tgt.type.not_in(hidden_types_sq))
        # Hide relations whose source or target is archived. Rows are kept on
        # archive so they reappear on restore; hard-delete and the 30-day
        # auto-purge clean them up.
        .where(src.status != "ARCHIVED", tgt.status != "ARCHIVED")
        .where(*read_scope.where(src, mode="module"), *read_scope.where(tgt, mode="module"))
    )

    if card_id:
        uid = uuid.UUID(card_id)
        q = q.where((Relation.source_id == uid) | (Relation.target_id == uid))
    if type:
        q = q.where(Relation.type == type)
    if card_type:
        q = q.where(or_(src.type == card_type, tgt.type == card_type))
    if types is not None:
        type_list = [t.strip() for t in types.split(",") if t.strip()]
        if not type_list:
            return []
        if len(type_list) == 1:
            q = q.where(Relation.type == type_list[0])
        else:
            q = q.where(Relation.type.in_(type_list))
    if card_ids is not None:
        raw_ids = [c.strip() for c in card_ids.split(",") if c.strip()]
        if len(raw_ids) > MAX_CARD_IDS_PER_QUERY:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"card_ids accepts at most {MAX_CARD_IDS_PER_QUERY} ids per request "
                    f"(got {len(raw_ids)}). Split the set into smaller batches."
                ),
            )
        # Skip silently-malformed UUIDs so a single bad id doesn't 500 a batch,
        # matching `GET /cards?ids=`.
        id_list: list[uuid.UUID] = []
        for raw in raw_ids:
            try:
                id_list.append(uuid.UUID(raw))
            except ValueError:
                continue
        if not id_list:
            return []
        q = q.where(or_(Relation.source_id.in_(id_list), Relation.target_id.in_(id_list)))

    # Deterministic order (#918). The card-detail case (`card_id=`) is ordered
    # by the *other* end's name so the payload already arrives in display order
    # and the section doesn't reorder on first paint. Every other caller — the
    # inventory's `card_type=` / `card_ids=` batches, which are unpaginated and
    # can run to thousands of rows — gets the cheap stable key only; those
    # callers join and sort names client-side anyway.
    #
    # The client sort in `RelationsSection` stays authoritative: PostgreSQL's
    # collation and JS `Intl.Collator` disagree on accents, case and CJK.
    if card_id:
        other_name = case((Relation.source_id == uuid.UUID(card_id), tgt.name), else_=src.name)
        q = q.order_by(Relation.type.asc(), other_name.asc(), Relation.id.asc())
    else:
        q = q.order_by(Relation.id.asc())

    result = await db.execute(q)
    rows = result.all()
    rels = [row[0] for row in rows]
    redact = await _relation_cost_redaction(db, user, rels)
    return [
        _rel_to_response(
            row[0],
            strip_cost_keys=redact.get(row[0].id, frozenset()),
            source_ref=CardRef(id=str(row[1]), type=row[2], name=row[3], subtype=row[4]),
            target_ref=CardRef(id=str(row[5]), type=row[6], name=row[7], subtype=row[8]),
        )
        for row in rows
    ]


@router.post("", response_model=RelationResponse, status_code=201)
async def create_relation(
    body: RelationCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "relations.manage")
    # An end hidden from the caller does not exist for them.
    await require_card_readable(db, user, uuid.UUID(body.source_id), mode="module")
    await require_card_readable(db, user, uuid.UUID(body.target_id), mode="module")
    # Idempotent upsert on (type, source, target) — discussion #905 — via the
    # shared card write service, so every write path merges instead of
    # duplicating.
    rel, _, _ = await card_write_service.upsert_relation(
        db,
        card_write_service.WriteActor.from_user(user),
        type_key=body.type,
        source_id=uuid.UUID(body.source_id),
        target_id=uuid.UUID(body.target_id),
        attributes=body.attributes,
        description=body.description,
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
    if not rel or not await _relation_readable(db, user, rel):
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

    # Run calculated fields for both source and target cards, then rescore.
    source_card = await db.get(Card, rel.source_id)
    target_card = await db.get(Card, rel.target_id)
    if source_card:
        await run_calculations_for_card(db, source_card)
        source_card.data_quality = await calc_data_quality(db, source_card)
    if target_card:
        await run_calculations_for_card(db, target_card)
        target_card.data_quality = await calc_data_quality(db, target_card)

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
    if not rel or not await _relation_readable(db, user, rel):
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
    # Flush before rescoring so the mandatory-relation check does not still
    # see the row that was just removed.
    await db.flush()

    # Run calculated fields for both source and target cards, then rescore.
    if source_card:
        await run_calculations_for_card(db, source_card)
        source_card.data_quality = await calc_data_quality(db, source_card)
    if target_card:
        await run_calculations_for_card(db, target_card)
        target_card.data_quality = await calc_data_quality(db, target_card)

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

    # Dry-run isolation — see the matching comment in `cards.py` bulk-create.
    dry_run_savepoint = await db.begin_nested() if body.dry_run else None

    results, upserted, deleted, failed = await apply_relation_operations(
        db,
        list(body.operations),
        actor_id=user.id,
        dry_run=body.dry_run,
        read_scope=await CardReadScope.load(db, user),
    )

    if body.dry_run:
        assert dry_run_savepoint is not None
        await dry_run_savepoint.rollback()
    elif failed > 0 and upserted == 0 and deleted == 0:
        await db.rollback()
    else:
        await db.commit()

    return RelationBulkResponse(
        results=results,
        upserted=upserted,
        deleted=deleted,
        failed=failed,
        dry_run=body.dry_run,
    )


_PendingEvent = tuple[str, Relation, Card | None, Card | None, dict | None]


async def _pending_event(
    db: AsyncSession, event_type: str, rel: Relation, extra: dict | None = None
) -> _PendingEvent:
    """A relation event to emit once the batch has settled, with both ends loaded."""
    return (
        event_type,
        rel,
        await db.get(Card, rel.source_id),
        await db.get(Card, rel.target_id),
        extra,
    )


async def _require_cardinality_room(
    db: AsyncSession, rt: RelationType, source_id: uuid.UUID, target_id: uuid.UUID
) -> None:
    """Refuse a new relation its type's cardinality has no room for.

    ``1:1`` and ``1:n`` allow one relation of the type per source; ``1:1``
    also allows one per target. ``n:m`` is unconstrained. Only the bulk path
    applies this: ``POST /relations`` carries no cardinality guard, and the
    card detail dialog enforces the same rule client-side.
    """
    if rt.cardinality in ("1:1", "1:n") and await db.scalar(
        select(exists().where(Relation.type == rt.key, Relation.source_id == source_id))
    ):
        raise HTTPException(
            422,
            f"Cardinality {rt.cardinality} forbids a second '{rt.key}' relation from this source",
        )
    if rt.cardinality == "1:1" and await db.scalar(
        select(exists().where(Relation.type == rt.key, Relation.target_id == target_id))
    ):
        raise HTTPException(
            422, f"Cardinality 1:1 forbids a second '{rt.key}' relation to this target"
        )


async def apply_relation_operations(
    db: AsyncSession,
    operations: list[RelationBulkOperation],
    *,
    actor_id: uuid.UUID,
    dry_run: bool,
    read_scope: CardReadScope | None = None,
) -> tuple[list[RelationBulkResult], int, int, int]:
    """Apply relation upsert/delete ops within the CURRENT transaction and
    return ``(results, upserted, deleted, failed)``.

    The caller owns the transaction lifecycle (savepoint / commit / rollback)
    — this helper never commits. A fresh ``CardResolver`` is loaded here, so
    name/path refs resolve against cards created earlier in the same session.
    The row lookup, the insert and the field merge are
    ``card_write_service``'s, shared with ``POST /relations``; what stays here
    is what a batch needs: cardinality guards, one recalculation per touched
    card rather than per operation, and events only once every write has
    settled. Events are emitted only when ``dry_run`` is False.

    ``read_scope`` (module mode) makes a card hidden from the caller resolve as
    missing, whether it was referenced by name or by id.
    """
    operations = list(operations)

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
    resolver = await CardResolver.load(db, type_keys, read_scope=read_scope, mode="module")
    check_ids = read_scope is not None and not read_scope.is_unrestricted(mode="module")

    results: list[RelationBulkResult] = []
    upserted = 0
    deleted = 0
    failed = 0
    impacted_cards: set[uuid.UUID] = set()
    events_to_emit: list[_PendingEvent] = []

    for op in operations:
        # Per-op savepoint so a single failing op (e.g. a relation whose
        # source/target card no longer exists — a foreign-key violation at
        # flush time) rolls back only itself instead of poisoning the whole
        # session transaction and cascading "transaction has been rolled back"
        # onto every later op. This is what makes the per-op result reporting
        # below actually hold under a partial failure.
        op_sp = await db.begin_nested()
        # Bookkeeping collected inside the savepoint and only committed to the
        # batch-level accumulators on success (in the `else` branch).
        op_events: list[_PendingEvent] = []
        op_impacted: list[uuid.UUID] = []
        op_result: RelationBulkResult
        try:
            # Distinct name from the outer `for rt in rt_by_key.values()`
            # loop above so mypy can keep the non-Optional narrowing intact.
            rt_def = rt_by_key.get(op.type)
            if rt_def is None:
                raise HTTPException(422, f"Unknown relation type: {op.type}")
            source_id = _resolve_ref_input(op.source, rt_def, endpoint="source", resolver=resolver)
            target_id = _resolve_ref_input(op.target, rt_def, endpoint="target", resolver=resolver)
            if check_ids:
                assert read_scope is not None
                readable = await read_scope.readable_card_ids(
                    db, {source_id, target_id}, mode="module"
                )
                if source_id not in readable or target_id not in readable:
                    raise HTTPException(404, "Card not found")
            # Name refs are type-checked above; id refs are not, so turn a pair
            # sent the other way round before the lookup, the delete and the
            # cardinality guards all key on it (#1140).
            source_id, target_id = await orient_endpoints(db, rt_def, source_id, target_id)

            rel = await card_write_service.find_relation(db, op.type, source_id, target_id)

            if op.action == "delete":
                if rel is None:
                    op_result = RelationBulkResult(row_index=op.row_index, status="noop")
                else:
                    op_events.append(await _pending_event(db, "relation.deleted", rel))
                    await db.delete(rel)
                    await db.flush()
                    op_impacted += [source_id, target_id]
                    op_result = RelationBulkResult(row_index=op.row_index, status="deleted")
            else:
                if rel is None:
                    await _require_cardinality_room(db, rt_def, source_id, target_id)
                    rel = card_write_service.add_relation(
                        db,
                        type_key=op.type,
                        source_id=source_id,
                        target_id=target_id,
                        attributes=op.attributes,
                        description=op.description,
                    )
                    await db.flush()
                    op_events.append(await _pending_event(db, "relation.created", rel))
                elif changed := card_write_service.merge_relation_fields(
                    rel, attributes=op.attributes, description=op.description
                ):
                    op_events.append(
                        await _pending_event(db, "relation.updated", rel, {"fields": changed})
                    )

                op_impacted += [source_id, target_id]
                op_result = RelationBulkResult(
                    row_index=op.row_index,
                    status="upserted",
                    relation_id=str(rel.id),
                )

        except HTTPException as exc:
            await op_sp.rollback()
            failed += 1
            results.append(
                RelationBulkResult(row_index=op.row_index, status="failed", error=exc.detail)
            )
        except Exception as exc:  # noqa: BLE001 — surface anything to the user
            await op_sp.rollback()
            failed += 1
            results.append(
                RelationBulkResult(row_index=op.row_index, status="failed", error=str(exc))
            )
        else:
            await op_sp.commit()
            events_to_emit.extend(op_events)
            impacted_cards.update(op_impacted)
            if op_result.status == "deleted":
                deleted += 1
            elif op_result.status == "upserted":
                upserted += 1
            results.append(op_result)

    # Recalculate calculated fields on every card touched by the batch, then
    # rescore it. The set is already deduplicated, so a 5000-op batch over a
    # dense subgraph costs one pass per *card*, not per operation.
    #
    # The rescore is skipped on dry-run rather than left to the caller's
    # savepoint: `card.data_quality = …` is an in-memory ORM assignment, and a
    # savepoint rollback does not clear it — the next autoflush in the same
    # session writes it into the outer transaction, so the preview would
    # persist a score. (`run_calculations_for_card` has the same shape and
    # predates this; left alone deliberately.) The preview loses nothing — it
    # reports upserted/deleted counts, never scores.
    for cid in impacted_cards:
        card = await db.get(Card, cid)
        if card is not None:
            await run_calculations_for_card(db, card)
            if not dry_run:
                card.data_quality = await calc_data_quality(db, card)

    # Emit all events after the writes settle so listeners see consistent
    # state if they query back. Skipped in dry-run mode — nothing was
    # persisted, so listeners must not be told it was.
    if not dry_run:
        for event_type, rel, source_card, target_card, extra in events_to_emit:
            await _emit_relation_events(
                db,
                event_type=event_type,
                rel=rel,
                source_card=source_card,
                target_card=target_card,
                actor_id=actor_id,
                extra=extra,
            )

    return results, upserted, deleted, failed
