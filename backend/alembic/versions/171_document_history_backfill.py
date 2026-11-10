"""Give every existing decision and SoAW a timeline from what is stored.

``document_history`` (migration 169) starts empty, so without this every
document written before the release would show an empty History tab. What the
rows already record is enough for the outline of each one:

* ``created`` (a document with no parent) or ``revised`` (a revision) at its
  ``created_at``, by ``created_by``;
* one ``signature`` per signed entry of ``signatories``, at that entry's
  ``signed_at``, naming the signer by the display name stored on the entry
  (the actor id only when it is a user that still exists; an e-mail is never
  copied);
* ``signed`` at ``signed_at``;
* for a decision, ``recorded`` at ``recorded_at``, by ``recorded_by``.

No content snapshot is written. Rows are inserted in chronological order, so
the identity ``seq`` follows time. Every row carries ``via = "migration:171"``
and the downgrade deletes exactly those rows. A document that already has a
timeline is left alone, so a re-run writes nothing twice.

Revision ID: 171
Revises: 170
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable, Mapping, Sequence
from datetime import datetime, timezone
from typing import Any, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "171"
down_revision: Union[str, None] = "170"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

VIA = "migration:171"
ADR = "adr"
SOAW = "soaw"
OWNER_COLUMN = {ADR: "architecture_decision_id", SOAW: "soaw_id"}

# Where a step sorts against another step of the same document at the same
# instant: the document exists before it is signed, signed before recorded.
_STEP_RANK = {"created": 0, "revised": 0, "signature": 1, "signed": 2, "recorded": 3}


# --- Pure planner -----------------------------------------------------------------


def _as_uuid(value: Any) -> uuid.UUID | None:
    if isinstance(value, uuid.UUID):
        return value
    if not isinstance(value, str):
        return None
    try:
        return uuid.UUID(value.strip())
    except ValueError:
        return None


def _as_time(value: Any) -> datetime | None:
    """A timezone-aware instant from a datetime or an ISO string (naive = UTC)."""
    if isinstance(value, str):
        try:
            value = datetime.fromisoformat(value.strip())
        except ValueError:
            return None
    if not isinstance(value, datetime):
        return None
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def _actor(value: Any, users: Mapping[uuid.UUID, str]) -> tuple[uuid.UUID | None, str | None]:
    """``(actor_id, actor_name)`` for a user id column: the id and the user's
    current name when the user exists, nothing otherwise."""
    uid = _as_uuid(value)
    if uid is None or uid not in users:
        return None, None
    return uid, users[uid]


def _signature_steps(
    signatories: Any, users: Mapping[uuid.UUID, str]
) -> list[tuple[datetime, str, uuid.UUID | None, str | None]]:
    steps = []
    if not isinstance(signatories, list):
        return steps
    for entry in signatories:
        if not isinstance(entry, dict) or entry.get("status") != "signed":
            continue
        at = _as_time(entry.get("signed_at"))
        if at is None:
            continue
        uid = _as_uuid(entry.get("user_id"))
        name = entry.get("display_name")
        steps.append(
            (
                at,
                "signature",
                uid if uid in users else None,
                name if isinstance(name, str) and name.strip() else None,
            )
        )
    return steps


def plan_history_rows(
    rows: Iterable[Mapping[str, Any]], users: Mapping[uuid.UUID, str]
) -> list[dict[str, Any]]:
    """The timeline rows to insert, in chronological order.

    ``rows`` are documents: ``kind`` (``"adr"`` or ``"soaw"``), ``id``,
    ``parent_id``, ``created_at``, ``created_by``, ``signatories``,
    ``signed_at`` and, for a decision, ``recorded_at`` / ``recorded_by``.
    ``users`` maps every existing user id to its display name. Each planned
    row is ``{owner column: id, kind, actor_id, actor_name, created_at, via}``.
    Ties sort by step (created before a signature before signed before
    recorded), then by the order the documents came in.
    """
    keyed: list[tuple[datetime, int, int, int, dict[str, Any]]] = []
    for doc_index, doc in enumerate(rows):
        owner = {OWNER_COLUMN[doc["kind"]]: doc["id"]}
        steps: list[tuple[datetime, str, uuid.UUID | None, str | None]] = []
        created_at = _as_time(doc.get("created_at"))
        if created_at is not None:
            kind = "revised" if doc.get("parent_id") is not None else "created"
            steps.append((created_at, kind, *_actor(doc.get("created_by"), users)))
        steps.extend(_signature_steps(doc.get("signatories"), users))
        signed_at = _as_time(doc.get("signed_at"))
        if signed_at is not None:
            steps.append((signed_at, "signed", None, None))
        recorded_at = _as_time(doc.get("recorded_at")) if doc["kind"] == ADR else None
        if recorded_at is not None:
            steps.append((recorded_at, "recorded", *_actor(doc.get("recorded_by"), users)))
        for step_index, (at, kind, actor_id, actor_name) in enumerate(steps):
            keyed.append(
                (
                    at,
                    _STEP_RANK[kind],
                    doc_index,
                    step_index,
                    {
                        **owner,
                        "kind": kind,
                        "actor_id": actor_id,
                        "actor_name": actor_name,
                        "created_at": at,
                        "via": VIA,
                    },
                )
            )
    keyed.sort(key=lambda item: item[:4])
    return [item[4] for item in keyed]


# --- Database -----------------------------------------------------------------------


def _history() -> sa.TableClause:
    return sa.table(
        "document_history",
        sa.column("id", postgresql.UUID(as_uuid=True)),
        sa.column("architecture_decision_id", postgresql.UUID(as_uuid=True)),
        sa.column("soaw_id", postgresql.UUID(as_uuid=True)),
        sa.column("kind", sa.String),
        sa.column("actor_id", postgresql.UUID(as_uuid=True)),
        sa.column("actor_name", sa.String),
        sa.column("via", sa.String),
        sa.column("created_at", sa.DateTime(timezone=True)),
    )


def upgrade() -> None:
    conn = op.get_bind()
    history = _history()
    users_t = sa.table(
        "users",
        sa.column("id", postgresql.UUID(as_uuid=True)),
        sa.column("display_name", sa.String),
    )
    adrs = sa.table(
        "architecture_decisions",
        *(
            sa.column(name, postgresql.UUID(as_uuid=True))
            for name in ("id", "parent_id", "created_by", "recorded_by")
        ),
        *(
            sa.column(name, sa.DateTime(timezone=True))
            for name in ("created_at", "signed_at", "recorded_at")
        ),
        sa.column("signatories", postgresql.JSONB),
    )
    soaws = sa.table(
        "statement_of_architecture_works",
        *(sa.column(name, postgresql.UUID(as_uuid=True)) for name in ("id", "parent_id")),
        sa.column("created_by", postgresql.UUID(as_uuid=True)),
        sa.column("created_at", sa.DateTime(timezone=True)),
        sa.column("signed_at", sa.DateTime(timezone=True)),
        sa.column("signatories", postgresql.JSONB),
    )

    users = {
        uid: name for uid, name in conn.execute(sa.select(users_t.c.id, users_t.c.display_name))
    }
    owned = {
        owner_id
        for pair in conn.execute(sa.select(history.c.architecture_decision_id, history.c.soaw_id))
        for owner_id in pair
        if owner_id is not None
    }
    docs: list[dict[str, Any]] = []
    for row in conn.execute(sa.select(adrs).order_by(adrs.c.created_at, adrs.c.id)).mappings():
        if row["id"] not in owned:
            docs.append({**row, "kind": ADR})
    for row in conn.execute(sa.select(soaws).order_by(soaws.c.created_at, soaws.c.id)).mappings():
        if row["id"] not in owned:
            docs.append({**row, "kind": SOAW})

    planned = plan_history_rows(docs, users)
    # In order, so the identity follows time; chunked executemany keeps it.
    for start in range(0, len(planned), 500):
        conn.execute(
            history.insert(),
            [
                {
                    "id": uuid.uuid4(),
                    "architecture_decision_id": values.get("architecture_decision_id"),
                    "soaw_id": values.get("soaw_id"),
                    "kind": values["kind"],
                    "actor_id": values["actor_id"],
                    "actor_name": values["actor_name"],
                    "via": values["via"],
                    "created_at": values["created_at"],
                }
                for values in planned[start : start + 500]
            ],
        )


def downgrade() -> None:
    history = _history()
    op.get_bind().execute(history.delete().where(history.c.via == VIA))
