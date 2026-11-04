"""EA principle references (``P-NNN``) and the spreadsheet import engine.

The pure helpers run without a database; the rest are DB-backed (skipped
locally without PostgreSQL, run in CI).
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

import pytest
from sqlalchemy import select

from app.models.ea_principle import EAPrinciple
from app.services import principle_service as svc
from app.services import principles_catalogue_service as catalogue
from app.services.principle_service import PrincipleImportRow as Row

# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------


def test_format_reference_pads_to_three_digits_and_grows_past_them():
    assert svc.format_reference(1) == "P-001"
    assert svc.format_reference(42) == "P-042"
    assert svc.format_reference(1000) == "P-1000"


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("P-007", 7),
        ("p-12", 12),
        (" P-1000 ", 1000),
        ("PR-001", None),
        ("P-", None),
        ("P-1a", None),
        ("", None),
        (None, None),
    ],
)
def test_reference_sequence_reads_only_p_numbers(value, expected):
    assert svc.reference_sequence(value) == expected


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("true", True),
        ("Yes", True),
        (" y ", True),
        ("1", True),
        ("ACTIVE", True),
        ("false", False),
        ("No", False),
        ("n", False),
        ("0", False),
        ("inactive", False),
    ],
)
def test_parse_active_accepts_the_usual_spellings(value, expected):
    assert svc.parse_active(value) is expected


def test_parse_active_refuses_anything_else():
    with pytest.raises(ValueError, match="Invalid is_active: 'maybe'"):
        svc.parse_active("maybe")


def test_parse_sort_order_accepts_whole_numbers_even_as_floats():
    assert svc.parse_sort_order("30") == 30
    assert svc.parse_sort_order(" 40.0 ") == 40
    assert svc.parse_sort_order("-5") == -5


@pytest.mark.parametrize("value", ["abc", "2.5", ""])
def test_parse_sort_order_refuses_fractions_and_text(value):
    with pytest.raises(ValueError, match="Invalid sort_order"):
        svc.parse_sort_order(value)


# ---------------------------------------------------------------------------
# References (DB)
# ---------------------------------------------------------------------------


def _principle(title: str, *, ref: str | None = None, sort_order: int = 0, **kw) -> EAPrinciple:
    kw.setdefault("id", uuid.uuid4())
    return EAPrinciple(title=title, reference_number=ref, sort_order=sort_order, **kw)


def _uuid(n: int) -> uuid.UUID:
    return uuid.UUID(int=n)


def _at(day: int) -> datetime:
    return datetime(2026, 1, day, tzinfo=timezone.utc)


async def _by_title(db) -> dict[str, EAPrinciple]:
    rows = (await db.execute(select(EAPrinciple))).scalars().all()
    return {p.title: p for p in rows}


async def test_next_reference_starts_at_one(db):
    assert await svc.next_principle_reference(db) == "P-001"


async def test_next_reference_is_numeric_not_lexical(db):
    """``"P-999" > "P-1000"`` as strings; the sequence must still move on."""
    db.add_all([_principle("A", ref="P-999"), _principle("B", ref="P-1000")])
    db.add(_principle("Foreign", ref="X-5000"))
    await db.flush()
    assert await svc.next_principle_reference(db) == "P-1001"


async def test_ensure_numbers_missing_rows_in_page_order_after_the_highest(db):
    db.add_all(
        [
            _principle("Kept", ref="P-004", sort_order=0),
            _principle("Second", sort_order=20),
            _principle("First", sort_order=10),
        ]
    )
    assert await svc.ensure_principle_references(db) == 2
    rows = await _by_title(db)
    assert rows["Kept"].reference_number == "P-004"
    assert rows["First"].reference_number == "P-005"
    assert rows["Second"].reference_number == "P-006"
    # Nothing left to number on a second call.
    assert await svc.ensure_principle_references(db) == 0


async def test_ensure_orders_by_sort_order_then_creation_then_id(db):
    """Each ORDER BY key decides one pair: the ids run against sort_order and
    creation, so dropping any key renumbers the rows."""
    db.add_all(
        [
            # Sort order decides: B sorts first though created later, larger id.
            _principle("A", sort_order=20, id=_uuid(1), created_at=_at(1)),
            _principle("B", sort_order=10, id=_uuid(9), created_at=_at(9)),
            # Same sort order: creation decides, against the id order.
            _principle("C", sort_order=30, id=_uuid(2), created_at=_at(5)),
            _principle("D", sort_order=30, id=_uuid(8), created_at=_at(4)),
            # Same sort order and creation: the id decides.
            _principle("F", sort_order=40, id=_uuid(7), created_at=_at(6)),
            _principle("E", sort_order=40, id=_uuid(3), created_at=_at(6)),
        ]
    )
    assert await svc.ensure_principle_references(db) == 6
    rows = await _by_title(db)
    assert [rows[t].reference_number for t in "BADCEF"] == [
        "P-001",
        "P-002",
        "P-003",
        "P-004",
        "P-005",
        "P-006",
    ]


async def test_catalogue_import_numbers_what_it_creates(db):
    await catalogue.import_principles(db, catalogue_ids=["PR-001", "PR-002"])
    refs = sorted(p.reference_number for p in (await _by_title(db)).values())
    assert refs == ["P-001", "P-002"]


# ---------------------------------------------------------------------------
# Spreadsheet import engine (DB)
# ---------------------------------------------------------------------------


async def test_import_creates_with_fresh_references_and_defaults(db):
    db.add(_principle("Existing", ref="P-003", sort_order=50))
    await db.flush()

    outcomes = await svc.import_principle_rows(
        db,
        [
            Row(row_index=0, title="Cloud first", description="Prefer SaaS"),
            Row(row_index=1, title="API first", is_active="no", sort_order="5"),
        ],
    )

    assert [(o.status, o.reference_number) for o in outcomes] == [
        ("created", "P-004"),
        ("created", "P-005"),
    ]
    rows = await _by_title(db)
    cloud, api = rows["Cloud first"], rows["API first"]
    assert cloud.description == "Prefer SaaS"
    assert cloud.is_active is True
    # Appended after the highest sort order, one step of ten apart.
    assert cloud.sort_order == 60
    assert api.is_active is False
    assert api.sort_order == 5
    assert outcomes[0].id == str(cloud.id)


async def test_import_updates_by_reference_including_a_rename(db):
    db.add(_principle("Old name", ref="P-001", description="old", rationale="keep"))
    await db.flush()

    [outcome] = await svc.import_principle_rows(
        db,
        [Row(row_index=0, reference_number="p-001", title="New name", description="new")],
    )

    assert outcome.status == "updated"
    assert outcome.reference_number == "P-001"
    assert outcome.changed_fields == ["title", "description"]
    principle = (await _by_title(db))["New name"]
    assert principle.description == "new"
    # The sheet had no rationale column: the field is left alone.
    assert principle.rationale == "keep"


async def test_import_updates_by_title_ignoring_case(db):
    db.add(_principle("Reuse before buy", ref="P-002", implications="x"))
    await db.flush()

    [outcome] = await svc.import_principle_rows(
        db, [Row(row_index=0, title="  reuse BEFORE buy ", implications="")]
    )

    assert outcome.status == "updated"
    assert outcome.changed_fields == ["title", "implications"]
    # An empty cell is a deliberate blank and clears the field.
    principle = (await db.execute(select(EAPrinciple))).scalar_one()
    assert principle.implications is None
    assert principle.title == "reuse BEFORE buy"


async def test_import_skips_rows_that_change_nothing(db):
    db.add(_principle("Same", ref="P-001", description="d", sort_order=10))
    await db.flush()

    [outcome] = await svc.import_principle_rows(
        db,
        [
            Row(
                row_index=0,
                reference_number="P-001",
                title="Same",
                description=" d ",
                is_active="true",
                sort_order="10",
            )
        ],
    )

    assert (outcome.status, outcome.reference_number, outcome.changed_fields) == (
        "skipped",
        "P-001",
        [],
    )


async def test_unknown_reference_falls_back_to_title_with_a_warning(db):
    db.add(_principle("Shared", ref="P-001"))
    await db.flush()

    [outcome] = await svc.import_principle_rows(
        db, [Row(row_index=0, reference_number="P-999", title="Shared", description="d")]
    )

    assert outcome.status == "updated"
    assert outcome.reference_number == "P-001"
    assert outcome.warnings == ["Reference P-999 not found; matched P-001 by title"]


async def test_unknown_reference_with_a_new_title_creates_with_a_warning(db):
    [outcome] = await svc.import_principle_rows(
        db, [Row(row_index=0, reference_number="P-077", title="Brand new")]
    )

    assert (outcome.status, outcome.reference_number) == ("created", "P-001")
    assert outcome.warnings == ["Reference P-077 not found; a new reference was assigned"]


async def test_bad_rows_fail_alone(db):
    outcomes = await svc.import_principle_rows(
        db,
        [
            Row(row_index=0, title=""),
            Row(row_index=1, title="x" * 301),
            Row(row_index=2, title="Bad flag", is_active="maybe"),
            Row(row_index=3, title="Bad order", sort_order="first"),
            Row(row_index=4, title="Good"),
        ],
    )

    assert [o.status for o in outcomes] == ["failed"] * 4 + ["created"]
    assert outcomes[0].error == "Title is required"
    assert outcomes[1].error == "Title is longer than 300 characters"
    assert "Invalid is_active" in outcomes[2].error
    assert "Invalid sort_order" in outcomes[3].error
    assert list(await _by_title(db)) == ["Good"]


async def test_duplicates_within_the_file_fail_the_later_row(db):
    db.add(_principle("Existing", ref="P-001"))
    await db.flush()

    outcomes = await svc.import_principle_rows(
        db,
        [
            Row(row_index=0, title="One"),
            Row(row_index=1, title="one"),
            Row(row_index=2, reference_number="P-001", title="Existing"),
            Row(row_index=3, reference_number="p-001", title="Other"),
        ],
    )

    assert [o.status for o in outcomes] == ["created", "failed", "skipped", "failed"]
    assert outcomes[1].error == "Title 'one' appears more than once in the file"
    assert outcomes[3].error == "Reference P-001 appears more than once in the file"


async def test_renaming_onto_another_principles_title_fails(db):
    db.add_all([_principle("Alpha", ref="P-001"), _principle("Beta", ref="P-002")])
    await db.flush()

    [outcome] = await svc.import_principle_rows(
        db, [Row(row_index=0, reference_number="P-001", title="beta")]
    )

    assert outcome.status == "failed"
    assert outcome.reference_number == "P-001"
    assert outcome.error == "Another principle (P-002) already has the title 'beta'"
    assert (await _by_title(db))["Alpha"].reference_number == "P-001"


async def test_a_rename_frees_the_old_title_for_a_later_row(db):
    db.add(_principle("Alpha", ref="P-001"))
    await db.flush()

    outcomes = await svc.import_principle_rows(
        db,
        [
            Row(row_index=0, reference_number="P-001", title="Gamma"),
            Row(row_index=1, title="Alpha"),
        ],
    )

    assert [(o.status, o.reference_number) for o in outcomes] == [
        ("updated", "P-001"),
        ("created", "P-002"),
    ]


async def test_created_rows_carry_every_column(db):
    """On an empty table the first new principle gets sort order 10."""
    [outcome] = await svc.import_principle_rows(
        db,
        [
            Row(
                row_index=4,
                title="Full",
                description=" Statement ",
                rationale="Why",
                implications="So what",
                is_active="false",
            )
        ],
    )

    principle = (await db.execute(select(EAPrinciple))).scalar_one()
    assert outcome.row_index == 4
    assert outcome.id == str(principle.id)
    assert (
        principle.reference_number,
        principle.title,
        principle.description,
        principle.rationale,
        principle.implications,
        principle.is_active,
        principle.sort_order,
    ) == ("P-001", "Full", "Statement", "Why", "So what", False, 10)


async def test_a_title_of_exactly_the_limit_is_accepted(db):
    [outcome] = await svc.import_principle_rows(db, [Row(row_index=0, title="x" * 300)])
    assert outcome.status == "created"


async def test_rows_without_a_reference_are_not_duplicates_of_each_other(db):
    outcomes = await svc.import_principle_rows(
        db, [Row(row_index=0, title="One"), Row(row_index=1, title="Two", reference_number="  ")]
    )
    assert [(o.status, o.reference_number) for o in outcomes] == [
        ("created", "P-001"),
        ("created", "P-002"),
    ]


async def test_skipped_and_updated_outcomes_name_the_principle(db):
    same = _principle("Same", ref="P-001")
    changed = _principle("Changed", ref="P-002")
    db.add_all([same, changed])
    await db.flush()

    skipped, updated = await svc.import_principle_rows(
        db,
        [
            # An unknown reference falls back to the title; nothing differs.
            Row(row_index=0, reference_number="P-404", title="Same"),
            Row(row_index=1, reference_number="P-002", title="Changed", description="new"),
        ],
    )

    assert (skipped.status, skipped.id, skipped.reference_number) == (
        "skipped",
        str(same.id),
        "P-001",
    )
    assert skipped.warnings == ["Reference P-404 not found; matched P-001 by title"]
    assert (updated.status, updated.id, updated.row_index) == ("updated", str(changed.id), 1)


async def test_rows_after_a_refused_rename_are_still_imported(db):
    db.add_all([_principle("Alpha", ref="P-001"), _principle("Beta", ref="P-002")])
    await db.flush()

    refused, later = await svc.import_principle_rows(
        db,
        [
            Row(row_index=3, reference_number="P-001", title="Beta"),
            Row(row_index=4, title="Delta"),
        ],
    )

    assert (refused.status, refused.row_index) == ("failed", 3)
    assert (later.status, later.reference_number) == ("created", "P-003")


async def test_a_rename_keeps_a_case_twin_reachable_by_title(db):
    """Two stored principles may share a title up to case; renaming the one the
    title index does not point at must not drop the other from it."""
    first = _principle("Alpha", ref="P-001")
    twin = _principle("alpha", ref="P-002")
    db.add_all([first, twin])
    await db.flush()

    renamed, matched = await svc.import_principle_rows(
        db,
        [
            Row(row_index=0, reference_number="P-001", title="Gamma"),
            Row(row_index=1, title="ALPHA", description="found"),
        ],
    )

    assert renamed.status == "updated"
    assert (matched.status, matched.id) == ("updated", str(twin.id))
    assert len((await db.execute(select(EAPrinciple))).scalars().all()) == 2


async def test_a_reference_minted_by_this_import_is_not_matched_by_a_later_row(db):
    db.add(_principle("Existing", ref="P-001"))
    await db.flush()

    created, later = await svc.import_principle_rows(
        db,
        [
            Row(row_index=0, title="New"),
            Row(row_index=1, reference_number="P-002", title="Other"),
        ],
    )

    assert (created.status, created.reference_number) == ("created", "P-002")
    assert (later.status, later.reference_number) == ("created", "P-003")
    assert later.warnings == ["Reference P-002 not found; a new reference was assigned"]
    assert sorted(await _by_title(db)) == ["Existing", "New", "Other"]


async def test_rows_without_a_sort_order_are_appended_ten_apart(db):
    db.add(_principle("Existing", ref="P-001", sort_order=50))
    await db.flush()

    await svc.import_principle_rows(
        db,
        [
            Row(row_index=0, title="First"),
            Row(row_index=1, title="Pinned", sort_order="5"),
            Row(row_index=2, title="Second"),
        ],
    )

    rows = await _by_title(db)
    assert [rows[t].sort_order for t in ("First", "Pinned", "Second")] == [60, 5, 70]
    assert all(rows[t].is_active is True for t in ("First", "Pinned", "Second"))


async def test_an_untouched_export_re_imports_as_skipped_even_with_shared_titles(db):
    """Titles are not unique in the table; a row that keeps its own title must
    never be refused because another principle holds the same one."""
    db.add_all(
        [
            _principle("Security first", ref="P-001", description="a"),
            _principle("Security first", ref="P-002", description="b"),
        ]
    )
    await db.flush()

    outcomes = await svc.import_principle_rows(
        db,
        [
            Row(row_index=0, reference_number="P-001", title="Security first", description="a"),
            Row(row_index=1, reference_number="P-002", title="Security first", description="b"),
        ],
    )

    assert [(o.status, o.reference_number) for o in outcomes] == [
        ("skipped", "P-001"),
        ("skipped", "P-002"),
    ]


async def test_a_title_only_row_matching_two_principles_is_ambiguous(db):
    db.add_all([_principle("Shared", ref="P-002"), _principle("shared", ref="P-001")])
    await db.flush()

    [outcome] = await svc.import_principle_rows(
        db, [Row(row_index=0, title="SHARED", description="x")]
    )

    assert outcome.status == "failed"
    assert outcome.error == (
        "Title 'SHARED' matches P-001 and P-002; add the reference to say which one"
    )
    assert all(p.description is None for p in (await _by_title(db)).values())


async def test_the_same_principle_addressed_twice_fails_the_later_row(db):
    db.add(_principle("Alpha", ref="P-001"))
    await db.flush()

    by_reference, by_title = await svc.import_principle_rows(
        db,
        [
            Row(row_index=0, reference_number="P-001", title="Alpha", description="first"),
            Row(row_index=1, title="alpha", description="second"),
        ],
    )

    assert by_reference.status == "updated"
    assert (by_title.status, by_title.reference_number) == ("failed", "P-001")
    assert by_title.error == "P-001 appears more than once in the file"
    assert (await _by_title(db))["Alpha"].description == "first"


async def test_a_rename_onto_a_title_the_file_just_created_fails(db):
    db.add(_principle("Old", ref="P-001"))
    await db.flush()

    created, renamed = await svc.import_principle_rows(
        db,
        [
            Row(row_index=0, title="Fresh"),
            Row(row_index=1, reference_number="P-001", title="fresh"),
        ],
    )

    assert created.status == "created"
    assert (renamed.status, renamed.reference_number) == ("failed", "P-001")
    assert renamed.error == "Title 'fresh' appears more than once in the file"
