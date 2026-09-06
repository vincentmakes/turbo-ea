"""Reverse the writes performed under a mutation batch (S7).

A rollback walks the events emitted under a ``batch_id`` in reverse
order and applies the inverse of each one. We never delete history —
the rollback is itself recorded as a *new* batch that references the
original via ``summary.reverses_batch_id`` so the audit log shows the
full causal chain.

Inverse operations (the ``_INVERSES`` table is the single list):

- ``card.created`` → hard delete the card (and clean up its relations).
- ``card.updated`` → restore the ``old`` value of every changed field
  from ``event.data.changes``.
- ``card.archived`` / ``card.restored`` → restore / re-archive.
- ``relation.created`` (``relation.upserted`` on older rows) → delete
  the relation.
- ``risk.added`` with ``created`` → delete the risk the batch raised, the
  way ``DELETE /risks/{id}`` does (owner Todo, compliance back-links,
  the cascade); ``risk.added`` without it → unlink that one card.
- ``risk.updated`` with ``changes`` → restore the old values (levels
  re-derived, the owner's Todo re-synced).
- ``stakeholder.added`` / ``stakeholder.removed`` / ``stakeholder.role_changed``
  → remove / re-assign / restore the role, then rescore the card.
- ``tag.added`` / ``tag.removed`` → remove / re-add the tag, then rescore.
- ``adr.created`` → delete the decision while it is still a draft.
- ``todo.created`` **by an extension** (``data["ext"]`` set — a rule or a
  sync wrote it) → delete the todo while it is still open. A person's own
  todo is a request to a person and stays; so does one already completed,
  and one core's recurrence rolled forward.

Deliberately NOT reversed, and reported under ``unsupported_events`` so the
caller sees the coverage before committing: **todos a person created** (a
todo is a request to a person, and reopening or deleting one behind their
back is not an undo), **notifications** (already delivered), ``risk.removed`` (no snapshot
to rebuild from — deletion is a human act), and anything else whose
handler publishes no structured ``before`` state (comments, documents,
SoAW, ADR transitions).

Duplicate ops collapse: a risk event fans out one row per linked card and
a relation event lands on both ends, so the plan dedupes on the target id
rather than listing the same reversal twice.

Conflict detection: for every entity the batch touched, we scan
``events.batch_id`` for *any later* batch that modified it. When such a
later batch exists and ``force=False``, the rollback refuses with a
structured list of conflicting batches so the caller can decide
whether to force or rebase manually. ``force=True`` accepts the data
loss and proceeds.

Every inverse op is published as ``rollback.<op>`` with the op dict as
payload. That payload must never carry a top-level ``user_id``: the SSE
stream forwards any event whose ``data.user_id`` matches a subscriber
(``api/v1/events.py``), so a stakeholder op names the person under
``stakeholder_user_id`` instead.
"""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable
from datetime import date, datetime, timezone
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.architecture_decision import ArchitectureDecision
from app.models.card import Card
from app.models.event import Event
from app.models.mutation_batch import MutationBatch
from app.models.relation import Relation
from app.models.risk import Risk, RiskCard
from app.models.risk_mitigation_task import RiskMitigationTask
from app.models.stakeholder import Stakeholder
from app.models.survey import Survey, SurveyResponse
from app.models.tag import CardTag, Tag
from app.models.todo import Todo
from app.services.event_bus import event_bus
from app.services.mutation_batch_service import batch_to_dict, create_batch

# ---------------------------------------------------------------------------
# Planning
# ---------------------------------------------------------------------------


def _card_id_of(event: Event, data: dict) -> str | None:
    return data.get("id") or (str(event.card_id) if event.card_id else None)


def _event_card_id(event: Event) -> str | None:
    return str(event.card_id) if event.card_id else None


def _unsupported(event: Event, reason: str | None = None) -> dict[str, Any]:
    et = event.event_type
    return {
        "event_id": str(event.id),
        "op": "unsupported",
        "event_type": et,
        "reason": reason
        or (
            f"{et} cannot be reversed automatically — the originating handler "
            "does not publish a structured snapshot the rollback engine can replay."
        ),
    }


def _plan_card_created(event: Event, data: dict) -> dict[str, Any]:
    return {"op": "delete_card", "card_id": _card_id_of(event, data)}


def _plan_card_archived(event: Event, data: dict) -> dict[str, Any]:
    return {"op": "restore_card", "card_id": _card_id_of(event, data)}


def _plan_card_restored(event: Event, data: dict) -> dict[str, Any]:
    return {"op": "archive_card", "card_id": _card_id_of(event, data)}


def _plan_card_updated(event: Event, data: dict) -> dict[str, Any]:
    changes = data.get("changes") or {}
    return {
        "op": "restore_card_fields",
        "card_id": _card_id_of(event, data),
        "fields": {k: v.get("old") for k, v in changes.items()},
    }


def _plan_relation_created(event: Event, data: dict) -> dict[str, Any]:
    return {"op": "delete_relation", "relation_id": data.get("id")}


def _plan_risk_added(event: Event, data: dict) -> dict[str, Any]:
    risk_id = data.get("risk_id")
    if not risk_id:
        return _unsupported(event, "risk.added carries no risk id")
    detail = data.get("reference") or ""
    if data.get("created"):
        return {"op": "delete_risk", "risk_id": risk_id, "detail": detail}
    return {
        "op": "unlink_risk_card",
        "risk_id": risk_id,
        "card_id": _event_card_id(event),
        "detail": detail,
    }


def _plan_risk_updated(event: Event, data: dict) -> dict[str, Any]:
    risk_id = data.get("risk_id")
    changes = data.get("changes")
    if not risk_id or not isinstance(changes, dict) or not changes:
        return _unsupported(
            event,
            "risk.updated recorded only the names of the changed fields, not their "
            "previous values (rows written before 2.127.0).",
        )
    return {
        "op": "restore_risk_fields",
        "risk_id": risk_id,
        "fields": {k: (v or {}).get("old") for k, v in changes.items()},
        "detail": data.get("reference") or "",
    }


def _stakeholder_target(event: Event, data: dict) -> dict[str, Any]:
    return {
        "card_id": _event_card_id(event),
        "stakeholder_user_id": data.get("user_id"),
        "role": data.get("role"),
        "detail": data.get("summary") or data.get("role_label") or data.get("role") or "",
    }


def _plan_stakeholder_added(event: Event, data: dict) -> dict[str, Any]:
    return {"op": "remove_stakeholder", **_stakeholder_target(event, data)}


def _plan_stakeholder_removed(event: Event, data: dict) -> dict[str, Any]:
    return {"op": "assign_stakeholder", **_stakeholder_target(event, data)}


def _plan_stakeholder_role_changed(event: Event, data: dict) -> dict[str, Any]:
    old_role = data.get("old_role")
    if not old_role:
        return _unsupported(event, "stakeholder.role_changed carries no previous role")
    return {
        "op": "restore_stakeholder_role",
        "card_id": _event_card_id(event),
        "stakeholder_user_id": data.get("user_id"),
        "role": data.get("new_role") or data.get("role"),
        "old_role": old_role,
        "detail": data.get("old_role_label") or old_role,
    }


def _tag_target(event: Event, data: dict) -> dict[str, Any]:
    return {
        "card_id": _event_card_id(event),
        "tag_id": data.get("tag_id"),
        "detail": data.get("tag_name") or "",
    }


def _plan_tag_added(event: Event, data: dict) -> dict[str, Any]:
    return {"op": "remove_card_tag", **_tag_target(event, data)}


def _plan_tag_removed(event: Event, data: dict) -> dict[str, Any]:
    return {"op": "add_card_tag", **_tag_target(event, data)}


def _plan_adr_created(event: Event, data: dict) -> dict[str, Any]:
    adr_id = data.get("adr_id") or data.get("id")
    if not adr_id:
        return _unsupported(event, "adr.created carries no decision id")
    return {"op": "delete_adr", "adr_id": adr_id, "detail": data.get("reference_number") or ""}


def _plan_survey_sent(event: Event, data: dict) -> dict[str, Any]:
    """One ``survey.sent`` event per surveyed card, one reversal per survey
    (deduped on ``survey_id``): close it and drop the requests nobody has
    answered yet. Answers already given stay — they are people's work."""
    survey_id = data.get("survey_id")
    if not survey_id:
        return _unsupported(event, "survey.sent carries no survey id")
    return {
        "op": "close_survey",
        "survey_id": survey_id,
        "detail": (data.get("name") or "")[:80],
    }


def _plan_todo_created(event: Event, data: dict) -> dict[str, Any]:
    """Only a todo an extension wrote is the batch's to take back: a rule
    that misfired on fifty cards left fifty requests nobody asked for. A
    human's todo, and the next occurrence core's own recurrence opened, keep
    the standing decline below."""
    if not data.get("ext"):
        return _unsupported(event, f"{event.event_type} is not reversed: {_DECLINED['todo.']}")
    if data.get("rolled_forward"):
        return _unsupported(
            event,
            f"{event.event_type} is not reversed: the next occurrence of a recurring "
            "todo is opened by Turbo EA, not by the extension.",
        )
    todo_id = data.get("todo_id") or data.get("id")
    if not todo_id:
        return _unsupported(event, "todo.created carries no todo id")
    return {
        "op": "delete_todo",
        "todo_id": todo_id,
        "detail": (data.get("description") or "")[:80],
    }


_INVERSES: dict[str, Callable[[Event, dict], dict[str, Any]]] = {
    "card.created": _plan_card_created,
    "card.archived": _plan_card_archived,
    "card.restored": _plan_card_restored,
    "card.updated": _plan_card_updated,
    "relation.created": _plan_relation_created,
    "relation.upserted": _plan_relation_created,  # legacy name on old rows
    "risk.added": _plan_risk_added,
    "risk.updated": _plan_risk_updated,
    "stakeholder.added": _plan_stakeholder_added,
    "stakeholder.removed": _plan_stakeholder_removed,
    "stakeholder.role_changed": _plan_stakeholder_role_changed,
    "tag.added": _plan_tag_added,
    "tag.removed": _plan_tag_removed,
    "adr.created": _plan_adr_created,
    "todo.created": _plan_todo_created,
    "survey.sent": _plan_survey_sent,
}

# Event families that are never reversed, with the reason the plan reports.
_DECLINED: dict[str, str] = {
    "todo.": "Todos are requests to people; reopening or deleting one is not an undo.",
    "notification.": "A notification has already been delivered.",
    "risk.removed": "A deleted risk cannot be rebuilt — no snapshot is recorded.",
}

# Ops whose events repeat per linked card or per relation end: one reversal.
_DEDUPE_KEYS: dict[str, tuple[str, ...]] = {
    "delete_risk": ("risk_id",),
    "restore_risk_fields": ("risk_id",),
    "delete_relation": ("relation_id",),
    "delete_adr": ("adr_id",),
    "delete_card": ("card_id",),
    "delete_todo": ("todo_id",),
    "close_survey": ("survey_id",),
}


def _plan_inverse(event: Event) -> dict[str, Any]:
    """Return the inverse-op dict for a single event, or an ``unsupported``
    marker when the event type is not reversed."""
    et = event.event_type
    data = event.data or {}
    planner = _INVERSES.get(et)
    if planner is not None and et.startswith("todo."):
        # The one family with a planner AND a decline: the planner decides
        # per event (extension-written or not), so it runs first.
        op = planner(event, data)
        if op.get("op") == "unsupported":
            return op
        return {"event_id": str(event.id), **op}
    for prefix, reason in _DECLINED.items():
        if et == prefix or (prefix.endswith(".") and et.startswith(prefix)):
            return _unsupported(event, f"{et} is not reversed: {reason}")
    planner = _INVERSES.get(et)
    if planner is None:
        return _unsupported(event)
    op = planner(event, data)
    if op.get("op") == "unsupported":
        return op
    return {"event_id": str(event.id), **op}


def plan_ops(events: list[Event]) -> list[dict[str, Any]]:
    """The inverse of every event in ``events`` (already in the order they
    are to be applied), duplicates collapsed on their target."""
    ops: list[dict[str, Any]] = []
    seen: set[tuple] = set()
    for ev in events:
        op = _plan_inverse(ev)
        keys = _DEDUPE_KEYS.get(op["op"])
        if keys:
            marker = (op["op"], *(op.get(k) for k in keys))
            if marker in seen:
                continue
            seen.add(marker)
        ops.append(op)
    return ops


# ---------------------------------------------------------------------------
# Conflicts
# ---------------------------------------------------------------------------


def _entity_ref(event: Event) -> tuple[str, str] | None:
    """``(kind, id)`` of the entity an event wrote to, for conflict scans."""
    data = event.data or {}
    et = event.event_type
    if et.startswith("card."):
        ent = data.get("id") or (str(event.card_id) if event.card_id else None)
        return ("card", ent) if ent else None
    if et.startswith("relation."):
        ent = data.get("id")
        return ("relation", ent) if ent else None
    if et.startswith("risk."):
        ent = data.get("risk_id")
        return ("risk", ent) if ent else None
    if et.startswith("adr."):
        ent = data.get("adr_id") or data.get("id")
        return ("adr", ent) if ent else None
    if et.startswith(("stakeholder.", "tag.")):
        return ("card", str(event.card_id)) if event.card_id else None
    return None


async def _entities_touched(events: list[Event]) -> dict[str, set[str]]:
    """Group entity ids by kind so we can scan for later batches that
    touched them."""
    by_kind: dict[str, set[str]] = {}
    for ev in events:
        ref = _entity_ref(ev)
        if ref is None:
            continue
        by_kind.setdefault(ref[0], set()).add(ref[1])
    return by_kind


async def _find_conflicting_batches(
    db: AsyncSession, batch: MutationBatch, events: list[Event]
) -> list[dict[str, Any]]:
    """Return every batch whose events touch one of *our* entities and
    that landed strictly after the batch under rollback."""
    touched = await _entities_touched(events)
    if not any(touched.values()):
        return []
    q = (
        select(Event, MutationBatch)
        .join(MutationBatch, Event.batch_id == MutationBatch.id)
        .where(Event.batch_id != batch.id)
        .where(MutationBatch.created_at > batch.created_at)
    )
    rows = (await db.execute(q)).all()
    conflicts: dict[uuid.UUID, dict[str, Any]] = {}
    for ev, other in rows:
        ref = _entity_ref(ev)
        if ref is None:
            continue
        kind, ent_id = ref
        if ent_id in touched.get(kind, set()):
            conflicts.setdefault(
                other.id,
                {
                    "batch_id": str(other.id),
                    "tool_name": other.tool_name,
                    "created_at": other.created_at.isoformat(),
                    "touched_entities": set(),
                },
            )
            conflicts[other.id]["touched_entities"].add(ent_id)
    # Convert sets to sorted lists for JSON serialisation.
    return [{**c, "touched_entities": sorted(c["touched_entities"])} for c in conflicts.values()]


# ---------------------------------------------------------------------------
# Applying
# ---------------------------------------------------------------------------


def _uuid(value: Any) -> uuid.UUID | None:
    if value in (None, ""):
        return None
    try:
        return uuid.UUID(str(value))
    except ValueError:
        return None


def _skip(op: dict[str, Any], reason: str) -> dict[str, Any]:
    return {**op, "status": "skipped", "reason": reason}


def _ok(op: dict[str, Any]) -> dict[str, Any]:
    return {**op, "status": "ok"}


async def _get_card(db: AsyncSession, cid: Any) -> Card | None:
    uid = _uuid(cid)
    if uid is None:
        return None
    return (await db.execute(select(Card).where(Card.id == uid))).scalar_one_or_none()


async def _apply_delete_card(db: AsyncSession, op: dict[str, Any]) -> dict[str, Any]:
    if not op.get("card_id"):
        return _skip(op, "missing_card_id")
    card = await _get_card(db, op["card_id"])
    if card is None:
        return _skip(op, "already_deleted")
    await db.delete(card)
    return _ok(op)


async def _apply_restore_card(db: AsyncSession, op: dict[str, Any]) -> dict[str, Any]:
    # Inverse of ``card.archived`` — bring the card back. Archive sets
    # both ``status="ARCHIVED"`` and ``archived_at``; we have to flip both
    # back, otherwise the UI's status column still reads "Archived" even
    # though ``archived_at`` is null.
    if not op.get("card_id"):
        return _skip(op, "missing_card_id")
    card = await _get_card(db, op["card_id"])
    if card is None:
        return _skip(op, "card_not_found")
    card.archived_at = None
    card.status = "ACTIVE"
    return _ok(op)


async def _apply_archive_card(db: AsyncSession, op: dict[str, Any]) -> dict[str, Any]:
    # Inverse of ``card.restored`` — re-archive. Restore set
    # ``status="ACTIVE"`` and cleared ``archived_at``; we re-stamp both so
    # the card actually disappears from the active inventory views again.
    if not op.get("card_id"):
        return _skip(op, "missing_card_id")
    card = await _get_card(db, op["card_id"])
    if card is None:
        return _skip(op, "card_not_found")
    card.archived_at = datetime.now(timezone.utc)
    card.status = "ARCHIVED"
    return _ok(op)


async def _apply_restore_card_fields(db: AsyncSession, op: dict[str, Any]) -> dict[str, Any]:
    if not op.get("card_id"):
        return _skip(op, "missing_card_id")
    card = await _get_card(db, op["card_id"])
    if card is None:
        return _skip(op, "card_not_found")
    # The "old" snapshot in the event payload was already serialised for
    # JSON (UUIDs as strings, dicts intact). Re-coerce parent_id back to
    # UUID; everything else is set verbatim.
    for k, v in (op.get("fields") or {}).items():
        if k == "parent_id" and v:
            v = uuid.UUID(v)
        setattr(card, k, v)
    return _ok(op)


async def _apply_delete_relation(db: AsyncSession, op: dict[str, Any]) -> dict[str, Any]:
    rid = _uuid(op.get("relation_id"))
    if rid is None:
        return _skip(op, "missing_relation_id")
    rel = (await db.execute(select(Relation).where(Relation.id == rid))).scalar_one_or_none()
    if rel is None:
        return _skip(op, "already_deleted")
    await db.delete(rel)
    return _ok(op)


async def _get_risk(db: AsyncSession, risk_id: Any) -> Risk | None:
    rid = _uuid(risk_id)
    if rid is None:
        return None
    return (
        await db.execute(
            select(Risk)
            .options(
                selectinload(Risk.mitigation_tasks).selectinload(RiskMitigationTask.occurrences)
            )
            .where(Risk.id == rid)
        )
    ).scalar_one_or_none()


async def _apply_delete_risk(db: AsyncSession, op: dict[str, Any]) -> dict[str, Any]:
    """Mirror ``DELETE /risks/{id}``: re-open compliance findings that
    pointed at the risk, drop the owner's system Todo, delete the row
    (junction rows and mitigation tasks cascade)."""
    from app.services.compliance_risk_sync import propagate_risk_to_findings
    from app.services.risk_service import risk_link

    risk = await _get_risk(db, op.get("risk_id"))
    if risk is None:
        return _skip(op, "risk_not_found")
    await propagate_risk_to_findings(db, risk, deleted=True, actor_user_id=None)
    link = risk_link(risk)
    todos = (
        (await db.execute(select(Todo).where(Todo.link == link, Todo.is_system.is_(True))))
        .scalars()
        .all()
    )
    for t in todos:
        await db.delete(t)
    await db.delete(risk)
    return _ok(op)


async def _apply_unlink_risk_card(db: AsyncSession, op: dict[str, Any]) -> dict[str, Any]:
    rid, cid = _uuid(op.get("risk_id")), _uuid(op.get("card_id"))
    if rid is None or cid is None:
        return _skip(op, "missing_target")
    row = (
        await db.execute(select(RiskCard).where(RiskCard.risk_id == rid, RiskCard.card_id == cid))
    ).scalar_one_or_none()
    if row is None:
        return _skip(op, "already_unlinked")
    await db.delete(row)
    return _ok(op)


_RISK_UUID_FIELDS = {"owner_id", "accepted_by"}
_RISK_DATE_FIELDS = {"target_resolution_date"}
_RISK_DATETIME_FIELDS = {"accepted_at"}
_RISK_RESTORABLE = {
    "title",
    "description",
    "category",
    "initial_probability",
    "initial_impact",
    "residual_probability",
    "residual_impact",
    "owner_id",
    "target_resolution_date",
    "status",
    "acceptance_rationale",
    "accepted_by",
    "accepted_at",
}


def _coerce_risk_value(key: str, value: Any) -> Any:
    if value in (None, ""):
        return None
    if key in _RISK_UUID_FIELDS:
        return _uuid(value)
    if key in _RISK_DATE_FIELDS:
        return date.fromisoformat(str(value)[:10])
    if key in _RISK_DATETIME_FIELDS:
        return datetime.fromisoformat(str(value))
    return value


async def _apply_restore_risk_fields(db: AsyncSession, op: dict[str, Any]) -> dict[str, Any]:
    from app.services.compliance_risk_sync import propagate_risk_to_findings
    from app.services.risk_service import derive_level, sync_owner_todo

    risk = await _get_risk(db, op.get("risk_id"))
    if risk is None:
        return _skip(op, "risk_not_found")
    previous_owner = risk.owner_id
    previous_status = risk.status
    restored: list[str] = []
    for key, value in (op.get("fields") or {}).items():
        if key not in _RISK_RESTORABLE:
            continue
        setattr(risk, key, _coerce_risk_value(key, value))
        restored.append(key)
    risk.initial_level = derive_level(risk.initial_probability, risk.initial_impact) or "medium"
    risk.residual_level = derive_level(risk.residual_probability, risk.residual_impact)
    await db.flush()
    await sync_owner_todo(db, risk, actor_id=None, previous_owner=previous_owner)
    if risk.status != previous_status:
        await propagate_risk_to_findings(db, risk, actor_user_id=None)
    return {**op, "status": "ok", "restored": restored}


async def _stakeholder_row(
    db: AsyncSession, card_id: Any, user_id: Any, role: Any
) -> tuple[uuid.UUID, uuid.UUID, Stakeholder | None] | None:
    cid, uid = _uuid(card_id), _uuid(user_id)
    if cid is None or uid is None or not role:
        return None
    from app.services.stakeholder_service import find_assignment

    return cid, uid, await find_assignment(db, cid, uid, str(role))


async def _apply_remove_stakeholder(db: AsyncSession, op: dict[str, Any]) -> dict[str, Any]:
    from app.services.stakeholder_service import rescore_after_stakeholder_change

    found = await _stakeholder_row(
        db, op.get("card_id"), op.get("stakeholder_user_id"), op.get("role")
    )
    if found is None:
        return _skip(op, "missing_target")
    cid, _uid, row = found
    if row is None:
        return _skip(op, "already_removed")
    await db.delete(row)
    await db.flush()
    await rescore_after_stakeholder_change(db, cid)
    return _ok(op)


async def _apply_assign_stakeholder(db: AsyncSession, op: dict[str, Any]) -> dict[str, Any]:
    from app.models.user import User
    from app.services.stakeholder_service import rescore_after_stakeholder_change

    found = await _stakeholder_row(
        db, op.get("card_id"), op.get("stakeholder_user_id"), op.get("role")
    )
    if found is None:
        return _skip(op, "missing_target")
    cid, uid, row = found
    if row is not None:
        return _skip(op, "already_assigned")
    if await _get_card(db, cid) is None:
        return _skip(op, "card_not_found")
    if (await db.execute(select(User.id).where(User.id == uid))).scalar_one_or_none() is None:
        return _skip(op, "user_not_found")
    db.add(Stakeholder(card_id=cid, user_id=uid, role=str(op["role"])))
    await db.flush()
    await rescore_after_stakeholder_change(db, cid)
    return _ok(op)


async def _apply_restore_stakeholder_role(db: AsyncSession, op: dict[str, Any]) -> dict[str, Any]:
    from app.services.stakeholder_service import rescore_after_stakeholder_change

    found = await _stakeholder_row(
        db, op.get("card_id"), op.get("stakeholder_user_id"), op.get("role")
    )
    if found is None or not op.get("old_role"):
        return _skip(op, "missing_target")
    cid, _uid, row = found
    if row is None:
        return _skip(op, "assignment_not_found")
    row.role = str(op["old_role"])
    await db.flush()
    await rescore_after_stakeholder_change(db, cid)
    return _ok(op)


async def _card_tag_row(db: AsyncSession, card_id: Any, tag_id: Any):
    cid, tid = _uuid(card_id), _uuid(tag_id)
    if cid is None or tid is None:
        return None
    row = (
        await db.execute(select(CardTag).where(CardTag.card_id == cid, CardTag.tag_id == tid))
    ).scalar_one_or_none()
    return cid, tid, row


async def _apply_remove_card_tag(db: AsyncSession, op: dict[str, Any]) -> dict[str, Any]:
    from app.services.data_quality import rescore_cards

    found = await _card_tag_row(db, op.get("card_id"), op.get("tag_id"))
    if found is None:
        return _skip(op, "missing_target")
    cid, _tid, row = found
    if row is None:
        return _skip(op, "already_removed")
    await db.delete(row)
    await db.flush()
    await rescore_cards(db, [cid])
    return _ok(op)


async def _apply_add_card_tag(db: AsyncSession, op: dict[str, Any]) -> dict[str, Any]:
    from app.services.data_quality import rescore_cards

    found = await _card_tag_row(db, op.get("card_id"), op.get("tag_id"))
    if found is None:
        return _skip(op, "missing_target")
    cid, tid, row = found
    if row is not None:
        return _skip(op, "already_tagged")
    if await _get_card(db, cid) is None:
        return _skip(op, "card_not_found")
    if (await db.execute(select(Tag.id).where(Tag.id == tid))).scalar_one_or_none() is None:
        return _skip(op, "tag_not_found")
    # Rollback restores a prior state, so the group rules that governed the
    # original write are not re-validated here.
    db.add(CardTag(card_id=cid, tag_id=tid))
    await db.flush()
    await rescore_cards(db, [cid])
    return _ok(op)


async def _apply_delete_adr(db: AsyncSession, op: dict[str, Any]) -> dict[str, Any]:
    aid = _uuid(op.get("adr_id"))
    if aid is None:
        return _skip(op, "missing_adr_id")
    adr = (
        await db.execute(select(ArchitectureDecision).where(ArchitectureDecision.id == aid))
    ).scalar_one_or_none()
    if adr is None:
        return _skip(op, "already_deleted")
    if adr.status != "draft":
        # Signing is a human act on top of the draft; the draft is no
        # longer only what the batch created.
        return _skip(op, "adr_not_draft")
    await db.delete(adr)
    return _ok(op)


async def _apply_delete_todo(db: AsyncSession, op: dict[str, Any]) -> dict[str, Any]:
    """Take back a todo an extension created — while nobody has acted on it.
    A completed one records that a person did something and stays; a system
    todo is a workflow's, never an extension's (the bridge refuses to create
    one, so this is belt and braces)."""
    tid = _uuid(op.get("todo_id"))
    if tid is None:
        return _skip(op, "missing_todo_id")
    todo = (await db.execute(select(Todo).where(Todo.id == tid))).scalar_one_or_none()
    if todo is None:
        return _skip(op, "already_deleted")
    if todo.is_system:
        return _skip(op, "todo_is_system")
    if todo.status == "done":
        return _skip(op, "already_completed")
    await db.delete(todo)
    return _ok(op)


async def _apply_close_survey(db: AsyncSession, op: dict[str, Any]) -> dict[str, Any]:
    """Take back a survey the batch sent: close it and delete the responses
    still pending, so My Surveys stops asking. An answered response is a
    person's work and stays; a survey already closed is left as it is."""
    sid = _uuid(op.get("survey_id"))
    if sid is None:
        return _skip(op, "missing_survey_id")
    survey = (await db.execute(select(Survey).where(Survey.id == sid))).scalar_one_or_none()
    if survey is None:
        return _skip(op, "not_found")
    if survey.status == "closed":
        return _skip(op, "already_closed")
    pending = (
        await db.execute(
            select(SurveyResponse).where(
                SurveyResponse.survey_id == sid, SurveyResponse.status == "pending"
            )
        )
    ).scalars()
    for row in pending:
        await db.delete(row)
    survey.status = "closed"
    survey.closed_at = datetime.now(timezone.utc)
    await db.flush()
    return _ok(op)


_APPLIERS: dict[str, Callable[[AsyncSession, dict[str, Any]], Awaitable[dict[str, Any]]]] = {
    "delete_card": _apply_delete_card,
    "restore_card": _apply_restore_card,
    "archive_card": _apply_archive_card,
    "restore_card_fields": _apply_restore_card_fields,
    "delete_relation": _apply_delete_relation,
    "delete_risk": _apply_delete_risk,
    "unlink_risk_card": _apply_unlink_risk_card,
    "restore_risk_fields": _apply_restore_risk_fields,
    "remove_stakeholder": _apply_remove_stakeholder,
    "assign_stakeholder": _apply_assign_stakeholder,
    "restore_stakeholder_role": _apply_restore_stakeholder_role,
    "remove_card_tag": _apply_remove_card_tag,
    "add_card_tag": _apply_add_card_tag,
    "delete_adr": _apply_delete_adr,
    "delete_todo": _apply_delete_todo,
    "close_survey": _apply_close_survey,
}


async def _apply_inverse(db: AsyncSession, op: dict[str, Any]) -> dict[str, Any]:
    """Execute a single inverse op. Returns a per-op result dict for the
    rollback batch's summary."""
    applier = _APPLIERS.get(op["op"])
    if applier is None:
        return _skip(op, "unsupported")
    return await applier(db, op)


# ---------------------------------------------------------------------------
# Entry points
# ---------------------------------------------------------------------------


async def _batch_events(db: AsyncSession, batch: MutationBatch) -> list[Event]:
    return list(
        (
            await db.execute(
                select(Event).where(Event.batch_id == batch.id).order_by(Event.created_at.desc())
            )
        )
        .scalars()
        .all()
    )


async def plan_rollback(db: AsyncSession, batch: MutationBatch) -> dict[str, Any]:
    """Build the inverse-op plan for ``batch`` without applying anything."""
    events = await _batch_events(db, batch)
    plan = plan_ops(events)
    unsupported = [op for op in plan if op["op"] == "unsupported"]
    supported = [op for op in plan if op["op"] != "unsupported"]
    return {
        "batch": batch_to_dict(batch),
        "operations": supported,
        "unsupported_events": unsupported,
        "event_count": len(events),
    }


async def execute_rollback(
    db: AsyncSession,
    batch: MutationBatch,
    user_id: uuid.UUID,
    *,
    force: bool = False,
) -> dict[str, Any]:
    """Apply the inverse of ``batch``. Records the rollback as a new
    batch so the audit log shows the causal chain."""
    events = await _batch_events(db, batch)

    conflicts = await _find_conflicting_batches(db, batch, events)
    if conflicts and not force:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "rollback_conflict",
                "message": (
                    "The batch you are trying to roll back was followed by "
                    "other batches that modified the same entities. Pass "
                    "force=true to override and accept the data loss."
                ),
                "conflicting_batches": conflicts,
            },
        )

    # Open the rollback's own batch row first so the events we emit
    # while reverting are themselves stamped with a batch id. The
    # origin follows the caller's request (web / api / mcp) — not
    # always MCP — so the audit log reflects who actually triggered
    # the reversal.
    from app.models.user import User
    from app.services.event_bus import request_origin

    actor = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    rollback_batch = await create_batch(
        db,
        tool_name="rollback_batch",
        actor=actor,
        origin=request_origin.get() or "api",
        dry_run=False,
    )

    results: list[dict[str, Any]] = []
    for op in plan_ops(events):
        if op["op"] == "unsupported":
            results.append(op)
            continue
        outcome = await _apply_inverse(db, op)
        results.append(outcome)
        await event_bus.publish(
            f"rollback.{op['op']}",
            {**op, "outcome": outcome.get("status")},
            db=db,
            batch_id=rollback_batch.id,
        )

    rollback_batch.committed_at = datetime.now(timezone.utc)
    rollback_batch.summary = {
        "reverses_batch_id": str(batch.id),
        "forced": force,
        "results": results,
    }
    await db.flush()
    return {
        "rollback_batch_id": str(rollback_batch.id),
        "reversed_batch_id": str(batch.id),
        "forced": force,
        "results": results,
    }
