"""The card write service — the single implementation of card create /
update / archive and relation upsert semantics.

Extracted from the ``cards`` / ``relations`` route modules (B0) with zero
behaviour change so that every write path — REST routes, bulk endpoints,
and the extension data bridge — funnels through one place. The invariants
that must never fork live here: attribute validation (URL schemes, select
options, required-not-cleared, strict keys), sibling-name uniqueness,
hierarchy cycle/depth guards and level sync, PPM-managed cost-field
preservation, calculated-field execution ordering (calculations before
data-quality scoring), approval-status breaking, and event emission.

Contract notes:

* **Callers own the transaction.** Nothing here commits or rolls back —
  the CLAUDE.md session rule. Routes commit after calling; the extension
  bridge wraps calls in its own short session.
* **Permission checks stay route-side.** The service trusts its caller's
  authorization; so does the per-user cost-redaction merge on update
  payloads (permission *shaping* of the incoming payload, not write
  semantics — extension callers are system-level and nothing is stripped).
* **Errors are ``HTTPException``**, verbatim from the extracted routes, so
  REST responses stay byte-identical. Non-HTTP callers translate them.
* **``WriteActor``** identifies who is writing: a user id for human/API
  writes, an extension key for bridge writes. When ``ext_key`` is set it
  is stamped into every emitted event's data (``data["ext"]``) so the
  event dispatcher's self-origin filter can break extension sync loops —
  for user actors the payloads are unchanged.
* **``dry_run``** gates event emission and notifications only; the caller
  is responsible for rolling the transaction back (savepoint), matching
  the bulk endpoints' pattern.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.models.card_type import CardType
from app.models.ppm_cost_line import PpmBudgetLine, PpmCostLine
from app.models.relation import Relation
from app.models.relation_type import RelationType
from app.services import card_lifecycle, card_reference, notification_service
from app.services.calculation_engine import run_calculations_for_card
from app.services.card_uniqueness import check_sibling_name_unique
from app.services.data_quality import calc_data_quality
from app.services.event_bus import event_bus
from app.services.hierarchy import HIERARCHY_LEVEL_KEY

# Fields that PPM budget/cost lines manage — calculations must not overwrite these.
_PPM_MANAGED_FIELDS = {"costBudget", "costActual"}

_ALLOWED_URL_SCHEMES = ("http://", "https://", "mailto:")

MACRO_CAPABILITY_LEVEL_KEY: str = "Macro"


@dataclass(frozen=True)
class WriteActor:
    """Who is performing a write: a user (id + display name) or an
    extension (``ext_key`` set, ``user_id`` None)."""

    user_id: uuid.UUID | None
    display_name: str
    ext_key: str | None = None

    @classmethod
    def from_user(cls, user) -> WriteActor:
        return cls(user_id=user.id, display_name=user.display_name)


def _stamp_ext(actor: WriteActor, data: dict) -> dict:
    """Stamp extension provenance into an event payload. A no-op for user
    actors, so B0 emits byte-identical events for every existing path."""
    if actor.ext_key:
        return {**data, "ext": actor.ext_key}
    return data


# ---------------------------------------------------------------------------
# PPM-managed field exclusions
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# Attribute validation
# ---------------------------------------------------------------------------


async def _assign_reference_on_create(
    db: AsyncSession, card: Card, card_type: CardType | None
) -> None:
    """Populate ``card.reference`` at creation for ``auto``-mode types (else NULL)."""
    if card_type is None:
        return
    if card_reference.get_mode(card_type) == "auto":
        card.reference = await card_reference.next_reference(db, card_type)


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


def _is_empty_attr(val: object) -> bool:
    """The app-wide 'field is not filled' predicate (mirrors data_quality scoring)."""
    return val is None or val == "" or val == []


def _check_required_not_cleared(
    card_type: str, schema: list | None, new_attrs: dict, old_attrs: dict
) -> None:
    """Reject writes that clear a required field (non-empty → empty transition).

    Deliberately only guards *clearing*: creation and imports may land cards with
    required fields still empty (the card just scores 0 data quality until they
    are filled), and a card that is already incomplete stays editable. Boolean
    fields are exempt (a switch always has a value) and so are readonly fields —
    the calculation engine may legitimately pop a calculated key when its
    formula yields None.
    """
    if not schema:
        return
    cleared: list[tuple[str, str]] = []
    for section in schema:
        for field in section.get("fields", []):
            key = field.get("key")
            if (
                not key
                or not field.get("required")
                or field.get("type") == "boolean"
                or field.get("readonly")
            ):
                continue
            if not _is_empty_attr(old_attrs.get(key)) and _is_empty_attr(new_attrs.get(key)):
                cleared.append((key, field.get("label") or key))
    if cleared:
        labels = ", ".join(label for _, label in cleared)
        raise HTTPException(
            422,
            {
                "code": "required_field_empty",
                "message": f"Required field(s) cannot be emptied: {labels}.",
                "field_keys": [key for key, _ in cleared],
                "card_type": card_type,
            },
        )


async def _validate_required_attributes(
    db: AsyncSession, card_type: str, new_attrs: dict, old_attrs: dict
) -> None:
    """Fetch the type's schema and run the required-clear check against it."""
    result = await db.execute(select(CardType.fields_schema).where(CardType.key == card_type))
    schema = result.scalar_one_or_none()
    _check_required_not_cleared(card_type, schema, new_attrs, old_attrs)


def _check_select_options(
    card_type: str, schema: list | None, new_attrs: dict, old_attrs: dict
) -> None:
    """Reject select-typed attribute values that are not declared options.

    A ``single_select`` holds one option key, a ``multiple_select`` a list of
    them. Nothing used to enforce that, so free text typed into a mass-edit or
    grid cell was stored verbatim, rendered as an unknown chip, and still
    counted as "filled" by the data-quality scorer (#940).

    Deliberately narrow so this can never block legitimate work:

    * Empty values pass — clearing a field is not a validation failure.
    * ``readonly`` fields are skipped: the calculation engine writes computed
      values into calculated select targets, same exemption as
      ``_check_required_not_cleared``.
    * Extension (``ext.*``) field types are skipped — core does not own their
      value shape.
    * A value that is unchanged from what is stored is skipped, so re-saving a
      card that already carries a legacy invalid value never fails.

    A bare string for a ``multiple_select`` is rejected rather than split on
    commas: silent coercion is how the bad data got in.
    """
    if not schema:
        return
    problems: list[str] = []
    field_keys: list[str] = []
    for section in schema:
        for field in section.get("fields", []):
            key = field.get("key")
            ftype = field.get("type")
            options = field.get("options") or []
            if not key or field.get("readonly") or not options:
                continue
            if ftype not in ("single_select", "multiple_select"):
                continue
            if key not in new_attrs:
                continue
            val = new_attrs.get(key)
            if _is_empty_attr(val) or val == old_attrs.get(key):
                continue
            label = field.get("label") or key
            valid = [str(o.get("key")) for o in options if o.get("key") is not None]
            if ftype == "single_select":
                bad = [val] if not (isinstance(val, str) and val in valid) else []
            elif not isinstance(val, list):
                problems.append(
                    f"'{label}' expects a list of option keys, got {type(val).__name__}"
                )
                field_keys.append(key)
                continue
            else:
                bad = [v for v in val if not (isinstance(v, str) and v in valid)]
            if bad:
                shown = ", ".join(repr(b) for b in bad)
                problems.append(f"'{label}' got {shown}; valid options: {', '.join(valid)}")
                field_keys.append(key)
    if problems:
        raise HTTPException(
            422,
            {
                "code": "invalid_option_value",
                "message": "Invalid value for select field(s): " + "; ".join(problems) + ".",
                "field_keys": field_keys,
                "card_type": card_type,
            },
        )


async def _validate_select_attributes(
    db: AsyncSession, card_type: str, new_attrs: dict, old_attrs: dict
) -> None:
    """Fetch the type's schema and run the option-key check against it."""
    if not new_attrs:
        return
    result = await db.execute(select(CardType.fields_schema).where(CardType.key == card_type))
    schema = result.scalar_one_or_none()
    _check_select_options(card_type, schema, new_attrs, old_attrs)


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


# ---------------------------------------------------------------------------
# Hierarchy guards + level sync
# ---------------------------------------------------------------------------


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


async def _check_parent_not_descendant(
    db: AsyncSession, card_ids: set[uuid.UUID], new_parent_id: uuid.UUID | None
) -> None:
    """Raise HTTPException if re-parenting ``card_ids`` under ``new_parent_id`` cycles.

    Walks up the ancestor chain from the proposed parent: meeting any of the
    cards being moved means that parent sits inside that card's own subtree,
    so the move would detach the whole branch into an unreachable loop.

    Note that nothing else in the card API guards this — ``_walk_ancestor_chain``
    and friends merely cycle-*guard* their own traversal with a ``seen`` set and
    never raise. Mass re-parenting makes the mistake easy to hit, and the
    client cannot practically exclude the descendants of N cards up front.
    """
    if new_parent_id is None:
        return  # detaching to root can never cycle
    if new_parent_id in card_ids:
        raise HTTPException(400, "Cannot set a card as its own parent")

    current: uuid.UUID | None = new_parent_id
    seen: set[uuid.UUID] = set()
    while current and current not in seen:
        seen.add(current)
        res = await db.execute(select(Card.parent_id).where(Card.id == current))
        row = res.first()
        if row is None:
            return
        current = row[0]
        if current is not None and current in card_ids:
            raise HTTPException(
                400,
                "Cannot set parent: the chosen parent is a descendant of a card "
                "being moved, which would create a hierarchy cycle",
            )


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


# ---------------------------------------------------------------------------
# Card create / update / archive
# ---------------------------------------------------------------------------


async def create_card(
    db: AsyncSession,
    actor: WriteActor,
    *,
    type_key: str,
    name: str,
    subtype: str | None = None,
    description: str | None = None,
    parent_id: uuid.UUID | None = None,
    lifecycle: dict | None = None,
    attributes: dict | None = None,
    external_id: str | None = None,
    alias: str | None = None,
    strict_attributes: bool = False,
    dry_run: bool = False,
) -> Card:
    """Create one card with full validation and side effects; returns the
    flushed (uncommitted) row. Caller owns permission checks + the commit."""
    await _validate_url_attributes(db, type_key, attributes or {})
    await _validate_select_attributes(db, type_key, attributes or {}, {})
    if strict_attributes:
        await _validate_strict_attributes(db, type_key, attributes or {})
    await check_sibling_name_unique(db, type_key=type_key, parent_id=parent_id, name=name)
    card = Card(
        type=type_key,
        subtype=subtype,
        name=name,
        description=description,
        parent_id=parent_id,
        lifecycle=lifecycle or {},
        attributes=attributes or {},
        external_id=external_id,
        alias=alias,
        approval_status="DRAFT",
        created_by=actor.user_id,
        updated_by=actor.user_id,
    )
    db.add(card)
    await db.flush()

    # Assign the human-readable reference (auto-generated or manual) per type config.
    card_type_row = (
        await db.execute(select(CardType).where(CardType.key == type_key))
    ).scalar_one_or_none()
    await _assign_reference_on_create(db, card, card_type_row)

    # Guard: hierarchy depth limit for BusinessCapability
    if card.parent_id:
        await _check_hierarchy_depth(db, card, card.parent_id)

    # Auto-set hierarchy levels (hierarchyLevel for any hierarchical type;
    # capabilityLevel for BusinessCapability)
    changed_levels = await _sync_hierarchy_levels(db, card)

    # Run calculated fields (skip PPM-managed cost fields if PPM data exists)
    ppm_excl = await _get_ppm_exclusions(db, card)
    await run_calculations_for_card(db, card, exclude_fields=ppm_excl)
    await _recalc_changed_descendants(db, changed_levels, card.id)

    # Compute data quality score. Must run *after* the calculations, or a
    # weighted calculated field is scored on its previous value.
    card.data_quality = await calc_data_quality(db, card)

    if not dry_run:
        await event_bus.publish(
            "card.created",
            _stamp_ext(actor, {"id": str(card.id), "type": card.type, "name": card.name}),
            db=db,
            card_id=card.id,
            user_id=actor.user_id,
        )
    return card


async def update_card(
    db: AsyncSession,
    actor: WriteActor,
    card: Card,
    updates: dict,
    *,
    strict_attributes: bool = False,
    dry_run: bool = False,
) -> bool:
    """Apply an update payload to ``card`` with full validation and side
    effects. Returns True when anything actually changed. ``updates`` is the
    caller's field→value dict (``parent_id`` as str or None); the per-user
    cost-redaction merge — permission shaping, not write semantics — must
    already have been applied by route callers.
    """
    # The human-readable reference is write-once & immutable — never editable via
    # update (defensive: CardUpdate no longer carries it, but drop any stray).
    updates = dict(updates)
    updates.pop("reference", None)

    # Validate URL-typed attributes
    if "attributes" in updates and updates["attributes"]:
        await _validate_url_attributes(db, card.type, updates["attributes"])
        if strict_attributes:
            await _validate_strict_attributes(db, card.type, updates["attributes"])

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

    # Guard: never clear a required field. Validates the post-merge final state
    # (after the cost/PPM preservation above), and runs even for an empty payload
    # dict — `{"attributes": {}}` is precisely the wipe this must catch.
    if "attributes" in updates:
        await _validate_required_attributes(
            db, card.type, updates["attributes"] or {}, dict(card.attributes or {})
        )
        # Guard: select values must be declared options — same post-merge state.
        await _validate_select_attributes(
            db, card.type, updates["attributes"] or {}, dict(card.attributes or {})
        )

    # Guard: cycle + hierarchy depth limit before applying parent change
    if "parent_id" in updates:
        new_pid = uuid.UUID(updates["parent_id"]) if updates["parent_id"] else None
        if new_pid != card.parent_id:
            await _check_parent_not_descendant(db, {card.id}, new_pid)
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

    if not changes:
        return False

    card.updated_by = actor.user_id
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

    # Run calculated fields (skip PPM-managed cost fields if PPM data exists)
    ppm_excl = await _get_ppm_exclusions(db, card)
    await run_calculations_for_card(db, card, exclude_fields=ppm_excl)
    # Re-run calcs for descendants whose level moved (after the card's own
    # run, so a child formula reading a parent's computed field sees it fresh)
    await _recalc_changed_descendants(db, changed_levels, card.id)

    # Recalculate completion. Must run *after* the calculations, or a
    # weighted calculated field is scored on its previous value.
    card.data_quality = await calc_data_quality(db, card)

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
    if not dry_run:
        await event_bus.publish(
            "card.updated",
            _stamp_ext(actor, {"id": str(card.id), "changes": serialised_changes}),
            db=db,
            card_id=card.id,
            user_id=actor.user_id,
        )

        # Notify subscribers about the update
        changed_fields = ", ".join(changes.keys())
        await notification_service.create_notifications_for_subscribers(
            db,
            card_id=card.id,
            notif_type="card_updated",
            title=f"{card.name} Updated",
            message=f'{actor.display_name} updated "{card.name}" ({changed_fields})',
            link=f"/cards/{card.id}",
            data={"changes": list(changes.keys())},
        )

    return True


async def resolve_archive_delete_set(
    db: AsyncSession,
    primary: Card,
    *,
    child_strategy: str | None,
    related_card_ids: list[str],
    cascade_all_related: bool,
) -> tuple[list[uuid.UUID], list[uuid.UUID], list[uuid.UUID]]:
    """Resolve (descendants, related_card_ids, full_affected_excluding_primary).

    - descendants: empty unless `child_strategy == "cascade"`.
    - related_card_ids: deduped, primary-stripped, descendant-stripped.
    - full_affected_excluding_primary: union, deduped.
    """
    descendants: list[uuid.UUID] = []
    if child_strategy == "cascade":
        descendants = await card_lifecycle.collect_descendants(db, primary.id)

    requested_related: list[uuid.UUID] = []
    seen_related: set[uuid.UUID] = set()
    for raw in related_card_ids:
        try:
            rid = uuid.UUID(raw)
        except (TypeError, ValueError) as exc:
            raise HTTPException(422, f"Invalid related_card_ids entry: {raw!r}") from exc
        if rid == primary.id or rid in seen_related:
            continue
        seen_related.add(rid)
        requested_related.append(rid)

    if cascade_all_related:
        for peer_id in await card_lifecycle.expand_cascade_all_related(db, primary.id):
            if peer_id == primary.id or peer_id in seen_related:
                continue
            seen_related.add(peer_id)
            requested_related.append(peer_id)

    descendant_set = set(descendants)
    kept_related = [rid for rid in requested_related if rid not in descendant_set]

    full_set: list[uuid.UUID] = []
    seen_full: set[uuid.UUID] = set()
    for cid in [*descendants, *kept_related]:
        if cid in seen_full:
            continue
        seen_full.add(cid)
        full_set.append(cid)

    return descendants, kept_related, full_set


async def archive_card_set(
    db: AsyncSession,
    actor: WriteActor,
    primary: Card,
    *,
    child_strategy: card_lifecycle.ChildStrategy | None,
    descendants: list[uuid.UUID],
    related_card_ids: list[uuid.UUID],
    full_affected: list[uuid.UUID],
    direct_children: list[Card],
    dry_run: bool = False,
) -> tuple[list[Card], list[uuid.UUID], list[uuid.UUID]]:
    """Flip the primary plus the resolved affected set to ARCHIVED, applying
    the child strategy first. Returns ``(flipped, affected_children_ids,
    affected_related_card_ids)``. Caller has already run permission checks
    on every affected card and owns the commit."""
    # Apply parent-id mutation on the primary's direct children for disconnect/reparent.
    if direct_children and (child_strategy == "disconnect" or child_strategy == "reparent"):
        await card_lifecycle.apply_child_strategy(db, primary, child_strategy, actor.user_id)
    # For ticked related cards, give their own children a `disconnect` so their
    # `parent_id` doesn't point at a soon-to-be-archived parent. Single-hop.
    for rid in related_card_ids:
        rel_res = await db.execute(select(Card).where(Card.id == rid))
        rcard = rel_res.scalar_one_or_none()
        if rcard is not None and rcard.status == "ACTIVE":
            await card_lifecycle.apply_child_strategy(db, rcard, "disconnect", actor.user_id)

    # Flip primary + cascade descendants + ticked related to ARCHIVED.
    from sqlalchemy.orm import selectinload

    from app.models.stakeholder import Stakeholder
    from app.models.tag import Tag

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
    flipped = card_lifecycle.archive_cards_in_place(flip_cards, actor.user_id)

    # Cross-boundary peer relations are kept in the database and hidden from
    # active views via the archived-status filter in `GET /relations`. They
    # reappear automatically when the card is restored. Hard-delete and the
    # 30-day auto-purge clean them up.

    affected_children_ids = [
        cid for cid in descendants if cid in {c.id for c in flipped if c.id != primary.id}
    ]
    affected_related_card_ids = [rid for rid in related_card_ids if rid in {c.id for c in flipped}]

    if not dry_run:
        for fcard in flipped:
            await event_bus.publish(
                "card.archived",
                _stamp_ext(actor, {"id": str(fcard.id), "type": fcard.type, "name": fcard.name}),
                db=db,
                card_id=fcard.id,
                user_id=actor.user_id,
            )

        if affected_children_ids or affected_related_card_ids:
            await event_bus.publish(
                "card.archived.batch",
                _stamp_ext(
                    actor,
                    {
                        "id": str(primary.id),
                        "type": primary.type,
                        "name": primary.name,
                        "child_strategy": child_strategy,
                        "affected_children_ids": [str(x) for x in affected_children_ids],
                        "affected_related_card_ids": [str(x) for x in affected_related_card_ids],
                    },
                ),
                db=db,
                card_id=primary.id,
                user_id=actor.user_id,
            )

    return flipped, affected_children_ids, affected_related_card_ids


# ---------------------------------------------------------------------------
# Relation events + upsert
# ---------------------------------------------------------------------------


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
    actor_id: uuid.UUID | None,
    extra: dict | None = None,
    ext_key: str | None = None,
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
    if ext_key:
        base["ext"] = ext_key
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


async def upsert_relation(
    db: AsyncSession,
    actor: WriteActor,
    *,
    type_key: str,
    source_id: uuid.UUID,
    target_id: uuid.UUID,
    attributes: dict | None = None,
    description: str | None = None,
    dry_run: bool = False,
) -> tuple[Relation, bool, list[str]]:
    """Idempotent single-relation upsert on ``(type, source, target)`` —
    the ``POST /relations`` semantics (#905): reuse an existing row and merge
    supplied attributes / description onto it rather than inserting a
    duplicate. Returns ``(relation, reused, changed_fields)``; the row is
    flushed, never committed."""
    existing = await db.execute(
        select(Relation).where(
            Relation.type == type_key,
            Relation.source_id == source_id,
            Relation.target_id == target_id,
        )
    )
    rel = existing.scalar_one_or_none()
    reused = rel is not None
    changed: list[str] = []

    if rel is None:
        rel = Relation(
            type=type_key,
            source_id=source_id,
            target_id=target_id,
            attributes=attributes or {},
            description=description,
        )
        db.add(rel)
    else:
        if attributes is not None and attributes != (rel.attributes or {}):
            rel.attributes = attributes
            changed.append("attributes")
        if description is not None and description != rel.description:
            rel.description = description
            changed.append("description")
    await db.flush()

    # Run calculated fields for both source and target cards, then rescore.
    # Data quality must follow the calculations, or a calculated field's
    # weight is scored one save stale (same rule as ppm.py).
    source_card = await db.get(Card, source_id)
    target_card = await db.get(Card, target_id)
    if source_card:
        await run_calculations_for_card(db, source_card)
        source_card.data_quality = await calc_data_quality(db, source_card)
    if target_card:
        await run_calculations_for_card(db, target_card)
        target_card.data_quality = await calc_data_quality(db, target_card)

    if not dry_run:
        if not reused:
            await _emit_relation_events(
                db,
                event_type="relation.created",
                rel=rel,
                source_card=source_card,
                target_card=target_card,
                actor_id=actor.user_id,
                ext_key=actor.ext_key,
            )
        elif changed:
            await _emit_relation_events(
                db,
                event_type="relation.updated",
                rel=rel,
                source_card=source_card,
                target_card=target_card,
                actor_id=actor.user_id,
                extra={"fields": changed},
                ext_key=actor.ext_key,
            )

    return rel, reused, changed
