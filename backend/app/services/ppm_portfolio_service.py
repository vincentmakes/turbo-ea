"""Shared builder for the PPM portfolio board.

Both the authenticated ``/reports/ppm/*`` routes and the account-less
``/web-portals/public/{slug}/ppm/portfolio`` endpoint are rendered from the very
same board component, so they are built here rather than in either route module.
Keeping one builder is what stops the two paths drifting — a field added for the
authenticated page can never quietly appear on the public one, because the public
shape is produced by an explicit, opt-in projection (``to_public_portfolio``)
rather than by subtracting fields from the internal one.

Nothing in this module knows about authentication. Permission checks stay in the
route layer; the public endpoint's redaction is expressed as data (``PpmPortalConfig``).
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from dataclasses import dataclass
from typing import Sequence

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.card import Card
from app.models.card_type import CardType
from app.models.ppm_cost_line import PpmBudgetLine, PpmCostLine
from app.models.ppm_status_report import PpmStatusReport
from app.models.relation import Relation
from app.models.relation_type import RelationType
from app.models.stakeholder import Stakeholder
from app.models.tag import CardTag
from app.models.user import User
from app.schemas.ppm import (
    PpmGanttItem,
    PpmGanttStakeholder,
    PpmGroupOption,
    PpmStatusReportOut,
    ReporterOut,
)
from app.schemas.ppm_public import (
    PpmPublicDashboard,
    PpmPublicGroupOption,
    PpmPublicItem,
    PpmPublicPerson,
    PpmPublicPortfolio,
    PpmPublicReport,
)

INITIATIVE_TYPE = "Initiative"

#: The only two stakeholder roles the portfolio board renders (the "PM" column
#: falls back from the first to the second). The public projection is narrowed to
#: these so publishing a portal never exposes an initiative's full roster.
BOARD_ROLE_KEYS = ("itProjectManager", "responsible")


# ── Scope ───────────────────────────────────────────────────────────────


@dataclass(frozen=True)
class PortfolioScope:
    """Which initiatives are in scope.

    The default (all fields ``None``) is every ACTIVE Initiative — what the
    authenticated portfolio page has always shown. A web portal narrows it with
    the same preset filters every other portal uses.
    """

    subtypes: tuple[str, ...] | None = None
    tag_ids: tuple[uuid.UUID, ...] | None = None
    approval_statuses: tuple[str, ...] | None = None

    @classmethod
    def from_portal_filters(cls, filters: dict | None) -> "PortfolioScope":
        """Build a scope from a ``WebPortal.filters`` blob.

        Malformed values are ignored rather than raised — this feeds a public
        endpoint, and a bad preset must never surface as a 500.
        """
        f = filters or {}
        if not isinstance(f, dict):
            return cls()

        def _strs(key: str) -> tuple[str, ...] | None:
            raw = f.get(key)
            if not isinstance(raw, list) or not raw:
                return None
            vals = tuple(str(v) for v in raw if isinstance(v, (str, int)))
            return vals or None

        tag_ids: tuple[uuid.UUID, ...] | None = None
        raw_tags = f.get("tag_ids")
        if isinstance(raw_tags, list) and raw_tags:
            parsed: list[uuid.UUID] = []
            for tid in raw_tags:
                try:
                    parsed.append(uuid.UUID(str(tid)))
                except (ValueError, AttributeError, TypeError):
                    continue
            tag_ids = tuple(parsed) or None

        return cls(
            subtypes=_strs("subtypes"),
            tag_ids=tag_ids,
            approval_statuses=_strs("approval_statuses"),
        )


async def load_initiatives(db: AsyncSession, scope: PortfolioScope) -> list[Card]:
    """Every ACTIVE Initiative card matching ``scope``."""
    q = select(Card).where(Card.type == INITIATIVE_TYPE, Card.status == "ACTIVE")
    if scope.subtypes:
        q = q.where(Card.subtype.in_(scope.subtypes))
    if scope.approval_statuses:
        q = q.where(Card.approval_status.in_(scope.approval_statuses))
    if scope.tag_ids:
        tagged = select(CardTag.card_id).where(CardTag.tag_id.in_(scope.tag_ids))
        q = q.where(Card.id.in_(tagged))
    result = await db.execute(q)
    return list(result.scalars().all())


# ── Batch loaders ───────────────────────────────────────────────────────


async def latest_reports(
    db: AsyncSession, initiative_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, PpmStatusReport]:
    """The most recent status report per initiative.

    Note: ties on ``report_date`` within one initiative are resolved arbitrarily
    (the last row wins) — pre-existing behaviour, preserved deliberately.
    """
    if not initiative_ids:
        return {}
    sub = (
        select(
            PpmStatusReport.initiative_id,
            func.max(PpmStatusReport.report_date).label("max_date"),
        )
        .where(PpmStatusReport.initiative_id.in_(initiative_ids))
        .group_by(PpmStatusReport.initiative_id)
        .subquery()
    )
    result = await db.execute(
        select(PpmStatusReport).join(
            sub,
            (PpmStatusReport.initiative_id == sub.c.initiative_id)
            & (PpmStatusReport.report_date == sub.c.max_date),
        )
    )
    return {r.initiative_id: r for r in result.scalars().all()}


async def load_reporters(
    db: AsyncSession, reporter_ids: Sequence[uuid.UUID | None]
) -> dict[uuid.UUID, User]:
    """Batch-load report authors.

    Replaces a per-report ``SELECT User`` that ran inside the item loop.

    ``reporter_id`` is a nullable column — a status report can outlive the user
    who wrote it — so the parameter admits ``None`` and the ids are filtered
    here rather than at each call site.
    """
    ids = {rid for rid in reporter_ids if rid}
    if not ids:
        return {}
    result = await db.execute(select(User).where(User.id.in_(ids)))
    return {u.id: u for u in result.scalars().all()}


async def load_stakeholders(
    db: AsyncSession,
    initiative_ids: Sequence[uuid.UUID],
    *,
    role_keys: Sequence[str] | None = None,
) -> dict[uuid.UUID, list[tuple[Stakeholder, User]]]:
    """Batch-load stakeholders (with their user) per initiative.

    Replaces a per-card ``Stakeholder ⋈ User`` join that ran inside the item loop.
    The inner join is deliberate: a stakeholder row whose user has been deleted
    was already dropped before this extraction, and an outer join here would
    change the authenticated payload.
    """
    if not initiative_ids:
        return {}
    q = (
        select(Stakeholder, User)
        .join(User, Stakeholder.user_id == User.id)
        .where(Stakeholder.card_id.in_(initiative_ids))
    )
    if role_keys:
        q = q.where(Stakeholder.role.in_(role_keys))
    result = await db.execute(q)
    out: dict[uuid.UUID, list[tuple[Stakeholder, User]]] = defaultdict(list)
    for sh, u in result.all():
        out[sh.card_id].append((sh, u))
    return out


async def build_cost_aggregates(
    db: AsyncSession, initiative_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, dict[str, float]]:
    """Per-initiative capex/opex planned + actual, from the PPM cost tables."""
    if not initiative_ids:
        return {}

    def _blank() -> dict[str, float]:
        return {"capex_planned": 0, "capex_actual": 0, "opex_planned": 0, "opex_actual": 0}

    agg: dict[uuid.UUID, dict[str, float]] = {}

    cost_result = await db.execute(
        select(
            PpmCostLine.initiative_id,
            PpmCostLine.category,
            func.coalesce(func.sum(PpmCostLine.actual), 0).label("actual"),
        )
        .where(PpmCostLine.initiative_id.in_(initiative_ids))
        .group_by(PpmCostLine.initiative_id, PpmCostLine.category)
    )
    for row in cost_result.all():
        agg.setdefault(row[0], _blank())[f"{row[1]}_actual"] = float(row[2])

    budget_result = await db.execute(
        select(
            PpmBudgetLine.initiative_id,
            PpmBudgetLine.category,
            func.coalesce(func.sum(PpmBudgetLine.amount), 0).label("amount"),
        )
        .where(PpmBudgetLine.initiative_id.in_(initiative_ids))
        .group_by(PpmBudgetLine.initiative_id, PpmBudgetLine.category)
    )
    for row in budget_result.all():
        agg.setdefault(row[0], _blank())[f"{row[1]}_planned"] = float(row[2])

    return agg


async def sum_budget_actual(
    db: AsyncSession, initiative_ids: Sequence[uuid.UUID]
) -> tuple[float, float]:
    """Portfolio-wide (planned, actual) totals across the PPM cost tables."""
    if not initiative_ids:
        return 0.0, 0.0
    budget_sum = await db.execute(
        select(func.coalesce(func.sum(PpmBudgetLine.amount), 0)).where(
            PpmBudgetLine.initiative_id.in_(initiative_ids)
        )
    )
    actual_sum = await db.execute(
        select(func.coalesce(func.sum(PpmCostLine.actual), 0)).where(
            PpmCostLine.initiative_id.in_(initiative_ids)
        )
    )
    return float(budget_sum.scalar() or 0), float(actual_sum.scalar() or 0)


# ── Grouping ────────────────────────────────────────────────────────────


async def build_group_map(
    db: AsyncSession, initiative_ids: Sequence[uuid.UUID], group_by: str
) -> dict[uuid.UUID, tuple[uuid.UUID, str]]:
    """Map initiative id → (group card id, group card name)."""
    if not initiative_ids:
        return {}
    rt_result = await db.execute(
        select(RelationType).where(
            RelationType.is_hidden.is_(False),
            or_(
                (RelationType.source_type_key == INITIATIVE_TYPE)
                & (RelationType.target_type_key == group_by),
                (RelationType.source_type_key == group_by)
                & (RelationType.target_type_key == INITIATIVE_TYPE),
            ),
        )
    )
    rel_types = rt_result.scalars().all()
    if not rel_types:
        return {}

    # Several relation types may connect Initiative to the grouping type (the
    # metamodel allows any number per ordered pair). An initiative is placed in the
    # first group it is related through, so fix that order — by sort_order then key —
    # rather than letting it fall out of row order, which is not stable.
    rel_types = sorted(rel_types, key=lambda rt: (rt.sort_order or 0, rt.key))
    rt_priority = {rt.key: i for i, rt in enumerate(rel_types)}
    rt_keys = [rt.key for rt in rel_types]
    rel_result = await db.execute(
        select(Relation).where(
            Relation.type.in_(rt_keys),
            or_(
                Relation.source_id.in_(initiative_ids),
                Relation.target_id.in_(initiative_ids),
            ),
        )
    )
    relations = sorted(
        rel_result.scalars().all(), key=lambda rel: rt_priority.get(rel.type, len(rt_priority))
    )

    source_is_initiative = {rt.key: rt.source_type_key == INITIATIVE_TYPE for rt in rel_types}
    init_to_group_id: dict[uuid.UUID, uuid.UUID] = {}
    group_card_ids: set[uuid.UUID] = set()

    for rel in relations:
        if source_is_initiative.get(rel.type, True):
            init_id, group_id = rel.source_id, rel.target_id
        else:
            init_id, group_id = rel.target_id, rel.source_id
        if init_id not in init_to_group_id:
            init_to_group_id[init_id] = group_id
            group_card_ids.add(group_id)

    if not group_card_ids:
        return {}
    gc_result = await db.execute(select(Card.id, Card.name).where(Card.id.in_(group_card_ids)))
    group_names = {row[0]: row[1] for row in gc_result.all()}

    return {
        init_id: (gid, group_names.get(gid, "Unknown")) for init_id, gid in init_to_group_id.items()
    }


async def build_group_options(db: AsyncSession) -> list[PpmGroupOption]:
    """Card types Initiative can be grouped by, carrying their metamodel entity.

    ``label`` and ``translations`` come from the ``CardType`` row so the client
    can resolve the display name with the shared label resolvers. Emitting the
    raw key as the label (the previous behaviour) leaked internal slugs into the
    grouping dropdown whenever the caller had no metamodel to look them up in.
    """
    result = await db.execute(
        select(RelationType).where(
            RelationType.is_hidden.is_(False),
            or_(
                RelationType.source_type_key == INITIATIVE_TYPE,
                RelationType.target_type_key == INITIATIVE_TYPE,
            ),
        )
    )
    rel_types = result.scalars().all()

    seen: set[str] = set()
    for rt in rel_types:
        other = rt.target_type_key if rt.source_type_key == INITIATIVE_TYPE else rt.source_type_key
        if other and other != INITIATIVE_TYPE:
            seen.add(other)
    if not seen:
        return []

    ct_result = await db.execute(select(CardType).where(CardType.key.in_(seen)))
    card_types = {ct.key: ct for ct in ct_result.scalars().all()}

    options = [
        PpmGroupOption(
            type_key=key,
            type_label=(card_types[key].label or key) if key in card_types else key,
            translations=(card_types[key].translations or {}) if key in card_types else {},
            icon=card_types[key].icon if key in card_types else None,
            color=card_types[key].color if key in card_types else None,
        )
        for key in seen
    ]
    return sorted(options, key=lambda o: o.type_label)


# ── Internal (authenticated) shapes ─────────────────────────────────────


async def build_gantt_items(
    db: AsyncSession,
    initiatives: Sequence[Card],
    latest: dict[uuid.UUID, PpmStatusReport],
    *,
    group_by: str | None = None,
    role_keys: Sequence[str] | None = None,
    allow_email_fallback: bool = True,
) -> list[PpmGanttItem]:
    """Build the full (unredacted) board rows. Used directly by the authed route.

    ``allow_email_fallback`` exists because a user with a blank display name is
    identified by their **email** on the authenticated board, and that collapse
    happens here — before any redaction downstream could tell a real name from an
    address. The public caller passes ``False``, so an unnamed user yields an
    empty name and is dropped by the projection rather than published by address.
    """
    init_ids = [c.id for c in initiatives]

    def _name(u: User) -> str:
        return (u.display_name or u.email) if allow_email_fallback else (u.display_name or "")

    group_map = await build_group_map(db, init_ids, group_by) if group_by else {}
    cost_agg = await build_cost_aggregates(db, init_ids)
    reporters = await load_reporters(db, [r.reporter_id for r in latest.values()])
    stakeholder_map = await load_stakeholders(db, init_ids, role_keys=role_keys)

    items: list[PpmGanttItem] = []
    for card in initiatives:
        attrs = card.attributes or {}
        report = latest.get(card.id)
        report_out = None
        if report:
            u = reporters.get(report.reporter_id) if report.reporter_id else None
            report_out = PpmStatusReportOut(
                id=str(report.id),
                initiative_id=str(report.initiative_id),
                reporter_id=str(report.reporter_id) if report.reporter_id else None,
                reporter=(ReporterOut(id=str(u.id), display_name=_name(u)) if u else None),
                report_date=report.report_date,
                schedule_health=report.schedule_health,
                cost_health=report.cost_health,
                scope_health=report.scope_health,
                summary=report.summary,
                accomplishments=report.accomplishments,
                next_steps=report.next_steps,
                created_at=report.created_at,
                updated_at=report.updated_at,
            )

        group_info = group_map.get(card.id)
        costs = cost_agg.get(card.id, {})

        items.append(
            PpmGanttItem(
                id=str(card.id),
                name=card.name,
                subtype=card.subtype,
                status=attrs.get("initiativeStatus"),
                parent_id=str(card.parent_id) if card.parent_id else None,
                start_date=attrs.get("startDate"),
                end_date=attrs.get("endDate"),
                cost_budget=float(attrs.get("costBudget") or 0) or None,
                cost_actual=float(attrs.get("costActual") or 0) or None,
                capex_planned=costs.get("capex_planned", 0),
                capex_actual=costs.get("capex_actual", 0),
                opex_planned=costs.get("opex_planned", 0),
                opex_actual=costs.get("opex_actual", 0),
                group_id=str(group_info[0]) if group_info else None,
                group_name=group_info[1] if group_info else None,
                latest_report=report_out,
                latest_report_id=str(report.id) if report else None,
                stakeholders=[
                    PpmGanttStakeholder(
                        user_id=str(sh.user_id),
                        display_name=_name(u),
                        role_key=sh.role,
                    )
                    for sh, u in stakeholder_map.get(card.id, [])
                ],
            )
        )
    return items


def build_dashboard(
    initiatives: Sequence[Card],
    latest: dict[uuid.UUID, PpmStatusReport],
    totals: tuple[float, float],
) -> dict:
    """Portfolio KPI rollup."""
    by_subtype: dict[str, int] = {}
    by_status: dict[str, int] = {}
    health_schedule = {"onTrack": 0, "atRisk": 0, "offTrack": 0, "noReport": 0}
    health_cost = {"onTrack": 0, "atRisk": 0, "offTrack": 0, "noReport": 0}
    health_scope = {"onTrack": 0, "atRisk": 0, "offTrack": 0, "noReport": 0}

    for card in initiatives:
        sub = card.subtype or "Other"
        by_subtype[sub] = by_subtype.get(sub, 0) + 1
        init_status = (card.attributes or {}).get("initiativeStatus", "Unknown")
        by_status[init_status] = by_status.get(init_status, 0) + 1

        report = latest.get(card.id)
        if report:
            health_schedule[report.schedule_health] += 1
            health_cost[report.cost_health] += 1
            health_scope[report.scope_health] += 1
        else:
            health_schedule["noReport"] += 1
            health_cost["noReport"] += 1
            health_scope["noReport"] += 1

    total_budget, total_actual = totals
    return {
        "total_initiatives": len(initiatives),
        "by_subtype": by_subtype,
        "by_status": by_status,
        "total_budget": total_budget,
        "total_actual": total_actual,
        "health_schedule": health_schedule,
        "health_cost": health_cost,
        "health_scope": health_scope,
    }


# ── Public (account-less) projection ────────────────────────────────────


@dataclass(frozen=True)
class PpmPortalConfig:
    """What a portfolio portal is allowed to publish.

    Read from ``WebPortal.card_config["ppm"]``. Anything missing or malformed
    falls back to the defaults below rather than raising — this parses
    admin-authored JSONB on a public request path.
    """

    show_costs: bool = True
    show_people: bool = False
    show_report_narrative: bool = True

    @classmethod
    def from_card_config(cls, card_config: dict | None) -> "PpmPortalConfig":
        cfg = (card_config or {}).get("ppm") if isinstance(card_config, dict) else None
        if not isinstance(cfg, dict):
            return cls()
        d = cls()

        def _flag(key: str, default: bool) -> bool:
            v = cfg.get(key, default)
            return v if isinstance(v, bool) else default

        return cls(
            show_costs=_flag("show_costs", d.show_costs),
            show_people=_flag("show_people", d.show_people),
            show_report_narrative=_flag("show_report_narrative", d.show_report_narrative),
        )


def _public_person(display_name: str | None, role_key: str | None = None) -> PpmPublicPerson | None:
    """A named person for the public payload, or ``None``.

    An unnamed user is omitted entirely rather than identified by their email
    address. This is the second half of the guard: ``build_gantt_items`` is
    called with ``allow_email_fallback=False`` so such a user reaches here with
    an empty name in the first place.
    """
    if not display_name or not display_name.strip():
        return None
    return PpmPublicPerson(display_name=display_name, role_key=role_key)


def to_public_portfolio(
    items: Sequence[PpmGanttItem],
    dashboard: dict,
    group_options: Sequence[PpmGroupOption],
    *,
    cfg: PpmPortalConfig,
    group_by: str | None,
) -> PpmPublicPortfolio:
    """Project the internal board onto the account-less public shape.

    This is an **opt-in** projection built field by field, not a filter that
    removes known-sensitive keys — a subtractive filter fails open, publishing
    whatever field someone adds to ``PpmGanttItem`` next.

    Three things are dropped unconditionally, whatever ``cfg`` says:

    * **User emails.** The caller builds the rows with
      ``allow_email_fallback=False``, so an unnamed user arrives with an empty
      name and ``_public_person`` drops them rather than publishing an address.
      Both halves are needed: the fallback collapses name and email into one
      field, so redaction alone could not tell them apart afterwards.
    * **``cost_budget`` / ``cost_actual``.** These are ``type: "cost"`` metamodel
      attributes on the Initiative card, and public portals always strip
      cost-typed fields (see ``get_public_portal``). ``show_costs`` governs only
      ``capex_*``/``opex_*``/``total_budget``, which are aggregates of the
      ``ppm_cost_lines``/``ppm_budget_lines`` tables — not card attributes, and
      so genuinely outside that invariant. The board renders neither of the two
      card attributes anyway.
    * **Identifiers other than the initiative's own.** ``group_id`` becomes an
      opaque per-response token, and ``parent_id`` / ``latest_report_id`` /
      ``reporter_id`` / ``user_id`` are not emitted at all. The initiative ``id``
      *is* a real card UUID because a portfolio portal links its rows to
      ``/ppm/{id}`` behind the login wall; nothing else here needs one.
    """
    group_tokens: dict[str, str] = {}

    public_items: list[PpmPublicItem] = []
    for it in items:
        group_token: str | None = None
        if it.group_id is not None:
            group_token = group_tokens.setdefault(it.group_id, f"g{len(group_tokens)}")

        report: PpmPublicReport | None = None
        if it.latest_report is not None:
            r = it.latest_report
            report = PpmPublicReport(
                report_date=r.report_date,
                schedule_health=r.schedule_health,
                cost_health=r.cost_health,
                scope_health=r.scope_health,
                reporter=(
                    _public_person(r.reporter.display_name)
                    if (cfg.show_people and r.reporter)
                    else None
                ),
                summary=r.summary if cfg.show_report_narrative else None,
                accomplishments=r.accomplishments if cfg.show_report_narrative else None,
                next_steps=r.next_steps if cfg.show_report_narrative else None,
            )

        people: list[PpmPublicPerson] = []
        if cfg.show_people:
            for sh in it.stakeholders:
                if sh.role_key not in BOARD_ROLE_KEYS:
                    continue
                person = _public_person(sh.display_name, sh.role_key)
                if person:
                    people.append(person)

        public_items.append(
            PpmPublicItem(
                id=it.id,
                name=it.name,
                subtype=it.subtype,
                start_date=it.start_date,
                end_date=it.end_date,
                group_id=group_token,
                group_name=it.group_name,
                capex_planned=it.capex_planned if cfg.show_costs else None,
                capex_actual=it.capex_actual if cfg.show_costs else None,
                opex_planned=it.opex_planned if cfg.show_costs else None,
                opex_actual=it.opex_actual if cfg.show_costs else None,
                stakeholders=people,
                latest_report=report,
            )
        )

    return PpmPublicPortfolio(
        group_by=group_by,
        group_options=[
            PpmPublicGroupOption(
                type_key=o.type_key,
                label=o.type_label,
                translations=o.translations,
                icon=o.icon,
                color=o.color,
            )
            for o in group_options
        ],
        dashboard=PpmPublicDashboard(
            total_initiatives=dashboard.get("total_initiatives", 0),
            health_schedule=dashboard.get("health_schedule", {}),
            total_budget=dashboard.get("total_budget") if cfg.show_costs else None,
        ),
        items=public_items,
    )
