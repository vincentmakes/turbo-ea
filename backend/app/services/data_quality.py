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
``turbolens_commit.py`` all call :func:`calc_data_quality`, and the batched
:func:`rescore_cards` runs the same :func:`score_card` over a
:class:`ScoringContext` loaded once per type and :class:`CardFacts` loaded once
per chunk. ``seed_demo.py``
keeps its own dict-based approximation because it runs before relations/tags
exist and cannot evaluate the mandatory buckets.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable, Sequence
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.models.card_type import CardType
from app.models.stakeholder import Stakeholder
from app.models.stakeholder_role_definition import StakeholderRoleDefinition
from app.services.card_completeness import (
    NO_LINKS,
    LinkFacts,
    MandatoryConfig,
    evaluate,
    load_link_facts,
    load_mandatory_config,
    optional_relation_sides,
)
from app.services.derived_writes import derived_maintenance

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


@dataclass(frozen=True)
class ScoringContext:
    """Everything about a card *type* the scorer reads, loaded once per type.

    ``mandatory`` is ``None`` when both the relations and tags buckets are
    switched off, and ``counting_role_keys`` is empty when the stakeholders
    bucket is off — in both cases nothing about the card is loaded for them.
    """

    fields_schema: list
    subtypes: list | None
    dq_cfg: dict
    mandatory: MandatoryConfig | None
    counting_role_keys: tuple[str, ...]


@dataclass(frozen=True)
class CardFacts:
    """What one card holds of the type's mandatory items and counting roles."""

    links: LinkFacts = NO_LINKS
    holds_counting_stakeholder: bool = False


async def load_scoring_context(db: AsyncSession, type_key: str) -> ScoringContext | None:
    """Load a type's scoring config; ``None`` when the type does not exist."""
    row = (
        await db.execute(
            select(CardType.fields_schema, CardType.subtypes, CardType.section_config).where(
                CardType.key == type_key
            )
        )
    ).one_or_none()
    if not row:
        return None
    schema, subtypes, section_config = row
    dq_cfg = (section_config or {}).get(DATA_QUALITY_CONFIG_KEY) or {}

    mandatory = None
    if _bucket_weight(dq_cfg, "relations") > 0 or _bucket_weight(dq_cfg, "tags") > 0:
        mandatory = await load_mandatory_config(db, type_key)

    # `counts_for_quality` is what keeps the stakeholders slot honest: a purely
    # passive role (the built-in `observer`) is excluded, so watching a card can
    # never stand in for owning it. Archived roles are excluded too, so an
    # assignment held under one does not fill the slot.
    role_keys: tuple[str, ...] = ()
    if _bucket_weight(dq_cfg, "stakeholders") > 0:
        role_keys = tuple(
            (
                await db.execute(
                    select(StakeholderRoleDefinition.key).where(
                        StakeholderRoleDefinition.card_type_key == type_key,
                        StakeholderRoleDefinition.is_archived.is_(False),
                        StakeholderRoleDefinition.counts_for_quality.is_(True),
                    )
                )
            ).scalars()
        )
    return ScoringContext(
        fields_schema=schema,
        subtypes=subtypes,
        dq_cfg=dq_cfg,
        mandatory=mandatory,
        counting_role_keys=role_keys,
    )


async def load_scoring_facts(
    db: AsyncSession, ctx: ScoringContext, card_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, CardFacts]:
    """The per-card facts for ``card_ids``, in a fixed number of queries.

    Every id gets an entry. The cards must all be of the type ``ctx`` was
    loaded for.
    """
    ids = list(card_ids)
    links: dict[uuid.UUID, LinkFacts] = {}
    if ctx.mandatory is not None:
        links = await load_link_facts(db, ctx.mandatory, ids)
    holders: set[uuid.UUID] = set()
    if ctx.counting_role_keys:
        holders = set(
            (
                await db.execute(
                    select(Stakeholder.card_id)
                    .where(
                        Stakeholder.card_id.in_(ids),
                        Stakeholder.role.in_(ctx.counting_role_keys),
                    )
                    .distinct()
                )
            ).scalars()
        )
    return {
        cid: CardFacts(
            links=links.get(cid, NO_LINKS),
            holds_counting_stakeholder=cid in holders,
        )
        for cid in ids
    }


def score_card(card: Card, ctx: ScoringContext, facts: CardFacts) -> float:
    """A card's data-quality score (0-100) from weighted completeness.

    Pure: everything it reads about the database is in ``ctx`` and ``facts``.
    """
    schema, subtypes, dq_cfg = ctx.fields_schema, ctx.subtypes, ctx.dq_cfg

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
    # every mandatory field is filled. Boolean fields are exempt (Not set is
    # one of a boolean's three states, #1266) and so are readonly (calculated) fields, whose value
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
    # (`mandatory` is loaded exactly when one of the two weights is on.)
    if ctx.mandatory is not None:
        state = evaluate(
            ctx.mandatory, facts.links, optional_relation_sides(subtypes, card.subtype)
        )
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
    # `counting_role_keys` (see `load_scoring_context`), so an assignment
    # held under one does not fill the slot.
    stake_w = _bucket_weight(dq_cfg, "stakeholders")
    # A type with no counting roles adds no slot at all, rather than one
    # nobody could ever fill. (`counting_role_keys` is only loaded while the
    # bucket is on.)
    if stake_w > 0 and ctx.counting_role_keys:
        total_weight += stake_w
        if facts.holds_counting_stakeholder:
            filled_weight += stake_w

    if total_weight == 0:
        return 0.0
    return round((filled_weight / total_weight) * 100, 1)


async def calc_data_quality(db: AsyncSession, card: Card) -> float:
    """Calculate a card's data-quality score (0-100) from weighted completeness."""
    ctx = await load_scoring_context(db, card.type)
    if ctx is None:
        return 0.0
    facts = await load_scoring_facts(db, ctx, [card.id])
    return score_card(card, ctx, facts[card.id])


async def rescore_cards(
    db: AsyncSession, card_ids: Iterable[uuid.UUID], *, chunk_size: int = 500
) -> int:
    """Rescore the given cards; return how many stored scores changed.

    For the card-context mutations that feed the score but never go through
    ``PATCH /cards`` — stakeholders, relations, tags — and for the config
    changes ``rescore_card_type`` handles. Those all shape a built-in bucket,
    so without this the stored score silently reflects whatever the state was
    at the card's last edit.

    The ids may span several types (rollback, bulk stakeholder changes): each
    type's config is loaded once per call, and each chunk's facts in a fixed
    number of queries per type, so the cost does not grow with the card count.

    Never commits and never flushes: the caller owns the transaction, and in
    the bulk endpoints it owns a dry-run savepoint that must still be able to
    discard everything this wrote.
    """
    ids = list(dict.fromkeys(card_ids))
    changed = 0
    contexts: dict[str, ScoringContext | None] = {}
    for i in range(0, len(ids), chunk_size):
        chunk = ids[i : i + chunk_size]
        cards = (await db.execute(select(Card).where(Card.id.in_(chunk)))).scalars().all()
        by_type: dict[str, list[Card]] = {}
        for card in cards:
            by_type.setdefault(card.type, []).append(card)
        scores: list[tuple[Card, float]] = []
        for type_key, group in by_type.items():
            if type_key not in contexts:
                contexts[type_key] = await load_scoring_context(db, type_key)
            ctx = contexts[type_key]
            if ctx is None:
                scores.extend((card, 0.0) for card in group)
                continue
            facts = await load_scoring_facts(db, ctx, [card.id for card in group])
            scores.extend((card, score_card(card, ctx, facts[card.id])) for card in group)
        # Assigned only once every query of the chunk has run, so no autoflush
        # interleaves an UPDATE per card between them.
        for card, score in scores:
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
    # Config-driven housekeeping: the admin who moved a weight did not review
    # every card of the type, so their Modified dates must not say otherwise.
    with derived_maintenance(db):
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
    with derived_maintenance(db):
        changed = await rescore_cards(db, ids, chunk_size=chunk_size)
        await db.flush()
    return changed
