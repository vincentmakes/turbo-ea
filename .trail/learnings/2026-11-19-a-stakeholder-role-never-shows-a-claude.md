---
title: "A stakeholder role never shows a card's costs: the cost viewing permission alone decides, because anyone can make themselves an Observer"
author: Claude
date: 2026-11-19
branch: claude/charming-franklin-e6y3au
cost: { minutes: 1, tokens: 2192 }
id: l-cc99b7c9
scope: repo
status: active
src: agent
touches:
  - backend/app/services/permission_service.py
  - backend/app/api/v1/stakeholders.py
  - backend/tests/api/test_cards_costs.py
  - backend/tests/api/test_relations.py
---

## Decided
Issue #1412: an admin took the cost viewing permission away from the Member role, and a member still saw a card's costs after clicking "Observe this card". The owner's decision: if the permission is not granted, stakeholders do not see costs. No stakeholder role shows or lets someone change cost fields on cards or relations, neither Observer nor an owner role. An admin who wants owners to see the costs of their own cards grants the permission to their app role.

Why: the first release of the permission let any stakeholder role on a card reveal that card's costs. Anyone who can view a card can make themselves its Observer in one click, so every user could reveal the costs of any card they could open and the permission protected nothing.

## Tried and ruled out
- A per-role "view costs" checkbox on stakeholder roles (a new card-level permission, Observer off by default): offered to the owner and not chosen. It also needed a migration, a default for old workspace bundles, and it would reopen the hole the day an admin ticked it on Observer.
- Excluding only the Observer role in code: not configurable, and a custom read-only role would still reveal costs.

## Watch out
- The card's effective permissions are served at `GET /cards/{id}/my-permissions`. The rules file still calls it `effective-permissions`; a test written against that path gets a 404 and fails for the wrong reason, before and after a fix.
- The role editor shows a permission by its key with an untranslated English group heading and description. A translated doc page must name `costs.view` and the literal **Costs**, not a translated permission name.
- `npm run build` in a cloud session dies at Node's 2 GB heap limit; run it with `NODE_OPTIONS=--max-old-space-size=8192`.
- The backend's system Python refuses `pip install -e ".[dev]"` (it tries to uninstall Debian's pip); use a virtual environment built with `python3.12 -m venv` outside the repo.

In the code:
- The rule: `PermissionService.can_view_costs(db, user)`, `card_ids_with_cost_access` (all candidates or none) and the `can_view_costs` flag in `get_effective_card_permissions`, all in `backend/app/services/permission_service.py`. `is_stakeholder_of` is gone.
- Self-assignment: `add_me_as_observer` in `backend/app/api/v1/stakeholders.py`.
- Guard tests: `TestObservingDoesNotRevealCosts` in `backend/tests/api/test_cards_costs.py`, `TestRelationCostsAndStakeholders` in `backend/tests/api/test_relations.py`.
