---
title: "A card's costs follow one rule everywhere they travel: the role must be ticked to show them, event feeds and reports are cleaned when read, and who may assign…"
author: Claude
date: 2026-11-19
branch: claude/charming-franklin-e6y3au
cost: { minutes: 91, tokens: 420237 }
id: l-32bc00b6
scope: repo
status: active
replaces: l-45862a8f
src: agent
touches:
  - backend/app/api/v1/cards.py
  - backend/app/services/workspace_io/bundle.py
  - backend/tests/api/test_cards_costs.py
  - backend/tests/services/test_workspace_io_roundtrip.py
  - frontend/src/features/admin/metamodel/StakeholderRolePanel.tsx
  - CHANGELOG.md
  - VERSION
  - backend/alembic/versions/175_stakeholder_role_view_costs.py
  - backend/app/api/v1/bookmarks.py
  - backend/app/api/v1/relations.py
---

## Decided
Issue #1412 and its review. A stakeholder role shows a card's costs only when the role is ticked to (Observer is not). On upgrade every existing role keeps showing costs except Observer. The review then found the same costs reaching people by other routes, and the owner had them fixed in the same change:
- The history of a card, the activity feeds and a change batch read by its own author repeated the old and new cost values. They are removed when the feed is read, per reader.
- The Portfolio and Lifecycle reports returned every attribute of every card and relation. They now follow the card rule.
- Adding a relation again, or importing relations in bulk, replaced the cost attributes a user could not see. They are kept, as on an edit.
- A role that may not view a card type no longer gets that type's costs through the app permission.

Why clean on read, not on write: rollback restores a card from the values stored in the event. Removing them when the event is written would turn a rollback into a wipe of the cost fields.

Owner's calls on what is NOT guarded:
- Someone who may manage stakeholders can assign a cost-showing role to anyone, themselves included. Documented in the changelog and the admin guide; no check was added.
- A custom card type whose roles were never set up has no role definition to tick, so its stakeholders lose cost access on upgrade. Accepted; the changelog says to define the role.
Two findings from the second review of the cost-access change (#1412), both of the kind a passing test suite does not show:
- The Portfolio and Lifecycle reports list every relation row of a card, including rows whose relation type is hidden, but leave a hidden type out of the list of relation types they send along. A cost guard that read "which attributes are costs" from that list missed those rows. The cost keys are now read from the metamodel for the types the rows actually name.
- A bulk card edit that sends an empty attributes object replaces the stored attributes like any other edit. The guard that keeps hidden costs was written as "if attributes" and so skipped the empty object, wiping the costs. It now tests "is not None", as the single-card edit always did.

Why keep this: both guards looked complete and had tests. The gap was in what the guard took as its input, not in its logic.

## Tried and ruled out
- Blocking the assignment of a cost-showing role unless the assigner sees that card's costs (all assignments, or self-assignment only): offered, not chosen.
- Costs for nobody but holders of the app permission: built first, replaced the same day because owners lost the costs of their own cards.
- Reading cost keys from the schema a payload carries: shorter and needs no query, but the payload's schema is built for display (hidden and unreadable types removed), not for deciding what is sensitive.

## Watch out
- Left open, told to the owner: a survey shows and can overwrite a cost field for whoever it was sent to; a cost set while creating a card or relation is accepted from anyone who may create it.
- A bundle exported before 2.206.0 has no entry for the new permission; the importer fills it only when the manifest names an older version written exactly as X.Y.Z. A build without a VERSION file calls itself 0.0.0-dev and must not count as older.
- Tests that stash a file to prove "fails before the fix" cannot stash an untracked file together with tracked ones: git refuses the whole stash and the test then passes for the wrong reason.
- After `pip install -r requirements-docs.txt` in the backend venv, mypy cannot start (pathspec is downgraded); `pip install -U "pathspec>=1.0.0"` fixes it and mkdocs still builds.
- `pytest -o addopts=""` shows the pass/fail summary line that the repo's quiet default hides.

In the code:
- Rule: `PermissionService.can_view_costs`, `card_ids_with_cost_access`, `view_denied_types`, `sees_all_costs` (`backend/app/services/permission_service.py`); key `card.view_costs`, migration `175_stakeholder_role_view_costs.py`.
- Read side: `backend/app/services/event_cost_scrub.py` (history, `/reports/dashboard`, `/reports/admin-dashboard`, `/events/my-cards`, `/mutation-batches/{id}` and `/events`, rollback preview), `backend/app/services/cost_redaction.py` (`redact_portfolio_costs`, `card_cost_redaction_map`).
- Write side: `keep_stored_cost_values` in `cost_field_filter.py`; `preserve_attribute_keys` on `card_write_service.upsert_relation`; `_closed_cost_keys` and `cost_guard_user` in `api/v1/relations.py`.
- Self-assignment: `add_me_as_observer` in `api/v1/stakeholders.py`; assignment by a manager: `create_stakeholder`, same file.
- A bulk edit's dry-run preview returns each card's whole old and new attributes. It needed the same cost removal as the real response.
- An event payload with no card to ask about (the card was deleted, or the event is about a risk or a todo) is judged by the app-level cost permission alone. A `type` value in such a payload can be a dict or a list, so it is used as a card type only when it is a string naming one.

- `redact_portfolio_costs` in `backend/app/services/cost_redaction.py`; payload built by `build_portfolio_payload` in `portfolio_payload.py` (relation rows at step 2, `rel_type_defs` from non-hidden types at step 5).
- `bulk_update` and `_diff_without_costs` in `backend/app/api/v1/cards.py`.
- `scrub_event_costs` in `backend/app/services/event_cost_scrub.py`.
- Tests: `test_a_hidden_relation_type_still_has_its_costs_removed`, `TestBulkPatchKeepsHiddenCosts`, `test_a_type_that_is_not_a_card_type_key_is_no_type`.
