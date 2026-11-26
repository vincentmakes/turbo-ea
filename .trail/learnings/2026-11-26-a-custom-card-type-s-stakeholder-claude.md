---
title: "A custom card type's stakeholder roles need definition rows, not just the legacy list; the upgrade revives only roles still held"
author: Claude
date: 2026-11-26
branch: claude/zealous-hamilton-ljsoes
cost: { minutes: 35, tokens: 389452 }
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
  - docs/admin/metamodel.ar.md
  - docs/admin/metamodel.da.md
  - docs/admin/metamodel.de.md
  - docs/admin/metamodel.es.md
---

## Decided
Issue #1437: adding a stakeholder role to a custom card type hid Responsible and Observer, along with everyone assigned to them. Creating a type stored its default roles only in the legacy `card_types.stakeholder_roles` JSONB list. The picker falls back to that list only while the type has no definition row, so the first role an admin added replaced both defaults. Those roles also granted nothing, because permissions are read only from definition rows. The fix creates the rows wherever a type is created outside the seed: the create route and the platform-migration importer, through one helper. Responsible and Observer get the same permissions as on the built-in types. A role key with no default permission set starts with none, for the admin to tick.
The upgrade backfill (migration 178) covers custom types only. A type with no definition rows gets what the picker showed: its JSONB list, or the two defaults when the list is empty. A type that already has some rows gets rows only for the role keys its cards' stakeholders still hold.
In discussion #1439 a user said stakeholders show "in the order they have been added" and asked to reorder them; Observer also confused people by sitting among the owners. The owner chose:
- **Order:** admins reorder **roles** per card type, with up/down arrows. A card's Stakeholders tab and the role picker follow that order.
- **Passive roles:** a passive role is one whose "Counts toward data quality" switch is off (Observer by default). Passive roles are always listed last on a card, after a divider, under "Following this card", in a compact style. They have no empty-state line when nobody holds them.

## Tried and ruled out
- Reviving every JSONB role on a type that already has rows: an admin may have deleted a role on purpose, and the delete route trims the JSONB mirror but older data may not match. Only an orphaned assignment is clearly lost data.
- Giving unknown role keys some default permissions in the backfill: they granted nothing before the upgrade, and granting rights in a migration is a privilege change nobody asked for.
- Reordering the people within a role on each card: it needs a stored position on every assignment, and the reporter's complaint was about role boxes landing after Observer.
- Treating only the built-in `observer` key as passive: keying on the existing quality switch also groups a custom passive role with Observer.
- Leaving Observer alone and relying on the admin to place it last: the confusion was about Observer reading as an owner, which order alone does not fix.

## Watch out
- A new counting role adds a data-quality stakeholders slot to every card of the type. The backfill therefore moved the one-shot rescore marker to V4, so every card is rescored once on boot.
- Deleting a custom type now reports `stakeholder_role_count: 2` in its audit entry instead of 0.
- Alembic cannot build a schema from an empty database here: migration 001-era revisions expect tables that `create_all` makes. To try a data migration, build the schema with `Base.metadata.create_all`, seed rows through the ORM, run `alembic stamp <prev>`, then `alembic upgrade head`.

In the code:
- `ensure_role_definitions` and `DEFAULT_STAKEHOLDER_ROLES` in `backend/app/services/stakeholder_service.py`; called from `create_type` (`backend/app/api/v1/metamodel.py`) and `_apply_metamodel_type_pass` (`backend/app/services/migration/apply.py`).
- `backend/alembic/versions/178_backfill_custom_type_stakeholder_roles.py`, with `plan_rows` as the pure planner; tests in `backend/tests/services/test_alembic_178_custom_type_stakeholder_roles.py`.
- `_DQ_RESCORE_FLAG` in `backend/app/main.py` is now `dataQualityCanonicalRescoreDoneV4`.
- A reorder must list every role of the type, archived ones included, so a hidden role keeps its place.
- The panel swaps a role with its *visible* neighbour, and archived roles are hidden unless "Show archived" is on.
- The inventory's stakeholder columns do not follow this order: they come from the all-types role list, which is sorted by key.
- The legacy and default fallback lists carry no quality flag, so `observer` is treated as passive there, as the seed defines it.

- `PUT /metamodel/types/{type_key}/stakeholder-roles/order` in `backend/app/api/v1/stakeholder_roles.py`; the check is `validate_role_order` in `backend/app/services/stakeholder_service.py`; the audit action is `admin.stakeholder_role.reordered`.
- `counts_for_quality` is added to `GET /stakeholder-roles?type_key=` (`roles_for_type`, `list_roles` in `stakeholders.py`).
- Frontend: `StakeholderRolePanel.tsx` (the arrows) and `StakeholdersTab.tsx` (`owning` / `following`, `stakeholders.followingHeading`).
