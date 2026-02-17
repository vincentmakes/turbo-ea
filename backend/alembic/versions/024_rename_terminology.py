"""Rename terminology: fact_sheet→card, quality_seal→approval_status, subscription→stakeholder.

Revision ID: 024
Revises: 023
Create Date: 2026-02-16
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers
revision: str = "024"
down_revision: Union[str, None] = "023"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    from sqlalchemy import inspect as sa_inspect

    conn = op.get_bind()
    inspector = sa_inspect(conn)

    # Base.metadata.create_all runs BEFORE Alembic migrations.  Because the
    # ORM models already use the new table names (cards, card_types, …),
    # create_all will have created empty "ghost" tables with those names while
    # the real data still lives in the old tables (fact_sheets, …).
    # Drop the ghost tables so the renames below can succeed.
    ghost_tables = [
        "stakeholder_role_definitions",
        "card_tags",
        "stakeholders",
        "cards",
        "card_types",
    ]
    for new_name in ghost_tables:
        if inspector.has_table(new_name):
            op.execute(sa.text(f'DROP TABLE IF EXISTS "{new_name}" CASCADE'))

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

    # subscription_role_definitions: rename column + table
    if inspector.has_table("subscription_role_definitions"):
        cols = [c["name"] for c in inspector.get_columns("subscription_role_definitions")]
        if "fact_sheet_type_key" in cols:
            op.alter_column(
                "subscription_role_definitions",
                "fact_sheet_type_key",
                new_column_name="card_type_key",
            )
        op.rename_table("subscription_role_definitions", "stakeholder_role_definitions")

    # Rename fs.* → card.* permission keys in stakeholder role definition JSONB data
    op.execute(sa.text("""
        UPDATE stakeholder_role_definitions
        SET permissions = (
            SELECT jsonb_object_agg(
                CASE WHEN key LIKE 'fs.%' THEN 'card.' || substring(key from 4)
                     ELSE key
                END,
                value
            )
            FROM jsonb_each(permissions)
        )
        WHERE permissions IS NOT NULL
          AND permissions::text LIKE '%"fs.%'
    """))


def downgrade() -> None:
    # Revert card.* → fs.* permission keys in stakeholder role definition JSONB data
    op.execute(sa.text("""
        UPDATE stakeholder_role_definitions
        SET permissions = (
            SELECT jsonb_object_agg(
                CASE WHEN key LIKE 'card.%' THEN 'fs.' || substring(key from 6)
                     ELSE key
                END,
                value
            )
            FROM jsonb_each(permissions)
        )
        WHERE permissions IS NOT NULL
          AND permissions::text LIKE '%"card.%'
    """))

    # Rename table back and revert column
    from sqlalchemy import inspect as sa_inspect
    conn = op.get_bind()
    inspector = sa_inspect(conn)
    if inspector.has_table("stakeholder_role_definitions"):
        op.rename_table("stakeholder_role_definitions", "subscription_role_definitions")
        cols = [c["name"] for c in inspector.get_columns("subscription_role_definitions")]
        if "card_type_key" in cols:
            op.alter_column(
                "subscription_role_definitions",
                "card_type_key",
                new_column_name="fact_sheet_type_key",
            )

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
