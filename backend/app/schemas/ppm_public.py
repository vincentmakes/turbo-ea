"""Account-less response shapes for the public PPM portfolio portal.

These are deliberately **separate models**, not a trimmed view of the internal
``app.schemas.ppm`` ones. A subtractive filter over the internal shape fails
open: the next field added to ``PpmGanttItem`` would publish itself to every
anonymous visitor. Listing the public fields explicitly means a new internal
field is invisible here until someone deliberately adds it.

Same reasoning, and the same shape, as ``_user_response`` vs
``_user_response_lite`` in ``app/api/v1/users.py``.
"""

from __future__ import annotations

from datetime import date

from pydantic import BaseModel


class PpmPublicPerson(BaseModel):
    """A named person. Carries **no** user id and never an email address."""

    display_name: str
    role_key: str | None = None


class PpmPublicReport(BaseModel):
    """The latest status report, as shown in the board's hover overview.

    ``reporter`` is populated only when the portal enables people, and the three
    narrative fields only when it enables narrative — the viewer's existing
    truthiness guards then render the reduced popover with no extra branching.
    """

    report_date: date
    schedule_health: str
    cost_health: str
    scope_health: str
    reporter: PpmPublicPerson | None = None
    summary: str | None = None
    accomplishments: str | None = None
    next_steps: str | None = None


class PpmPublicItem(BaseModel):
    """One board row.

    ``id`` is the initiative's real card UUID — a portfolio portal links its rows
    to ``/ppm/{id}`` behind the login wall, so it is exposed by design. Every
    other identifier is withheld: ``group_id`` is an opaque per-response token,
    and the parent, report, reporter and stakeholder ids are not emitted at all.
    """

    id: str
    name: str
    subtype: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    group_id: str | None = None
    group_name: str | None = None
    capex_planned: float | None = None
    capex_actual: float | None = None
    opex_planned: float | None = None
    opex_actual: float | None = None
    stakeholders: list[PpmPublicPerson] = []
    latest_report: PpmPublicReport | None = None


class PpmPublicDashboard(BaseModel):
    """The three KPI values the board actually renders.

    The internal dashboard also carries ``by_subtype``, ``by_status``,
    ``health_cost``, ``health_scope`` and ``total_actual``; none of them is drawn
    on the board, so none of them is published.
    """

    total_initiatives: int
    health_schedule: dict[str, int] = {}
    total_budget: float | None = None


class PpmPublicGroupOption(BaseModel):
    """A card type the board can group by.

    Ships the metamodel entity (``label`` + ``translations``) rather than a
    resolved string: label resolution lives on the client, in the shared
    resolvers, so there is exactly one implementation of it and no second place
    for the key-as-fallback bug to reappear.
    """

    type_key: str
    label: str
    translations: dict = {}
    icon: str | None = None
    color: str | None = None


class PpmPublicPortfolio(BaseModel):
    """Everything the public board needs, in one round-trip."""

    group_by: str | None = None
    group_options: list[PpmPublicGroupOption] = []
    dashboard: PpmPublicDashboard
    items: list[PpmPublicItem] = []
