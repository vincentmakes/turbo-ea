"""Typed links between architecture decisions: write, resolve and serialise.

A link belongs to the revision that authored it (its source) and acts on the
target's revision chain; what a link *means* for standing is decided by
:mod:`app.services.decision_standing` alone. This module owns the writes and
the wire shape:

* :func:`replace_links` applies a wanted link set to one decision with
  replace-set semantics, diffing by target so a kept link keeps its primary key
  (a workspace re-import matches rows by id).
* :func:`resolve_decision_ref` turns what a caller typed, a decision id or a
  reference number, into a decision id.
* :func:`links_payload` is the ``links`` block of a decision's detail.
* :func:`copy_relates_links` carries ``relates`` links into a revision or a
  duplicate; hard links stay on the revision that authored them.

Helpers flush and never commit: the caller owns the transaction.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.architecture_decision import ArchitectureDecision
from app.models.architecture_decision_link import ArchitectureDecisionLink
from app.services import decision_standing as ds

#: Two wanted links name the same target (one link per pair).
DUPLICATE_TARGET = "duplicate_target"

_PROBLEM_MESSAGES: dict[str, str] = {
    ds.UNKNOWN_KIND: "Unknown link kind",
    ds.TARGET_MISSING: "The linked decision does not exist",
    ds.SAME_CHAIN: "A decision cannot link to a revision of itself",
    ds.CONSOLIDATES_NEEDS_REVISION: "Only a revision can consolidate an amendment",
    ds.CONSOLIDATES_NOT_AMENDER: "The consolidated decision does not amend this decision",
    DUPLICATE_TARGET: "A decision can be linked only once",
}


@dataclass(frozen=True)
class WantedLink:
    """One link a caller wants on a decision, its target already resolved."""

    target_id: uuid.UUID
    kind: str
    note: str | None = None


def link_error(problems: Sequence[str], target_id: Any) -> HTTPException:
    """The 400 for a link that cannot be saved: the first problem names it."""
    code = problems[0]
    return HTTPException(
        400,
        {
            "error": code,
            "problems": list(problems),
            "target_id": str(target_id),
            "message": f"{_PROBLEM_MESSAGES.get(code, code)} ({target_id})",
        },
    )


def _clean_note(note: str | None) -> str | None:
    if note is None:
        return None
    return note.strip() or None


async def replace_links(
    db: AsyncSession,
    decision: ArchitectureDecision,
    wanted: Sequence[WantedLink],
    *,
    register: ds.Register,
) -> None:
    """Make ``wanted`` the decision's full outgoing link set; flush.

    Diffed by target: a kept target has its ``kind`` and ``note`` updated in
    place, a new target is inserted, a target no longer wanted is deleted. A
    new link, or one whose kind changes, is validated against ``register``
    (:func:`decision_standing.validate_link_draft`); the first invalid entry
    raises a 400 naming the problem code and the target.
    """
    seen: set[uuid.UUID] = set()
    for link in wanted:
        if link.target_id in seen:
            raise link_error([DUPLICATE_TARGET], link.target_id)
        seen.add(link.target_id)

    existing = {
        lk.target_id: lk
        for lk in (
            await db.execute(
                select(ArchitectureDecisionLink).where(
                    ArchitectureDecisionLink.source_id == decision.id
                )
            )
        )
        .scalars()
        .all()
    }

    for link in wanted:
        held = existing.get(link.target_id)
        if held is None or held.kind != link.kind:
            problems = ds.validate_link_draft(
                register,
                decision.id,
                link.target_id,
                link.kind,
                source_parent_id=decision.parent_id,
            )
            if problems:
                raise link_error(problems, link.target_id)

    for target_id, held in existing.items():
        if target_id not in seen:
            await db.delete(held)
    for link in wanted:
        held = existing.get(link.target_id)
        note = _clean_note(link.note)
        if held is None:
            db.add(
                ArchitectureDecisionLink(
                    source_id=decision.id,
                    target_id=link.target_id,
                    kind=link.kind,
                    note=note,
                )
            )
        else:
            held.kind = link.kind
            held.note = note
    await db.flush()


def _norm_reference(value: str) -> str:
    return value.strip().upper()


def resolve_in_register(register: ds.Register, value: Any) -> uuid.UUID | None:
    """A decision id from an id or a reference number, or ``None``.

    An id names that exact revision. A reference (case and surrounding spaces
    ignored) names its chain's CURRENT revision; a reference carried by rows of
    two different chains names no single decision and resolves to ``None``.
    Anything that is not a string is ``None``.
    """
    if not isinstance(value, str) or not value.strip():
        return None
    text = value.strip()
    try:
        as_id = uuid.UUID(text)
    except ValueError:
        as_id = None
    if as_id is not None:
        return as_id if as_id in register else None
    key = _norm_reference(text)
    currents = {
        register.chain(row_id).current.id
        for row_id in register.ids()
        if _norm_reference(register.row(row_id).reference_number) == key
    }
    return currents.pop() if len(currents) == 1 else None


async def resolve_decision_ref(
    register_or_db: ds.Register | AsyncSession, value: Any
) -> uuid.UUID | None:
    """:func:`resolve_in_register` against a register, or one loaded from ``db``."""
    if isinstance(register_or_db, ds.Register):
        register = register_or_db
    else:
        register = await ds.load_register(register_or_db)
    return resolve_in_register(register, value)


def _field(entry: Any, key: str) -> Any:
    if isinstance(entry, dict):
        return entry.get(key)
    return getattr(entry, key, None)


def resolve_or_404(register: ds.Register, value: Any) -> uuid.UUID:
    target = resolve_in_register(register, value)
    if target is None:
        raise HTTPException(
            404,
            {
                "error": "decision_not_found",
                "value": str(value),
                "message": f"Decision not found: {value}",
            },
        )
    return target


def wanted_links(
    register: ds.Register,
    decision_id: Any,
    *,
    links: Sequence[Any] | None,
    related: Sequence[Any] = (),
) -> list[WantedLink]:
    """The link set a create or an update asks for, every reference resolved.

    ``links`` (entries with ``decision_id``, ``kind``, ``note``) is the full
    typed set; when it is ``None`` the decision's current non-``relates`` links
    are kept as they are. ``related`` (ids or references) adds ``relates``
    links on top, skipping a target the typed set already holds and keeping
    the note of a ``relates`` link that stays. An entry that is neither a known
    id nor a known reference is a 404 naming it.
    """
    current = [lk for lk in register.outgoing(decision_id)] if decision_id in register else []
    if links is None:
        wanted = [
            WantedLink(lk.target_id, lk.kind, lk.note) for lk in current if lk.kind != ds.RELATES
        ]
    else:
        wanted = [
            WantedLink(
                resolve_or_404(register, _field(entry, "decision_id")),
                str(_field(entry, "kind")),
                _field(entry, "note"),
            )
            for entry in links
        ]
    notes = {lk.target_id: lk.note for lk in current if lk.kind == ds.RELATES}
    held = {link.target_id for link in wanted}
    for value in related:
        target = resolve_or_404(register, value)
        if target in held:
            continue
        held.add(target)
        wanted.append(WantedLink(target, ds.RELATES, notes.get(target)))
    return wanted


def decision_entry(register: ds.Register, decision_id: Any) -> dict[str, Any]:
    """How a linked decision is shown: the exact revision linked, and its
    chain's current revision when that is another one."""
    row = register.row(decision_id)
    standing = register.get(decision_id)
    entry: dict[str, Any] = {
        "id": str(row.id),
        "reference_number": row.reference_number,
        "revision_number": row.revision_number,
        "title": row.title,
        "status": row.status,
        "standing": standing.standing if standing is not None else None,
    }
    current = register.chain(decision_id).current
    if current.id != decision_id:
        current_row = register.row(current.id)
        entry["current"] = {
            "id": str(current_row.id),
            "reference_number": current_row.reference_number,
            "revision_number": current_row.revision_number,
        }
    return entry


def _entry_order(register: ds.Register, decision_id: Any) -> tuple[str, int, str]:
    row = register.row(decision_id)
    return (row.reference_number, row.revision_number, str(row.id))


def links_payload(register: ds.Register, decision_id: Any) -> dict[str, list[dict[str, Any]]]:
    """``{"outgoing": [...], "incoming": [...]}`` for one decision.

    Each entry is ``{id, kind, note, decision}``; ``decision`` is the target of
    an outgoing link and the source of an incoming one (see
    :func:`decision_entry`). Entries are ordered by the other decision's
    reference and revision.
    """

    def entries(links: Iterable[ds.LinkRow], other: str) -> list[dict[str, Any]]:
        out = []
        for lk in links:
            other_id = getattr(lk, other)
            if other_id not in register:
                continue
            out.append(
                (
                    _entry_order(register, other_id),
                    {
                        "id": str(lk.id) if lk.id is not None else None,
                        "kind": lk.kind,
                        "note": lk.note,
                        "decision": decision_entry(register, other_id),
                    },
                )
            )
        out.sort(key=lambda item: item[0])
        return [item[1] for item in out]

    return {
        "outgoing": entries(register.outgoing(decision_id), "target_id"),
        "incoming": entries(register.incoming(decision_id), "source_id"),
    }


async def add_relates_links(
    db: AsyncSession,
    decision: ArchitectureDecision,
    entries: Iterable[Any],
    *,
    register: ds.Register,
) -> list[uuid.UUID]:
    """The tolerant path: add a ``relates`` link per resolvable entry; flush.

    For callers that pass the legacy ``related_decisions`` list (the extension
    decisions bridge, the analysis commit): an entry that is not a string, that
    resolves to no decision, that names the decision itself or a target already
    linked, or that would fail validation is dropped silently. Returns the
    targets linked.
    """
    held = set(
        (
            await db.execute(
                select(ArchitectureDecisionLink.target_id).where(
                    ArchitectureDecisionLink.source_id == decision.id
                )
            )
        )
        .scalars()
        .all()
    )
    added: list[uuid.UUID] = []
    for entry in entries:
        target = resolve_in_register(register, entry)
        if target is None or target == decision.id or target in held:
            continue
        if ds.validate_link_draft(
            register, decision.id, target, ds.RELATES, source_parent_id=decision.parent_id
        ):
            continue
        held.add(target)
        added.append(target)
        db.add(ArchitectureDecisionLink(source_id=decision.id, target_id=target, kind=ds.RELATES))
    await db.flush()
    return added


async def copy_relates_links(db: AsyncSession, source_id: uuid.UUID, new_id: uuid.UUID) -> int:
    """Copy the ``relates`` links of ``source_id`` onto ``new_id``; flush.

    Only ``relates`` travels: hard links stay on the revision that authored
    them. A link that would point the new decision at itself is skipped.
    Returns the number of links copied.
    """
    rows = (
        (
            await db.execute(
                select(ArchitectureDecisionLink)
                .where(
                    ArchitectureDecisionLink.source_id == source_id,
                    ArchitectureDecisionLink.kind == ds.RELATES,
                )
                .order_by(ArchitectureDecisionLink.target_id)
            )
        )
        .scalars()
        .all()
    )
    copied = 0
    for lk in rows:
        if lk.target_id == new_id:
            continue
        db.add(
            ArchitectureDecisionLink(
                source_id=new_id, target_id=lk.target_id, kind=lk.kind, note=lk.note
            )
        )
        copied += 1
    await db.flush()
    return copied
