"""ArchiMate migration — delete all non-ArchiMate data from the instance.

When MIGRATE_ARCHIMATE_UNIQUE is true at startup (or triggered from the
admin settings UI), this module removes:

- All CardTypes whose plugin_id != "archimate"
- All RelationTypes whose plugin_id != "archimate"
- All Cards whose type does not start with "arch_"
- All Relations whose source or target card type does not start with "arch_"

Related rows (comments, tags, stakeholders, etc.) are cleaned up by
ON DELETE CASCADE foreign keys on the database side.
"""

from __future__ import annotations

from sqlalchemy import delete, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession


async def migrate_archimate_unique(db: AsyncSession) -> dict[str, int]:
    """Strip all non-ArchiMate data, returning counts of deleted rows."""
    from app.models.card import Card
    from app.models.card_type import CardType
    from app.models.relation import Relation
    from app.models.relation_type import RelationType

    # ── 0. Seed ArchiMate metamodel if not already present ───────────────
    # ArchiMate card types are seeded on-demand via settings toggle, so they
    # may not exist yet. Ensure they're available before deleting everything
    # else.
    from app.plugins.archimate.seed import seed_archimate_metamodel

    await seed_archimate_metamodel(db)
    await db.flush()

    # ── 1. Delete non-ArchiMate card types ─────────────────────────────────
    # Built-in types have plugin_id=NULL; in PostgreSQL, NULL != 'archimate'
    # evaluates to NULL (falsy), so we must explicitly check for NULL too.
    ct_result = await db.execute(
        delete(CardType).where(
            or_(CardType.plugin_id == None, CardType.plugin_id != "archimate")
        )
    )
    card_types_deleted = ct_result.rowcount

    # ── 2. Delete non-ArchiMate relation types ─────────────────────────────
    rt_result = await db.execute(
        delete(RelationType).where(
            or_(RelationType.plugin_id == None, RelationType.plugin_id != "archimate")
        )
    )
    relation_types_deleted = rt_result.rowcount

    # ── 3. Delete relations where either side is a non-ArchiMate card ─────
    # Use raw SQL for the JOIN-based delete to avoid ORM complexity.
    rel_sql = text(
        "DELETE FROM relations "
        "WHERE id IN ("
        "  SELECT r.id FROM relations r "
        "  JOIN cards s ON r.source_id = s.id "
        "  JOIN cards t ON r.target_id = t.id "
        "  WHERE s.type NOT LIKE 'arch\\_%' "
        "     OR t.type NOT LIKE 'arch\\_%'"
        ")"
    )
    rel_result = await db.execute(rel_sql)
    relations_deleted = rel_result.rowcount

    # ── 4. Delete non-ArchiMate cards ─────────────────────────────────────
    # Use raw SQL for LIKE with escape character — SQLAlchemy's notlike()
    # doesn't handle custom escape chars portably.
    card_result = await db.execute(
        text("DELETE FROM cards WHERE type NOT LIKE 'arch\\_%'")
    )
    cards_deleted = card_result.rowcount

    # ── 5. Clean up orphaned card_tags rows — handled by CASCADE ──────────
    # No manual cleanup needed; card_tags has ON DELETE CASCADE on card_id.

    # ── 6. Delete any orphaned tags that are no longer referenced ─────────
    # Leave tags in place — they may have been created independently.
    # If the user wants to clean up, they can do so via the Tags admin.

    await db.commit()

    return {
        "card_types_deleted": card_types_deleted,
        "relation_types_deleted": relation_types_deleted,
        "cards_deleted": cards_deleted,
        "relations_deleted": relations_deleted,
    }
