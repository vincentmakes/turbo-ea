"""Forget the KPI history of Initiative cost tiles counted the old way.

From 2.203.2 a dashboard Sum or Average of an Initiative's ``costBudget`` /
``costActual`` counts only the current fiscal year's PPM lines, where it used
to read the all-years total the PPM cost sync stores on the card (discussion
#1362). The daily ``dashboard_kpi_snapshots`` captured before the release hold
the old figure, so a tile's trend would show a drop on the day of the upgrade
that never happened. This migration deletes those rows; the tile shows no
trend until the daily capture has a comparison point again.

A row is deleted when its ``metric_key`` (the canonical query string
``dashboard_query.metric_key`` builds) names ``card_type=Initiative``,
``metric`` ``sum`` or ``avg`` and ``metric_field`` ``costBudget`` /
``costActual`` — and only when PPM lines of the matching kind exist at all
(budget lines for ``costBudget``, cost lines for ``costActual``): without them
the figure did not change, so an install that never used PPM keeps its
history. Keys are read and parsed in Python, rows deleted with table
constructs. ``kpi_snapshots`` (the preset KPIs) holds no cost figure and is
not touched. The downgrade cannot bring deleted history back and does nothing.

Revision ID: 172
Revises: 171
"""

from __future__ import annotations

import urllib.parse
from collections.abc import Iterable, Sequence
from typing import Union

import sqlalchemy as sa

from alembic import op

revision: str = "172"
down_revision: Union[str, None] = "171"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

INITIATIVE = "Initiative"
BUDGET_FIELD = "costBudget"
ACTUAL_FIELD = "costActual"
SUMMED = frozenset({"sum", "avg"})

snapshots = sa.table(
    "dashboard_kpi_snapshots",
    sa.column("metric_key", sa.String),
)
budget_lines = sa.table("ppm_budget_lines", sa.column("id"))
cost_lines = sa.table("ppm_cost_lines", sa.column("id"))


def _single(fields: dict[str, list[str]], name: str) -> str | None:
    values = fields.get(name)
    return values[0] if values and len(values) == 1 else None


def stale_keys(keys: Iterable[str], *, has_budget_lines: bool, has_cost_lines: bool) -> list[str]:
    """The keys among ``keys`` whose history counted the old way, in order.

    ``has_budget_lines`` / ``has_cost_lines`` say whether any PPM line of that
    kind exists: a field whose lines do not exist kept its figure.
    """
    fields_reset = {BUDGET_FIELD: has_budget_lines, ACTUAL_FIELD: has_cost_lines}
    stale: list[str] = []
    for metric_key in keys:
        fields = urllib.parse.parse_qs(metric_key, keep_blank_values=True)
        field = _single(fields, "metric_field")
        if (
            _single(fields, "card_type") == INITIATIVE
            and _single(fields, "metric") in SUMMED
            and field is not None
            and fields_reset.get(field, False)
        ):
            stale.append(metric_key)
    return stale


def reset_snapshots(conn: sa.Connection) -> None:
    """Delete the stale rows on ``conn``; what ``upgrade()`` runs."""
    has_budget = conn.execute(sa.select(budget_lines.c.id).limit(1)).first() is not None
    has_cost = conn.execute(sa.select(cost_lines.c.id).limit(1)).first() is not None
    if not (has_budget or has_cost):
        return
    keys = conn.execute(sa.select(snapshots.c.metric_key).distinct()).scalars().all()
    stale = stale_keys(keys, has_budget_lines=has_budget, has_cost_lines=has_cost)
    if stale:
        conn.execute(sa.delete(snapshots).where(snapshots.c.metric_key.in_(stale)))


def upgrade() -> None:
    reset_snapshots(op.get_bind())


def downgrade() -> None:
    # Deleted history cannot be rebuilt; the next daily capture starts it again.
    pass
