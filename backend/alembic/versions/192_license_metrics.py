"""License metrics: a catalogue of metrics, and license types that belong to one.

Creates ``license_metrics`` (seeded with ``users`` and ``installations``), adds
``license_types.metric_key`` and moves the uniqueness of a type from ``key`` to
``(metric_key, key)``. A type with data under one metric stays there, a type with data under
both is duplicated (same key, label, translations and archived flag), a type with no data goes
under both. ``licensingModel`` leaves both card types (schema and stored values, without
moving ``cards.updated_at``). ``card_licenses.items`` is not touched: data a card did not
track, stored but ignored until now, shows from now on. What changed is written to
``app_settings.general_settings["license_metrics_migration_report"]`` (capped). The data-quality
rescore marker is bumped in ``app/main.py``, not here. Idempotent: it does nothing once
``license_types.metric_key`` exists.

Forward-only in practice: the downgrade refuses while a type key exists under two metrics.
When it runs it drops ``license_metrics`` and ``license_types.metric_key`` only: it does not
put ``licensingModel`` back (field or card values) and leaves ``card_licenses.items`` as they
are, cells under a custom metric included.

Revision ID: 192
Revises: 191
Create Date: 2026-11-17
"""

import logging
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Session

from alembic import op
from app.services import license_metrics_migration as lmm
from app.services.licensing_migration import derive_type_metrics

revision: str = "192"
down_revision: Union[str, None] = "191"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

logger = logging.getLogger("alembic.runtime.migration")
UNIQUE = "uq_license_types_metric_key"


def _unique_on_key(insp) -> str | None:
    for c in insp.get_unique_constraints("license_types"):
        if c["column_names"] == ["key"]:
            return c["name"]
    return None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    if "license_metrics" not in insp.get_table_names():
        op.create_table(
            "license_metrics",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("key", sa.String(length=64), nullable=False, unique=True),
            sa.Column("label", sa.String(length=100), nullable=False),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("archived", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column(
                "translations",
                postgresql.JSONB(astext_type=sa.Text()),
                nullable=False,
                server_default="{}",
            ),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
        )
    session = Session(bind=bind)
    lmm.seed_default_metrics(session)
    if "metric_key" in {c["name"] for c in insp.get_columns("license_types")}:
        return

    # Read the old rows and the data BEFORE the DDL: the plan decides where each type goes.
    old = bind.execute(
        sa.text(
            "SELECT key, label, sort_order, archived, translations FROM license_types "
            "ORDER BY sort_order, key"
        )
    ).all()
    templates = {
        r.key: {
            "label": r.label,
            "sort_order": r.sort_order,
            "archived": r.archived,
            "translations": r.translations or {},
        }
        for r in old
    }
    used = lmm.used_metrics(session)
    plan = derive_type_metrics([(r.key, r.archived) for r in old], used)
    ignored = lmm.ignored_metric_cards(session)

    # The order matters: the old unique(key) would reject a duplicate.
    op.add_column("license_types", sa.Column("metric_key", sa.String(length=64), nullable=True))
    if (name := _unique_on_key(insp)) is not None:
        op.drop_constraint(name, "license_types", type_="unique")
    lmm.apply_type_plan(session, plan, templates)
    op.alter_column("license_types", "metric_key", nullable=False)
    op.create_unique_constraint(UNIQUE, "license_types", ["metric_key", "key"])

    lmm.strip_model_field(session)
    lmm.clear_model_values(session)
    report = lmm.collect_report(session, plan, used, templates, ignored)
    if any(report[k] for k in ("duplicated_types", "attached_to_both", "calculations", "cards")):
        logger.warning("license metrics migration: details in general_settings.%s", lmm.REPORT_KEY)
        lmm.write_report(session, report)


def downgrade() -> None:
    bind = op.get_bind()
    if not lmm.can_downgrade(Session(bind=bind)):
        raise RuntimeError(
            "Cannot downgrade 192: a license type exists under more than one metric "
            "(restore a backup taken before the upgrade instead)."
        )
    op.drop_constraint(UNIQUE, "license_types", type_="unique")
    op.drop_column("license_types", "metric_key")
    op.create_unique_constraint("license_types_key_key", "license_types", ["key"])
    op.drop_table("license_metrics")
