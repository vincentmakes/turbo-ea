"""EA principle references and the spreadsheet importer.

The one definition of a principle's human-readable reference (``P-001``):
every writer — the create route, the catalogue import, the demo seed, the
workspace applier and the spreadsheet import — goes through
``next_principle_reference`` or ``ensure_principle_references``. The highest
number is found **numerically**, so ``P-1000`` follows ``P-999`` (a string
``max()`` would keep answering ``P-999``).

``import_principle_rows`` is the body of ``POST /metamodel/principles/
bulk-import``: match each row on reference, then on title (case-insensitive);
update what changed, skip what did not, create the rest. Every row is fully
validated before anything is written, so a bad row fails alone and leaves
nothing behind. Nothing here commits — the route owns the transaction (and
the dry-run rollback).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.ea_principle import EAPrinciple

REFERENCE_PREFIX = "P-"
_REFERENCE_RE = re.compile(r"^P-(\d+)$", re.IGNORECASE)

TITLE_MAX_LENGTH = 300

_TRUE_WORDS = frozenset({"true", "yes", "y", "1", "active"})
_FALSE_WORDS = frozenset({"false", "no", "n", "0", "inactive"})

# Text columns a row may set; ``None`` on the item leaves the column alone.
TEXT_FIELDS: tuple[str, ...] = ("description", "rationale", "implications")


def format_reference(number: int) -> str:
    return f"{REFERENCE_PREFIX}{number:03d}"


def reference_sequence(reference: str | None) -> int | None:
    """The number inside a ``P-NNN`` reference, or ``None`` for anything else."""
    if not reference:
        return None
    match = _REFERENCE_RE.match(reference.strip())
    return int(match.group(1)) if match else None


async def highest_reference_sequence(db: AsyncSession) -> int:
    result = await db.execute(
        select(EAPrinciple.reference_number).where(EAPrinciple.reference_number.is_not(None))
    )
    numbers = [reference_sequence(ref) for ref in result.scalars().all()]
    return max((n for n in numbers if n is not None), default=0)


async def next_principle_reference(db: AsyncSession) -> str:
    return format_reference(await highest_reference_sequence(db) + 1)


async def ensure_principle_references(db: AsyncSession) -> int:
    """Number every principle that has no reference yet; return how many.

    Rows are numbered in the order the Principles page lists them, after the
    highest reference already in use. Flushes, never commits.
    """
    await db.flush()
    result = await db.execute(
        select(EAPrinciple)
        .where(EAPrinciple.reference_number.is_(None))
        .order_by(EAPrinciple.sort_order, EAPrinciple.created_at, EAPrinciple.id)
    )
    missing = list(result.scalars().all())
    if not missing:
        return 0
    seq = await highest_reference_sequence(db)
    for principle in missing:
        seq += 1
        principle.reference_number = format_reference(seq)
    await db.flush()
    return len(missing)


# ---------------------------------------------------------------------------
# Spreadsheet import
# ---------------------------------------------------------------------------


def parse_active(value: str) -> bool:
    """Read an ``is_active`` cell: true/false, yes/no, 1/0, active/inactive."""
    word = value.strip().lower()
    if word in _TRUE_WORDS:
        return True
    if word in _FALSE_WORDS:
        return False
    raise ValueError(f"Invalid is_active: {value!r} (use true or false)")


def parse_sort_order(value: str) -> int:
    text = value.strip()
    try:
        number = float(text)
    except ValueError:
        raise ValueError(f"Invalid sort_order: {value!r} (use a whole number)") from None
    if not number.is_integer():
        raise ValueError(f"Invalid sort_order: {value!r} (use a whole number)")
    return int(number)


def _clean_text(value: str) -> str | None:
    """A text cell as stored: trimmed, and an empty cell clears the field."""
    text = value.strip()
    return text or None


@dataclass
class PrincipleImportRow:
    """One spreadsheet row, as the route hands it over."""

    row_index: int
    title: str
    reference_number: str | None = None
    description: str | None = None
    rationale: str | None = None
    implications: str | None = None
    is_active: str | None = None
    sort_order: str | None = None


@dataclass
class PrincipleImportOutcome:
    row_index: int
    status: str  # created | updated | skipped | failed
    id: str | None = None
    reference_number: str | None = None
    changed_fields: list[str] = field(default_factory=list)
    error: str | None = None
    warnings: list[str] = field(default_factory=list)


def _desired_values(row: PrincipleImportRow) -> dict[str, object]:
    """The column values a row asks for; a column the sheet lacks is absent."""
    values: dict[str, object] = {"title": row.title.strip()}
    for name in TEXT_FIELDS:
        raw = getattr(row, name)
        if raw is not None:
            values[name] = _clean_text(raw)
    if row.is_active is not None and row.is_active.strip():
        values["is_active"] = parse_active(row.is_active)
    if row.sort_order is not None and row.sort_order.strip():
        values["sort_order"] = parse_sort_order(row.sort_order)
    return values


def changed_fields(principle: EAPrinciple, values: dict[str, object]) -> list[str]:
    return [name for name, value in values.items() if getattr(principle, name) != value]


def _reference_list(principles: list[EAPrinciple]) -> str:
    return " and ".join(sorted(p.reference_number or "?" for p in principles))


async def import_principle_rows(
    db: AsyncSession, rows: list[PrincipleImportRow]
) -> list[PrincipleImportOutcome]:
    """Apply spreadsheet rows to the principles table (see the module doc)."""
    existing = list((await db.execute(select(EAPrinciple))).scalars().all())
    by_reference = {p.reference_number.upper(): p for p in existing if p.reference_number}
    # Titles are not unique in the table, so a title maps to every holder: a
    # title-only row that matches two principles is ambiguous, not last-wins.
    by_title: dict[str, list[EAPrinciple]] = {}
    for principle in existing:
        by_title.setdefault(principle.title.strip().casefold(), []).append(principle)

    max_sort = (await db.execute(select(func.max(EAPrinciple.sort_order)))).scalar_one() or 0
    next_sort = max_sort + 10
    next_seq = await highest_reference_sequence(db)

    # What earlier rows of the file already used: a reference, a principle
    # (by whichever match), and a title a row renamed to or created with. A
    # later row repeating one fails, which is also why ``by_title`` is never
    # given what this import creates: no later row can reach it.
    seen_references: set[str] = set()
    seen_targets: set[object] = set()
    claimed_titles: set[str] = set()
    outcomes: list[PrincipleImportOutcome] = []

    def fail(row: PrincipleImportRow, error: str, reference: str | None = None) -> None:
        outcomes.append(
            PrincipleImportOutcome(
                row_index=row.row_index, status="failed", reference_number=reference, error=error
            )
        )

    for row in rows:
        warnings: list[str] = []
        reference = (row.reference_number or "").strip().upper()
        title = row.title.strip()
        title_key = title.casefold()

        try:
            if not title:
                raise ValueError("Title is required")
            if len(title) > TITLE_MAX_LENGTH:
                raise ValueError(f"Title is longer than {TITLE_MAX_LENGTH} characters")
            if reference and reference in seen_references:
                raise ValueError(f"Reference {reference} appears more than once in the file")
            values = _desired_values(row)
        except ValueError as exc:
            fail(row, str(exc))
            continue
        if reference:
            seen_references.add(reference)

        target = by_reference.get(reference)
        if target is None:
            candidates = by_title.get(title_key, [])
            if len(candidates) > 1:
                fail(
                    row,
                    f"Title {title!r} matches {_reference_list(candidates)}; add the reference "
                    "to say which one",
                )
                continue
            target = candidates[0] if candidates else None
            if reference and target is not None:
                warnings.append(
                    f"Reference {reference} not found; matched {target.reference_number} by title"
                )
        if target is not None and target.id in seen_targets:
            fail(
                row,
                f"{target.reference_number} appears more than once in the file",
                target.reference_number,
            )
            continue

        # A title is only contested when the row would write it: a rename, or
        # a new principle. An unchanged title never conflicts, so an untouched
        # export re-imports as skipped even where two principles share one.
        old_title_key = target.title.strip().casefold() if target is not None else None
        if old_title_key != title_key:
            holders = [p for p in by_title.get(title_key, []) if p is not target]
            if holders:
                fail(
                    row,
                    f"Another principle ({_reference_list(holders)}) already has the title "
                    f"{title!r}",
                    target.reference_number if target is not None else None,
                )
                continue
            if title_key in claimed_titles:
                fail(
                    row,
                    f"Title {title!r} appears more than once in the file",
                    target.reference_number if target is not None else None,
                )
                continue
            claimed_titles.add(title_key)

        if target is not None:
            seen_targets.add(target.id)
            changes = changed_fields(target, values)
            if not changes:
                outcomes.append(
                    PrincipleImportOutcome(
                        row_index=row.row_index,
                        status="skipped",
                        id=str(target.id),
                        reference_number=target.reference_number,
                        warnings=warnings,
                    )
                )
                continue
            for name in changes:
                setattr(target, name, values[name])
            await db.flush()
            if old_title_key != title_key:
                # The old title is free for a later row — but only this
                # principle's entry goes; a case twin keeps its own.
                by_title[old_title_key or ""] = [
                    p for p in by_title.get(old_title_key or "", []) if p is not target
                ]
            outcomes.append(
                PrincipleImportOutcome(
                    row_index=row.row_index,
                    status="updated",
                    id=str(target.id),
                    reference_number=target.reference_number,
                    changed_fields=changes,
                    warnings=warnings,
                )
            )
            continue

        if reference:
            warnings.append(f"Reference {reference} not found; a new reference was assigned")
        next_seq += 1
        new_reference = format_reference(next_seq)
        principle = EAPrinciple(reference_number=new_reference, **values)
        if "sort_order" not in values:
            principle.sort_order = next_sort
            next_sort += 10
        db.add(principle)
        await db.flush()
        outcomes.append(
            PrincipleImportOutcome(
                row_index=row.row_index,
                status="created",
                id=str(principle.id),
                reference_number=new_reference,
                warnings=warnings,
            )
        )

    return outcomes
