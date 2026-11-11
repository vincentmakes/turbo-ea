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
row may name a decision that appears later in the same file, and are saved as
``relates`` links. A reference already in the database names its chain's
current revision. An exported register carries one row per revision, so a
file may repeat a reference: the row with the highest ``revision_number`` is
imported (a tie or an absent number: the last row) and every other row of that
reference is skipped with a warning (:func:`chosen_rows`); a reference already
in the database skips all its rows. Nothing here commits — the route owns the transaction and
the dry-run rollback.

``related_reference_labels`` is the export side: a decision's ``relates``
links as the reference numbers a spreadsheet shows.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import ColumnElement, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.architecture_decision import ArchitectureDecision
from app.models.architecture_decision_link import ArchitectureDecisionLink
from app.models.card import Card
from app.models.user import User
from app.services import adr_service, mention_service
from app.services import decision_standing as ds
from app.services.card_read_scope import CardReadScope

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
    revision_number: int | str | None = None


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


def revision_of(value: int | str | None) -> int:
    """A row's ``revision_number`` cell as a number; 0 when absent or unreadable."""
    if isinstance(value, bool):
        return 0
    if isinstance(value, int):
        return max(value, 0)
    text = (value or "").strip()
    return int(text) if text.isascii() and text.isdigit() else 0


def chosen_rows(rows: Sequence[DecisionImportRow], skip: Iterable[str] = ()) -> set[int]:
    """Positions (in ``rows``) of the row imported for each reference the file repeats.

    An export carries one row per revision, so a reference can appear several
    times: the row with the highest ``revision_number`` is imported, a tie or
    an absent number going to the last row. A row without a reference, or
    whose reference is in ``skip`` (already on the instance), is always kept
    here; the caller skips the latter.
    """
    skipped = set(skip)
    best: dict[str, tuple[int, int]] = {}
    for position, row in enumerate(rows):
        reference = _norm_ref(row.reference_number)
        if not reference or reference in skipped:
            continue
        rank = (revision_of(row.revision_number), position)
        if reference not in best or rank > best[reference]:
            best[reference] = rank
    keep = {position for _rank, position in best.values()}
    return {
        position
        for position, row in enumerate(rows)
        if position in keep
        or not _norm_ref(row.reference_number)
        or _norm_ref(row.reference_number) in skipped
    }


def earlier_revision_warning(reference: str) -> str:
    """The warning on a row left out because the file has a later row for its reference."""
    return f"Earlier revision of {reference} skipped"


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
    user: User | None = None,
    read_scope: CardReadScope | None = None,
) -> list[DecisionImportOutcome]:
    """Create a draft decision per new row (see the module doc).

    ``user`` / ``read_scope`` are the importing user's: a mention in a row's
    text is checked as theirs, and one they may not make (an unknown or hidden
    card, a decision without ``adr.view``) fails that row, not the file.
    """
    existing = existing_references(await ds.load_register(db))

    cards = await _cards_by_name(
        db, {name for row in rows for name in _unique(row.card_names)}, readable_cards
    )

    outcomes: list[DecisionImportOutcome] = []
    created: list[tuple[DecisionImportOutcome, ArchitectureDecision, DecisionImportRow]] = []
    # The file's own references, mapped to the decision each row created —
    # what related references between rows resolve against.
    file_refs: dict[str, uuid.UUID] = {}
    # One row per reference is imported; the others are earlier revisions.
    imported = chosen_rows(rows, existing)
    earlier: list[DecisionImportOutcome] = []

    for position, row in enumerate(rows):
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
        if position not in imported:
            outcome = DecisionImportOutcome(
                row_index=row.row_index,
                status="skipped",
                reference_number=reference,
                warnings=[earlier_revision_warning(reference)],
            )
            outcomes.append(outcome)
            earlier.append(outcome)
            continue

        title = row.title.strip()
        error: str | None = None
        if not title:
            error = "Title is required"
        elif len(title) > TITLE_MAX_LENGTH:
            error = f"Title is longer than {TITLE_MAX_LENGTH} characters"
        if error is not None:
            outcomes.append(
                DecisionImportOutcome(row_index=row.row_index, status="failed", error=error)
            )
            continue

        card_ids, warnings = _resolve_cards(row.card_names, cards)
        status = (row.status or "").strip()
        if status and status.lower() != "draft":
            warnings.append(f"Status {status!r} is not imported; created as a draft")

        try:
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
                user=user,
                read_scope=read_scope,
            )
        except mention_service.MentionRefused as refused:
            # Raised before anything is written: the other rows go on.
            outcomes.append(
                DecisionImportOutcome(
                    row_index=row.row_index,
                    status="failed",
                    error=mention_error(str(refused.detail)),
                )
            )
            continue
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

    # A skipped earlier revision points at the decision its reference became.
    for outcome in earlier:
        target = file_refs.get(outcome.reference_number or "")
        outcome.id = str(target) if target is not None else None

    # Second pass: every row now exists, so a reference to a later row resolves.
    for outcome, adr, row in created:
        linked: set[uuid.UUID] = set()
        for ref in _unique(row.related_references):
            key = ref.upper()
            target = file_refs.get(key) or existing.get(key)
            if target is None:
                outcome.warnings.append(f"Related decision not found: {ref}")
            elif target != adr.id and target not in linked:
                linked.add(target)
                db.add(
                    ArchitectureDecisionLink(source_id=adr.id, target_id=target, kind=ds.RELATES)
                )
    await db.flush()

    return outcomes


def mention_error(detail: str) -> str:
    """The error of a row whose text mentions something the importer may not."""
    return f"Mention refused: {detail}"


def existing_references(register: ds.Register) -> dict[str, Any]:
    """Each reference number (upper case) mapped to its chain's current revision.

    A reference carried by rows of two different chains maps to the current
    revision of the first chain in reference, revision order.
    """
    out: dict[str, Any] = {}
    for row_id in sorted(register.ids(), key=lambda rid: _row_order(register, rid)):
        key = register.row(row_id).reference_number.upper()
        out.setdefault(key, register.chain(row_id).current.id)
    return out


def _row_order(register: ds.Register, row_id: Any) -> tuple[int, str]:
    row = register.row(row_id)
    return (row.revision_number, str(row.id))


def related_reference_labels(register: ds.Register, decision_id: Any) -> list[str]:
    """The decision's ``relates`` links as reference numbers, deduplicated."""
    return adr_service.reference_labels(
        register, adr_service.outgoing_targets(register, decision_id, ds.RELATES)
    )
