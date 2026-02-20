from __future__ import annotations

import uuid
from datetime import datetime, timezone

import sqlalchemy
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_user
from app.database import get_db
from app.models.card import Card
from app.models.card_type import CardType
from app.models.relation import Relation
from app.models.stakeholder import Stakeholder
from app.models.survey import Survey, SurveyResponse
from app.models.tag import CardTag
from app.models.user import User
from app.services import notification_service
from app.services.permission_service import PermissionService

router = APIRouter(prefix="/surveys", tags=["surveys"])


# ── Pydantic bodies ──────────────────────────────────────────────────────────


class SurveyCreate(BaseModel):
    name: str
    description: str = ""
    message: str = ""
    target_type_key: str
    target_filters: dict | None = None
    target_roles: list[str] | None = None
    fields: list[dict] | None = None


class SurveyUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    message: str | None = None
    target_type_key: str | None = None
    target_filters: dict | None = None
    target_roles: list[str] | None = None
    fields: list[dict] | None = None


class SubmitResponse(BaseModel):
    responses: dict  # {field_key: {new_value, confirmed}}


class ApplyBody(BaseModel):
    response_ids: list[str]


# ── Helpers ───────────────────────────────────────────────────────────────────


def _survey_to_dict(s: Survey, stats: dict | None = None) -> dict:
    d = {
        "id": str(s.id),
        "name": s.name,
        "description": s.description or "",
        "message": s.message or "",
        "status": s.status,
        "target_type_key": s.target_type_key,
        "target_filters": s.target_filters or {},
        "target_roles": s.target_roles or [],
        "fields": s.fields or [],
        "created_by": str(s.created_by) if s.created_by else None,
        "creator_name": s.creator.display_name if s.creator else None,
        "sent_at": s.sent_at.isoformat() if s.sent_at else None,
        "closed_at": s.closed_at.isoformat() if s.closed_at else None,
        "created_at": s.created_at.isoformat() if s.created_at else None,
        "updated_at": s.updated_at.isoformat() if s.updated_at else None,
    }
    if stats:
        d.update(stats)
    return d


def _response_to_dict(r: SurveyResponse) -> dict:
    return {
        "id": str(r.id),
        "survey_id": str(r.survey_id),
        "card_id": str(r.card_id),
        "card_name": r.card.name if r.card else None,
        "card_type": r.card.type if r.card else None,
        "user_id": str(r.user_id),
        "user_display_name": r.user.display_name if r.user else None,
        "user_email": r.user.email if r.user else None,
        "status": r.status,
        "responses": r.responses or {},
        "applied": r.applied,
        "responded_at": r.responded_at.isoformat() if r.responded_at else None,
        "applied_at": r.applied_at.isoformat() if r.applied_at else None,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


async def _resolve_targets(
    db: AsyncSession, survey: Survey
) -> list[dict]:
    """Resolve survey filters into a list of {card, users} dicts."""
    filters = survey.target_filters or {}
    roles = survey.target_roles or []

    # Start with all active cards of the target type
    q = select(Card).where(
        Card.type == survey.target_type_key,
        Card.status == "ACTIVE",
    )

    # Tag filter
    tag_ids = filters.get("tag_ids") or []
    if tag_ids:
        tag_uuids = [uuid.UUID(t) for t in tag_ids]
        tagged_fs = select(CardTag.card_id).where(
            CardTag.tag_id.in_(tag_uuids)
        )
        q = q.where(Card.id.in_(tagged_fs))

    # Related card filter
    related_ids = filters.get("related_ids") or []
    if related_ids:
        related_uuids = [uuid.UUID(r) for r in related_ids]
        # Find cards related to any of these IDs (as source or target)
        related_fs = select(Relation.source_id).where(
            Relation.target_id.in_(related_uuids)
        ).union(
            select(Relation.target_id).where(
                Relation.source_id.in_(related_uuids)
            )
        )
        q = q.where(Card.id.in_(related_fs))

    # Attribute filters
    attr_filters = filters.get("attribute_filters") or []
    for af in attr_filters:
        key = af.get("key")
        op = af.get("op", "eq")
        value = af.get("value")

        if not key:
            continue

        col = Card.attributes[key].astext

        if op == "is_empty":
            # NULL or missing key in JSONB, or empty string
            q = q.where(
                (Card.attributes[key] == None)  # noqa: E711
                | (col == "")
            )
        elif op == "is_not_empty":
            q = q.where(
                Card.attributes[key] != None,  # noqa: E711
                col != "",
            )
        elif value is not None:
            str_val = str(value)
            if op == "eq":
                q = q.where(col == str_val)
            elif op == "ne":
                q = q.where(col != str_val)
            elif op in ("gt", "lt", "gte", "lte"):
                # Cast to numeric for comparisons
                num_col = Card.attributes[key].astext.cast(
                    sqlalchemy.Numeric
                )
                try:
                    num_val = float(value)
                except (ValueError, TypeError):
                    continue
                if op == "gt":
                    q = q.where(num_col > num_val)
                elif op == "lt":
                    q = q.where(num_col < num_val)
                elif op == "gte":
                    q = q.where(num_col >= num_val)
                elif op == "lte":
                    q = q.where(num_col <= num_val)
            elif op == "contains":
                q = q.where(col.ilike(f"%{str_val}%"))

    result = await db.execute(q)
    cards = result.scalars().all()

    if not cards:
        return []

    # Find subscribers for these cards with matching roles
    card_ids = [card.id for card in cards]
    sub_q = select(Stakeholder).where(Stakeholder.card_id.in_(card_ids)).options(selectinload(Stakeholder.user))
    if roles:
        sub_q = sub_q.where(Stakeholder.role.in_(roles))

    sub_result = await db.execute(sub_q)
    subs = sub_result.scalars().all()

    # Group subscribers by card
    card_map = {card.id: card for card in cards}
    targets: dict[uuid.UUID, dict] = {}
    for sub in subs:
        if sub.card_id not in targets:
            card = card_map[sub.card_id]
            targets[sub.card_id] = {
                "card_id": str(card.id),
                "card_name": card.name,
                "card_type": card.type,
                "users": [],
            }
        # Avoid duplicate users
        user_ids = {u["user_id"] for u in targets[sub.card_id]["users"]}
        if str(sub.user_id) not in user_ids and sub.user:
            targets[sub.card_id]["users"].append({
                "user_id": str(sub.user_id),
                "display_name": sub.user.display_name,
                "email": sub.user.email,
                "role": sub.role,
            })

    return list(targets.values())


async def _get_response_stats(db: AsyncSession, survey_id: uuid.UUID) -> dict:
    total = await db.execute(
        select(func.count(SurveyResponse.id)).where(SurveyResponse.survey_id == survey_id)
    )
    completed = await db.execute(
        select(func.count(SurveyResponse.id)).where(
            SurveyResponse.survey_id == survey_id,
            SurveyResponse.status == "completed",
        )
    )
    applied_count = await db.execute(
        select(func.count(SurveyResponse.id)).where(
            SurveyResponse.survey_id == survey_id,
            SurveyResponse.applied == True,  # noqa: E712
        )
    )
    return {
        "total_responses": total.scalar() or 0,
        "completed_responses": completed.scalar() or 0,
        "applied_responses": applied_count.scalar() or 0,
    }


# ── Admin endpoints ──────────────────────────────────────────────────────────


@router.get("")
async def list_surveys(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    status: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    """List all surveys (admin only)."""
    await PermissionService.require_permission(db, user, "surveys.manage")

    q = select(Survey).options(selectinload(Survey.creator)).order_by(Survey.created_at.desc())
    if status:
        q = q.where(Survey.status == status)

    # Count total before pagination
    count_q = select(func.count()).select_from(q.subquery())
    total = (await db.execute(count_q)).scalar() or 0

    q = q.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(q)
    surveys = result.scalars().all()

    items = []
    for s in surveys:
        stats = await _get_response_stats(db, s.id)
        items.append(_survey_to_dict(s, stats))

    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.post("", status_code=201)
async def create_survey(
    body: SurveyCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Create a new draft survey (admin only)."""
    await PermissionService.require_permission(db, user, "surveys.manage")

    # Validate target type exists
    type_result = await db.execute(
        select(CardType).where(CardType.key == body.target_type_key)
    )
    if not type_result.scalar_one_or_none():
        raise HTTPException(400, f"Unknown card type: {body.target_type_key}")

    survey = Survey(
        name=body.name,
        description=body.description,
        message=body.message,
        target_type_key=body.target_type_key,
        target_filters=body.target_filters or {},
        target_roles=body.target_roles or [],
        fields=body.fields or [],
        created_by=user.id,
    )
    db.add(survey)
    await db.commit()
    result = await db.execute(
        select(Survey).where(Survey.id == survey.id)
        .options(selectinload(Survey.creator))
    )
    survey = result.scalar_one()
    return _survey_to_dict(survey)


@router.get("/my")
async def my_surveys(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """List active surveys that the current user needs to respond to."""
    await PermissionService.require_permission(db, user, "surveys.respond")
    q = (
        select(SurveyResponse)
        .where(
            SurveyResponse.user_id == user.id,
            SurveyResponse.status == "pending",
        )
        .options(selectinload(SurveyResponse.survey), selectinload(SurveyResponse.card))
        .order_by(SurveyResponse.created_at.desc())
    )
    result = await db.execute(q)
    responses = result.scalars().all()

    # Group by survey
    survey_map: dict[str, dict] = {}
    for r in responses:
        sid = str(r.survey_id)
        if sid not in survey_map:
            survey_map[sid] = {
                "survey_id": sid,
                "survey_name": r.survey.name if r.survey else "",
                "survey_message": r.survey.message if r.survey else "",
                "survey_status": r.survey.status if r.survey else "",
                "target_type_key": r.survey.target_type_key if r.survey else "",
                "pending_count": 0,
                "items": [],
            }
        survey_map[sid]["pending_count"] += 1
        survey_map[sid]["items"].append({
            "response_id": str(r.id),
            "card_id": str(r.card_id),
            "card_name": r.card.name if r.card else None,
        })

    return list(survey_map.values())


@router.get("/{survey_id}")
async def get_survey(
    survey_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Get a single survey with stats (admin only)."""
    await PermissionService.require_permission(db, user, "surveys.manage")

    result = await db.execute(
        select(Survey).where(Survey.id == uuid.UUID(survey_id))
        .options(selectinload(Survey.creator))
    )
    survey = result.scalar_one_or_none()
    if not survey:
        raise HTTPException(404, "Survey not found")

    stats = await _get_response_stats(db, survey.id)
    return _survey_to_dict(survey, stats)


@router.patch("/{survey_id}")
async def update_survey(
    survey_id: str,
    body: SurveyUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Update a draft survey (admin only)."""
    await PermissionService.require_permission(db, user, "surveys.manage")

    result = await db.execute(
        select(Survey).where(Survey.id == uuid.UUID(survey_id))
        .options(selectinload(Survey.creator))
    )
    survey = result.scalar_one_or_none()
    if not survey:
        raise HTTPException(404, "Survey not found")
    if survey.status != "draft":
        raise HTTPException(400, "Only draft surveys can be edited")

    updatable = (
        "name", "description", "message",
        "target_type_key", "target_filters", "target_roles", "fields",
    )
    for field in updatable:
        val = getattr(body, field, None)
        if val is not None:
            setattr(survey, field, val)

    await db.commit()
    result = await db.execute(
        select(Survey).where(Survey.id == survey.id)
        .options(selectinload(Survey.creator))
    )
    survey = result.scalar_one()
    return _survey_to_dict(survey)


@router.delete("/{survey_id}", status_code=204)
async def delete_survey(
    survey_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Delete a draft survey (admin only)."""
    await PermissionService.require_permission(db, user, "surveys.manage")

    result = await db.execute(select(Survey).where(Survey.id == uuid.UUID(survey_id)))
    survey = result.scalar_one_or_none()
    if not survey:
        raise HTTPException(404, "Survey not found")
    if survey.status != "draft":
        raise HTTPException(400, "Only draft surveys can be deleted")

    await db.delete(survey)
    await db.commit()


@router.post("/{survey_id}/preview")
async def preview_survey(
    survey_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Preview resolved targets before sending (admin only)."""
    await PermissionService.require_permission(db, user, "surveys.manage")

    result = await db.execute(select(Survey).where(Survey.id == uuid.UUID(survey_id)))
    survey = result.scalar_one_or_none()
    if not survey:
        raise HTTPException(404, "Survey not found")

    targets = await _resolve_targets(db, survey)
    total_cards = len(targets)
    total_users = sum(len(t["users"]) for t in targets)
    return {
        "total_cards": total_cards,
        "total_users": total_users,
        "targets": targets,
    }


@router.post("/{survey_id}/send")
async def send_survey(
    survey_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Activate survey: resolve targets, create responses, notify."""
    await PermissionService.require_permission(db, user, "surveys.manage")

    result = await db.execute(select(Survey).where(Survey.id == uuid.UUID(survey_id)))
    survey = result.scalar_one_or_none()
    if not survey:
        raise HTTPException(404, "Survey not found")
    if survey.status != "draft":
        raise HTTPException(400, "Survey has already been sent")

    if not survey.fields:
        raise HTTPException(400, "Survey must have at least one field")
    if not survey.target_roles:
        raise HTTPException(400, "Survey must target at least one stakeholder role")

    targets = await _resolve_targets(db, survey)
    if not targets:
        raise HTTPException(
            400,
            "No targets matched the survey filters. "
            "Check that cards have subscribers with the selected roles.",
        )

    # Create response records
    created = 0
    for target in targets:
        card_id = uuid.UUID(target["card_id"])
        for u in target["users"]:
            u_id = uuid.UUID(u["user_id"])
            resp = SurveyResponse(
                survey_id=survey.id,
                card_id=card_id,
                user_id=u_id,
            )
            db.add(resp)
            created += 1

            # Send notification
            await notification_service.create_notification(
                db,
                user_id=u_id,
                notif_type="survey_request",
                title=f"Survey: {survey.name}",
                message=survey.message or "You have been asked to review data for a survey.",
                link=f"/surveys/{survey.id}/respond/{card_id}",
                data={"survey_id": str(survey.id), "card_id": str(card_id)},
                actor_id=user.id,
            )

    survey.status = "active"
    survey.sent_at = datetime.now(timezone.utc)
    await db.commit()
    result = await db.execute(
        select(Survey).where(Survey.id == survey.id)
        .options(selectinload(Survey.creator))
    )
    survey = result.scalar_one()

    stats = await _get_response_stats(db, survey.id)
    return {**_survey_to_dict(survey, stats), "targets_created": created}


@router.post("/{survey_id}/close")
async def close_survey(
    survey_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Close an active survey (admin only)."""
    await PermissionService.require_permission(db, user, "surveys.manage")

    result = await db.execute(
        select(Survey).where(Survey.id == uuid.UUID(survey_id))
        .options(selectinload(Survey.creator))
    )
    survey = result.scalar_one_or_none()
    if not survey:
        raise HTTPException(404, "Survey not found")
    if survey.status != "active":
        raise HTTPException(400, "Only active surveys can be closed")

    survey.status = "closed"
    survey.closed_at = datetime.now(timezone.utc)
    await db.commit()
    result = await db.execute(
        select(Survey).where(Survey.id == survey.id)
        .options(selectinload(Survey.creator))
    )
    survey = result.scalar_one()

    stats = await _get_response_stats(db, survey.id)
    return _survey_to_dict(survey, stats)


@router.get("/{survey_id}/responses")
async def list_responses(
    survey_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    status: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    """Get all responses for a survey (admin only)."""
    await PermissionService.require_permission(db, user, "surveys.manage")

    q = select(SurveyResponse).where(
        SurveyResponse.survey_id == uuid.UUID(survey_id)
    ).options(
        selectinload(SurveyResponse.card),
        selectinload(SurveyResponse.user),
    ).order_by(SurveyResponse.created_at)

    if status:
        q = q.where(SurveyResponse.status == status)

    # Count total before pagination
    count_q = select(func.count()).select_from(q.subquery())
    total = (await db.execute(count_q)).scalar() or 0

    q = q.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(q)
    responses = result.scalars().all()
    return {
        "items": [_response_to_dict(r) for r in responses],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.post("/{survey_id}/apply")
async def apply_responses(
    survey_id: str,
    body: ApplyBody,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Apply selected survey responses to cards (admin only)."""
    await PermissionService.require_permission(db, user, "surveys.manage")

    result = await db.execute(select(Survey).where(Survey.id == uuid.UUID(survey_id)))
    survey = result.scalar_one_or_none()
    if not survey:
        raise HTTPException(404, "Survey not found")

    applied_count = 0
    errors = []

    for rid_str in body.response_ids:
        rid = uuid.UUID(rid_str)
        resp_result = await db.execute(
            select(SurveyResponse).where(
                SurveyResponse.id == rid,
                SurveyResponse.survey_id == survey.id,
            )
        )
        resp = resp_result.scalar_one_or_none()
        if not resp:
            errors.append({"response_id": rid_str, "error": "Not found"})
            continue
        if resp.status != "completed":
            errors.append({"response_id": rid_str, "error": "Response not completed"})
            continue
        if resp.applied:
            errors.append({"response_id": rid_str, "error": "Already applied"})
            continue

        # Load the card
        card_result = await db.execute(
            select(Card).where(Card.id == resp.card_id)
        )
        card = card_result.scalar_one_or_none()
        if not card:
            errors.append({"response_id": rid_str, "error": "Card not found"})
            continue

        # Apply changes from response
        field_responses = resp.responses or {}
        attrs = dict(card.attributes or {})
        changed = False

        for field_key, field_data in field_responses.items():
            if not isinstance(field_data, dict):
                continue
            confirmed = field_data.get("confirmed", False)
            new_value = field_data.get("new_value")

            if not confirmed and new_value is not None:
                # User proposed a change
                attrs[field_key] = new_value
                changed = True

        if changed:
            card.attributes = attrs
            card.updated_by = user.id

        resp.applied = True
        resp.applied_at = datetime.now(timezone.utc)
        applied_count += 1

    await db.commit()
    return {"applied": applied_count, "errors": errors}


# ── Respondent endpoints ──────────────────────────────────────────────────────


@router.get("/{survey_id}/respond/{card_id}")
async def get_response_form(
    survey_id: str,
    card_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Get the response form data for a card in a survey."""
    await PermissionService.require_permission(db, user, "surveys.respond")
    resp_result = await db.execute(
        select(SurveyResponse).where(
            SurveyResponse.survey_id == uuid.UUID(survey_id),
            SurveyResponse.card_id == uuid.UUID(card_id),
            SurveyResponse.user_id == user.id,
        )
    )
    resp = resp_result.scalar_one_or_none()
    if not resp:
        raise HTTPException(404, "Survey response not found for this user")

    # Load survey
    survey_result = await db.execute(select(Survey).where(Survey.id == uuid.UUID(survey_id)))
    survey = survey_result.scalar_one_or_none()
    if not survey:
        raise HTTPException(404, "Survey not found")

    if survey.status != "active":
        raise HTTPException(400, "This survey is no longer active")

    # Load card
    card_result = await db.execute(select(Card).where(Card.id == uuid.UUID(card_id)))
    card = card_result.scalar_one_or_none()
    if not card:
        raise HTTPException(404, "Card not found")

    # Build current values for each survey field
    attrs = card.attributes or {}
    fields_with_values = []
    for field_def in (survey.fields or []):
        current_value = attrs.get(field_def["key"])
        fields_with_values.append({
            **field_def,
            "current_value": current_value,
        })

    return {
        "response_id": str(resp.id),
        "response_status": resp.status,
        "survey": {
            "id": str(survey.id),
            "name": survey.name,
            "message": survey.message,
        },
        "card": {
            "id": str(card.id),
            "name": card.name,
            "type": card.type,
            "subtype": card.subtype,
        },
        "fields": fields_with_values,
        "existing_responses": resp.responses or {},
    }


@router.post("/{survey_id}/respond/{card_id}")
async def submit_response(
    survey_id: str,
    card_id: str,
    body: SubmitResponse,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Submit a survey response for a card."""
    await PermissionService.require_permission(db, user, "surveys.respond")
    resp_result = await db.execute(
        select(SurveyResponse).where(
            SurveyResponse.survey_id == uuid.UUID(survey_id),
            SurveyResponse.card_id == uuid.UUID(card_id),
            SurveyResponse.user_id == user.id,
        )
    )
    resp = resp_result.scalar_one_or_none()
    if not resp:
        raise HTTPException(404, "Survey response not found for this user")

    # Check survey is active
    survey_result = await db.execute(select(Survey).where(Survey.id == uuid.UUID(survey_id)))
    survey = survey_result.scalar_one_or_none()
    if not survey or survey.status != "active":
        raise HTTPException(400, "This survey is no longer active")

    # Load card for current values
    card_result = await db.execute(select(Card).where(Card.id == uuid.UUID(card_id)))
    card = card_result.scalar_one_or_none()
    if not card:
        raise HTTPException(404, "Card not found")

    attrs = card.attributes or {}

    # Build full response data with current values
    full_responses = {}
    for field_def in (survey.fields or []):
        key = field_def["key"]
        submitted = body.responses.get(key, {})
        full_responses[key] = {
            "current_value": attrs.get(key),
            "new_value": submitted.get("new_value"),
            "confirmed": submitted.get("confirmed", False),
        }

    resp.responses = full_responses
    resp.status = "completed"
    resp.responded_at = datetime.now(timezone.utc)
    await db.commit()

    return {"status": "completed", "response_id": str(resp.id)}
