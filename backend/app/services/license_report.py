"""The licensing report: which cards count in which fiscal year, and what they show.

One rule for the rows of a year, the Platform aggregate and a single picked card (as
``cost_report`` is for costs): a candidate card is ACTIVE and readable (``CardReadScope``); it
counts in the CURRENT year when it is live in it (``is_live_in_fiscal_year``), in any other year
when it has a stored row. A row is one card across metrics; a metric / license-type selection
keeps only the cards with a cell of it. Statuses come from ``license_status``, never from here.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.models.relation import Relation
from app.services import yearly_rows
from app.services.card_licenses import LICENSE_TYPES, items_by_card, metric_results
from app.services.card_logo_service import logo_updated_map
from app.services.card_read_scope import CardReadScope
from app.services.cost_grouping import GroupBy, assign_groups
from app.services.fiscal_year import current_fiscal_year, get_fiscal_year_start
from app.services.license_catalogue import LicenseCatalogue, load_catalogue
from app.services.license_status import MetricResult, card_status, card_worst
from app.services.lifecycle import is_live_in_fiscal_year

PLATFORM_RELATIONS = ("relPlatformToApp", "relPlatformToITC")
PLATFORM_TYPE = "Platform"


def counts_in_year(card: Card, has_row: bool, fy: int, cur: int, start_month: int) -> bool:
    """The current year: live in it. Any other year (Forecast included): a stored row."""
    if fy == cur:
        return is_live_in_fiscal_year(card.lifecycle, cur, start_month)
    return has_row


async def _platform_card_ids(db: AsyncSession, platform_id: uuid.UUID) -> set[uuid.UUID]:
    rels = await db.execute(
        select(Relation.source_id, Relation.target_id).where(
            Relation.type.in_(PLATFORM_RELATIONS),
            (Relation.source_id == platform_id) | (Relation.target_id == platform_id),
        )
    )
    return {t if s == platform_id else s for s, t in rels.all()}


async def candidate_cards(
    db: AsyncSession,
    read_scope: CardReadScope,
    *,
    type_keys: list[str] | None = None,
    platform_id: uuid.UUID | None = None,
    card_id: uuid.UUID | None = None,
) -> list[Card]:
    """ACTIVE, readable Application / IT Component cards: of the types, linked to a Platform
    (either direction, each card once) or the one card."""
    stmt = select(Card).where(
        Card.status == "ACTIVE",
        Card.type.in_(LICENSE_TYPES),
        *read_scope.where(Card, mode="module"),
    )
    if card_id is not None:
        stmt = stmt.where(Card.id == card_id)
    elif platform_id is not None:
        stmt = stmt.where(Card.id.in_(await _platform_card_ids(db, platform_id)))
    else:
        stmt = stmt.where(Card.type.in_(type_keys or []))
    return list((await db.execute(stmt.order_by(Card.name, Card.id))).scalars().all())


def _validate_selection(
    catalogue: LicenseCatalogue, metric: str | None, license_type: str | None
) -> tuple[str | None, tuple[str, str] | None]:
    """``(metric, (type_metric, type_key) | None)``; raises ``ValueError`` for what the
    catalogue lacks (a bare type key included: the pair is the only unambiguous form)."""
    if metric is not None and catalogue.metric(metric) is None:
        raise ValueError(f"Unknown metric: {metric!r}")
    if license_type is None:
        return metric, None
    head, _, tail = license_type.partition(":")
    if not tail or catalogue.type(head, tail) is None:
        raise ValueError(f"Unknown license type (expected metric:type): {license_type!r}")
    if metric is not None and head != metric:
        raise ValueError(f"License type {license_type!r} is not of metric {metric!r}")
    return metric, (head, tail)


def _select(items: dict, metric: str | None, pair: tuple[str, str] | None) -> dict:
    """The cells of ``items`` inside the selection (all of them when nothing is picked)."""
    out: dict[str, dict] = {}
    for m, cells in items.items():
        if metric is not None and m != metric:
            continue
        kept = {k: c for k, c in cells.items() if pair is None or (m, k) == pair}
        if kept:
            out[m] = kept
    return out


def _by_metric(results: list[MetricResult]) -> list[dict]:
    return [
        {
            "metric": r.metric,
            "status": r.status,
            "worst_pct": r.worst_pct,
            "licensed_total": r.licensed_total,
            "actual_total": r.actual_total,
            "types": [
                {
                    "key": t.key,
                    "licensed": t.licensed,
                    "actual": t.actual,
                    "pct": t.pct,
                    "no_licence": t.no_licence,
                    "status": t.status,
                }
                for t in r.types
            ],
        }
        for r in results
    ]


async def build_report(
    db: AsyncSession,
    read_scope: CardReadScope,
    *,
    card_types: list[str],
    metric: str | None,
    license_type: str | None,
    fy: int,
    group_by: GroupBy | None,
    card_id: uuid.UUID | None,
    hidden_attribute_keys: dict[str, frozenset[str]] | None = None,
) -> dict:
    """One row per card for ``fy``. ``card_id`` is an Application / IT Component (the one card)
    or a Platform (the cards linked to it: no status, ``card_types`` and ``group_by`` ignored).
    ``license_type`` is a ``metric:type`` pair. Raises ``ValueError`` when the grouping or the
    selection is refused."""
    sm = await get_fiscal_year_start(db)
    cur = current_fiscal_year(sm)
    catalogue = await load_catalogue(db)
    sel_metric, pair = _validate_selection(catalogue, metric, license_type)

    aggregate = None
    if card_id is not None:
        picked = (await db.execute(select(Card).where(Card.id == card_id))).scalar_one()
        if picked.type == PLATFORM_TYPE:
            aggregate = {"id": str(picked.id), "name": picked.name, "type": PLATFORM_TYPE}
            cards = await candidate_cards(db, read_scope, platform_id=picked.id)
        else:
            cards = await candidate_cards(db, read_scope, card_id=picked.id)
    else:
        cards = await candidate_cards(db, read_scope, type_keys=card_types)

    data = await items_by_card(db, [c.id for c in cards], [fy], sm)
    scoped = [c for c in cards if counts_in_year(c, data[c.id][fy][1], fy, cur, sm)]
    selected = {c.id: _select(data[c.id][fy][0], sel_metric, pair) for c in scoped}
    narrowed = sel_metric is not None or pair is not None
    in_year = [c for c in scoped if selected[c.id] or not narrowed]

    groups = (
        await assign_groups(db, read_scope, in_year, group_by, card_types)
        if group_by and card_id is None
        else {}
    )
    logos = await logo_updated_map(db, in_year)
    hidden = hidden_attribute_keys or {}
    rows = []
    for card in in_year:
        results = metric_results(selected[card.id], catalogue)
        worst_pct, worst_no_licence = card_worst(results)
        row: dict[str, Any] = {
            "id": str(card.id),
            "name": card.name,
            "type": card.type,
            "alias": card.alias,
            "attributes": {
                k: v
                for k, v in (card.attributes or {}).items()
                if k not in hidden.get(card.type, ())
            },
            "status": None if aggregate else card_status(results),
            "worst_pct": worst_pct,
            "worst_no_licence": worst_no_licence,
            "confirmed": data[card.id][fy][1],
            "by_metric": _by_metric(results),
        }
        if card.id in logos:
            row["logo_updated_at"] = logos[card.id]
        if card.id in groups:
            row["group"] = groups[card.id]
        rows.append(row)

    # The scope's cells whatever the selection: what the frontend's selects may offer.
    pairs = {(m, k) for c in scoped for m, cells in data[c.id][fy][0].items() for k in cells}
    in_scope = {m for m, _ in pairs}
    return {
        "fiscal_year": fy,
        "current_fiscal_year": cur,
        "fiscal_year_start": sm,
        "years": list(yearly_rows.window_years(cur)),
        "aggregate": aggregate,
        "rows": rows,
        "metrics_in_year": catalogue.ordered_metrics(in_scope),
        "types_in_year": sorted(f"{m}:{k}" for m, k in pairs),
    }
