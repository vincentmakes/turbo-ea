---
title: "Cost reports attribute a related card's full cost to every linked primary card, so the report total double-counts shared initiatives (#1362)"
author: Claude
date: 2026-11-06
branch: claude/admiring-euler-r2scu1
cost: { minutes: 2, tokens: 90197 }
id: l-d7c9609e
scope: repo
status: active
src: agent
touches:
  - backend/app/api/v1/reports.py
  - frontend/src/i18n/locales/en/reports.json
  - docs/guide/reports.md
  - backend/tests/api/test_reports_extended.py
---

## Decided
Discussion #1362 (an Initiative linked to two Business Capabilities shows its €50k under both, total €100k) is real behaviour, not a data problem. The Cost Report's aggregate mode (card type + "cost sources" from a related type) sums the full cost of every linked related card per primary card and then sums the primaries for the total. The only dedup is within one primary card (parallel relation types, duplicate type:field pairs), never across primaries. The Capability Map's Total Cost metric attributes the same way. Group-by mode has the opposite flaw: a primary card linked to two group cards lands in one of them, whichever relation row came last. Nothing is documented and the Cost Sources tooltip ("no card is counted twice") is only true per tile.

Assessment given to the user (no code changed, nothing posted): full attribution is a legitimate impact view, but the Total Cost KPI should be computed over distinct related cards, tiles should say when a source is shared, and an attribution toggle (Full vs Split equally, dividing by the number of live in-scope primaries the related card links to) would answer the reporter directly. A weighted split via a relation attribute is the richer, later option.

## Tried and ruled out
Reading the discussion through GraphQL: not available from cloud sessions. `gh api -X GET repos/<owner>/<repo>/discussions/<n>` and `.../comments` work. The screenshot attachment URL on user-attachments cannot be fetched from a session.

## Watch out
If an equal split is implemented, the denominator must count every linked primary of the type, not only the primaries left after a `parent_card_id` drill-down, or shares change as the user drills. Decide explicitly whether cards hidden by CardReadScope count in the denominator.

In the code:
- `backend/app/api/v1/reports.py` `cost_treemap`: aggregate roll-up ~L1575-1600 (`per_primary`, `cost_by_primary`, `total += cost`); group-by attribution ~L1613-1650 (`item_group[sid] = grp_map[tid]` overwrites, last row wins).
- `capability_heatmap` total_cost ~L1855-1866 sums each linked app in full per capability.
- Tooltip key `cost.costSourceHelp` in `frontend/src/i18n/locales/en/reports.json`; docs section "Cost Report" in `docs/guide/reports.md`.
- Existing guard: `backend/tests/api/test_reports_extended.py` ~L1328 covers only two relations between the same pair.
