---
title: "Card links (#1335) and the data-quality breakdown (#1334): traps hit while building them"
author: Claude
date: 2026-10-30
branch: feat/1334-1335-dq-breakdown-and-card-links
cost: { minutes: 9, tokens: 1832 }
id: l-d98e0cfd
scope: repo
status: active
src: agent
touches:
  - frontend/src/features/cards/sections/DescendantRelationsDrawer.tsx
  - frontend/src/components/ClickableCardName.tsx
  - frontend/src/features/bpm/ProcessFlowTab.tsx
  - "backend/app/services/data_quality.py#score_breakdown"
  - "backend/app/services/card_completeness.py#mandatory_items"
---

## Decided
- The sub-items drawer row is the link (`ListItemButton component={RouterLink}`); its `via` chips are NOT links, because an `<a>` may not hold another `<a>`. A chip prevents the row's default and opens its own card: plain click navigates, Ctrl/Cmd/Shift or middle click (`onAuxClick`, button 1) does `window.open(…, "_blank", "noopener")`.
- `score_breakdown` keeps the old `count × weight` sums for relations and tags instead of adding one weight per item, so `score_card` returns bit-identical floats (adding 0.1 three times is not 0.3). Met items come from `mandatory_items` in card_completeness, which `evaluate` is now built on, so applicability still has one definition.
- `score_if_filled` is a method on the breakdown, computed only by the endpoint, so the bulk rescore path pays nothing for it.

## Tried and ruled out
- Asserting `mockNavigate` after switching a click to a router `Link`: `Link` navigates through react-router's internal `useNavigate`, not the mocked export, so the mock is never called. Assert the anchor's `href` and a `useLocation` probe instead (done in `ProcessFlowTab.test.tsx` / `.mutation.test.tsx`).

## Watch out
- A modified click on a real link in jsdom logs "Error: Not implemented: navigation". Add a `document` click listener that calls `preventDefault()`: it runs after React's root listener, so the component under test still sees an un-prevented event.
- A chip with `onDelete` rendered as a link: MUI's delete icon only stops propagation, so the browser still follows the `<a>`; `onDelete` must `preventDefault()` (the BPM Calls chip).
- The new screenshot `63_card_data_quality_breakdown` has a `pages.ts` entry and a doc reference, but no captured PNG yet.
