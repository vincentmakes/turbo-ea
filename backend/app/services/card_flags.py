"""Cross-cutting card health flags: "orphaned" and "stale".

Both started life inline in the data-quality dashboard. They are now also
inventory filters, and the Data Quality report deep-links a KPI tile straight
into the matching inventory view — so if the two ever disagreed, clicking a
count of 37 would land you on a grid showing something else. One definition,
used by every caller.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.models.card import Card
from app.models.relation import Relation

#: A card nobody has touched in this many days reads as stale.
STALE_AFTER_DAYS = 90


def stale_cutoff() -> datetime:
    """Cards last updated before this instant are stale."""
    return datetime.now(timezone.utc) - timedelta(days=STALE_AFTER_DAYS)


def stale_condition():
    """SQLAlchemy condition selecting stale cards."""
    return Card.updated_at < stale_cutoff()


def orphaned_condition():
    """SQLAlchemy condition selecting cards with no relation in either
    direction. Not "no outgoing relation" — an Application nothing points at
    but which points at a capability is connected, and reporting it as
    orphaned would send people looking for a problem that isn't there."""
    connected = select(Relation.source_id).union(select(Relation.target_id))
    return Card.id.not_in(connected)
