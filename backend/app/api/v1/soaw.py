from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm.attributes import flag_modified

from app.api.deps import get_current_user
from app.database import get_db
from app.models.soaw import SoAW
from app.models.todo import Todo
from app.models.user import User
from app.services import document_collab, notification_service, review_outcome, soaw_service
from app.services import document_discussion_service as discussion
from app.services import document_history_service as history
from app.services.event_bus import event_bus
from app.services.permission_service import PermissionService

router = APIRouter(prefix="/soaw", tags=["soaw"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class SoAWCreate(BaseModel):
    name: str
    initiative_id: str | None = None
    status: str = "draft"
    document_info: dict | None = None
    version_history: list | None = None
    sections: dict | None = None

    # Unknown keys must fail loudly: silently-ignored extras caused the
    # ADR body/link loss in #800 and masked the SoAW field mismatch in #802.
    model_config = {"extra": "forbid"}


class SoAWUpdate(BaseModel):
    name: str | None = None
    initiative_id: str | None = None
    status: str | None = None
    document_info: dict | None = None
    version_history: list | None = None
    sections: dict | None = None

    model_config = {"extra": "forbid"}


class SignatureRequest(BaseModel):
    user_ids: list[str]
    message: str | None = None


class RejectRequest(BaseModel):
    # The reason, which also opens the rejection thread (and the history row's note).
    comment: str = Field(max_length=4000)


class SignRequest(BaseModel):
    # Optional signing note: a ``sign_note`` comment in the discussion and the
    # note of the ``signature`` timeline row. An absent body signs without one.
    note: str | None = Field(default=None, max_length=2000)

    model_config = {"extra": "forbid"}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _row_to_dict(s: SoAW, chains: soaw_service.SoAWChains) -> dict:
    return {
        "id": str(s.id),
        "name": s.name,
        "initiative_id": str(s.initiative_id) if s.initiative_id else None,
        "status": s.status,
        "document_info": s.document_info or {},
        "version_history": s.version_history or [],
        "sections": s.sections or {},
        "created_by": str(s.created_by) if s.created_by else None,
        "created_via": s.created_via,
        "updated_via": s.updated_via,
        "created_at": s.created_at.isoformat() if s.created_at else None,
        "updated_at": s.updated_at.isoformat() if s.updated_at else None,
        "revision_number": s.revision_number,
        "parent_id": str(s.parent_id) if s.parent_id else None,
        "signatories": s.signatories or [],
        "signed_at": s.signed_at.isoformat() if s.signed_at else None,
        "outcome": review_outcome.outcome_payload(s),
        **soaw_service.chain_fields(chains, s.id),
    }


async def _render(db: AsyncSession, payloads: list[dict], user: User) -> list[dict]:
    """The response rows of one request as ``user`` reads them, in one batch."""
    return await document_collab.render_doc(
        db, document_collab.SOAW, payloads, user=user, read_scope=None
    )


async def _detail_fields(db: AsyncSession, s: SoAW) -> dict:
    """What a single-SoAW response adds to a list row: the open-thread count."""
    return {"open_thread_count": await discussion.open_thread_count(db, document_collab.SOAW, s.id)}


async def _respond(db: AsyncSession, s: SoAW, user: User) -> dict:
    """One SoAW with its chain fields (one light chain query)."""
    row = {**_row_to_dict(s, await soaw_service.load_chains(db)), **await _detail_fields(db, s)}
    (rendered,) = await _render(db, [row], user)
    return rendered


async def _detail(db: AsyncSession, s: SoAW, user: User) -> dict:
    """``GET /soaw/{id}``'s reply: the SoAW with its chain fields, its
    revisions and its open-thread count, rendered for ``user``."""
    chains = await soaw_service.load_chains(db)
    (rendered,) = await _render(
        db,
        [
            {
                **_row_to_dict(s, chains),
                "revisions": soaw_service.revisions_payload(chains, s.id),
                **await _detail_fields(db, s),
            }
        ],
        user,
    )
    return rendered


def _refuse(refusal: tuple[int, object] | None) -> None:
    if refusal is not None:
        raise HTTPException(refusal[0], refusal[1])


async def _get_soaw(db: AsyncSession, soaw_id: str) -> SoAW:
    result = await db.execute(select(SoAW).where(SoAW.id == uuid.UUID(soaw_id)))
    s = result.scalar_one_or_none()
    if not s:
        raise HTTPException(404, "Statement of Architecture Work not found")
    return s


async def _close_sign_todos(db: AsyncSession, s: SoAW) -> None:
    """Mark every open sign to-do of ``s`` done (matched by its link: revisions
    of one SoAW share a name)."""
    sign_todos = await db.execute(
        select(Todo).where(
            Todo.is_system == True,  # noqa: E712
            Todo.status == "open",
            Todo.link == soaw_service.soaw_link(s.id),
        )
    )
    for t in sign_todos.scalars().all():
        t.status = "done"


async def _require_signer_permission(db: AsyncSession, user: User) -> None:
    """Signing and its verdicts: ``soaw.sign``, or ``soaw.manage`` (which kept
    the right when ``soaw.sign`` was introduced)."""
    can_sign = await PermissionService.check_permission(
        db, user, "soaw.sign"
    ) or await PermissionService.check_permission(db, user, "soaw.manage")
    if not can_sign:
        raise HTTPException(403, "Insufficient permissions")


def _event_payload(s: SoAW, user: User) -> dict:
    """The keys every review-outcome event carries."""
    return {
        "id": str(s.id),
        "name": s.name,
        "revision_number": s.revision_number,
        "actor": user.display_name,
    }


# ---------------------------------------------------------------------------
# CRUD Endpoints
# ---------------------------------------------------------------------------


@router.get("")
async def list_soaws(
    initiative_id: str | None = Query(None),
    include_earlier: bool = Query(True),
    include_closed: bool = Query(
        True, description="Also list closed documents (rejected or withdrawn)"
    ),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "soaw.view")
    stmt = select(SoAW).order_by(SoAW.updated_at.desc())
    if initiative_id:
        stmt = stmt.where(SoAW.initiative_id == uuid.UUID(initiative_id))
    result = await db.execute(stmt)
    rows = result.scalars().all()
    chains = await soaw_service.load_chains(db)
    out = [_row_to_dict(s, chains) for s in rows]
    return await _render(
        db,
        [
            r
            for r in out
            if soaw_service.keep_in_list(
                r, include_earlier=include_earlier, include_closed=include_closed
            )
        ],
        user,
    )


@router.post("", status_code=201)
async def create_soaw(
    body: SoAWCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "soaw.manage")
    text = await document_collab.before_save(
        db,
        document_collab.SOAW,
        None,
        {"sections": body.sections or {}},
        user=user,
        read_scope=None,
    )
    s = SoAW(
        name=body.name,
        initiative_id=uuid.UUID(body.initiative_id) if body.initiative_id else None,
        status=body.status,
        document_info=body.document_info or {},
        version_history=body.version_history or [],
        sections=text["sections"],
        created_by=user.id,
    )
    db.add(s)
    await db.flush()
    await document_collab.on_workflow(db, document_collab.SOAW, s, "created", user=user)
    await db.commit()
    await db.refresh(s)
    return await _respond(db, s, user)


@router.get("/{soaw_id}")
async def get_soaw(
    soaw_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "soaw.view")
    s = await _get_soaw(db, soaw_id)
    return await _detail(db, s, user)


@router.patch("/{soaw_id}")
async def update_soaw(
    soaw_id: str,
    body: SoAWUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "soaw.manage")
    s = await _get_soaw(db, soaw_id)

    # Signed: no edit at all. Status moves with their own endpoint: 400. In
    # review: only the initiative (filing) may change.
    _refuse(
        soaw_service.update_refusal(s.status, body.status, body.model_fields_set, outcome=s.outcome)
    )
    # Whether this save may change content: a draft that is not closed, or a
    # legacy approved SoAW.
    was_draft = soaw_service.content_editable(s.status, s.outcome)
    # The content before this save touches the row: the first recorded save
    # keeps it as the baseline version.
    before = history.snapshot_of(document_collab.SOAW, s) if was_draft else None

    if body.name is not None:
        s.name = body.name
    if body.initiative_id is not None:
        s.initiative_id = uuid.UUID(body.initiative_id) if body.initiative_id else None
    if body.status is not None:
        s.status = body.status
    if body.document_info is not None:
        s.document_info = body.document_info
    if body.version_history is not None:
        s.version_history = body.version_history
    if body.sections is not None:
        text = await document_collab.before_save(
            db,
            document_collab.SOAW,
            s,
            {"sections": body.sections},
            user=user,
            read_scope=None,
        )
        s.sections = text["sections"]
    await document_collab.after_save(
        db, document_collab.SOAW, s, user=user, was_draft=was_draft, before=before
    )
    await db.commit()
    await db.refresh(s)
    return await _respond(db, s, user)


@router.delete("/{soaw_id}", status_code=204)
async def delete_soaw(
    soaw_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    await PermissionService.require_permission(db, user, "soaw.manage")
    s = await _get_soaw(db, soaw_id)
    _refuse(soaw_service.delete_refusal(s.status, s.outcome))
    await db.delete(s)
    await db.commit()


# ---------------------------------------------------------------------------
# Signing workflow
# ---------------------------------------------------------------------------


@router.post("/{soaw_id}/request-signatures")
async def request_signatures(
    soaw_id: str,
    body: SignatureRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Request signatures from specified users. Creates todos and notifications."""
    await PermissionService.require_permission(db, user, "soaw.manage")
    s = await _get_soaw(db, soaw_id)

    _refuse(soaw_service.request_refusal(s.status, s.outcome))
    label = soaw_service.soaw_label(s.name, s.revision_number)
    link = soaw_service.soaw_link(s.id)

    # Resolve user names for the signatories list
    signatories = []
    for uid_str in body.user_ids:
        uid = uuid.UUID(uid_str)
        result = await db.execute(select(User).where(User.id == uid))
        u = result.scalar_one_or_none()
        if not u:
            raise HTTPException(404, f"User {uid_str} not found")
        signatories.append(
            {
                "user_id": str(uid),
                "display_name": u.display_name,
                "email": u.email,
                "status": "pending",
                "signed_at": None,
            }
        )

    s.signatories = signatories
    flag_modified(s, "signatories")
    s.status = "in_review"
    # Sent again: the changes asked for are taken as made.
    review_outcome.clear_outcome(s)
    await document_collab.on_workflow(
        db, document_collab.SOAW, s, "sent_for_review", user=user, signatories=signatories
    )

    # Create a todo for each signatory
    for sig in signatories:
        todo = Todo(
            card_id=s.initiative_id,
            description=f'Sign SoAW: "{label}"',
            assigned_to=uuid.UUID(sig["user_id"]),
            created_by=user.id,
            link=link,
            is_system=True,
        )
        db.add(todo)

        # Create notification (no actor_id so self-request still notifies)
        await notification_service.create_notification(
            db,
            user_id=uuid.UUID(sig["user_id"]),
            actor_id=user.id,
            notif_type="soaw_sign_requested",
            title="Signature Requested",
            message=f'{user.display_name} requested your signature on "{label}"',
            link=link,
            data={
                "soaw_id": soaw_id,
                "soaw_name": s.name,
                "revision_number": s.revision_number,
            },
        )

    await event_bus.publish(
        "soaw.signatures_requested",
        {
            "id": soaw_id,
            "name": s.name,
            "revision_number": s.revision_number,
            "signatory_count": len(signatories),
        },
        db=db,
        user_id=user.id,
    )
    await db.commit()
    await db.refresh(s)

    return await _respond(db, s, user)


@router.post("/{soaw_id}/sign")
async def sign_soaw(
    soaw_id: str,
    body: SignRequest | None = None,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Sign the SoAW as the current user. When all signatories have signed,
    the document status changes to 'signed' and becomes readonly."""
    # Signing is gated by the dedicated `soaw.sign` permission (mirrors
    # `adr.py`'s sign_adr → `adr.sign`); `soaw.manage` holders retain the
    # ability too so the change never removes an existing capability.
    await _require_signer_permission(db, user)
    s = await _get_soaw(db, soaw_id)

    if s.status == "signed":
        raise HTTPException(400, "Document is already signed")

    signatories = list(s.signatories or [])
    if not signatories:
        raise HTTPException(400, "No signatures have been requested for this document")

    # Find the current user in the signatories list
    found = False
    for sig in signatories:
        if sig["user_id"] == str(user.id):
            if sig["status"] == "signed":
                raise HTTPException(400, "You have already signed this document")
            sig["status"] = "signed"
            sig["signed_at"] = datetime.now(timezone.utc).isoformat()
            found = True
            break

    if not found:
        raise HTTPException(403, "You are not a signatory of this document")

    label = soaw_service.soaw_label(s.name, s.revision_number)
    # Auto-close the sign-request todo for this user (matched by its link:
    # revisions of one SoAW share a name)
    sign_todos = await db.execute(
        select(Todo).where(
            Todo.assigned_to == user.id,
            Todo.is_system == True,  # noqa: E712
            Todo.status == "open",
            Todo.link == soaw_service.soaw_link(s.id),
        )
    )
    for t in sign_todos.scalars().all():
        t.status = "done"

    s.signatories = signatories
    flag_modified(s, "signatories")
    await document_collab.on_workflow(
        db, document_collab.SOAW, s, "signature", user=user, note=body.note if body else None
    )

    # Check if all signatories have signed
    all_signed = all(sig["status"] == "signed" for sig in signatories)
    if all_signed:
        s.status = "signed"
        s.signed_at = datetime.now(timezone.utc)
        await document_collab.on_workflow(db, document_collab.SOAW, s, "signed", user=user)

        # Notify creator that the document is fully signed
        if s.created_by:
            await notification_service.create_notification(
                db,
                user_id=s.created_by,
                actor_id=user.id,
                notif_type="soaw_signed",
                title="SoAW Fully Signed",
                message=f'All signatories have signed "{label}"',
                link=f"/ea-delivery/soaw/{soaw_id}/preview",
                data={
                    "soaw_id": soaw_id,
                    "soaw_name": s.name,
                    "revision_number": s.revision_number,
                },
            )
    else:
        # Notify creator that an individual signatory has signed
        if s.created_by:
            signed_count = sum(1 for sig in signatories if sig["status"] == "signed")
            await notification_service.create_notification(
                db,
                user_id=s.created_by,
                actor_id=user.id,
                notif_type="soaw_signed",
                title="SoAW Signature Received",
                message=(
                    f'{user.display_name} signed "{label}" ({signed_count}/{len(signatories)})'
                ),
                link=f"/ea-delivery/soaw/{soaw_id}",
                data={
                    "soaw_id": soaw_id,
                    "soaw_name": s.name,
                    "revision_number": s.revision_number,
                },
            )

    await event_bus.publish(
        "soaw.signed",
        {
            "id": soaw_id,
            "name": s.name,
            "revision_number": s.revision_number,
            "signer": user.display_name,
            "all_signed": all_signed,
        },
        db=db,
        user_id=user.id,
    )
    await db.commit()
    await db.refresh(s)

    return await _respond(db, s, user)


@router.post("/{soaw_id}/recall-signatures")
async def recall_signatures(
    soaw_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Recall all pending signature requests. Only the creator or an admin
    can recall. Resets status to draft and clears signatories."""
    await PermissionService.require_permission(db, user, "soaw.manage")
    s = await _get_soaw(db, soaw_id)

    if s.status != "in_review":
        raise HTTPException(400, "Only documents in review can have signatures recalled")
    label = soaw_service.soaw_label(s.name, s.revision_number)

    # Close pending sign-request todos
    await _close_sign_todos(db, s)

    # Notify pending signatories that the request was recalled
    for sig in s.signatories or []:
        if sig["status"] == "pending":
            await notification_service.create_notification(
                db,
                user_id=uuid.UUID(sig["user_id"]),
                actor_id=user.id,
                notif_type="soaw_sign_recalled",
                title="Signature Request Recalled",
                message=(f'{user.display_name} recalled the signature request for "{label}"'),
                link=f"/ea-delivery/soaw/{soaw_id}",
                data={
                    "soaw_id": soaw_id,
                    "soaw_name": s.name,
                    "revision_number": s.revision_number,
                },
            )

    s.signatories = []
    flag_modified(s, "signatories")
    s.status = "draft"
    await document_collab.on_workflow(db, document_collab.SOAW, s, "recalled", user=user)

    await event_bus.publish(
        "soaw.signatures_recalled",
        {"id": soaw_id, "name": s.name, "revision_number": s.revision_number},
        db=db,
        user_id=user.id,
    )
    await db.commit()
    await db.refresh(s)

    return await _respond(db, s, user)


#: A signatory's verdict short of a signature: the timeline step it writes
#: (the event is ``soaw.<step>``) and how the notification names it.
_VERDICTS: dict[str, tuple[str, str, str]] = {
    review_outcome.CHANGES_REQUESTED: (
        "changes_requested",
        "SoAW Changes Requested",
        "requested changes to",
    ),
    review_outcome.REJECTED: ("rejected", "SoAW Rejected", "rejected"),
}


async def _review_verdict(
    db: AsyncSession, soaw_id: str, body: RejectRequest, user: User, outcome: str
) -> SoAW:
    """End a review on a signatory's verdict: request changes or reject.

    The shared body of both routes, like signing: a signatory holding
    ``soaw.sign`` (or ``soaw.manage``) of a SoAW in review. Signatories
    cleared, back to ``draft`` (the revision number stays: revisions count
    signed versions), every open sign to-do closed, the creator and the
    other signatories notified (``soaw_rejected``, ``data.outcome`` naming
    the verdict), ``outcome`` recorded, the timeline step written (which
    opens a thread carrying the reason) and the event published; the route
    commits.
    """
    step, title, verb = _VERDICTS[outcome]
    await _require_signer_permission(db, user)
    s = await _get_soaw(db, soaw_id)

    if s.status != "in_review":
        raise HTTPException(400, "Only documents in review can be rejected or sent back")

    signatories = list(s.signatories or [])
    if not any(sig["user_id"] == str(user.id) for sig in signatories):
        raise HTTPException(403, "You are not a signatory of this document")
    label = soaw_service.soaw_label(s.name, s.revision_number)

    await _close_sign_todos(db, s)

    recipients = ([s.created_by] if s.created_by else []) + [
        uuid.UUID(sig["user_id"]) for sig in signatories if sig["user_id"] != str(user.id)
    ]
    for recipient in recipients:
        await notification_service.create_notification(
            db,
            user_id=recipient,
            actor_id=user.id,
            notif_type="soaw_rejected",
            title=title,
            message=f'{user.display_name} {verb} "{label}": {body.comment}',
            link=f"/ea-delivery/soaw/{soaw_id}",
            data={
                "soaw_id": soaw_id,
                "soaw_name": s.name,
                "revision_number": s.revision_number,
                "comment": body.comment,
                "outcome": outcome,
            },
        )

    s.signatories = []
    flag_modified(s, "signatories")
    s.status = "draft"
    review_outcome.set_outcome(s, outcome, user=user, note=body.comment)
    await document_collab.on_workflow(
        db, document_collab.SOAW, s, step, user=user, note=body.comment
    )

    payload: dict = {**_event_payload(s, user), "outcome": outcome}
    if outcome == review_outcome.REJECTED:
        payload["rejector"] = user.display_name
    await event_bus.publish(f"soaw.{step}", payload, db=db, user_id=user.id)
    return s


@router.post("/{soaw_id}/request-changes")
async def request_soaw_changes(
    soaw_id: str,
    body: RejectRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Send the SoAW back for changes, as a signatory: an editable draft
    again with outcome ``changes_requested`` (cleared when signatures are
    requested again) and a ``change_request`` thread carrying the reason."""
    s = await _review_verdict(db, soaw_id, body, user, review_outcome.CHANGES_REQUESTED)
    await db.commit()
    await db.refresh(s)
    return await _detail(db, s, user)


@router.post("/{soaw_id}/reject")
async def reject_soaw(
    soaw_id: str,
    body: RejectRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Reject the SoAW, as a signatory: it closes (outcome ``rejected``),
    stays a draft that is locked until it is reopened, and a ``rejection``
    thread carries the reason. Sending it back to be worked on is
    ``request-changes``."""
    s = await _review_verdict(db, soaw_id, body, user, review_outcome.REJECTED)
    await db.commit()
    await db.refresh(s)
    return await _detail(db, s, user)


@router.post("/{soaw_id}/withdraw")
async def withdraw_soaw(
    soaw_id: str,
    body: RejectRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Withdraw a draft or a SoAW in review (``soaw.manage``): it closes
    (outcome ``withdrawn``, the reason as its note) until it is reopened. In
    review, the sign to-dos close and the pending signatories are told, as on
    a recall. 400 when signed, 409 ``closed`` when already closed."""
    await PermissionService.require_permission(db, user, "soaw.manage")
    s = await _get_soaw(db, soaw_id)
    _refuse(review_outcome.withdraw_refusal(s))
    label = soaw_service.soaw_label(s.name, s.revision_number)

    if s.status == "in_review":
        await _close_sign_todos(db, s)
        for sig in s.signatories or []:
            if sig["status"] == "pending":
                await notification_service.create_notification(
                    db,
                    user_id=uuid.UUID(sig["user_id"]),
                    actor_id=user.id,
                    notif_type="soaw_sign_recalled",
                    title="SoAW Withdrawn",
                    message=f'{user.display_name} withdrew "{label}": {body.comment}',
                    link=f"/ea-delivery/soaw/{soaw_id}",
                    data={
                        "soaw_id": soaw_id,
                        "soaw_name": s.name,
                        "revision_number": s.revision_number,
                        "outcome": review_outcome.WITHDRAWN,
                    },
                )

    s.signatories = []
    flag_modified(s, "signatories")
    s.status = "draft"
    review_outcome.set_outcome(s, review_outcome.WITHDRAWN, user=user, note=body.comment)
    await document_collab.on_workflow(
        db, document_collab.SOAW, s, "withdrawn", user=user, note=body.comment
    )
    await event_bus.publish(
        "soaw.withdrawn",
        {**_event_payload(s, user), "outcome": review_outcome.WITHDRAWN},
        db=db,
        user_id=user.id,
    )
    await db.commit()
    await db.refresh(s)
    return await _detail(db, s, user)


@router.post("/{soaw_id}/reopen")
async def reopen_soaw(
    soaw_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Reopen a rejected or withdrawn SoAW (``soaw.manage``): a plain,
    editable draft again. 409 ``not_closed`` otherwise."""
    await PermissionService.require_permission(db, user, "soaw.manage")
    s = await _get_soaw(db, soaw_id)
    _refuse(review_outcome.reopen_refusal(s))

    review_outcome.clear_outcome(s)
    await document_collab.on_workflow(db, document_collab.SOAW, s, "reopened", user=user)
    await event_bus.publish(
        "soaw.reopened",
        {**_event_payload(s, user), "outcome": None},
        db=db,
        user_id=user.id,
    )
    await db.commit()
    await db.refresh(s)
    return await _detail(db, s, user)


@router.post("/{soaw_id}/revise")
async def revise_soaw(
    soaw_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Create a new revision of a signed SoAW. Copies the document content
    into a new draft linked to the same initiative, numbered after the chain's
    highest revision, with parent_id pointing to the original. Refused (409)
    while the chain already has an unsigned revision, and on a signed revision
    that a later signed revision superseded."""
    await PermissionService.require_permission(db, user, "soaw.manage")
    s = await _get_soaw(db, soaw_id)
    chains = await soaw_service.load_chains(db)
    _refuse(soaw_service.revise_refusal(chains, s.id))

    new_revision = await soaw_service.create_revision(db, s, created_by=user.id, chains=chains)
    await db.commit()
    await db.refresh(new_revision)

    return await _respond(db, new_revision, user)


# ---------------------------------------------------------------------------
# Revision history
# ---------------------------------------------------------------------------


@router.get("/{soaw_id}/revisions")
async def list_revisions(
    soaw_id: str,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """List all revisions in the chain for this SoAW, in chain order (fork-safe;
    a dangling parent is a root)."""
    await PermissionService.require_permission(db, user, "soaw.view")
    s = await _get_soaw(db, soaw_id)
    chains = await soaw_service.load_chains(db)
    ids = soaw_service.chain_ids(chains, s.id)
    result = await db.execute(select(SoAW).where(SoAW.id.in_(ids)))
    by_id = {row.id: row for row in result.scalars().all()}
    return await _render(db, [_row_to_dict(by_id[i], chains) for i in ids if i in by_id], user)
