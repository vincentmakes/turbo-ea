---
title: "Card links (#1335) and the data-quality breakdown (#1334): traps hit while building them"
author: Claude
date: 2026-10-30
branch: feat/1334-1335-dq-breakdown-and-card-links
cost: { minutes: 13, tokens: 107676 }
id: l-ecd1a143
scope: repo
status: active
replaces: l-d98e0cfd
src: agent
touches:
  - CHANGELOG.md
  - backend/app/api/v1/cards.py
  - backend/app/schemas/card.py
  - backend/app/services/card_completeness.py
  - backend/app/services/data_quality.py
  - backend/tests/api/test_data_quality_breakdown.py
  - backend/tests/services/test_data_quality.py
  - docs/admin/metamodel.md
  - docs/admin/tags.md
  - docs/api/openapi.json
---

## Decided
- In the sub-items drawer the row's name and each `via` chip are separate real links on a plain list item, never a whole-row button with chips inside it: an `<a>` may not hold another `<a>`, and a chip inside a row link is a second control a keyboard user cannot tell from the row. The first build had the row as the link and chips as buttons doing window.open; review replaced it.
- `score_breakdown` keeps the old `count × weight` sums for relations and tags instead of adding one weight per item, so `score_card` returns bit-identical floats (adding 0.1 three times is not 0.3). Met items come from `mandatory_items`, which `evaluate` is now built on, so applicability still has one definition.
- `score_if_filled` is a method on the breakdown, computed only by the endpoint, so the bulk rescore path pays nothing for it. One service entry point (`calc_data_quality_breakdown`) feeds both the stored score and the endpoint.
- While required fields pin the score at 0, the pill ranks those fields first and marks them "required" instead of a percentage: their own score_if_filled is unreachable until every required field is filled, and ranking by gain alone buried the one field that unlocks the score.
- `isModifiedClick` includes Alt, the same set react-router's Link hands to the browser; otherwise a link's side effect (close a drawer) ran while no navigation happened.

## Tried and ruled out
- Asserting `mockNavigate` after switching a click to a router `Link`: `Link` navigates through react-router's internal hook, not the mocked export, so the mock is never called. Assert the anchor's `href` and a `useLocation` probe instead.

## Watch out
- A modified click on a real link in jsdom logs "Error: Not implemented: navigation". Add a `document` click listener that calls `preventDefault()`: it runs after React's root listener, so the component under test still sees an un-prevented event.
- A chip with `onDelete` rendered as a link: MUI's delete icon only stops propagation, so the browser still follows the `<a>`; `onDelete` must `preventDefault()` (the BPM Calls chip).
- A relation type mandatory on both ends of a self-referencing type gives two factors with one key; React keys must include the side.

In the code:
- frontend/src/features/cards/sections/DescendantRelationsDrawer.tsx (ListItem + two RouterLinks), frontend/src/lib/modifiedClick.ts
- backend/app/services/data_quality.py (score_breakdown, calc_data_quality_breakdown), backend/app/services/card_completeness.py (mandatory_items)
- frontend/src/features/cards/sections/DataQualityPill.tsx (rankUnmet, factorKey)
