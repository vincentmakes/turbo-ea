from __future__ import annotations

import csv
import io
import uuid
from datetime import datetime

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_user
from app.database import get_db
from app.models.card import Card
from app.models.card_type import CardType
from app.models.event import Event
from app.models.ppm_cost_line import PpmBudgetLine, PpmCostLine
from app.models.relation import Relation
from app.models.relation_type import RelationType
from app.models.stakeholder import Stakeholder
from app.models.stakeholder_role_definition import StakeholderRoleDefinition
from app.models.tag import Tag
from app.models.user import User
from app.schemas.card import (
    ArchiveImpactCardRef,
    ArchiveImpactChild,
    ArchiveImpactRelatedCard,
    ArchiveImpactResponse,
    CardArchiveRequest,
    CardArchiveResponse,
    CardBulkArchiveRequest,
    CardBulkArchiveResponse,
    CardBulkCreateRequest,
    CardBulkCreateResponse,
    CardBulkCreateResult,
    CardBulkDeleteRequest,
    CardBulkDeleteResponse,
    CardBulkDeleteSkippedEntry,
    CardBulkRestoreRequest,
    CardBulkRestoreResponse,
    CardBulkRestoreSkippedEntry,
    CardBulkSkippedEntry,
    CardBulkUpdate,
    CardCountsResponse,
    CardCreate,
    CardDeleteRequest,
    CardDeleteResponse,
    CardListResponse,
    CardRefCandidate,
    CardRefResolveRequest,
    CardRefResolveResponse,
    CardRefResolveResult,
    CardRelationSummaryEntry,
    CardRelationSummaryHierarchy,
    CardRelationSummaryResponse,
    CardResponse,
    CardRestoreRequest,
    CardRestoreResponse,
    CardTypeCount,
    CardUpdate,
    RestoreImpactPassenger,
    RestoreImpactResponse,
    StakeholderRef,
    TagRef,
)
from app.services import card_lifecycle, notification_service
from app.services.calculation_engine import run_calculations_for_card
from app.services.card_completeness import missing_mandatory
from app.services.card_resolver import CardResolver
from app.services.card_uniqueness import check_sibling_name_unique
from app.services.cost_field_filter import cost_field_keys_from_card_schema
from app.services.data_quality import calc_data_quality
from app.services.event_bus import event_bus
from app.services.hierarchy import HIERARCHY_LEVEL_KEY
from app.services.permission_service import PermissionService

# Fields that PPM budget/cost lines manage — calculations must not overwrite these.
_PPM_MANAGED_FIELDS = {"costBudget", "costActual"}


async def _get_ppm_exclusions(db: AsyncSession, card: Card) -> set[str]:
    """Return field keys that PPM manages for this card (skip in calculations)."""
    if card.type != "Initiative":
        return set()
    has_budget = await db.scalar(
        select(func.count(PpmBudgetLine.id)).where(PpmBudgetLine.initiative_id == card.id)
    )
    has_costs = await db.scalar(
        select(func.count(PpmCostLine.id)).where(PpmCostLine.initiative_id == card.id)
    )
    excluded: set[str] = set()
    if has_budget:
        excluded.add("costBudget")
    if has_costs:
        excluded.add("costActual")
    return excluded


router = APIRouter(prefix="/cards", tags=["cards"])

_ALLOWED_URL_SCHEMES = ("http://", "https://", "mailto:")


async def _validate_url_attributes(db: AsyncSession, card_type: str, attributes: dict) -> None:
    """Validate that any attribute whose field type is 'url' uses an allowed scheme."""
    if not attributes:
        return
    result = await db.execute(select(CardType.fields_schema).where(CardType.key == card_type))
    schema = result.scalar_one_or_none()
    if not schema:
        return
    url_keys: set[str] = set()
    for section in schema:
        for field in section.get("fields", []):
            if field.get("type") == "url":
                url_keys.add(field["key"])
    for key in url_keys:
        val = attributes.get(key)
        if val is not None and val != "":
            if not isinstance(val, str):
                raise HTTPException(422, f"Field '{key}' must be a string URL")
            if not val.strip().startswith(_ALLOWED_URL_SCHEMES):
                raise HTTPException(
                    422,
                    f"Field '{key}' must use http://, https://, or mailto: scheme",
                )


async def _validate_strict_attributes(db: AsyncSession, card_type: str, attributes: dict) -> None:
    """Reject ``attributes`` keys that are not declared in the type's
    ``fields_schema`` (S5).

    Off by default — importers legitimately stash side-channel metadata
    on the JSONB column. AI-agent writes opt in via
    ``strict_attributes=True`` so an LLM hallucinating a field name
    surfaces an actionable 422 with the valid key list instead of
    silently writing data that never renders in the UI.
    """
    if not attributes:
        return
    result = await db.execute(select(CardType.fields_schema).where(CardType.key == card_type))
    schema = result.scalar_one_or_none()
    if not schema:
        return
    valid_keys: set[str] = set()
    for section in schema:
        for field in section.get("fields", []):
            key = field.get("key")
            if key:
                valid_keys.add(key)
    unknown = sorted(k for k in attributes.keys() if k not in valid_keys)
    if unknown:
        raise HTTPException(
            422,
            {
                "error": "unknown_attribute_keys",
                "message": (
                    f"Card type '{card_type}' does not define attribute(s): "
                    f"{', '.join(unknown)}. Set strict_attributes=False to "
                    "store side-channel JSONB metadata anyway."
                ),
                "unknown_keys": unknown,
                "valid_keys": sorted(valid_keys),
                "card_type": card_type,
            },
        )


async def _max_descendant_depth(db: AsyncSession, card_id: uuid.UUID) -> int:
    """Return the maximum depth of the subtree rooted at card_id (0 if no children)."""
    children_result = await db.execute(
        select(Card.id).where(Card.parent_id == card_id, Card.status == "ACTIVE")
    )
    child_ids = [row[0] for row in children_result.all()]
    if not child_ids:
        return 0
    max_depth = 0
    for cid in child_ids:
        d = await _max_descendant_depth(db, cid)
        max_depth = max(max_depth, d + 1)
    return max_depth


MACRO_CAPABILITY_LEVEL_KEY: str = "Macro"


async def _walk_ancestor_chain(
    db: AsyncSession, start_id: uuid.UUID | None, *, exclude: set[uuid.UUID]
) -> tuple[int, bool]:
    """Walk up the parent chain from ``start_id``.

    Returns ``(depth, root_is_macro)`` where ``depth`` is the number of
    parents traversed and ``root_is_macro`` is True if the topmost ancestor
    (the one whose own parent_id is NULL) carries
    ``attributes.capabilityLevel == "Macro"``. Macro-rooted chains get
    special treatment in level math and depth checks: the macro itself
    occupies position 0 and doesn't count toward the L1..L5 limit.
    """
    depth = 0
    root_is_macro = False
    current_id = start_id
    seen: set[uuid.UUID] = set(exclude)
    last_attrs: dict | None = None
    while current_id and current_id not in seen:
        seen.add(current_id)
        depth += 1
        res = await db.execute(select(Card.parent_id, Card.attributes).where(Card.id == current_id))
        row = res.first()
        if row is None:
            break
        parent_id, attrs = row[0], row[1]
        if parent_id is None:
            last_attrs = attrs
        current_id = parent_id
    if last_attrs is not None and (last_attrs or {}).get("capabilityLevel") == (
        MACRO_CAPABILITY_LEVEL_KEY
    ):
        root_is_macro = True
    return depth, root_is_macro


async def _check_hierarchy_depth(
    db: AsyncSession, card: Card, new_parent_id: uuid.UUID | None
) -> None:
    """Raise HTTPException if setting new_parent_id would push any descendant beyond level 5.

    Macros sit at "level 0" above L1, so chains rooted at a macro are
    allowed to be one level deeper (Macro → L1 → L2 → L3 → L4 → L5).
    """
    if card.type != "BusinessCapability":
        return
    if new_parent_id is None:
        return  # removing parent always safe

    ancestor_depth, root_is_macro = await _walk_ancestor_chain(db, new_parent_id, exclude={card.id})

    # card itself would be at level = ancestor_depth + 1
    own_level = ancestor_depth + 1
    # deepest descendant would be at own_level + max_descendant_depth
    desc_depth = await _max_descendant_depth(db, card.id)
    deepest = own_level + desc_depth

    max_depth = 6 if root_is_macro else 5
    if deepest > max_depth:
        raise HTTPException(
            400,
            f"Cannot set parent: hierarchy would exceed maximum depth of {max_depth} levels "
            f"(this item would be L{own_level}, deepest descendant would be L{deepest})",
        )


async def _sync_hierarchy_levels(db: AsyncSession, card: Card) -> list[Card]:
    """Recompute hierarchy-level attributes for a card and its ACTIVE subtree.

    For any ``has_hierarchy`` card type, writes ``attributes.hierarchyLevel``
    (raw tree depth, 1 = root, not capped). For BusinessCapability it *also*
    maintains ``attributes.capabilityLevel`` (macro-aware, capped L1..L5) —
    macros stay pinned to ``"Macro"`` and never get their capabilityLevel
    recomputed, but do receive a raw ``hierarchyLevel`` like every node.

    Cascades into ACTIVE descendants and returns every visited card whose level
    value actually changed, so callers can re-run calculations only where the
    tree position moved.
    """
    hier_cache: dict[str, bool] = {}

    async def _is_hierarchical(type_key: str) -> bool:
        if type_key not in hier_cache:
            hier_cache[type_key] = bool(
                await db.scalar(select(CardType.has_hierarchy).where(CardType.key == type_key))
            )
        return hier_cache[type_key]

    changed: list[Card] = []
    await _sync_hierarchy_node(db, card, changed, _is_hierarchical)
    return changed


async def _sync_hierarchy_node(
    db: AsyncSession,
    card: Card,
    changed: list[Card],
    is_hierarchical,
) -> None:
    hier = await is_hierarchical(card.type)
    is_bizcap = card.type == "BusinessCapability"
    # Nothing to compute for a card that is neither hierarchical nor a
    # BusinessCapability (capabilityLevel is maintained for BusinessCapability
    # regardless of the has_hierarchy flag — preserving pre-existing behaviour).
    if not hier and not is_bizcap:
        return

    depth, root_is_macro = await _walk_ancestor_chain(db, card.parent_id, exclude={card.id})
    attrs = dict(card.attributes or {})
    dirty = False

    if hier:
        raw_level = depth + 1  # NOT macro-aware, NOT capped
        if attrs.get(HIERARCHY_LEVEL_KEY) != raw_level:
            attrs[HIERARCHY_LEVEL_KEY] = raw_level
            dirty = True

    if is_bizcap:
        # Macros are pinned — keep "Macro", never recompute their capabilityLevel.
        if attrs.get("capabilityLevel") != MACRO_CAPABILITY_LEVEL_KEY:
            logical_depth = max(depth - 1, 0) if root_is_macro else depth
            level_key = f"L{min(logical_depth + 1, 5)}"
            if attrs.get("capabilityLevel") != level_key:
                attrs["capabilityLevel"] = level_key
                dirty = True

    if dirty:
        card.attributes = attrs
        changed.append(card)

    # Cascade to ACTIVE direct children
    children_result = await db.execute(
        select(Card).where(Card.parent_id == card.id, Card.status == "ACTIVE")
    )
    for child in children_result.scalars().all():
        await _sync_hierarchy_node(db, child, changed, is_hierarchical)


async def _recalc_changed_descendants(
    db: AsyncSession, changed: list[Card], primary_card_id: uuid.UUID
) -> None:
    """Re-run calculations for descendants whose hierarchy level moved.

    Keeps formulas that reference ``hierarchy_level`` / ``parent`` correct after
    a subtree is re-parented. The primary card is skipped — its caller runs
    calculations for it separately (so ordering stays parent-before-children).
    """
    for c in changed:
        if c.id == primary_card_id:
            continue
        excl = await _get_ppm_exclusions(db, c)
        await run_calculations_for_card(db, c, exclude_fields=excl)


def _card_to_response(card: Card, *, strip_cost_keys: frozenset[str] = frozenset()) -> CardResponse:
    tags = []
    for t in card.tags or []:
        tags.append(
            TagRef(
                id=str(t.id),
                name=t.name,
                color=t.color,
                group_name=t.group.name if t.group else None,
            )
        )
    stakeholder_refs = []
    for s in card.stakeholders or []:
        stakeholder_refs.append(
            StakeholderRef(
                id=str(s.id),
                user_id=str(s.user_id),
                role=s.role,
                user_display_name=s.user.display_name if s.user else None,
                user_email=s.user.email if s.user else None,
            )
        )
    attributes = card.attributes
    if strip_cost_keys and attributes:
        attributes = {k: v for k, v in attributes.items() if k not in strip_cost_keys}
    return CardResponse(
        id=str(card.id),
        type=card.type,
        subtype=card.subtype,
        name=card.name,
        description=card.description,
        parent_id=str(card.parent_id) if card.parent_id else None,
        lifecycle=card.lifecycle,
        attributes=attributes,
        status=card.status,
        approval_status=card.approval_status,
        data_quality=card.data_quality,
        external_id=card.external_id,
        alias=card.alias,
        archived_at=card.archived_at,
        created_by=str(card.created_by) if card.created_by else None,
        updated_by=str(card.updated_by) if card.updated_by else None,
        created_at=card.created_at,
        updated_at=card.updated_at,
        tags=tags,
        stakeholders=stakeholder_refs,
    )


async def _cost_redaction_map(
    db: AsyncSession, user: User, cards: list[Card]
) -> dict[uuid.UUID, frozenset[str]]:
    """Return a map of card_id → cost field keys to strip for this user.

    Cards whose costs the user is allowed to see are absent from the map.
    """
    if not cards:
        return {}
    type_keys = {c.type for c in cards if c.type}
    if not type_keys:
        return {}
    rows = await db.execute(
        select(CardType.key, CardType.fields_schema).where(CardType.key.in_(type_keys))
    )
    cost_keys_per_type: dict[str, frozenset[str]] = {}
    for tk, schema in rows.all():
        keys = cost_field_keys_from_card_schema(schema)
        if keys:
            cost_keys_per_type[tk] = keys
    if not cost_keys_per_type:
        return {}
    candidate_ids = [c.id for c in cards if c.type in cost_keys_per_type]
    if not candidate_ids:
        return {}
    allowed = await PermissionService.card_ids_with_cost_access(db, user, candidate_ids)
    redact: dict[uuid.UUID, frozenset[str]] = {}
    for card in cards:
        cost_keys = cost_keys_per_type.get(card.type)
        if cost_keys and card.id not in allowed:
            redact[card.id] = cost_keys
    return redact


async def _card_response_with_cost_check(db: AsyncSession, user: User, card: Card) -> CardResponse:
    """Build a CardResponse, redacting cost fields per the cost permission rule."""
    redact = await _cost_redaction_map(db, user, [card])
    return _card_to_response(card, strip_cost_keys=redact.get(card.id, frozenset()))


_ALLOWED_SORT_COLUMNS = {
    "name",
    "type",
    "status",
    "approval_status",
    "data_quality",
    "created_at",
    "updated_at",
    "subtype",
}


@router.get("", response_model=CardListResponse)
async def list_cards(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    type: str | None = Query(None),
    status: str | None = Query(None, alias="status"),
    search: str | None = Query(None, max_length=200),
    parent_id: str | None = Query(None),
    approval_status: str | None = Query(None),
    mine: str | None = Query(
        None,
        pattern="^(stakeholder)$",
        description=(
            "Scope the result to cards related to the current user. "
            "`stakeholder` keeps only cards on which the user holds at least "
            "one stakeholder role."
        ),
    ),
    ids: str | None = Query(
        None,
        description=(
            "Comma-separated UUIDs to fetch in one round trip. Used by the "
            "diagram editor's view perspectives to recolor cells."
        ),
    ),
    page: int = Query(1, ge=1),
    page_size: int = Query(10000, ge=1, le=10000),
    sort_by: str = Query("name"),
    sort_dir: str = Query("asc"),
):
    await PermissionService.require_permission(db, user, "inventory.view")
    q = select(Card)
    count_q = select(func.count(Card.id))

    # Exclude cards whose type is hidden
    hidden_types_sq = select(CardType.key).where(CardType.is_hidden == True)  # noqa: E712
    q = q.where(Card.type.not_in(hidden_types_sq))
    count_q = count_q.where(Card.type.not_in(hidden_types_sq))

    if ids:
        # Skip silently-malformed UUIDs so a single bad id doesn't 500 a batch.
        id_list: list[uuid.UUID] = []
        for raw in ids.split(","):
            raw = raw.strip()
            if not raw:
                continue
            try:
                id_list.append(uuid.UUID(raw))
            except ValueError:
                continue
        if not id_list:
            return CardListResponse(items=[], total=0, page=page, page_size=page_size)
        q = q.where(Card.id.in_(id_list))
        count_q = count_q.where(Card.id.in_(id_list))

    if type:
        types_list = [t.strip() for t in type.split(",") if t.strip()]
        if len(types_list) == 1:
            q = q.where(Card.type == types_list[0])
            count_q = count_q.where(Card.type == types_list[0])
        elif types_list:
            q = q.where(Card.type.in_(types_list))
            count_q = count_q.where(Card.type.in_(types_list))
    if status:
        statuses = [s.strip() for s in status.split(",") if s.strip()]
        if len(statuses) == 1:
            q = q.where(Card.status == statuses[0])
            count_q = count_q.where(Card.status == statuses[0])
        else:
            q = q.where(Card.status.in_(statuses))
            count_q = count_q.where(Card.status.in_(statuses))
    elif not ids:
        # When fetching specific ids, callers expect to receive what they
        # asked for regardless of status (e.g. a saved diagram referencing an
        # archived card should still surface the card so the view can flag it).
        q = q.where(Card.status == "ACTIVE")
        count_q = count_q.where(Card.status == "ACTIVE")
    if search:
        like = f"%{search}%"
        q = q.where(or_(Card.name.ilike(like), Card.description.ilike(like)))
        count_q = count_q.where(or_(Card.name.ilike(like), Card.description.ilike(like)))
    if parent_id:
        q = q.where(Card.parent_id == uuid.UUID(parent_id))
        count_q = count_q.where(Card.parent_id == uuid.UUID(parent_id))
    if approval_status:
        statuses = [s.strip() for s in approval_status.split(",") if s.strip()]
        q = q.where(Card.approval_status.in_(statuses))
        count_q = count_q.where(Card.approval_status.in_(statuses))
    if mine == "stakeholder":
        mine_cards_sq = select(Stakeholder.card_id).where(Stakeholder.user_id == user.id).distinct()
        q = q.where(Card.id.in_(mine_cards_sq))
        count_q = count_q.where(Card.id.in_(mine_cards_sq))

    # Sorting — H9: whitelist sort columns
    if sort_by not in _ALLOWED_SORT_COLUMNS:
        sort_by = "name"
    sort_col = getattr(Card, sort_by, Card.name)
    q = q.order_by(sort_col.desc() if sort_dir == "desc" else sort_col.asc())
    q = q.offset((page - 1) * page_size).limit(page_size)

    total_result = await db.execute(count_q)
    total = total_result.scalar() or 0

    q = q.options(
        selectinload(Card.tags).selectinload(Tag.group),
        selectinload(Card.stakeholders).selectinload(Stakeholder.user),
    )
    result = await db.execute(q)
    cards = list(result.scalars().all())
    redact = await _cost_redaction_map(db, user, cards)
    items = [
        _card_to_response(card, strip_cost_keys=redact.get(card.id, frozenset())) for card in cards
    ]

    return CardListResponse(items=items, total=total, page=page, page_size=page_size)


# ---------------------------------------------------------------------------
# Personal "My Workspace" endpoints — must be declared BEFORE /{card_id}
# so the literal paths win over the UUID catch-all.
# ---------------------------------------------------------------------------


@router.get("/my-stakeholder")
async def list_my_stakeholder_cards(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    limit: int = Query(200, ge=1, le=500),
    user_id: uuid.UUID | None = Query(
        None,
        description=(
            "Look up another user's stakeholder cards instead of your own. "
            "When omitted (or equal to the caller's id) returns the current "
            "user — same as the no-arg behaviour. When set to another user's "
            "id, requires the `stakeholders.view` permission."
        ),
    ),
):
    """Cards on which the target user holds at least one stakeholder role.

    Defaults to the **current user** so the legacy
    ``GET /cards/my-stakeholder`` (no query params) keeps powering the
    Workspace → "My roles" dashboard section without changes.

    Pass ``?user_id=<uuid>`` to look up another user's stakeholder
    portfolio — the Workspace section reuses this to offer a "view as
    another user" picker. Cross-user lookups require ``stakeholders.view``.

    Returns cards plus a ``roles_by_card_id`` map keyed by card id, where
    each entry is a list of role descriptors ``{key, label, color,
    translations}`` resolved from the matching ``StakeholderRoleDefinition``
    for the card's type. The frontend uses ``label`` + ``translations`` to
    render a localised role chip per role.
    """
    target_user_id = user_id if user_id is not None else user.id

    # Self-lookups need the same gate as the rest of the workspace; cross-user
    # lookups additionally require `stakeholders.view`.
    await PermissionService.require_permission(db, user, "inventory.view")
    if target_user_id != user.id:
        target = await db.get(User, target_user_id)
        if target is None:
            raise HTTPException(status_code=404, detail="User not found")
        await PermissionService.require_permission(db, user, "stakeholders.view")

    hidden_types_sq = select(CardType.key).where(CardType.is_hidden == True)  # noqa: E712

    roles_subq = (
        select(
            Stakeholder.card_id.label("card_id"),
            func.array_agg(Stakeholder.role).label("roles"),
        )
        .where(Stakeholder.user_id == target_user_id)
        .group_by(Stakeholder.card_id)
        .subquery()
    )

    q = (
        select(Card, roles_subq.c.roles)
        .join(roles_subq, roles_subq.c.card_id == Card.id)
        .where(Card.status == "ACTIVE")
        .where(Card.type.not_in(hidden_types_sq))
        .order_by(Card.updated_at.desc())
        .limit(limit)
        .options(
            selectinload(Card.tags).selectinload(Tag.group),
            selectinload(Card.stakeholders).selectinload(Stakeholder.user),
        )
    )

    result = await db.execute(q)
    rows = list(result.all())

    # Resolve role definitions for the (card_type, role_key) pairs we just
    # fetched, in a single query.
    needed_pairs: set[tuple[str, str]] = set()
    for card, roles in rows:
        for r in roles or []:
            needed_pairs.add((card.type, r))

    role_def_map: dict[tuple[str, str], StakeholderRoleDefinition] = {}
    if needed_pairs:
        type_keys = {pair[0] for pair in needed_pairs}
        role_keys = {pair[1] for pair in needed_pairs}
        srd_rows = await db.execute(
            select(StakeholderRoleDefinition).where(
                StakeholderRoleDefinition.card_type_key.in_(type_keys),
                StakeholderRoleDefinition.key.in_(role_keys),
            )
        )
        for srd in srd_rows.scalars().all():
            role_def_map[(srd.card_type_key, srd.key)] = srd

    items = []
    roles_by_card_id: dict[str, list[dict]] = {}
    for card, roles in rows:
        items.append(_card_to_response(card))
        descriptors: list[dict] = []
        seen: set[str] = set()
        for role_key in roles or []:
            if role_key in seen:
                continue
            seen.add(role_key)
            srd = role_def_map.get((card.type, role_key))
            descriptors.append(
                {
                    "key": role_key,
                    "label": srd.label if srd else role_key,
                    "color": srd.color if srd else "#757575",
                    "translations": srd.translations if srd else {},
                }
            )
        roles_by_card_id[str(card.id)] = descriptors

    return {"items": items, "roles_by_card_id": roles_by_card_id}


@router.get("/my-created")
async def list_my_created_cards(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """Cards the current user originally created (via ``Card.created_by``).

    Supports simple offset/limit pagination so the Dashboard → My
    Workspace → Cards I Created section can offer a "Show more" button
    on long lists.
    """
    await PermissionService.require_permission(db, user, "inventory.view")

    hidden_types_sq = select(CardType.key).where(CardType.is_hidden == True)  # noqa: E712

    base = (
        select(Card)
        .where(Card.created_by == user.id)
        .where(Card.status == "ACTIVE")
        .where(Card.type.not_in(hidden_types_sq))
    )

    total = (
        await db.execute(
            select(func.count())
            .select_from(Card)
            .where(Card.created_by == user.id)
            .where(Card.status == "ACTIVE")
            .where(Card.type.not_in(hidden_types_sq))
        )
    ).scalar() or 0

    q = (
        base.order_by(Card.created_at.desc())
        .offset(offset)
        .limit(limit)
        .options(
            selectinload(Card.tags).selectinload(Tag.group),
            selectinload(Card.stakeholders).selectinload(Stakeholder.user),
        )
    )
    result = await db.execute(q)
    cards = list(result.scalars().all())
    redact = await _cost_redaction_map(db, user, cards)
    items = [
        _card_to_response(card, strip_cost_keys=redact.get(card.id, frozenset())) for card in cards
    ]
    return {
        "items": items,
        "total": total,
        "offset": offset,
        "limit": limit,
        "has_more": (offset + len(items)) < total,
    }


@router.post("", response_model=CardResponse, status_code=201)
async def create_card(
    body: CardCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "inventory.create")
    await _validate_url_attributes(db, body.type, body.attributes or {})
    if body.strict_attributes:
        await _validate_strict_attributes(db, body.type, body.attributes or {})
    parent_uuid = uuid.UUID(body.parent_id) if body.parent_id else None
    await check_sibling_name_unique(db, type_key=body.type, parent_id=parent_uuid, name=body.name)
    card = Card(
        type=body.type,
        subtype=body.subtype,
        name=body.name,
        description=body.description,
        parent_id=parent_uuid,
        lifecycle=body.lifecycle or {},
        attributes=body.attributes or {},
        external_id=body.external_id,
        alias=body.alias,
        approval_status="DRAFT",
        created_by=user.id,
        updated_by=user.id,
    )
    db.add(card)
    await db.flush()

    # Guard: hierarchy depth limit for BusinessCapability
    if card.parent_id:
        await _check_hierarchy_depth(db, card, card.parent_id)

    # Auto-set hierarchy levels (hierarchyLevel for any hierarchical type;
    # capabilityLevel for BusinessCapability)
    changed_levels = await _sync_hierarchy_levels(db, card)

    # Compute data quality score
    card.data_quality = await calc_data_quality(db, card)

    # Run calculated fields (skip PPM-managed cost fields if PPM data exists)
    ppm_excl = await _get_ppm_exclusions(db, card)
    await run_calculations_for_card(db, card, exclude_fields=ppm_excl)
    await _recalc_changed_descendants(db, changed_levels, card.id)

    await event_bus.publish(
        "card.created",
        {"id": str(card.id), "type": card.type, "name": card.name},
        db=db,
        card_id=card.id,
        user_id=user.id,
    )
    await db.commit()
    result = await db.execute(
        select(Card)
        .where(Card.id == card.id)
        .options(
            selectinload(Card.tags).selectinload(Tag.group),
            selectinload(Card.stakeholders).selectinload(Stakeholder.user),
        )
    )
    card = result.scalar_one()
    return await _card_response_with_cost_check(db, user, card)


def _path_key(type_key: str, parent_path: list[str] | None, name: str) -> str:
    """Canonical lookup key shared with the importer's path matching.

    Lower-cased so the matching stays case-insensitive, with `|` separating
    the type from the path. Path is joined with `/` after the same escaping
    used on export (`encodePathSegment()`)."""
    path = parent_path or []
    return f"{type_key.lower()}|{'/'.join(p.strip().lower() for p in path)}/{name.strip().lower()}"


@router.post("/bulk-create", response_model=CardBulkCreateResponse)
async def bulk_create_cards(
    body: CardBulkCreateRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Batched card creation for the spreadsheet importer.

    Each row carries its own `row_index` so the caller can pair the
    response back to its spreadsheet row. Parents may be referenced by
    UUID (`parent_id`) or by `(parent_path, parent_name)` — the server
    resolves names server-side against the existing inventory and against
    other rows in the same request (which may not exist yet).

    Rows are processed in topological order: parents come before children
    so FK constraints never fire. If a row's parent cannot be resolved
    even after every other row has been placed, it fails with a clear
    `parent_not_resolved` error instead of producing an orphan card.

    Single transaction per request — partial failures still roll back
    succeeded rows in the same batch. Permission: `inventory.create`.
    """
    await PermissionService.require_permission(db, user, "inventory.create")

    rows = list(body.cards)

    # `row_index` is used as a dict key throughout this handler (parent
    # resolution, topo sort, per-row results) and by the caller to pair each
    # response back to its source row. Duplicate indices would silently
    # collapse rows — one card dropped, both reported "created" with the same
    # id. Reject them loudly so a buggy caller fails fast instead of losing
    # data quietly (see issue #767: the importer used to send per-sheet row
    # numbers that collided across sheets). Checked before the dry-run
    # savepoint is opened so the error path leaves no dangling transaction.
    seen_indices: set[int] = set()
    duplicate_indices: set[int] = set()
    for r in rows:
        if r.row_index in seen_indices:
            duplicate_indices.add(r.row_index)
        else:
            seen_indices.add(r.row_index)
    if duplicate_indices:
        raise HTTPException(
            status_code=422,
            detail=(
                "Duplicate row_index values in batch: "
                f"{', '.join(str(i) for i in sorted(duplicate_indices))}. "
                "Each card must carry a unique row_index."
            ),
        )

    # Dry-run isolation: wrap the whole batch in our own savepoint so the
    # discard at the end only undoes our work and never reaches a wrapping
    # transaction (e.g. the savepoint that backs the integration-test
    # fixture). `session.rollback()` on its own would rewind to the outer
    # transaction and take fixture data with it.
    dry_run_savepoint = await db.begin_nested() if body.dry_run else None

    by_index: dict[int, CardBulkCreateResult] = {}

    # Build a resolver scoped to every type that might serve as a parent.
    # That's any type referenced by a `parent_path/name` ref. We always
    # include the rows' own types so resolution against the live DB works.
    parent_types: set[str] = {r.type for r in rows}
    resolver = await CardResolver.load(db, parent_types)

    # Build a dep graph: each row → its parent row (if the parent is in the
    # same batch). Rows that resolve their parent against the live DB or
    # have no parent are roots in the topo sort.
    parent_row_of: dict[int, int | None] = {}
    for r in rows:
        parent_row_idx: int | None = None
        # Only look up a same-batch parent when the row didn't supply a UUID.
        if r.parent_id is None and r.parent_name:
            # The child references its parent by the FULL ancestor chain
            # (`parent_path` = every level above the parent, `parent_name` =
            # the parent itself).
            full_ref = _path_key(r.type, r.parent_path or [], r.parent_name)
            bare_ref = _path_key(r.type, [], r.parent_name)
            bare_fallback: int | None = None
            for other in rows:
                if other is r or other.type != r.type:
                    continue
                # Exact `(parent_path, name)` match wins.
                if _path_key(other.type, other.parent_path or [], other.name) == full_ref:
                    parent_row_idx = other.row_index
                    break
                # Bare-name match is the fallback. A parent row indexes itself
                # under its OWN (shorter) parent_path, while the child names it
                # with the full ancestor chain, so the full keys never line up
                # for hierarchies 3+ levels deep — the topo edge would be lost
                # and a deep child could be processed before its parent exists
                # ("Parent not found"). Matching the bare name restores the
                # ordering edge; it mirrors the resolution pass below, which
                # also falls back to the bare-name index.
                if bare_fallback is None and _path_key(other.type, [], other.name) == bare_ref:
                    bare_fallback = other.row_index
            if parent_row_idx is None:
                parent_row_idx = bare_fallback
        parent_row_of[r.row_index] = parent_row_idx

    # Kahn's algorithm: produce a list of row_indices in topo order.
    in_degree: dict[int, int] = {r.row_index: 0 for r in rows}
    for child_idx, parent_idx in parent_row_of.items():
        if parent_idx is not None and parent_idx in in_degree:
            in_degree[child_idx] = 1
    order: list[int] = [idx for idx, deg in in_degree.items() if deg == 0]
    placed: set[int] = set(order)
    # Build inverse: parent → children
    children_of: dict[int, list[int]] = {}
    for child_idx, parent_idx in parent_row_of.items():
        if parent_idx is not None:
            children_of.setdefault(parent_idx, []).append(child_idx)
    cursor = 0
    while cursor < len(order):
        current = order[cursor]
        cursor += 1
        for child in children_of.get(current, []):
            if child not in placed:
                placed.add(child)
                order.append(child)
    # Any rows not placed have a parent cycle — fail them.
    cycle_rows = [r.row_index for r in rows if r.row_index not in placed]

    rows_by_index = {r.row_index: r for r in rows}
    # Track created card ids by their `(type, parent_path, name)` so that
    # child rows in the same batch can resolve their parent.
    created_path_to_id: dict[str, uuid.UUID] = {}

    for row_idx in order:
        r = rows_by_index[row_idx]
        # Per-row savepoint so a row that fails at flush time (e.g. a database
        # integrity error) rolls back only itself. Without this, one failed
        # flush poisons the whole session transaction and every subsequent row
        # cascades with "transaction has been rolled back" — defeating the
        # per-row result reporting this handler is built around.
        row_sp = await db.begin_nested()
        try:
            await _validate_url_attributes(db, r.type, r.attributes or {})

            # Resolve parent_id.
            resolved_parent: uuid.UUID | None = None
            if r.parent_id:
                try:
                    resolved_parent = uuid.UUID(r.parent_id)
                except ValueError as exc:
                    raise HTTPException(422, f"Invalid parent_id UUID: {r.parent_id}") from exc
            elif r.parent_name:
                # Look up against same-batch created rows first.
                ref_keys = [
                    _path_key(r.type, r.parent_path or [], r.parent_name),
                    _path_key(r.type, [], r.parent_name),
                ]
                for key in ref_keys:
                    if key in created_path_to_id:
                        resolved_parent = created_path_to_id[key]
                        break
                if resolved_parent is None:
                    parent_path_segs = r.parent_path or []
                    escaped_segs = [
                        s.replace("\\", "\\\\").replace("/", "\\/") for s in parent_path_segs
                    ]
                    escaped_name = r.parent_name.replace("\\", "\\\\").replace("/", "\\/")
                    ref_str = " / ".join([*escaped_segs, escaped_name])
                    result = resolver.resolve(r.type, ref_str)
                    if result.status == "resolved" and result.card_id is not None:
                        resolved_parent = result.card_id
                    elif result.status == "ambiguous":
                        candidates = [c.display_path for c in (result.candidates or [])][:3]
                        raise HTTPException(
                            422,
                            "Parent reference is ambiguous: " + ", ".join(candidates),
                        )
                    else:
                        raise HTTPException(422, f"Parent not found for ref: {ref_str}")

            # Block siblings with duplicate names — keeps the LeanIX-style
            # name+path ref format unambiguous for re-imports. Existing
            # duplicates from before this check are not touched; only new
            # collisions are rejected. Per-row failure here doesn't roll
            # back the rest of the batch.
            await check_sibling_name_unique(
                db,
                type_key=r.type,
                parent_id=resolved_parent,
                name=r.name,
            )

            card = Card(
                type=r.type,
                subtype=r.subtype,
                name=r.name,
                description=r.description,
                parent_id=resolved_parent,
                lifecycle=r.lifecycle or {},
                attributes=r.attributes or {},
                external_id=r.external_id,
                alias=r.alias,
                approval_status=r.approval_status or "DRAFT",
                created_by=user.id,
                updated_by=user.id,
            )
            db.add(card)
            await db.flush()

            if card.parent_id:
                await _check_hierarchy_depth(db, card, card.parent_id)
            changed_levels = await _sync_hierarchy_levels(db, card)
            card.data_quality = await calc_data_quality(db, card)
            ppm_excl = await _get_ppm_exclusions(db, card)
            await run_calculations_for_card(db, card, exclude_fields=ppm_excl)
            await _recalc_changed_descendants(db, changed_levels, card.id)

            if not body.dry_run:
                await event_bus.publish(
                    "card.created",
                    {"id": str(card.id), "type": card.type, "name": card.name},
                    db=db,
                    card_id=card.id,
                    user_id=user.id,
                )
        except HTTPException as exc:
            await row_sp.rollback()
            by_index[r.row_index] = CardBulkCreateResult(
                row_index=r.row_index, status="failed", error=exc.detail
            )
        except Exception as exc:  # noqa: BLE001 — surface anything to the user
            await row_sp.rollback()
            by_index[r.row_index] = CardBulkCreateResult(
                row_index=r.row_index, status="failed", error=str(exc)
            )
        else:
            await row_sp.commit()
            # Index this freshly-created card so subsequent rows can reference
            # it as a parent (under both its full path and bare-name keys).
            full_key = _path_key(r.type, r.parent_path or [], r.name)
            bare_key = _path_key(r.type, [], r.name)
            created_path_to_id[full_key] = card.id
            created_path_to_id.setdefault(bare_key, card.id)

            by_index[r.row_index] = CardBulkCreateResult(
                row_index=r.row_index, status="created", id=str(card.id)
            )

    for cycle_idx in cycle_rows:
        by_index[cycle_idx] = CardBulkCreateResult(
            row_index=cycle_idx,
            status="failed",
            error="Parent reference forms a cycle within the import batch",
        )

    results = [by_index[r.row_index] for r in rows]
    created_count = sum(1 for r in results if r.status == "created")
    failed_count = sum(1 for r in results if r.status == "failed")

    if body.dry_run:
        # Preview-only mode: every validator and resolver has already run,
        # but the agent expects to confirm before persisting. Roll back the
        # handler-local savepoint so the agent sees the would-be outcome
        # without touching the inventory — and without unwinding any
        # caller-supplied transaction.
        assert dry_run_savepoint is not None
        await dry_run_savepoint.rollback()
    elif failed_count > 0 and created_count == 0:
        # Nothing succeeded — roll back so we don't half-apply.
        await db.rollback()
    else:
        await db.commit()

    return CardBulkCreateResponse(
        results=results,
        created=created_count,
        failed=failed_count,
        dry_run=body.dry_run,
    )


@router.post("/resolve-refs", response_model=CardRefResolveResponse)
async def resolve_card_refs(
    body: CardRefResolveRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Resolve a batch of human-readable card references (`name` or
    `parent_path/name`) to UUIDs in one round-trip.

    Used by the spreadsheet importer's validation pass to surface
    ambiguous or missing references **before** anything is written. Each
    ref carries the originating `row` + `column` so the importer can
    pin the result to the cell that produced it.

    Returns one result per ref with status `resolved`, `ambiguous`, or
    `missing`. Ambiguous results include up to a handful of candidate
    paths so the UI can render a useful disambiguation hint.
    """
    await PermissionService.require_permission(db, user, "inventory.view")

    type_keys: set[str] = {r.type for r in body.refs}
    resolver = await CardResolver.load(db, type_keys)

    results: list[CardRefResolveResult] = []
    for ref in body.refs:
        outcome = resolver.resolve(ref.type, ref.ref)
        candidates_payload: list[CardRefCandidate] | None = None
        if outcome.candidates:
            candidates_payload = [
                CardRefCandidate(id=str(c.id), path=c.display_path) for c in outcome.candidates[:5]
            ]
        results.append(
            CardRefResolveResult(
                row=ref.row,
                column=ref.column,
                status=outcome.status,
                id=str(outcome.card_id) if outcome.card_id is not None else None,
                candidates=candidates_payload,
            )
        )
    return CardRefResolveResponse(results=results)


@router.get("/counts", response_model=CardCountsResponse)
async def cards_counts(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Per-card-type counts of ACTIVE cards. Powers the type chips with
    counts in the diagram editor's Insert Cards dialog (LeanIX-style).
    Hidden types are excluded so the dialog never offers them.

    Declared above /{card_id} so the literal `counts` segment isn't shadowed
    by the UUID-typed catch-all and parsed as a (broken) UUID.
    """
    await PermissionService.require_permission(db, user, "inventory.view")
    hidden_types_sq = select(CardType.key).where(CardType.is_hidden == True)  # noqa: E712
    rows = await db.execute(
        select(Card.type, func.count(Card.id))
        .where(Card.status == "ACTIVE", Card.type.not_in(hidden_types_sq))
        .group_by(Card.type)
    )
    by_type = [CardTypeCount(type=tp, count=int(cnt)) for tp, cnt in rows.all()]
    total = sum(entry.count for entry in by_type)
    return CardCountsResponse(by_type=by_type, total=total)


@router.get("/{card_id}", response_model=CardResponse)
async def get_card(
    card_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    await PermissionService.require_permission(
        db, user, "inventory.view", card_id=uuid.UUID(card_id), card_permission="card.view"
    )
    result = await db.execute(
        select(Card)
        .where(Card.id == uuid.UUID(card_id))
        .options(
            selectinload(Card.tags).selectinload(Tag.group),
            selectinload(Card.stakeholders).selectinload(Stakeholder.user),
        )
    )
    card = result.scalar_one_or_none()
    if not card:
        raise HTTPException(404, "Card not found")
    return await _card_response_with_cost_check(db, user, card)


@router.get("/{card_id}/hierarchy")
async def get_hierarchy(
    card_id: str, db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)
):
    """Return ancestors (root→parent), children, and computed level."""
    uid = uuid.UUID(card_id)
    await PermissionService.require_permission(
        db, user, "inventory.view", card_id=uid, card_permission="card.view"
    )
    result = await db.execute(select(Card).where(Card.id == uid))
    card = result.scalar_one_or_none()
    if not card:
        raise HTTPException(404, "Card not found")

    # Walk up parent chain to collect ancestors
    ancestors: list[dict] = []
    current = card
    seen: set[uuid.UUID] = {uid}
    while current.parent_id and current.parent_id not in seen:
        seen.add(current.parent_id)
        res = await db.execute(select(Card).where(Card.id == current.parent_id))
        parent = res.scalar_one_or_none()
        if not parent:
            break
        ancestors.append({"id": str(parent.id), "name": parent.name, "type": parent.type})
        current = parent
    ancestors.reverse()  # root first

    # Direct children
    children_result = await db.execute(
        select(Card).where(Card.parent_id == uid, Card.status == "ACTIVE").order_by(Card.name)
    )
    children = [
        {"id": str(c.id), "name": c.name, "type": c.type} for c in children_result.scalars().all()
    ]

    return {
        "ancestors": ancestors,
        "children": children,
        "level": len(ancestors) + 1,
    }


@router.get("/{card_id}/relation-summary", response_model=CardRelationSummaryResponse)
async def relation_summary(
    card_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Per-relation-type / per-direction neighbour counts for one card.

    The diagram editor renders this as LeanIX-style Show Dependency /
    Drill-Down / Roll-Up submenus where each entry shows
    "<label> (<count>)" and is greyed out when count is 0.

    "outgoing" rows: card is the relation source — i.e. its `relations`.
    "incoming" rows: card is the relation target — i.e. its `reverse_label`
    relations.
    """
    uid = uuid.UUID(card_id)
    await PermissionService.require_permission(
        db, user, "inventory.view", card_id=uid, card_permission="card.view"
    )
    card = await db.get(Card, uid)
    if not card:
        raise HTTPException(404, "Card not found")

    # Same hidden-type / archived filter rules as GET /relations so counts
    # match what the user would actually see if they clicked through.
    hidden_types_sq = select(CardType.key).where(CardType.is_hidden == True)  # noqa: E712
    excluded_card_sq = select(Card.id).where(
        or_(Card.type.in_(hidden_types_sq), Card.status == "ARCHIVED")
    )

    out_rows = await db.execute(
        select(Relation.type, Card.type.label("peer_type"), func.count(Relation.id))
        .join(Card, Card.id == Relation.target_id)
        .where(
            Relation.source_id == uid,
            Relation.target_id.not_in(excluded_card_sq),
        )
        .group_by(Relation.type, Card.type)
    )
    in_rows = await db.execute(
        select(Relation.type, Card.type.label("peer_type"), func.count(Relation.id))
        .join(Card, Card.id == Relation.source_id)
        .where(
            Relation.target_id == uid,
            Relation.source_id.not_in(excluded_card_sq),
        )
        .group_by(Relation.type, Card.type)
    )

    rt_keys: set[str] = set()
    raw: list[tuple[str, str, str, int]] = []  # (rel_type, direction, peer_type, count)
    for rel_type, peer_type, cnt in out_rows.all():
        raw.append((rel_type, "outgoing", peer_type, int(cnt)))
        rt_keys.add(rel_type)
    for rel_type, peer_type, cnt in in_rows.all():
        raw.append((rel_type, "incoming", peer_type, int(cnt)))
        rt_keys.add(rel_type)

    # Resolve labels (forward + reverse) for each relation type in one shot.
    labels: dict[str, tuple[str, str | None]] = {}
    if rt_keys:
        rt_rows = await db.execute(
            select(RelationType.key, RelationType.label, RelationType.reverse_label).where(
                RelationType.key.in_(rt_keys)
            )
        )
        for k, fwd, rev in rt_rows.all():
            labels[k] = (fwd, rev)

    entries: list[CardRelationSummaryEntry] = []
    for rel_type, direction, peer_type, count in raw:
        fwd, rev = labels.get(rel_type, (rel_type, None))
        # Use the reverse_label for incoming rows when the metamodel defines
        # one; otherwise fall back to the forward label so the menu still has
        # a readable string.
        label = fwd if direction == "outgoing" else (rev or fwd)
        entries.append(
            CardRelationSummaryEntry(
                relation_type_key=rel_type,
                label=label,
                direction=direction,
                peer_type_key=peer_type,
                count=count,
            )
        )

    # Stable order: by direction (outgoing first), then by label.
    entries.sort(key=lambda e: (0 if e.direction == "outgoing" else 1, e.label.lower()))

    # Hierarchy snapshot — children count + parent info. ACTIVE children
    # only, matching what the diagram editor would actually drill into.
    children_count = await db.scalar(
        select(func.count(Card.id)).where(Card.parent_id == uid, Card.status == "ACTIVE")
    )
    parent_id_str: str | None = None
    parent_name: str | None = None
    parent_type: str | None = None
    if card.parent_id is not None:
        parent = await db.get(Card, card.parent_id)
        if parent and parent.status == "ACTIVE":
            parent_id_str = str(parent.id)
            parent_name = parent.name
            parent_type = parent.type

    hierarchy = CardRelationSummaryHierarchy(
        children_count=int(children_count or 0),
        parent_id=parent_id_str,
        parent_name=parent_name,
        parent_type=parent_type,
    )
    return CardRelationSummaryResponse(by_type=entries, hierarchy=hierarchy)


@router.patch("/bulk")
async def bulk_update(
    body: CardBulkUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "inventory.bulk_edit")
    uuids = [uuid.UUID(i) for i in body.ids]
    result = await db.execute(select(Card).where(Card.id.in_(uuids)))
    sheets = list(result.scalars().all())
    updates = body.updates.model_dump(exclude_unset=True)
    strict_attrs = updates.pop("strict_attributes", False)
    if "attributes" in updates and updates["attributes"]:
        # Strict-attribute validation runs per distinct type because
        # `fields_schema` is per-type.
        seen_types: set[str] = set()
        for card in sheets:
            if card.type in seen_types:
                continue
            seen_types.add(card.type)
            await _validate_url_attributes(db, card.type, updates["attributes"])
            if strict_attrs:
                await _validate_strict_attributes(db, card.type, updates["attributes"])
    # Preserve cost-typed keys for any card the user may not see costs on —
    # PATCH does a full replace on `attributes`, so we merge the existing
    # cost values back into the incoming payload. Without this, a bulk edit
    # would silently wipe cost values from cards the user couldn't see.
    incoming_attr_redact = (
        await _cost_redaction_map(db, user, sheets)
        if "attributes" in updates and updates["attributes"]
        else {}
    )
    # Capture per-card before/after diff so the MCP dry-run preview can
    # surface field-level changes the agent will commit. Also lets
    # `rollback_batch` reverse the update by replaying the snapshots.
    diffs: list[dict] = []
    for card in sheets:
        before: dict = {}
        after: dict = {}
        for field, value in updates.items():
            if field == "parent_id" and value is not None:
                value = uuid.UUID(value)
            elif field == "attributes" and value:
                strip = incoming_attr_redact.get(card.id)
                if strip:
                    old_attrs = dict(card.attributes or {})
                    value = {k: v for k, v in value.items() if k not in strip}
                    for key in strip:
                        if key in old_attrs:
                            value[key] = old_attrs[key]
            old_val = getattr(card, field)
            if old_val != value:
                before[field] = str(old_val) if field == "parent_id" and old_val else old_val
                after[field] = str(value) if field == "parent_id" and value else value
            setattr(card, field, value)
        if before:
            diffs.append({"id": str(card.id), "before": before, "after": after})
        card.updated_by = user.id

    if body.dry_run:
        # Roll back so the preview never persists; return the diffs the
        # agent can show the user before committing.
        await db.rollback()
        return {
            "dry_run": True,
            "results": [
                {"row_index": i, "card_id": d["id"], "status": "would_update", **d}
                for i, d in enumerate(diffs)
            ],
            "updated": 0,
            "would_update": len(diffs),
        }

    # Recompute completeness score and calculated fields per card, mirroring
    # create_card / bulk_create_cards / update_card. Without this a bulk edit
    # persists the new values but leaves data_quality and calculated fields
    # frozen at their prior (often creation-time) value.
    for card in sheets:
        card.data_quality = await calc_data_quality(db, card)
        ppm_excl = await _get_ppm_exclusions(db, card)
        await run_calculations_for_card(db, card, exclude_fields=ppm_excl)

    await db.commit()
    result = await db.execute(
        select(Card)
        .where(Card.id.in_(uuids))
        .options(
            selectinload(Card.tags).selectinload(Tag.group),
            selectinload(Card.stakeholders).selectinload(Stakeholder.user),
        )
    )
    sheets = list(result.scalars().all())
    redact = await _cost_redaction_map(db, user, sheets)
    return [
        _card_to_response(card, strip_cost_keys=redact.get(card.id, frozenset())) for card in sheets
    ]


@router.post("/bulk-archive", response_model=CardBulkArchiveResponse)
async def bulk_archive_cards(
    body: CardBulkArchiveRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Archive many cards in a single transaction.

    Solves a class of problems that the per-card endpoint cannot:
      - browser parallelism: 1 round-trip instead of N (no socket-pool exhaustion);
      - cascade race: archiving a parent that cascades to a descendant which is
        also in the input list is a single coherent operation, not a fight
        between sibling workers seeing the descendant in different states;
      - reporting: one aggregated response with `archived`, `cascaded`, `skipped`
        instead of N independent failures the caller has to stitch together.

    Cards already at status=ARCHIVED, or whose IDs don't resolve, are returned
    in `skipped` rather than failing the batch — the user's intent (everything
    in the input ends up archived) is satisfied either way.
    """
    requested_ids: list[uuid.UUID] = []
    seen: set[uuid.UUID] = set()
    for raw in body.card_ids:
        try:
            cid = uuid.UUID(raw)
        except (TypeError, ValueError) as exc:
            raise HTTPException(422, f"Invalid card_id: {raw!r}") from exc
        if cid in seen:
            continue
        seen.add(cid)
        requested_ids.append(cid)

    found_res = await db.execute(select(Card).where(Card.id.in_(requested_ids)))
    found_map: dict[uuid.UUID, Card] = {c.id: c for c in found_res.scalars().all()}

    skipped: list[CardBulkSkippedEntry] = []
    primaries: list[Card] = []
    for cid in requested_ids:
        card = found_map.get(cid)
        if card is None:
            skipped.append(CardBulkSkippedEntry(card_id=str(cid), reason="not_found"))
        elif card.status == "ARCHIVED":
            skipped.append(CardBulkSkippedEntry(card_id=str(cid), reason="already_archived"))
        else:
            primaries.append(card)

    if not primaries:
        return CardBulkArchiveResponse(
            requested=len(requested_ids),
            archived_card_ids=[],
            cascaded_card_ids=[],
            skipped=skipped,
        )

    # Children check at bulk level: if ANY primary has direct children and the
    # user didn't pick a strategy, abort the whole batch — same semantic as the
    # single-card endpoint, just told once instead of N times.
    if body.child_strategy is None:
        for p in primaries:
            children = await card_lifecycle.direct_children(db, p.id)
            if children:
                raise HTTPException(
                    status_code=409,
                    detail={
                        "error": "children_present",
                        "card_id": str(p.id),
                        "child_count": len(children),
                    },
                )

    primary_id_set = {p.id for p in primaries}
    descendants_set: set[uuid.UUID] = set()
    related_set: set[uuid.UUID] = set()

    for p in primaries:
        per_primary_body = CardArchiveRequest(
            child_strategy=body.child_strategy,
            cascade_all_related=body.cascade_all_related,
        )
        descendants, related, _ = await _resolve_archive_delete_set(db, p, per_primary_body)
        for did in descendants:
            if did not in primary_id_set:
                descendants_set.add(did)
        for rid in related:
            if rid not in primary_id_set and rid not in descendants_set:
                related_set.add(rid)

    full_affected = list(primary_id_set | descendants_set | related_set)
    await _ensure_permission_on_each(
        db, user, full_affected, app_perm="inventory.archive", card_perm="card.archive"
    )

    if body.child_strategy in ("disconnect", "reparent"):
        for p in primaries:
            await card_lifecycle.apply_child_strategy(db, p, body.child_strategy, user.id)
    for rid in related_set:
        rel_res = await db.execute(select(Card).where(Card.id == rid))
        rcard = rel_res.scalar_one_or_none()
        if rcard is not None and rcard.status == "ACTIVE":
            await card_lifecycle.apply_child_strategy(db, rcard, "disconnect", user.id)

    flip_res = await db.execute(
        select(Card)
        .where(Card.id.in_(full_affected), Card.status == "ACTIVE")
        .options(
            selectinload(Card.tags).selectinload(Tag.group),
            selectinload(Card.stakeholders).selectinload(Stakeholder.user),
        )
    )
    to_flip = list(flip_res.scalars().all())
    flipped = card_lifecycle.archive_cards_in_place(to_flip, user.id)

    flipped_ids = {c.id for c in flipped}
    archived_card_ids = [str(p.id) for p in primaries if p.id in flipped_ids]
    cascaded_card_ids = [str(cid) for cid in (descendants_set | related_set) if cid in flipped_ids]

    for fcard in flipped:
        event_data = {"id": str(fcard.id), "type": fcard.type, "name": fcard.name}
        if body.reason:
            event_data["reason"] = body.reason
        await event_bus.publish(
            "card.archived",
            event_data,
            db=db,
            card_id=fcard.id,
            user_id=user.id,
        )

    if cascaded_card_ids:
        await event_bus.publish(
            "card.archived.bulk",
            {
                "primary_count": len(archived_card_ids),
                "cascaded_count": len(cascaded_card_ids),
                "child_strategy": body.child_strategy,
            },
            db=db,
            user_id=user.id,
        )

    await db.commit()

    return CardBulkArchiveResponse(
        requested=len(requested_ids),
        archived_card_ids=archived_card_ids,
        cascaded_card_ids=cascaded_card_ids,
        skipped=skipped,
    )


@router.post("/bulk-delete", response_model=CardBulkDeleteResponse)
async def bulk_delete_cards(
    body: CardBulkDeleteRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Permanently delete many cards in a single transaction.

    Mirrors `bulk_archive_cards`. Unlike archive, delete works on cards in any
    status (ACTIVE or ARCHIVED), so the only `skipped` reason is `not_found`
    (the card was already deleted by a sibling primary's cascade in the same
    batch, or never existed).

    Descendants are deleted leaves-first to satisfy the self-FK on `parent_id`.
    """
    requested_ids: list[uuid.UUID] = []
    seen: set[uuid.UUID] = set()
    for raw in body.card_ids:
        try:
            cid = uuid.UUID(raw)
        except (TypeError, ValueError) as exc:
            raise HTTPException(422, f"Invalid card_id: {raw!r}") from exc
        if cid in seen:
            continue
        seen.add(cid)
        requested_ids.append(cid)

    found_res = await db.execute(select(Card).where(Card.id.in_(requested_ids)))
    found_map: dict[uuid.UUID, Card] = {c.id: c for c in found_res.scalars().all()}

    skipped: list[CardBulkDeleteSkippedEntry] = []
    primaries: list[Card] = []
    for cid in requested_ids:
        card = found_map.get(cid)
        if card is None:
            skipped.append(CardBulkDeleteSkippedEntry(card_id=str(cid), reason="not_found"))
        else:
            primaries.append(card)

    if not primaries:
        return CardBulkDeleteResponse(
            requested=len(requested_ids),
            deleted_card_ids=[],
            cascaded_card_ids=[],
            skipped=skipped,
        )

    if body.child_strategy is None:
        for p in primaries:
            children = await card_lifecycle.direct_children(db, p.id)
            if children:
                raise HTTPException(
                    status_code=409,
                    detail={
                        "error": "children_present",
                        "card_id": str(p.id),
                        "child_count": len(children),
                    },
                )

    primary_id_set = {p.id for p in primaries}
    descendants_set: set[uuid.UUID] = set()
    related_set: set[uuid.UUID] = set()

    for p in primaries:
        per_primary_body = CardDeleteRequest(
            child_strategy=body.child_strategy,
            cascade_all_related=body.cascade_all_related,
        )
        descendants, related, _ = await _resolve_archive_delete_set(db, p, per_primary_body)
        for did in descendants:
            if did in primary_id_set:
                continue
            descendants_set.add(did)
        for rid in related:
            if rid in primary_id_set or rid in descendants_set:
                continue
            related_set.add(rid)

    full_affected = list(primary_id_set | descendants_set | related_set)
    await _ensure_permission_on_each(
        db, user, full_affected, app_perm="inventory.delete", card_perm="card.delete"
    )

    if body.child_strategy in ("disconnect", "reparent"):
        for p in primaries:
            await card_lifecycle.apply_child_strategy(db, p, body.child_strategy, user.id)
    for rid in related_set:
        rel_res = await db.execute(select(Card).where(Card.id == rid))
        rcard = rel_res.scalar_one_or_none()
        if rcard is not None:
            await card_lifecycle.apply_child_strategy(db, rcard, "disconnect", user.id)

    # Order the DELETE leaves-first across the entire target set so the self-FK
    # on `parent_id` is satisfied at every step. The naive "primaries last,
    # descendants first" ordering breaks when two primaries have a parent-child
    # relationship between them (the input includes both P and P's child) —
    # without a global depth sort we'd try to delete P before its child, and
    # the FK on the child's `parent_id` would block it.
    target_res = await db.execute(select(Card).where(Card.id.in_(full_affected)))
    target_by_id: dict[uuid.UUID, Card] = {c.id: c for c in target_res.scalars().all()}

    depth_memo: dict[uuid.UUID, int] = {}

    def depth_within_set(cid: uuid.UUID) -> int:
        if cid in depth_memo:
            return depth_memo[cid]
        # Defensive guard against a (shouldn't-happen) parent_id cycle: cap
        # recursion by inserting 0 before recursing, so a cycle resolves to 0
        # rather than recursing forever.
        depth_memo[cid] = 0
        obj = target_by_id.get(cid)
        if obj is None or obj.parent_id is None or obj.parent_id not in target_by_id:
            return 0
        d = 1 + depth_within_set(obj.parent_id)
        depth_memo[cid] = d
        return d

    for cid in target_by_id:
        depth_within_set(cid)

    target_objs: list[Card] = sorted(
        target_by_id.values(), key=lambda c: depth_memo[c.id], reverse=True
    )
    deleted_payload: list[tuple[uuid.UUID, str, str]] = [
        (c.id, c.type, c.name) for c in target_objs
    ]

    for did, dtype, dname in deleted_payload:
        await event_bus.publish(
            "card.deleted",
            {"id": str(did), "type": dtype, "name": dname},
            db=db,
            card_id=did,
            user_id=user.id,
        )

    deleted_id_set = {did for did, _, _ in deleted_payload}
    deleted_card_ids = [str(p.id) for p in primaries if p.id in deleted_id_set]
    cascaded_card_ids = [
        str(cid) for cid in (descendants_set | related_set) if cid in deleted_id_set
    ]

    if cascaded_card_ids:
        await event_bus.publish(
            "card.deleted.bulk",
            {
                "primary_count": len(deleted_card_ids),
                "cascaded_count": len(cascaded_card_ids),
                "child_strategy": body.child_strategy,
            },
            db=db,
            user_id=user.id,
        )

    for cobj in target_objs:
        await db.delete(cobj)
        await db.flush()

    await db.commit()

    return CardBulkDeleteResponse(
        requested=len(requested_ids),
        deleted_card_ids=deleted_card_ids,
        cascaded_card_ids=cascaded_card_ids,
        skipped=skipped,
    )


@router.post("/bulk-restore", response_model=CardBulkRestoreResponse)
async def bulk_restore_cards(
    body: CardBulkRestoreRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Restore many archived cards back to ACTIVE status in a single transaction.

    Mirrors `bulk_archive_cards` for the inverse operation. Cards already at
    ACTIVE, or whose IDs don't resolve, come back in `skipped` rather than
    failing the batch — restoring is idempotent in spirit (the desired end
    state is "this card is active", and that's already true).

    No cascade: restore is a flat per-card status flip. The single-card
    endpoint takes `also_restore_card_ids` to lift passengers from the
    original archive batch; for bulk we expect the caller (the inventory
    selection UI) to have already gathered the full list of cards to restore.
    """
    requested_ids: list[uuid.UUID] = []
    seen: set[uuid.UUID] = set()
    for raw in body.card_ids:
        try:
            cid = uuid.UUID(raw)
        except (TypeError, ValueError) as exc:
            raise HTTPException(422, f"Invalid card_id: {raw!r}") from exc
        if cid in seen:
            continue
        seen.add(cid)
        requested_ids.append(cid)

    found_res = await db.execute(select(Card).where(Card.id.in_(requested_ids)))
    found_map: dict[uuid.UUID, Card] = {c.id: c for c in found_res.scalars().all()}

    skipped: list[CardBulkRestoreSkippedEntry] = []
    to_restore: list[Card] = []
    for cid in requested_ids:
        card = found_map.get(cid)
        if card is None:
            skipped.append(CardBulkRestoreSkippedEntry(card_id=str(cid), reason="not_found"))
        elif card.status == "ACTIVE":
            skipped.append(CardBulkRestoreSkippedEntry(card_id=str(cid), reason="already_active"))
        else:
            to_restore.append(card)

    if not to_restore:
        return CardBulkRestoreResponse(
            requested=len(requested_ids),
            restored_card_ids=[],
            skipped=skipped,
        )

    await _ensure_permission_on_each(
        db,
        user,
        [c.id for c in to_restore],
        app_perm="inventory.archive",
        card_perm="card.archive",
    )

    restored_card_ids: list[str] = []
    for card in to_restore:
        card.status = "ACTIVE"
        card.archived_at = None
        card.updated_by = user.id
        restored_card_ids.append(str(card.id))
        await event_bus.publish(
            "card.restored",
            {"id": str(card.id), "type": card.type, "name": card.name},
            db=db,
            card_id=card.id,
            user_id=user.id,
        )

    await db.commit()

    return CardBulkRestoreResponse(
        requested=len(requested_ids),
        restored_card_ids=restored_card_ids,
        skipped=skipped,
    )


@router.patch("/{card_id}", response_model=CardResponse)
async def update_card(
    card_id: str,
    body: CardUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    card_uuid = uuid.UUID(card_id)
    if not await PermissionService.check_permission(
        db, user, "inventory.edit", card_uuid, "card.edit"
    ):
        raise HTTPException(403, "Not enough permissions")
    result = await db.execute(
        select(Card)
        .where(Card.id == card_uuid)
        .options(
            selectinload(Card.tags).selectinload(Tag.group),
            selectinload(Card.stakeholders).selectinload(Stakeholder.user),
        )
    )
    card = result.scalar_one_or_none()
    if not card:
        raise HTTPException(404, "Card not found")

    updates = body.model_dump(exclude_unset=True)
    # `strict_attributes` is a request-side flag, not a column.
    strict_attrs = updates.pop("strict_attributes", False)

    # Validate URL-typed attributes
    if "attributes" in updates and updates["attributes"]:
        await _validate_url_attributes(db, card.type, updates["attributes"])
        if strict_attrs:
            await _validate_strict_attributes(db, card.type, updates["attributes"])

    # Preserve cost-typed keys when the user lacks cost access on this card.
    # PATCH does a full replace on `attributes`, so simply dropping the
    # forbidden keys from the incoming payload would wipe whatever the card
    # already had. Merge the existing values back so the user's update can
    # only touch the non-cost keys they were allowed to see.
    if "attributes" in updates and updates["attributes"] is not None:
        if not await PermissionService.can_view_costs(db, user, card.id):
            type_schema_row = await db.execute(
                select(CardType.fields_schema).where(CardType.key == card.type)
            )
            cost_keys = cost_field_keys_from_card_schema(type_schema_row.scalar_one_or_none())
            if cost_keys:
                old_attrs = dict(card.attributes or {})
                new_attrs = {k: v for k, v in updates["attributes"].items() if k not in cost_keys}
                for key in cost_keys:
                    if key in old_attrs:
                        new_attrs[key] = old_attrs[key]
                updates["attributes"] = new_attrs

    # Preserve PPM-managed cost fields so the frontend payload doesn't wipe them
    if card.type == "Initiative" and "attributes" in updates:
        ppm_excl = await _get_ppm_exclusions(db, card)
        if ppm_excl:
            old_attrs = dict(card.attributes or {})
            new_attrs = dict(updates["attributes"] or {})
            for key in ppm_excl:
                if key in old_attrs:
                    new_attrs[key] = old_attrs[key]
            updates["attributes"] = new_attrs

    # Guard: hierarchy depth limit before applying parent change
    if "parent_id" in updates:
        new_pid = uuid.UUID(updates["parent_id"]) if updates["parent_id"] else None
        if new_pid != card.parent_id:
            await _check_hierarchy_depth(db, card, new_pid)

    # Guard: sibling-name uniqueness when name or parent changes. Only
    # fires when the requested final state would introduce a new
    # collision — renaming a card to its own current name, or merely
    # editing unrelated fields, never trips this check.
    name_changed = "name" in updates and updates["name"] != card.name
    pid_changed = "parent_id" in updates and (
        (uuid.UUID(updates["parent_id"]) if updates["parent_id"] else None) != card.parent_id
    )
    if name_changed or pid_changed:
        new_name = updates["name"] if "name" in updates else card.name
        new_pid_final = (
            (uuid.UUID(updates["parent_id"]) if updates["parent_id"] else None)
            if "parent_id" in updates
            else card.parent_id
        )
        await check_sibling_name_unique(
            db,
            type_key=card.type,
            parent_id=new_pid_final,
            name=new_name,
            exclude_card_id=card.id,
        )

    changes = {}
    for field, value in updates.items():
        if field == "parent_id" and value is not None:
            value = uuid.UUID(value)
        old = getattr(card, field)
        if old != value:
            changes[field] = {"old": old, "new": value}
            setattr(card, field, value)

    if changes:
        card.updated_by = user.id
        # Break approval status on edit (attribute/lifecycle changes break it)
        if card.approval_status == "APPROVED":
            status_breaking = {
                "name",
                "description",
                "lifecycle",
                "attributes",
                "subtype",
                "alias",
                "parent_id",
            }
            if status_breaking & changes.keys():
                card.approval_status = "BROKEN"

        # Auto-sync hierarchy levels when the parent changes or a level is
        # missing (lazy heal). Covers hierarchyLevel for any hierarchical type
        # and capabilityLevel for BusinessCapability.
        current_attrs = card.attributes or {}
        changed_levels: list[Card] = []
        if (
            "parent_id" in changes
            or current_attrs.get(HIERARCHY_LEVEL_KEY) is None
            or (card.type == "BusinessCapability" and not current_attrs.get("capabilityLevel"))
        ):
            changed_levels = await _sync_hierarchy_levels(db, card)

        # Recalculate completion
        card.data_quality = await calc_data_quality(db, card)

        # Run calculated fields (skip PPM-managed cost fields if PPM data exists)
        ppm_excl = await _get_ppm_exclusions(db, card)
        await run_calculations_for_card(db, card, exclude_fields=ppm_excl)
        # Re-run calcs for descendants whose level moved (after the card's own
        # run, so a child formula reading a parent's computed field sees it fresh)
        await _recalc_changed_descendants(db, changed_levels, card.id)

        def _serialize_val(v: object) -> object:
            """Convert a value to something JSON-serialisable."""
            if v is None or isinstance(v, (str, int, float, bool)):
                return v
            if isinstance(v, (dict, list)):
                return v
            if isinstance(v, uuid.UUID):
                return str(v)
            if isinstance(v, datetime):
                return v.isoformat()
            return str(v)

        serialised_changes = {
            k: {"old": _serialize_val(v["old"]), "new": _serialize_val(v["new"])}
            for k, v in changes.items()
        }
        await event_bus.publish(
            "card.updated",
            {"id": str(card.id), "changes": serialised_changes},
            db=db,
            card_id=card.id,
            user_id=user.id,
        )

        # Notify subscribers about the update
        changed_fields = ", ".join(changes.keys())
        await notification_service.create_notifications_for_subscribers(
            db,
            card_id=card.id,
            notif_type="card_updated",
            title=f"{card.name} Updated",
            message=f'{user.display_name} updated "{card.name}" ({changed_fields})',
            link=f"/cards/{card.id}",
            data={"changes": list(changes.keys())},
        )

        await db.commit()
        result = await db.execute(
            select(Card)
            .where(Card.id == card.id)
            .options(
                selectinload(Card.tags).selectinload(Tag.group),
                selectinload(Card.stakeholders).selectinload(Stakeholder.user),
            )
        )
        card = result.scalar_one()

    return await _card_response_with_cost_check(db, user, card)


@router.get("/{card_id}/archive-impact", response_model=ArchiveImpactResponse)
async def get_archive_impact(
    card_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Pre-flight payload for the archive/delete dialog.

    Returns the direct children, the grandparent (if any), and every peer card
    linked via a `relations` row. Hidden card-types are filtered out, mirroring
    the relations list endpoint at `/api/v1/relations`.
    """
    uid = uuid.UUID(card_id)
    await PermissionService.require_permission(
        db, user, "inventory.view", card_id=uid, card_permission="card.view"
    )
    res = await db.execute(select(Card).where(Card.id == uid))
    primary = res.scalar_one_or_none()
    if not primary:
        raise HTTPException(404, "Card not found")

    children, grandparent, related_rows = await card_lifecycle.gather_archive_impact(db, primary)

    descendants = await card_lifecycle.collect_descendants(db, uid)
    descendant_count = len(descendants)
    approved_descendant_count = 0
    if descendants:
        approved_res = await db.execute(
            select(func.count(Card.id)).where(
                Card.id.in_(descendants), Card.approval_status == "APPROVED"
            )
        )
        approved_descendant_count = int(approved_res.scalar_one() or 0)

    children_per_descendant: dict[uuid.UUID, int] = {}
    if children:
        for child in children:
            sub = await card_lifecycle.collect_descendants(db, child.id)
            children_per_descendant[child.id] = len(sub)

    return ArchiveImpactResponse(
        child_count=len(children),
        descendant_count=descendant_count,
        approved_descendant_count=approved_descendant_count,
        grandparent=(
            ArchiveImpactCardRef(
                id=str(grandparent.id),
                name=grandparent.name,
                type=grandparent.type,
                subtype=grandparent.subtype,
            )
            if grandparent
            else None
        ),
        children=[
            ArchiveImpactChild(
                id=str(c.id),
                name=c.name,
                type=c.type,
                subtype=c.subtype,
                descendants_count=children_per_descendant.get(c.id, 0),
                approval_status=c.approval_status,
            )
            for c in children
        ],
        related_cards=[
            ArchiveImpactRelatedCard(
                id=str(peer.id),
                name=peer.name,
                type=peer.type,
                subtype=peer.subtype,
                relation_id=str(rel.id),
                relation_type_key=rel.type,
                relation_label=label,
                direction=direction,
            )
            for rel, peer, direction, label in related_rows
        ],
    )


async def _resolve_archive_delete_set(
    db: AsyncSession,
    primary: Card,
    body: CardArchiveRequest | CardDeleteRequest,
) -> tuple[list[uuid.UUID], list[uuid.UUID], list[uuid.UUID]]:
    """Resolve (descendants, related_card_ids, full_affected_excluding_primary).

    - descendants: empty unless `child_strategy == "cascade"`.
    - related_card_ids: deduped, primary-stripped, descendant-stripped.
    - full_affected_excluding_primary: union, deduped.
    """
    descendants: list[uuid.UUID] = []
    if body.child_strategy == "cascade":
        descendants = await card_lifecycle.collect_descendants(db, primary.id)

    requested_related: list[uuid.UUID] = []
    seen_related: set[uuid.UUID] = set()
    for raw in body.related_card_ids:
        try:
            rid = uuid.UUID(raw)
        except (TypeError, ValueError) as exc:
            raise HTTPException(422, f"Invalid related_card_ids entry: {raw!r}") from exc
        if rid == primary.id or rid in seen_related:
            continue
        seen_related.add(rid)
        requested_related.append(rid)

    if body.cascade_all_related:
        for peer_id in await card_lifecycle.expand_cascade_all_related(db, primary.id):
            if peer_id == primary.id or peer_id in seen_related:
                continue
            seen_related.add(peer_id)
            requested_related.append(peer_id)

    descendant_set = set(descendants)
    related_card_ids = [rid for rid in requested_related if rid not in descendant_set]

    full_set: list[uuid.UUID] = []
    seen_full: set[uuid.UUID] = set()
    for cid in [*descendants, *related_card_ids]:
        if cid in seen_full:
            continue
        seen_full.add(cid)
        full_set.append(cid)

    return descendants, related_card_ids, full_set


async def _ensure_permission_on_each(
    db: AsyncSession,
    user: User,
    card_ids: list[uuid.UUID],
    *,
    app_perm: str,
    card_perm: str,
) -> None:
    if not card_ids:
        return
    denied: list[str] = []
    for cid in card_ids:
        if not await PermissionService.check_permission(db, user, app_perm, cid, card_perm):
            denied.append(str(cid))
            if len(denied) >= 5:
                break
    if denied:
        raise HTTPException(
            403,
            f"Not enough permissions for cards: {', '.join(denied)}"
            + (" (and possibly more)" if len(denied) >= 5 else ""),
        )


@router.post("/{card_id}/archive", response_model=CardArchiveResponse)
async def archive_card(
    card_id: str,
    body: CardArchiveRequest = Body(default_factory=CardArchiveRequest),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Archive a card (soft delete) plus optional descendants and related peer cards.

    Body shape:
      - `child_strategy`: `cascade` | `disconnect` | `reparent` (required if the
        primary card has direct children — otherwise 409).
      - `related_card_ids`: peer cards (capped at 200) to also archive in the
        same operation. Single-hop only — the related cards' own peer relations
        are NOT recursed.
      - `cascade_all_related`: bulk-mode shortcut that resolves all direct
        relations of the primary on the server side.

    Permission check runs against every affected card; first denial aborts.
    """
    card_uuid = uuid.UUID(card_id)
    if not await PermissionService.check_permission(
        db, user, "inventory.archive", card_uuid, "card.archive"
    ):
        raise HTTPException(403, "Not enough permissions")
    res = await db.execute(select(Card).where(Card.id == card_uuid))
    primary = res.scalar_one_or_none()
    if not primary:
        raise HTTPException(404, "Card not found")
    if primary.status == "ARCHIVED":
        raise HTTPException(400, "Card is already archived")

    direct_children = await card_lifecycle.direct_children(db, primary.id)
    if direct_children and body.child_strategy is None:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "children_present",
                "child_count": len(direct_children),
            },
        )

    descendants, related_card_ids, full_affected = await _resolve_archive_delete_set(
        db, primary, body
    )
    await _ensure_permission_on_each(
        db,
        user,
        full_affected,
        app_perm="inventory.archive",
        card_perm="card.archive",
    )

    # Apply parent-id mutation on the primary's direct children for disconnect/reparent.
    if direct_children and body.child_strategy in ("disconnect", "reparent"):
        await card_lifecycle.apply_child_strategy(db, primary, body.child_strategy, user.id)
    # For ticked related cards, give their own children a `disconnect` so their
    # `parent_id` doesn't point at a soon-to-be-archived parent. Single-hop.
    for rid in related_card_ids:
        rel_res = await db.execute(select(Card).where(Card.id == rid))
        rcard = rel_res.scalar_one_or_none()
        if rcard is not None and rcard.status == "ACTIVE":
            await card_lifecycle.apply_child_strategy(db, rcard, "disconnect", user.id)

    # Flip primary + cascade descendants + ticked related to ARCHIVED.
    to_flip_ids = [primary.id, *full_affected]
    flip_res = await db.execute(
        select(Card)
        .where(Card.id.in_(to_flip_ids), Card.status == "ACTIVE")
        .options(
            selectinload(Card.tags).selectinload(Tag.group),
            selectinload(Card.stakeholders).selectinload(Stakeholder.user),
        )
    )
    flip_cards = list(flip_res.scalars().all())
    flipped = card_lifecycle.archive_cards_in_place(flip_cards, user.id)

    # Cross-boundary peer relations are kept in the database and hidden from
    # active views via the archived-status filter in `GET /relations`. They
    # reappear automatically when the card is restored. Hard-delete and the
    # 30-day auto-purge clean them up.

    affected_children_ids = [
        cid for cid in descendants if cid in {c.id for c in flipped if c.id != primary.id}
    ]
    affected_related_card_ids = [rid for rid in related_card_ids if rid in {c.id for c in flipped}]

    for fcard in flipped:
        await event_bus.publish(
            "card.archived",
            {"id": str(fcard.id), "type": fcard.type, "name": fcard.name},
            db=db,
            card_id=fcard.id,
            user_id=user.id,
        )

    if affected_children_ids or affected_related_card_ids:
        await event_bus.publish(
            "card.archived.batch",
            {
                "id": str(primary.id),
                "type": primary.type,
                "name": primary.name,
                "child_strategy": body.child_strategy,
                "affected_children_ids": [str(x) for x in affected_children_ids],
                "affected_related_card_ids": [str(x) for x in affected_related_card_ids],
            },
            db=db,
            card_id=primary.id,
            user_id=user.id,
        )

    await db.commit()

    res = await db.execute(
        select(Card)
        .where(Card.id == primary.id)
        .options(
            selectinload(Card.tags).selectinload(Tag.group),
            selectinload(Card.stakeholders).selectinload(Stakeholder.user),
        )
    )
    primary = res.scalar_one()
    return CardArchiveResponse(
        primary=await _card_response_with_cost_check(db, user, primary),
        affected_children_ids=[str(x) for x in affected_children_ids],
        affected_related_card_ids=[str(x) for x in affected_related_card_ids],
    )


@router.get("/{card_id}/restore-impact", response_model=RestoreImpactResponse)
async def get_restore_impact(
    card_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """List the cards that were archived together with this one and are still archived.

    Reads the latest `card.archived.batch` audit event keyed to this card.
    Cards whose `affected_*_ids` come back from that event but were already
    individually restored are filtered out.
    """
    uid = uuid.UUID(card_id)
    await PermissionService.require_permission(
        db, user, "inventory.view", card_id=uid, card_permission="card.view"
    )
    res = await db.execute(select(Card).where(Card.id == uid))
    primary = res.scalar_one_or_none()
    if not primary:
        raise HTTPException(404, "Card not found")
    rows = await card_lifecycle.gather_restore_impact(db, primary)
    return RestoreImpactResponse(
        passengers=[
            RestoreImpactPassenger(
                id=str(c.id),
                name=c.name,
                type=c.type,
                subtype=c.subtype,
                role=role,
            )
            for c, role in rows
        ]
    )


@router.post("/{card_id}/restore", response_model=CardRestoreResponse)
async def restore_card(
    card_id: str,
    body: CardRestoreRequest = Body(default_factory=CardRestoreRequest),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Restore an archived card back to ACTIVE status.

    `also_restore_card_ids` lets the caller restore passengers from the
    original archive batch in the same operation. Each ID is checked
    individually; the same `card.archive` permission applies. IDs that
    resolve to non-archived cards are skipped silently. Only one
    `card.restored` event is emitted per card actually flipped.
    """
    card_uuid = uuid.UUID(card_id)
    if not await PermissionService.check_permission(
        db, user, "inventory.archive", card_uuid, "card.archive"
    ):
        raise HTTPException(403, "Not enough permissions")
    result = await db.execute(select(Card).where(Card.id == card_uuid))
    card = result.scalar_one_or_none()
    if not card:
        raise HTTPException(404, "Card not found")
    if card.status != "ARCHIVED":
        raise HTTPException(400, "Card is not archived")

    passenger_ids: list[uuid.UUID] = []
    for raw in body.also_restore_card_ids:
        try:
            pid = uuid.UUID(raw)
        except (TypeError, ValueError) as exc:
            raise HTTPException(422, f"Invalid also_restore_card_ids entry: {raw!r}") from exc
        if pid != card.id and pid not in passenger_ids:
            passenger_ids.append(pid)

    await _ensure_permission_on_each(
        db,
        user,
        passenger_ids,
        app_perm="inventory.archive",
        card_perm="card.archive",
    )

    # Flip primary.
    card.status = "ACTIVE"
    card.archived_at = None
    card.updated_by = user.id
    await event_bus.publish(
        "card.restored",
        {"id": str(card.id), "type": card.type, "name": card.name},
        db=db,
        card_id=card.id,
        user_id=user.id,
    )

    # Flip passengers that are still archived.
    restored_passenger_ids: list[uuid.UUID] = []
    if passenger_ids:
        pass_res = await db.execute(
            select(Card).where(Card.id.in_(passenger_ids), Card.status == "ARCHIVED")
        )
        for p in pass_res.scalars().all():
            p.status = "ACTIVE"
            p.archived_at = None
            p.updated_by = user.id
            restored_passenger_ids.append(p.id)
            await event_bus.publish(
                "card.restored",
                {"id": str(p.id), "type": p.type, "name": p.name},
                db=db,
                card_id=p.id,
                user_id=user.id,
            )

    await db.commit()
    result = await db.execute(
        select(Card)
        .where(Card.id == card.id)
        .options(
            selectinload(Card.tags).selectinload(Tag.group),
            selectinload(Card.stakeholders).selectinload(Stakeholder.user),
        )
    )
    card = result.scalar_one()
    return CardRestoreResponse(
        primary=await _card_response_with_cost_check(db, user, card),
        restored_passenger_ids=[str(x) for x in restored_passenger_ids],
    )


@router.delete("/{card_id}", response_model=CardDeleteResponse)
async def delete_card(
    card_id: str,
    body: CardDeleteRequest = Body(default_factory=CardDeleteRequest),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Permanently delete a card plus optional descendants and related peer cards.

    Mirrors `archive_card`'s body shape and rules. The primary is always deleted;
    descendants are deleted leaves-first to satisfy the self-FK on `parent_id`.
    Related cards are processed single-hop only.

    Returns 409 if the primary has direct children and `child_strategy` is None.
    """
    card_uuid = uuid.UUID(card_id)
    if not await PermissionService.check_permission(
        db, user, "inventory.delete", card_uuid, "card.delete"
    ):
        raise HTTPException(
            403, "Not enough permissions — only admins can permanently delete cards"
        )
    res = await db.execute(select(Card).where(Card.id == card_uuid))
    primary = res.scalar_one_or_none()
    if not primary:
        raise HTTPException(404, "Card not found")

    direct_children = await card_lifecycle.direct_children(db, primary.id)
    if direct_children and body.child_strategy is None:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "children_present",
                "child_count": len(direct_children),
            },
        )

    descendants, related_card_ids, _full_affected = await _resolve_archive_delete_set(
        db, primary, body
    )
    permission_targets = [*descendants, *related_card_ids]
    await _ensure_permission_on_each(
        db,
        user,
        permission_targets,
        app_perm="inventory.delete",
        card_perm="card.delete",
    )

    # For disconnect/reparent, mutate the primary's children before deletion.
    if direct_children and body.child_strategy in ("disconnect", "reparent"):
        await card_lifecycle.apply_child_strategy(db, primary, body.child_strategy, user.id)
    # Single-hop: any ticked related card's children get disconnected before
    # the related card is deleted, so the FK on `cards.parent_id` doesn't trip.
    for rid in related_card_ids:
        rel_res = await db.execute(select(Card).where(Card.id == rid))
        rcard = rel_res.scalar_one_or_none()
        if rcard is not None:
            await card_lifecycle.apply_child_strategy(db, rcard, "disconnect", user.id)

    # Capture what we'll be reporting before the rows are gone.
    affected_children_ids = list(descendants)
    affected_related_card_ids = list(related_card_ids)
    deleted_payload: list[tuple[uuid.UUID, str, str]] = []

    # Resolve all targets (descendants + related + primary) up front, then
    # publish their `card.deleted` events BEFORE the DELETE runs. The events
    # FK uses `ON DELETE SET NULL`, but inserting the event row after the
    # cards row is gone would still violate the FK at flush time.
    target_objs: list[Card] = []
    for cid in [*descendants, *related_card_ids]:
        row_res = await db.execute(select(Card).where(Card.id == cid))
        cobj = row_res.scalar_one_or_none()
        if cobj is None:
            continue
        target_objs.append(cobj)
        deleted_payload.append((cobj.id, cobj.type, cobj.name))
    target_objs.append(primary)
    deleted_payload.append((primary.id, primary.type, primary.name))

    for did, dtype, dname in deleted_payload:
        await event_bus.publish(
            "card.deleted",
            {"id": str(did), "type": dtype, "name": dname},
            db=db,
            card_id=did,
            user_id=user.id,
        )

    if affected_children_ids or affected_related_card_ids:
        await event_bus.publish(
            "card.deleted.batch",
            {
                "id": str(primary.id),
                "type": primary.type,
                "name": primary.name,
                "child_strategy": body.child_strategy,
                "affected_children_ids": [str(x) for x in affected_children_ids],
                "affected_related_card_ids": [str(x) for x in affected_related_card_ids],
            },
            db=db,
            card_id=primary.id,
            user_id=user.id,
        )

    # Cascade descendants are ordered deepest-first; primary is last so its
    # children (which were either reparented above or are the descendants
    # themselves) are gone before the parent FK is removed. Flush between
    # each row so SQLAlchemy doesn't batch the DELETEs into one executemany
    # call (which would lose the deepest-first ordering).
    for cobj in target_objs:
        await db.delete(cobj)
        await db.flush()

    await db.commit()
    return CardDeleteResponse(
        deleted_card_ids=[str(did) for did, _, _ in deleted_payload],
        affected_children_ids=[str(x) for x in affected_children_ids],
        affected_related_card_ids=[str(x) for x in affected_related_card_ids],
    )


@router.post("/fix-hierarchy-names")
async def fix_hierarchy_names(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "admin.metamodel")
    """One-time cleanup: strip accumulated hierarchy prefixes from names.

    A UI bug caused hierarchy paths like "Parent / Child" to be persisted as
    the card name.  This endpoint detects and fixes those entries by
    keeping only the last " / "-separated segment for any card that has
    a parent_id.
    """
    result = await db.execute(
        select(Card).where(
            Card.parent_id.isnot(None),
            Card.name.contains(" / "),
            Card.status == "ACTIVE",
        )
    )
    fixed: list[dict] = []
    for card in result.scalars().all():
        leaf_name = card.name.rsplit(" / ", 1)[-1]
        if leaf_name != card.name:
            fixed.append({"id": str(card.id), "old_name": card.name, "new_name": leaf_name})
            card.name = leaf_name
    await db.commit()
    return {"fixed": len(fixed), "details": fixed}


@router.get("/{card_id}/history")
async def get_history(
    card_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    await PermissionService.require_permission(
        db, user, "inventory.view", card_id=uuid.UUID(card_id), card_permission="card.view"
    )
    q = (
        select(Event)
        .where(Event.card_id == uuid.UUID(card_id))
        .options(selectinload(Event.user))
        .order_by(Event.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    result = await db.execute(q)
    events = result.scalars().all()
    return [
        {
            "id": str(e.id),
            "event_type": e.event_type,
            "data": e.data,
            "user_id": str(e.user_id) if e.user_id else None,
            "user_display_name": e.user.display_name if e.user else None,
            "created_at": e.created_at.isoformat() if e.created_at else None,
        }
        for e in events
    ]


@router.post("/{card_id}/approval-status")
async def update_approval_status(
    card_id: str,
    action: str = Query(..., pattern="^(approve|reject|reset)$"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    card_uuid = uuid.UUID(card_id)
    if not await PermissionService.check_permission(
        db, user, "inventory.approval_status", card_uuid, "card.approval_status"
    ):
        raise HTTPException(403, "Not enough permissions")
    result = await db.execute(select(Card).where(Card.id == card_uuid))
    card = result.scalar_one_or_none()
    if not card:
        raise HTTPException(404, "Card not found")
    # Gate: block approve when any mandatory relation / tag group is missing.
    if action == "approve":
        missing = await missing_mandatory(db, card)
        if missing["relations"] or missing["tag_groups"]:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "approval_blocked_mandatory_missing",
                    "missing_relations": missing["relations"],
                    "missing_tag_groups": missing["tag_groups"],
                },
            )
    status_map = {"approve": "APPROVED", "reject": "REJECTED", "reset": "DRAFT"}
    card.approval_status = status_map[action]
    await event_bus.publish(
        f"card.approval_status.{action}",
        {"id": str(card.id), "approval_status": card.approval_status},
        db=db,
        card_id=card.id,
        user_id=user.id,
    )

    # Notify stakeholders about approval status change
    action_label = {"approve": "approved", "reject": "rejected", "reset": "reset"}
    await notification_service.create_notifications_for_subscribers(
        db,
        card_id=card.id,
        notif_type="approval_status_changed",
        title=f"Approval Status {action_label[action].title()}",
        message=f'{user.display_name} {action_label[action]} the approval status on "{card.name}"',
        link=f"/cards/{card_id}",
        data={"approval_status": card.approval_status, "action": action},
        actor_id=user.id,
    )

    await db.commit()
    return {"approval_status": card.approval_status}


@router.get("/{card_id}/my-permissions")
async def my_permissions(
    card_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Return the current user's effective permissions on a specific card."""
    result = await db.execute(select(Card).where(Card.id == uuid.UUID(card_id)))
    if not result.scalar_one_or_none():
        raise HTTPException(404, "Card not found")

    return await PermissionService.get_effective_card_permissions(db, user, uuid.UUID(card_id))


@router.get("/export/json")
async def export_json(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    types: str = Query(..., description="Comma-separated type keys"),
    include_relations: bool = Query(False),
    include_stakeholders: bool = Query(False),
):
    """Bulk export cards as JSON for integration consumers (e.g. TurboLens MCP).

    Returns all active cards of the given types with optional pre-joined
    provider relation names and stakeholder owner info.
    """
    await PermissionService.require_permission(db, user, "inventory.export")

    type_list = [t.strip() for t in types.split(",") if t.strip()]
    if not type_list:
        raise HTTPException(400, "At least one type key is required")
    if len(type_list) > 20:
        raise HTTPException(400, "Maximum 20 type keys allowed")

    q = (
        select(Card)
        .where(Card.status == "ACTIVE", Card.type.in_(type_list))
        .options(selectinload(Card.tags).selectinload(Tag.group))
    )
    if include_stakeholders:
        q = q.options(selectinload(Card.stakeholders).selectinload(Stakeholder.user))

    result = await db.execute(q)
    cards = result.scalars().all()

    # Optionally resolve provider relation names per card
    provider_names_by_card: dict[str, list[str]] = {}
    if include_relations:
        card_ids = [c.id for c in cards]
        if card_ids:
            # Find all relations where Provider is source or target
            rel_q = select(Relation).where(
                or_(
                    Relation.source_id.in_(card_ids),
                    Relation.target_id.in_(card_ids),
                ),
                Relation.type.like("%Provider%"),
            )
            rel_result = await db.execute(rel_q)
            rels = rel_result.scalars().all()

            # Collect provider card IDs
            provider_card_ids = set()
            for rel in rels:
                provider_card_ids.add(rel.source_id)
                provider_card_ids.add(rel.target_id)
            # Remove non-provider IDs (we'll look up names)
            provider_card_ids -= set(card_ids)

            if provider_card_ids:
                prov_q = select(Card.id, Card.name).where(Card.id.in_(provider_card_ids))
                prov_result = await db.execute(prov_q)
                prov_name_map = {row.id: row.name for row in prov_result.all()}

                for rel in rels:
                    # Determine which side is the non-provider card
                    if rel.source_id in prov_name_map:
                        card_key = str(rel.target_id)
                        prov_name = prov_name_map[rel.source_id]
                    elif rel.target_id in prov_name_map:
                        card_key = str(rel.source_id)
                        prov_name = prov_name_map[rel.target_id]
                    else:
                        continue
                    provider_names_by_card.setdefault(card_key, []).append(prov_name)

    redact = await _cost_redaction_map(db, user, list(cards))
    items = []
    for card in cards:
        tags = [
            {"name": t.name, "color": t.color, "group_name": t.group.name if t.group else None}
            for t in (card.tags or [])
        ]
        owner = None
        owner_email = None
        if include_stakeholders:
            for s in card.stakeholders or []:
                if s.role and "responsible" in s.role.lower():
                    if s.user:
                        owner = s.user.display_name
                        owner_email = s.user.email
                    break

        attrs = card.attributes or {}
        strip = redact.get(card.id)
        if strip:
            attrs = {k: v for k, v in attrs.items() if k not in strip}

        items.append(
            {
                "id": str(card.id),
                "type": card.type,
                "subtype": card.subtype,
                "name": card.name,
                "description": card.description,
                "lifecycle": card.lifecycle,
                "attributes": attrs,
                "status": card.status,
                "data_quality": card.data_quality,
                "updated_at": card.updated_at.isoformat() if card.updated_at else None,
                "tags": tags,
                "owner": owner,
                "owner_email": owner_email,
                "provider_names": provider_names_by_card.get(str(card.id), []),
            }
        )

    return items


@router.get("/export/csv")
async def export_csv(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    type: str | None = Query(None),
):
    await PermissionService.require_permission(db, user, "inventory.export")
    q = select(Card).where(Card.status == "ACTIVE")
    if type:
        q = q.where(Card.type == type)
    result = await db.execute(q)
    sheets = list(result.scalars().all())
    redact = await _cost_redaction_map(db, user, sheets)

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["id", "type", "name", "description", "status", "lifecycle", "attributes"])
    for card in sheets:
        attrs = card.attributes or {}
        strip = redact.get(card.id)
        if strip:
            attrs = {k: v for k, v in attrs.items() if k not in strip}
        writer.writerow(
            [
                str(card.id),
                card.type,
                card.name,
                card.description or "",
                card.status,
                str(card.lifecycle),
                str(attrs),
            ]
        )
    output.seek(0)
    stamp = datetime.now().strftime("%Y-%m-%d_%H%M")
    base = f"cards_{type}" if type else "cards"
    filename = f"{base}_{stamp}.csv"
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
