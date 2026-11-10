"""Decision register, additive step: dates, people, typed links and files on ADRs.

``architecture_decisions`` gains the dates of a decision (``decided_on``,
``effective_from``, ``valid_until``), a revision's ``change_summary`` and who
recorded an already-taken decision (``recorded_by`` / ``recorded_at``). Four
tables arrive:

* ``architecture_decision_links`` — typed links between decisions (``relates``,
  ``replaces``, ``amends``, ``revokes``, ``consolidates``), one per ordered
  pair, never to itself;
* ``architecture_decision_people`` — decision makers and participants, a user
  or a free-text name (the name is always stored as a snapshot);
* ``architecture_decision_file_contents`` — file bytes, shareable between the
  file rows of a decision's revisions;
* ``architecture_decision_files`` — a file on one decision, pointing at its
  bytes (``RESTRICT``: content goes only when nothing points at it).

Data: a signed decision's ``decided_on`` and ``effective_from`` take the UTC
date of ``signed_at``. Every ``related_decisions`` entry that names an existing
decision — by id or by reference number — becomes a ``relates`` link; dict
entries (TurboLens assessment pointers) and dangling entries are dropped, as
nothing reads them. The ``related_decisions`` column itself and the single
unique on ``reference_number`` stay for now; migration 168 removes them.

Revision ID: 167
Revises: 166
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable, Sequence
from typing import Any, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "167"
down_revision: Union[str, None] = "166"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

ADR_TABLE = "architecture_decisions"
DATE_COLUMNS = ("decided_on", "effective_from", "valid_until")


# --- Pure planner (a self-contained copy of
# ``app.services.decision_links_legacy.plan_relates_links``; a migration never
# imports app code, which changes after it ships) ----------------------------


def _as_uuid_text(value: str) -> str | None:
    try:
        return str(uuid.UUID(value))
    except ValueError:
        return None


def plan_relates_links(rows: Iterable[tuple[Any, Any, Any]]) -> list[tuple[Any, Any]]:
    """Plan the ``(source_id, target_id)`` pairs of ``relates`` links.

    ``rows`` carry ``(id, reference_number, related_decisions)``. A string
    entry becomes a pair when it is the id of one of the rows or their
    reference number (case and surrounding spaces ignored). A reference shared
    by more than one row names no single decision and is dropped. Dict entries,
    non-strings, unknown ids and references, and self links are dropped; a
    target named twice yields one pair. Pairs come out in row order, then entry
    order.
    """
    rows = list(rows)
    by_id: dict[str, Any] = {}
    by_ref: dict[str, Any] = {}
    shared_refs: set[str] = set()
    for row_id, reference, _related in rows:
        by_id[str(row_id)] = row_id
        if isinstance(reference, str) and reference.strip():
            key = reference.strip().upper()
            if key in by_ref:
                shared_refs.add(key)
            by_ref[key] = row_id
    for key in shared_refs:
        del by_ref[key]

    pairs: list[tuple[Any, Any]] = []
    seen: set[tuple[str, str]] = set()
    for row_id, _reference, related in rows:
        if not isinstance(related, list):
            continue
        for entry in related:
            if not isinstance(entry, str) or not entry.strip():
                continue
            text = entry.strip()
            as_id = _as_uuid_text(text)
            target = by_id.get(as_id) if as_id is not None else by_ref.get(text.upper())
            if target is None or str(target) == str(row_id):
                continue
            pair_key = (str(row_id), str(target))
            if pair_key in seen:
                continue
            seen.add(pair_key)
            pairs.append((row_id, target))
    return pairs


# --- Schema -------------------------------------------------------------------


def _created_at() -> sa.Column:
    # The ORM leaves the stamp out of the INSERT and relies on this default.
    return sa.Column(
        "created_at",
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.func.now(),
    )


def _decision_fk(name: str) -> sa.Column:
    return sa.Column(
        name,
        postgresql.UUID(as_uuid=True),
        sa.ForeignKey("architecture_decisions.id", ondelete="CASCADE"),
        nullable=False,
    )


def _user_fk(name: str) -> sa.Column:
    return sa.Column(
        name,
        postgresql.UUID(as_uuid=True),
        sa.ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )


def _add_decision_columns() -> None:
    for column in DATE_COLUMNS:
        op.add_column(ADR_TABLE, sa.Column(column, sa.Date(), nullable=True))
    op.add_column(ADR_TABLE, sa.Column("change_summary", sa.String(length=2000), nullable=True))
    op.add_column(ADR_TABLE, _user_fk("recorded_by"))
    op.add_column(ADR_TABLE, sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=True))


def _create_tables() -> None:
    op.create_table(
        "architecture_decision_links",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        _decision_fk("source_id"),
        _decision_fk("target_id"),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("note", sa.String(length=1000), nullable=True),
        _created_at(),
        sa.UniqueConstraint("source_id", "target_id", name="uq_adr_link_pair"),
        sa.CheckConstraint("source_id <> target_id", name="ck_adr_link_not_self"),
    )
    op.create_index(
        "ix_architecture_decision_links_source_id", "architecture_decision_links", ["source_id"]
    )
    op.create_index(
        "ix_architecture_decision_links_target_id", "architecture_decision_links", ["target_id"]
    )

    op.create_table(
        "architecture_decision_people",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        _decision_fk("architecture_decision_id"),
        sa.Column("part", sa.String(length=20), nullable=False),
        _user_fk("user_id"),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        _created_at(),
    )
    op.create_index(
        "ix_architecture_decision_people_architecture_decision_id",
        "architecture_decision_people",
        ["architecture_decision_id"],
    )

    op.create_table(
        "architecture_decision_file_contents",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("data", sa.LargeBinary(), nullable=False),
        _created_at(),
    )

    op.create_table(
        "architecture_decision_files",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        _decision_fk("architecture_decision_id"),
        sa.Column(
            "content_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("architecture_decision_file_contents.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("name", sa.String(length=500), nullable=False),
        sa.Column("mime_type", sa.String(length=200), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        _user_fk("created_by"),
        _created_at(),
    )
    op.create_index(
        "ix_architecture_decision_files_architecture_decision_id",
        "architecture_decision_files",
        ["architecture_decision_id"],
    )
    op.create_index(
        "ix_architecture_decision_files_content_id",
        "architecture_decision_files",
        ["content_id"],
    )


# --- Data -----------------------------------------------------------------------


def _backfill_signed_dates(bind: sa.engine.Connection) -> None:
    adrs = sa.table(
        ADR_TABLE,
        sa.column("status", sa.String),
        sa.column("signed_at", sa.DateTime(timezone=True)),
        sa.column("decided_on", sa.Date),
        sa.column("effective_from", sa.Date),
    )
    # The UTC calendar date, whatever the session's time zone: the standing
    # service compares against a UTC ``today``.
    signed_on = sa.cast(sa.func.timezone("UTC", adrs.c.signed_at), sa.Date)
    bind.execute(
        adrs.update()
        .where(adrs.c.status == "signed")
        .where(adrs.c.signed_at.is_not(None))
        .where(sa.or_(adrs.c.decided_on.is_(None), adrs.c.effective_from.is_(None)))
        .values(
            decided_on=sa.func.coalesce(adrs.c.decided_on, signed_on),
            effective_from=sa.func.coalesce(adrs.c.effective_from, signed_on),
        )
    )


def _convert_related_decisions(bind: sa.engine.Connection) -> None:
    adrs = sa.table(
        ADR_TABLE,
        sa.column("id", postgresql.UUID(as_uuid=True)),
        sa.column("reference_number", sa.String),
        sa.column("related_decisions", postgresql.JSONB),
    )
    links = sa.table(
        "architecture_decision_links",
        sa.column("id", postgresql.UUID(as_uuid=True)),
        sa.column("source_id", postgresql.UUID(as_uuid=True)),
        sa.column("target_id", postgresql.UUID(as_uuid=True)),
        sa.column("kind", sa.String),
    )
    rows = bind.execute(
        sa.select(adrs.c.id, adrs.c.reference_number, adrs.c.related_decisions)
    ).all()
    pairs = plan_relates_links((r[0], r[1], r[2]) for r in rows)
    if pairs:
        bind.execute(
            links.insert(),
            [
                {"id": uuid.uuid4(), "source_id": src, "target_id": tgt, "kind": "relates"}
                for src, tgt in pairs
            ],
        )


def upgrade() -> None:
    _add_decision_columns()
    _create_tables()
    bind = op.get_bind()
    _backfill_signed_dates(bind)
    _convert_related_decisions(bind)


def downgrade() -> None:
    op.drop_index(
        "ix_architecture_decision_files_content_id", table_name="architecture_decision_files"
    )
    op.drop_index(
        "ix_architecture_decision_files_architecture_decision_id",
        table_name="architecture_decision_files",
    )
    op.drop_table("architecture_decision_files")
    op.drop_table("architecture_decision_file_contents")
    op.drop_index(
        "ix_architecture_decision_people_architecture_decision_id",
        table_name="architecture_decision_people",
    )
    op.drop_table("architecture_decision_people")
    op.drop_index(
        "ix_architecture_decision_links_target_id", table_name="architecture_decision_links"
    )
    op.drop_index(
        "ix_architecture_decision_links_source_id", table_name="architecture_decision_links"
    )
    op.drop_table("architecture_decision_links")
    op.drop_column(ADR_TABLE, "recorded_at")
    op.drop_column(ADR_TABLE, "recorded_by")
    op.drop_column(ADR_TABLE, "change_summary")
    for column in reversed(DATE_COLUMNS):
        op.drop_column(ADR_TABLE, column)
