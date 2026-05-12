"""Grant GRC permissions to default seeded roles.

Adds the new ``grc.view`` and ``grc.manage`` permissions (introduced in this
release) to the seeded ``admin`` (no-op — admin uses the wildcard), ``bpm_admin``,
and ``member`` roles, and grants the read-only key to ``viewer``. Custom roles
are left untouched so that admins keep full control over who sees the new GRC
surface. The Risk and Compliance subtabs of GRC continue to honour the existing
``risks.view`` and ``security_compliance.view`` permissions.

Revision ID: 076
Revises: 075
"""

from sqlalchemy import text

from alembic import op

revision = "076"
down_revision = "075"
branch_labels = None
depends_on = None


_FULL_GRANT = ("bpm_admin", "member")  # view + manage
_VIEW_ONLY = ("viewer",)  # view only

_NEW_KEYS = ("grc.view", "grc.manage")


def upgrade() -> None:
    bind = op.get_bind()
    for key in _FULL_GRANT:
        bind.execute(
            text(
                """
                UPDATE roles
                SET permissions = COALESCE(permissions, '{}'::jsonb)
                              || jsonb_build_object(
                                  'grc.view', true,
                                  'grc.manage', true
                              )
                WHERE key = :key
                """
            ),
            {"key": key},
        )
    for key in _VIEW_ONLY:
        bind.execute(
            text(
                """
                UPDATE roles
                SET permissions = COALESCE(permissions, '{}'::jsonb)
                              || jsonb_build_object(
                                  'grc.view', true,
                                  'grc.manage', false
                              )
                WHERE key = :key
                """
            ),
            {"key": key},
        )


def downgrade() -> None:
    bind = op.get_bind()
    for key in (*_FULL_GRANT, *_VIEW_ONLY):
        for new_key in _NEW_KEYS:
            bind.execute(
                text(
                    """
                    UPDATE roles
                    SET permissions = permissions - :perm_key
                    WHERE key = :role_key
                    """
                ),
                {"perm_key": new_key, "role_key": key},
            )
