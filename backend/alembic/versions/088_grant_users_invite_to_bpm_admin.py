"""Grant the new ``users.invite`` permission to the seeded ``bpm_admin`` role.

``users.invite`` is a delegated form of ``admin.users`` — it lets a non-admin
who can manage stakeholders invite a brand-new user from the stakeholder
picker, without the recipient inheriting an elevated role. The backend still
enforces a privilege-escalation guard: a ``users.invite`` holder can only
create users with role ``member`` or ``viewer``.

The seed file (``services/seed.py``) already imports
``BPM_ADMIN_PERMISSIONS`` from ``core/permissions.py`` and writes the dict
verbatim, so **fresh installs** pick up the new key automatically. This
migration handles the **upgrade** path: existing ``bpm_admin`` rows in
production databases need the key grafted in.

Drift-aware: we only touch rows that don't already have a ``users.invite``
entry. Customers who already customised the role (added the key manually,
or deliberately removed it after we ship) are left alone — same pattern
as ``072_restore_business_process_color.py``.

Revision ID: 088
Revises: 087
Create Date: 2026-05-15
"""

from typing import Union

import sqlalchemy as sa

from alembic import op

revision: str = "088"
down_revision: Union[str, None] = "087"
branch_labels: Union[str, tuple[str], None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    # Only touch the bpm_admin row, and only when the key is missing.
    # ``jsonb_set`` adds the key when ``create_missing`` is true (the
    # default), preserving every other permission.
    op.execute(
        sa.text(
            "UPDATE roles "
            "SET permissions = jsonb_set(permissions, '{users.invite}', 'true'::jsonb, true) "
            "WHERE key = 'bpm_admin' "
            "AND NOT (permissions ? 'users.invite')"
        )
    )


def downgrade() -> None:
    # Symmetric: remove the key only if it's still set to ``true`` (i.e. we
    # added it, not a later admin customisation).
    op.execute(
        sa.text(
            "UPDATE roles "
            "SET permissions = permissions - 'users.invite' "
            "WHERE key = 'bpm_admin' "
            "AND (permissions ->> 'users.invite') = 'true'"
        )
    )
