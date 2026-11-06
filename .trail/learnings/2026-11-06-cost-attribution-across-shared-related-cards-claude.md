---
title: "Cost attribution across shared related cards is a Full/Split equally toggle; the split denominator counts readable live primaries before any drill (#1362)"
author: Claude
date: 2026-11-06
branch: claude/admiring-euler-r2scu1
cost: { minutes: 1, tokens: 2830 }
id: l-7abe9ac3
scope: repo
status: active
src: agent
touches:
  - backend/app/api/v1/reports.py
---

## Decided
- A related card linked to several displayed cards (one initiative improving two capabilities) is counted by an **Attribution** choice rather than one fixed rule, because both readings are legitimate: Full is an impact view (how much money depends on this card), Split equally is an allocation view (where the budget goes). Full stays the default so existing saved reports keep their tile numbers; what changes in Full is that the Total counts each related card once, shared tiles are marked, and Average and "% of total" are taken against the tile sum, because percentages against the distinct total read 100% + 100% on two tiles sharing one source.
- The split denominator is the number of readable, active, live-in-fiscal-year cards of the displayed type linked to the related card, counted per card id over the unrestricted set, before any drill or client-side scope: a share is a property of the landscape, not of the view, so drilling or scoping must not change it. Hidden cards are excluded because a share would otherwise reveal that a card the reader cannot see exists.
- A drill in split mode divides by the parent's type link count so the panel total equals the parent tile. The drill parent only has to be readable, not active, because a saved report drilled into a since-archived card must still open.
- The Capability Map computes the split client-side from each app's readable capability ids and does not refetch on toggle: the page never reads the server's per-capability total, which exists (with the backend param) for MCP consumers.
- The MCP-only group-by mode lists a card under every group it links to and keeps the single group as the alphabetically first, because "last relation row wins" was arbitrary.

## Tried and ruled out
- Honest total only, no toggle: leaves the reporter's "split it between them" unanswered.
- Split only, replacing full attribution: silently changes every existing report's tile numbers.
- Weighted split through a relation attribute (allocation %): the richest answer, but needs metamodel and relation-editor work; kept as a follow-up.
- Counting hidden cards in the denominator: honest for the money, but leaks a hidden card's existence through the share.

## Watch out
- The heatmap's per-app related-by-type map deliberately excludes capabilities, so an app's capability ids must be derived from the capability-to-apps map, never from raw relation rows, or the read-scope sentinel sweep fails.
- All the arithmetic lives in a pure service module with exact-number unit tests, because mutmut never mutates a route body.

In the code:
- `backend/app/services/cost_attribution.py`; `cost_treemap` and `capability_heatmap` in `backend/app/api/v1/reports.py` (`attribution` param, `source_ids`, `source_costs`, `groups`, `capability_ids`).
- `frontend/src/features/reports/costAttribution.ts` (`distinctTotal`, `sharedSourceCounts`, `splitShare`), `CostReport.tsx`, `CapabilityMapReport.tsx`; keys `cost.attribution*`, `cost.shared*` in `en/reports.json`.
- Tests: `backend/tests/api/test_reports_cost_attribution.py`, `tests/services/test_cost_attribution.py`, `CostReport.test.tsx`, `CapabilityMapReport.attribution.test.tsx`, `costAttribution.test.ts`.
