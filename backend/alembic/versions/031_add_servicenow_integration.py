"""Add ServiceNow integration tables.

Creates servicenow_connections, servicenow_mappings, servicenow_field_mappings,
servicenow_sync_runs, servicenow_staged_records, and servicenow_identity_map.

Revision ID: 031
Revises: 030
Create Date: 2026-02-19
"""

from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

from alembic import op

revision: str = "031"
down_revision: Union[str, None] = "030"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "servicenow_connections",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("instance_url", sa.String(500), nullable=False),
        sa.Column("auth_type", sa.String(20), nullable=False, server_default="basic"),
        sa.Column("credentials", JSONB, nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("last_tested_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("test_status", sa.String(20), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "servicenow_mappings",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "connection_id",
            UUID(as_uuid=True),
            sa.ForeignKey("servicenow_connections.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("card_type_key", sa.String(100), nullable=False),
        sa.Column("snow_table", sa.String(200), nullable=False),
        sa.Column("sync_direction", sa.String(20), nullable=False, server_default="snow_to_turbo"),
        sa.Column("sync_mode", sa.String(20), nullable=False, server_default="conservative"),
        sa.Column("max_deletion_ratio", sa.Float(), nullable=False, server_default="0.5"),
        sa.Column("filter_query", sa.Text(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "servicenow_field_mappings",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "mapping_id",
            UUID(as_uuid=True),
            sa.ForeignKey("servicenow_mappings.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("turbo_field", sa.String(200), nullable=False),
        sa.Column("snow_field", sa.String(200), nullable=False),
        sa.Column("direction", sa.String(20), nullable=False, server_default="snow_leads"),
        sa.Column("transform_type", sa.String(50), nullable=True),
        sa.Column("transform_config", JSONB, nullable=True),
        sa.Column("is_identity", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "servicenow_sync_runs",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "connection_id",
            UUID(as_uuid=True),
            sa.ForeignKey("servicenow_connections.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "mapping_id",
            UUID(as_uuid=True),
            sa.ForeignKey("servicenow_mappings.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("status", sa.String(20), nullable=False, server_default="running"),
        sa.Column("direction", sa.String(20), nullable=False, server_default="pull"),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("stats", JSONB, nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column(
            "created_by",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )

    op.create_table(
        "servicenow_staged_records",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "sync_run_id",
            UUID(as_uuid=True),
            sa.ForeignKey("servicenow_sync_runs.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "mapping_id",
            UUID(as_uuid=True),
            sa.ForeignKey("servicenow_mappings.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("snow_sys_id", sa.String(32), nullable=False),
        sa.Column("snow_data", JSONB, nullable=True),
        sa.Column("card_id", UUID(as_uuid=True), nullable=True),
        sa.Column("action", sa.String(20), nullable=False, server_default="skip"),
        sa.Column("diff", JSONB, nullable=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "servicenow_identity_map",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "connection_id",
            UUID(as_uuid=True),
            sa.ForeignKey("servicenow_connections.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "mapping_id",
            UUID(as_uuid=True),
            sa.ForeignKey("servicenow_mappings.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("card_id", UUID(as_uuid=True), nullable=False),
        sa.Column("snow_sys_id", sa.String(32), nullable=False),
        sa.Column("snow_table", sa.String(200), nullable=False),
        sa.Column("created_by_sync", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_unique_constraint(
        "uq_snow_identity_sys_id",
        "servicenow_identity_map",
        ["connection_id", "snow_sys_id", "snow_table"],
    )
    op.create_unique_constraint(
        "uq_snow_identity_card",
        "servicenow_identity_map",
        ["connection_id", "card_id", "snow_table"],
    )


def downgrade() -> None:
    op.drop_table("servicenow_identity_map")
    op.drop_table("servicenow_staged_records")
    op.drop_table("servicenow_sync_runs")
    op.drop_table("servicenow_field_mappings")
    op.drop_table("servicenow_mappings")
    op.drop_table("servicenow_connections")
