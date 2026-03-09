"""Generalize diagram-card links: rename diagram_initiatives to diagram_cards."""

from alembic import op

revision = "047"
down_revision = "046"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.rename_table("diagram_initiatives", "diagram_cards")
    op.alter_column("diagram_cards", "initiative_id", new_column_name="card_id")


def downgrade() -> None:
    op.alter_column("diagram_cards", "card_id", new_column_name="initiative_id")
    op.rename_table("diagram_cards", "diagram_initiatives")
