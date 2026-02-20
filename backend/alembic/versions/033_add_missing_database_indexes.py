"""Add missing database indexes for query performance

Revision ID: 033
Revises: 032
Create Date: 2026-02-20
"""

from alembic import op

revision = "033"
down_revision = "032"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── Foreign-key indexes (single-column) ──────────────────────────────

    # events: user lookups in audit trail
    op.create_index("ix_events_user_id", "events", ["user_id"])
    # events: dashboard event-type filtering
    op.create_index("ix_events_event_type", "events", ["event_type"])

    # comments: author lookup
    op.create_index("ix_comments_user_id", "comments", ["user_id"])
    # comments: threaded-reply traversal
    op.create_index("ix_comments_parent_id", "comments", ["parent_id"])

    # todos: "my todos" query
    op.create_index("ix_todos_assigned_to", "todos", ["assigned_to"])
    # todos: creator lookup
    op.create_index("ix_todos_created_by", "todos", ["created_by"])
    # todos: open-todos badge count
    op.create_index("ix_todos_status", "todos", ["status"])

    # tags: nested tag queries within a group
    op.create_index("ix_tags_tag_group_id", "tags", ["tag_group_id"])

    # notifications: sender lookup
    op.create_index("ix_notifications_actor_id", "notifications", ["actor_id"])

    # bookmarks: "my bookmarks" queries
    op.create_index("ix_bookmarks_user_id", "bookmarks", ["user_id"])

    # surveys: creator lookup
    op.create_index("ix_surveys_created_by", "surveys", ["created_by"])

    # ── Composite indexes (common multi-column queries) ──────────────────

    # notifications: "unread notifications for user X" (very frequent)
    op.create_index(
        "ix_notifications_user_id_is_read",
        "notifications",
        ["user_id", "is_read"],
    )

    # todos: "my open todos" for badge counts
    op.create_index(
        "ix_todos_assigned_to_status",
        "todos",
        ["assigned_to", "status"],
    )

    # cards: filtered fact-sheet listings (e.g. inventory page)
    op.create_index("ix_cards_type_status", "cards", ["type", "status"])

    # cards: hierarchy queries with type filter
    op.create_index("ix_cards_parent_id_type", "cards", ["parent_id", "type"])

    # ── JSONB GIN indexes (queried JSONB columns) ────────────────────────

    # cards.attributes: attribute filtering in reports / surveys / inventory
    op.create_index(
        "ix_cards_attributes_gin",
        "cards",
        ["attributes"],
        postgresql_using="gin",
    )

    # cards.lifecycle: lifecycle-phase filtering
    op.create_index(
        "ix_cards_lifecycle_gin",
        "cards",
        ["lifecycle"],
        postgresql_using="gin",
    )


def downgrade() -> None:
    # ── JSONB GIN indexes ────────────────────────────────────────────────
    op.drop_index("ix_cards_lifecycle_gin", table_name="cards")
    op.drop_index("ix_cards_attributes_gin", table_name="cards")

    # ── Composite indexes ────────────────────────────────────────────────
    op.drop_index("ix_cards_parent_id_type", table_name="cards")
    op.drop_index("ix_cards_type_status", table_name="cards")
    op.drop_index("ix_todos_assigned_to_status", table_name="todos")
    op.drop_index("ix_notifications_user_id_is_read", table_name="notifications")

    # ── Foreign-key indexes ──────────────────────────────────────────────
    op.drop_index("ix_surveys_created_by", table_name="surveys")
    op.drop_index("ix_bookmarks_user_id", table_name="bookmarks")
    op.drop_index("ix_notifications_actor_id", table_name="notifications")
    op.drop_index("ix_tags_tag_group_id", table_name="tags")
    op.drop_index("ix_todos_status", table_name="todos")
    op.drop_index("ix_todos_created_by", table_name="todos")
    op.drop_index("ix_todos_assigned_to", table_name="todos")
    op.drop_index("ix_comments_parent_id", table_name="comments")
    op.drop_index("ix_comments_user_id", table_name="comments")
    op.drop_index("ix_events_event_type", table_name="events")
    op.drop_index("ix_events_user_id", table_name="events")
