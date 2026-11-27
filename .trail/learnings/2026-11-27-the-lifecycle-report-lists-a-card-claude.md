---
title: "The Lifecycle report lists a card's dated relations beneath it in every mode, including All types, and lists cards that have no dates of their own but a dated…"
author: Claude
date: 2026-11-27
branch: claude/intelligent-mayer-34u5d3
cost: { minutes: 1, tokens: 2632 }
id: l-f12806f8
scope: repo
status: active
src: agent
touches:
  - backend/app/api/v1/reports.py
  - backend/app/services/portfolio_payload.py
  - backend/tests/services/test_relation_lifecycle_guard.py
  - frontend/src/features/reports/LifecycleReport.tsx
---

## Decided
The owner asked (2026-11-27) for relation lifecycles to be visible in the Lifecycle report as foldable rows under each card, each led by the other card's name. Two choices were put to the owner and answered:

- The relation rows work in "All types" mode too, not only once a card type is chosen. This needs a reader that returns planned and ended relations for every card, which the relation-lifecycle guard only admits through its all-time allowlist. The owner accepted that one new allowlist entry and applies the `guard-change-approved` label on the PR himself.
- A card with no lifecycle dates of its own but with at least one dated relation is listed (typical for Organizations), with an empty bar and its relations beneath it.

The dated rows travel in their own key, apart from the relations the report's filters match on (those are the relations in effect on the day, without dates), and carry no relation attributes, so no cost value travels with them.

The owner also chose three extras for the same change: date fields when adding a relation, the clock editor in the inventory's relation cell popover, and dated relations in the demo data with new manual screenshots. A metamodel graph marker for tracked relation types was offered and not picked.

## Tried and ruled out
- Relation rows only once a card type is chosen: guard-clean (the typed payload already carries the dates) and recommended for that reason; the owner preferred the report to behave the same in All types.
- Passing the guard by referencing an in-effect helper in the loader without filtering by it: that dodges the guard instead of satisfying it. The loader is an all-time reader and says so in the allowlist.
- Keeping undated cards out of the report: relation lifecycles of undated cards could then never be seen there.
- A second toolbar control for expand all: it goes in the name column's header cell, because the owner turned down an extra toolbar button on the Dependencies view before.

## Watch out
- The Guard Ratchet check fails on a PR that adds an allowlist entry until the owner applies the label, and the label must be re-applied after any later push. An agent never applies it.
- An undated card listed this way is counted as "Plan" in the report's phase tally, like a card that only has start/end date attributes. Worth a separate look.

In the code:
- `GET /reports/roadmap` (`backend/app/api/v1/reports.py`), per item `relation_lifecycles: [{relation_type, direction, related_id, related_name, related_type, lifecycle}]`, present only when non-empty.
- Loader `dated_relations_by_card` in `backend/app/services/portfolio_payload.py`; allowlist `ALL_TIME` in `backend/tests/services/test_relation_lifecycle_guard.py`.
- Report rows: `frontend/src/features/reports/LifecycleReport.tsx`, `lifecycleRows.ts`; saved-report config keys `relExpandAll`, `relToggledIds`.
