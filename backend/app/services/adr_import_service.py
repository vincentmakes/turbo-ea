"""Spreadsheet import and export helpers for Architecture Decision Records.

``import_decision_rows`` is the body of ``POST /adr/bulk-import``. It is
**create-only**: a row whose reference already belongs to a decision is
skipped (so re-importing an exported register changes nothing), and every
other row becomes a new **draft** through ``adr_service.create_decision`` —
the one writer, so imported decisions take the same ``ADR-NNN`` sequence as
every other path. Status and signatories are never imported: signing is a
human act with its own workflow.

Cards are linked best-effort by exact name among the ACTIVE cards the importer
may read, looked up once for the whole file; a missing, ambiguous, archived or
hidden card is a warning, never a failure.
Related decisions are resolved in a second pass, once every row exists, so a
row may name a decision that appears later in the same file. Nothing here
commits — the route owns the transaction and the dry-run rollback.

``related_reference_labels`` is the export side: ``related_decisions`` holds
decision ids (the MCP and the import write ids; the demo seed writes
references), and a spreadsheet shows references.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import ColumnElement, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.architecture_decision import ArchitectureDecision
from app.models.card import Card
from app.services import adr_service

TITLE_MAX_LENGTH = 500


@dataclass
class DecisionImportRow:
    row_index: int
    title: str
    reference_number: str | None = None
    context: str | None = None
    decision: str | None = None
    consequences: str | None = None
    alternatives_considered: str | None = None
    card_names: list[str] = field(default_factory=list)
    related_references: list[str] = field(default_factory=list)
    status: str | None = None


@dataclass
class DecisionImportOutcome:
    row_index: int
    status: str  # created | skipped | failed
    id: str | None = None
    reference_number: str | None = None
    error: str | None = None
    warnings: list[str] = field(default_factory=list)


def _norm_ref(value: str | None) -> str:
    return (value or "").strip().upper()


def _text(value: str | None) -> str | None:
    if value is None:
        return None
    return value.strip() or None


def _unique(values: Iterable[str]) -> list[str]:
    """Trimmed, non-empty values, first occurrence first."""
    return list(dict.fromkeys(v.strip() for v in values if v.strip()))


async def _cards_by_name(
    db: AsyncSession, names: set[str], readable: Sequence[ColumnElement[bool]]
) -> dict[str, list[uuid.UUID]]:
    """Every ACTIVE, readable card for each name, in one query.

    ``ACTIVE`` matches what the card picker offers when a decision is linked by
    hand: an archived namesake neither makes the live card ambiguous nor gets
    linked in its place.
    """
    if not names:
        return {}
    rows = await db.execute(
        select(Card.name, Card.id).where(Card.name.in_(names), Card.status == "ACTIVE", *readable)
    )
    found: dict[str, list[uuid.UUID]] = {}
    for name, card_id in rows.all():
        found.setdefault(name, []).append(card_id)
    return found


def _resolve_cards(
    names: Sequence[str], cards: dict[str, list[uuid.UUID]]
) -> tuple[list[uuid.UUID], list[str]]:
    ids: list[uuid.UUID] = []
    warnings: list[str] = []
    for name in _unique(names):
        matches = cards.get(name, [])
        if len(matches) == 1:
            ids.append(matches[0])
        elif not matches:
            warnings.append(f"Card not found: {name}")
        else:
            warnings.append(f"Card name is ambiguous: {name}")
    return ids, warnings


async def import_decision_rows(
    db: AsyncSession,
    rows: Sequence[DecisionImportRow],
    *,
    created_by: uuid.UUID | None,
    readable_cards: Sequence[ColumnElement[bool]] = (),
    publish: bool = True,
) -> list[DecisionImportOutcome]:
    """Create a draft decision per new row (see the module doc)."""
    existing = {
        ref.upper(): adr_id
        for adr_id, ref in (
            await db.execute(select(ArchitectureDecision.id, ArchitectureDecision.reference_number))
        ).all()
    }

    cards = await _cards_by_name(
        db, {name for row in rows for name in _unique(row.card_names)}, readable_cards
    )

    outcomes: list[DecisionImportOutcome] = []
    created: list[tuple[DecisionImportOutcome, ArchitectureDecision, DecisionImportRow]] = []
    # The file's own references, mapped to the decision each row created —
    # what a later row repeating one collides with, and what related
    # references between rows resolve against.
    file_refs: dict[str, uuid.UUID] = {}

    for row in rows:
        reference = _norm_ref(row.reference_number)
        if reference in existing:
            outcomes.append(
                DecisionImportOutcome(
                    row_index=row.row_index,
                    status="skipped",
                    id=str(existing[reference]),
                    reference_number=reference,
                )
            )
            continue

        title = row.title.strip()
        error: str | None = None
        if not title:
            error = "Title is required"
        elif len(title) > TITLE_MAX_LENGTH:
            error = f"Title is longer than {TITLE_MAX_LENGTH} characters"
        elif reference in file_refs:
            error = f"Reference {reference} appears more than once in the file"
        if error is not None:
            outcomes.append(
                DecisionImportOutcome(row_index=row.row_index, status="failed", error=error)
            )
            continue

        card_ids, warnings = _resolve_cards(row.card_names, cards)
        status = (row.status or "").strip()
        if status and status.lower() != "draft":
            warnings.append(f"Status {status!r} is not imported; created as a draft")

        adr = await adr_service.create_decision(
            db,
            title=title,
            context=_text(row.context),
            decision=_text(row.decision),
            consequences=_text(row.consequences),
            alternatives_considered=_text(row.alternatives_considered),
            linked_card_ids=card_ids,
            created_by=created_by,
            publish=publish,
        )
        if reference:
            file_refs[reference] = adr.id
        outcome = DecisionImportOutcome(
            row_index=row.row_index,
            status="created",
            id=str(adr.id),
            reference_number=adr.reference_number,
            warnings=warnings,
        )
        outcomes.append(outcome)
        created.append((outcome, adr, row))

    # Second pass: every row now exists, so a reference to a later row resolves.
    for outcome, adr, row in created:
        related: list[str] = []
        for ref in _unique(row.related_references):
            key = ref.upper()
            target = file_refs.get(key) or existing.get(key)
            if target is None:
                outcome.warnings.append(f"Related decision not found: {ref}")
            elif target != adr.id and str(target) not in related:
                related.append(str(target))
        adr.related_decisions = related
    await db.flush()

    return outcomes


async def related_reference_labels(
    db: AsyncSession, decisions: Sequence[ArchitectureDecision]
) -> dict[uuid.UUID, list[str]]:
    """Each decision's ``related_decisions`` as reference numbers.

    An entry may be a decision id (MCP, import) or already a reference (the
    demo seed); anything else — a dict link to an assessment, a dangling id —
    is left out, since a spreadsheet column of references cannot express it.
    """
    candidates: set[str] = set()
    for adr in decisions:
        candidates.update(_string_entries(adr.related_decisions))
    if not candidates:
        return {adr.id: [] for adr in decisions}

    ids = [uuid.UUID(c) for c in candidates if _is_uuid(c)]
    refs = [c.upper() for c in candidates if not _is_uuid(c)]
    found = (
        await db.execute(
            select(ArchitectureDecision.id, ArchitectureDecision.reference_number).where(
                ArchitectureDecision.id.in_(ids) | ArchitectureDecision.reference_number.in_(refs)
            )
        )
    ).all()
    by_id = {str(adr_id): ref for adr_id, ref in found}
    known_refs = {ref for _, ref in found}

    labels: dict[uuid.UUID, list[str]] = {}
    for adr in decisions:
        out: list[str] = []
        for entry in _string_entries(adr.related_decisions):
            if _is_uuid(entry):
                label = by_id.get(entry)
            else:
                label = entry.upper() if entry.upper() in known_refs else None
            if label is not None and label not in out:
                out.append(label)
        labels[adr.id] = out
    return labels


def _string_entries(values: Any) -> list[str]:
    return [v.strip() for v in (values or []) if isinstance(v, str) and v.strip()]


def _is_uuid(value: str) -> bool:
    try:
        uuid.UUID(value)
    except ValueError:
        return False
    return True
