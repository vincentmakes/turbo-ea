---
title: "The data quality breakdown opens as a docked side panel on click, with no popover and no pin"
author: Claude
date: 2026-10-30
branch: feat/1334-1335-dq-breakdown-and-card-links
cost: { minutes: 81, tokens: 242256 }
id: l-f391a567
scope: repo
status: active
src: agent
touches:
  - CHANGELOG.md
  - docs/admin/settings.md
  - docs/guide/card-details.md
  - frontend/UI_GUIDELINES.md
  - frontend/src/components/CardDetailSidePanel.tsx
  - frontend/src/features/cards/CardDetail.gainFlight.test.tsx
  - frontend/src/features/cards/CardDetail.tsx
  - frontend/src/features/cards/dataQualityJump.ts
  - frontend/src/features/cards/gamification/StickyScoreBar.test.tsx
  - frontend/src/features/cards/gamification/StickyScoreBar.tsx
---

## Decided
A click on the score (the header ring, or the sticky bar's "Raise score" button) opens the full breakdown directly as a narrow docked panel on the right of the card page; it stays open across jumps, saves and the next card until its Close button, and the open state is remembered per browser. Hover keeps the top-three tooltip. Below the `md` breakpoint the same content opens in a temporary right drawer that closes before a jump. The bar carries an explicit outlined "Raise score" button because nobody guesses that a score figure is clickable. The panel is available to everyone; only the sticky bar is TurboRPG-only.

## Tried and ruled out
A click-popover plus a "pin" that turned it into the panel (and, before that, a pin on the bar that kept the bar on screen). The user found both confusing: the pin's purpose read as "pin the bar", a hidden click target on the score was undiscoverable, and three surfaces (tooltip, popover, panel) for one thing was two too many. One panel on click is the whole model.

## Watch out
Keep the three hosts (ring tooltip, docked panel, small-screen drawer) over one `DataQualityBreakdownContent`; never fork the body. The ring without `onOpenBreakdown` (the card preview side panel) is tooltip-only on purpose. `useMediaQuery(..., { noSsr: true })` for the docked/drawer choice, or a remembered panel flashes up as a drawer on a wide window's first render.

In the code: `frontend/src/features/cards/sections/DataQualityBreakdownContent.tsx`, `DataQualityBreakdownPanel.tsx`, `DataQualityBreakdownHost.tsx`, `frontend/src/lib/dataQualityPanel.ts` (key `turboea_dq_panel_open`), `DataQualityPill.tsx` (`onOpenBreakdown` / `breakdownOpen`), `gamification/StickyScoreBar.tsx` (`sticky-score-raise`, `rightInset`), `CardDetail.tsx` (`card-detail-page-frame` padding, `panelDocked`).
