"""Canonical data-quality scorer for cards.

A card's data-quality score is a weighted completeness ratio:
``filled_weight / total_weight * 100``. Two layers of weights feed it:

1. **Per-field weights** from the card type's ``fields_schema`` (default 1;
   ``weight <= 0`` excludes the field).
2. **Built-in contributor weights** — Description, Lifecycle, mandatory
   Relations, mandatory Tag groups and Stakeholders — which admins tune
   per card type via the reserved ``section_config.__dataQuality`` key (each
   default 1, 0 = exclude).

Description, Lifecycle and Stakeholders are each a single slot worth their
bucket weight. Relations and Tags multiply theirs by the number of *applicable
mandatory items*, because each of those genuinely has to be satisfied before
the card can be approved.

A **mandatory-field gate** precedes the ratio: while any visible required field
(excluding boolean and readonly fields) is empty, the score is pinned to 0.

This is the single source of truth: ``cards.py``, ``ppm.py`` and
``turbolens_commit.py`` all call :func:`calc_data_quality`. ``seed_demo.py``
keeps its own dict-based approximation because it runs before relations/tags
exist and cannot evaluate the mandatory buckets.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.models.card_type import CardType
from app.models.stakeholder import Stakeholder
from app.models.stakeholder_role_definition import StakeholderRoleDefinition
from app.services.card_completeness import missing_mandatory

# Reserved key on CardType.section_config holding the built-in weights.
DATA_QUALITY_CONFIG_KEY = "__dataQuality"
_BUILT_IN_BUCKETS = ("description", "lifecycle", "relations", "tags", "stakeholders")


def _bucket_weight(dq_cfg: dict, name: str) -> float:
    """Return the admin-tuned weight for a built-in contributor.

    Defaults to 1 when unset; clamps negatives to 0; tolerant of bad values.
    """
    try:
        w = float(dq_cfg.get(name, 1))
    except (TypeError, ValueError):
        w = 1.0
    return w if w > 0 else 0.0


async def calc_data_quality(db: AsyncSession, card: Card) -> float:
    """Calculate a card's data-quality score (0-100) from weighted completeness."""
    result = await db.execute(
        select(CardType.fields_schema, CardType.subtypes, CardType.section_config).where(
            CardType.key == card.type
        )
    )
    row = result.one_or_none()
    if not row:
        return 0.0
    schema, subtypes, section_config = row

    dq_cfg = (section_config or {}).get(DATA_QUALITY_CONFIG_KEY) or {}

    # Determine hidden fields for the card's subtype
    hidden_keys: set[str] = set()
    if card.subtype and subtypes:
        for st in subtypes:
            if st.get("key") == card.subtype:
                hidden_keys = set(st.get("hidden_fields", []))
                break

    total_weight = 0.0
    filled_weight = 0.0
    attrs = card.attributes or {}

    # Mandatory-field gate: while any visible required field is empty, the
    # score is pinned to 0 — the regular weighted calculation only applies once
    # every mandatory field is filled. Boolean fields are exempt (a switch
    # always has a value) and so are readonly (calculated) fields, whose value
    # the user cannot enter by hand.
    for section in schema:
        for field in section.get("fields", []):
            if (
                not field.get("required")
                or field["key"] in hidden_keys
                or field.get("type") == "boolean"
                or field.get("readonly")
            ):
                continue
            val = attrs.get(field["key"])
            if val is None or val == "" or val == []:
                return 0.0

    for section in schema:
        for field in section.get("fields", []):
            if field["key"] in hidden_keys:
                continue
            weight = field.get("weight", 1)
            if weight <= 0:
                continue
            total_weight += weight
            val = attrs.get(field["key"])
            # `[]` is an emptied multiple_select — the mandatory gate above and
            # `_is_empty_attr` both read it as empty, so scoring it as filled
            # was a self-contradiction. `False` stays excluded by the identity
            # check (a boolean set to false is "not filled" for scoring); `0`
            # stays filled.
            if val is not None and val != "" and val != [] and val is not False:
                filled_weight += weight

    # Description bucket (admin-tunable; default weight 1, 0 = exclude)
    desc_w = _bucket_weight(dq_cfg, "description")
    if desc_w > 0:
        total_weight += desc_w
        if card.description and card.description.strip():
            filled_weight += desc_w

    # Lifecycle bucket (at least one date set)
    lc_w = _bucket_weight(dq_cfg, "lifecycle")
    if lc_w > 0:
        total_weight += lc_w
        lc = card.lifecycle or {}
        if any(lc.get(p) for p in ("plan", "phaseIn", "active", "phaseOut", "endOfLife")):
            filled_weight += lc_w

    # Mandatory relation sides and mandatory tag groups: each applicable item
    # contributes its bucket weight to total, and to filled only when satisfied.
    rel_w = _bucket_weight(dq_cfg, "relations")
    tag_w = _bucket_weight(dq_cfg, "tags")
    if rel_w > 0 or tag_w > 0:
        state = await missing_mandatory(db, card)
        if rel_w > 0:
            total_weight += state["relations_applicable"] * rel_w
            filled_weight += (state["relations_applicable"] - len(state["relations"])) * rel_w
        if tag_w > 0:
            total_weight += state["tag_groups_applicable"] * tag_w
            filled_weight += (state["tag_groups_applicable"] - len(state["tag_groups"])) * tag_w

    # Stakeholders bucket: ONE yes/no slot, exactly like description and
    # lifecycle — is anybody assigned to this card, in a role that counts?
    #
    # It used to award one slot *per role defined on the type*, which the admin
    # UI never expressed: the Data quality panel shows a single slider and its
    # Score-composition bar draws it as a single slice, so a type carrying both
    # `responsible` and `observer` silently cost two slots and a card with an
    # owner named but nobody watching was capped at half the bucket (#944).
    # Relations and tags keep their per-item multiplication below — each
    # mandatory item genuinely has to be satisfied — but stakeholder roles
    # carry no mandatory flag, so "all of them or a partial score" was never a
    # rule anyone declared.
    #
    # `counts_for_quality` is what keeps this honest: a purely passive role
    # (the built-in `observer`) is excluded, so watching a card can never stand
    # in for owning it. Archived and non-counting roles are filtered out of
    # `role_keys`, so an assignment held under one does not fill the slot.
    stake_w = _bucket_weight(dq_cfg, "stakeholders")
    if stake_w > 0:
        role_rows = await db.execute(
            select(StakeholderRoleDefinition.key).where(
                StakeholderRoleDefinition.card_type_key == card.type,
                StakeholderRoleDefinition.is_archived.is_(False),
                StakeholderRoleDefinition.counts_for_quality.is_(True),
            )
        )
        role_keys = list(role_rows.scalars().all())
        # A type with no counting roles adds no slot at all, rather than one
        # nobody could ever fill.
        if role_keys:
            total_weight += stake_w
            held = await db.execute(
                select(Stakeholder.id)
                .where(
                    Stakeholder.card_id == card.id,
                    Stakeholder.role.in_(role_keys),
                )
                .limit(1)
            )
            if held.scalar_one_or_none() is not None:
                filled_weight += stake_w

    if total_weight == 0:
        return 0.0
    return round((filled_weight / total_weight) * 100, 1)


async def rescore_cards(
    db: AsyncSession, card_ids: Iterable[uuid.UUID], *, chunk_size: int = 500
) -> int:
    """Rescore the given cards; return how many stored scores changed.

    For the card-context mutations that feed the score but never go through
    ``PATCH /cards`` — stakeholders, relations, tags. Those all shape a
    built-in bucket, so without this the stored score silently reflects
    whatever the state was at the card's last edit.

    Never commits and never flushes: the caller owns the transaction, and in
    the bulk endpoints it owns a dry-run savepoint that must still be able to
    discard everything this wrote.
    """
    ids = list(dict.fromkeys(card_ids))
    changed = 0
    for i in range(0, len(ids), chunk_size):
        chunk = ids[i : i + chunk_size]
        cards = (await db.execute(select(Card).where(Card.id.in_(chunk)))).scalars().all()
        for card in cards:
            score = await calc_data_quality(db, card)
            if card.data_quality != score:
                card.data_quality = score
                changed += 1
    return changed


async def rescore_card_type(db: AsyncSession, type_key: str) -> int:
    """Rescore every active card of a type after a scoring-config change.

    Changing a card type's weights, or which of its stakeholder roles count,
    moves the denominator for every card of that type at once — so the change
    has to take effect immediately rather than waiting for each card to be
    edited. Does not commit; the caller owns the transaction.
    """
    ids = list(
        (
            await db.execute(select(Card.id).where(Card.type == type_key, Card.status == "ACTIVE"))
        ).scalars()
    )
    return await rescore_cards(db, ids)


async def recompute_all_data_quality(db: AsyncSession, *, chunk_size: int = 500) -> int:
    """Rescore ``data_quality`` for every non-archived card. Returns the count
    of cards whose stored score changed.

    Used wherever scores may have been produced by something other than the
    canonical scorer above — the demo seed's dict-based approximation, or an
    older workspace importer — so the Dashboard's Average Completion reflects
    the same math everywhere.
    """
    ids = list((await db.execute(select(Card.id).where(Card.status != "ARCHIVED"))).scalars().all())
    changed = await rescore_cards(db, ids, chunk_size=chunk_size)
    await db.flush()
    return changed
