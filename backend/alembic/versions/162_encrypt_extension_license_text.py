"""Encrypt ``extension_licenses.raw_text`` at rest.

The license signature covers the payload's exact bytes, so the envelope is
stored whole: ``raw_text`` is encrypted with the shared ``encrypt_value``
helper (``enc:`` prefix, Fernet key derived from ``SECRET_KEY``). The readers
(``registry.refresh_from_db``, ``license_refresh.refresh_license``) decrypt
before verifying, and pass a prefix-less value through as legacy plaintext,
so the application works whether or not this migration has run.

**Upgrade** encrypts every row not yet encrypted — the active license and the
superseded audit rows alike. Idempotent: an ``enc:`` row is left alone.

**Downgrade** writes the plaintext back, but only for a row that decrypts
under the current ``SECRET_KEY``. A row that does not (the key was rotated)
is left encrypted rather than overwritten with ``""``: the older code then
fails to verify it, which is the same soft-disable the admin sees today, and
the envelope is not lost.

Revision ID: 162
Revises: 161
Create Date: 2026-11-02
"""

from typing import Iterable, Literal, Sequence, TypeVar, Union

import sqlalchemy as sa

from alembic import op

revision: str = "162"
down_revision: Union[str, None] = "161"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

RowId = TypeVar("RowId")


def plan_rows(
    rows: Iterable[tuple[RowId, str | None]],
    direction: Literal["upgrade", "downgrade"] = "upgrade",
) -> list[tuple[RowId, str]]:
    """The ``(id, new_raw_text)`` writes for one direction; rows to leave are omitted.

    Pure apart from the key derived from ``SECRET_KEY``, so it is unit-tested
    without a database (``tests/services/test_alembic_162_encrypt_extension_license_text.py``).
    """
    from app.core.encryption import decrypt_value, encrypt_value, is_encrypted

    planned: list[tuple[RowId, str]] = []
    for row_id, raw in rows:
        if not raw:
            continue
        if direction == "upgrade":
            if not is_encrypted(raw):
                planned.append((row_id, encrypt_value(raw)))
        elif is_encrypted(raw):
            plaintext = decrypt_value(raw)
            if plaintext:
                planned.append((row_id, plaintext))
    return planned


_licenses = sa.table(
    "extension_licenses",
    sa.column("id", sa.Uuid),
    sa.column("raw_text", sa.Text),
)


def _rewrite(direction: Literal["upgrade", "downgrade"]) -> None:
    conn = op.get_bind()
    rows = conn.execute(sa.select(_licenses.c.id, _licenses.c.raw_text)).all()
    planned = plan_rows(((r.id, r.raw_text) for r in rows), direction)
    for row_id, new_text in planned:
        conn.execute(sa.update(_licenses).where(_licenses.c.id == row_id).values(raw_text=new_text))
    if planned:
        print(f"[migration 162] {direction}: rewrote {len(planned)} extension license row(s)")


def upgrade() -> None:
    _rewrite("upgrade")


def downgrade() -> None:
    _rewrite("downgrade")
