---
title: "The data quality score explains itself through a hover tooltip and a click popover, never through generated to-dos"
author: Claude
date: 2026-10-30
branch: feat/1334-1335-dq-breakdown-and-card-links
cost: { minutes: 15, tokens: 158823 }
id: l-fb656af4
scope: repo
status: active
src: agent
touches:
  - CHANGELOG.md
  - README.md
  - VERSION
  - frontend/src/components/charts/EChart.test.tsx
  - frontend/src/components/charts/EChart.tsx
  - frontend/src/components/charts/chrome.test.ts
  - frontend/src/components/charts/chrome.ts
  - frontend/src/components/charts/echartsTheme.test.tsx
  - frontend/src/components/charts/echartsTheme.ts
---

## Decided
For discussion #1334 (users ask "what exactly do I fill to raise the score?") the maintainer chose: one read-only breakdown endpoint per card, surfaced as a hover tooltip (top three unmet factors with the score each would reach) and a click popover (full list, plus which required fields pin the score at 0 and what it would be without the gate). Nothing is persisted; the breakdown is computed from the same pure scorer that writes the stored score, so the two can never disagree. Rows in the popover are informational in the first version; no navigation.

Also decided for #1335: related-card references on the card page become real anchors through the shared clickable-name leaf taking a `to` prop, so middle-click / Ctrl-click / right-click open a tab natively. Report side panels, the search dialog and dashboard rows deliberately keep their click handlers (they open a panel or close a dialog by design).

## Tried and ruled out
- Backend-generated system to-dos ("Fill lifecycle", one per missing factor) auto-closed on rescore: rescoring runs in bulk on a hot path, it needs dedupe, a new to-do origin, workspace-transfer handling and would flood the global Todos list and notifications. Rejected by the maintainer as too heavy and noisy.
- Suggested (unstored) to-dos derived live in the Todos tab with an "Add as to-do" button: coherent but a second surface for the same data; dropped to keep the first version small. Could be layered on the same endpoint later.
- Tooltip only, no click: a type with many fields makes the tooltip unwieldy and it is unusable on touch.
- Computing the breakdown client-side from the metamodel payload: the stakeholder roles' counts_for_quality flag is not in the types payload and the mandatory-relation applicability logic would be duplicated; the backend is the single definition.

## Watch out
- The client-side required-field banner exempts calculated and auto (PPM) fields; the backend gate exempts only `readonly` fields. The popover must display the backend's list, not recompute it.
- The admin Data quality panel's composition bar counts relations and tags as one slot each; the backend multiplies per applicable mandatory item. Do not "align" the bar when touching the breakdown.
- Three card-section tests mock react-router wholesale with only useNavigate; a Link import in those components is undefined under them. Convert to importActual partial mocks.

In the code:
- Scorer: backend/app/services/data_quality.py (score_card → score_breakdown refactor); mandatory items: backend/app/services/card_completeness.py evaluate().
- Endpoint: GET /cards/{id}/data-quality in backend/app/api/v1/cards.py, gated like the hierarchy sub-read.
- Pill: DataQualityPill in frontend/src/features/cards/sections/cardDetailUtils.tsx, rendered in CardDetail.tsx and components/CardDetailSidePanel.tsx.
- Links: frontend/src/components/ClickableCardName.tsx `to` prop; pattern from InventoryPage.tsx Name cell (Box component={RouterLink}).
