---
title: "A stakeholder role shows a card's costs only when the role is ticked to, and Observer is not: holding a role is never enough, because anyone can make themselve…"
author: Claude
date: 2026-11-19
branch: claude/charming-franklin-e6y3au
cost: { minutes: 30, tokens: 144826 }
id: l-45862a8f
scope: repo
status: active
replaces: l-cc99b7c9
src: agent
touches:
  - CHANGELOG.md
  - VERSION
  - backend/app/api/v1/bookmarks.py
  - backend/app/api/v1/cards.py
  - backend/app/api/v1/relations.py
  - backend/app/core/permissions.py
  - backend/app/services/cost_field_filter.py
  - backend/app/services/permission_service.py
  - backend/tests/api/test_cards_costs.py
  - backend/tests/api/test_relations.py
---

## Decided
Issue #1412: a member without the cost viewing permission saw a card's costs after clicking "Observe this card". The owner first chose to drop cost access for stakeholders altogether, then changed to this: each stakeholder role has its own "view costs" permission. On upgrade every existing role keeps showing costs, except Observer. A role created later starts without it.

Why Observer: it is the only role a user can give themselves, so anything it allows is open to everyone who can view the card. The role editor says so on that role.

## Tried and ruled out
- Costs for nobody but holders of the app permission (built and pushed first, then replaced the same day): owners without the app permission lost the costs of their own cards.
- Excluding Observer in code with no setting: not configurable, and a custom read-only role would still show costs.
- Giving cost access back to stakeholders whose role has no definition (the default Responsible and Observer of a custom card type nobody set roles up for): it needs either a hard-coded default in the permission check or a migration that creates role definitions. Left out; the changelog tells the admin to define the role.

## Watch out
- "Missing" and "off" are the same at runtime, but not in a workspace bundle. A bundle exported before 2.206.0 has no entry because the permission did not exist, and its roles all showed costs. The importer fills the entry only when the bundle's manifest names an older app version. A content pack or a bundle without a version is taken as written.
- The round-trip tests export with the app's own version, so the older-bundle tests fail until `VERSION` is at 2.206.0 or later.
- The card's effective permissions are at `GET /cards/{id}/my-permissions`, not `effective-permissions`: a test against the wrong path fails with 404 before and after a fix.
- The role editor shows a permission by its key and an English description in every language. Translated docs name `costs.view`, `card.view_costs` and the literal **Costs** heading.
- `npm run build` in a cloud session needs `NODE_OPTIONS=--max-old-space-size=8192`; the backend needs a `python3.12 -m venv` outside the repo because the system pip refuses the install.

In the code:
- Rule: `PermissionService.can_view_costs`, `card_ids_with_cost_access`, the `can_view_costs` flag (`backend/app/services/permission_service.py`); key `card.view_costs` and `with_legacy_cost_grant` in `backend/app/core/permissions.py`.
- Upgrade: `backend/alembic/versions/175_stakeholder_role_view_costs.py`. Import: `_predates_view_costs` in `workspace_io/applier.py`, `WorkspaceBundle.app_version`.
- Hint: `SELF_ASSIGNABLE_ROLE_KEY` in `StakeholderRolePanel.tsx`. Self-assignment: `add_me_as_observer` in `backend/app/api/v1/stakeholders.py`.
