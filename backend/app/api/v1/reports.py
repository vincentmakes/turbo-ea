from __future__ import annotations

import asyncio
import logging
import re
import uuid
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_user
from app.database import get_db
from app.models.card import Card
from app.models.card_type import CardType
from app.models.event import Event
from app.models.relation import Relation
from app.models.relation_type import RelationType
from app.models.sso_invitation import SsoInvitation
from app.models.stakeholder import Stakeholder
from app.models.stakeholder_role_definition import StakeholderRoleDefinition
from app.models.survey import SurveyResponse
from app.models.tag import CardTag, Tag, TagGroup
from app.models.todo import Todo
from app.models.user import User
from app.models.user_favorite import UserFavorite
from app.services.cost_field_filter import cost_field_keys_from_card_schema
from app.services.kpi_snapshot_service import (
    compute_trend_block,
    get_comparison_snapshot,
)
from app.services.permission_service import PermissionService

router = APIRouter(prefix="/reports", tags=["reports"])

log = logging.getLogger(__name__)


def _current_lifecycle_phase(lifecycle: dict | None) -> str | None:
    """Determine which lifecycle phase a card is currently in based on dates."""
    if not lifecycle:
        return None
    phases = ["endOfLife", "phaseOut", "active", "phaseIn", "plan"]
    today = datetime.now(timezone.utc).date()
    for phase in phases:
        date_str = lifecycle.get(phase)
        if date_str:
            try:
                d = (
                    datetime.fromisoformat(date_str).date()
                    if "T" in str(date_str)
                    else datetime.strptime(str(date_str), "%Y-%m-%d").date()
                )
                if d <= today:
                    return phase
            except (ValueError, TypeError):
                continue
    # If all dates are in the future, return the earliest set phase
    for phase in ["plan", "phaseIn", "active", "phaseOut", "endOfLife"]:
        if lifecycle.get(phase):
            return phase
    return None


@router.get("/dashboard")
async def dashboard(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    await PermissionService.require_permission(db, user, "reports.ea_dashboard")
    # Count by type
    type_counts = await db.execute(
        select(Card.type, func.count(Card.id)).where(Card.status == "ACTIVE").group_by(Card.type)
    )
    by_type = {row[0]: row[1] for row in type_counts.all()}

    # Total
    total = sum(by_type.values())

    # Average completion
    avg_result = await db.execute(
        select(func.avg(Card.data_quality)).where(Card.status == "ACTIVE")
    )
    avg_data_quality = avg_result.scalar() or 0

    # Approval status distribution
    status_counts = await db.execute(
        select(Card.approval_status, func.count(Card.id))
        .where(Card.status == "ACTIVE")
        .group_by(Card.approval_status)
    )
    statuses = {row[0]: row[1] for row in status_counts.all()}

    # Data quality distribution (buckets) – computed in SQL
    dq_result = await db.execute(
        select(
            func.sum(case((Card.data_quality < 25, 1), else_=0)).label("dq_0_25"),
            func.sum(case((Card.data_quality.between(25, 49.999), 1), else_=0)).label("dq_25_50"),
            func.sum(case((Card.data_quality.between(50, 74.999), 1), else_=0)).label("dq_50_75"),
            func.sum(case((Card.data_quality >= 75, 1), else_=0)).label("dq_75_100"),
        ).where(Card.status == "ACTIVE")
    )
    dq_row = dq_result.one()
    data_quality_dist = {
        "0-25": dq_row.dq_0_25 or 0,
        "25-50": dq_row.dq_25_50 or 0,
        "50-75": dq_row.dq_50_75 or 0,
        "75-100": dq_row.dq_75_100 or 0,
    }

    # Lifecycle phase distribution
    lifecycle_result = await db.execute(select(Card.lifecycle).where(Card.status == "ACTIVE"))
    lifecycle_dist: dict[str, int] = {
        "plan": 0,
        "phaseIn": 0,
        "active": 0,
        "phaseOut": 0,
        "endOfLife": 0,
        "none": 0,
    }
    for (lc,) in lifecycle_result.all():
        phase = _current_lifecycle_phase(lc)
        if phase and phase in lifecycle_dist:
            lifecycle_dist[phase] += 1
        else:
            lifecycle_dist["none"] += 1

    # Recent events. Many event payloads (`card.updated`, approval changes)
    # don't include the card name in `data`, so we resolve names server-side
    # in a single batch lookup keyed on `card_id` to keep the dashboard's
    # Recent Activity panel readable without extra round-trips.
    events_result = await db.execute(
        select(Event).options(selectinload(Event.user)).order_by(Event.created_at.desc()).limit(20)
    )
    events_list = list(events_result.scalars().all())
    referenced_card_ids = {e.card_id for e in events_list if e.card_id is not None}
    name_by_card_id: dict[uuid.UUID, str] = {}
    if referenced_card_ids:
        card_rows = await db.execute(
            select(Card.id, Card.name).where(Card.id.in_(referenced_card_ids))
        )
        name_by_card_id = {cid: name for cid, name in card_rows.all()}

    def _resolve_name(e: Event) -> str | None:
        data_name = (e.data or {}).get("name") if isinstance(e.data, dict) else None
        if isinstance(data_name, str) and data_name:
            return data_name
        if e.card_id is not None:
            return name_by_card_id.get(e.card_id)
        return None

    recent_events = [
        {
            "id": str(e.id),
            "card_id": str(e.card_id) if e.card_id else None,
            "card_name": _resolve_name(e),
            "event_type": e.event_type,
            "data": e.data,
            "user_display_name": e.user.display_name if e.user else None,
            "created_at": e.created_at.isoformat() if e.created_at else None,
        }
        for e in events_list
    ]

    # Trend indicators vs ~30 days ago (cold-start safe — returns nulls when
    # no comparable snapshot exists).
    avg_dq_rounded = round(avg_data_quality, 1)
    current_kpis = {
        "total_cards": total,
        "avg_data_quality": avg_dq_rounded,
        "approved_count": statuses.get("APPROVED", 0),
        "broken_count": statuses.get("BROKEN", 0),
    }
    previous_snapshot = await get_comparison_snapshot(db, days_ago=30)
    trends = compute_trend_block(current=current_kpis, previous=previous_snapshot)

    return {
        "total_cards": total,
        "by_type": by_type,
        "avg_data_quality": avg_dq_rounded,
        "approval_statuses": statuses,
        "data_quality_distribution": data_quality_dist,
        "lifecycle_distribution": lifecycle_dist,
        "recent_events": recent_events,
        "trends": trends,
    }


@router.get("/my-workspace")
async def my_workspace_summary(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Per-user counters for the Dashboard → My Workspace tab.

    All counters are inherently scoped to the calling user — no permission
    key beyond authentication is required.
    """
    today = datetime.now(timezone.utc).date()

    # Favorites (one row per favorited card).
    favorite_count = (
        await db.execute(select(func.count(UserFavorite.id)).where(UserFavorite.user_id == user.id))
    ).scalar() or 0

    # Distinct cards on which the user holds at least one stakeholder role.
    stakeholder_card_count = (
        await db.execute(
            select(func.count(func.distinct(Stakeholder.card_id))).where(
                Stakeholder.user_id == user.id
            )
        )
    ).scalar() or 0

    # Open todos assigned to the user. The "Created by me" view lives in
    # its own tab on /todos — surface only assigned items here so the
    # counter matches the My Open Todos preview rendered just below it.
    open_todo_count = (
        await db.execute(
            select(func.count(Todo.id)).where(
                Todo.assigned_to == user.id,
                Todo.status == "open",
            )
        )
    ).scalar() or 0

    # Pending survey responses for the user.
    pending_survey_count = (
        await db.execute(
            select(func.count(SurveyResponse.id)).where(
                SurveyResponse.user_id == user.id,
                SurveyResponse.status == "pending",
            )
        )
    ).scalar() or 0

    # "Needs my attention": overdue open todos + cards I'm a stakeholder on
    # whose approval is BROKEN. We count *distinct* items so a card that's
    # both broken and has an overdue todo on it isn't counted twice.
    overdue_todo_count = (
        await db.execute(
            select(func.count(Todo.id)).where(
                Todo.assigned_to == user.id,
                Todo.status == "open",
                Todo.due_date.is_not(None),
                Todo.due_date < today,
            )
        )
    ).scalar() or 0

    # "Cards I'm responsible for" means cards I hold a stakeholder role
    # on — same notion of ownership the todos counter uses (assigned to
    # me). Cards I only created but have no role on are intentionally
    # excluded; assign yourself as a stakeholder if you want them to
    # appear here.
    broken_card_count = (
        await db.execute(
            select(func.count(func.distinct(Card.id)))
            .join(Stakeholder, Stakeholder.card_id == Card.id)
            .where(
                Stakeholder.user_id == user.id,
                Card.status == "ACTIVE",
                Card.approval_status == "BROKEN",
            )
        )
    ).scalar() or 0

    attention_count = overdue_todo_count + broken_card_count

    # Cards the user created (uses Card.created_by — much cheaper than the
    # events table). Excludes archived cards and hidden card types so the
    # count agrees with the /cards/my-created listing.
    hidden_types_sq = select(CardType.key).where(CardType.is_hidden == True)  # noqa: E712
    created_count = (
        await db.execute(
            select(func.count(Card.id)).where(
                Card.created_by == user.id,
                Card.status == "ACTIVE",
                Card.type.not_in(hidden_types_sq),
            )
        )
    ).scalar() or 0

    return {
        "favorite_count": favorite_count,
        "stakeholder_card_count": stakeholder_card_count,
        "open_todo_count": open_todo_count,
        "pending_survey_count": pending_survey_count,
        "attention_count": attention_count,
        "overdue_todo_count": overdue_todo_count,
        "broken_card_count": broken_card_count,
        "created_count": created_count,
    }


@router.get("/admin-dashboard")
async def admin_dashboard_summary(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """System-wide governance and adoption metrics for the Dashboard → Admin tab.

    Gated on `admin.users` so it lines up with the existing admin nav. Avoids
    duplicating the Data Quality report — focuses on stakeholder coverage,
    user adoption, todo backlog, and approval pipeline health.
    """
    await PermissionService.require_permission(db, user, "admin.users")

    now = datetime.now(timezone.utc)
    today = now.date()
    thirty_days_ago = now - timedelta(days=30)
    ninety_days_ago = now - timedelta(days=90)

    hidden_types_sq = select(CardType.key).where(CardType.is_hidden == True)  # noqa: E712

    # ---- KPI strip --------------------------------------------------------
    total_users = (
        await db.execute(select(func.count(User.id)).where(User.is_active == True))  # noqa: E712
    ).scalar() or 0
    active_users_30d = (
        await db.execute(
            select(func.count(User.id)).where(
                User.is_active == True,  # noqa: E712
                User.last_login.is_not(None),
                User.last_login >= thirty_days_ago,
            )
        )
    ).scalar() or 0

    # Cards lacking *any* stakeholder assignment.
    has_stakeholder_sq = select(Stakeholder.card_id).distinct()
    cards_without_stakeholders = (
        await db.execute(
            select(func.count(Card.id)).where(
                Card.status == "ACTIVE",
                Card.type.not_in(hidden_types_sq),
                Card.id.not_in(has_stakeholder_sq),
            )
        )
    ).scalar() or 0

    overdue_todos_total = (
        await db.execute(
            select(func.count(Todo.id)).where(
                Todo.status == "open",
                Todo.due_date.is_not(None),
                Todo.due_date < today,
            )
        )
    ).scalar() or 0

    stuck_approvals = (
        await db.execute(
            select(func.count(Card.id)).where(
                Card.status == "ACTIVE",
                Card.type.not_in(hidden_types_sq),
                Card.approval_status == "DRAFT",
                Card.updated_at < thirty_days_ago,
            )
        )
    ).scalar() or 0

    broken_total = (
        await db.execute(
            select(func.count(Card.id)).where(
                Card.status == "ACTIVE",
                Card.type.not_in(hidden_types_sq),
                Card.approval_status == "BROKEN",
            )
        )
    ).scalar() or 0

    # ---- Top contributors (last 30d) -------------------------------------
    contrib_rows = (
        await db.execute(
            select(
                User.id,
                User.display_name,
                User.email,
                func.count(Event.id).label("event_count"),
            )
            .join(Event, Event.user_id == User.id)
            .where(
                Event.created_at >= thirty_days_ago,
                Event.event_type.in_(
                    (
                        "card.created",
                        "card.updated",
                        "card.archived",
                        "card.restored",
                        "card.approval_status.approve",
                        "card.approval_status.reject",
                        "card.approval_status.reset",
                    )
                ),
            )
            .group_by(User.id, User.display_name, User.email)
            .order_by(func.count(Event.id).desc())
            .limit(10)
        )
    ).all()
    top_contributors = [
        {
            "user_id": str(r.id),
            "display_name": r.display_name,
            "email": r.email,
            "event_count": int(r.event_count),
        }
        for r in contrib_rows
    ]

    # ---- Stakeholder coverage by type ------------------------------------
    type_total_rows = (
        await db.execute(
            select(Card.type, func.count(Card.id))
            .where(
                Card.status == "ACTIVE",
                Card.type.not_in(hidden_types_sq),
            )
            .group_by(Card.type)
        )
    ).all()
    type_with_sh_rows = (
        await db.execute(
            select(Card.type, func.count(func.distinct(Card.id)))
            .join(Stakeholder, Stakeholder.card_id == Card.id)
            .where(
                Card.status == "ACTIVE",
                Card.type.not_in(hidden_types_sq),
            )
            .group_by(Card.type)
        )
    ).all()
    with_sh_by_type = {row[0]: int(row[1]) for row in type_with_sh_rows}
    coverage_by_type = []
    for type_key, total in type_total_rows:
        total_int = int(total)
        with_sh = with_sh_by_type.get(type_key, 0)
        missing = total_int - with_sh
        coverage_by_type.append(
            {
                "type": type_key,
                "total": total_int,
                "with_stakeholders": with_sh,
                "missing": missing,
            }
        )
    coverage_by_type.sort(key=lambda r: r["missing"], reverse=True)

    # ---- Idle users + pending SSO invitations ----------------------------
    idle_rows = (
        await db.execute(
            select(User.id, User.display_name, User.email, User.last_login, User.role)
            .where(
                User.is_active == True,  # noqa: E712
                ((User.last_login.is_(None)) | (User.last_login < ninety_days_ago)),
            )
            .order_by(User.last_login.is_(None).desc(), User.last_login.asc())
            .limit(10)
        )
    ).all()
    idle_users = [
        {
            "user_id": str(r.id),
            "display_name": r.display_name,
            "email": r.email,
            "last_login": r.last_login.isoformat() if r.last_login else None,
            "role": r.role,
        }
        for r in idle_rows
    ]

    # SSO invitations are considered pending while no User row exists for the
    # invited email yet (the invitation row is created on invite and remains
    # for the historical role-mapping; the user record is what signals redemption).
    existing_user_emails_sq = select(User.email)
    pending_sso_count = (
        await db.execute(
            select(func.count(SsoInvitation.id)).where(
                SsoInvitation.email.not_in(existing_user_emails_sq)
            )
        )
    ).scalar() or 0

    # ---- Approval pipeline by type ---------------------------------------
    pipeline_rows = (
        await db.execute(
            select(Card.type, Card.approval_status, func.count(Card.id))
            .where(
                Card.status == "ACTIVE",
                Card.type.not_in(hidden_types_sq),
                Card.approval_status.in_(("DRAFT", "BROKEN", "REJECTED")),
            )
            .group_by(Card.type, Card.approval_status)
        )
    ).all()
    pipeline_by_type: dict[str, dict[str, int]] = {}
    for type_key, status, count in pipeline_rows:
        bucket = pipeline_by_type.setdefault(type_key, {"DRAFT": 0, "BROKEN": 0, "REJECTED": 0})
        bucket[status] = int(count)
    approval_pipeline = [
        {
            "type": type_key,
            "draft": buckets["DRAFT"],
            "broken": buckets["BROKEN"],
            "rejected": buckets["REJECTED"],
            "total": buckets["DRAFT"] + buckets["BROKEN"] + buckets["REJECTED"],
        }
        for type_key, buckets in pipeline_by_type.items()
    ]
    approval_pipeline.sort(key=lambda r: r["total"], reverse=True)

    # ---- Recent system activity (50 events) ------------------------------
    sys_events_result = await db.execute(
        select(Event).options(selectinload(Event.user)).order_by(Event.created_at.desc()).limit(50)
    )
    sys_events_list = list(sys_events_result.scalars().all())
    sys_card_ids = {e.card_id for e in sys_events_list if e.card_id is not None}
    sys_name_by_card_id: dict[uuid.UUID, str] = {}
    if sys_card_ids:
        rows = await db.execute(select(Card.id, Card.name).where(Card.id.in_(sys_card_ids)))
        sys_name_by_card_id = {cid: name for cid, name in rows.all()}

    def _resolve_sys_name(e: Event) -> str | None:
        data_name = (e.data or {}).get("name") if isinstance(e.data, dict) else None
        if isinstance(data_name, str) and data_name:
            return data_name
        if e.card_id is not None:
            return sys_name_by_card_id.get(e.card_id)
        return None

    recent_activity = [
        {
            "id": str(e.id),
            "card_id": str(e.card_id) if e.card_id else None,
            "card_name": _resolve_sys_name(e),
            "event_type": e.event_type,
            "data": e.data,
            "user_display_name": e.user.display_name if e.user else None,
            "created_at": e.created_at.isoformat() if e.created_at else None,
        }
        for e in sys_events_list
    ]

    # ---- Unassigned + oldest overdue todos -------------------------------
    unassigned_todo_count = (
        await db.execute(
            select(func.count(Todo.id)).where(
                Todo.status == "open",
                Todo.assigned_to.is_(None),
            )
        )
    ).scalar() or 0

    oldest_overdue_rows = (
        await db.execute(
            select(
                Todo.id,
                Todo.description,
                Todo.due_date,
                Todo.card_id,
                User.id.label("assignee_id"),
                User.display_name.label("assignee_name"),
            )
            .join(User, User.id == Todo.assigned_to, isouter=True)
            .where(
                Todo.status == "open",
                Todo.due_date.is_not(None),
                Todo.due_date < today,
            )
            .order_by(Todo.due_date.asc())
            .limit(10)
        )
    ).all()
    oldest_overdue_todos = [
        {
            "id": str(r.id),
            "title": r.description,
            "due_date": r.due_date.isoformat() if r.due_date else None,
            "card_id": str(r.card_id) if r.card_id else None,
            "assignee_id": str(r.assignee_id) if r.assignee_id else None,
            "assignee_name": r.assignee_name,
        }
        for r in oldest_overdue_rows
    ]

    return {
        "kpis": {
            "total_users": int(total_users),
            "active_users_30d": int(active_users_30d),
            "cards_without_stakeholders": int(cards_without_stakeholders),
            "overdue_todos_total": int(overdue_todos_total),
            "stuck_approvals": int(stuck_approvals),
            "broken_total": int(broken_total),
            "pending_sso_invitations": int(pending_sso_count),
            "unassigned_todo_count": int(unassigned_todo_count),
        },
        "top_contributors": top_contributors,
        "stakeholder_coverage": coverage_by_type,
        "idle_users": idle_users,
        "approval_pipeline": approval_pipeline,
        "recent_activity": recent_activity,
        "oldest_overdue_todos": oldest_overdue_todos,
    }


@router.get("/stakeholder-directory")
async def stakeholder_directory(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Org-wide stakeholder directory keyed by card type → role → users.

    Powers the **Stakeholder directory** widget on the Admin tab. Returns
    the whole (card type → role → user → cards) tree in one round-trip,
    including each user's cards so the widget can expand a chip and show
    the cards inline without an extra fetch.
    """
    await PermissionService.require_permission(db, user, "admin.users")

    hidden_types_sq = select(CardType.key).where(CardType.is_hidden == True)  # noqa: E712

    # Fetch the raw join rows ungrouped — we group in Python so we can keep
    # the per-user card list (which a SQL group-by would collapse).
    rows = (
        await db.execute(
            select(
                Card.type,
                Stakeholder.role,
                Stakeholder.user_id,
                Card.id,
                Card.name,
            )
            .join(Stakeholder, Stakeholder.card_id == Card.id)
            .where(
                Card.status == "ACTIVE",
                Card.type.not_in(hidden_types_sq),
            )
        )
    ).all()

    if not rows:
        return {"card_types": []}

    # Collect everything we need to resolve in bulk: card types, role defs,
    # users. One round-trip each.
    type_keys = {r[0] for r in rows}
    user_ids = {r[2] for r in rows}

    type_meta_rows = (
        (await db.execute(select(CardType).where(CardType.key.in_(type_keys)))).scalars().all()
    )
    type_meta = {ct.key: ct for ct in type_meta_rows}

    srd_rows = (
        (
            await db.execute(
                select(StakeholderRoleDefinition).where(
                    StakeholderRoleDefinition.card_type_key.in_(type_keys),
                    StakeholderRoleDefinition.is_archived == False,  # noqa: E712
                )
            )
        )
        .scalars()
        .all()
    )
    srd_map: dict[tuple[str, str], StakeholderRoleDefinition] = {
        (s.card_type_key, s.key): s for s in srd_rows
    }
    srd_sort: dict[tuple[str, str], int] = {
        (s.card_type_key, s.key): s.sort_order for s in srd_rows
    }

    user_rows = (await db.execute(select(User).where(User.id.in_(user_ids)))).scalars().all()
    user_meta = {u.id: u for u in user_rows}

    # Build nested tree: type → role → user → cards.
    # Per-user card lists are deduplicated by id (a card can theoretically
    # carry the same user in the same role twice — defensive).
    by_type: dict[str, dict] = {}
    type_total_holders: dict[str, set] = {}
    # Intermediate per-(type, role, user) card aggregation.
    user_cards: dict[tuple[str, str, object], dict[str, str]] = {}
    for type_key, role_key, user_id, card_id, card_name in rows:
        ct_node = by_type.setdefault(
            type_key,
            {
                "type_key": type_key,
                "type_label": None,
                "type_icon": None,
                "type_color": None,
                "roles": {},
            },
        )
        role_node = ct_node["roles"].setdefault(
            role_key,
            {
                "role_key": role_key,
                "role_label": role_key,
                "role_color": "#757575",
                "role_translations": {},
                "users": {},
            },
        )
        if user_id not in role_node["users"]:
            u = user_meta.get(user_id)
            role_node["users"][user_id] = {
                "user_id": str(user_id),
                "display_name": (u.display_name if u else None) or (u.email if u else str(user_id)),
                "email": u.email if u else None,
                "cards": [],
            }
        bucket = user_cards.setdefault((type_key, role_key, user_id), {})
        bucket[str(card_id)] = card_name
        type_total_holders.setdefault(type_key, set()).add(user_id)

    # Flatten the per-user `cards` dicts onto each user node + sort by name.
    for (type_key, role_key, user_id), cards in user_cards.items():
        user_node = by_type[type_key]["roles"][role_key]["users"][user_id]
        user_node["cards"] = sorted(
            ({"id": cid, "name": cname} for cid, cname in cards.items()),
            key=lambda c: (c["name"] or "").lower(),
        )
        user_node["card_count"] = len(user_node["cards"])

    # Resolve type + role metadata and serialise into ordered lists.
    out_card_types = []
    for type_key, ct_node in by_type.items():
        meta = type_meta.get(type_key)
        ct_node["type_label"] = (meta.label if meta else type_key) or type_key
        ct_node["type_icon"] = meta.icon if meta else "category"
        ct_node["type_color"] = meta.color if meta else "#757575"

        # Resolve role metadata + order roles by sort_order then role_key.
        roles_list = []
        for role_key, role_node in ct_node["roles"].items():
            srd = srd_map.get((type_key, role_key))
            if srd is not None:
                role_node["role_label"] = srd.label
                role_node["role_color"] = srd.color or "#757575"
                role_node["role_translations"] = srd.translations or {}
            # Convert users dict → list, ordered by card_count desc, then name.
            users_list = list(role_node["users"].values())
            users_list.sort(key=lambda u: (-u["card_count"], (u["display_name"] or "").lower()))
            role_node["users"] = users_list
            roles_list.append(role_node)
        roles_list.sort(
            key=lambda r: (srd_sort.get((type_key, r["role_key"]), 9999), r["role_key"])
        )
        ct_node["roles"] = roles_list
        ct_node["holders_count"] = len(type_total_holders.get(type_key, set()))
        out_card_types.append(ct_node)

    # Order card types by total holders desc, then label.
    out_card_types.sort(key=lambda c: (-c["holders_count"], (c["type_label"] or "").lower()))

    return {"card_types": out_card_types}


@router.get("/landscape")
async def landscape(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    type: str = Query("Application"),
    group_by: str = Query("BusinessCapability"),
):
    """Landscape report: cards grouped by a related type."""
    await PermissionService.require_permission(db, user, "reports.ea_dashboard")
    can_view_costs_global = await PermissionService.has_app_permission(db, user, "costs.view")
    # Get all cards of the target type
    result = await db.execute(select(Card).where(Card.type == type, Card.status == "ACTIVE"))
    sheets = result.scalars().all()
    # Resolve cost field keys for the target type once
    target_type_result = await db.execute(
        select(CardType.fields_schema).where(CardType.key == type)
    )
    target_cost_keys = (
        cost_field_keys_from_card_schema(target_type_result.scalar_one_or_none())
        if not can_view_costs_global
        else frozenset()
    )

    def _strip_attrs(attrs: dict | None) -> dict | None:
        if not attrs or not target_cost_keys:
            return attrs
        return {k: v for k, v in attrs.items() if k not in target_cost_keys}

    # Get group cards (must come before relations query so IDs are available)
    group_result = await db.execute(
        select(Card).where(Card.type == group_by, Card.status == "ACTIVE")
    )
    groups = group_result.scalars().all()

    # Get relations connecting only the two relevant sets of IDs
    sheet_ids = [card.id for card in sheets]
    group_ids = [g.id for g in groups]
    rels_result = await db.execute(
        select(Relation).where(
            ((Relation.source_id.in_(sheet_ids)) & (Relation.target_id.in_(group_ids)))
            | ((Relation.source_id.in_(group_ids)) & (Relation.target_id.in_(sheet_ids)))
        )
    )
    rels = rels_result.scalars().all()

    # Build mapping: group_id -> [card]
    sheet_map = {str(card.id): card for card in sheets}
    group_map = {}
    for g in groups:
        group_map[str(g.id)] = {"id": str(g.id), "name": g.name, "items": []}

    for rel in rels:
        sid, tid = str(rel.source_id), str(rel.target_id)
        if sid in sheet_map and tid in group_map:
            card = sheet_map[sid]
            group_map[tid]["items"].append(
                {
                    "id": str(card.id),
                    "name": card.name,
                    "type": card.type,
                    "attributes": _strip_attrs(card.attributes),
                    "lifecycle": card.lifecycle,
                }
            )
        elif tid in sheet_map and sid in group_map:
            card = sheet_map[tid]
            group_map[sid]["items"].append(
                {
                    "id": str(card.id),
                    "name": card.name,
                    "type": card.type,
                    "attributes": _strip_attrs(card.attributes),
                    "lifecycle": card.lifecycle,
                }
            )

    # Ungrouped
    grouped_ids = set()
    for g in group_map.values():
        for item in g["items"]:
            grouped_ids.add(item["id"])
    ungrouped = [
        {
            "id": str(card.id),
            "name": card.name,
            "type": card.type,
            "attributes": _strip_attrs(card.attributes),
        }
        for card in sheets
        if str(card.id) not in grouped_ids
    ]

    return {
        "groups": list(group_map.values()),
        "ungrouped": ungrouped,
    }


def _valid_field_keys(fields_schema: list[dict] | None) -> set[str]:
    """Extract all valid field keys from a card type's fields_schema."""
    keys: set[str] = set()
    for section in fields_schema or []:
        for field in section.get("fields", []):
            if field.get("key"):
                keys.add(field["key"])
    return keys


# M-3: Regex for safe attribute key format (alphanumeric + underscore/camelCase)
_SAFE_KEY_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]{0,63}$")


@router.get("/portfolio")
async def portfolio(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    type: str = Query("Application"),
    x_axis: str = Query("functionalFit"),
    y_axis: str = Query("technicalFit"),
    size_field: str = Query("costTotalAnnual"),
    color_field: str = Query("businessCriticality"),
):
    """Portfolio scatter/bubble chart data."""
    await PermissionService.require_permission(db, user, "reports.portfolio")

    # M-3: Validate field params against the type's schema + safe format
    type_result = await db.execute(select(CardType).where(CardType.key == type))
    type_def = type_result.scalars().first()
    allowed_keys = _valid_field_keys(type_def.fields_schema if type_def else None)

    for param_name, param_val in [
        ("x_axis", x_axis),
        ("y_axis", y_axis),
        ("size_field", size_field),
        ("color_field", color_field),
    ]:
        if not _SAFE_KEY_RE.match(param_val):
            raise HTTPException(400, f"Invalid {param_name}: {param_val!r}")
        if allowed_keys and param_val not in allowed_keys:
            raise HTTPException(400, f"Unknown field '{param_val}' for type '{type}'")

    # If any of the chosen axes is a cost field, the caller must hold costs.view —
    # the portfolio aggregates landscape-wide so per-card stakeholder access is
    # not meaningful here.
    cost_keys = cost_field_keys_from_card_schema(type_def.fields_schema if type_def else None)
    if cost_keys & {x_axis, y_axis, size_field, color_field}:
        await PermissionService.require_permission(db, user, "costs.view")

    result = await db.execute(select(Card).where(Card.type == type, Card.status == "ACTIVE"))
    sheets = result.scalars().all()
    items = []
    for card in sheets:
        attrs = card.attributes or {}
        items.append(
            {
                "id": str(card.id),
                "name": card.name,
                "x": attrs.get(x_axis),
                "y": attrs.get(y_axis),
                "size": attrs.get(size_field, 0),
                "color": attrs.get(color_field),
                "lifecycle": card.lifecycle,
            }
        )
    return {"items": items, "x_axis": x_axis, "y_axis": y_axis}


@router.get("/app-portfolio")
async def app_portfolio(
    type: str = Query("Application"),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Portfolio report: all cards of the requested type with their relations
    for flexible client-side grouping by any attribute or related card type.

    Defaults to ``type=Application`` so the original Application Portfolio
    report keeps working without changes. The Flexible Portfolio report passes
    other card type keys (BusinessCapability, Initiative, ITComponent, ...).
    """
    await PermissionService.require_permission(db, user, "reports.portfolio")

    # 0. Validate the requested card type exists and is visible.
    all_types_result = await db.execute(select(CardType))
    all_types = all_types_result.scalars().all()
    target_type = next((t for t in all_types if t.key == type), None)
    if target_type is None or target_type.is_hidden:
        raise HTTPException(status_code=404, detail=f"Card type '{type}' not found")

    # 1. Get all active cards of the requested type
    apps_result = await db.execute(select(Card).where(Card.type == type, Card.status == "ACTIVE"))
    apps = apps_result.scalars().all()
    app_ids = [a.id for a in apps]
    app_id_set = {str(a.id) for a in apps}

    # 2. Get all relations touching those cards
    rels_result = await db.execute(
        select(Relation).where(
            (Relation.source_id.in_(app_ids)) | (Relation.target_id.in_(app_ids))
        )
    )
    rels = rels_result.scalars().all()

    # Collect all related card IDs
    related_ids: set[str] = set()
    for r in rels:
        sid, tid = str(r.source_id), str(r.target_id)
        if sid in app_id_set:
            related_ids.add(tid)
        else:
            related_ids.add(sid)
    related_ids -= app_id_set

    # 3. Fetch related cards in bulk
    related_map: dict[str, dict] = {}
    if related_ids:
        rel_result = await db.execute(
            select(Card).where(
                Card.id.in_(list(related_ids)),
                Card.status == "ACTIVE",
            )
        )
        for card in rel_result.scalars().all():
            related_map[str(card.id)] = {
                "id": str(card.id),
                "name": card.name,
                "type": card.type,
                "parent_id": str(card.parent_id) if card.parent_id else None,
            }

    # 4. Build card -> relations lookup
    app_relations: dict[str, list[dict]] = {str(a.id): [] for a in apps}
    for r in rels:
        sid, tid = str(r.source_id), str(r.target_id)
        if sid in app_id_set and tid in related_map:
            app_relations[sid].append(
                {
                    "relation_type": r.type,
                    "related_id": tid,
                    "related_name": related_map[tid]["name"],
                    "related_type": related_map[tid]["type"],
                    "attributes": r.attributes or {},
                }
            )
        elif tid in app_id_set and sid in related_map:
            app_relations[tid].append(
                {
                    "relation_type": r.type,
                    "related_id": sid,
                    "related_name": related_map[sid]["name"],
                    "related_type": related_map[sid]["type"],
                    "attributes": r.attributes or {},
                }
            )

    # 4b. Ancestor closure for hierarchical related types: nested grouping needs
    # the full parent chain of every related member, including ancestors that
    # have no direct relation to any portfolio card. Added members are flagged
    # ancestor_only so the client can exclude them from direct-relation filters.
    hierarchical_type_keys = {t.key for t in all_types if t.has_hierarchy and not t.is_hidden}
    pending = {
        m["parent_id"]
        for m in related_map.values()
        if m["type"] in hierarchical_type_keys
        and m["parent_id"]
        and m["parent_id"] not in related_map
    }
    for _ in range(10):  # hierarchy depth is capped well below this
        if not pending:
            break
        anc_result = await db.execute(
            select(Card).where(Card.id.in_(list(pending)), Card.status == "ACTIVE")
        )
        pending = set()
        for card in anc_result.scalars().all():
            cid = str(card.id)
            if cid in related_map:
                continue
            parent_id = str(card.parent_id) if card.parent_id else None
            related_map[cid] = {
                "id": cid,
                "name": card.name,
                "type": card.type,
                "parent_id": parent_id,
                "ancestor_only": True,
            }
            if parent_id and parent_id not in related_map:
                pending.add(parent_id)

    # 5. Get relation types for label resolution
    rt_result = await db.execute(select(RelationType).where(RelationType.is_hidden.is_(False)))
    relation_types_list = rt_result.scalars().all()
    rel_type_defs = []
    seen_other_types: set[str] = set()
    for rt in relation_types_list:
        other = None
        if rt.source_type_key == type:
            other = rt.target_type_key
        elif rt.target_type_key == type:
            other = rt.source_type_key
        if other and other not in seen_other_types:
            seen_other_types.add(other)
            rel_type_defs.append(
                {
                    "key": rt.key,
                    "label": rt.label,
                    "reverse_label": rt.reverse_label,
                    "source_type_key": rt.source_type_key,
                    "target_type_key": rt.target_type_key,
                    "other_type_key": other,
                    "translations": rt.translations or {},
                    "attributes_schema": rt.attributes_schema or [],
                }
            )

    # 6. Get card types (schema + visibility)
    visible_type_keys = {t.key for t in all_types if not t.is_hidden}
    fields_schema = target_type.fields_schema if target_type else []

    # 7. Get all organizations for org filter options (backwards-compat)
    orgs_result = await db.execute(
        select(Card).where(Card.type == "Organization", Card.status == "ACTIVE").order_by(Card.name)
    )
    orgs = orgs_result.scalars().all()

    # Build org mapping from relations
    org_ids = {str(o.id) for o in orgs}
    app_orgs: dict[str, set[str]] = {}
    for r in rels:
        sid, tid = str(r.source_id), str(r.target_id)
        if sid in org_ids and tid in app_id_set:
            app_orgs.setdefault(tid, set()).add(sid)
        elif tid in org_ids and sid in app_id_set:
            app_orgs.setdefault(sid, set()).add(tid)

    # Tag assignments + tag groups applicable to the requested card type
    app_tag_ids: dict[str, list[str]] = {}
    if app_ids:
        ct_rows = await db.execute(select(CardTag).where(CardTag.card_id.in_(app_ids)))
        for ct in ct_rows.scalars().all():
            app_tag_ids.setdefault(str(ct.card_id), []).append(str(ct.tag_id))

    tg_rows = await db.execute(select(TagGroup).order_by(TagGroup.name))
    tag_groups_payload = []
    for tg in tg_rows.scalars().all():
        if tg.restrict_to_types and type not in tg.restrict_to_types:
            continue
        t_rows = await db.execute(select(Tag).where(Tag.tag_group_id == tg.id).order_by(Tag.name))
        tag_groups_payload.append(
            {
                "id": str(tg.id),
                "name": tg.name,
                "mode": tg.mode,
                "tags": [
                    {"id": str(t.id), "name": t.name, "color": t.color}
                    for t in t_rows.scalars().all()
                ],
            }
        )

    # 8. Build response items
    items = []
    for a in apps:
        aid = str(a.id)
        items.append(
            {
                "id": aid,
                "name": a.name,
                "subtype": a.subtype,
                "attributes": a.attributes,
                "lifecycle": a.lifecycle,
                "relations": app_relations.get(aid, []),
                "org_ids": sorted(app_orgs.get(aid, set())),
                "tag_ids": app_tag_ids.get(aid, []),
            }
        )

    # 9. Collect groupable related types (visible only, with linked apps)
    groupable_types: dict[str, list[dict]] = {}
    for fs_data in related_map.values():
        ft = fs_data["type"]
        if ft not in visible_type_keys:
            continue
        if ft not in groupable_types:
            groupable_types[ft] = []
        groupable_types[ft].append(fs_data)
    # Sort members within each type
    for members in groupable_types.values():
        members.sort(key=lambda x: x["name"])

    organizations = [{"id": str(o.id), "name": o.name} for o in orgs]

    return {
        "items": items,
        "fields_schema": fields_schema,
        "relation_types": rel_type_defs,
        "groupable_types": groupable_types,
        "organizations": organizations,
        "tag_groups": tag_groups_payload,
    }


@router.get("/matrix")
async def matrix(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    row_type: str = Query("Application"),
    col_type: str = Query("BusinessCapability"),
):
    """Matrix report: cross-reference grid."""
    await PermissionService.require_permission(db, user, "reports.ea_dashboard")
    rows_result = await db.execute(
        select(Card).where(Card.type == row_type, Card.status == "ACTIVE").order_by(Card.name)
    )
    rows = rows_result.scalars().all()

    cols_result = await db.execute(
        select(Card).where(Card.type == col_type, Card.status == "ACTIVE").order_by(Card.name)
    )
    cols = cols_result.scalars().all()

    # Get all relations between these types
    row_ids = [card.id for card in rows]
    col_ids = [card.id for card in cols]
    rels_result = await db.execute(
        select(Relation).where(
            ((Relation.source_id.in_(row_ids)) & (Relation.target_id.in_(col_ids)))
            | ((Relation.source_id.in_(col_ids)) & (Relation.target_id.in_(row_ids)))
        )
    )
    rels = rels_result.scalars().all()

    # Build intersection set – normalise to (row_id, col_id) direction
    row_id_set = {str(card.id) for card in rows}
    intersections = set()
    for r in rels:
        sid, tid = str(r.source_id), str(r.target_id)
        if sid in row_id_set:
            intersections.add((sid, tid))
        else:
            intersections.add((tid, sid))

    # When same type on both axes, add self-relations on the diagonal
    if row_type == col_type:
        for card in rows:
            intersections.add((str(card.id), str(card.id)))

    return {
        "rows": [
            {
                "id": str(r.id),
                "name": r.name,
                "parent_id": str(r.parent_id) if r.parent_id else None,
            }
            for r in rows
        ],
        "columns": [
            {
                "id": str(c.id),
                "name": c.name,
                "parent_id": str(c.parent_id) if c.parent_id else None,
            }
            for c in cols
        ],
        "intersections": [{"row_id": r, "col_id": c} for r, c in intersections],
    }


@router.get("/roadmap")
async def roadmap(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    type: str | None = Query(None),
):
    """Roadmap: lifecycle timeline data."""
    await PermissionService.require_permission(db, user, "reports.ea_dashboard")
    q = select(Card).where(Card.status == "ACTIVE")
    if type:
        q = q.where(Card.type == type)
    result = await db.execute(q)
    sheets = result.scalars().all()
    items = []
    for card in sheets:
        lc = card.lifecycle or {}
        attrs = card.attributes or {}
        if any(lc.values()) or attrs.get("startDate") or attrs.get("endDate"):
            items.append(
                {
                    "id": str(card.id),
                    "name": card.name,
                    "type": card.type,
                    "subtype": card.subtype,
                    "lifecycle": lc,
                    "attributes": attrs,
                }
            )
    return {"items": items}


@router.get("/cost")
async def cost_report(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    type: str = Query("Application"),
):
    """Cost aggregation report."""
    await PermissionService.require_permission(db, user, "reports.ea_dashboard")
    await PermissionService.require_permission(db, user, "costs.view")

    # Detect cost fields from type schema
    type_result = await db.execute(select(CardType).where(CardType.key == type))
    type_def = type_result.scalars().first()
    cost_field_keys = []
    for section in type_def.fields_schema if type_def else []:
        for field in section.get("fields", []):
            if field.get("type") == "cost":
                cost_field_keys.append(field["key"])

    result = await db.execute(select(Card).where(Card.type == type, Card.status == "ACTIVE"))
    sheets = result.scalars().all()
    items = []
    total = 0
    for card in sheets:
        attrs = card.attributes or {}
        cost = 0
        for ck in cost_field_keys:
            cost += attrs.get(ck, 0) or 0
        if cost:
            items.append({"id": str(card.id), "name": card.name, "cost": cost})
            total += cost
    items.sort(key=lambda x: x["cost"], reverse=True)
    return {"items": items, "total": total}


@router.get("/cost-treemap")
async def cost_treemap(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    type: str = Query("Application"),
    cost_field: str = Query("costTotalAnnual"),
    group_by: str | None = Query(None),
    aggregate: list[str] | None = Query(None),
    parent_card_id: uuid.UUID | None = Query(None),
):
    """Cost treemap: items with cost, optionally grouped by a related type.

    When ``aggregate`` is non-empty, each entry is a ``"<typeKey>:<costFieldKey>"``
    pair identifying a cost field on a related card type. The endpoint sums that
    field across each primary card's related cards (relations resolved
    bidirectionally, parallel relations de-duped) and adds the per-pair totals.
    Because every pair targets a different card type **or** a different cost field
    on the same type, no related card contributes more than once to a given
    primary card's roll-up. This lets a type that has no cost field of its own
    (e.g. Provider) display costs sourced from related Applications, IT
    Components, etc., even all of them at once.

    When ``parent_card_id`` is set, the primary card set is restricted to cards
    that have at least one relation (in either direction) to that parent. This
    powers the treemap drill-down — clicking a parent rectangle re-queries with
    the related type as ``type`` and the parent's id as ``parent_card_id``.
    """
    await PermissionService.require_permission(db, user, "reports.ea_dashboard")
    await PermissionService.require_permission(db, user, "costs.view")
    # M-3: Validate cost_field format
    if not _SAFE_KEY_RE.match(cost_field):
        raise HTTPException(400, f"Invalid cost_field: {cost_field!r}")
    result = await db.execute(select(Card).where(Card.type == type, Card.status == "ACTIVE"))
    sheets = result.scalars().all()

    if parent_card_id is not None:
        # Restrict sheets to those linked (in either direction) to the parent card.
        sheet_ids = [c.id for c in sheets]
        if sheet_ids:
            edges_result = await db.execute(
                select(Relation).where(
                    ((Relation.source_id == parent_card_id) & (Relation.target_id.in_(sheet_ids)))
                    | ((Relation.target_id == parent_card_id) & (Relation.source_id.in_(sheet_ids)))
                )
            )
            linked_ids: set[uuid.UUID] = set()
            for r in edges_result.scalars().all():
                if r.source_id == parent_card_id:
                    linked_ids.add(r.target_id)
                else:
                    linked_ids.add(r.source_id)
            sheets = [c for c in sheets if c.id in linked_ids]
        else:
            sheets = []

    items: list[dict] = []
    total = 0.0

    if aggregate:
        # Parse and validate "<typeKey>:<fieldKey>" pairs; reject duplicates so the
        # same pair can never be summed twice by accident.
        pairs: list[tuple[str, str]] = []
        seen_pairs: set[tuple[str, str]] = set()
        for entry in aggregate:
            if entry.count(":") != 1:
                raise HTTPException(400, f"Invalid aggregate spec: {entry!r}")
            type_key, field_key = entry.split(":", 1)
            if not _SAFE_KEY_RE.match(type_key) or not _SAFE_KEY_RE.match(field_key):
                raise HTTPException(400, f"Invalid aggregate spec: {entry!r}")
            pair = (type_key, field_key)
            if pair in seen_pairs:
                raise HTTPException(400, f"Duplicate aggregate spec: {entry!r}")
            seen_pairs.add(pair)
            pairs.append(pair)

        # Validate every pair against the metamodel up-front.
        for type_key, field_key in pairs:
            rel_type_result = await db.execute(select(CardType).where(CardType.key == type_key))
            rel_type_def = rel_type_result.scalars().first()
            if rel_type_def is None:
                raise HTTPException(400, f"Unknown aggregate type: {type_key!r}")
            valid_cost_field = any(
                f.get("key") == field_key and f.get("type") == "cost"
                for section in (rel_type_def.fields_schema or [])
                for f in section.get("fields", [])
            )
            if not valid_cost_field:
                raise HTTPException(
                    400,
                    f"{field_key!r} is not a cost field on {type_key!r}",
                )

        primary_ids = [card.id for card in sheets]
        primary_id_set = {str(card.id) for card in sheets}
        cost_by_primary: dict[str, float] = {}

        for type_key, field_key in pairs:
            rel_result = await db.execute(
                select(Card).where(Card.type == type_key, Card.status == "ACTIVE")
            )
            related_cards = rel_result.scalars().all()
            related_cost_by_id = {
                str(c.id): float((c.attributes or {}).get(field_key, 0) or 0) for c in related_cards
            }
            related_id_set = {str(c.id) for c in related_cards}
            related_ids = [c.id for c in related_cards]

            if primary_ids and related_ids:
                edges_result = await db.execute(
                    select(Relation).where(
                        (
                            (Relation.source_id.in_(primary_ids))
                            & (Relation.target_id.in_(related_ids))
                        )
                        | (
                            (Relation.source_id.in_(related_ids))
                            & (Relation.target_id.in_(primary_ids))
                        )
                    )
                )
                edges = edges_result.scalars().all()
            else:
                edges = []

            # Per primary card, dedupe related ids across parallel relation types.
            per_primary: dict[str, set[str]] = {}
            for r in edges:
                sid, tid = str(r.source_id), str(r.target_id)
                if sid in primary_id_set and tid in related_id_set:
                    per_primary.setdefault(sid, set()).add(tid)
                elif tid in primary_id_set and sid in related_id_set:
                    per_primary.setdefault(tid, set()).add(sid)

            for primary_id, linked in per_primary.items():
                cost_by_primary[primary_id] = cost_by_primary.get(primary_id, 0.0) + sum(
                    related_cost_by_id.get(rid, 0) for rid in linked
                )

        for card in sheets:
            cost = cost_by_primary.get(str(card.id), 0.0)
            if not cost:
                continue
            items.append(
                {
                    "id": str(card.id),
                    "name": card.name,
                    "cost": cost,
                    "lifecycle": card.lifecycle,
                    "attributes": card.attributes,
                }
            )
            total += cost
    else:
        for card in sheets:
            cost = (card.attributes or {}).get(cost_field, 0) or 0
            if not cost:
                continue
            items.append(
                {
                    "id": str(card.id),
                    "name": card.name,
                    "cost": cost,
                    "lifecycle": card.lifecycle,
                    "attributes": card.attributes,
                }
            )
            total += cost
    items.sort(key=lambda x: x["cost"], reverse=True)

    groups = None
    if group_by:
        # Get group cards
        grp_result = await db.execute(
            select(Card).where(Card.type == group_by, Card.status == "ACTIVE")
        )
        grp_sheets = grp_result.scalars().all()
        grp_map = {str(g.id): g.name for g in grp_sheets}

        # Get relations
        sheet_ids = [card.id for card in sheets]
        grp_ids = [g.id for g in grp_sheets]
        rels_result = await db.execute(
            select(Relation).where(
                ((Relation.source_id.in_(sheet_ids)) & (Relation.target_id.in_(grp_ids)))
                | ((Relation.source_id.in_(grp_ids)) & (Relation.target_id.in_(sheet_ids)))
            )
        )
        rels = rels_result.scalars().all()

        # Build item -> group name mapping
        item_group: dict[str, str] = {}
        for r in rels:
            sid, tid = str(r.source_id), str(r.target_id)
            if tid in grp_map:
                item_group[sid] = grp_map[tid]
            elif sid in grp_map:
                item_group[tid] = grp_map[sid]

        for item in items:
            item["group"] = item_group.get(item["id"], "Ungrouped")

        # Build group summaries
        groups_dict: dict[str, float] = {}
        for item in items:
            g = item["group"]
            groups_dict[g] = groups_dict.get(g, 0) + item["cost"]
        groups = [
            {"name": k, "cost": v} for k, v in sorted(groups_dict.items(), key=lambda x: -x[1])
        ]

    return {"items": items, "total": total, "groups": groups}


@router.get("/capability-heatmap")
async def capability_heatmap(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    metric: str = Query("app_count"),
):
    """Business capability heatmap data with hierarchy."""
    await PermissionService.require_permission(db, user, "reports.ea_dashboard")
    # M-3: Whitelist valid metric values
    if metric not in {"app_count", "total_cost", "risk_count"}:
        raise HTTPException(400, f"Invalid metric: {metric!r}")
    if metric == "total_cost":
        await PermissionService.require_permission(db, user, "costs.view")
    can_view_costs_global = await PermissionService.has_app_permission(db, user, "costs.view")
    # Get all business capabilities
    caps_result = await db.execute(
        select(Card)
        .where(
            Card.type == "BusinessCapability",
            Card.status == "ACTIVE",
        )
        .order_by(Card.name)
    )
    caps = caps_result.scalars().all()
    cap_ids = [c.id for c in caps]

    # Get Application type schema for dynamic field resolution
    app_type_result = await db.execute(select(CardType).where(CardType.key == "Application"))
    app_type = app_type_result.scalars().first()
    app_fields_schema = app_type.fields_schema if app_type else []

    # Detect cost fields from schema
    cost_field_keys = []
    for section in app_fields_schema or []:
        for field in section.get("fields", []):
            if field.get("type") == "cost":
                cost_field_keys.append(field["key"])

    # Get related applications via relations
    apps_result = await db.execute(
        select(Card).where(Card.type == "Application", Card.status == "ACTIVE")
    )
    apps = apps_result.scalars().all()
    app_map = {str(a.id): a for a in apps}

    # Get ALL relations touching applications (for dynamic filtering by any related type)
    app_ids = [a.id for a in apps]
    rels_result = await db.execute(
        select(Relation).where(
            (Relation.source_id.in_(cap_ids + app_ids))
            | (Relation.target_id.in_(cap_ids + app_ids))
        )
    )
    rels = rels_result.scalars().all()

    # Collect IDs of all related non-application cards
    related_ids: set[str] = set()
    app_id_set = {str(a.id) for a in apps}
    cap_id_set = {str(c.id) for c in caps}
    for r in rels:
        sid, tid = str(r.source_id), str(r.target_id)
        if sid in app_id_set:
            related_ids.add(tid)
        elif tid in app_id_set:
            related_ids.add(sid)
    related_ids -= app_id_set
    related_ids -= cap_id_set

    # Fetch related cards in bulk
    related_map: dict[str, dict] = {}
    if related_ids:
        rel_cards_result = await db.execute(
            select(Card).where(Card.id.in_(list(related_ids)), Card.status == "ACTIVE")
        )
        for card in rel_cards_result.scalars().all():
            related_map[str(card.id)] = {"id": str(card.id), "name": card.name, "type": card.type}

    # Build cap_id -> [app_card] and app -> {type: [related_id]} mappings
    cap_apps: dict[str, list] = {str(c.id): [] for c in caps}
    app_related: dict[str, dict[str, list[str]]] = {}  # app_id -> {type_key: [related_id, ...]}
    for r in rels:
        sid, tid = str(r.source_id), str(r.target_id)
        if sid in cap_id_set and tid in app_map:
            cap_apps[sid].append(app_map[tid])
        elif tid in cap_id_set and sid in app_map:
            cap_apps[tid].append(app_map[sid])
        # app -> related card relations (for filtering)
        if sid in app_id_set and tid in related_map:
            app_related.setdefault(sid, {}).setdefault(related_map[tid]["type"], []).append(tid)
        elif tid in app_id_set and sid in related_map:
            app_related.setdefault(tid, {}).setdefault(related_map[sid]["type"], []).append(sid)

    # Tag assignments per application (for tag filter)
    cap_app_tag_ids: dict[str, list[str]] = {}
    if app_ids:
        ct_rows = await db.execute(select(CardTag).where(CardTag.card_id.in_(app_ids)))
        for ct in ct_rows.scalars().all():
            cap_app_tag_ids.setdefault(str(ct.card_id), []).append(str(ct.tag_id))

    tg_rows = await db.execute(select(TagGroup).order_by(TagGroup.name))
    cap_tag_groups_payload = []
    for tg in tg_rows.scalars().all():
        if tg.restrict_to_types and "Application" not in tg.restrict_to_types:
            continue
        t_rows = await db.execute(select(Tag).where(Tag.tag_group_id == tg.id).order_by(Tag.name))
        cap_tag_groups_payload.append(
            {
                "id": str(tg.id),
                "name": tg.name,
                "mode": tg.mode,
                "tags": [
                    {"id": str(t.id), "name": t.name, "color": t.color}
                    for t in t_rows.scalars().all()
                ],
            }
        )

    def _app_to_dict(a):
        aid = str(a.id)
        by_type = app_related.get(aid, {})
        attrs = a.attributes
        if attrs and not can_view_costs_global and cost_field_keys:
            attrs = {k: v for k, v in attrs.items() if k not in cost_field_keys}
        return {
            "id": aid,
            "name": a.name,
            "subtype": a.subtype,
            "attributes": attrs,
            "lifecycle": a.lifecycle,
            "org_ids": sorted(by_type.get("Organization", [])),
            "related_by_type": {k: sorted(v) for k, v in by_type.items()},
            "tag_ids": cap_app_tag_ids.get(aid, []),
        }

    # Collect relation filter options grouped by type (visible types only)
    all_type_keys_result = await db.execute(select(CardType).where(CardType.is_hidden.is_(False)))
    visible_type_keys = {t.key for t in all_type_keys_result.scalars().all()}

    filterable_types: dict[str, list[dict]] = {}
    for rd in related_map.values():
        ft = rd["type"]
        if ft not in visible_type_keys:
            continue
        if ft not in filterable_types:
            filterable_types[ft] = []
        filterable_types[ft].append(rd)
    for members in filterable_types.values():
        members.sort(key=lambda x: x["name"])

    # Build hierarchy-aware data
    items = []
    for c in caps:
        cid = str(c.id)
        linked_apps = cap_apps.get(cid, [])
        app_count = len(linked_apps)

        total_cost = 0.0
        if can_view_costs_global:
            for a in linked_apps:
                attrs = a.attributes or {}
                for ck in cost_field_keys:
                    v = attrs.get(ck, 0) or 0
                    total_cost += v

        risk_count = sum(1 for a in linked_apps if (a.lifecycle or {}).get("endOfLife"))

        items.append(
            {
                "id": cid,
                "name": c.name,
                "parent_id": str(c.parent_id) if c.parent_id else None,
                "app_count": app_count,
                "total_cost": total_cost,
                "risk_count": risk_count,
                "attributes": c.attributes,
                "apps": [_app_to_dict(a) for a in linked_apps],
            }
        )

    return {
        "items": items,
        "metric": metric,
        "filterable_types": filterable_types,
        "fields_schema": app_fields_schema,
        "tag_groups": cap_tag_groups_payload,
    }


@router.get("/dependencies")
async def dependencies(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    center_id: str | None = Query(None),
    depth: int = Query(2, ge=1, le=3),
    type: str | None = Query(None),
):
    """Dependency / interface map: nodes + edges for graph rendering."""
    await PermissionService.require_permission(db, user, "reports.ea_dashboard")
    # Always load ALL active cards for ancestor path resolution
    full_result = await db.execute(select(Card).where(Card.status == "ACTIVE"))
    all_sheets = full_result.scalars().all()
    full_map = {str(card.id): card for card in all_sheets}

    # Apply optional type filter for the graph scope
    if type:
        sheet_map = {k: v for k, v in full_map.items() if v.type == type}
    else:
        sheet_map = dict(full_map)

    # Get relations involving visible cards + relation type labels
    all_card_ids = list(sheet_map.keys())
    if all_card_ids:
        card_uuids = [uuid.UUID(cid) for cid in all_card_ids]
        rels_result = await db.execute(
            select(Relation).where(
                (Relation.source_id.in_(card_uuids)) | (Relation.target_id.in_(card_uuids))
            )
        )
    else:
        rels_result = await db.execute(select(Relation).where(False))
    rels = rels_result.scalars().all()

    rt_result = await db.execute(
        select(RelationType.key, RelationType.label, RelationType.reverse_label)
    )
    rel_type_info = {row[0]: {"label": row[1], "reverse_label": row[2]} for row in rt_result.all()}

    # If center_id, do BFS to limited depth
    if center_id and center_id in sheet_map:
        # Build adjacency list
        adj: dict[str, list[tuple[str, str]]] = {}  # id -> [(neighbor_id, rel_type)]
        for r in rels:
            sid, tid = str(r.source_id), str(r.target_id)
            if sid in sheet_map and tid in sheet_map:
                adj.setdefault(sid, []).append((tid, r.type))
                adj.setdefault(tid, []).append((sid, r.type))

        # BFS
        visited: set[str] = {center_id}
        frontier: set[str] = {center_id}
        for _ in range(depth):
            next_frontier: set[str] = set()
            for nid in frontier:
                for neighbor, _ in adj.get(nid, []):
                    if neighbor not in visited:
                        visited.add(neighbor)
                        next_frontier.add(neighbor)
            frontier = next_frontier

        visible_ids = visited
    else:
        visible_ids = set(all_card_ids)

    # Helper: build ancestor path names (root-first) using full_map
    def _ancestor_path(card_id: str) -> list[str]:
        path: list[str] = []
        cur = full_map.get(card_id)
        seen: set[str] = set()
        while cur and cur.parent_id:
            pid = str(cur.parent_id)
            if pid in seen:
                break
            seen.add(pid)
            parent = full_map.get(pid)
            if not parent:
                break
            path.insert(0, parent.name)
            cur = parent
        return path

    # Build nodes
    nodes = []
    for nid in visible_ids:
        card = sheet_map.get(nid)
        if not card:
            continue
        nodes.append(
            {
                "id": nid,
                "name": card.name,
                "type": card.type,
                "lifecycle": card.lifecycle,
                "attributes": card.attributes,
                "parent_id": str(card.parent_id) if card.parent_id else None,
                "path": _ancestor_path(nid),
            }
        )

    # Build edges (only between visible nodes)
    edges = []
    seen_edges: set[str] = set()
    for r in rels:
        sid, tid = str(r.source_id), str(r.target_id)
        if sid in visible_ids and tid in visible_ids:
            edge_key = f"{min(sid, tid)}:{max(sid, tid)}"
            if edge_key not in seen_edges:
                seen_edges.add(edge_key)
                rt_info = rel_type_info.get(r.type, {})
                edges.append(
                    {
                        "source": sid,
                        "target": tid,
                        "type": r.type,
                        "label": rt_info.get("label", r.type),
                        "reverse_label": rt_info.get("reverse_label"),
                        "description": r.description,
                        "attributes": r.attributes,
                    }
                )

    return {"nodes": nodes, "edges": edges}


@router.get("/data-quality")
async def data_quality(db: AsyncSession = Depends(get_db), user: User = Depends(get_current_user)):
    """Data quality & completeness dashboard."""
    await PermissionService.require_permission(db, user, "reports.ea_dashboard")
    result = await db.execute(select(Card).where(Card.status == "ACTIVE"))
    sheets = result.scalars().all()

    # By-type stats
    type_stats: dict[str, dict] = {}
    all_data_quality_scores = []
    for card in sheets:
        t = card.type
        if t not in type_stats:
            type_stats[t] = {
                "total": 0,
                "complete": 0,
                "partial": 0,
                "minimal": 0,
                "sum_data_quality": 0,
            }
        ts = type_stats[t]
        ts["total"] += 1
        ts["sum_data_quality"] += card.data_quality or 0
        all_data_quality_scores.append(card.data_quality or 0)
        if card.data_quality >= 80:
            ts["complete"] += 1
        elif card.data_quality >= 40:
            ts["partial"] += 1
        else:
            ts["minimal"] += 1

    # Overall completion
    overall = (
        round(sum(all_data_quality_scores) / len(all_data_quality_scores), 1)
        if all_data_quality_scores
        else 0
    )

    # Lifecycle completeness
    with_lifecycle = sum(1 for card in sheets if card.lifecycle and any(card.lifecycle.values()))

    # Orphaned items (no relations) – use UNION to get distinct connected IDs
    all_ids = {str(card.id) for card in sheets}
    connected_q = select(Relation.source_id).union(select(Relation.target_id))
    connected_result = await db.execute(connected_q)
    connected = {str(row[0]) for row in connected_result.all()}
    orphaned = len(all_ids - connected)

    # Stale items (not updated in 90+ days)
    cutoff = datetime.now(timezone.utc) - timedelta(days=90)
    stale = sum(1 for card in sheets if card.updated_at and card.updated_at < cutoff)

    # By-type breakdown
    by_type = []
    for t, ts in sorted(
        type_stats.items(), key=lambda x: x[1]["sum_data_quality"] / max(x[1]["total"], 1)
    ):
        by_type.append(
            {
                "type": t,
                "total": ts["total"],
                "complete": ts["complete"],
                "partial": ts["partial"],
                "minimal": ts["minimal"],
                "avg_data_quality": round(ts["sum_data_quality"] / max(ts["total"], 1), 1),
            }
        )

    # Worst offenders (20 lowest completion)
    worst = sorted(sheets, key=lambda card: card.data_quality or 0)[:20]
    worst_items = [
        {
            "id": str(card.id),
            "name": card.name,
            "type": card.type,
            "data_quality": card.data_quality or 0,
            "updated_at": card.updated_at.isoformat() if card.updated_at else None,
        }
        for card in worst
    ]

    return {
        "overall_data_quality": overall,
        "total_items": len(sheets),
        "with_lifecycle": with_lifecycle,
        "orphaned": orphaned,
        "stale": stale,
        "by_type": by_type,
        "worst_items": worst_items,
    }


# ---------------------------------------------------------------------------
#  EOL Risk & Impact report
# ---------------------------------------------------------------------------

_EOL_BASE = "https://endoflife.date/api"


def _eol_status(eol_val, support_val) -> str:
    """Classify a cycle as 'eol', 'approaching', 'supported', or 'unknown'."""
    now = datetime.now(timezone.utc).date()

    # Check EOL first
    if eol_val is True:
        return "eol"
    if isinstance(eol_val, str):
        try:
            eol_date = datetime.strptime(eol_val, "%Y-%m-%d").date()
            if eol_date <= now:
                return "eol"
            six_months = now + timedelta(days=182)
            if eol_date <= six_months:
                return "approaching"
        except ValueError:
            pass

    # If active support has ended
    if isinstance(support_val, str):
        try:
            sup_date = datetime.strptime(support_val, "%Y-%m-%d").date()
            if sup_date <= now:
                return "approaching"
        except ValueError:
            pass

    if eol_val is False:
        return "supported"

    return "supported" if eol_val is not None else "unknown"


async def _fetch_product_cycles(
    client: httpx.AsyncClient,
    product: str,
) -> list[dict] | None:
    """Fetch cycles for a single product, returning None on failure."""
    try:
        resp = await client.get(f"{_EOL_BASE}/{product}.json", timeout=10.0)
        if resp.status_code == 200:
            return resp.json()
    except httpx.HTTPError:
        log.warning("Failed to fetch EOL data for %s", product)
    return None


def _manual_eol_status(lifecycle: dict | None) -> str:
    """Classify a card with manually maintained lifecycle dates."""
    if not lifecycle:
        return "unknown"

    now = datetime.now(timezone.utc).date()
    eol_str = lifecycle.get("endOfLife")
    phase_out_str = lifecycle.get("phaseOut")

    # Check endOfLife date
    if isinstance(eol_str, str) and eol_str:
        try:
            eol_date = datetime.strptime(eol_str, "%Y-%m-%d").date()
            if eol_date <= now:
                return "eol"
            six_months = now + timedelta(days=182)
            if eol_date <= six_months:
                return "approaching"
        except ValueError:
            pass

    # Check phaseOut date (analogous to support ending)
    if isinstance(phase_out_str, str) and phase_out_str:
        try:
            po_date = datetime.strptime(phase_out_str, "%Y-%m-%d").date()
            if po_date <= now:
                return "approaching"
        except ValueError:
            pass

    return "supported"


@router.get("/eol")
async def eol_report(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """End-of-Life risk & impact report.

    Returns all Applications and IT Components with linked EOL data
    (from endoflife.date API) *or* manually maintained lifecycle dates,
    enriched with live cycle information and impact mapping
    (IT Component → related Applications).

    Each item includes a ``source`` field: ``"api"`` for items linked
    to endoflife.date, ``"manual"`` for items with only a hand-entered
    ``endOfLife`` lifecycle date.
    """
    await PermissionService.require_permission(db, user, "reports.ea_dashboard")
    # 1. Fetch all active Applications and ITComponents
    result = await db.execute(
        select(Card).where(
            Card.status == "ACTIVE",
            Card.type.in_(["Application", "ITComponent"]),
        )
    )
    all_sheets = result.scalars().all()

    # Split into API-linked and manually-maintained sets
    api_sheets = []
    manual_sheets = []
    seen_ids: set[str] = set()

    for card in all_sheets:
        attrs = card.attributes or {}
        has_api_link = bool(attrs.get("eol_product") and attrs.get("eol_cycle"))
        lifecycle = card.lifecycle or {}
        has_manual_eol = bool(lifecycle.get("endOfLife"))

        if has_api_link:
            api_sheets.append(card)
            seen_ids.add(str(card.id))
        elif has_manual_eol:
            manual_sheets.append(card)
            seen_ids.add(str(card.id))

    if not api_sheets and not manual_sheets:
        return {
            "items": [],
            "summary": {
                "eol": 0,
                "approaching": 0,
                "supported": 0,
                "impacted_apps": 0,
                "manual": 0,
            },
        }

    # 2. Batch-fetch unique products from endoflife.date (for API-linked items)
    unique_products = {(card.attributes or {})["eol_product"] for card in api_sheets}
    product_cycles: dict[str, list[dict]] = {}

    if unique_products:
        async with httpx.AsyncClient(timeout=15.0) as client:
            tasks = {product: _fetch_product_cycles(client, product) for product in unique_products}
            results = await asyncio.gather(*tasks.values())
            for product, cycles in zip(tasks.keys(), results):
                if cycles is not None:
                    product_cycles[product] = cycles

    # 3. Get relations between ITComponent and Application for impact mapping
    all_eol_sheets = api_sheets + manual_sheets
    it_ids = [card.id for card in all_eol_sheets if card.type == "ITComponent"]
    app_map = {str(card.id): card for card in all_sheets if card.type == "Application"}
    it_to_apps: dict[str, list[dict]] = {}

    if it_ids:
        rels_result = await db.execute(
            select(Relation).where(
                (Relation.source_id.in_(it_ids)) | (Relation.target_id.in_(it_ids))
            )
        )
        rels = rels_result.scalars().all()
        it_id_strs = {str(i) for i in it_ids}
        for r in rels:
            sid, tid = str(r.source_id), str(r.target_id)
            # ITComponent → Application relation in either direction
            if sid in it_id_strs and tid in app_map:
                it_to_apps.setdefault(sid, []).append(
                    {
                        "id": tid,
                        "name": app_map[tid].name,
                        "lifecycle": app_map[tid].lifecycle,
                    }
                )
            elif tid in it_id_strs and sid in app_map:
                it_to_apps.setdefault(tid, []).append(
                    {
                        "id": sid,
                        "name": app_map[sid].name,
                        "lifecycle": app_map[sid].lifecycle,
                    }
                )

    # 4. Build response items
    items = []
    counts = {"eol": 0, "approaching": 0, "supported": 0}
    manual_count = 0
    eol_impacted_app_ids: set[str] = set()
    approaching_impacted_app_ids: set[str] = set()

    # 4a. API-linked items
    for card in api_sheets:
        attrs = card.attributes or {}
        product = attrs["eol_product"]
        cycle_key = str(attrs["eol_cycle"])

        # Match cycle data
        cycle_data = None
        cycles = product_cycles.get(product, [])
        for c in cycles:
            if str(c.get("cycle")) == cycle_key:
                cycle_data = c
                break

        status = "unknown"
        if cycle_data:
            status = _eol_status(cycle_data.get("eol"), cycle_data.get("support"))

        if status in counts:
            counts[status] += 1

        # Impact: affected apps
        affected_apps = it_to_apps.get(str(card.id), [])
        if card.type == "ITComponent":
            for app in affected_apps:
                if status == "eol":
                    eol_impacted_app_ids.add(app["id"])
                elif status == "approaching":
                    approaching_impacted_app_ids.add(app["id"])

        items.append(
            {
                "id": str(card.id),
                "name": card.name,
                "type": card.type,
                "subtype": card.subtype,
                "eol_product": product,
                "eol_cycle": cycle_key,
                "status": status,
                "source": "api",
                "cycle_data": cycle_data,
                "lifecycle": card.lifecycle,
                "affected_apps": affected_apps,
            }
        )

    # 4b. Manually maintained items (lifecycle.endOfLife set, no API link)
    for card in manual_sheets:
        lifecycle = card.lifecycle or {}
        status = _manual_eol_status(lifecycle)
        manual_count += 1

        if status in counts:
            counts[status] += 1

        # Impact: affected apps
        affected_apps = it_to_apps.get(str(card.id), [])
        if card.type == "ITComponent":
            for app in affected_apps:
                if status == "eol":
                    eol_impacted_app_ids.add(app["id"])
                elif status == "approaching":
                    approaching_impacted_app_ids.add(app["id"])

        # Build synthetic cycle_data from lifecycle dates for timeline display
        manual_cycle_data = {}
        if lifecycle.get("active"):
            manual_cycle_data["releaseDate"] = lifecycle["active"]
        if lifecycle.get("phaseOut"):
            manual_cycle_data["support"] = lifecycle["phaseOut"]
        if lifecycle.get("endOfLife"):
            manual_cycle_data["eol"] = lifecycle["endOfLife"]

        items.append(
            {
                "id": str(card.id),
                "name": card.name,
                "type": card.type,
                "subtype": card.subtype,
                "eol_product": None,
                "eol_cycle": None,
                "status": status,
                "source": "manual",
                "cycle_data": manual_cycle_data if manual_cycle_data else None,
                "lifecycle": lifecycle,
                "affected_apps": affected_apps,
            }
        )

    # Sort: EOL first, then approaching, then supported
    status_order = {"eol": 0, "approaching": 1, "unknown": 2, "supported": 3}
    items.sort(key=lambda x: (status_order.get(x["status"], 9), x["name"]))

    return {
        "items": items,
        "summary": {
            "eol": counts["eol"],
            "approaching": counts["approaching"],
            "supported": counts["supported"],
            "impacted_apps": len(eol_impacted_app_ids),
            "approaching_impacted_apps": len(approaching_impacted_app_ids - eol_impacted_app_ids),
            "manual": manual_count,
        },
    }
