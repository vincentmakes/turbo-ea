from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import delete as sa_delete
from sqlalchemy import exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import get_current_user
from app.database import get_db
from app.models.card import Card
from app.models.card_type import CardType
from app.models.event import Event
from app.models.mutation_batch import MutationBatch
from app.models.survey import Survey, SurveyResponse
from app.models.user import User
from app.services import (
    audit_labels,
    audit_log,
    notification_service,
    stakeholder_service,
    survey_apply,
    survey_service,
)
from app.services.event_bus import event_bus, request_batch_id
from app.services.permission_service import PermissionService

logger = logging.getLogger(__name__)

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


# The field-kind predicates and writers live in ``services/survey_apply.py``
# (services must not import from ``app.api``). The old private names stay
# importable from here for ``test_relation_orientation.py``'s writer scan and
# any test that still reaches them through the router module.
_is_relation_field = survey_apply.is_relation_field
_relation_field_peers = survey_apply.relation_field_peers
_relation_peer_ids = survey_apply.ref_ids
_apply_relation_change = survey_apply.apply_relation_change


async def _validate_fields(db: AsyncSession, target_type_key: str, fields: list | None) -> None:
    try:
        await survey_apply.validate_field_rows(db, target_type_key, fields or [])
    except survey_apply.SurveyFieldError as exc:
        raise HTTPException(400, str(exc)) from exc


# ── Admin endpoints ──────────────────────────────────────────────────────────


@router.get("")
async def list_surveys(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
    status: str | None = None,
):
    """List all surveys (admin only)."""
    await PermissionService.require_permission(db, user, "surveys.manage")

    q = select(Survey).options(selectinload(Survey.creator)).order_by(Survey.created_at.desc())
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
    await PermissionService.require_permission(db, user, "surveys.manage")

    # Validate target type exists
    type_result = await db.execute(select(CardType).where(CardType.key == body.target_type_key))
    if not type_result.scalar_one_or_none():
        raise HTTPException(400, f"Unknown card type: {body.target_type_key}")
    await _validate_fields(db, body.target_type_key, body.fields)

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
        select(Survey).where(Survey.id == survey.id).options(selectinload(Survey.creator))
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
        .join(Survey, SurveyResponse.survey_id == Survey.id)
        .where(
            SurveyResponse.user_id == user.id,
            SurveyResponse.status == "pending",
            Survey.status == "active",
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
        survey_map[sid]["items"].append(
            {
                "response_id": str(r.id),
                "card_id": str(r.card_id),
                "card_name": r.card.name if r.card else None,
            }
        )

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
        select(Survey)
        .where(Survey.id == uuid.UUID(survey_id))
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
        select(Survey)
        .where(Survey.id == uuid.UUID(survey_id))
        .options(selectinload(Survey.creator))
    )
    survey = result.scalar_one_or_none()
    if not survey:
        raise HTTPException(404, "Survey not found")
    if survey.status != "draft":
        raise HTTPException(400, "Only draft surveys can be edited")

    updatable = (
        "name",
        "description",
        "message",
        "target_type_key",
        "target_filters",
        "target_roles",
        "fields",
    )
    if body.fields is not None or body.target_type_key is not None:
        await _validate_fields(
            db,
            body.target_type_key or survey.target_type_key,
            body.fields if body.fields is not None else survey.fields,
        )
    for field in updatable:
        val = getattr(body, field, None)
        if val is not None:
            setattr(survey, field, val)

    await db.commit()
    result = await db.execute(
        select(Survey).where(Survey.id == survey.id).options(selectinload(Survey.creator))
    )
    survey = result.scalar_one()
    return _survey_to_dict(survey)


@router.get("/{survey_id}/delete-impact")
async def survey_delete_impact(
    survey_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """What deleting a survey takes with it, for the confirmation dialog."""
    await PermissionService.require_permission(db, user, "surveys.manage")
    survey = await db.get(Survey, uuid.UUID(survey_id))
    if not survey:
        raise HTTPException(404, "Survey not found")
    return {"status": survey.status, **await survey_service.delete_impact(db, survey.id)}


@router.delete("/{survey_id}", status_code=204)
async def delete_survey(
    survey_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Delete a survey of any status (admin only).

    Its responses go with it, and so do the bell notifications that asked
    people to answer — a request for a survey that no longer exists would only
    lead to a 404. What the survey already changed stays on the cards, and the
    card history keeps naming it: those events carry the survey's name.
    """
    await PermissionService.require_permission(db, user, "surveys.manage")

    result = await db.execute(select(Survey).where(Survey.id == uuid.UUID(survey_id)))
    survey = result.scalar_one_or_none()
    if not survey:
        raise HTTPException(404, "Survey not found")

    impact = await survey_service.delete_impact(db, survey.id)
    await audit_log.record(
        db,
        action="admin.survey.deleted",
        category="admin",
        actor=user,
        target=("survey", str(survey.id), survey.name),
        context={
            "card_type": await audit_labels.card_type_label(db, survey.target_type_key),
            "status": survey.status,
            "requests": impact["requests"],
            "answered": impact["answered"],
            "applied": impact["applied"],
        },
    )
    await survey_service.delete_survey(db, survey)
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

    targets, matched = await survey_service.resolve_targets(db, survey)
    return {
        "total_cards": len(targets),
        # Everything the filters matched, recipient or not. `total_cards` is a
        # subset of this, and the gap is the number the builder has to explain.
        "total_matched": len(matched),
        # Distinct people. Summing the per-card lists counts one person once per
        # card they hold a role on, which is a request count, not a headcount —
        # and the tile above it reads "Users to Notify".
        "total_users": len({u["user_id"] for t in targets for u in t["users"]}),
        # What `send` will actually create: one SurveyResponse per (card, user),
        # equal to `targets_created` by construction. Notifications are one per
        # user — that count is the tile above.
        "total_requests": sum(len(t["users"]) for t in targets),
        "targets": targets,
    }


async def _audit_role_labels(
    db: AsyncSession, type_key: str, role_keys: list[str] | None
) -> list[str]:
    """The targeted stakeholder roles by label, in the survey's order; a key
    the type no longer defines reads as itself."""
    labels = {
        r.get("key"): r.get("label") or r.get("key")
        for r in await stakeholder_service.roles_for_type(db, type_key)
        if isinstance(r, dict)
    }
    return [labels.get(key) or key for key in role_keys or []]


@router.post("/{survey_id}/send")
async def send_survey(
    survey_id: str,
    background_tasks: BackgroundTasks,
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

    targets, matched = await survey_service.resolve_targets(db, survey)
    if not targets:
        raise HTTPException(
            400,
            "No targets matched the survey filters. "
            "Check that cards have subscribers with the selected roles.",
        )

    # Create response records. Notifications are handed to a background task
    # after the commit: each emailed one opens its own SMTP connection, and a
    # send fanning out to dozens of stakeholders used to sit on that loop
    # inline — the Send button hung for the sum of the handshakes. The response
    # rows are what make the survey real (My Surveys reads them); the
    # notifications are delivery, and delivery can lag the click by seconds.
    activation = await survey_service.activate_survey(db, survey, targets, actor_id=user.id)
    created = activation.created
    recipients = activation.recipients
    await audit_log.record(
        db,
        action="admin.survey.sent",
        category="admin",
        actor=user,
        target=("survey", str(survey.id), survey.name),
        context={
            "card_type": await audit_labels.card_type_label(db, survey.target_type_key),
            "roles": await _audit_role_labels(db, survey.target_type_key, survey.target_roles),
            "matched_cards": len(matched),
            "cards": len(targets),
            "recipients": len({u["user_id"] for t in targets for u in t["users"]}),
            "requests": created,
        },
    )
    await db.commit()

    background_tasks.add_task(
        notification_service.deliver_notification_batch,
        recipients,
        notif_type="survey_request",
        actor_id=user.id,
    )
    result = await db.execute(
        select(Survey).where(Survey.id == survey.id).options(selectinload(Survey.creator))
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
        select(Survey)
        .where(Survey.id == uuid.UUID(survey_id))
        .options(selectinload(Survey.creator))
    )
    survey = result.scalar_one_or_none()
    if not survey:
        raise HTTPException(404, "Survey not found")
    if survey.status != "active":
        raise HTTPException(400, "Only active surveys can be closed")

    survey.status = "closed"
    survey.closed_at = datetime.now(timezone.utc)
    await audit_log.record(
        db,
        action="admin.survey.closed",
        category="admin",
        actor=user,
        target=("survey", str(survey.id), survey.name),
        context={"card_type": await audit_labels.card_type_label(db, survey.target_type_key)},
    )
    await db.commit()
    result = await db.execute(
        select(Survey).where(Survey.id == survey.id).options(selectinload(Survey.creator))
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
):
    """Get all responses for a survey (admin only)."""
    await PermissionService.require_permission(db, user, "surveys.manage")

    q = (
        select(SurveyResponse)
        .where(SurveyResponse.survey_id == uuid.UUID(survey_id))
        .options(
            selectinload(SurveyResponse.card),
            selectinload(SurveyResponse.user),
        )
        .order_by(SurveyResponse.created_at)
    )

    if status:
        q = q.where(SurveyResponse.status == status)

    result = await db.execute(q)
    return [_response_to_dict(r) for r in result.scalars().all()]


def _apply_error_text(exc: BaseException) -> str:
    """One line the results page can show for a refused response."""
    if isinstance(exc, HTTPException):
        detail = exc.detail
        if isinstance(detail, dict):
            return str(detail.get("message") or detail.get("detail") or detail)
        return str(detail)
    if isinstance(exc, survey_apply.SurveyFieldError):
        return str(exc)
    return f"{type(exc).__name__}: {exc}" if str(exc) else type(exc).__name__


@router.post("/{survey_id}/apply")
async def apply_responses(
    survey_id: str,
    body: ApplyBody,
    background_tasks: BackgroundTasks,
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
    # Subscriber nudges, collected per response and delivered after the commit
    # (see ``update_card``'s ``deferred_notifications``): an apply over dozens
    # of cards must not email each stakeholder inline on the request's
    # transaction, and a response that rolls back must notify nobody.
    pending_notifications: list[dict] = []
    # A stakeholder answer is a role assignment: ``surveys.manage`` alone does
    # not grant it, so the applier's stakeholder authority is asked once per card.
    can_manage_stakeholders: dict[uuid.UUID, bool] = {}

    # Open the request's audit batch before the per-response savepoints: one
    # created lazily by the first event inside a savepoint that then rolls
    # back would vanish while the request still pointed every later event at
    # it.
    opened_batch = None
    if request_batch_id.get() is None:
        opened_batch = await event_bus.open_auto_batch(
            db, user_id=user.id, event_type="card.updated"
        )

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
        card_result = await db.execute(select(Card).where(Card.id == resp.card_id))
        card = card_result.scalar_one_or_none()
        if not card:
            errors.append({"response_id": rid_str, "error": "Card not found"})
            continue

        if card.id not in can_manage_stakeholders:
            can_manage_stakeholders[card.id] = await PermissionService.check_permission(
                db,
                user,
                "stakeholders.manage",
                card.id,
                "card.manage_stakeholders",
                card_type_key=card.type,
            )

        # One savepoint per response: an answer the card refuses (a required
        # field cleared, an unknown option, a malformed list of people) rolls
        # back only itself and is reported, and the others still land. Any
        # exception is caught, not only the two the apply raises on purpose: a
        # database error inside the savepoint would otherwise abort the whole
        # request and lose every response already applied.
        savepoint = await db.begin_nested()
        mine: list[dict] = []
        try:
            await survey_apply.apply_response(
                db,
                survey,
                resp,
                card,
                user,
                can_manage_stakeholders=can_manage_stakeholders[card.id],
                deferred_notifications=mine,
            )
            resp.applied = True
            resp.applied_at = datetime.now(timezone.utc)
            await db.flush()
        except Exception as exc:
            await savepoint.rollback()
            if not isinstance(exc, (HTTPException, survey_apply.SurveyFieldError)):
                logger.exception("Applying survey response %s failed", rid_str)
            errors.append({"response_id": rid_str, "error": _apply_error_text(exc)})
            continue
        await savepoint.commit()
        pending_notifications.extend(mine)
        applied_count += 1

    if opened_batch and not await db.scalar(select(exists().where(Event.batch_id == opened_batch))):
        # Nothing was written (every answer confirmed, refused or already
        # applied): an empty audit batch would offer a rollback that reverses
        # nothing.
        await db.execute(sa_delete(MutationBatch).where(MutationBatch.id == opened_batch))
        request_batch_id.set(None)

    await db.commit()

    by_type: dict[str, list[dict]] = {}
    for row in pending_notifications:
        recipient = dict(row)
        by_type.setdefault(recipient.pop("notif_type"), []).append(recipient)
    for notif_type, recipients in by_type.items():
        background_tasks.add_task(
            notification_service.deliver_notification_batch,
            recipients,
            notif_type=notif_type,
            actor_id=user.id,
        )
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

    # Load the live card type so we can enrich the snapshot with current translations
    card_type_result = await db.execute(select(CardType).where(CardType.key == card.type))
    card_type = card_type_result.scalar_one_or_none()

    # Build lookups: {field_key → metamodel field def}, {section_name → translations}
    meta_field_by_key: dict[str, dict] = {}
    section_translations_by_name: dict[str, dict] = {}
    if card_type and card_type.fields_schema:
        for section in card_type.fields_schema or []:
            section_name = section.get("section")
            if section_name and section.get("translations"):
                section_translations_by_name[section_name] = section["translations"]
            for f in section.get("fields", []) or []:
                if f.get("key"):
                    meta_field_by_key[f["key"]] = f

    # Build current values for each survey field, enriched with metamodel translations
    attrs = card.attributes or {}
    role_defs: dict[str, dict] | None = None
    fields_with_values = []
    for field_def in survey.fields or []:
        # Relation and lifecycle fields carry their live value and need no
        # metamodel field/option enrichment.
        if _is_relation_field(field_def) or survey_apply.is_lifecycle_field(field_def):
            fields_with_values.append(
                {
                    **field_def,
                    "current_value": await survey_apply.current_value(db, card, field_def),
                }
            )
            continue
        # A stakeholder field shows the role's current holders, labelled with
        # the role's live name — a role renamed since the send reads as renamed.
        if survey_apply.is_stakeholder_field(field_def):
            if role_defs is None:
                role_defs = {
                    r["key"]: r
                    for r in await stakeholder_service.roles_for_type(db, card.type)
                    if isinstance(r, dict) and r.get("key")
                }
            role_def = role_defs.get(field_def["role"]) or {}
            fields_with_values.append(
                {
                    **field_def,
                    "label": role_def.get("label") or field_def.get("label") or field_def["role"],
                    "translations": role_def.get("translations") or field_def.get("translations"),
                    "current_value": await survey_apply.current_value(db, card, field_def),
                }
            )
            continue

        current_value = attrs.get(field_def["key"])
        meta_field = meta_field_by_key.get(field_def["key"]) or {}
        enriched: dict = {**field_def, "current_value": current_value}

        # Field label translations (prefer snapshot if set, else live metamodel)
        if not enriched.get("translations") and meta_field.get("translations"):
            enriched["translations"] = meta_field["translations"]

        # Custom field-type config + help text are not captured in the survey's
        # field snapshot, so pull them from the live metamodel field. This lets
        # the respond form render an extension field type (e.g. a rating widget)
        # and its collapsible help, matching the card detail.
        for prop in ("config", "help", "helpTranslations"):
            if enriched.get(prop) is None and meta_field.get(prop) is not None:
                enriched[prop] = meta_field[prop]

        # Section name translations
        section_tr = section_translations_by_name.get(field_def.get("section") or "")
        if section_tr and not enriched.get("section_translations"):
            enriched["section_translations"] = section_tr

        # Option translations — merge per-option from live metamodel by option key
        meta_options_by_key = {
            o.get("key"): o for o in (meta_field.get("options") or []) if o.get("key")
        }
        if enriched.get("options") and meta_options_by_key:
            merged_opts = []
            for opt in enriched["options"] or []:
                meta_opt = meta_options_by_key.get(opt.get("key")) or {}
                merged_opt = dict(opt)
                if not merged_opt.get("translations") and meta_opt.get("translations"):
                    merged_opt["translations"] = meta_opt["translations"]
                merged_opts.append(merged_opt)
            enriched["options"] = merged_opts

        fields_with_values.append(enriched)

    # Resolve subtype label translations from the card type's subtypes list
    subtype_translations: dict | None = None
    if card.subtype and card_type and card_type.subtypes:
        for st in card_type.subtypes or []:
            if st.get("key") == card.subtype:
                subtype_translations = st.get("translations") or None
                break

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
            # Whether the respondent may open the card itself — the form links
            # to it so they can check its details before answering. Asked of
            # the server because a stakeholder role's per-card view grant is
            # invisible to the client's route table.
            "can_view": await PermissionService.check_permission(
                db, user, "inventory.view", card.id, "card.view", card_type_key=card.type
            ),
            "type": card.type,
            "subtype": card.subtype,
            # Every phase the card holds, surveyed or not, so the form can warn
            # about a proposed date that lands out of order against a phase the
            # survey did not ask about.
            "lifecycle": card.lifecycle or {},
            "type_translations": (card_type.translations if card_type else None) or None,
            "subtype_translations": subtype_translations,
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

    # Build full response data with current values
    full_responses = {}
    for field_def in survey.fields or []:
        key = field_def["key"]
        submitted = body.responses.get(key, {})
        if not isinstance(submitted, dict):
            submitted = {}
        new_value = submitted.get("new_value")
        try:
            if survey_apply.is_lifecycle_field(field_def):
                new_value = survey_apply.normalise_lifecycle_answer(new_value)
            elif new_value is not None and (
                survey_apply.is_relation_field(field_def)
                or survey_apply.is_stakeholder_field(field_def)
            ):
                # A relation or stakeholder answer is a list of references;
                # refuse anything else here rather than at apply time, where
                # the respondent is no longer around to be told.
                survey_apply.ref_ids(new_value)
        except survey_apply.SurveyFieldError as exc:
            raise HTTPException(422, str(exc)) from exc
        full_responses[key] = {
            "current_value": await survey_apply.current_value(db, card, field_def),
            "new_value": new_value,
            "confirmed": submitted.get("confirmed", False),
        }

    resp.responses = full_responses
    resp.status = "completed"
    resp.responded_at = datetime.now(timezone.utc)
    await db.commit()

    return {"status": "completed", "response_id": str(resp.id)}
