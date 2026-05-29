"""Mitigation-task service: occurrence lifecycle, recurrence, Todo sync, events.

Owns the per-occurrence state machine. The API layer in
``app/api/v1/risk_mitigation_tasks.py`` is a thin permission + serialization
wrapper around these helpers.

Recurrence is **completion-driven**: when an occurrence is marked done or
skipped, the next occurrence is created with ``due_date`` shifted by the
task's recurrence rule (calendar-correct month/year math — Jan 31 + 1
month → Feb 28). The first occurrence is created when the task itself is
created. One-shot tasks flip ``is_active = False`` once their single
occurrence terminates, so the UI can grey them out.

Each terminal transition snapshots ``task.owner_id`` into the occurrence's
``owner_at_completion`` column — that snapshot is the auditable answer to
"who signed off on the Jan 2024 review?" even after years of owner rotation.

**Lead-time gated visibility.** A new cycle lands as ``scheduled`` if the
current date is outside the task's lead-time window (``due_date -
lead_time_days``). Scheduled occurrences carry zero side effects — no
Todo, no notification — they exist purely for audit ("next review: due
2026-11-15"). The daily promotion loop in ``app.main`` calls
``promote_scheduled_occurrences`` to flip them to ``open`` when the
window opens, at which point the standard Todo + ``task_assigned``
notification fire. Users with ``risks.manage`` can also short-circuit
the wait via ``promote_single_occurrence``.

Todo synchronization mirrors the risk-owner pattern in
``api/v1/risks.py::sync_owner_todo``: one ``is_system`` Todo per **open**
occurrence keyed by a deep link, recreated for each new cycle of a
recurring task. Scheduled occurrences own no Todo.
"""

from __future__ import annotations

import logging
import re
import uuid
from datetime import date, datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.risk import Risk, RiskCard
from app.models.risk_mitigation_task import (
    RiskMitigationTask,
    RiskMitigationTaskOccurrence,
)
from app.models.todo import Todo
from app.services import notification_service
from app.services.event_bus import event_bus

# Pure calendar/lead-time math lives in the shared ``recurrence`` module so
# the recurring-Todo feature reuses the exact same logic. Re-exported here so
# the existing ``api/v1/risk_mitigation_tasks.py`` import path keeps working.
from app.services.recurrence import (
    RECURRENCE_UNITS,
    compute_next_due,
    default_lead_time_days,
    is_within_lead_window,
)
from app.services.recurrence import add_months as _add_months

logger = logging.getLogger(__name__)

OCCURRENCE_STATUSES = ("scheduled", "open", "done", "skipped")

__all__ = [
    "RECURRENCE_UNITS",
    "_add_months",
    "compute_next_due",
    "default_lead_time_days",
    "is_within_lead_window",
]

_TASK_REFERENCE_RE = re.compile(r"^T-(\d+)$")


async def next_task_reference(db: AsyncSession) -> str:
    """Return the next monotonic ``T-NNNNNN`` reference.

    Mirrors ``risk_service.next_reference``. Format is zero-padded to a
    minimum of 6 digits — past ``T-999999`` the format auto-widens (the
    column is ``String(16)``, matching ``risks.reference``). Race-safe in
    practice because the unique constraint rejects duplicates and the
    caller can retry.
    """
    result = await db.execute(select(RiskMitigationTask.reference))
    highest = 0
    for (ref,) in result.all():
        match = _TASK_REFERENCE_RE.match(ref or "")
        if match:
            highest = max(highest, int(match.group(1)))
    return f"T-{highest + 1:06d}"


# ---------------------------------------------------------------------------
# Pure helpers — calendar/lead-time math is shared with the recurring-Todo
# feature and lives in ``app.services.recurrence`` (re-exported above).
# ---------------------------------------------------------------------------


def is_recurring(task: RiskMitigationTask) -> bool:
    return task.recurrence_unit != "none"


def _occurrence_link(risk_id: uuid.UUID, task_id: uuid.UUID, occurrence_id: uuid.UUID) -> str:
    return f"/ea-delivery/risks/{risk_id}?task={task_id}#occurrence-{occurrence_id}"


def _task_anchor_link(risk_id: uuid.UUID, task_id: uuid.UUID) -> str:
    return f"/ea-delivery/risks/{risk_id}?task={task_id}"


# ---------------------------------------------------------------------------
# Audit fan-out
# ---------------------------------------------------------------------------


async def _linked_card_ids(db: AsyncSession, risk_id: uuid.UUID) -> list[uuid.UUID]:
    res = await db.execute(select(RiskCard.card_id).where(RiskCard.risk_id == risk_id))
    return [cid for (cid,) in res.all()]


async def publish_task_event(
    db: AsyncSession,
    *,
    risk: Risk,
    task: RiskMitigationTask,
    event_type: str,
    actor_id: uuid.UUID | None,
    occurrence: RiskMitigationTaskOccurrence | None = None,
    extra: dict[str, Any] | None = None,
) -> None:
    """Fan out a mitigation-task event to every linked card so the
    per-card history timeline picks it up — same pattern as
    ``risks._publish_risk_event``.
    """
    card_ids = await _linked_card_ids(db, risk.id)
    if not card_ids:
        return
    payload: dict[str, Any] = {
        "risk_id": str(risk.id),
        "reference": risk.reference,
        "task_id": str(task.id),
        "title": task.title,
        "recurrence_unit": task.recurrence_unit,
        "recurrence_interval": task.recurrence_interval,
        "link": _task_anchor_link(risk.id, task.id),
    }
    if occurrence is not None:
        payload.update(
            {
                "occurrence_id": str(occurrence.id),
                "sequence": occurrence.sequence,
                "status": occurrence.status,
                "assigned_owner_id": (
                    str(occurrence.assigned_owner_id) if occurrence.assigned_owner_id else None
                ),
                "completed_by": (str(occurrence.completed_by) if occurrence.completed_by else None),
                "owner_at_completion": (
                    str(occurrence.owner_at_completion) if occurrence.owner_at_completion else None
                ),
            }
        )
    if extra:
        payload.update(extra)
    for cid in card_ids:
        await event_bus.publish(
            event_type,
            payload,
            db=db,
            card_id=cid,
            user_id=actor_id,
        )


# ---------------------------------------------------------------------------
# Todo sync for an open occurrence
# ---------------------------------------------------------------------------


async def _existing_todo_for_occurrence(db: AsyncSession, link: str) -> Todo | None:
    res = await db.execute(select(Todo).where(Todo.link == link, Todo.is_system.is_(True)))
    return res.scalar_one_or_none()


async def _fire_task_assigned_notification(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    risk: Risk,
    task: RiskMitigationTask,
    link: str,
    actor_id: uuid.UUID | None,
) -> None:
    try:
        await notification_service.create_notification(
            db,
            user_id=user_id,
            notif_type="task_assigned",
            title=f"Mitigation task assigned: {task.title[:160]}",
            message=f"Risk {risk.reference}",
            link=link,
            data={
                "risk_id": str(risk.id),
                "task_id": str(task.id),
                "reference": risk.reference,
            },
            actor_id=actor_id,
        )
    except Exception:  # noqa: BLE001
        logger.exception("Mitigation-task assignment notification failed")


async def sync_occurrence_todo(
    db: AsyncSession,
    *,
    risk: Risk,
    task: RiskMitigationTask,
    occurrence: RiskMitigationTaskOccurrence,
    actor_id: uuid.UUID | None,
    previous_assigned_owner: uuid.UUID | None,
    notify_on_change: bool = True,
) -> None:
    """Keep one ``is_system`` Todo per occurrence in sync with state.

    * Occurrence ``open`` + assignee set → upsert a Todo with status
      ``open`` (shows up in the assignee's "Open" tab on ``/todos``).
    * Occurrence terminal (``done`` / ``skipped``) → mark the existing
      Todo as ``done`` so it falls out of the open-todos badge count
      but stays visible in the assignee's "Done" tab. Mirrors the
      lifecycle of a regular manually-completed Todo.
    * Occurrence ``scheduled`` (dormant) → delete any Todo. The cycle
      is invisible to the assignee until the daily promotion loop
      activates it.
    * Occurrence ``open`` + no assignee → delete the Todo (no recipient).
    * When ``assigned_owner_id`` changes on an open occurrence, fire a
      ``task_assigned`` notification to the new owner (whitelisted for
      self-assignment).

    Task deletion takes the destructive path via ``delete_task_todo``,
    which wipes every Todo linked to the task — including the historical
    ``done`` rows — so the assignee doesn't keep references to a task
    that no longer exists.
    """
    link = _occurrence_link(risk.id, task.id, occurrence.id)
    existing = await _existing_todo_for_occurrence(db, link)

    if occurrence.status in ("done", "skipped"):
        # Keep the row so the assignee's Done tab carries a history of
        # closed mitigation cycles. We don't reassign or rewrite the
        # description — those snapshots reflect who carried the work and
        # what the cycle was about at the moment it closed.
        if existing is not None:
            existing.status = "done"
        return

    # "scheduled" or "open"-but-unassigned: no Todo should exist.
    if occurrence.status != "open" or occurrence.assigned_owner_id is None:
        if existing is not None:
            await db.delete(existing)
        return

    description = f"[Risk {risk.reference}] {task.title}"
    if existing is not None:
        existing.assigned_to = occurrence.assigned_owner_id
        existing.description = description
        existing.due_date = occurrence.due_date
        existing.status = "open"
    else:
        db.add(
            Todo(
                id=uuid.uuid4(),
                card_id=None,
                description=description,
                status="open",
                link=link,
                is_system=True,
                assigned_to=occurrence.assigned_owner_id,
                created_by=actor_id,
                due_date=occurrence.due_date,
            )
        )

    if notify_on_change and occurrence.assigned_owner_id != previous_assigned_owner:
        await _fire_task_assigned_notification(
            db,
            user_id=occurrence.assigned_owner_id,
            risk=risk,
            task=task,
            link=link,
            actor_id=actor_id,
        )


# ---------------------------------------------------------------------------
# Task / occurrence lifecycle
# ---------------------------------------------------------------------------


async def create_task_with_first_occurrence(
    db: AsyncSession,
    *,
    risk: Risk,
    title: str,
    description: str | None,
    owner_id: uuid.UUID | None,
    due_date: date | None,
    recurrence_unit: str,
    recurrence_interval: int,
    actor_id: uuid.UUID,
    lead_time_days: int | None = None,
) -> tuple[RiskMitigationTask, RiskMitigationTaskOccurrence]:
    """Create the task + occurrence #1 in a single transaction.

    Caller is responsible for ``db.commit()``.

    The first occurrence lands as ``"open"`` when today is already inside
    the lead-time window (or there's no due date), and ``"scheduled"``
    otherwise — same rule as recurrence roll-forwards in
    ``_terminate_occurrence``. When ``lead_time_days`` is ``None`` the
    smart per-unit default is applied; one-shot tasks naturally get 0
    and behave the same as before this feature shipped.
    """
    if recurrence_unit not in RECURRENCE_UNITS:
        raise ValueError(f"Invalid recurrence_unit: {recurrence_unit}")
    if recurrence_interval < 1:
        raise ValueError("recurrence_interval must be >= 1")

    if lead_time_days is None:
        lead_time_days = default_lead_time_days(recurrence_unit, recurrence_interval)
    lead_time_days = max(0, int(lead_time_days))

    today = datetime.now(timezone.utc).date()
    # Lead-time gating only applies to **recurring** tasks. A one-shot
    # task is a discrete piece of work — sitting it in "scheduled" until
    # the due date arrives would hide it from the assignee for weeks /
    # months without purpose. Always open one-shots immediately so they
    # behave like a regular dated Todo.
    if recurrence_unit == "none":
        initial_status = "open"
    else:
        initial_status = (
            "open" if is_within_lead_window(due_date, lead_time_days, today) else "scheduled"
        )

    reference = await next_task_reference(db)
    task = RiskMitigationTask(
        id=uuid.uuid4(),
        reference=reference,
        risk_id=risk.id,
        title=title,
        description=description,
        owner_id=owner_id,
        recurrence_unit=recurrence_unit,
        recurrence_interval=recurrence_interval,
        lead_time_days=lead_time_days,
        is_active=True,
        created_by=actor_id,
    )
    db.add(task)
    await db.flush()

    occurrence = RiskMitigationTaskOccurrence(
        id=uuid.uuid4(),
        task_id=task.id,
        sequence=1,
        assigned_owner_id=owner_id,
        due_date=due_date,
        status=initial_status,
    )
    db.add(occurrence)
    await db.flush()

    # Todo + notification fire only for the open path; sync_occurrence_todo
    # is a no-op on scheduled occurrences (they own no Todo).
    await sync_occurrence_todo(
        db,
        risk=risk,
        task=task,
        occurrence=occurrence,
        actor_id=actor_id,
        previous_assigned_owner=None,
    )
    await publish_task_event(
        db,
        risk=risk,
        task=task,
        event_type="risk_mitigation_task.created",
        actor_id=actor_id,
        occurrence=occurrence,
    )
    return task, occurrence


async def latest_occurrence(
    db: AsyncSession, task_id: uuid.UUID
) -> RiskMitigationTaskOccurrence | None:
    res = await db.execute(
        select(RiskMitigationTaskOccurrence)
        .where(RiskMitigationTaskOccurrence.task_id == task_id)
        .order_by(RiskMitigationTaskOccurrence.sequence.desc())
        .limit(1)
    )
    return res.scalar_one_or_none()


async def open_occurrence(
    db: AsyncSession, task_id: uuid.UUID
) -> RiskMitigationTaskOccurrence | None:
    """Return the single currently-open occurrence, if any.

    Excludes scheduled cycles by design — callers that want "the live
    cycle regardless of whether it's been activated yet" should use
    :func:`current_active_occurrence` instead.
    """
    res = await db.execute(
        select(RiskMitigationTaskOccurrence)
        .where(
            RiskMitigationTaskOccurrence.task_id == task_id,
            RiskMitigationTaskOccurrence.status == "open",
        )
        .order_by(RiskMitigationTaskOccurrence.sequence.desc())
        .limit(1)
    )
    return res.scalar_one_or_none()


async def current_active_occurrence(
    db: AsyncSession, task_id: uuid.UUID
) -> RiskMitigationTaskOccurrence | None:
    """Return the live cycle for a task — scheduled or open.

    There is at most one non-terminal occurrence per task at any time
    (the next cycle is only created when the previous one terminates),
    so the latest-sequence row with a non-terminal status is the live
    cycle. Used by owner-change propagation and due-date edits so they
    operate on the right row whether the cycle is dormant or active.
    """
    res = await db.execute(
        select(RiskMitigationTaskOccurrence)
        .where(
            RiskMitigationTaskOccurrence.task_id == task_id,
            RiskMitigationTaskOccurrence.status.in_(("scheduled", "open")),
        )
        .order_by(RiskMitigationTaskOccurrence.sequence.desc())
        .limit(1)
    )
    return res.scalar_one_or_none()


async def list_occurrences(
    db: AsyncSession, task_id: uuid.UUID
) -> list[RiskMitigationTaskOccurrence]:
    res = await db.execute(
        select(RiskMitigationTaskOccurrence)
        .where(RiskMitigationTaskOccurrence.task_id == task_id)
        .order_by(RiskMitigationTaskOccurrence.sequence.desc())
    )
    return list(res.scalars().all())


async def _terminate_occurrence(
    db: AsyncSession,
    *,
    risk: Risk,
    task: RiskMitigationTask,
    occurrence: RiskMitigationTaskOccurrence,
    new_status: str,
    actor_id: uuid.UUID,
    notes: str | None,
) -> RiskMitigationTaskOccurrence | None:
    """Mark an occurrence done or skipped, snapshot owner-at-completion,
    advance recurrence, and emit Todo + event side-effects.

    Returns the newly-created next occurrence for recurring tasks, else
    ``None`` for one-shot tasks (or recurring tasks that have been
    deactivated by setting ``is_active = False``).
    """
    if new_status not in ("done", "skipped"):
        raise ValueError(f"Invalid terminal status: {new_status}")
    if occurrence.status != "open":
        raise ValueError(f"Occurrence is already {occurrence.status}")

    occurrence.status = new_status
    occurrence.completed_at = datetime.now(timezone.utc)
    occurrence.completed_by = actor_id
    # Snapshot the *current* task owner — may differ from
    # assigned_owner_id if the owner was changed mid-cycle.
    occurrence.owner_at_completion = task.owner_id
    occurrence.completion_notes = notes
    await db.flush()

    # Close the Todo on the assignee.
    await sync_occurrence_todo(
        db,
        risk=risk,
        task=task,
        occurrence=occurrence,
        actor_id=actor_id,
        previous_assigned_owner=occurrence.assigned_owner_id,
        notify_on_change=False,
    )

    event_type = (
        "risk_mitigation_task.completed" if new_status == "done" else "risk_mitigation_task.skipped"
    )
    await publish_task_event(
        db,
        risk=risk,
        task=task,
        event_type=event_type,
        actor_id=actor_id,
        occurrence=occurrence,
        extra={"completion_notes": notes} if notes else None,
    )

    # Recurrence: completion-driven roll-forward.
    if not is_recurring(task) or not task.is_active:
        # One-shot task — deactivate so the UI greys it out and so future
        # PATCHes don't inadvertently spawn another occurrence.
        if not is_recurring(task):
            task.is_active = False
            await db.flush()
        return None

    base_due = occurrence.due_date or datetime.now(timezone.utc).date()
    next_due = compute_next_due(base_due, task.recurrence_unit, task.recurrence_interval)
    if next_due is None:
        return None

    # Lead-time gate: the next cycle lands as ``scheduled`` if today is
    # still outside the window, ``open`` otherwise. Scheduled cycles
    # carry no Todo and fire no notification — they exist for audit
    # ("next review: due 2026-11-15") and become live when the daily
    # promotion loop flips them on the right day.
    today = datetime.now(timezone.utc).date()
    next_status = (
        "open" if is_within_lead_window(next_due, task.lead_time_days, today) else "scheduled"
    )

    next_occurrence = RiskMitigationTaskOccurrence(
        id=uuid.uuid4(),
        task_id=task.id,
        sequence=occurrence.sequence + 1,
        assigned_owner_id=task.owner_id,
        due_date=next_due,
        status=next_status,
    )
    db.add(next_occurrence)
    await db.flush()

    # sync_occurrence_todo no-ops on scheduled cycles, so the Todo only
    # lands once the cycle is promoted. The "fresh assignment" semantic
    # below (previous_assigned_owner=None) still drives a notification
    # exactly once per cycle — either now (if directly opened) or at
    # promotion time.
    await sync_occurrence_todo(
        db,
        risk=risk,
        task=task,
        occurrence=next_occurrence,
        actor_id=actor_id,
        # Treat the new occurrence as a fresh assignment so the assignee
        # gets a "your control review is back" notification — even if it
        # is the same person who completed the previous cycle.
        previous_assigned_owner=None,
    )
    await publish_task_event(
        db,
        risk=risk,
        task=task,
        event_type="risk_mitigation_task.created",
        actor_id=actor_id,
        occurrence=next_occurrence,
        extra={"rolled_from_occurrence_id": str(occurrence.id)},
    )
    return next_occurrence


async def complete_occurrence(
    db: AsyncSession,
    *,
    risk: Risk,
    task: RiskMitigationTask,
    occurrence: RiskMitigationTaskOccurrence,
    actor_id: uuid.UUID,
    notes: str | None,
) -> RiskMitigationTaskOccurrence | None:
    return await _terminate_occurrence(
        db,
        risk=risk,
        task=task,
        occurrence=occurrence,
        new_status="done",
        actor_id=actor_id,
        notes=notes,
    )


async def skip_occurrence(
    db: AsyncSession,
    *,
    risk: Risk,
    task: RiskMitigationTask,
    occurrence: RiskMitigationTaskOccurrence,
    actor_id: uuid.UUID,
    notes: str | None,
) -> RiskMitigationTaskOccurrence | None:
    return await _terminate_occurrence(
        db,
        risk=risk,
        task=task,
        occurrence=occurrence,
        new_status="skipped",
        actor_id=actor_id,
        notes=notes,
    )


async def apply_task_owner_change(
    db: AsyncSession,
    *,
    risk: Risk,
    task: RiskMitigationTask,
    previous_owner: uuid.UUID | None,
    actor_id: uuid.UUID,
) -> None:
    """Propagate a parent-task owner change to the current open occurrence.

    Past completed occurrences are immutable — they keep their
    ``assigned_owner_id`` and ``owner_at_completion`` snapshots so the
    audit trail stays honest.
    """
    if task.owner_id == previous_owner:
        return
    current = await current_active_occurrence(db, task.id)
    if current is None:
        return
    previous_assignee = current.assigned_owner_id
    current.assigned_owner_id = task.owner_id
    await db.flush()
    await sync_occurrence_todo(
        db,
        risk=risk,
        task=task,
        occurrence=current,
        actor_id=actor_id,
        previous_assigned_owner=previous_assignee,
    )


async def promote_single_occurrence(
    db: AsyncSession,
    *,
    risk: Risk,
    task: RiskMitigationTask,
    occurrence: RiskMitigationTaskOccurrence,
    actor_id: uuid.UUID | None,
) -> bool:
    """Promote a single ``scheduled`` occurrence to ``open`` immediately.

    Returns ``True`` if the occurrence was promoted, ``False`` if it was
    already open (idempotent — re-calling on an already-open cycle is a
    no-op so a double-click on "Activate now" can't double-fire side
    effects). Raises ``ValueError`` for terminal cycles, which would be
    a programmer error to promote.
    """
    if occurrence.status == "open":
        return False
    if occurrence.status != "scheduled":
        raise ValueError(f"Cannot promote occurrence with status={occurrence.status!r}")

    occurrence.status = "open"
    occurrence.activated_at = datetime.now(timezone.utc)
    # Sync assigned_owner_id to the task's current owner — between
    # scheduling and activation the owner may have rotated, and the
    # cycle should land on the current owner's Todo.
    if occurrence.assigned_owner_id != task.owner_id:
        occurrence.assigned_owner_id = task.owner_id
    await db.flush()

    await sync_occurrence_todo(
        db,
        risk=risk,
        task=task,
        occurrence=occurrence,
        actor_id=actor_id,
        previous_assigned_owner=None,
    )
    await publish_task_event(
        db,
        risk=risk,
        task=task,
        event_type="risk_mitigation_task.activated",
        actor_id=actor_id,
        occurrence=occurrence,
        extra={"activated_at": occurrence.activated_at.isoformat()},
    )
    return True


async def promote_scheduled_occurrences(
    db: AsyncSession,
    *,
    actor_id: uuid.UUID | None = None,
    today: date | None = None,
) -> int:
    """Promote every ``scheduled`` occurrence whose lead window has opened.

    Called daily by the background loop in :mod:`app.main` and also
    available for manual / test invocation. Returns the number of
    occurrences promoted so the caller can log it.

    ``actor_id`` is the user id stamped on the resulting events and Todo
    rows. The background loop passes ``None`` so the system-driven
    activation is attributable to "the system" — Todo.created_by accepts
    NULL via its FK SET NULL clause.
    """
    if today is None:
        today = datetime.now(timezone.utc).date()

    # Pull every scheduled occurrence alongside its task (lead_time_days
    # lives on the task row, not the occurrence). Volume is tiny in
    # practice — a few per active recurring task — so a join + Python
    # filter on the window predicate is simpler than encoding the date
    # arithmetic in SQL.
    res = await db.execute(
        select(RiskMitigationTaskOccurrence, RiskMitigationTask)
        .join(
            RiskMitigationTask,
            RiskMitigationTask.id == RiskMitigationTaskOccurrence.task_id,
        )
        .where(RiskMitigationTaskOccurrence.status == "scheduled")
    )
    rows = list(res.all())
    if not rows:
        return 0

    promoted = 0
    for occurrence, task in rows:
        if not is_within_lead_window(occurrence.due_date, task.lead_time_days, today):
            continue
        risk = await db.get(Risk, task.risk_id)
        if risk is None:
            # Parent risk gone (cascade would have deleted the task too,
            # so this is a no-op safety net rather than an expected path).
            continue
        await promote_single_occurrence(
            db,
            risk=risk,
            task=task,
            occurrence=occurrence,
            # The daily loop has no real-user context, so attribute the
            # promotion to the task creator when known (falls back to
            # NULL — system Todo.created_by + event.user_id both accept
            # NULL via their SET NULL FK clauses).
            actor_id=actor_id or task.created_by,
        )
        promoted += 1
    return promoted


async def delete_task_todo(
    db: AsyncSession,
    *,
    risk: Risk,
    task: RiskMitigationTask,
) -> None:
    """Clean up any system Todos linked to this task's occurrences.

    Called from the DELETE endpoint before the task row is removed so
    cascade doesn't orphan Todo rows. The Todo ``link`` is keyed on
    ``risk_id?task=task_id`` which uniquely identifies all occurrences.
    """
    prefix = f"/ea-delivery/risks/{risk.id}?task={task.id}"
    res = await db.execute(
        select(Todo).where(Todo.is_system.is_(True), Todo.link.like(f"{prefix}%"))
    )
    for todo in res.scalars().all():
        await db.delete(todo)


# ---------------------------------------------------------------------------
# Serialization
# ---------------------------------------------------------------------------


async def _user_name(db: AsyncSession, user_id: uuid.UUID | None) -> str | None:
    if user_id is None:
        return None
    from app.models.user import User

    user = await db.get(User, user_id)
    return user.display_name if user else None


async def occurrence_to_dict(
    db: AsyncSession, occurrence: RiskMitigationTaskOccurrence
) -> dict[str, Any]:
    return {
        "id": str(occurrence.id),
        "task_id": str(occurrence.task_id),
        "sequence": occurrence.sequence,
        "assigned_owner_id": (
            str(occurrence.assigned_owner_id) if occurrence.assigned_owner_id else None
        ),
        "assigned_owner_name": await _user_name(db, occurrence.assigned_owner_id),
        "due_date": occurrence.due_date,
        "status": occurrence.status,
        "activated_at": occurrence.activated_at,
        "completed_at": occurrence.completed_at,
        "completed_by": (str(occurrence.completed_by) if occurrence.completed_by else None),
        "completed_by_name": await _user_name(db, occurrence.completed_by),
        "owner_at_completion": (
            str(occurrence.owner_at_completion) if occurrence.owner_at_completion else None
        ),
        "owner_at_completion_name": await _user_name(db, occurrence.owner_at_completion),
        "completion_notes": occurrence.completion_notes,
        "created_at": occurrence.created_at,
        "updated_at": occurrence.updated_at,
    }


async def task_to_dict(
    db: AsyncSession,
    task: RiskMitigationTask,
    *,
    include_occurrences: bool = True,
) -> dict[str, Any]:
    occurrences_data: list[dict[str, Any]] = []
    if include_occurrences:
        occurrences = await list_occurrences(db, task.id)
        for occ in occurrences:
            occurrences_data.append(await occurrence_to_dict(db, occ))

    return {
        "id": str(task.id),
        "reference": task.reference,
        "risk_id": str(task.risk_id),
        "title": task.title,
        "description": task.description,
        "owner_id": str(task.owner_id) if task.owner_id else None,
        "owner_name": await _user_name(db, task.owner_id),
        "recurrence_unit": task.recurrence_unit,
        "recurrence_interval": task.recurrence_interval,
        "lead_time_days": task.lead_time_days,
        "is_active": task.is_active,
        "created_by": str(task.created_by) if task.created_by else None,
        "created_at": task.created_at,
        "updated_at": task.updated_at,
        "occurrences": occurrences_data,
    }


async def tasks_for_risk(db: AsyncSession, risk_id: uuid.UUID) -> list[RiskMitigationTask]:
    res = await db.execute(
        select(RiskMitigationTask)
        .where(RiskMitigationTask.risk_id == risk_id)
        .order_by(RiskMitigationTask.is_active.desc(), RiskMitigationTask.created_at.asc())
    )
    return list(res.scalars().all())


async def tasks_for_risks(db: AsyncSession, risk_ids: list[uuid.UUID]) -> list[RiskMitigationTask]:
    """Bulk-load tasks for many risks in a single query.

    Used by the register-level Excel export so we hit the DB once rather
    than looping per-risk. Ordered by risk_id then created_at so callers
    can group rows without resorting.
    """
    if not risk_ids:
        return []
    res = await db.execute(
        select(RiskMitigationTask)
        .where(RiskMitigationTask.risk_id.in_(risk_ids))
        .order_by(RiskMitigationTask.risk_id, RiskMitigationTask.created_at.asc())
    )
    return list(res.scalars().all())
