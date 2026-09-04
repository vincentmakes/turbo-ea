"""Cross-cutting card health flags: "orphaned" and "stale".

Both started life inline in the data-quality dashboard. They are now also
inventory filters, and the Data Quality report deep-links a KPI tile straight
into the matching inventory view — so if the two ever disagreed, clicking a
count of 37 would land you on a grid showing something else. One definition,
used by every caller.

``STALE_AFTER_DAYS`` is the product-wide "this has gone cold" threshold. A
survey creator picks their own window instead (30 days, 6 months, …), which
``staleness_cutoff`` resolves — same notion of "last updated", same column,
just a caller-supplied length.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import and_, not_, or_, select

from app.models.card import Card
from app.models.relation import Relation
from app.services.recurrence import add_months

#: A card nobody has touched in this many days reads as stale.
STALE_AFTER_DAYS = 90

#: Units a caller-supplied staleness window may be expressed in. Days and
#: months only: weeks add nothing over days, and years are just months.
STALENESS_UNITS = ("days", "months")

#: Upper bound per unit — ten years either way. Not taste: ``timedelta`` and
#: ``date`` both blow up well before infinity (``timedelta(days=10**9)`` raises
#: ``OverflowError``, ``add_months`` past year 9999 raises ``ValueError``), and
#: an unbounded value out of free-form JSONB would turn a fat-fingered 99999
#: into a 500 on the survey preview.
MAX_STALENESS_BY_UNIT: dict[str, int] = {"days": 3650, "months": 120}


def stale_cutoff() -> datetime:
    """Cards last updated before this instant are stale."""
    return datetime.now(timezone.utc) - timedelta(days=STALE_AFTER_DAYS)


def stale_condition():
    """SQLAlchemy condition selecting stale cards."""
    return Card.updated_at < stale_cutoff()


def staleness_cutoff(value, unit, *, now: datetime | None = None) -> datetime | None:
    """Resolve a relative "not updated for N days/months" window to an absolute
    instant, or ``None`` when the window is absent or malformed.

    ``None`` means "no staleness filter" to every caller — never "match
    nothing". A survey whose stored window is garbage must still resolve the
    targets its other filters describe rather than silently going out to
    nobody, so every rejection path here is a no-op, not an error.

    Months are calendar months via :func:`~app.services.recurrence.add_months`
    (day clamped, so Mar 31 − 1 month is Feb 28), not a 30-day approximation:
    "6 months" has to mean the same day-of-month six months back, or the
    cut-off date the builder previews would not be the one the query uses.

    The result is **midnight UTC**, not "this instant N days ago". The builder
    promises the admin a date ("only cards last modified before 26 Jul"), and a
    cutoff carrying the current time of day would make that date a lie for the
    part of it already elapsed — and would answer the same preview differently
    depending on when in the day it ran. ``stale_cutoff`` above deliberately
    keeps instant semantics: it backs a fixed flag with no date shown anywhere,
    and moving it would shift the inventory filter and the data-quality tile.
    """
    # ``bool`` is a subclass of ``int``: ``True`` would otherwise read as 1 day.
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    if unit not in STALENESS_UNITS:
        return None
    if value < 1 or value > MAX_STALENESS_BY_UNIT[unit]:
        return None

    moment = now or datetime.now(timezone.utc)
    if moment.tzinfo is None:
        # ``Card.updated_at`` is timezone-aware, so the comparison operand
        # must be too or asyncpg rejects the query outright.
        moment = moment.replace(tzinfo=timezone.utc)

    if unit == "days":
        cut = moment.date() - timedelta(days=value)
    else:
        cut = add_months(moment.date(), -value)
    return datetime(cut.year, cut.month, cut.day, tzinfo=timezone.utc)


def not_updated_condition(filters: dict | None):
    """SQLAlchemy condition for a survey's ``not_updated_for`` target filter,
    or ``None`` when the filter is absent or malformed.

    Shape: ``{"not_updated_for": {"value": 6, "unit": "months"}}``. The value
    lives in free-form JSONB that predates this key, so nothing upstream
    guarantees its shape — validate here rather than at the call site.
    """
    if not isinstance(filters, dict):
        return None
    window = filters.get("not_updated_for")
    if not isinstance(window, dict):
        return None
    cutoff = staleness_cutoff(window.get("value"), window.get("unit"))
    if cutoff is None:
        return None
    return Card.updated_at < cutoff


def orphaned_condition():
    """SQLAlchemy condition selecting cards with no relation in either
    direction. Not "no outgoing relation" — an Application nothing points at
    but which points at a capability is connected, and reporting it as
    orphaned would send people looking for a problem that isn't there."""
    connected = select(Relation.source_id).union(select(Relation.target_id))
    return Card.id.not_in(connected)


#: The card types that can carry End-of-Life information. Mirrors the
#: hard-coded lists the EOL surfaces have always used (``/eol/mass-search``,
#: the card-detail EOL section, the create dialog) — EOL is not a metamodel
#: concept, so there is no data-driven way to derive it.
EOL_TYPES = ("Application", "ITComponent")

#: Where the two halves of an endoflife.date link live on a card. They are
#: free-form attribute keys, not ``fields_schema`` fields.
EOL_PRODUCT_KEY = "eol_product"
EOL_CYCLE_KEY = "eol_cycle"


def has_eol_link(attributes: dict | None) -> bool:
    """Whether a card is linked to an endoflife.date product cycle."""
    attrs = attributes or {}
    return bool(attrs.get(EOL_PRODUCT_KEY)) and bool(attrs.get(EOL_CYCLE_KEY))


def has_manual_eol(lifecycle: dict | None) -> bool:
    """Whether a card carries a hand-entered End-of-Life date.

    This is the *company's* decommission date rather than the vendor's, and
    the EOL report has always accepted it as a source in its own right — so
    anything asking "is this card covered?" has to accept it too.
    """
    return bool((lifecycle or {}).get("endOfLife"))


def has_eol_coverage(attributes: dict | None, lifecycle: dict | None) -> bool:
    """Whether anything at all is known about a card's end of life."""
    return has_eol_link(attributes) or has_manual_eol(lifecycle)


def eol_missing_condition():
    """SQLAlchemy condition selecting EOL-eligible cards with no EOL data.

    "Missing" is the negation of :func:`has_eol_coverage`: **neither** an
    endoflife.date link **nor** a manual End-of-Life date. Keeping the two in
    one module is the point — the inventory filter, the Data Quality tile and
    the EOL report all count the same cards, so a user who clicks a count of
    37 lands on a list of 37 (the lesson `orphaned`/`stale` above encode).

    Cards of any other type are excluded rather than counted as missing: a
    Business Capability has no end of life to record, so reporting one as
    lacking it would be noise nobody can act on.
    """
    linked = and_(
        Card.attributes[EOL_PRODUCT_KEY].astext.isnot(None),
        Card.attributes[EOL_PRODUCT_KEY].astext != "",
        Card.attributes[EOL_CYCLE_KEY].astext.isnot(None),
        Card.attributes[EOL_CYCLE_KEY].astext != "",
    )
    manual = and_(
        Card.lifecycle["endOfLife"].astext.isnot(None),
        Card.lifecycle["endOfLife"].astext != "",
    )
    return and_(Card.type.in_(EOL_TYPES), not_(or_(linked, manual)))
