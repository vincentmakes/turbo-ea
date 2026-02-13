from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
import sqlalchemy
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user
from app.database import get_db
from app.models.fact_sheet import FactSheet
from app.models.fact_sheet_type import FactSheetType
from app.models.relation import Relation
from app.models.subscription import Subscription
from app.models.survey import Survey, SurveyResponse
from app.models.tag import FactSheetTag
from app.models.user import User
from app.services import notification_service

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
        "fact_sheet_id": str(r.fact_sheet_id),
        "fact_sheet_name": r.fact_sheet.name if r.fact_sheet else None,
        "fact_sheet_type": r.fact_sheet.type if r.fact_sheet else None,
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
    """Resolve survey filters into a list of {fact_sheet, users} dicts."""
    filters = survey.target_filters or {}
    roles = survey.target_roles or []

    # Start with all active fact sheets of the target type
    q = select(FactSheet).where(
        FactSheet.type == survey.target_type_key,
        FactSheet.status == "ACTIVE",
    )

    # Tag filter
    tag_ids = filters.get("tag_ids") or []
    if tag_ids:
        tag_uuids = [uuid.UUID(t) for t in tag_ids]
        tagged_fs = select(FactSheetTag.fact_sheet_id).where(
            FactSheetTag.tag_id.in_(tag_uuids)
        )
        q = q.where(FactSheet.id.in_(tagged_fs))

    # Related fact sheet filter
    related_ids = filters.get("related_ids") or []
    if related_ids:
        related_uuids = [uuid.UUID(r) for r in related_ids]
        # Find fact sheets related to any of these IDs (as source or target)
        related_fs = select(Relation.source_id).where(
            Relation.target_id.in_(related_uuids)
        ).union(
            select(Relation.target_id).where(
                Relation.source_id.in_(related_uuids)
            )
        )
        q = q.where(FactSheet.id.in_(related_fs))

    # Attribute filters
    attr_filters = filters.get("attribute_filters") or []
    for af in attr_filters:
        key = af.get("key")
        op = af.get("op", "eq")
        value = af.get("value")

        if not key:
            continue

        col = FactSheet.attributes[key].astext

        if op == "is_empty":
            # NULL or missing key in JSONB, or empty string
            q = q.where(
                (FactSheet.attributes[key] == None)  # noqa: E711
                | (col == "")
            )
        elif op == "is_not_empty":
            q = q.where(
                FactSheet.attributes[key] != None,  # noqa: E711
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
                num_col = FactSheet.attributes[key].astext.cast(
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
    fact_sheets = result.scalars().all()

    if not fact_sheets:
        return []

    # Find subscribers for these fact sheets with matching roles
    fs_ids = [fs.id for fs in fact_sheets]
    sub_q = select(Subscription).where(Subscription.fact_sheet_id.in_(fs_ids))
    if roles:
        sub_q = sub_q.where(Subscription.role.in_(roles))

    sub_result = await db.execute(sub_q)
    subs = sub_result.scalars().all()

    # Group subscribers by fact sheet
    fs_map = {fs.id: fs for fs in fact_sheets}
    targets: dict[uuid.UUID, dict] = {}
    for sub in subs:
        if sub.fact_sheet_id not in targets:
            fs = fs_map[sub.fact_sheet_id]
            targets[sub.fact_sheet_id] = {
                "fact_sheet_id": str(fs.id),
                "fact_sheet_name": fs.name,
                "fact_sheet_type": fs.type,
                "users": [],
            }
        # Avoid duplicate users
        user_ids = {u["user_id"] for u in targets[sub.fact_sheet_id]["users"]}
        if str(sub.user_id) not in user_ids and sub.user:
            targets[sub.fact_sheet_id]["users"].append({
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
):
    """List all surveys (admin only)."""
    if user.role != "admin":
        raise HTTPException(403, "Admin access required")

    q = select(Survey).order_by(Survey.created_at.desc())
    if status:
        q = q.where(Survey.status == status)

    result = await db.execute(q)
    surveys = result.scalars().all()

    items = []
    for s in surveys:
        stats = await _get_response_stats(db, s.id)
        items.append(_survey_to_dict(s, stats))

    return items


@router.post("", status_code=201)
async def create_survey(
    body: SurveyCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Create a new draft survey (admin only)."""
    if user.role != "admin":
        raise HTTPException(403, "Admin access required")

    # Validate target type exists
    type_result = await db.execute(
        select(FactSheetType).where(FactSheetType.key == body.target_type_key)
    )
    if not type_result.scalar_one_or_none():
        raise HTTPException(400, f"Unknown fact sheet type: {body.target_type_key}")

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
    await db.refresh(survey)
    return _survey_to_dict(survey)


@router.get("/my")
async def my_surveys(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """List active surveys that the current user needs to respond to."""
    q = (
        select(SurveyResponse)
        .where(
            SurveyResponse.user_id == user.id,
            SurveyResponse.status == "pending",
        )
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
            "fact_sheet_id": str(r.fact_sheet_id),
            "fact_sheet_name": r.fact_sheet.name if r.fact_sheet else None,
        })

    return list(survey_map.values())


@router.get("/{survey_id}")
async def get_survey(
    survey_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Get a single survey with stats (admin only)."""
    if user.role != "admin":
        raise HTTPException(403, "Admin access required")

    result = await db.execute(select(Survey).where(Survey.id == uuid.UUID(survey_id)))
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
    if user.role != "admin":
        raise HTTPException(403, "Admin access required")

    result = await db.execute(select(Survey).where(Survey.id == uuid.UUID(survey_id)))
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
    await db.refresh(survey)
    return _survey_to_dict(survey)


@router.delete("/{survey_id}", status_code=204)
async def delete_survey(
    survey_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Delete a draft survey (admin only)."""
    if user.role != "admin":
        raise HTTPException(403, "Admin access required")

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
    if user.role != "admin":
        raise HTTPException(403, "Admin access required")

    result = await db.execute(select(Survey).where(Survey.id == uuid.UUID(survey_id)))
    survey = result.scalar_one_or_none()
    if not survey:
        raise HTTPException(404, "Survey not found")

    targets = await _resolve_targets(db, survey)
    total_fact_sheets = len(targets)
    total_users = sum(len(t["users"]) for t in targets)
    return {
        "total_fact_sheets": total_fact_sheets,
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
    if user.role != "admin":
        raise HTTPException(403, "Admin access required")

    result = await db.execute(select(Survey).where(Survey.id == uuid.UUID(survey_id)))
    survey = result.scalar_one_or_none()
    if not survey:
        raise HTTPException(404, "Survey not found")
    if survey.status != "draft":
        raise HTTPException(400, "Survey has already been sent")

    if not survey.fields:
        raise HTTPException(400, "Survey must have at least one field")
    if not survey.target_roles:
        raise HTTPException(400, "Survey must target at least one subscription role")

    targets = await _resolve_targets(db, survey)
    if not targets:
        raise HTTPException(
            400,
            "No targets matched the survey filters. "
            "Check that fact sheets have subscribers with the selected roles.",
        )

    # Create response records
    created = 0
    for target in targets:
        fs_id = uuid.UUID(target["fact_sheet_id"])
        for u in target["users"]:
            u_id = uuid.UUID(u["user_id"])
            resp = SurveyResponse(
                survey_id=survey.id,
                fact_sheet_id=fs_id,
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
                link=f"/surveys/{survey.id}/respond/{fs_id}",
                data={"survey_id": str(survey.id), "fact_sheet_id": str(fs_id)},
                actor_id=user.id,
            )

    survey.status = "active"
    survey.sent_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(survey)

    stats = await _get_response_stats(db, survey.id)
    return {**_survey_to_dict(survey, stats), "targets_created": created}


@router.post("/{survey_id}/close")
async def close_survey(
    survey_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Close an active survey (admin only)."""
    if user.role != "admin":
        raise HTTPException(403, "Admin access required")

    result = await db.execute(select(Survey).where(Survey.id == uuid.UUID(survey_id)))
    survey = result.scalar_one_or_none()
    if not survey:
        raise HTTPException(404, "Survey not found")
    if survey.status != "active":
        raise HTTPException(400, "Only active surveys can be closed")

    survey.status = "closed"
    survey.closed_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(survey)

    stats = await _get_response_stats(db, survey.id)
    return _survey_to_dict(survey, stats)


@router.get("/{survey_id}/responses")
async def list_responses(
    survey_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    status: str | None = None,
):
    """Get all responses for a survey (admin only)."""
    if user.role != "admin":
        raise HTTPException(403, "Admin access required")

    q = select(SurveyResponse).where(
        SurveyResponse.survey_id == uuid.UUID(survey_id)
    ).order_by(SurveyResponse.created_at)

    if status:
        q = q.where(SurveyResponse.status == status)

    result = await db.execute(q)
    responses = result.scalars().all()
    return [_response_to_dict(r) for r in responses]


@router.post("/{survey_id}/apply")
async def apply_responses(
    survey_id: str,
    body: ApplyBody,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Apply selected survey responses to fact sheets (admin only)."""
    if user.role != "admin":
        raise HTTPException(403, "Admin access required")

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

        # Load the fact sheet
        fs_result = await db.execute(
            select(FactSheet).where(FactSheet.id == resp.fact_sheet_id)
        )
        fs = fs_result.scalar_one_or_none()
        if not fs:
            errors.append({"response_id": rid_str, "error": "Fact sheet not found"})
            continue

        # Apply changes from response
        field_responses = resp.responses or {}
        attrs = dict(fs.attributes or {})
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
            fs.attributes = attrs
            fs.updated_by = user.id

        resp.applied = True
        resp.applied_at = datetime.now(timezone.utc)
        applied_count += 1

    await db.commit()
    return {"applied": applied_count, "errors": errors}


# ── Respondent endpoints ──────────────────────────────────────────────────────


@router.get("/{survey_id}/respond/{fs_id}")
async def get_response_form(
    survey_id: str,
    fs_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Get the response form data for a fact sheet in a survey."""
    resp_result = await db.execute(
        select(SurveyResponse).where(
            SurveyResponse.survey_id == uuid.UUID(survey_id),
            SurveyResponse.fact_sheet_id == uuid.UUID(fs_id),
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

    # Load fact sheet
    fs_result = await db.execute(select(FactSheet).where(FactSheet.id == uuid.UUID(fs_id)))
    fs = fs_result.scalar_one_or_none()
    if not fs:
        raise HTTPException(404, "Fact sheet not found")

    # Build current values for each survey field
    attrs = fs.attributes or {}
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
        "fact_sheet": {
            "id": str(fs.id),
            "name": fs.name,
            "type": fs.type,
            "subtype": fs.subtype,
        },
        "fields": fields_with_values,
        "existing_responses": resp.responses or {},
    }


@router.post("/{survey_id}/respond/{fs_id}")
async def submit_response(
    survey_id: str,
    fs_id: str,
    body: SubmitResponse,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Submit a survey response for a fact sheet."""
    resp_result = await db.execute(
        select(SurveyResponse).where(
            SurveyResponse.survey_id == uuid.UUID(survey_id),
            SurveyResponse.fact_sheet_id == uuid.UUID(fs_id),
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

    # Load fact sheet for current values
    fs_result = await db.execute(select(FactSheet).where(FactSheet.id == uuid.UUID(fs_id)))
    fs = fs_result.scalar_one_or_none()
    if not fs:
        raise HTTPException(404, "Fact sheet not found")

    attrs = fs.attributes or {}

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
