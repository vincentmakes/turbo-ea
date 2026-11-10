"""Decision makers and participants named on an architecture decision.

People are separate from signatories: they say who took or shaped the
decision, not who approved this record. Each person is a user of this instance
or a free-text name; the name is always stored as a snapshot, so a deleted
user, or one who did not match on a workspace import, still reads correctly.
Responses expose only ``{user_id, display_name}``.

Helpers flush and never commit: the caller owns the transaction.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable, Mapping, Sequence
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.architecture_decision import ArchitectureDecision
from app.models.architecture_decision_person import ArchitectureDecisionPerson
from app.models.user import User

DECISION_MAKER = "decision_maker"
PARTICIPANT = "participant"
#: The parts a person can play, in the order a payload lists them.
PARTS: tuple[str, ...] = (DECISION_MAKER, PARTICIPANT)
#: The payload key of each part.
PAYLOAD_KEYS: dict[str, str] = {DECISION_MAKER: "decision_makers", PARTICIPANT: "participants"}

NAME_MAX_LENGTH = 255


def _parse_user_id(raw: Any) -> uuid.UUID:
    try:
        return uuid.UUID(str(raw))
    except ValueError:
        raise HTTPException(400, f"Invalid user id: {raw!r}") from None


def _entry_value(entry: Mapping[str, Any] | Any, key: str) -> Any:
    if isinstance(entry, Mapping):
        return entry.get(key)
    return getattr(entry, key, None)


def plan_people(
    entries: Iterable[Mapping[str, Any] | Any], names: Mapping[uuid.UUID, str]
) -> list[tuple[uuid.UUID | None, str]]:
    """The ``(user_id, name)`` rows for one part, in order, duplicates collapsed.

    ``names`` maps each user id to the user's current display name. A user
    entry stores that name as its snapshot; a free-text entry needs a
    non-empty name of at most 255 characters (400 otherwise). A user named
    twice, or a free-text name repeated (case and surrounding spaces ignored),
    is kept once, at its first place.
    """
    rows: list[tuple[uuid.UUID | None, str]] = []
    seen_users: set[uuid.UUID] = set()
    seen_names: set[str] = set()
    for entry in entries:
        raw_user = _entry_value(entry, "user_id")
        if raw_user:
            user_id = _parse_user_id(raw_user)
            if user_id in seen_users:
                continue
            seen_users.add(user_id)
            rows.append((user_id, names[user_id]))
            continue
        name = str(_entry_value(entry, "name") or "").strip()
        if not name:
            raise HTTPException(400, "A person needs a user or a name")
        if len(name) > NAME_MAX_LENGTH:
            raise HTTPException(400, f"A person's name is longer than {NAME_MAX_LENGTH} characters")
        key = name.casefold()
        if key in seen_names:
            continue
        seen_names.add(key)
        rows.append((None, name))
    return rows


async def _user_names(
    db: AsyncSession, parts: Iterable[Sequence[Mapping[str, Any] | Any]]
) -> dict[uuid.UUID, str]:
    """The current display name of every user named, in one query; 404 on an unknown user."""
    wanted: list[uuid.UUID] = []
    for entries in parts:
        for entry in entries:
            raw_user = _entry_value(entry, "user_id")
            if raw_user:
                wanted.append(_parse_user_id(raw_user))
    if not wanted:
        return {}
    found = dict(
        (await db.execute(select(User.id, User.display_name).where(User.id.in_(wanted)))).all()
    )
    missing = [str(uid) for uid in dict.fromkeys(wanted) if uid not in found]
    if missing:
        raise HTTPException(404, f"User not found: {', '.join(missing)}")
    return found


async def replace_people(
    db: AsyncSession,
    decision: ArchitectureDecision,
    *,
    decision_makers: Sequence[Mapping[str, Any] | Any] | None = None,
    participants: Sequence[Mapping[str, Any] | Any] | None = None,
) -> None:
    """Make the given lists the decision's people; flush.

    Each entry is ``{user_id}`` or ``{name}``. A part passed as ``None`` is
    left unchanged; ``[]`` clears it. Rows are reused in place by position, so
    an unchanged list keeps its primary keys.
    """
    wanted = {DECISION_MAKER: decision_makers, PARTICIPANT: participants}
    given = {part: entries for part, entries in wanted.items() if entries is not None}
    if not given:
        return
    names = await _user_names(db, given.values())
    planned = {part: plan_people(entries, names) for part, entries in given.items()}

    existing = (
        (
            await db.execute(
                select(ArchitectureDecisionPerson)
                .where(
                    ArchitectureDecisionPerson.architecture_decision_id == decision.id,
                    ArchitectureDecisionPerson.part.in_(list(given)),
                )
                .order_by(ArchitectureDecisionPerson.position, ArchitectureDecisionPerson.id)
            )
        )
        .scalars()
        .all()
    )
    by_part: dict[str, list[ArchitectureDecisionPerson]] = {part: [] for part in given}
    for person in existing:
        by_part[person.part].append(person)

    for part, rows in planned.items():
        held = by_part[part]
        for position, (user_id, name) in enumerate(rows):
            if position < len(held):
                person = held[position]
                person.user_id = user_id
                person.name = name
                person.position = position
            else:
                db.add(
                    ArchitectureDecisionPerson(
                        architecture_decision_id=decision.id,
                        part=part,
                        user_id=user_id,
                        name=name,
                        position=position,
                    )
                )
        for person in held[len(rows) :]:
            await db.delete(person)
    await db.flush()


async def people_payload(
    db: AsyncSession, decision_ids: Iterable[uuid.UUID]
) -> dict[uuid.UUID, dict[str, list[dict[str, str | None]]]]:
    """Each decision's people, in ONE query whatever the number of decisions.

    ``{decision_id: {"decision_makers": [...], "participants": [...]}}`` with
    entries ``{user_id, display_name}`` (the stored name snapshot). Every id
    asked for has an entry, empty lists included.
    """
    ids = list(dict.fromkeys(decision_ids))
    out: dict[uuid.UUID, dict[str, list[dict[str, str | None]]]] = {
        did: {key: [] for key in PAYLOAD_KEYS.values()} for did in ids
    }
    if not ids:
        return out
    rows = await db.execute(
        select(ArchitectureDecisionPerson)
        .where(ArchitectureDecisionPerson.architecture_decision_id.in_(ids))
        .order_by(ArchitectureDecisionPerson.position, ArchitectureDecisionPerson.id)
    )
    for person in rows.scalars().all():
        key = PAYLOAD_KEYS.get(person.part)
        if key is None:
            continue
        out[person.architecture_decision_id][key].append(
            {
                "user_id": str(person.user_id) if person.user_id else None,
                "display_name": person.name,
            }
        )
    return out


async def copy_people(db: AsyncSession, source_id: uuid.UUID, new_id: uuid.UUID) -> int:
    """Copy every person of ``source_id`` onto ``new_id``; flush. Returns the count."""
    rows = (
        (
            await db.execute(
                select(ArchitectureDecisionPerson)
                .where(ArchitectureDecisionPerson.architecture_decision_id == source_id)
                .order_by(ArchitectureDecisionPerson.position, ArchitectureDecisionPerson.id)
            )
        )
        .scalars()
        .all()
    )
    for person in rows:
        db.add(
            ArchitectureDecisionPerson(
                architecture_decision_id=new_id,
                part=person.part,
                user_id=person.user_id,
                name=person.name,
                position=person.position,
            )
        )
    await db.flush()
    return len(rows)
