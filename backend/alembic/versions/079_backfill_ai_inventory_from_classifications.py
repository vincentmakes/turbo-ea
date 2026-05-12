"""Backfill card.attributes from the AI Governance classification cache.

Pre-this-change the `discover_ai_inventory` endpoint wrote `aiSystemRole`
and `aiLifecycleStage` onto `card.attributes` whenever an admin ran it.
That endpoint is now deleted in favour of the Compliance Scanner being the
sole AI-detection driver (#536). Installs upgrading without re-running the
scanner would otherwise see their AI Inventory rows in `ai_governance_-
classifications` but with empty Role / Lifecycle columns on the page.

This data-only migration ports the existing classifications back onto the
card, without clobbering admin-set values:

* `aiSystemRole` ← classification.detected_role (when the card has no
  existing role on its attributes JSONB)
* `aiLifecycleStage` ← "production" (when the card is ACTIVE and has no
  existing lifecycle stage)

`aiRiskClass` is intentionally **not** backfilled — the old detector
emitted no risk tier; only the new prompt does. The next compliance scan
will populate it correctly.

Idempotent: re-running deletes nothing and only fills missing fields.
Downgrade is a no-op (we don't unset values that may have been set by
admin since the upgrade).

Revision ID: 079
Revises: 078
Create Date: 2026-05-12
"""

from typing import Union

from sqlalchemy import text

from alembic import op

revision: str = "079"
down_revision: Union[str, None] = "078"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    op.execute(
        text(
            """
            UPDATE cards
            SET attributes = COALESCE(attributes, '{}'::jsonb) || jsonb_build_object(
                'aiSystemRole', agc.detected_role
            )
            FROM ai_governance_classifications agc
            WHERE agc.card_id = cards.id
              AND agc.detected_role IS NOT NULL
              AND (
                  attributes IS NULL
                  OR NOT attributes ? 'aiSystemRole'
                  OR attributes->>'aiSystemRole' IS NULL
                  OR attributes->>'aiSystemRole' = ''
              )
            """
        )
    )
    op.execute(
        text(
            """
            UPDATE cards
            SET attributes = COALESCE(attributes, '{}'::jsonb) || jsonb_build_object(
                'aiLifecycleStage', 'production'
            )
            FROM ai_governance_classifications agc
            WHERE agc.card_id = cards.id
              AND COALESCE(cards.status, '') = 'ACTIVE'
              AND (
                  attributes IS NULL
                  OR NOT attributes ? 'aiLifecycleStage'
                  OR attributes->>'aiLifecycleStage' IS NULL
                  OR attributes->>'aiLifecycleStage' = ''
              )
            """
        )
    )


def downgrade() -> None:
    # No-op — admin may have customised these values since upgrade.
    pass
