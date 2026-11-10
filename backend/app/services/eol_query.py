"""End-of-life status as a card-query condition (``where.eol_status``).

A card's EOL status is never stored: ``eol_service.resolve_eol_statuses``
computes it per card from cycle data fetched live from endoflife.date (or from
the organisation's own ``eol_custom_cycles``), while a card query compiles to
pure SQL and runs at the start card, at every hop and in the OData feed. The
bridge is that a *linked* card's status depends on its ``(eol_product,
eol_cycle)`` pair alone, so the condition is evaluated per pair, then filtered
in SQL:

1. ``eol_pairs_for_types`` reads the distinct pairs present on the cards of
   the card types an ``eol_status`` condition asks a status of (archived cards
   included: a pair's status does not depend on the card's), and the caller
   loads the custom products' cycles (``load_custom_cycles``) — both database
   reads, done **before** the route hands its connection back. A condition
   asking only ``__empty__`` is pure SQL and needs neither.
2. ``load_eol_pair_statuses`` fetches the upstream cycles
   (``fetch_cycles_for_products``, 30-minute cache, stale on failure) with no
   session held, and classifies every pair exactly as the resolver does
   (``eol_pair_statuses``: ``find_cycle`` + ``eol_status``, a missing cycle
   is ``unknown``).
3. ``eol_status_condition`` compiles ``(product, cycle) IN (pairs whose
   status was asked for)`` — two array parameters however many pairs match —
   for linked cards, the SQL twin of
   ``manual_eol_status`` (``manual_eol_status_sql``) for cards with only a
   manual end of life, and the coverage bucket ``missing`` for ``__empty__``
   ("nothing recorded"), so the condition means exactly what the inventory's
   End of life column shows.

Nothing here commits a session: the route owns the transaction and commits
between step 1 and step 2.
"""

from __future__ import annotations

from collections.abc import Collection, Iterable, Mapping, Sequence
from datetime import date, datetime, timedelta, timezone
from typing import TYPE_CHECKING, Any

from sqlalchemy import Text, and_, case, cast, false, func, literal, or_, select, tuple_
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.services import eol_service
from app.services.card_flags import EOL_CYCLE_KEY, EOL_PRODUCT_KEY, eol_bucket_condition
from app.services.eol_custom_service import is_custom_product
from app.services.portal_card_filters import EMPTY_KEY

if TYPE_CHECKING:
    from app.services.card_query import ResolvedNode

#: The statuses a card with EOL data resolves to (``eol_service.eol_status``).
EOL_STATUSES: tuple[str, ...] = ("eol", "approaching", "supported", "unknown")
#: Every value ``where.eol_status`` takes: a status, or ``__empty__`` for a
#: card with neither an EOL link nor a manual end of life.
EOL_STATUS_VALUES: tuple[str, ...] = (*EOL_STATUSES, EMPTY_KEY)

#: An EOL link as cards store it: ``(attributes.eol_product, attributes.eol_cycle)``.
EolPair = tuple[str, str]

#: A manual End of Life / phase-out date ``eol_service._parse`` reads: exactly
#: ``YYYY-MM-DD``. Compared as text behind this guard, never cast to ``date``,
#: so one malformed card cannot fail the whole query.
_SQL_EOL_DATE = r"^[0-9]{4}-[0-9]{2}-[0-9]{2}$"

#: The whole-``lifecycle`` JSON values Python reads as falsy (``if not
#: lifecycle``): ``manual_eol_status`` answers ``unknown`` for them.
_EMPTY_LIFECYCLES = ("null", "{}", "[]", '""', "0", "false")


def asks_eol_status(values: Iterable[str]) -> bool:
    """Whether ``values`` (a node's ``eol_status``) asks for a status that
    needs the links' pair statuses — anything but ``__empty__`` alone, which
    is pure SQL (the coverage bucket ``missing``)."""
    return not set(EOL_STATUSES).isdisjoint(values)


def _eol_nodes(groups: Iterable[Iterable[ResolvedNode]]) -> list[ResolvedNode]:
    """Every node — start cards and hops, on every line — that carries an
    ``eol_status`` condition (``ResolvedNode.eol_status``)."""
    out: list[ResolvedNode] = []
    pending = [node for group in groups for node in group]
    while pending:
        node = pending.pop()
        if node.eol_status:
            out.append(node)
        pending.extend(hop.node for hop in node.hops)
    return out


def has_eol_condition(groups: Iterable[Iterable[ResolvedNode]]) -> bool:
    """Whether any node of ``groups`` carries an ``eol_status`` condition,
    ``__empty__`` alone included: what ``eol.view`` gates."""
    return bool(_eol_nodes(groups))


def eol_condition_types(groups: Iterable[Iterable[ResolvedNode]]) -> set[str]:
    """The card types of every node whose ``eol_status`` condition asks a
    status (``asks_eol_status``): the types whose links' pairs are read. A
    node asking only ``__empty__`` adds none."""
    return {node.type for node in _eol_nodes(groups) if asks_eol_status(node.eol_status)}


async def eol_pairs_for_types(db: AsyncSession, types: Collection[str]) -> set[EolPair]:
    """The distinct ``(eol_product, eol_cycle)`` links on the cards of
    ``types`` — one query, none for no type. Every card status counts: the
    query's start card may be archived (the inventory's "Show archived", the
    OData feed's ``showArchived``), and a pair's status does not depend on the
    status of the card carrying it.

    Deliberately not narrowed by the caller's read scope: a product / cycle
    value is not card data the condition reveals. It only decides which
    upstream products are fetched, and the condition itself is compiled
    under the query's own scope rules, so a hidden card never matches."""
    if not types:
        return set()
    rows = await db.execute(
        select(Card.attributes[EOL_PRODUCT_KEY].astext, Card.attributes[EOL_CYCLE_KEY].astext)
        .distinct()
        .where(eol_bucket_condition("linked", eol_types=sorted(types)))
    )
    return {(product, cycle) for product, cycle in rows.all()}


def eol_pair_statuses(
    pairs: Iterable[EolPair],
    product_cycles: Mapping[str, list[dict]],
    custom_cycles: Mapping[str, list[dict]],
) -> dict[EolPair, str]:
    """Every pair's status, classified as ``resolve_eol_statuses`` classifies
    a linked card: its cycle from the custom products (``custom:<key>``) or
    the upstream ones, ``eol_status`` on it, ``unknown`` when the product or
    the cycle is missing. Pure."""
    out: dict[EolPair, str] = {}
    for product, cycle_key in pairs:
        source = custom_cycles if is_custom_product(product) else product_cycles
        cycle = eol_service.find_cycle(source.get(product, []), cycle_key)
        out[(product, cycle_key)] = (
            eol_service.eol_status(cycle.get("eol"), cycle.get("support")) if cycle else "unknown"
        )
    return out


async def load_eol_pair_statuses(
    pairs: Collection[EolPair], custom_cycles: Mapping[str, list[dict]]
) -> dict[EolPair, str]:
    """``eol_pair_statuses`` with the upstream cycles fetched from
    endoflife.date. Outbound HTTP: the caller must hold no database session
    across it, which is why ``custom_cycles`` (``load_custom_cycles``) is
    read beforehand and handed in."""
    product_cycles = await eol_service.fetch_cycles_for_products({p for p, _ in pairs})
    return eol_pair_statuses(pairs, product_cycles, custom_cycles)


def manual_eol_status_sql(card: Any = Card, *, today: date | None = None) -> Any:
    """``eol_service.manual_eol_status`` as a SQL expression over
    ``card.lifecycle`` (``Card`` or an alias): ``eol``, ``approaching``,
    ``supported`` or ``unknown``.

    Dates are compared as **text** against ``today`` (Python's UTC clock, the
    Python twin's) behind an exact ``YYYY-MM-DD`` guard. Known divergence: an
    impossible calendar date (``2025-02-30``) or one without zero padding
    (``2025-1-5``) reads differently; the UI only writes zero-padded dates.
    """
    day = today or datetime.now(timezone.utc).date()
    today_text = day.isoformat()
    horizon = (day + timedelta(days=eol_service.APPROACHING_DAYS)).isoformat()
    end_of_life = card.lifecycle["endOfLife"].astext
    phase_out = card.lifecycle["phaseOut"].astext
    eol_dated = end_of_life.regexp_match(_SQL_EOL_DATE)
    # Bound as text and cast, so each literal is parsed as JSON.
    empty = [cast(literal(value), JSONB) for value in _EMPTY_LIFECYCLES]
    return case(
        (or_(card.lifecycle.is_(None), card.lifecycle.in_(empty)), "unknown"),
        (and_(eol_dated, end_of_life <= today_text), "eol"),
        (and_(eol_dated, end_of_life <= horizon), "approaching"),
        (and_(phase_out.regexp_match(_SQL_EOL_DATE), phase_out <= today_text), "approaching"),
        else_="supported",
    )


def _pair_in(card: Any, pairs: Sequence[EolPair]) -> Any:
    """``card``'s link is one of ``pairs``; a false clause for none (never an
    empty ``IN ()``).

    The pairs travel as two ``text[]`` parameters unnested side by side, so
    the statement's bind count does not grow with them (asyncpg caps a
    statement at 32767, and ``GET /cards`` runs the clauses twice)."""
    if not pairs:
        return false()
    products = literal([product for product, _ in pairs], ARRAY(Text))
    cycles = literal([cycle for _, cycle in pairs], ARRAY(Text))
    listed = func.unnest(products, cycles).table_valued("product", "cycle").render_derived()
    link = tuple_(card.attributes[EOL_PRODUCT_KEY].astext, card.attributes[EOL_CYCLE_KEY].astext)
    return link.in_(select(listed.c.product, listed.c.cycle))


def eol_status_condition(
    card: Any,
    values: Collection[str],
    pair_statuses: Mapping[EolPair, str],
    *,
    eol_types: Sequence[str],
    today: date | None = None,
) -> Any:
    """``card``'s EOL status is one of ``values`` (``EOL_STATUS_VALUES``).

    The OR of: a linked card whose pair's status (``pair_statuses``) is
    asked for; a card with only a manual end of life whose
    ``manual_eol_status_sql`` is; and, for ``__empty__``, a card with neither
    (the coverage bucket ``missing``). A link wins over a manual date, as in
    ``resolve_eol_statuses``; a link whose pair is absent from
    ``pair_statuses`` matches no status — ``eol_pairs_for_types`` reads the
    pairs of every card of the types, archived ones included, so none is
    absent there. ``pair_statuses`` is not read when ``values`` asks only
    ``__empty__``. ``eol_types`` narrows every branch to the card types that
    track End of Life."""
    statuses = sorted(set(values) & set(EOL_STATUSES))
    options: list[Any] = []
    if statuses:
        pairs = sorted(pair for pair, status in pair_statuses.items() if status in statuses)
        options.append(
            and_(
                eol_bucket_condition("linked", eol_types=eol_types, card=card),
                _pair_in(card, pairs),
            )
        )
        options.append(
            and_(
                eol_bucket_condition("manual", eol_types=eol_types, card=card),
                manual_eol_status_sql(card, today=today).in_(statuses),
            )
        )
    if EMPTY_KEY in values:
        options.append(eol_bucket_condition("missing", eol_types=eol_types, card=card))
    return or_(*options)
