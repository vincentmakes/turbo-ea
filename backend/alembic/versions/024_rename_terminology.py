"""Rename terminology: fact_sheet→card, quality_seal→approval_status, subscription→stakeholder.

Revision ID: 024
Revises: 023
Create Date: 2026-02-16
"""
from typing import Sequence, Union

from alembic import op

# revision identifiers
revision: str = "024"
down_revision: Union[str, None] = "023"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Table renames
    op.rename_table("fact_sheets", "cards")
    op.rename_table("fact_sheet_types", "card_types")
    op.rename_table("fact_sheet_tags", "card_tags")
    op.rename_table("subscriptions", "stakeholders")

    # Column renames on cards (was fact_sheets)
    op.alter_column("cards", "quality_seal", new_column_name="approval_status")
    op.alter_column("cards", "completion", new_column_name="data_quality")

    # FK columns: fact_sheet_id → card_id
    op.alter_column("comments", "fact_sheet_id", new_column_name="card_id")
    op.alter_column("documents", "fact_sheet_id", new_column_name="card_id")
    op.alter_column("events", "fact_sheet_id", new_column_name="card_id")
    op.alter_column("notifications", "fact_sheet_id", new_column_name="card_id")
    op.alter_column("todos", "fact_sheet_id", new_column_name="card_id")
    op.alter_column("card_tags", "fact_sheet_id", new_column_name="card_id")
    op.alter_column("stakeholders", "fact_sheet_id", new_column_name="card_id")
    op.alter_column("survey_responses", "fact_sheet_id", new_column_name="card_id")

    # String-type columns referencing fact sheet type
    op.alter_column("bookmarks", "fact_sheet_type", new_column_name="card_type")
    op.alter_column("web_portals", "fact_sheet_type", new_column_name="card_type")

    # subscription_roles → stakeholder_roles on card_types
    op.alter_column("card_types", "subscription_roles", new_column_name="stakeholder_roles")


def downgrade() -> None:
    op.alter_column("card_types", "stakeholder_roles", new_column_name="subscription_roles")
    op.alter_column("web_portals", "card_type", new_column_name="fact_sheet_type")
    op.alter_column("bookmarks", "card_type", new_column_name="fact_sheet_type")
    op.alter_column("survey_responses", "card_id", new_column_name="fact_sheet_id")
    op.alter_column("stakeholders", "card_id", new_column_name="fact_sheet_id")
    op.alter_column("card_tags", "card_id", new_column_name="fact_sheet_id")
    op.alter_column("todos", "card_id", new_column_name="fact_sheet_id")
    op.alter_column("notifications", "card_id", new_column_name="fact_sheet_id")
    op.alter_column("events", "card_id", new_column_name="fact_sheet_id")
    op.alter_column("documents", "card_id", new_column_name="fact_sheet_id")
    op.alter_column("comments", "card_id", new_column_name="fact_sheet_id")
    op.alter_column("cards", "data_quality", new_column_name="completion")
    op.alter_column("cards", "approval_status", new_column_name="quality_seal")
    op.rename_table("stakeholders", "subscriptions")
    op.rename_table("card_tags", "fact_sheet_tags")
    op.rename_table("card_types", "fact_sheet_types")
    op.rename_table("cards", "fact_sheets")
