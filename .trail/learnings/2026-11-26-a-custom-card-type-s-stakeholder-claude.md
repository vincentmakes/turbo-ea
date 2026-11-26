---
title: "A custom card type's stakeholder roles need definition rows, not just the legacy list; the upgrade revives only roles still held"
author: Claude
date: 2026-11-26
branch: claude/zealous-hamilton-ljsoes
cost: { minutes: 13, tokens: 202050 }
id: l-314780f2
scope: repo
status: active
src: agent
touches:
  - backend/alembic/versions/178_backfill_custom_type_stakeholder_roles.py
  - docs/admin/metamodel.md
  - backend/app/services/stakeholder_service.py
  - backend/app/api/v1/metamodel.py
  - backend/app/services/migration/apply.py
  - backend/app/main.py
---

## Decided
Issue #1437: adding a stakeholder role to a custom card type hid Responsible and Observer, along with everyone assigned to them. Creating a type stored its default roles only in the legacy `card_types.stakeholder_roles` JSONB list. The picker falls back to that list only while the type has no definition row, so the first role an admin added replaced both defaults. Those roles also granted nothing, because permissions are read only from definition rows. The fix creates the rows wherever a type is created outside the seed: the create route and the platform-migration importer, through one helper. Responsible and Observer get the same permissions as on the built-in types. A role key with no default permission set starts with none, for the admin to tick.
The upgrade backfill (migration 178) covers custom types only. A type with no definition rows gets what the picker showed: its JSONB list, or the two defaults when the list is empty. A type that already has some rows gets rows only for the role keys its cards' stakeholders still hold.

## Tried and ruled out
- Reviving every JSONB role on a type that already has rows: an admin may have deleted a role on purpose, and the delete route trims the JSONB mirror but older data may not match. Only an orphaned assignment is clearly lost data.
- Giving unknown role keys some default permissions in the backfill: they granted nothing before the upgrade, and granting rights in a migration is a privilege change nobody asked for.

## Watch out
- A new counting role adds a data-quality stakeholders slot to every card of the type. The backfill therefore moved the one-shot rescore marker to V4, so every card is rescored once on boot.
- Deleting a custom type now reports `stakeholder_role_count: 2` in its audit entry instead of 0.
- Alembic cannot build a schema from an empty database here: migration 001-era revisions expect tables that `create_all` makes. To try a data migration, build the schema with `Base.metadata.create_all`, seed rows through the ORM, run `alembic stamp <prev>`, then `alembic upgrade head`.

In the code:
- `ensure_role_definitions` and `DEFAULT_STAKEHOLDER_ROLES` in `backend/app/services/stakeholder_service.py`; called from `create_type` (`backend/app/api/v1/metamodel.py`) and `_apply_metamodel_type_pass` (`backend/app/services/migration/apply.py`).
- `backend/alembic/versions/178_backfill_custom_type_stakeholder_roles.py`, with `plan_rows` as the pure planner; tests in `backend/tests/services/test_alembic_178_custom_type_stakeholder_roles.py`.
- `_DQ_RESCORE_FLAG` in `backend/app/main.py` is now `dataQualityCanonicalRescoreDoneV4`.
