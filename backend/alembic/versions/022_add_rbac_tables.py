"""Add RBAC: roles table, subscription_role_definitions table, migrate user roles.

Revision ID: 022
Revises: 021
Create Date: 2026-02-16
"""
import json
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "022"
down_revision: Union[str, None] = "021"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Default permission sets for seeded roles
ADMIN_PERMS = json.dumps({"*": True})

BPM_ADMIN_PERMS = json.dumps({
    "inventory.view": True, "inventory.create": True, "inventory.edit": True,
    "inventory.delete": True, "inventory.export": True, "inventory.quality_seal": True,
    "inventory.bulk_edit": True, "relations.view": True, "relations.manage": True,
    "subscriptions.view": True, "subscriptions.manage": True,
    "comments.view": True, "comments.create": True,
    "documents.view": True, "documents.manage": True,
    "diagrams.view": True, "diagrams.manage": True,
    "bpm.view": True, "bpm.edit": True, "bpm.manage_drafts": True,
    "bpm.approve_flows": True, "bpm.assessments": True,
    "reports.ea_dashboard": True, "reports.bpm_dashboard": True, "reports.portfolio": True,
    "surveys.respond": True, "soaw.view": True, "soaw.manage": True, "soaw.sign": True,
    "tags.manage": True, "bookmarks.manage": True,
    "eol.view": True, "eol.manage": True,
    "web_portals.view": True, "notifications.manage": True,
})

MEMBER_PERMS = json.dumps({
    "inventory.view": True, "inventory.create": True, "inventory.edit": True,
    "inventory.delete": True, "inventory.export": True, "inventory.quality_seal": True,
    "inventory.bulk_edit": True, "relations.view": True, "relations.manage": True,
    "subscriptions.view": True, "subscriptions.manage": True,
    "comments.view": True, "comments.create": True,
    "documents.view": True, "documents.manage": True,
    "diagrams.view": True, "diagrams.manage": True,
    "bpm.view": True, "bpm.edit": True, "bpm.manage_drafts": True,
    "bpm.assessments": True,
    "reports.ea_dashboard": True, "reports.bpm_dashboard": True, "reports.portfolio": True,
    "surveys.respond": True, "soaw.view": True, "soaw.manage": True, "soaw.sign": True,
    "tags.manage": True, "bookmarks.manage": True,
    "eol.view": True, "eol.manage": True,
    "web_portals.view": True, "notifications.manage": True,
})

VIEWER_PERMS = json.dumps({
    "inventory.view": True, "inventory.export": True,
    "relations.view": True, "subscriptions.view": True,
    "comments.view": True, "documents.view": True,
    "diagrams.view": True, "bpm.view": True,
    "reports.ea_dashboard": True, "reports.bpm_dashboard": True, "reports.portfolio": True,
    "surveys.respond": True, "soaw.view": True,
    "bookmarks.manage": True, "eol.view": True,
    "web_portals.view": True, "notifications.manage": True,
})

# Default FS-level permission sets
RESPONSIBLE_PERMS = json.dumps({
    "fs.view": True, "fs.edit": True, "fs.delete": True,
    "fs.quality_seal": True, "fs.manage_subscriptions": True,
    "fs.manage_relations": True, "fs.manage_documents": True,
    "fs.manage_comments": True, "fs.create_comments": True,
    "fs.bpm_edit": True, "fs.bpm_manage_drafts": True,
})
OBSERVER_PERMS = json.dumps({"fs.view": True, "fs.create_comments": True})
PROCESS_OWNER_PERMS = json.dumps({
    "fs.view": True, "fs.edit": True, "fs.quality_seal": True,
    "fs.manage_subscriptions": True, "fs.manage_relations": True,
    "fs.manage_documents": True, "fs.create_comments": True,
    "fs.bpm_edit": True, "fs.bpm_manage_drafts": True, "fs.bpm_approve": True,
})
TECH_OWNER_PERMS = json.dumps({
    "fs.view": True, "fs.edit": True, "fs.manage_relations": True,
    "fs.manage_documents": True, "fs.create_comments": True,
})
BIZ_OWNER_PERMS = json.dumps({
    "fs.view": True, "fs.edit": True, "fs.manage_relations": True,
    "fs.manage_documents": True, "fs.create_comments": True,
})

# Map subscription role key → default permissions JSON
FS_PERM_MAP = {
    "responsible": RESPONSIBLE_PERMS,
    "observer": OBSERVER_PERMS,
    "process_owner": PROCESS_OWNER_PERMS,
    "technical_application_owner": TECH_OWNER_PERMS,
    "business_application_owner": BIZ_OWNER_PERMS,
}
# Fallback for any unknown roles
DEFAULT_FS_PERMS = json.dumps({"fs.view": True})


def upgrade() -> None:
    import logging
    log = logging.getLogger("alembic.migration.022")

    from sqlalchemy import inspect as sa_inspect

    conn = op.get_bind()
    inspector = sa_inspect(conn)

    log.info("Step 1: Create roles table")
    # 1. Create roles table
    if not inspector.has_table("roles"):
        op.create_table(
            "roles",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                       server_default=sa.text("gen_random_uuid()")),
            sa.Column("key", sa.String(50), unique=True, nullable=False),
            sa.Column("label", sa.String(200), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("is_system", sa.Boolean(), server_default="false", nullable=False),
            sa.Column("is_default", sa.Boolean(), server_default="false", nullable=False),
            sa.Column("is_archived", sa.Boolean(), server_default="false", nullable=False),
            sa.Column("color", sa.String(20), server_default="'#757575'", nullable=False),
            sa.Column("permissions", postgresql.JSONB(), server_default="'{}'", nullable=False),
            sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("archived_by", postgresql.UUID(as_uuid=True),
                       sa.ForeignKey("users.id"), nullable=True),
        )

    log.info("Step 2: Seed system/default roles")
    # 2. Seed system/default roles
    # Note: id column needs gen_random_uuid() because create_all uses Python-side
    # default (uuid.uuid4), not server_default, so the DB column has no default.
    _role_insert = sa.text(
        "INSERT INTO roles (id, key, label, description, is_system, is_default, "
        "is_archived, color, permissions, sort_order) "
        "VALUES (gen_random_uuid(), :key, :label, :description, :is_system, :is_default, "
        ":is_archived, :color, CAST(:permissions AS jsonb), :sort_order) "
        "ON CONFLICT (key) DO NOTHING"
    )
    for rdata in [
        {"key": "admin", "label": "Administrator", "description": "Full access to all features",
         "is_system": True, "is_default": False, "is_archived": False,
         "color": "#d32f2f", "permissions": ADMIN_PERMS, "sort_order": 0},
        {"key": "bpm_admin", "label": "BPM Administrator",
         "description": "Full access to BPM and inventory features",
         "is_system": False, "is_default": False, "is_archived": False,
         "color": "#7B1FA2", "permissions": BPM_ADMIN_PERMS, "sort_order": 1},
        {"key": "member", "label": "Member", "description": "Standard user with edit access",
         "is_system": False, "is_default": True, "is_archived": False,
         "color": "#1976d2", "permissions": MEMBER_PERMS, "sort_order": 2},
        {"key": "viewer", "label": "Viewer", "description": "Read-only access",
         "is_system": False, "is_default": False, "is_archived": False,
         "color": "#757575", "permissions": VIEWER_PERMS, "sort_order": 3},
    ]:
        log.info("  Inserting role: %s", rdata["key"])
        conn.execute(_role_insert, rdata)

    log.info("Step 3: Create subscription_role_definitions table")
    # 3. Create subscription_role_definitions table
    if not inspector.has_table("subscription_role_definitions"):
        op.create_table(
            "subscription_role_definitions",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True,
                       server_default=sa.text("gen_random_uuid()")),
            sa.Column("fact_sheet_type_key", sa.String(100),
                       sa.ForeignKey("fact_sheet_types.key", ondelete="CASCADE"), nullable=False),
            sa.Column("key", sa.String(50), nullable=False),
            sa.Column("label", sa.String(200), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("color", sa.String(20), server_default="'#757575'", nullable=False),
            sa.Column("permissions", postgresql.JSONB(), server_default="'{}'", nullable=False),
            sa.Column("is_archived", sa.Boolean(), server_default="false", nullable=False),
            sa.Column("sort_order", sa.Integer(), server_default="0", nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
            sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("archived_by", postgresql.UUID(as_uuid=True),
                       sa.ForeignKey("users.id"), nullable=True),
            sa.UniqueConstraint("fact_sheet_type_key", "key", name="uq_srd_type_key"),
        )

    log.info("Step 4: Migrate existing subscription roles from FactSheetType JSONB")
    # 4. Migrate existing subscription roles from FactSheetType JSONB
    conn = op.get_bind()
    result = conn.execute(sa.text(
        "SELECT key, subscription_roles FROM fact_sheet_types "
        "WHERE subscription_roles IS NOT NULL AND subscription_roles != '[]'::jsonb"
    ))
    rows = result.fetchall()  # Must fetch all before executing INSERTs on same conn
    log.info("  Found %d fact sheet types with subscription roles", len(rows))
    for row in rows:
        type_key = row[0]
        sub_roles = row[1]  # Already a list of dicts from JSONB
        if not sub_roles:
            continue
        for idx, role_obj in enumerate(sub_roles):
            role_key = role_obj.get("key", "")
            role_label = role_obj.get("label", role_key)
            if not role_key:
                continue
            perms = FS_PERM_MAP.get(role_key, DEFAULT_FS_PERMS)
            # Use INSERT ... ON CONFLICT to handle duplicates
            conn.execute(sa.text(
                "INSERT INTO subscription_role_definitions "
                "(id, fact_sheet_type_key, key, label, permissions, sort_order) "
                "VALUES (gen_random_uuid(), :type_key, :key, :label, CAST(:perms AS jsonb), :sort_order) "
                "ON CONFLICT (fact_sheet_type_key, key) DO NOTHING"
            ), {
                "type_key": type_key,
                "key": role_key,
                "label": role_label,
                "perms": perms,
                "sort_order": idx,
            })

    log.info("Step 5: Add FK from users.role to roles.key")
    # First, ensure all existing user role values exist in the roles table
    conn.execute(sa.text(
        "INSERT INTO roles (id, key, label, permissions, sort_order) "
        "SELECT gen_random_uuid(), u.role, u.role, CAST(:empty AS jsonb), 99 "
        "FROM users u "
        "WHERE u.role NOT IN (SELECT key FROM roles) "
        "ON CONFLICT (key) DO NOTHING"
    ), {"empty": "{}"})

    log.info("Step 6: Create FK constraint")
    # Now add the foreign key constraint
    try:
        op.create_foreign_key("fk_users_role_key", "users", "roles", ["role"], ["key"])
    except Exception as e:
        log.info("FK constraint already exists or skipped: %s", e)

    log.info("Migration 022 completed successfully")


def downgrade() -> None:
    try:
        op.drop_constraint("fk_users_role_key", "users", type_="foreignkey")
    except Exception:
        pass
    op.drop_table("subscription_role_definitions")
    op.drop_table("roles")
